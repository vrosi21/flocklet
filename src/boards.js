// Boards (0.6, decided 2026-11-23): workspaces you make by dragging a group or a session out of the panel.
// Main is the default board (id null). A board holds projects and groups (rules: their sessions show on it)
// and single sessions you moved (cfg.sessionBoard, which beats the rules). A session is on one board only.
// Pure rules, kept apart from Electron so they can be tested.
const { folderKey } = require('../renderer/grouping');

const BOARD_RE = /^b_[0-9a-f]{8}$/;
// Icons a board can have instead of its first letter (renderer/icons.js draws them).
const ICONS = ['home', 'star', 'heart', 'bolt', 'flask', 'book', 'code', 'brush', 'music', 'leaf', 'rocket', 'coffee', 'flag', 'box', 'globe', 'cap'];
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
    // stuck to Main (to: 'main') or to another board, on one of its sides (magnet)
    stuck: b.stuck && SIDES.includes(b.stuck.side) && Number.isFinite(b.stuck.along)
      ? { to: BOARD_RE.test(b.stuck.to) && b.stuck.to !== b.id ? b.stuck.to : 'main', side: b.stuck.side, along: Math.round(b.stuck.along) } : null,
    dock: b.dock === true, // shown as a pet dock, like Main's
    icon: ICONS.includes(b.icon) ? b.icon : null, // null: its first letter
    fresh: b.fresh === true, // just made: its name field opens so you can name it
  })).map((b, _i, all) => (b.stuck && b.stuck.to !== 'main' && !all.some((x) => x.id === b.stuck.to) ? { ...b, stuck: null } : b));
}
// Board names stay unique: a second "Content" becomes "Content 2".
function uniqueName(boards, name) {
  const taken = new Set(boards.map((b) => b.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n += 1) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
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

// The boards that hold something: a project or group rule, or a session placed on them (placed = place()'s output).
function withContent(boards, placed) {
  const has = new Set(placed.map((c) => c.board).filter(Boolean));
  return new Set(boards.filter((b) => b.projects.length || b.groups.length || has.has(b.id)).map((b) => b.id));
}

function addBoard(cfg, { id, name, pos, items }) {
  if (!BOARD_RE.test(id) || cfg.boards.length >= MAX_BOARDS) return null;
  const b = { id, name: uniqueName(cfg.boards, cleanName(name)), theme: null, projects: [], groups: [], inside: false, visible: true,
    pos: point(pos), width: DEFAULT_W, maxHeight: null, stuck: null, dock: false, fresh: false, icon: null };
  cfg.boards.push(b);
  if (items) moveTo(cfg, items, id);
  return b;
}

function removeBoard(cfg, id) {
  cfg.boards = cfg.boards.filter((b) => b.id !== id);
  for (const b of cfg.boards) if (b.stuck && b.stuck.to === id) b.stuck = null; // what was stuck to it floats free
  for (const [k, v] of Object.entries(cfg.sessionBoard)) if (v === id) delete cfg.sessionBoard[k];
  cfg.hiddenByAll = (cfg.hiddenByAll || []).filter((x) => x !== id);
  if (cfg.view === id) cfg.view = null;
}

// ---- magnet: a board let go near Main's or another board's edge sticks to it and moves with it ----
// a, m: window rects {x, y, width, height}. Returns the side of m it sticks to and its offset along that side.
function snapTo(a, m, dist = 28) {
  const r = snapRaw(a, m, dist);
  return r && { side: r.side, along: r.along };
}
function snapRaw(a, m, dist) {
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
  return { side: best.side, along: best.side === 'left' || best.side === 'right' ? a.y - m.y : a.x - m.x, d: best.d };
}
// The nearest edge among targets [{ id: 'main' | board id, rect }]: { to, side, along } or null.
function snapBest(a, targets, dist = 28) {
  let best = null;
  for (const t of targets) {
    const r = snapRaw(a, t.rect, dist);
    if (r && (!best || r.d < best.d)) best = { to: t.id, side: r.side, along: r.along, d: r.d };
  }
  return best && { to: best.to, side: best.side, along: best.along };
}
// Boards side by side join into one (their touching edges lose their margin and corners); stacked ones stay
// separate cards with a small gap. Returns { [board id]: { left, right, top, bottom } } for boards stuck to boards.
const FACING = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
function joins(boards) {
  const out = {};
  const mark = (id, side) => { out[id] = out[id] || { left: false, right: false, top: false, bottom: false }; out[id][side] = true; };
  for (const b of boards) {
    if (!b.stuck || b.stuck.to === 'main' || b.inside) continue;
    const t = boards.find((x) => x.id === b.stuck.to);
    if (!t || t.inside) continue;
    mark(b.id, FACING[b.stuck.side]); // b sits on t's right: b's left edge touches t
    mark(t.id, b.stuck.side);
  }
  return out;
}
// The boards `from` hangs on, directly or not (to avoid sticking a board to one that is stuck to it).
function stuckChain(boards, from) {
  const seen = new Set();
  let cur = boards.find((b) => b.id === from);
  while (cur && cur.stuck && cur.stuck.to !== 'main' && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = boards.find((b) => b.id === cur.stuck.to);
    if (cur) seen.add(cur.id);
  }
  return seen;
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

module.exports = { BOARD_RE, ICONS, DEFAULT_W, MAX_BOARDS, normalizeBoards, normalizeSessionBoard, place, withContent, moveTo, addBoard, removeBoard,
  snapTo, snapBest, stuckPos, joins, stuckChain, uniqueName, hideAll, restoreHidden, showAll, cleanName };
