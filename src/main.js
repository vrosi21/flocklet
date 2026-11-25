// Flocklet main process: hook server + registry watcher -> store -> overlay window.
const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, shell, nativeImage, nativeTheme, screen, dialog, crashReporter } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { SessionStore } = require('./store');
const { watchRegistry } = require('./registry');
const { startHookServer } = require('./hookServer');
const { installHooks, uninstallHooks } = require('./hooksConfig');
const { Broker } = require('./broker');
const { buildDecision } = require('./decisions');
const { watchDesktopSessions } = require('./desktopSessions');
const Grouping = require('../renderer/grouping');
const Themes = require('../renderer/themes');
const Pets = require('../renderer/pets');
const Tour = require('../renderer/tour-pages');
const { chickBitmap } = require('./trayIcon');
const { transitions } = require('./notify');
const { readContext } = require('./context');

const Release = require('./release');
const Boards = require('./boards');
const HookPolicy = require('./hookPolicy');
const INSTALLED = Release.isInstalled(app);
// A copy run from source is the dev copy. It runs next to the installed (prod) one: own settings folder (so its
// own single-instance lock), own port, and hooks that watch but never answer permissions (prod keeps doing that).
const DEV = !INSTALLED;
// --bg: for automated tests. Windows are fully transparent and click-through, nothing takes focus, no tray icon,
// no notifications, no hotkey. Screenshots over the debugging port still work.
const BG = DEV && (process.argv.includes('--bg') || process.env.FLOCKLET_BG === '1');
// An invisible window counts as covered, and Chromium stops painting it: keep painting for screenshots.
if (BG) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}
// Settings folder first: everything below (log, config, single-instance lock) uses it.
if (DEV) app.setPath('userData', path.join(app.getPath('appData'), 'Flocklet Dev'));
else {
  app.setPath('userData', Release.settingsDir(app.getPath('appData')));
  Release.migrateSettings(app.getPath('appData'));
}
const AUMID = INSTALLED ? Release.APP_ID : Release.DEV_AUMID;
// If Flocklet ever crashes, a crash dump stays on this PC (settings folder\Crashpad) for a bug report; nothing is sent.
crashReporter.start({ uploadToServer: false, compress: true });
let updates = { enabled: false, check() {}, ready: () => null, install() {} };

const PORT = DEV ? 4778 : 4777;
// Dev copy, tests only: sessions from a JSON file instead of Claude (FLOCKLET_FAKE=<file>), so every window shows them.
const FAKE = DEV && process.env.FLOCKLET_FAKE ? (() => { try { return JSON.parse(fs.readFileSync(process.env.FLOCKLET_FAKE, 'utf8')); } catch { return null; } })() : null;
const PanelSize = require('./panelSize');
const DRAWERS = ['sessions', 'settings']; // the two tabs of the Sessions / Settings card beside the deck
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
let stopDesktop = null;
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

// Debug log: extra lines in agentdeck.log (event and tool names, short session ids, timings, update steps).
// Never prompts, commands, file contents or the token; never sent anywhere. Always on in the dev copy.
function dlog(...parts) { if (cfg && cfg.debug) log('dbg', ...parts); }

function loadConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(userFile('config.json'), 'utf8').replace(/^﻿/, '')); } catch { /* first run */ }
  if (typeof c.token !== 'string' || c.token.length < 32) c.token = crypto.randomBytes(24).toString('hex');
  for (const k of ['muted', 'collapsed', 'showIdle', 'dock', 'railMin', 'dockNames', 'dockGroupNames']) if (typeof c[k] !== 'boolean') c[k] = false;
  c.railMin = false; // the sidebar no longer hides; its hide button hides the panels instead (cfg.panelsHidden)
  if (c.dockNamesV !== 2) { c.dockNames = true; c.dockNamesV = 2; } // 0.6.3: the dock shows session names, not project names
  if (!c.panelsHidden || !Array.isArray(c.panelsHidden.boards)) c.panelsHidden = null; // { boards: [ids it hid] }
  if (!c.projectNames || typeof c.projectNames !== 'object' || Array.isArray(c.projectNames)) c.projectNames = {};
  for (const [k, v] of Object.entries(c.projectNames)) if (typeof v !== 'string' || !v.trim() || k.length > 400) delete c.projectNames[k];
  if (!PanelSize.SIDES.includes(c.rail)) c.rail = 'left';
  if (!DRAWERS.includes(c.drawer)) c.drawer = null;
  c.boards = Boards.normalizeBoards(c.boards, Themes.normalizeTheme); // workspaces (src/boards.js)
  c.sessionBoard = Boards.normalizeSessionBoard(c.sessionBoard, c.boards);
  if (!c.boards.some((b) => b.id === c.view && b.inside)) c.view = null; // the board shown on Main's card (null: Main)
  c.hiddenByAll = Array.isArray(c.hiddenByAll) ? c.hiddenByAll.filter((id) => c.boards.some((b) => b.id === id)) : [];
  if (!['left', 'right'].includes(c.drawerSide)) c.drawerSide = null; // the Sessions / Settings card: left or right of the deck
  delete c.settingsOpen; // 0.6.0 had Settings in its own window
  delete c.settingsPos;
  if (!Grouping.MODES.includes(c.groupBy)) c.groupBy = 'folder';
  if (!Array.isArray(c.pins)) c.pins = [];
  if (!Array.isArray(c.groups)) c.groups = [];
  if (!c.groupOf || typeof c.groupOf !== 'object') c.groupOf = {};
  const strings = (v, n) => (Array.isArray(v) ? v.filter((k) => typeof k === 'string').slice(0, n) : []);
  c.order = strings(c.order, 2000); // session keys in the order you dragged them (renderer/carry.js)
  c.folderOrder = strings(c.folderOrder, 200); // project folders in the order you dragged them
  if (typeof c.emotes !== 'boolean') c.emotes = true; // busy pets now and then do something cute
  if (typeof c.notify !== 'boolean') c.notify = true;
  if (!Array.isArray(c.quiet)) c.quiet = [];
  if (!Array.isArray(c.folded)) c.folded = [];
  if (typeof c.tourSeen !== 'string') c.tourSeen = null;
  c.zoom = PanelSize.clampZoom(c.zoom);
  const themes = (v, n) => (Array.isArray(v) ? v.filter((t) => t && typeof t === 'object').map(Themes.normalizeTheme).slice(-n) : []);
  c.themeUndo = themes(c.themeUndo, 20); // styles before each change, newest last
  c.recentThemes = themes(c.recentThemes, 5); // the last styles you used, newest first
  if (typeof c.settingsAdvanced !== 'boolean') c.settingsAdvanced = false;
  if (![0, 1, 2, 3].includes(c.glass)) c.glass = 0; // Settings → Glass: 0 solid .. 3 strong
  if (typeof c.debug !== 'boolean') c.debug = false;
  if (DEV) c.debug = true;
  if (typeof c.updateTried !== 'string') c.updateTried = null; // version "Restart now" last tried to install
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
    installHooks({ settingsFile: SETTINGS_FILE, port: PORT, token: cfg.token, backupDir: userFile('backups'), observe: DEV });
    hooks = { ok: true, error: null };
  } catch (e) {
    hooks = { ok: false, error: `could not update settings.json (${e.message})` };
  }
  rebuildTrayMenu();
  pushState();
  checkHookPolicy();
}

