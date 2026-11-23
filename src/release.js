// Everything about being an installed app: where settings live, start with Windows, auto-update.
// The installed build comes from electron-builder (see "build" in package.json) and updates from
// GitHub Releases; a copy run from source (npm start / Flocklet.vbs) skips start-with-Windows and updates.
const fs = require('fs');
const path = require('path');

const APP_ID = 'com.flocklet.app'; // installed build: AppUserModelID = electron-builder appId
const DEV_AUMID = 'AgentDeck'; // run from source: keeps the Windows notification settings it already has
const CHECK_EVERY_MS = 6 * 3600e3;
// Right after Windows starts, security drivers are still loading and a silent install can fail without a word
// (seen twice, never mid-session). So the first check waits until the PC has been up a few minutes.
const BOOT_SETTLE_S = 180;
const firstCheckDelayMs = (uptimeS) => Math.max(15, BOOT_SETTLE_S - uptimeS) * 1e3;

// "Restart now" notes the version it is installing. Starting again on another version means that install
// never happened: the next try runs the installer visibly, so you see its progress or its error.
function lastInstall({ tried, running }) {
  if (!tried) return { failed: false, clear: false };
  return { failed: tried !== running, clear: true };
}

// Installed = built by electron-builder. Not enough: app.isPackaged only looks at the exe's file name, and the
// source copy runs a renamed electron.exe (Flocklet.exe, see scripts/brand.js). Electron sets defaultApp
// when it was started with a folder to run (electron.exe <folder>), which only the source copy does.
const isInstalled = (app, proc = process) => !!app.isPackaged && !proc.defaultApp;

// Settings live in %APPDATA%\Flocklet for both builds (so they never run twice: the single-instance lock
// is per settings folder). Builds before 0.2.0 used %APPDATA%\agentdeck: our own files are copied once.
const settingsDir = (appData) => path.join(appData, 'Flocklet');
function migrateSettings(appData) {
  const dir = settingsDir(appData);
  const old = path.join(appData, 'agentdeck');
  if (fs.existsSync(path.join(dir, 'config.json')) || !fs.existsSync(path.join(old, 'config.json'))) return false;
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(old)) {
    const src = path.join(old, f);
    if (/\.(json|log|png)$/i.test(f) && fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(dir, f));
  }
  return true;
}

// Start with Windows: on by default the first time the installed app runs; your switch after that.
function initStartup(app, cfg, save) {
  if (!isInstalled(app)) return;
  if (typeof cfg.startup !== 'boolean') { cfg.startup = true; save(); }
  app.setLoginItemSettings({ openAtLogin: cfg.startup });
}
function setStartup(app, cfg, on) {
  if (!isInstalled(app)) return;
  cfg.startup = !!on;
  app.setLoginItemSettings({ openAtLogin: cfg.startup });
}

// Release notes arrive as HTML (GitHub) or a list of notes: show them as short plain text.
function plainNotes(notes) {
  const text = Array.isArray(notes) ? notes.map((n) => (n && n.note) || '').join('\n') : String(notes || '');
  return text.replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<li>/gi, '• ').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 700);
}

