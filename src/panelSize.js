// Panel size rules, kept pure so they can be tested without Electron.
// The window is transparent and frameless, so Windows gives it no resize border:
// the overlay has its own grab strips and sends drag deltas here.
const DEFAULT_WIDTH = 368;
const MIN_WIDTH = 300;
const MAX_WIDTH = 640;
const MIN_CAP = 160; // smallest max-height you can drag to
// Minimised bar: can be stretched to show a compact list, up to MINI_MAX.
const MINI_MIN = 80;
const MINI_MAX = 360;
const clampMini = (h) => Math.max(MINI_MIN, Math.min(MINI_MAX, Math.round(Number(h) || MINI_MIN)));
// Release a minimised-bar drag: true = show every deck session, false = stats only.
const snapMini = (height, { bar, full }) => full > bar && height >= (bar + full) / 2;
const EDGES = ['left', 'right', 'bottom', 'bottom-left', 'bottom-right'];

const clampWidth = (w) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(Number(w) || DEFAULT_WIDTH)));

// null = no cap (as tall as the content, up to the screen).
function clampCap(h, screenH) {
  if (h == null) return null;
  const n = Math.round(Number(h));
  if (!Number.isFinite(n)) return null;
  return Math.max(MIN_CAP, Math.min(n, screenH));
}

// One step of a drag. start = window bounds and cap when the drag began; dx/dy = pointer movement.
// Left edges keep the right side still; bottom edges set the cap from the window's current top.
function dragTo(start, edge, dx, dy, screenH) {
  let { x, width } = start;
  let cap = start.cap;
  if (edge === 'left' || edge === 'bottom-left') {
    width = clampWidth(start.width - dx);
    x = start.x + start.width - width;
  } else if (edge === 'right' || edge === 'bottom-right') {
    width = clampWidth(start.width + dx);
  }
  if (edge.startsWith('bottom')) cap = clampCap(start.height + dy, screenH);
  return { x, width, cap };
}

// Final window height: the content's height, under the cap and the screen.
const fitHeight = (contentH, cap, screenH) =>
  Math.max(48, Math.min(Math.round(Number(contentH) || 0), cap || Infinity, screenH));

// Window height: a height you set with the bottom edge is used as is (the panel fills it and its list
// scrolls); with none, the window follows the content. Both stay on screen.
const windowHeight = (contentH, fixed, screenH) =>
  (fixed != null ? Math.max(48, Math.min(Math.round(fixed), screenH)) : fitHeight(contentH, null, screenH));

// ---------- sidebar rail + drawer ----------
// The window holds the deck (the panel you know, incl. its 8 px margins), the rail on one side of it and,
// when open, a drawer beyond the rail ("outward"), so the deck never moves on screen.
const RAIL = 40;
const RAIL_MIN = 16; // sidebar minimised to a thin strip
const RAIL_MIN_H = 108; // a full side rail needs this much height, even beside the minimised bar
const GAP = 6;
const DRAWER_W = 300; // left / right
const DRAWER_H = 320; // top / bottom
const DRAWER_MIN_H = 400; // a side drawer needs room even when the deck is short
const SIDES = ['left', 'right', 'top', 'bottom'];
// Settings → Size: the whole app scales (text, pets, buttons). Sizes you drag are stored at 100 %.
const ZOOMS = [0.9, 1, 1.25, 1.5];
const clampZoom = (z) => (ZOOMS.includes(z) ? z : 1);

// The space the rail and the drawer card add on each side of the deck (screen pixels). The card (Sessions +
// Settings) docks on its own side (drawerSide, default: the rail's); on the rail's side it sits beyond the rail.
function shellExtras(side, drawerOpen, railMin = false, zoom = 1, drawerSide = side) {
  const ext = { left: 0, right: 0, top: 0, bottom: 0 };
  if (!SIDES.includes(side)) return ext;
  ext[side] += (railMin ? RAIL_MIN : RAIL) + GAP;
  const dside = SIDES.includes(drawerSide) ? drawerSide : side;
  if (drawerOpen && !railMin) ext[dside] += (dside === 'left' || dside === 'right' ? DRAWER_W : DRAWER_H) + GAP; // a minimised sidebar has no card
  for (const k of SIDES) ext[k] = Math.round(zoom * ext[k]);
  return ext;
}

// deck = {x, y, width, height} on screen. side = rail side, or null (pet dock: no rail).
// Returns the window rect and where the deck sits inside it (offX, offY); the deck never moves on screen.
// zoom: the page's zoom (Settings → Size); rail and card sizes are page pixels, the deck rect is screen pixels.
// railMinH: how tall a side rail needs to be (it grows with the board buttons on it).
function shellRect(deck, side, drawerOpen, railMin = false, zoom = 1, drawerSide = side, railMinH = RAIL_MIN_H) {
  if (!SIDES.includes(side)) return { ...deck, offX: 0, offY: 0 };
  const across = (s) => s === 'left' || s === 'right';
  const dside = SIDES.includes(drawerSide) ? drawerSide : side;
  const open = drawerOpen && !railMin;
  const ext = shellExtras(side, drawerOpen, railMin, zoom, dside);
  const minMid = Math.round(zoom * Math.max(open && across(dside) ? DRAWER_MIN_H : 0, !railMin && across(side) ? railMinH : 0));
  return {
    x: deck.x - ext.left, y: deck.y - ext.top,
    width: deck.width + ext.left + ext.right, height: Math.max(deck.height, minMid) + ext.top + ext.bottom,
    offX: ext.left, offY: ext.top,
  };
}

module.exports = { MINI_MIN, MINI_MAX, clampMini, snapMini, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH, MIN_CAP, EDGES, clampWidth, clampCap, dragTo, fitHeight, windowHeight, RAIL, RAIL_MIN, RAIL_MIN_H, GAP, DRAWER_W, DRAWER_H, DRAWER_MIN_H, SIDES, shellRect, shellExtras, ZOOMS, clampZoom };