// Written is not the same as running: Claude Code skips these hooks when an admin policy or your own setting says
// so. Look (read-only) and say it plainly; never work around it (src/hookPolicy.js).
const regQuery = (key) => new Promise((resolve, reject) => {
  if (process.platform !== 'win32') { reject(new Error('no registry')); return; }
  execFile('reg', ['query', key, '/v', 'Settings'], { windowsHide: true, timeout: 4000 }, (err, out) => (err ? reject(err) : resolve(out)));
});
async function checkHookPolicy() {
  if (!server || (!hooks.ok && !hooks.blocked)) return; // not written at all: that error stays
  let why = null;
  try {
    const p = await HookPolicy.readPolicies({ fs, regQuery, programFiles: process.env.ProgramFiles, settingsFile: SETTINGS_FILE });
    why = HookPolicy.blockedReason({ ...p, url: `http://127.0.0.1:${PORT}/hook` });
  } catch (e) { dlog('hook policy check failed', e.message); }
  const was = hooks.blocked ? hooks.why : null;
  if (why === was) return;
  hooks = why ? { ok: false, blocked: true, why, error: HookPolicy.MESSAGES[why] } : { ok: true, error: null };
  log('hooks', why ? `blocked by Claude Code settings: ${why}` : 'allowed again');
  rebuildTrayMenu();
  pushState();
}

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  // Sync on purpose: also runs from process 'exit' and Windows session-end.
  try { if (broker) broker.releaseAll(); } catch { /* sockets already gone */ }
  try { uninstallHooks({ settingsFile: SETTINGS_FILE, backupDir: userFile('backups'), port: PORT }); } catch (e) { console.error(e); }
  try { if (server) server.close(); } catch { /* already closed */ }
  if (stopRegistry) stopRegistry();
  if (stopDesktop) stopDesktop();
  globalShortcut.unregisterAll();
}

// ---------- state push ----------
let pushTimer = null;
let lastCards = []; // the sessions as last shown (with their boards)
function pushState() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (!store) return;
    const snap = store.snapshot();
    if (Array.isArray(FAKE)) snap.cards = FAKE.map((c) => ({ ...c, since: c.at || Date.now() - (c.ago || 60) * 1e3, lastActivityAt: c.at || Date.now() - (c.ago || 60) * 1e3 }));
    snap.cards = Boards.place(Grouping.applyOrder(Grouping.decorate(snap.cards, cfg), cfg.order), cfg);
    lastCards = snap.cards;
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
      const ui = { muted: cfg.muted, collapsed: cfg.collapsed, showIdle: cfg.showIdle, rail: cfg.rail, drawer: cfg.drawer, notify: cfg.notify, dock: cfg.dock, startup: INSTALLED ? cfg.startup : null,
        theme: cfg.theme, mode: Themes.resolveMode(cfg.theme, nativeTheme.shouldUseDarkColors) };
      if (tourWin && !tourWin.isDestroyed()) tourWin.webContents.send('state', { ui });
      const base = { muted: cfg.muted, collapsed: cfg.collapsed, showIdle: cfg.showIdle, rail: cfg.rail, drawer: cfg.drawer, drawerSide: cfg.drawerSide || cfg.rail, notify: cfg.notify, dock: cfg.dock, startup: INSTALLED ? cfg.startup : null,
        version: app.getVersion(), updates: updates.enabled, debug: cfg.debug, dev: DEV, zoom: cfg.zoom,
        glass: cfg.glass, settingsAdvanced: cfg.settingsAdvanced, railMin: false, panelsHidden: !!cfg.panelsHidden, dockNames: cfg.dockNames, dockGroupNames: cfg.dockGroupNames, projectNames: cfg.projectNames, width: cfg.width, deckHeight: cfg.collapsed ? null : cfg.maxHeight, groupBy: cfg.groupBy, groups: cfg.groups, folded: cfg.folded, folderOrder: cfg.folderOrder, ordered: cfg.order.length > 0 || cfg.folderOrder.length > 0, emotes: cfg.emotes, miniList: cfg.miniList || miniDragging, fixedHeight: cfg.dock ? false : cfg.collapsed ? miniDragging : cfg.maxHeight != null };
      win.webContents.send('state', { ...snap, ui: { ...base, drawerSide: drawerSide(), ...viewUi('main') }, hooks });
      const joined = Boards.joins(cfg.boards);
      for (const bw of boardWins.values()) {
        const b = boardById(bw.id);
        if (!b || bw.win.isDestroyed()) continue;
        bw.win.webContents.send('state', { ...snap, ui: { ...base, ...viewUi('board', b.id), collapsed: false, dock: b.dock, railMin: false, miniList: false,
          joined: joined[b.id] || null,
          width: b.width, deckHeight: b.maxHeight, fixedHeight: b.maxHeight != null }, hooks });
      }
      if (CAPTURE_FILE) scheduleCapture();
    }
  }, 80);
}

// What each window shows: Main (or the board open on its card; Settings then styles that board), or a board.
// The theme follows the board you look at; a board without its own style looks like Main.
const boardById = (id) => (id ? cfg.boards.find((b) => b.id === id) || null : null);
const themeFor = (b) => (b && b.theme) || cfg.theme;
function viewUi(kind, id = null) {
  const viewing = kind === 'board' ? boardById(id) : boardById(cfg.view);
  const theme = themeFor(viewing);
  return {
    view: kind, boardView: cfg.view, hiddenByAll: cfg.hiddenByAll.length,
    board: viewing ? { id: viewing.id, name: viewing.name, inside: viewing.inside, ownTheme: !!viewing.theme, stuck: !!viewing.stuck,
      icon: viewing.icon, dock: viewing.dock, fresh: viewing.fresh } : null,
    boards: cfg.boards.map((b) => ({ id: b.id, name: b.name, icon: b.icon, inside: b.inside, dock: b.dock,
      visible: b.inside ? cfg.view === b.id : b.visible && !cfg.panelsHidden, theme: themeFor(b) })),
    theme, mode: Themes.resolveMode(theme, nativeTheme.shouldUseDarkColors),
    canUndoTheme: !viewing && cfg.themeUndo.length > 0, recentThemes: viewing ? [] : cfg.recentThemes,
  };
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
  if (BG) return;
  if (!Notification.isSupported()) return;
  const t = new Notification({ title: n.title, body: n.body, silent: true, icon: chickIcon(null, 64) }); // the panel plays its own chime
  t.on('click', () => {
    if (n.hostId && HOST_ID_RE.test(n.hostId)) shell.openExternal(`claude://code/continue?session=${n.hostId}&source=agentdeck`);
    revealWindow();
  });
  t.on('show', () => log('toast shown', n.kind));
  t.on('failed', (_e, err) => log('toast failed', String(err)));
  keepToast(t);
  t.show();
  log('toast', n.kind);
}

// A toast stays clickable in Windows' notification center long after it leaves the screen, and a click calls back
// into its Notification object. So it stays alive until Flocklet closes it itself (a freed one crashed Flocklet when
// an old toast was clicked: 0xc000041d, 2026-11-24). Past TOAST_KEEP the oldest is closed, which also takes it out of
// the notification center; at quit all are closed, and at start old ones from earlier runs are cleared.
const TOAST_KEEP = 30;
function keepToast(t) {
  toasts.add(t);
  while (toasts.size > TOAST_KEEP) {
    const old = toasts.values().next().value;
    toasts.delete(old);
    try { old.close(); } catch { /* already gone */ }
  }
}
function closeToasts() {
  for (const t of toasts) { try { t.close(); } catch { /* already gone */ } }
  toasts.clear();
}
// Toasts left in the notification center by an earlier run point at objects that no longer exist: clear them.
function clearOldToasts() {
  if (process.platform !== 'win32' || BG) return;
  const ps = '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; '
    + `[Windows.UI.Notifications.ToastNotificationManager]::History.Clear('${AUMID}')`;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 20000 },
    (err) => log('old toasts', err ? `not cleared: ${String(err.message).split('\n')[0]}` : 'cleared'));
}

// Windows only shows toasts for an app with a Start-menu shortcut carrying its AppUserModelID.
// The installer makes that shortcut for the installed app; a copy run from source makes its own,
// "Flocklet (dev)", so the two never fight over one shortcut. Its file name is the toast sender name.
function ensureStartMenuShortcut() {
  if (process.platform !== 'win32' || INSTALLED || BG) return;
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

function hideForTests(w) {
  if (!BG) return;
  w.setOpacity(0);
  w.setIgnoreMouseEvents(true);
  w.setFocusable(false);
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const pos = onSomeScreen(cfg.pos) ? cfg.pos : { x: wa.x + wa.width - Math.round(cfg.width * Z()) - 12, y: wa.y + 12 };
  win = new BrowserWindow({
    x: pos.x, y: pos.y, width: Math.round(cfg.width * Z()), height: 90,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Flocklet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', spellcheck: false, backgroundThrottling: !BG,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hideForTests(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('moved', () => { // the deck's spot (moving the bare sidebar moves where the deck comes back)
    const [x, y] = win.getPosition();
    if (railOnlyRect) {
      const dx = x - railOnlyRect.x, dy = y - railOnlyRect.y;
      railOnlyRect = { ...railOnlyRect, x, y };
      if (deck) deck = { ...deck, x: deck.x + dx, y: deck.y + dy };
      if (cfg.pos) cfg.pos = { x: cfg.pos.x + dx, y: cfg.pos.y + dy };
    } else cfg.pos = { x: x + off.x, y: y + off.y };
    saveConfig();
  });
  win.on('move', followMain); // boards stuck to Main move with it
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('session-end', cleanup); // Windows log off / shutdown
  win.on('show', () => { rebuildTrayMenu(); syncBoards(); }); // the tray menu says Minimise or Restore
  win.on('hide', () => { rebuildTrayMenu(); syncBoards(); }); // stuck boards hide with Main
  win.once('ready-to-show', revealWindow);
  win.webContents.once('did-finish-load', () => setTimeout(() => { if (!win.isVisible()) revealWindow(); }, 500));
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(Z()));
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
  tray.setToolTip(`${DEV ? 'Flocklet (dev)' : 'Flocklet'}: ${parts.join(' · ') || 'all quiet'}`);
}