// Auto-update: check on start and every 6 h, download quietly, then ask "Restart now / Later".
// "Later" installs when you quit Flocklet. So it cannot be missed (a dialog without a parent opens behind the
// always-on-top panel): the dialog is attached to the panel, a Windows notification says it too, and the tray
// menu offers "Restart to update" until you do.
// Debug log only: a small detached PowerShell outlives Flocklet, waits for the installer and writes its exit code
// and the installed version to the log (the silent installer keeps no log of its own).
const WATCH_PS = `param($log, $exe)
function Add($m) { Add-Content -LiteralPath $log -Value ("{0} dbg installer {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'), $m) }
$p = $null
for ($i = 0; $i -lt 80 -and -not $p; $i++) { $p = Get-Process -Name 'Flocklet-Setup-*' -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $p) { Start-Sleep -Milliseconds 250 } }
if (-not $p) { Add 'not seen within 20 s'; exit }
Add ("started pid " + $p.Id)
if ($p.WaitForExit(900000)) { Add ("exit code " + $p.ExitCode) } else { Add 'still running after 15 min' }
Start-Sleep -Seconds 2
try { Add ("installed exe " + (Get-Item -LiteralPath $exe -ErrorAction Stop).VersionInfo.ProductVersion) } catch { Add 'installed exe missing' }
`;
function watchInstaller(logFile, log) {
  try {
    const script = path.join(path.dirname(logFile), 'install-watch.ps1');
    fs.writeFileSync(script, WATCH_PS);
    const { spawn } = require('child_process');
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, logFile, process.execPath],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) { log('dbg installer watch failed', e.message); }
}

function initUpdates({ app, dialog, log, getWindow = () => null, notify = () => {}, onReady = () => {},
  memo = { get: () => null, set() {} }, uptime = () => require('os').uptime(), debug = () => false, logFile = null }) {
  if (!isInstalled(app)) return { enabled: false, check() {}, ready: () => null, install() {} };
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m) => log('update', String(m)), warn: (m) => log('update warn', String(m)), error: (m) => log('update error', String(m)), debug() {} };
  let byHand = false;
  let asked = null;
  let ready = null;
  const last = lastInstall({ tried: memo.get(), running: app.getVersion() });
  if (last.failed) log('update did not install', { tried: memo.get(), running: app.getVersion() });
  if (last.clear) memo.set(null);
  const install = () => {
    if (ready) memo.set(ready);
    log('update install', { version: ready, visible: last.failed });
    if (debug() && logFile) watchInstaller(logFile, log);
    setImmediate(() => autoUpdater.quitAndInstall(!last.failed, true));
  };
  const ask = (opts) => {
    const w = getWindow();
    return w && !w.isDestroyed() && w.isVisible() ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts);
  };
  autoUpdater.on('update-downloaded', async (info) => {
    if (asked === info.version) return;
    asked = info.version;
    ready = info.version;
    onReady(info.version);
    notify(`Flocklet ${info.version} is ready`, 'Click to restart and update.', install);
    const notes = plainNotes(info.releaseNotes);
    const { response } = await ask({
      type: 'info', title: 'Flocklet update', noLink: true, buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      message: `Flocklet ${info.version} is ready`,
      detail: `${notes ? `${notes}\n\n` : ''}Restart now to update. With "Later" it installs when you quit Flocklet.`,
    });
    if (response === 0) install();
  });
  autoUpdater.on('update-not-available', () => {
    if (byHand) ask({ type: 'info', title: 'Flocklet', message: `Flocklet ${app.getVersion()} is up to date.`, buttons: ['OK'] });
    byHand = false;
  });
  autoUpdater.on('update-available', (info) => {
    if (byHand) ask({ type: 'info', title: 'Flocklet', message: `Downloading Flocklet ${info.version}…`, detail: 'You will be asked to restart when it is ready.', buttons: ['OK'] });
    byHand = false;
  });
  autoUpdater.on('error', (e) => {
    log('update failed', e && e.message);
    if (byHand) ask({ type: 'warning', title: 'Flocklet', message: 'Could not check for updates', detail: String(e && e.message).slice(0, 300), buttons: ['OK'] });
    byHand = false;
  });
  const check = (manual) => { byHand = !!manual; autoUpdater.checkForUpdates().catch(() => {}); };
  setTimeout(() => check(false), firstCheckDelayMs(uptime()));
  setInterval(() => check(false), CHECK_EVERY_MS);
  return { enabled: true, check: () => check(true), ready: () => ready, install };
}

module.exports = { isInstalled, APP_ID, DEV_AUMID, settingsDir, migrateSettings, initStartup, setStartup, plainNotes, initUpdates, lastInstall, firstCheckDelayMs };
