// Flocklet main process: hook server + registry watcher -> store -> overlay window.
const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, shell, nativeImage, nativeTheme, screen, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { SessionStore } = require('./store');
const { watchRegistry } = require('./registry');
const { startHookServer } = require('./hookServer');
const { installHooks, uninstallHooks } = require('./hooksConfig');
const { Broker } = require('./broker');
const { buildDecision } = require('./decisions');
const { watchUsage } = require('./usage');
const { watchDesktopSessions } = require('./desktopSessions');
const { LiveUsage } = require('./liveUsage');
const Grouping = require('../renderer/grouping');
const Themes = require('../renderer/themes');
const Pets = require('../renderer/pets');
const { chickBitmap } = require('./trayIcon');
const { transitions } = require('./notify');
const { readContext } = require('./context');

const Release = require('./release');
// Settings folder first: everything below (log, config, single-instance lock) uses it.
app.setPath('userData', Release.settingsDir(app.getPath('appData')));
Release.migrateSettings(app.getPath('appData'));
const INSTALLED = Release.isInstalled(app);
const AUMID = INSTALLED ? Release.APP_ID : Release.DEV_AUMID;
let updates = { enabled: false, check() {} };

const PORT = 4777;
const PanelSize = require('./panelSize');
const DRAWERS = ['sessions', 'settings'];
const HOTKEY = 'Control+Alt+A';
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const HOST_ID_RE = /^local_[A-Za-z0-9-]{1,64}$/;
const CAPTURE_FILE = process.env.AGENTDECK_CAPTURE; // debug: PNG of the panel after each update

let win = null;
let tray = null;
let cfg = null;
let store = null;
let broker = null;
let server = null;
let stopRegistry = null;
let stopUsage = null;
let stopDesktop = null;
let usage = null;       // from Claude desktop's history file
let live = null;        // straight from Anthropic with the Claude Code login
const LIVE_FRESH_MS = 20 * 60e3;
const USAGE_EVENTS = new Set(['UserPromptSubmit', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure']);
let hooks = { ok: false, error: 'starting' };
let quitting = false;
let cleanedUp = false;
let lastCounts = { working: 0, waiting: 0, done: 0, idle: 0 };
let savedDeck = null;
const notifyPrev = new Map();
let notifyPrimed = false;
const toasts = new Set(); // keep references so click handlers survive GC

const FOLD_KEY_RE = /^[hp]:.{1,300}$/s;
const userFile = (...p) => path.join(app.getPath('userData'), ...p);

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  try { fs.appendFileSync(userFile('agentdeck.log'), line); } catch { /* ignore */ }
}

function loadConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(userFile('config.json'), 'utf8').replace(/^﻿/, '')); } catch { /* first run */ }
  if (typeof c.token !== 'string' || c.token.length < 32) c.token = crypto.randomBytes(24).toString('hex');
  for (const k of ['muted', 'collapsed', 'showIdle', 'dock', 'railMin', 'dockNames']) if (typeof c[k] !== 'boolean') c[k] = false;
  if (!PanelSize.SIDES.includes(c.rail)) c.rail = 'left';
  if (!DRAWERS.includes(c.drawer)) c.drawer = null;
  if (!Grouping.MODES.includes(c.groupBy)) c.groupBy = 'folder';
  if (!Array.isArray(c.pins)) c.pins = [];
  if (!Array.isArray(c.groups)) c.groups = [];
  if (!c.groupOf || typeof c.groupOf !== 'object') c.groupOf = {};
  if (typeof c.notify !== 'boolean') c.notify = true;
  if (!Array.isArray(c.quiet)) c.quiet = [];
  if (!Array.isArray(c.folded)) c.folded = [];
  c.width = PanelSize.clampWidth(c.width);
  c.maxHeight = PanelSize.clampCap(c.maxHeight, 10000);
  if (typeof c.miniList !== 'boolean') c.miniList = c.miniMaxHeight != null; // was a pixel height
  delete c.miniMaxHeight;
  c.folded = c.folded.filter((k) => typeof k === 'string' && FOLD_KEY_RE.test(k)).slice(-500);
  c.theme = Themes.normalizeTheme(c.theme);
  if (!c.pets || typeof c.pets !== 'object' || Array.isArray(c.pets)) c.pets = {};
  for (const [k, v] of Object.entries(c.pets)) if (!Pets.PETS.includes(v)) delete c.pets[k];
  if (!c.petColors || typeof c.petColors !== 'object' || Array.isArray(c.petColors)) c.petColors = {};
  for (const [k, v] of Object.entries(c.petColors)) if (!(Number.isInteger(v) && v >= 1 && v <= 6)) delete c.petColors[k];
  if (!Pets.PETS.includes(c.petDefault)) c.petDefault = null;
  return c;
}