function rebuildTrayMenu() {
  if (!tray) return;
  const pending = updates.ready();
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(pending ? [{ label: `Restart to update to ${pending}`, click: () => updates.install() }, { type: 'separator' }] : []),
    { label: win && win.isVisible() ? 'Minimise to tray' : 'Restore Flocklet', accelerator: HOTKEY, registerAccelerator: false, click: toggleWindow },
    { label: 'View', submenu: [
      { label: 'Panel', type: 'radio', checked: !!cfg && !cfg.dock && !cfg.collapsed, click: () => setView({ dock: false, collapsed: false }) },
      { label: 'Minimised bar', type: 'radio', checked: !!cfg && !cfg.dock && cfg.collapsed, click: () => setView({ dock: false, collapsed: true }) },
      { label: 'Pet dock', type: 'radio', checked: !!cfg && cfg.dock, click: () => setView({ dock: true }) },
    ] },
    { type: 'separator' },
    { label: hooks.ok ? 'Live updates: on' : hooks.blocked ? 'Live updates: off (Claude Code skips hooks here)' : `Live updates: off (${hooks.error})`, enabled: false },
    { label: 'Notifications', type: 'checkbox', checked: !!(cfg && cfg.notify),
      click: (mi) => { cfg.notify = mi.checked; saveConfig(); } },
    { label: 'Reconnect to Claude Code', click: ensureHooks, enabled: !!server },
    { type: 'separator' },
    { label: 'Theme', submenu: themeMenu() },
    { label: 'Show the tour', click: () => openTour(true) },
    { label: 'Start with Windows', type: 'checkbox', checked: !!(cfg && cfg.startup), enabled: INSTALLED,
      click: (mi) => { Release.setStartup(app, cfg, mi.checked); saveConfig(); pushState(); } },
    { label: 'Check for updates', click: () => updates.check(), visible: updates.enabled },
    { type: 'separator' },
    { label: `Flocklet ${app.getVersion()}${INSTALLED ? '' : ' (from source)'}`, enabled: false },
    { label: 'Quit Flocklet', click: () => app.quit() },
  ]));
}

