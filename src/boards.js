// Boards (0.6, decided 2026-11-23): workspaces you make by dragging a group or a session out of the panel.
// Main is the default board (id null). A board holds projects and groups (rules: their sessions show on it)
// and single sessions you moved (cfg.sessionBoard, which beats the rules). A session is on one board only.
// Pure rules, kept apart from Electron so they can be tested.
const { folderKey } = require('../renderer/grouping');

const BOARD_RE = /^b_[0-9a-f]{8}$/;
const SIDES = ['left', 'right', 'top', 'bottom'];
const DEFAULT_W = 340;
const MAX_BOARDS = 24;
const clampW = (w) => Math.max(260, Math.min(640, Math.round(Number(w) || DEFAULT_W)));
const strings = (v, n, max = 400) => (Array.isArray(v) ? [...new Set(v.filter((s) => typeof s === 'string' && s.length <= max))].slice(0, n) : []);
const cleanName = (s, fallback = 'Board') => (typeof s === 'string' && s.trim() ? s.trim().replace(/\s+/g, ' ').slice(0, 40) : fallback);
const point = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: Math.round(p.x), y: Math.round(p.y) } : null);

function normalizeBoards(list, normalizeTheme = (t) => t) {
  return (Array.isArray(list) ? list : []).filter((b) => b && BOARD_RE.test(b.id)).slice(0, MAX_BOARDS).map((b) => ({
    id: b.id,
    name: cleanName(b.name),
    theme: b.theme && typeof b.theme === 'object' ? normalizeTheme(b.theme) : null, // null: same as Main
    projects: strings(b.projects, 50),
    groups: strings(b.groups, 50, 40),
    inside: b.inside === true, // shown on Main's card (its sidebar button), not in its own window
    visible: b.visible !== false,
    pos: point(b.pos),
    width: clampW(b.width),
    maxHeight: Number.isFinite(b.maxHeight) ? Math.max(160, Math.round(b.maxHeight)) : null,
    stuck: b.stuck && SIDES.includes(b.stuck.side) && Number.isFinite(b.stuck.along) ? { side: b.stuck.side, along: Math.round(b.stuck.along) } : null,
  }));
}

function normalizeSessionBoard(map, boards) {
  const ids = new Set(boards.map((b) => b.id));
  const out = {};
  if (map && typeof map === 'object') {
    for (const [k, v] of Object.entries(map)) if (/^[A-Za-z0-9_-]{1,80}$/.test(k) && (v === 'main' || ids.has(v))) out[k] = v;
  }
  return out;
}

// Where a session shows: your own move first, then its parent's board, then its group's, then its project's.
function place(cards, { boards = [], sessionBoard = {} } = {}) {
  const ids = new Set(boards.map((b) => b.id));
  const byHost = new Map(cards.filter((c) => c.hostId).map((c) => [c.hostId, c]));
  const memo = new Map();
  const rule = (c) => {
    const g = c.groupId && boards.find((b) => b.groups.includes(c.groupId));
    if (g) return g.id;
    const fk = folderKey(c.cwd);
    const p = boards.find((b) => b.projects.includes(fk));
    return p ? p.id : null;
  };
  const own = (c) => { const s = sessionBoard[c.key]; return s === 'main' ? 'main' : s && ids.has(s) ? s : undefined; };
  const of = (c, guard = 0) => {
    if (memo.has(c.key)) return memo.get(c.key);
    let where = own(c);
    if (where === undefined && c.parentHostId && guard < 10) {
      const parent = byHost.get(c.parentHostId);
      if (parent && parent.key !== c.key && own(parent) !== undefined) where = of(parent, guard + 1);
    }
    if (where === undefined) where = rule(c);
    const id = where === 'main' ? null : where;
    memo.set(c.key, id);
    return id;
  };
  return cards.map((c) => ({ ...c, board: of(c) }));
}

