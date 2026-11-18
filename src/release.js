// Everything about being an installed app: where settings live, start with Windows, auto-update.
// The installed build comes from electron-builder (see "build" in package.json) and updates from
// GitHub Releases; a copy run from source (npm start / Flocklet.vbs) skips start-with-Windows and updates.
const fs = require('fs');
const path = require('path');

const APP_ID = 'com.flocklet.app'; // installed build: AppUserModelID = electron-builder appId
const DEV_AUMID = 'AgentDeck'; // run from source: keeps the Windows notification settings it already has
const CHECK_EVERY_MS = 6 * 3600e3;

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
  if (!app.isPackaged) return;
  if (typeof cfg.startup !== 'boolean') { cfg.startup = true; save(); }
  app.setLoginItemSettings({ openAtLogin: cfg.startup });
}
function setStartup(app, cfg, on) {
  if (!app.isPackaged) return;
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
// "Later" installs when you quit Flocklet.
function initUpdates({ app, dialog, log }) {
  if (!app.isPackaged) return { enabled: false, check() {} };
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m) => log('update', String(m)), warn: (m) => log('update warn', String(m)), error: (m) => log('update error', String(m)), debug() {} };
  let byHand = false;
  let asked = null;
  autoUpdater.on('update-downloaded', async (info) => {
    if (asked === info.version) return;
    asked = info.version;
    const notes = plainNotes(info.releaseNotes);
    const { response } = await dialog.showMessageBox({
      type: 'info', title: 'Flocklet update', noLink: true, buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      message: `Flocklet ${info.version} is ready`,
      detail: `${notes ? `${notes}\n\n` : ''}Restart now to update. With "Later" it installs when you quit Flocklet.`,
    });
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });
  autoUpdater.on('update-not-available', () => {
    if (byHand) dialog.showMessageBox({ type: 'info', title: 'Flocklet', message: `Flocklet ${app.getVersion()} is up to date.`, buttons: ['OK'] });
    byHand = false;
  });
  autoUpdater.on('update-available', (info) => {
    if (byHand) dialog.showMessageBox({ type: 'info', title: 'Flocklet', message: `Downloading Flocklet ${info.version}…`, detail: 'You will be asked to restart when it is ready.', buttons: ['OK'] });
    byHand = false;
  });
  autoUpdater.on('error', (e) => {
    log('update failed', e && e.message);
    if (byHand) dialog.showMessageBox({ type: 'warning', title: 'Flocklet', message: 'Could not check for updates', detail: String(e && e.message).slice(0, 300), buttons: ['OK'] });
    byHand = false;
  });
  const check = (manual) => { byHand = !!manual; autoUpdater.checkForUpdates().catch(() => {}); };
  setTimeout(() => check(false), 15e3);
  setInterval(() => check(false), CHECK_EVERY_MS);
  return { enabled: true, check: () => check(true) };
}

module.exports = { APP_ID, DEV_AUMID, settingsDir, migrateSettings, initStartup, setStartup, plainNotes, initUpdates };