// ---------- tour (first run, "What's new" after an update, or on request) ----------
let tourWin = null;
function openTour(force) {
  const plan = Tour.pagesFor({ seen: cfg.tourSeen, current: app.getVersion(), forceTour: !!force });
  if (plan.mode === 'none') return;
  if (tourWin && !tourWin.isDestroyed()) { tourWin.show(); tourWin.focus(); return; }
  const area = screen.getDisplayMatching(win && !win.isDestroyed() ? win.getBounds() : screen.getPrimaryDisplay().bounds).workArea;
  const W = Math.min(px(640), area.width - 16), H = Math.min(px(580), area.height - 16); // page 640 × 580 at the chosen zoom
  tourWin = new BrowserWindow({
    x: Math.round(area.x + (area.width - W) / 2), y: Math.round(area.y + (area.height - H) / 2), width: W, height: H,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false, alwaysOnTop: true, show: false, title: 'Flocklet tour',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  tourWin.setAlwaysOnTop(true, 'screen-saver');
  hideForTests(tourWin);
  tourWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  tourWin.webContents.on('will-navigate', (e) => e.preventDefault());
  tourWin.once('ready-to-show', () => { if (BG) tourWin.showInactive(); else { tourWin.show(); tourWin.focus(); } });
  tourWin.on('closed', () => { tourWin = null; });
  tourWin.webContents.on('did-finish-load', () => tourWin && tourWin.webContents.setZoomFactor(Z()));
  tourWin.loadFile(path.join(__dirname, '..', 'renderer', 'tour.html'),
    { query: { mode: plan.mode, seen: cfg.tourSeen || '', version: app.getVersion() } });
  log('tour', { mode: plan.mode, pages: plan.pages.length });
}
// Finished, skipped or closed: don't show these pages again (a later version may add new ones).
ipcMain.on('tour:done', () => {
  cfg.tourSeen = app.getVersion();
  saveConfig();
  if (tourWin && !tourWin.isDestroyed()) tourWin.close();
});
ipcMain.on('ui:tour', () => openTour(true));

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
  if (BG) return;
  tray = new Tray(chickIcon());
  tray.on('click', toggleWindow);
  rebuildTrayMenu();
  updateTray();
}

// ---------- IPC from the overlay ----------
ipcMain.on('ui:ready', () => pushState());
// The overlay reports its content height; the window follows it, under your max height and the screen.
let contentHeight = 90; // screen pixels (the page reports page pixels; × zoom)
// The page is zoomed (Settings → Size). Stored sizes (width, height cap) are page pixels; the window is screen pixels.
const Z = () => (cfg && cfg.zoom) || 1;
const px = (v) => Math.round(v * Z());
let drag = null; // {edge, start} while you drag a grab strip
let dragWatchdog = null;
// The window = deck (the panel) + rail + open drawer. `deck` is where the panel sits on screen;
// `off` is where it sits inside the window (the rail and drawer open outward, so the deck stays still).
let deck = null;
let off = { x: 0, y: 0 };
const railSide = () => cfg.rail; // the sidebar is always there: beside the panel, the minimised bar and the pet dock
const drawerOpen = () => !cfg.panelsHidden && cfg.drawer != null;
// The Sessions / Settings card sits left or right of the deck (never above or below), on its own side.
const drawerSide = () => cfg.drawerSide || (cfg.rail === 'left' || cfg.rail === 'right' ? cfg.rail : 'right');
// A side rail grows with its board buttons (Main's tabs, + and the toggles for board windows).
// A side sidebar needs its own length (measured by the page, + the shell's margins), even beside a short dock.
const railMinH = () => Math.max(PanelSize.RAIL_MIN_H, Math.round(railLength) + 24);
let dockWidth = 200; // pet dock: the overlay measures its row
let dockAnchored = false; // the dock keeps its bottom edge still when a card pops up above it
// Minimised list snaps between two stops: stats only, or every deck session (no scroll bar).
let miniStops = { bar: 90, full: 90 }; // measured by the overlay
let miniDragging = false;

function deckNow() {
  const b = win.getBounds();
  return deck ? { ...deck, x: b.x + off.x, y: b.y + off.y } : { x: b.x, y: b.y, width: px(cfg.width), height: b.height };
}
// Place the window around a deck rect, kept on screen (the whole shell shifts if it would leave it).
function applyDeck(d) {
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  const r = PanelSize.shellRect(d, railSide(), drawerOpen(), cfg.railMin, Z(), drawerSide(), railMinH());
  // A sidebar above or below needs room for all its buttons: the window grows to the right (the deck stays put).
  if (cfg.rail === 'top' || cfg.rail === 'bottom') r.width = Math.max(r.width, px(Math.round(railLength) + 16));
  const x = Math.max(wa.x, Math.min(r.x, wa.x + wa.width - r.width));
  const y = Math.max(wa.y, Math.min(r.y, wa.y + wa.height - r.height));
  off = { x: r.offX, y: r.offY };
  deck = { x: x + r.offX, y: y + r.offY, width: d.width, height: d.height };
  const b = win.getBounds();
  if (b.x !== x || b.y !== y || b.width !== r.width || b.height !== r.height) win.setBounds({ x, y, width: r.width, height: r.height });
  followMain();
}
function extraY() { // what the rail and the card add above and below the deck
  const e = PanelSize.shellExtras(railSide(), drawerOpen(), cfg.railMin, Z(), drawerSide());
  return e.top + e.bottom;
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
  if (cfg.panelsHidden) { railOnly(); return; }
  railOnlyRect = null;
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
  const cap = cfg.collapsed || cfg.maxHeight == null ? null : px(cfg.maxHeight);
  const height = PanelSize.windowHeight(contentHeight, cap, wa.height - 24 - extraY());
  applyDeck({ ...deckNow(), width: px(cfg.width), height });
}
// Panels hidden: the window is just the sidebar, where it was beside the deck (the deck keeps its spot for later).
let railLength = 200; // page pixels, measured by the page
let railOnlyRect = null;
function railOnly() {
  const d = deck || deckNow();
  const m = px(8);
  const thick = px(PanelSize.RAIL) + 2 * m;
  const long = px(railLength) + px(24);
  let r;
  if (cfg.rail === 'left') r = { x: d.x - px(PanelSize.RAIL + PanelSize.GAP), y: d.y, width: thick, height: long };
  else if (cfg.rail === 'right') r = { x: d.x + d.width - px(10), y: d.y, width: thick, height: long };
  else if (cfg.rail === 'top') r = { x: d.x, y: d.y - px(PanelSize.RAIL + PanelSize.GAP), width: long, height: thick + px(8) };
  else r = { x: d.x, y: d.y + d.height - px(18), width: long, height: thick + px(8) };
  r = onScreen(r);
  railOnlyRect = r;
  const b = win.getBounds();
  if (b.x !== r.x || b.y !== r.y || b.width !== r.width || b.height !== r.height) win.setBounds(r);
}
function setPanelsHidden(on) {
  if (on && !cfg.panelsHidden) {
    cfg.panelsHidden = { boards: cfg.boards.filter((b) => !b.inside && b.visible).map((b) => b.id) };
  } else if (!on && cfg.panelsHidden) {
    cfg.panelsHidden = null;
  } else return;
  saveConfig();
  syncBoards();
  pushState();
  fitWindow();
}
ipcMain.on('ui:resize', (e, h, stops) => {
  const pane = paneOf(e);
  if (pane.kind === 'board') {
    if (Number(h) > 0) pane.bw.contentHeight = px(Number(h));
    const dw = Number(stops && stops.dockW);
    if (dw > 0) pane.bw.dockWidth = px(dw);
    fitBoard(pane.bw);
    return;
  }
  if (pane.kind !== 'main') return;
  const rl = Number(stops && stops.rail);
  if (rl > 0) railLength = rl;
  if (Number(h) > 0) contentHeight = px(Number(h));
  const bar = Number(stops && stops.bar), full = Number(stops && stops.full);
  const dw = Number(stops && stops.dockW);
  if (dw > 0) dockWidth = px(dw);
  if (bar > 0 && full >= bar) miniStops = { bar: px(bar), full: px(full) };
  fitWindow();
});

// Grab strips: phase start / move (dx, dy since start) / end / reset (double-click). They resize the deck.
ipcMain.on('ui:drag', (e, edge, phase, dx, dy) => {
  const pane = paneOf(e);
  if (pane.kind === 'board' && PanelSize.EDGES.includes(edge)) { boardDrag(pane.bw, edge, phase, dx, dy); return; }
  if (pane.kind !== 'main') return;
  if (!win || win.isDestroyed() || !PanelSize.EDGES.includes(edge) || cfg.dock) return; // the dock sizes itself
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  clearTimeout(dragWatchdog);
  if (phase === 'start') {
    const tall = edge.startsWith('bottom');
    const now = deckNow();
    // First stretch: fix the height at the current size, so the panel follows the pointer from here.
    if (tall && cfg.collapsed) { miniDragging = true; pushState(); } // show the rows while you drag
    if (tall && !cfg.collapsed && cfg.maxHeight == null) { cfg.maxHeight = Math.round(now.height / Z()); pushState(); }
    drag = { edge, start: { ...now, cap: cfg.collapsed ? null : cfg.maxHeight } };
    dragWatchdog = setTimeout(endDrag, 15e3);
  } else if (phase === 'move' && drag && drag.edge === edge) {
    dragWatchdog = setTimeout(endDrag, 15e3); // a lost release never leaves the window stuck
    const d = (v) => Math.max(-5000, Math.min(5000, Number(v) || 0));
    // Drag maths in page pixels (what the sizes are stored in), placed on screen × zoom.
    // dx/dy come from screenX/Y, which are screen pixels whatever the zoom.
    const z = Z();
    const s = drag.start;
    const r = PanelSize.dragTo({ x: 0, width: s.width / z, height: s.height / z, cap: s.cap }, edge, d(dx) / z, d(dy) / z,
      (wa.height - 24 - extraY()) / z);
    const tall = edge.startsWith('bottom');
    cfg.width = r.width;
    let height = s.height;
    if (tall && cfg.collapsed) height = Math.max(px(PanelSize.MINI_MIN), Math.min(s.height + d(dy), wa.height - 24));
    else if (tall) { cfg.maxHeight = r.cap; height = px(r.cap); }
    applyDeck({ x: Math.round(s.x + r.x * z), y: s.y, width: px(r.width), height });
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

ipcMain.on('ui:set', (e, patch) => {
  const pane = paneOf(e);
  const keys = ['muted', 'showIdle', 'notify', 'dockNames', 'dockGroupNames', 'settingsAdvanced', 'emotes'];
  if (pane.kind === 'main') keys.push('collapsed', 'dock'); // a board's own dock is ui:board 'dock'
  for (const k of keys) if (typeof patch?.[k] === 'boolean') cfg[k] = patch[k];
  if (typeof patch?.panelsHidden === 'boolean') setPanelsHidden(patch.panelsHidden);
  if ([0, 1, 2, 3].includes(patch?.glass)) cfg.glass = patch.glass;
  if (PanelSize.ZOOMS.includes(patch?.zoom) && patch.zoom !== cfg.zoom) {
    cfg.zoom = patch.zoom;
    for (const w of [win, tourWin, carryWin, ...[...boardWins.values()].map((bw) => bw.win)]) {
      if (w && !w.isDestroyed()) w.webContents.setZoomFactor(cfg.zoom);
    }
    for (const bw of boardWins.values()) fitBoard(bw);
  }
  if (typeof patch?.debug === 'boolean' && !DEV) { cfg.debug = patch.debug; log('debug log', cfg.debug ? 'on' : 'off'); }
  if (patch && ('dock' in patch || 'collapsed' in patch)) rebuildTrayMenu();
  if (patch && 'notify' in patch) rebuildTrayMenu();
  if (PanelSize.SIDES.includes(patch?.rail)) cfg.rail = patch.rail;
  if (['left', 'right'].includes(patch?.drawerSide)) cfg.drawerSide = patch.drawerSide;
  if (typeof patch?.startup === 'boolean') { Release.setStartup(app, cfg, patch.startup); rebuildTrayMenu(); }
  if (patch && 'drawer' in patch && (patch.drawer === null || DRAWERS.includes(patch.drawer))) cfg.drawer = patch.drawer;
  if (Grouping.MODES.includes(patch?.groupBy)) cfg.groupBy = patch.groupBy;
  if (patch?.theme && typeof patch.theme === 'object') setTheme(patch.theme, { board: pane.kind === 'board' ? pane.id : cfg.view });
  saveConfig();
  pushState();
  fitWindow(); // rail side / drawer change the window around the deck
});

const sameTheme = (a, b) => a.palette === b.palette && a.look === b.look && a.mode === b.mode;
// Every style change can be undone, and the last few styles stay one click away.
function setTheme(partial, { undo = false, board = null } = {}) {
  const b = boardById(board);
  if (b) { // a board's own style (no undo list; "same as Main" resets it)
    const next = Themes.normalizeTheme({ ...themeFor(b), ...partial });
    if (b.theme && sameTheme(b.theme, next)) return;
    b.theme = next;
    saveConfig();
    pushState();
    return;
  }
  const prev = cfg.theme;
  const next = Themes.normalizeTheme({ ...cfg.theme, ...partial });
  if (sameTheme(prev, next)) return;
  if (!undo) cfg.themeUndo = [...cfg.themeUndo, prev].slice(-20);
  cfg.recentThemes = [prev, ...cfg.recentThemes.filter((t) => !sameTheme(t, prev))].filter((t) => !sameTheme(t, next)).slice(0, 5);
  cfg.theme = next;
  saveConfig();
  rebuildTrayMenu(); // keep the tray's radio marks in step with the panel picker
  pushState();
}
ipcMain.on('ui:undoTheme', () => {
  const prev = cfg.themeUndo.pop();
  if (prev) setTheme(prev, { undo: true });
});
ipcMain.on('ui:hide', (e) => {
  const pane = paneOf(e);
  if (pane.kind === 'board') boardOp({ op: 'hide', id: pane.id });
  else if (win) win.hide();
});
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
// Drag and drop: one section's cards in their new order, the project folders, or your groups (renderer/carry.js).
ipcMain.on('ui:order', (_e, op) => {
  if (!op || typeof op !== 'object') return;
  if (op.reset === true) { cfg.order = []; cfg.folderOrder = []; }
  if (Array.isArray(op.cards) && op.cards.length <= 500 && op.cards.every((k) => typeof k === 'string' && KEY_RE.test(k))) {
    cfg.order = Grouping.placeBlock(cfg.order, [...new Set(op.cards)]).slice(0, 2000);
  }
  if (Array.isArray(op.folders) && op.folders.length <= 200 && op.folders.every((k) => typeof k === 'string' && k.length <= 400)) {
    cfg.folderOrder = [...new Set(op.folders)];
  }
  if (Array.isArray(op.groups)) {
    const byId = new Map(cfg.groups.map((g) => [g.id, g]));
    const ids = [...new Set(op.groups.filter((id) => byId.has(id)))];
    cfg.groups = [...ids.map((id) => byId.get(id)), ...cfg.groups.filter((g) => !ids.includes(g.id))];
  }
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
ipcMain.on('ui:checkUpdates', () => updates.check());
// Dev copy tests only (with FLOCKLET_FAKE): move a board window as if you had dragged it there and let go.
if (FAKE) ipcMain.on('test:op', (_e, op) => {
  const bw = op && boardWins.get(op.id);
  if (op && op.op === 'moveBoard' && bw && !bw.win.isDestroyed()) { bw.win.setPosition(Math.round(op.x), Math.round(op.y)); boardMoved(bw); }
  const fc = op && op.op === 'fakeState' && FAKE.find((x) => x.key === op.key);
  if (fc && ['working', 'waiting', 'done', 'error', 'idle'].includes(op.state)) { fc.state = op.state; fc.at = Date.now(); pushState(); }
});

// Right-click on a session in a window too small for Flocklet's own menu (a dock): the same choices, Windows' menu.
ipcMain.on('ui:sessionMenu', (e, key) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const c = (lastCards || []).find((x) => x.key === key);
  if (!w || !c) return;
  const send = (ch, ...args) => () => ipcMain.emit(ch, { sender: e.sender }, ...args);
  const here = c.board || null;
  const items = [
    { label: c.name, enabled: false },
    { type: 'separator' },
    c.canJump && { label: 'Open in Claude', click: send('ui:jump', c.hostId) },
    { label: c.pinned ? 'Unpin' : 'Pin: keep this card', click: send('ui:pin', c.key, !c.pinned) },
    c.group === 'active' && !c.pinned && { label: 'Hide this card', click: send('ui:hideCard', c.id) },
    { label: c.quiet ? 'Turn notifications on' : 'Mute notifications', click: send('ui:quiet', c.key, !c.quiet) },
    { type: 'separator' },
    { label: 'Move to', submenu: [
      ...[{ id: null, name: 'Main' }, ...cfg.boards].filter((b) => b.id !== here)
        .map((b) => ({ label: b.name, click: () => boardOp({ op: 'move', id: b.id, items: { keys: [c.key], name: c.name } }) })),
      { type: 'separator' },
      { label: 'A new board', click: () => boardOp({ op: 'new', items: { keys: [c.key], name: c.name } }) },
    ] },
  ].filter(Boolean);
  Menu.buildFromTemplate(items).popup({ window: w });
});

// Your own name for a project (its folder name until you rename it; an empty name goes back to the folder's).
ipcMain.on('ui:projectName', (_e, key, name) => {
  if (typeof key !== 'string' || key.length > 400) return;
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
  if (n) cfg.projectNames[key] = n; else delete cfg.projectNames[key];
  saveConfig();
  pushState();
});

// A crash dump left by the last run: say so in the log (where it is and when), for a bug report.
function noteLastCrash() {
  try {
    const dir = path.join(app.getPath('crashDumps'), 'reports');
    const dumps = fs.readdirSync(dir).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    if (dumps.length && Date.now() - dumps[0].t < 7 * 864e5) log('crash dump', { file: dumps[0].f, at: new Date(dumps[0].t).toISOString(), count: dumps.length });
  } catch { /* none */ }
}

// ---------- windows beside Main: boards, Settings, the carried pet ----------
// They share the overlay page (renderer/index.html): ?board=<id>, ?view=settings, ?view=carry.
function paneWindow({ x, y, width, height, title, query }) {
  const w = new BrowserWindow({
    x, y, width, height, title,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: !BG,
    },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hideForTests(w);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (ev) => ev.preventDefault());
  w.webContents.on('did-finish-load', () => { if (!w.isDestroyed()) w.webContents.setZoomFactor(Z()); pushState(); });
  w.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query });
  return w;
}
const mainShown = () => !!win && !win.isDestroyed() && win.isVisible();
function paneOf(e) {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return { kind: 'none' };
  if (w === win) return { kind: 'main' };
  for (const bw of boardWins.values()) if (bw.win === w) return { kind: 'board', bw, id: bw.id };
  return { kind: 'none' };
}
function onScreen(r) { // keep a window's rect on the screen it is on
  const wa = screen.getDisplayMatching(r).workArea;
  return { ...r, x: Math.max(wa.x, Math.min(r.x, wa.x + wa.width - r.width)), y: Math.max(wa.y, Math.min(r.y, wa.y + wa.height - r.height)) };
}

// ---- boards: each floating board is its own window; inside boards show on Main's card ----
const boardWins = new Map(); // board id -> { win, id, contentHeight, want, loaded, drag, placing }
function syncBoards() {
  if (!cfg) return;
  for (const [id, bw] of boardWins) {
    const b = boardById(id);
    if (b && !b.inside) continue;
    boardWins.delete(id);
    bw.closing = true;
    if (!bw.win.isDestroyed()) bw.win.destroy();
  }
  for (const b of cfg.boards) {
    if (b.inside) continue;
    const want = b.visible && mainShown() && !cfg.panelsHidden; // minimise and "hide panels" hide every board
    let bw = boardWins.get(b.id);
    if (!bw && !want) continue;
    if (!bw) bw = openBoard(b);
    bw.want = want;
    if (want && bw.loaded && !bw.win.isVisible()) { placeBoard(bw); bw.win.showInactive(); bw.win.setAlwaysOnTop(true, 'screen-saver'); }
    if (want && bw.loaded && b.fresh && !BG) bw.win.focus(); // just made: you can type its name right away
    if (!want && bw.win.isVisible()) bw.win.hide();
  }
}
function openBoard(b) {
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  const pos = onScreen({ ...(b.pos || { x: wa.x + 40, y: wa.y + 40 }), width: px(b.width), height: px(140) }); // dropped past the edge: pulled back on
  const w = paneWindow({ x: pos.x, y: pos.y, width: px(b.width), height: px(140), title: b.name, query: { board: b.id } });
  const bw = { win: w, id: b.id, contentHeight: px(140), dockWidth: px(240), want: true, loaded: false, drag: null, placing: false, closing: false };
  w.once('ready-to-show', () => {
    bw.loaded = true;
    placeBoard(bw);
    if (bw.want) { w.showInactive(); w.setAlwaysOnTop(true, 'screen-saver'); if (b.fresh && !BG) w.focus(); }
  });
  w.on('moved', () => boardMoved(bw));
  w.on('close', (ev) => { // closing a board window hides the board (its sidebar button brings it back)
    if (quitting || bw.closing) return;
    ev.preventDefault();
    boardOp({ op: 'hide', id: bw.id });
  });
  boardWins.set(b.id, bw);
  return bw;
}
// Put a board where it belongs: next to Main if it is stuck, else where you left it (kept on screen).
// The window a board is stuck to: Main's, or another board's (while it shows).
function stuckTarget(b) {
  if (!b.stuck) return null;
  if (b.stuck.to === 'main') return mainShown() ? win.getBounds() : null;
  const t = boardWins.get(b.stuck.to);
  return t && !t.win.isDestroyed() && t.win.isVisible() ? t.win.getBounds() : null;
}
function boardWidth(bw, b) { return b.dock ? Math.max(px(120), bw.dockWidth || px(240)) : px(b.width); }
function placeBoard(bw, height = null, depth = 0) {
  const b = boardById(bw.id);
  if (!b || bw.win.isDestroyed()) return;
  const cur = bw.win.getBounds();
  const size = { width: boardWidth(bw, b), height: height || cur.height };
  let r = { x: cur.x, y: cur.y, ...size };
  const t = stuckTarget(b);
  if (t) r = { ...r, ...Boards.stuckPos(t, size, b.stuck) };
  else r = onScreen(r);
  b.pos = { x: r.x, y: r.y };
  if (cur.x !== r.x || cur.y !== r.y || cur.width !== r.width || cur.height !== r.height) {
    bw.placing = true;
    bw.win.setBounds(r);
    bw.placing = false;
  }
  if (depth < 8) follow(b.id, depth + 1); // boards stuck to this one come along
}
function follow(id, depth = 0) {
  for (const bw of boardWins.values()) { const b = boardById(bw.id); if (b && b.stuck && b.stuck.to === id) placeBoard(bw, null, depth); }
}
function followMain() { follow('main'); }
// You let go of a board you moved: near Main's edge it sticks (magnet), anywhere else it floats free.
// You let go of a board you moved. Over Main it goes in (it folds into its new tab in the sidebar). Near Main's or
// another board's edge it sticks (magnet); side by side with a board it joins it and takes its type (a dock next
// to a dock, a card next to a card), stacked above or below it stays itself. Anywhere else it floats free.
function boardMoved(bw) {
  const b = boardById(bw.id);
  if (!b || bw.placing || bw.win.isDestroyed()) return;
  const r = bw.win.getBounds();
  const mid = { x: r.x + r.width / 2, y: r.y + px(20) }; // where you held it: its header
  if (mainShown() && contains(visibleRect(win), mid)) {
    if (!bw.win.isDestroyed()) bw.win.webContents.send('fx', 'into-main'); // the board folds away, then goes in
    setTimeout(() => boardOp({ op: 'inside', id: b.id }), 280); // (the page skips the animation under reduce motion)
    return;
  }
  const chain = new Set([b.id, ...[...cfg.boards].filter((x) => Boards.stuckChain(cfg.boards, x.id).has(b.id)).map((x) => x.id)]);
  const targets = [];
  if (mainShown()) targets.push({ id: 'main', rect: win.getBounds() });
  for (const o of boardWins.values()) {
    if (chain.has(o.id) || o.win.isDestroyed() || !o.win.isVisible()) continue;
    targets.push({ id: o.id, rect: o.win.getBounds() });
  }
  b.stuck = Boards.snapBest(r, targets, px(28));
  const onto = b.stuck && b.stuck.to !== 'main' && (b.stuck.side === 'left' || b.stuck.side === 'right') ? boardById(b.stuck.to) : null;
  if (onto && onto.dock !== b.dock) b.dock = onto.dock; // joined side by side: same type as the one it lands on
  if (b.stuck) placeBoard(bw); else { b.pos = { x: r.x, y: r.y }; follow(b.id); }
  saveConfig();
  pushState();
}
function fitBoard(bw) {
  const b = boardById(bw.id);
  if (!b || bw.win.isDestroyed() || bw.drag) return;
  const wa = screen.getDisplayMatching(bw.win.getBounds()).workArea;
  const cap = b.dock ? null : b.maxHeight != null ? px(b.maxHeight) : null;
  placeBoard(bw, PanelSize.windowHeight(bw.contentHeight, cap, wa.height - 24));
}
// Grab strips on a board: width and max height, like Main's.
function boardDrag(bw, edge, phase, dx, dy) {
  const b = boardById(bw.id);
  if (!b) return;
  const z = Z();
  if (phase === 'start') {
    const now = bw.win.getBounds();
    if (edge.startsWith('bottom') && b.maxHeight == null) b.maxHeight = Math.round(now.height / z);
    bw.drag = { edge, start: { ...now, cap: b.maxHeight } };
  } else if (phase === 'move' && bw.drag) {
    const s = bw.drag.start;
    const wa = screen.getDisplayMatching(s).workArea;
    const d = (v) => Math.max(-5000, Math.min(5000, Number(v) || 0));
    const r = PanelSize.dragTo({ x: 0, width: s.width / z, height: s.height / z, cap: s.cap }, edge, d(dx) / z, d(dy) / z, (wa.height - 24) / z);
    b.width = r.width;
    if (edge.startsWith('bottom')) b.maxHeight = r.cap;
    bw.placing = true;
    bw.win.setBounds({ x: Math.round(s.x + r.x * z), y: s.y, width: px(r.width), height: edge.startsWith('bottom') ? px(r.cap) : s.height });
    bw.placing = false;
  } else if (phase === 'end' && bw.drag) {
    bw.drag = null;
    saveConfig();
    pushState();
    fitBoard(bw);
  } else if (phase === 'reset') {
    bw.drag = null;
    if (edge.startsWith('bottom')) b.maxHeight = null;
    if (edge !== 'bottom') b.width = Boards.DEFAULT_W;
    saveConfig();
    pushState();
    fitBoard(bw);
  }
}

// A board you moved the last of its sessions out of (onto another board or Main) vanishes; Main never does.
// An empty board you just made with + stays (it only goes when something leaves it empty).
const contentNow = () => Boards.withContent(cfg.boards, Boards.place(lastCards || [], cfg));
function dropEmptied(before) {
  const after = contentNow();
  for (const id of before) if (!after.has(id) && boardById(id)) vanishBoard(id);
}
function vanishBoard(id) {
  log('board', { emptied: id });
  const bw = boardWins.get(id);
  if (bw && !bw.win.isDestroyed() && bw.win.isVisible()) { // its window shrinks away first
    bw.win.webContents.send('fx', 'vanish');
    setTimeout(() => { if (!boardById(id)) return; Boards.removeBoard(cfg, id); saveConfig(); syncBoards(); pushState(); fitWindow(); }, 240);
    return;
  }
  Boards.removeBoard(cfg, id);
}
function boardOp(op) {
  if (!op || typeof op !== 'object') return;
  const b = boardById(op.id);
  const before = op.op === 'move' || op.op === 'new' ? contentNow() : null;
  switch (op.op) {
    case 'rename': if (!b) return; b.name = Boards.cleanName(op.name, b.name); break;
    case 'theme': if (!b) return; b.theme = op.theme && typeof op.theme === 'object' ? Themes.normalizeTheme(op.theme) : null; break;
    case 'toggle': // its sidebar button: show or hide it (on Main's card, or its own window)
      if (!b) return;
      if (b.inside) cfg.view = cfg.view === b.id ? null : b.id;
      else b.visible = !b.visible;
      break;
    case 'view': cfg.view = b && b.inside ? b.id : null; break;
    case 'hide': if (!b) return; if (b.inside) { if (cfg.view === b.id) cfg.view = null; } else b.visible = false; break;
    case 'inside': if (!b) return; b.inside = true; b.stuck = null; cfg.view = b.id; break;
    case 'popout': // out of Main's card into its own window, stuck to Main's side
      if (!b) return;
      b.inside = false;
      b.visible = true;
      if (cfg.view === b.id) cfg.view = null;
      if (mainShown()) { // the side of Main with room for it
        const m = win.getBounds();
        const wa = screen.getDisplayMatching(m).workArea;
        b.stuck = { to: 'main', side: m.x + m.width + px(b.width) <= wa.x + wa.width ? 'right' : 'left', along: 0 };
      } else b.stuck = null;
      break;
    case 'unstick': if (!b) return; b.stuck = null; break;
    case 'dock': if (!b) return; b.dock = op.on === true; break; // its pet dock
    case 'icon': if (!b) return; b.icon = Boards.ICONS.includes(op.icon) ? op.icon : null; break;
    case 'seen': if (!b) return; b.fresh = false; break;
    case 'new': { // a new board on Main's card (its "+"), maybe with what you dropped on the +
      const id = `b_${crypto.randomBytes(4).toString('hex')}`;
      const items = cleanItems(op.items);
      const n = Boards.addBoard(cfg, { id, name: items ? boardNameFor(items) : `Board ${cfg.boards.length + 1}`, items });
      if (!n) return;
      n.inside = true;
      n.fresh = !items || /^Board \d+$/.test(n.name);
      cfg.view = n.id;
      break;
    }
    case 'move': { // dropped on a tab or a toggle in the sidebar
      const items = cleanItems(op.items);
      if (!items) return;
      Boards.moveTo(cfg, items, b ? b.id : null);
      break;
    }
    case 'delete': if (!b) return; Boards.removeBoard(cfg, b.id); break;
    case 'hideAll': Boards.hideAll(cfg); break;
    case 'restore': Boards.restoreHidden(cfg); break;
    case 'showAll': Boards.showAll(cfg); break;
    default: return;
  }
  if (before) dropEmptied(before);
  saveConfig();
  syncBoards();
  pushState();
  fitWindow();
}
ipcMain.on('ui:board', (_e, op) => boardOp(op));
// A tab or toggle dragged out of the window: the board gets a window of its own right there (unstuck),
// or, dropped on Main, it lives on Main's card.
function placeBoardAt(b, p, target) {
  if (target.key === 'main') { b.inside = true; b.stuck = null; cfg.view = b.id; return; }
  if (target.key !== 'new') return;
  const size = { width: px(b.width), height: px(160) };
  if (cfg.view === b.id) cfg.view = null;
  b.inside = false;
  b.visible = true;
  b.pos = { x: p.x - px(70), y: p.y - px(22) };
  b.stuck = mainShown() ? Boards.snapTo({ ...b.pos, ...size }, win.getBounds(), px(28)) : null;
  if (b.stuck) b.stuck = { to: 'main', ...b.stuck };
  const bw = boardWins.get(b.id);
  if (bw && !bw.win.isDestroyed()) { bw.placing = true; bw.win.setPosition(b.pos.x, b.pos.y); bw.placing = false; }
}
// Right-click a board's sidebar button (or its ⋯): what you can do with it. No id: every board at once.
ipcMain.on('ui:boardMenu', (e, id) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  const b = boardById(id);
  const go = (op) => () => boardOp({ ...op, id: b ? b.id : null });
  const items = b ? [
    { label: b.inside ? (cfg.view === b.id ? 'Back to Main' : 'Show on Main') : b.visible ? 'Hide' : 'Show', click: go({ op: 'toggle' }) },
    b.inside ? { label: 'Pop out into its own window', click: go({ op: 'popout' }) } : { label: 'Put inside Main', click: go({ op: 'inside' }) },
    !b.inside && { label: b.dock ? 'Show as cards' : 'Show as pet dock', click: go({ op: 'dock', on: !b.dock }) },
    !b.inside && b.stuck && { label: 'Unstick', click: go({ op: 'unstick' }) },
    { label: 'Same style as Main', type: 'checkbox', checked: !b.theme, click: go({ op: 'theme', theme: b.theme ? null : cfg.theme }) },
    { type: 'separator' },
    { label: 'Delete board (its sessions go back to Main)', click: go({ op: 'delete' }) },
  ].filter(Boolean) : [
    { label: 'Hide all boards', enabled: cfg.boards.some((x) => (x.inside ? cfg.view === x.id : x.visible)), click: go({ op: 'hideAll' }) },
    { label: 'Bring back the ones you hid', enabled: cfg.hiddenByAll.length > 0, click: go({ op: 'restore' }) },
    { label: 'Show all boards', enabled: cfg.boards.some((x) => !x.inside && !x.visible), click: go({ op: 'showAll' }) },
  ];
  Menu.buildFromTemplate(items).popup({ window: w });
});

// ---- the carried pet: drag something out of a window and its pet follows the pointer across the screen ----
// The page that started the drag keeps the pointer (it holds the capture) and sends its screen position:
// 'out' when it leaves the page, 'move', 'in' when it comes back, 'drop' when you let go. Main moves this little
// click-through window with it and finds what is under it.
let carryWin = null;
let carryLoaded = false;
let carry = null; // { info, out, hover }
const CARRY_W = 180, CARRY_H = 150; // page pixels
function ensureCarryWin() {
  if (carryWin && !carryWin.isDestroyed()) return;
  carryLoaded = false;
  carryWin = paneWindow({ x: -4000, y: -4000, width: px(CARRY_W), height: px(CARRY_H), title: 'Flocklet carry', query: { view: 'carry' } });
  carryWin.setIgnoreMouseEvents(true);
  carryWin.setFocusable(false);
  carryWin.webContents.once('did-finish-load', () => { carryLoaded = true; if (carry) carryWin.webContents.send('carry', { op: 'set', info: carry.info }); });
}
function visibleRect(w) { // a window without its transparent margins (8 px, 16 below)
  const r = w.getBounds();
  return { x: r.x + px(8), y: r.y + px(8), width: r.width - px(16), height: r.height - px(24) };
}
const contains = (r, p) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
function dropTarget(p) {
  const over = (w) => w && !w.isDestroyed() && w.isVisible() && contains(visibleRect(w), p);
  for (const bw of boardWins.values()) if (over(bw.win)) return { key: bw.id, win: bw.win, board: bw.id };
  if (over(win)) return { key: 'main', win, board: cfg.view };
  return { key: 'new' };
}
function setHover(t) {
  const key = t ? t.key : null;
  if (!carry || carry.hover === key) return;
  const all = [win, ...[...boardWins.values()].map((bw) => bw.win)];
  for (const w of all) if (w && !w.isDestroyed()) w.webContents.send('dropzone', !!(t && t.win === w));
  carry.hover = key;
}
const pointOf = (op) => ({ x: Math.round(Math.max(-1e5, Math.min(1e5, Number(op.x) || 0))), y: Math.round(Math.max(-1e5, Math.min(1e5, Number(op.y) || 0))) });
function carryTick(p) {
  if (!carry || !carry.out || !carryWin || carryWin.isDestroyed()) return;
  carryWin.setPosition(Math.round(p.x - px(CARRY_W) / 2), Math.round(p.y - px(12)));
  setHover(dropTarget(p));
}
function stopFollow() {
  if (!carry) return;
  carry.out = false;
  setHover(null);
}
const cleanCarryInfo = (i) => ({
  pets: (Array.isArray(i?.pets) ? i.pets : []).slice(0, 3).map((x) => ({ kind: Pets.PETS.includes(x?.kind) ? x.kind : 'chick', slot: Number.isInteger(x?.slot) && x.slot >= 1 && x.slot <= 6 ? x.slot : 1 })),
  badge: typeof i?.badge === 'string' ? i.badge.slice(0, 6) : '',
  label: typeof i?.label === 'string' ? i.label.slice(0, 40) : '',
  theme: Themes.normalizeTheme(i?.theme || cfg.theme),
  mode: i?.mode === 'light' ? 'light' : 'dark',
  square: i?.square && typeof i.square === 'object' ? { // a whole board being carried: its square
    letter: String(i.square.letter || 'B').slice(0, 1),
    bg: /^#[0-9a-f]{3,8}$/i.test(i.square.bg) ? i.square.bg : '#333333',
    acc: /^#[0-9a-f]{3,8}$/i.test(i.square.acc) ? i.square.acc : '#888888',
  } : null,
});
function cleanItems(it) {
  if (!it || typeof it !== 'object') return null;
  const keys = Array.isArray(it.keys) ? [...new Set(it.keys.filter((k) => typeof k === 'string' && KEY_RE.test(k)))].slice(0, 300) : [];
  const out = { keys, name: Boards.cleanName(it.name, 'Board') };
  if (typeof it.project === 'string' && it.project.length <= 400) out.project = it.project;
  if (typeof it.group === 'string' && cfg.groups.some((g) => g.id === it.group)) out.group = it.group;
  return keys.length || out.project != null || out.group != null ? out : null;
}
// Let go: on a board or Main, it moves there; on the empty desktop it becomes a new board right there.
// A new board's name: a single session's own name, or for a project / group your name for it if you gave one;
// else "Board N" (and its name field opens). Folder names are not used on their own.
function boardNameFor(items) {
  if (items.project != null) return cfg.projectNames[items.project] || `Board ${cfg.boards.length + 1}`;
  if (items.group != null) return (cfg.groups.find((g) => g.id === items.group) || {}).name || `Board ${cfg.boards.length + 1}`;
  return items.name;
}
// Everything a board holds, dragged out of it (no rule left, no other session on it)?
function wholeBoard(src, items) {
  if (!src || src.inside) return false;
  if (src.projects.some((x) => x !== items.project) || src.groups.some((x) => x !== items.group)) return false;
  const rest = (lastCards || []).filter((c) => c.board === src.id && !items.keys.includes(c.key));
  return rest.length === 0;
}
function carryDrop(items, p, from = null) {
  const t = dropTarget(p);
  const before = contentNow();
  if (t.key === 'none') { pushState(); return; } // on Settings: nothing moves
  const src = boardById(from);
  if (t.key === 'new' && wholeBoard(src, items)) { // the board itself moves there (no empty twin left behind)
    placeBoardAt(src, p, t);
    log('board', { moved: src.id });
    saveConfig();
    syncBoards();
    pushState();
    return;
  }
  if (t.key === 'new') {
    const id = `b_${crypto.randomBytes(4).toString('hex')}`;
    const b = Boards.addBoard(cfg, { id, name: boardNameFor(items), pos: { x: p.x - px(70), y: p.y - px(22) }, items });
    if (!b) return;
    b.fresh = /^Board \d+$/.test(b.name);
    dropEmptied(before);
    const size = { width: px(b.width), height: px(160) };
    b.stuck = mainShown() ? Boards.snapTo({ ...b.pos, ...size }, win.getBounds(), px(28)) : null;
    if (b.stuck) b.stuck = { to: 'main', ...b.stuck };
    log('board', { made: id, from: items.project != null ? 'project' : items.group != null ? 'group' : `${items.keys.length} sessions` });
  } else {
    Boards.moveTo(cfg, items, t.board);
    dropEmptied(before);
  }
  saveConfig();
  syncBoards();
  pushState();
}
ipcMain.on('ui:carry', (e, op) => {
  if (!op || typeof op !== 'object') return;
  if (op.op === 'start') {
    ensureCarryWin();
    if (carry) stopFollow();
    carry = { info: cleanCarryInfo(op.info), out: false, hover: null };
    if (carryLoaded) carryWin.webContents.send('carry', { op: 'set', info: carry.info });
    return;
  }
  if (!carry || !carryWin || carryWin.isDestroyed()) return;
  if (op.op === 'out') {
    carry.out = true;
    carryTick(pointOf(op));
    carryWin.showInactive();
    carryWin.setAlwaysOnTop(true, 'screen-saver');
  } else if (op.op === 'move') {
    carryTick(pointOf(op));
  } else if (op.op === 'in') {
    stopFollow();
    carryWin.hide();
  } else if (op.op === 'drop') {
    const p = pointOf(op);
    carryTick(p);
    stopFollow();
    const moving = typeof op.board === 'string' ? boardById(op.board) : null;
    if (moving) { // a whole board
      carryWin.webContents.send('carry', { op: 'land' });
      const w0 = carryWin;
      setTimeout(() => { if (!w0.isDestroyed() && !carry) w0.hide(); }, 320);
      carry = null;
      placeBoardAt(moving, p, dropTarget(p));
      saveConfig();
      syncBoards();
      pushState();
      fitWindow();
      return;
    }
    const items = cleanItems(op.items);
    carryWin.webContents.send('carry', { op: 'land' });
    const w = carryWin;
    setTimeout(() => { if (!w.isDestroyed() && !carry) w.hide(); }, 320);
    carry = null;
    if (items) carryDrop(items, p, typeof op.from === 'string' ? op.from : null); else pushState();
  } else if (op.op === 'cancel' || op.op === 'end') {
    stopFollow();
    carryWin.hide();
    carry = null;
  }
});

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock() || process.argv.includes('--quit')) {
  app.quit(); // --quit only closes a running copy; with none running it must not start one
} else {
  app.setAppUserModelId(AUMID);
  // Launching again shows the panel; launching with --quit closes the running copy cleanly.
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--quit')) app.quit(); else revealWindow();
  });
  app.on('window-all-closed', () => { /* tray app: keep running */ });
  // Anything that crashes or ends unexpectedly is written to the log (names and codes only).
  app.on('child-process-gone', (_e, d) => log('process gone', { type: d.type, reason: d.reason, exitCode: d.exitCode }));
  app.on('render-process-gone', (_e, _wc, d) => log('page gone', { reason: d.reason, exitCode: d.exitCode }));
  process.on('uncaughtException', (e) => log('error', String((e && e.stack) || e).split('\n').slice(0, 4).join(' | ')));
  app.on('before-quit', () => { quitting = true; closeToasts(); cleanup(); });
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
          dlog('hook', { e: ev.hook_event_name, tool: ev.tool_name || undefined, sid: String(ev.session_id || '').slice(0, 8),
            agent: ev.agent_id ? 'sub' : undefined, t: ev.notification_type || undefined });
          if (ev.hook_event_name === 'PermissionRequest' && ev.session_id) {
            store.applyHook(ev, { requestId: broker.hold(ev, reply) });
            return true; // answered later from the panel, or released when Claude moves on
          }
          store.applyHook(ev);
          if (ev.hook_event_name === 'Stop' || ev.hook_event_name === 'PostToolUse') setTimeout(() => refreshContext(ev.session_id), 300);
          return false;
        },
        onError: (e) => console.error('hook server', e),
      });
    } catch (e) {
      hooks = { ok: false, error: e.code === 'EADDRINUSE' ? `port ${PORT} is in use` : e.message };
    }

    log('start', { version: app.getVersion(), server: !!server, display: screen.getPrimaryDisplay().workArea, uptime: Math.round(os.uptime()) });
    noteLastCrash();
    createWindow();
    win.once('ready-to-show', () => syncBoards()); // boards as you left them
    createTray();
    ensureHooks();
    log('hooks', hooks);
    stopRegistry = watchRegistry(SESSIONS_DIR, (list) => store.applyRegistry(list));
    stopDesktop = watchDesktopSessions((list) => store.applyDesktop(list));
    if (!DEV && !globalShortcut.register(HOTKEY, toggleWindow)) console.warn(`hotkey ${HOTKEY} unavailable`);
    nativeTheme.on('updated', () => { if (cfg.theme.mode === 'windows') pushState(); });
    setInterval(pushState, 30e3); // re-ages readings and timers
    setInterval(() => refreshContext(), 15e3);
    setInterval(checkHookPolicy, 10 * 60e3); // a policy can change while Flocklet runs
    setTimeout(() => refreshContext(), 2000);
    ensureStartMenuShortcut();
    registerToastIdentity();
    clearOldToasts();
    setTimeout(() => openTour(false), 1500); // first start: the tour; after an update: only what is new
    updates = Release.initUpdates({ // installed app: "Update ready" dialog + notification + tray item
      app, dialog, log, getWindow: () => win, onReady: () => rebuildTrayMenu(),
      memo: { get: () => cfg.updateTried || null, set: (v) => { cfg.updateTried = v; saveConfig(); } },
      debug: () => cfg.debug, logFile: userFile('agentdeck.log'),
      notify: (title, body, onClick) => {
        if (!Notification.isSupported()) return;
        const t = new Notification({ title, body, icon: chickIcon(null, 64) });
        t.on('click', onClick);
        keepToast(t);
        t.show();
      },
    });
    rebuildTrayMenu();
    if (process.env.AGENTDECK_TEST_TOAST) {
      setTimeout(() => showToast({ kind: 'test', title: 'Flocklet test', body: 'If you can read this, notifications work.' }), 3000);
    }
  });
}