function saveConfig() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(userFile('config.json'), JSON.stringify(cfg, null, 2));
  } catch (e) { console.error('config save failed', e); }
}

// ---------- hooks ----------
function ensureHooks() {
  if (!server) return;
  try {
    installHooks({ settingsFile: SETTINGS_FILE, port: PORT, token: cfg.token, backupDir: userFile('backups') });
    hooks = { ok: true, error: null };
  } catch (e) {
    hooks = { ok: false, error: `could not update settings.json (${e.message})` };
  }
  rebuildTrayMenu();
  pushState();
}

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  // Sync on purpose: also runs from process 'exit' and Windows session-end.
  try { if (broker) broker.releaseAll(); } catch { /* sockets already gone */ }
  try { uninstallHooks({ settingsFile: SETTINGS_FILE, backupDir: userFile('backups') }); } catch (e) { console.error(e); }
  try { if (server) server.close(); } catch { /* already closed */ }
  if (stopRegistry) stopRegistry();
  if (stopUsage) stopUsage();
  if (stopDesktop) stopDesktop();
  globalShortcut.unregisterAll();
}

// ---------- state push ----------
let pushTimer = null;
function pushState() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (!store) return;
    const snap = store.snapshot();
    snap.cards = Grouping.decorate(snap.cards, cfg);
    snap.counts = Grouping.count(snap.cards);
    const quiet = new Set(cfg.quiet);
    for (const c of snap.cards) {
      c.quiet = quiet.has(c.key);
      c.pet = cfg.pets[c.key] || cfg.petDefault || Pets.defaultPet(c.hue);
      c.colorSlot = cfg.petColors[c.key] || Pets.colorSlot(c.hue);
      c.petChosen = !!(cfg.pets[c.key] || cfg.petColors[c.key]);
    }
    for (const n of transitions(notifyPrev, snap.cards, { enabled: cfg.notify, quiet: cfg.quiet, first: !notifyPrimed })) showToast(n);
    notifyPrimed = true;
    lastCounts = snap.counts;
    saveDeck();
    updateTray();
    if (win && !win.isDestroyed()) {
      win.webContents.send('state', {
        ...snap,
        ui: { muted: cfg.muted, collapsed: cfg.collapsed, showIdle: cfg.showIdle, rail: cfg.rail, drawer: cfg.drawer, notify: cfg.notify, dock: cfg.dock, startup: INSTALLED ? cfg.startup : null,
          version: app.getVersion(), updates: updates.enabled, railMin: cfg.railMin, dockNames: cfg.dockNames, width: cfg.width, deckHeight: cfg.collapsed ? null : cfg.maxHeight, groupBy: cfg.groupBy, groups: cfg.groups, folded: cfg.folded, miniList: cfg.miniList || miniDragging, fixedHeight: cfg.dock ? false : cfg.collapsed ? miniDragging : cfg.maxHeight != null,
          theme: cfg.theme, mode: Themes.resolveMode(cfg.theme, nativeTheme.shouldUseDarkColors) },
        hooks,
        usage: currentUsage(),
      });
      if (CAPTURE_FILE) scheduleCapture();
    }
  }, 80);
}

// Which sessions are shown as cards survives restarts (a card only leaves when you click X).
function saveDeck() {
  const keys = JSON.stringify(store.deckKeys());
  if (keys === savedDeck) return;
  savedDeck = keys;
  try { fs.writeFileSync(userFile('deck.json'), keys); } catch (e) { log('deck save failed', e.message); }
}

function loadDeck() {
  try { return JSON.parse(fs.readFileSync(userFile('deck.json'), 'utf8')); } catch { return []; }
}

// ---------- notifications ----------
function showToast(n) {
  if (!Notification.isSupported()) return;
  const t = new Notification({ title: n.title, body: n.body, silent: true, icon: chickIcon(null, 64) }); // the panel plays its own chime
  t.on('click', () => {
    if (n.hostId && HOST_ID_RE.test(n.hostId)) shell.openExternal(`claude://code/continue?session=${n.hostId}&source=agentdeck`);
    revealWindow();
  });
  t.on('close', () => toasts.delete(t));
  t.on('show', () => log('toast shown', n.kind));
  t.on('failed', (_e, err) => log('toast failed', String(err)));
  toasts.add(t);
  setTimeout(() => toasts.delete(t), 10 * 60e3);
  t.show();
  log('toast', n.kind);
}