// Move what you dropped to a board (or Main, target null). items: { keys, project?, group? }.
// A whole project or group moves as a rule, so its new sessions follow; its cards drop their own moves.
// Single cards (a session and its children) are moved one by one.
function moveTo(cfg, items, target) {
  const tgt = target && cfg.boards.some((b) => b.id === target) ? target : null;
  const keys = (items.keys || []).filter((k) => typeof k === 'string');
  if (items.project != null || items.group != null) {
    for (const b of cfg.boards) {
      b.projects = b.projects.filter((p) => p !== items.project);
      b.groups = b.groups.filter((g) => g !== items.group);
    }
    const b = cfg.boards.find((x) => x.id === tgt);
    if (b && items.project != null) b.projects.push(items.project);
    if (b && items.group != null) b.groups.push(items.group);
    for (const k of keys) delete cfg.sessionBoard[k];
  } else {
    for (const k of keys) cfg.sessionBoard[k] = tgt || 'main';
  }
}

function addBoard(cfg, { id, name, pos, items }) {
  if (!BOARD_RE.test(id) || cfg.boards.length >= MAX_BOARDS) return null;
  const b = { id, name: cleanName(name), theme: null, projects: [], groups: [], inside: false, visible: true,
    pos: point(pos), width: DEFAULT_W, maxHeight: null, stuck: null };
  cfg.boards.push(b);
  if (items) moveTo(cfg, items, id);
  return b;
}

function removeBoard(cfg, id) {
  cfg.boards = cfg.boards.filter((b) => b.id !== id);
  for (const [k, v] of Object.entries(cfg.sessionBoard)) if (v === id) delete cfg.sessionBoard[k];
  cfg.hiddenByAll = (cfg.hiddenByAll || []).filter((x) => x !== id);
  if (cfg.view === id) cfg.view = null;
}

// ---- magnet: a board dropped near Main's edge sticks to it and moves with it ----
// a, m: window rects {x, y, width, height}. Returns the side of Main it sticks to and its offset along that side.
function snapTo(a, m, dist = 28) {
  const cands = [];
  const vOverlap = a.y < m.y + m.height && a.y + a.height > m.y;
  const hOverlap = a.x < m.x + m.width && a.x + a.width > m.x;
  if (vOverlap) {
    cands.push({ side: 'right', d: Math.abs(a.x - (m.x + m.width)) });
    cands.push({ side: 'left', d: Math.abs(a.x + a.width - m.x) });
  }
  if (hOverlap) {
    cands.push({ side: 'bottom', d: Math.abs(a.y - (m.y + m.height)) });
    cands.push({ side: 'top', d: Math.abs(a.y + a.height - m.y) });
  }
  const best = cands.filter((c) => c.d <= dist).sort((p, q) => p.d - q.d)[0];
  if (!best) return null;
  return { side: best.side, along: best.side === 'left' || best.side === 'right' ? a.y - m.y : a.x - m.x };
}
// Where a stuck board goes when Main moves or changes size.
function stuckPos(m, size, s) {
  if (s.side === 'right') return { x: m.x + m.width, y: m.y + s.along };
  if (s.side === 'left') return { x: m.x - size.width, y: m.y + s.along };
  if (s.side === 'bottom') return { x: m.x + s.along, y: m.y + m.height };
  return { x: m.x + s.along, y: m.y - size.height };
}

// "Hide all" remembers what it hid, so "bring them back" shows exactly those again.
function hideAll(cfg) {
  const ids = cfg.boards.filter((b) => !b.inside && b.visible).map((b) => b.id);
  for (const b of cfg.boards) if (!b.inside) b.visible = false;
  if (cfg.view) { ids.push(cfg.view); cfg.view = null; }
  if (ids.length) cfg.hiddenByAll = ids;
}
function restoreHidden(cfg) {
  for (const id of cfg.hiddenByAll || []) {
    const b = cfg.boards.find((x) => x.id === id);
    if (!b) continue;
    if (b.inside) cfg.view = b.id; else b.visible = true;
  }
  cfg.hiddenByAll = [];
}
function showAll(cfg) {
  for (const b of cfg.boards) if (!b.inside) b.visible = true;
  cfg.hiddenByAll = [];
}

module.exports = { BOARD_RE, DEFAULT_W, MAX_BOARDS, normalizeBoards, normalizeSessionBoard, place, moveTo, addBoard, removeBoard,
  snapTo, stuckPos, hideAll, restoreHidden, showAll, cleanName };
