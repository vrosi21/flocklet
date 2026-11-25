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
  const across = best.side === 'left' || best.side === 'right';
  return { side: best.side, along: alignAlong(across, across ? a.y - m.y : a.x - m.x, across ? m.height - a.height : m.width - a.width), d: best.d };
}
// Dropped almost in line with an edge of the one it sticks to: it lines up exactly (tops or bottoms beside it,
// left or right edges above or below it).
const ALIGN = 16;
function alignAlong(across, along, far) {
  if (Math.abs(along) <= ALIGN) return 0;
  if (Math.abs(along - far) <= ALIGN) return far;
  return along;
}
// The nearest edge among targets [{ id: 'main' | board id, rect }]: { to, side, along } or null.
// About as near a board as Main (within PREFER px): the board wins, so you stack on it rather than beside Main.
const PREFER = 10;
function snapBest(a, targets, dist = 28) {
  const hits = targets.map((t) => { const r = snapRaw(a, t.rect, dist); return r && { to: t.id, side: r.side, along: r.along, d: r.d - (t.id === 'main' ? 0 : PREFER) }; })
    .filter(Boolean).sort((p, q) => p.d - q.d);
  return hits[0] ? { to: hits[0].to, side: hits[0].side, along: hits[0].along } : null;
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
// gap: the space between the two (rects here are what you see of each, without the windows' clear margins).
function stuckPos(m, size, s, gap = 0) {
  if (s.side === 'right') return { x: m.x + m.width + gap, y: m.y + s.along };
  if (s.side === 'left') return { x: m.x - size.width - gap, y: m.y + s.along };
  if (s.side === 'bottom') return { x: m.x + s.along, y: m.y + m.height + gap };
  return { x: m.x + s.along, y: m.y - size.height - gap };
}
// The other sides to try, in order, when its own side would put it off the screen.
const FALLBACK = { right: ['left', 'bottom', 'top'], left: ['right', 'bottom', 'top'], bottom: ['top', 'right', 'left'], top: ['bottom', 'right', 'left'] };
const inside = (r, area) => r.x >= area.x && r.y >= area.y && r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height;
const overlaps = (r, o) => r.x < o.x + o.width && r.x + r.width > o.x && r.y < o.y + o.height && r.y + r.height > o.y;
// Where a stuck one goes: its own side if that fits on the screen, else the first other side that fits and is free
// (avoid: what other boards already cover; it keeps its own side for when there is room again), else its own side
// pulled back onto the screen.
function placeStuck(m, size, s, gap, area, avoid = []) {
  const at = (side) => ({ ...stuckPos(m, size, { side, along: side === s.side ? s.along : 0 }, gap), ...size });
  const free = (r) => inside(r, area) && !avoid.some((o) => overlaps(r, o));
  const own = at(s.side);
  if (inside(own, area)) return own;
  for (const side of FALLBACK[s.side]) { const r = at(side); if (free(r)) return r; }
  return { ...own, x: Math.max(area.x, Math.min(own.x, area.x + area.width - size.width)), y: Math.max(area.y, Math.min(own.y, area.y + area.height - size.height)) };
}
// Something that overlaps m moves just out of its way, by the shortest move that keeps it on the screen.
function pushOut(a, m, gap, area) {
  const overlap = a.x < m.x + m.width && a.x + a.width > m.x && a.y < m.y + m.height && a.y + a.height > m.y;
  if (!overlap) return null;
  const tries = [
    { x: m.x + m.width + gap, y: a.y }, { x: m.x - a.width - gap, y: a.y },
    { x: a.x, y: m.y + m.height + gap }, { x: a.x, y: m.y - a.height - gap },
  ].map((p) => ({ ...p, width: a.width, height: a.height, d: Math.abs(p.x - a.x) + Math.abs(p.y - a.y) }))
    .filter((r) => inside(r, area)).sort((p, q) => p.d - q.d);
  return tries[0] ? { x: tries[0].x, y: tries[0].y } : null;
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
  snapTo, snapBest, stuckPos, placeStuck, pushOut, joins, stuckChain, uniqueName, hideAll, restoreHidden, showAll, cleanName };