// Windows only shows toasts for an app with a Start-menu shortcut carrying its AppUserModelID.
// The installer makes that shortcut for the installed app; a copy run from source makes its own,
// "Flocklet (dev)", so the two never fight over one shortcut. Its file name is the toast sender name.
function ensureStartMenuShortcut() {
  if (process.platform !== 'win32' || INSTALLED) return;
  const dir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const lnk = path.join(dir, 'Flocklet (dev).lnk');
  // Prefer the branded copy of electron.exe (made by `npm run brand`): it carries the chick icon and
  // the name "Flocklet", and the shortcut shows the target's own icon (Electron 45 does not write `icon`).
  const branded = path.join(path.dirname(process.execPath), 'Flocklet.exe');
  const target = fs.existsSync(branded) ? branded : process.execPath;
  try {
    const ok = shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'update' : 'create', {
      target, args: `"${app.getAppPath()}"`, cwd: app.getAppPath(),
      appUserModelId: AUMID, description: 'Flocklet (run from source): floating panel for Claude Code sessions',
      icon: target, iconIndex: 0,
    });
    log('start menu shortcut', { ok });
    // Only one shortcut may carry the id, or Windows picks either name for toasts. Remove our old ones
    // (AgentDeck.lnk, the source copy's former Flocklet.lnk) and the one Electron makes by itself on the
    // first toast when none exists (Electron.lnk). The installer's Flocklet.lnk has another id: untouched.
    for (const name of ['AgentDeck.lnk', 'Electron.lnk', 'Flocklet.lnk']) {
      const old = path.join(dir, name);
      if (!ok || !fs.existsSync(old)) continue;
      const info = shell.readShortcutLink(old);
      if (info.appUserModelId === AUMID) { fs.unlinkSync(old); log('removed old shortcut', name); }
    }
  } catch (e) { log('start menu shortcut failed', e.message); }
}

// Toast sender name + icon. Without this key Windows guesses from the exe and can show "Electron".
// Same per-user key the Windows App SDK writes for unpackaged apps: HKCU\Software\Classes\AppUserModelId\<id>.
function registerToastIdentity() {
  if (process.platform !== 'win32') return;
  try {
    const png = userFile('flocklet-256.png');
    fs.writeFileSync(png, chickIcon(null, 256).toPNG());
    const key = `HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}`;
    const set = (name, type, value) => new Promise((resolve) => {
      execFile('reg.exe', ['add', key, '/v', name, '/t', type, '/d', value, '/f'], { windowsHide: true },
        (err) => resolve(!err));
    });
    Promise.all([
      set('DisplayName', 'REG_EXPAND_SZ', 'Flocklet'),
      set('IconUri', 'REG_EXPAND_SZ', png),
      set('IconBackgroundColor', 'REG_SZ', '00000000'),
    ]).then((oks) => log('toast identity', { ok: oks.every(Boolean) }));
  } catch (e) { log('toast identity failed', e.message); }
}

// ---------- context fill ----------
const contextReadAt = new Map();
function refreshContext(onlyId) {
  if (!store) return;
  const now = Date.now();
  for (const { id, file } of store.contextTargets(path.join(CLAUDE_DIR, 'projects'), path.join)) {
    if (onlyId && id !== onlyId) continue;
    if (now - (contextReadAt.get(id) || 0) < 3000) continue;
    contextReadAt.set(id, now);
    store.setContext(id, readContext(file));
  }
}

// Live reading when it is fresh, otherwise Claude desktop's own reading.
function currentUsage() {
  const l = live && live.usage;
  const liveStatus = live ? live.status : 'idle';
  if (l && Date.now() - l.at < LIVE_FRESH_MS) return { ...l, liveStatus };
  if (usage) return { ...usage, source: 'claude-app', liveStatus };
  if (l) return { ...l, stale: true, liveStatus };
  return liveStatus === 'signin' ? { source: 'none', liveStatus } : null;
}

// One-time Claude Code sign-in in its own console window (needed for live usage).
function openSignIn() {
  try {
    spawn('cmd.exe', ['/c', 'start "Claude Code sign-in" cmd /k claude auth login'],
      { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } catch (e) { log('sign-in launch failed', e.message); }
}

let captureTimer = null;
function scheduleCapture() {
  clearTimeout(captureTimer);
  captureTimer = setTimeout(async () => {
    try { fs.writeFileSync(CAPTURE_FILE, (await win.webContents.capturePage()).toPNG()); } catch { /* window gone */ }
  }, 700);
}

// ---------- window ----------
function onSomeScreen(pos) {
  return pos && screen.getAllDisplays().some(({ workArea: a }) =>
    pos.x >= a.x - 40 && pos.x <= a.x + a.width - 80 && pos.y >= a.y - 10 && pos.y <= a.y + a.height - 40);
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const pos = onSomeScreen(cfg.pos) ? cfg.pos : { x: wa.x + wa.width - cfg.width - 12, y: wa.y + 12 };
  win = new BrowserWindow({
    x: pos.x, y: pos.y, width: cfg.width, height: 90,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Flocklet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', spellcheck: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('moved', () => { const [x, y] = win.getPosition(); cfg.pos = { x: x + off.x, y: y + off.y }; saveConfig(); }); // the deck's spot
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('session-end', cleanup); // Windows log off / shutdown
  win.on('show', rebuildTrayMenu); // the tray menu says Minimise or Restore
  win.on('hide', rebuildTrayMenu);
  win.once('ready-to-show', revealWindow);
  win.webContents.once('did-finish-load', () => setTimeout(() => { if (!win.isVisible()) revealWindow(); }, 500));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// Windows applies the launcher's "start hidden" flag to a process's first ShowWindow call
// (e.g. when started from a background shell), so show, check, and show once more.
function revealWindow() {
  if (!win || win.isDestroyed()) return;
  win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');
  setTimeout(() => {
    if (!win.isVisible()) win.showInactive();
    log('window', { visible: win.isVisible(), bounds: win.getBounds() });
  }, 150);
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide(); else revealWindow();
}

// ---------- tray ----------
// Puffball pixel chick; a status dot shows when an agent works (coral) or waits (amber).
const iconCache = new Map();
function chickIcon(dot = null, size = 32) {
  const id = `${dot}@${size}`;
  if (iconCache.has(id)) return iconCache.get(id);
  const { buf, width, height, scaleFactor } = chickBitmap({ size, dot });
  const img = nativeImage.createFromBitmap(buf, { width, height, scaleFactor: size === 32 ? scaleFactor : 1 });
  iconCache.set(id, img);
  return img;
}

function updateTray() {
  if (!tray) return;
  const c = lastCounts;
  tray.setImage(chickIcon(c.waiting ? '#f5b942' : c.working ? '#ef7d52' : null));
  const parts = [c.working && `${c.working} working`, c.waiting && `${c.waiting} waiting`, c.done && `${c.done} done`].filter(Boolean);
  tray.setToolTip(`Flocklet: ${parts.join(' · ') || 'all quiet'}`);
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: win && win.isVisible() ? 'Minimise to tray' : 'Restore Flocklet', accelerator: HOTKEY, registerAccelerator: false, click: toggleWindow },
    { label: 'View', submenu: [
      { label: 'Panel', type: 'radio', checked: !!cfg && !cfg.dock && !cfg.collapsed, click: () => setView({ dock: false, collapsed: false }) },
      { label: 'Minimised bar', type: 'radio', checked: !!cfg && !cfg.dock && cfg.collapsed, click: () => setView({ dock: false, collapsed: true }) },
      { label: 'Pet dock', type: 'radio', checked: !!cfg && cfg.dock, click: () => setView({ dock: true }) },
    ] },
    { type: 'separator' },
    { label: hooks.ok ? 'Live updates: on' : `Live updates: off (${hooks.error})`, enabled: false },
    { label: 'Notifications', type: 'checkbox', checked: !!(cfg && cfg.notify),
      click: (mi) => { cfg.notify = mi.checked; saveConfig(); } },
    { label: 'Reconnect to Claude Code', click: ensureHooks, enabled: !!server },
    { label: 'Sign in to Claude Code (live usage)', click: openSignIn, visible: !!live && live.status === 'signin' },
    { type: 'separator' },
    { label: 'Theme', submenu: themeMenu() },
    { label: 'Start with Windows', type: 'checkbox', checked: !!(cfg && cfg.startup), enabled: INSTALLED,
      click: (mi) => { Release.setStartup(app, cfg, mi.checked); saveConfig(); pushState(); } },
    { label: 'Check for updates', click: () => updates.check(), visible: updates.enabled },
    { type: 'separator' },
    { label: `Flocklet ${app.getVersion()}${INSTALLED ? '' : ' (from source)'}`, enabled: false },
    { label: 'Quit Flocklet', click: () => app.quit() },
  ]));
}

function setView(patch) {
  Object.assign(cfg, patch);
  saveConfig();
  pushState();
  fitWindow();
  rebuildTrayMenu();
  revealWindow();
}

// Right-click on the pet dock: names, grouping, leave the dock, minimise.
ipcMain.on('ui:dockMenu', () => {
  if (!win || win.isDestroyed()) return;
  const group = (mode, label) => ({ label, type: 'radio', checked: cfg.groupBy === mode, click: () => { cfg.groupBy = mode; saveConfig(); pushState(); } });
  Menu.buildFromTemplate([
    { label: 'Names under pets', type: 'checkbox', checked: cfg.dockNames, click: (mi) => { cfg.dockNames = mi.checked; saveConfig(); pushState(); } },
    { label: 'Group pets by', submenu: [group('folder', 'Project'), group('custom', 'My groups'), group('none', 'No groups')] },
    { type: 'separator' },
    { label: 'Back to the panel', click: () => setView({ dock: false }) },
    { label: 'Minimise to tray', click: () => win.hide() },
  ]).popup({ window: win });
});

function themeMenu() {
  const t = (cfg && cfg.theme) || Themes.DEFAULT;
  const radio = (field, list) => list.map((x) => ({
    label: x.name, type: 'radio', checked: t[field] === x.id, click: () => setTheme({ [field]: x.id }),
  }));
  return [
    { label: 'Palette', submenu: radio('palette', Themes.PALETTES) },
    { label: 'Look', submenu: radio('look', Themes.LOOKS) },
    { label: 'Light / dark', submenu: radio('mode', Themes.MODES) },
  ];
}

function createTray() {
  tray = new Tray(chickIcon());
  tray.on('click', toggleWindow);
  rebuildTrayMenu();
  updateTray();
}

// ---------- IPC from the overlay ----------
ipcMain.on('ui:ready', () => pushState());
// The overlay reports its content height; the window follows it, under your max height and the screen.
let contentHeight = 90;
let drag = null; // {edge, start} while you drag a grab strip
let dragWatchdog = null;
// The window = deck (the panel) + rail + open drawer. `deck` is where the panel sits on screen;
// `off` is where it sits inside the window (the rail and drawer open outward, so the deck stays still).
let deck = null;
let off = { x: 0, y: 0 };
const railSide = () => (cfg.dock ? null : cfg.rail); // the rail stays when minimised (compact), not in the pet dock
const drawerOpen = () => !cfg.dock && !cfg.railMin && cfg.drawer != null; // sidebar and panel minimise separately
let dockWidth = 200; // pet dock: the overlay measures its row
let dockAnchored = false; // the dock keeps its bottom edge still when a card pops up above it
// Minimised list snaps between two stops: stats only, or every deck session (no scroll bar).
let miniStops = { bar: 90, full: 90 }; // measured by the overlay
let miniDragging = false;

function deckNow() {
  const b = win.getBounds();
  return deck ? { ...deck, x: b.x + off.x, y: b.y + off.y } : { x: b.x, y: b.y, width: cfg.width, height: b.height };
}
// Place the window around a deck rect, kept on screen (the whole shell shifts if it would leave it).
function applyDeck(d) {
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  const r = PanelSize.shellRect(d, railSide(), drawerOpen(), cfg.railMin);
  const x = Math.max(wa.x, Math.min(r.x, wa.x + wa.width - r.width));
  const y = Math.max(wa.y, Math.min(r.y, wa.y + wa.height - r.height));
  off = { x: r.offX, y: r.offY };
  deck = { x: x + r.offX, y: y + r.offY, width: d.width, height: d.height };
  const b = win.getBounds();
  if (b.x !== x || b.y !== y || b.width !== r.width || b.height !== r.height) win.setBounds({ x, y, width: r.width, height: r.height });
}
function extraY() {
  const side = railSide();
  if (side !== 'top' && side !== 'bottom') return 0;
  return (cfg.railMin ? PanelSize.RAIL_MIN : PanelSize.RAIL) + PanelSize.GAP + (drawerOpen() ? PanelSize.DRAWER_H + PanelSize.GAP : 0);
}
function endDrag() {
  clearTimeout(dragWatchdog);
  if (!drag) return;
  if (miniDragging) { // snap: nearer to the full list than to the bare bar = show every session
    cfg.miniList = PanelSize.snapMini(win.getBounds().height - extraY(), miniStops);
    miniDragging = false;
  }
  drag = null;
  saveConfig();
  pushState(); // re-measure at the new size
  fitWindow();
}
function fitWindow() {
  if (!win || win.isDestroyed() || drag) return;
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  if (cfg.dock) { // pet dock: as wide as its pets, bottom edge stays put
    const now = deckNow();
    const height = PanelSize.fitHeight(contentHeight, null, wa.height - 24);
    const width = Math.max(120, Math.min(dockWidth, wa.width - 24));
    const y = dockAnchored ? now.y + now.height - height : now.y;
    dockAnchored = true;
    applyDeck({ x: now.x, y, width, height });
    return;
  }
  dockAnchored = false;
  const height = PanelSize.windowHeight(contentHeight, cfg.collapsed ? null : cfg.maxHeight, wa.height - 24 - extraY());
  applyDeck({ ...deckNow(), width: cfg.width, height });
}
ipcMain.on('ui:resize', (_e, h, stops) => {
  contentHeight = Number(h) || contentHeight;
  const bar = Number(stops && stops.bar), full = Number(stops && stops.full);
  const dw = Number(stops && stops.dockW);
  if (dw > 0) dockWidth = Math.round(dw);
  if (bar > 0 && full >= bar) miniStops = { bar: Math.round(bar), full: Math.round(full) };
  fitWindow();
});

// Grab strips: phase start / move (dx, dy since start) / end / reset (double-click). They resize the deck.
ipcMain.on('ui:drag', (_e, edge, phase, dx, dy) => {
  if (!win || win.isDestroyed() || !PanelSize.EDGES.includes(edge) || cfg.dock) return; // the dock sizes itself
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  clearTimeout(dragWatchdog);
  if (phase === 'start') {
    const tall = edge.startsWith('bottom');
    const now = deckNow();
    // First stretch: fix the height at the current size, so the panel follows the pointer from here.
    if (tall && cfg.collapsed) { miniDragging = true; pushState(); } // show the rows while you drag
    if (tall && !cfg.collapsed && cfg.maxHeight == null) { cfg.maxHeight = now.height; pushState(); }
    drag = { edge, start: { ...now, cap: cfg.collapsed ? null : cfg.maxHeight } };
    dragWatchdog = setTimeout(endDrag, 15e3);
  } else if (phase === 'move' && drag && drag.edge === edge) {
    dragWatchdog = setTimeout(endDrag, 15e3); // a lost release never leaves the window stuck
    const d = (v) => Math.max(-5000, Math.min(5000, Number(v) || 0));
    const r = PanelSize.dragTo(drag.start, edge, d(dx), d(dy), wa.height - 24 - extraY());
    const tall = edge.startsWith('bottom');
    cfg.width = r.width;
    let height = drag.start.height;
    if (tall && cfg.collapsed) height = Math.max(PanelSize.MINI_MIN, Math.min(drag.start.height + d(dy), wa.height - 24));
    else if (tall) height = cfg.maxHeight = r.cap;
    applyDeck({ x: r.x, y: drag.start.y, width: r.width, height });
  } else if (phase === 'end' && drag) {
    endDrag();
  } else if (phase === 'reset') {
    drag = null;
    if (edge.startsWith('bottom') && cfg.collapsed) cfg.miniList = !cfg.miniList; // double-click flips the stop
    else if (edge.startsWith('bottom')) cfg.maxHeight = null;
    if (edge !== 'bottom') cfg.width = PanelSize.DEFAULT_WIDTH;
    saveConfig();
    pushState();
    fitWindow();
  }
});
ipcMain.on('ui:jump', (_e, hostId) => {
  if (typeof hostId === 'string' && HOST_ID_RE.test(hostId)) {
    shell.openExternal(`claude://code/continue?session=${hostId}&source=agentdeck`);
  }
});
ipcMain.on('ui:hideCard', (_e, id) => { if (typeof id === 'string') store.hide(id); });
// The panel sends only an intent; the reply is built from the original hook payload.
ipcMain.on('ui:decide', (_e, requestId, action) => {
  const p = typeof requestId === 'string' && broker.get(requestId);
  if (!p) return; // already answered in Claude, or timed out
  let output;
  try { output = buildDecision(p.ev, action); } catch (e) { log('decision rejected', e.message); return; }
  if (broker.decide(requestId, output)) {
    log('decided', { tool: p.ev.tool_name, action: action.type });
    store.resolveWait(requestId);
  }
});
// Fold or unfold a project/group header ('h:<key>') or a parent's children ('p:<card key>').
ipcMain.on('ui:fold', (_e, key, folded) => {
  if (typeof key !== 'string' || !FOLD_KEY_RE.test(key)) return;
  cfg.folded = cfg.folded.filter((k) => k !== key);
  if (folded === true) cfg.folded = [...cfg.folded, key].slice(-500);
  saveConfig();
  pushState();
});

ipcMain.on('ui:set', (_e, patch) => {
  for (const k of ['muted', 'collapsed', 'showIdle', 'notify', 'dock', 'railMin', 'dockNames']) if (typeof patch?.[k] === 'boolean') cfg[k] = patch[k];
  if (patch && ('dock' in patch || 'collapsed' in patch)) rebuildTrayMenu();
  if (patch && 'notify' in patch) rebuildTrayMenu();
  if (PanelSize.SIDES.includes(patch?.rail)) cfg.rail = patch.rail;
  if (typeof patch?.startup === 'boolean') { Release.setStartup(app, cfg, patch.startup); rebuildTrayMenu(); }
  if (patch && 'drawer' in patch && (patch.drawer === null || DRAWERS.includes(patch.drawer))) cfg.drawer = patch.drawer;
  if (Grouping.MODES.includes(patch?.groupBy)) cfg.groupBy = patch.groupBy;
  if (patch?.theme && typeof patch.theme === 'object') setTheme(patch.theme);
  saveConfig();
  pushState();
  fitWindow(); // rail side / drawer change the window around the deck
});

function setTheme(partial) {
  cfg.theme = Themes.normalizeTheme({ ...cfg.theme, ...partial });
  saveConfig();
  rebuildTrayMenu(); // keep the tray's radio marks in step with the panel picker
  pushState();
}
ipcMain.on('ui:hide', () => { if (win) win.hide(); });
// Pins and custom groups are keyed by the desktop session id (stable across restarts).
const KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;
const GROUP_COLORS = [5, 3, 4, 6, 2, 1];
ipcMain.on('ui:pet', (_e, key, kind) => {
  if (typeof key !== 'string' || !KEY_RE.test(key) || !Pets.PETS.includes(kind)) return;
  cfg.pets[key] = kind;
  saveConfig();
  pushState();
});
// Pet menu: set this session's colour (slot 1..6), use one pet for every session, or reset to automatic.
ipcMain.on('ui:petMenu', (_e, op, key, value) => {
  if (op === 'color' && typeof key === 'string' && KEY_RE.test(key) && Number.isInteger(value) && value >= 1 && value <= 6) {
    cfg.petColors[key] = value;
  } else if (op === 'all' && Pets.PETS.includes(value)) {
    cfg.petDefault = value;
    cfg.pets = {};
  } else if (op === 'reset' && typeof key === 'string' && KEY_RE.test(key)) {
    delete cfg.pets[key];
    delete cfg.petColors[key];
  } else return;
  saveConfig();
  pushState();
});
ipcMain.on('ui:pin', (_e, key, on) => {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return;
  cfg.pins = cfg.pins.filter((k) => k !== key);
  if (on) cfg.pins.push(key);
  saveConfig();
  pushState();
});
ipcMain.on('ui:group', (_e, op) => {
  if (!op || typeof op !== 'object') return;
  const name = typeof op.name === 'string' ? op.name.trim().slice(0, 40) : '';
  if (op.op === 'create' && name) {
    const id = `g_${crypto.randomBytes(4).toString('hex')}`;
    cfg.groups.push({ id, name, color: GROUP_COLORS[cfg.groups.length % GROUP_COLORS.length] });
    if (typeof op.key === 'string' && KEY_RE.test(op.key)) cfg.groupOf[op.key] = id;
  } else if (op.op === 'rename' && name) {
    const g = cfg.groups.find((x) => x.id === op.id);
    if (g) g.name = name;
  } else if (op.op === 'delete') {
    cfg.groups = cfg.groups.filter((x) => x.id !== op.id);
    for (const k of Object.keys(cfg.groupOf)) if (cfg.groupOf[k] === op.id) delete cfg.groupOf[k];
  } else if (op.op === 'assign' && typeof op.key === 'string' && KEY_RE.test(op.key)) {
    if (op.id && cfg.groups.some((x) => x.id === op.id)) cfg.groupOf[op.key] = op.id; else delete cfg.groupOf[op.key];
  } else return;
  saveConfig();
  pushState();
});
ipcMain.on('ui:quiet', (_e, key, on) => {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return;
  cfg.quiet = cfg.quiet.filter((k) => k !== key);
  if (on) cfg.quiet.push(key);
  saveConfig();
  pushState();
});
ipcMain.on('ui:refreshUsage', () => { if (live) live.request('button'); });
ipcMain.on('ui:signIn', () => openSignIn());
ipcMain.on('ui:checkUpdates', () => updates.check());

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId(AUMID);
  // Launching again shows the panel; launching with --quit closes the running copy cleanly.
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--quit')) app.quit(); else revealWindow();
  });
  app.on('window-all-closed', () => { /* tray app: keep running */ });
  app.on('before-quit', () => { quitting = true; cleanup(); });
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.quit());

  app.whenReady().then(async () => {
    cfg = loadConfig();
    saveConfig();
    Release.initStartup(app, cfg, saveConfig); // installed app: start with Windows, on by default
    broker = new Broker({ onGone: (id) => store.markStale(id) });
    store = new SessionStore({ onRelease: (id) => broker.release(id) });
    store.restoreDeck(loadDeck());
    store.onChange(pushState);

    try {
      server = await startHookServer({
        port: PORT, token: cfg.token,
        onEvent: (ev, reply) => {
          if (ev.hook_event_name === 'PermissionRequest' && ev.session_id) {
            store.applyHook(ev, { requestId: broker.hold(ev, reply) });
            if (live) live.request('event');
            return true; // answered later from the panel, or released when Claude moves on
          }
          store.applyHook(ev);
          if (live && USAGE_EVENTS.has(ev.hook_event_name)) live.request('event');
          if (ev.hook_event_name === 'Stop' || ev.hook_event_name === 'PostToolUse') setTimeout(() => refreshContext(ev.session_id), 300);
          return false;
        },
        onError: (e) => console.error('hook server', e),
      });
    } catch (e) {
      hooks = { ok: false, error: e.code === 'EADDRINUSE' ? `port ${PORT} is in use` : e.message };
    }

    log('start', { version: app.getVersion(), server: !!server, display: screen.getPrimaryDisplay().workArea });
    createWindow();
    createTray();
    ensureHooks();
    log('hooks', hooks);
    stopRegistry = watchRegistry(SESSIONS_DIR, (list) => store.applyRegistry(list));
    stopUsage = watchUsage((u) => { usage = u; pushState(); });
    stopDesktop = watchDesktopSessions((list) => store.applyDesktop(list));
    if (!globalShortcut.register(HOTKEY, toggleWindow)) console.warn(`hotkey ${HOTKEY} unavailable`);
    nativeTheme.on('updated', () => { if (cfg.theme.mode === 'windows') pushState(); });
    live = new LiveUsage({
      onUpdate: (status) => { if (status === 'signin' || status === 'ok') rebuildTrayMenu(); pushState(); },
      log,
    });
    live.request('timer');
    setInterval(() => {
      // Busy: every 5 min. Quiet: every 15 min. Events and the button come on top (max once a minute).
      const every = lastCounts.working + lastCounts.waiting > 0 ? 5 * 60e3 : 15 * 60e3;
      if (Date.now() - live.lastTryAt >= every) live.request('timer');
    }, 30e3);
    setInterval(pushState, 30e3); // re-ages readings and timers
    setInterval(() => refreshContext(), 15e3);
    setTimeout(() => refreshContext(), 2000);
    ensureStartMenuShortcut();
    registerToastIdentity();
    updates = Release.initUpdates({ app, dialog, log }); // installed app: "Update ready" dialog
    rebuildTrayMenu();
    if (process.env.AGENTDECK_TEST_TOAST) {
      setTimeout(() => showToast({ kind: 'test', title: 'Flocklet test', body: 'If you can read this, notifications work.' }), 3000);
    }
  });
}
