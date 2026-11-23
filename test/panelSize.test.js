const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/panelSize');

const start = { x: 1000, y: 100, width: 368, height: 500, cap: null };

test('width stays between 300 and 640; left edge keeps the right side still', () => {
  assert.deepEqual(S.dragTo(start, 'right', 100, 0, 1100), { x: 1000, width: 468, cap: null });
  assert.deepEqual(S.dragTo(start, 'right', 900, 0, 1100), { x: 1000, width: 640, cap: null });
  const left = S.dragTo(start, 'left', -100, 0, 1100);
  assert.deepEqual(left, { x: 900, width: 468, cap: null });
  assert.equal(left.x + left.width, start.x + start.width);
  assert.deepEqual(S.dragTo(start, 'left', 200, 0, 1100), { x: 1068, width: 300, cap: null });
});

test('bottom edges set a height cap, clamped to 160..screen; corners do both', () => {
  assert.deepEqual(S.dragTo(start, 'bottom', 50, -200, 1100), { x: 1000, width: 368, cap: 300 });
  assert.equal(S.dragTo(start, 'bottom', 0, -900, 1100).cap, 160);
  assert.equal(S.dragTo(start, 'bottom', 0, 900, 1100).cap, 1100);
  assert.deepEqual(S.dragTo(start, 'bottom-left', -32, 40, 1100), { x: 968, width: 400, cap: 540 });
});

test('fitHeight: content height under the cap and the screen', () => {
  assert.equal(S.fitHeight(700, null, 1100), 700);
  assert.equal(S.fitHeight(700, 400, 1100), 400);
  assert.equal(S.fitHeight(2000, null, 1100), 1100);
  assert.equal(S.fitHeight(10, null, 1100), 48);
  assert.equal(S.clampWidth('junk'), 368);
  assert.equal(S.clampCap('junk', 1100), null);
});

test('minimised bar stretches between 80 and 360 px', () => {
  assert.equal(S.clampMini(50), 80);
  assert.equal(S.clampMini(200), 200);
  assert.equal(S.clampMini(900), 360);
  assert.equal(S.clampMini('junk'), 80);
});

test('windowHeight: a set height is used as is, otherwise follow the content', () => {
  assert.equal(S.windowHeight(300, 500, 1100), 500, 'panel fills the height you set');
  assert.equal(S.windowHeight(900, 500, 1100), 500);
  assert.equal(S.windowHeight(300, null, 1100), 300);
  assert.equal(S.windowHeight(300, 5000, 1100), 1100, 'never taller than the screen');
});

test('shellRect: rail and drawer grow the window outward, the deck stays put', () => {
  const deck = { x: 1000, y: 200, width: 368, height: 300 };
  assert.deepEqual(S.shellRect(deck, null, true), { ...deck, offX: 0, offY: 0 }, 'minimised: no rail');
  const left = S.shellRect(deck, 'left', false);
  assert.deepEqual(left, { x: 954, y: 200, width: 414, height: 300, offX: 46, offY: 0 });
  assert.equal(left.x + left.offX, deck.x, 'deck keeps its screen x');
  const leftOpen = S.shellRect(deck, 'left', true);
  assert.deepEqual(leftOpen, { x: 648, y: 200, width: 720, height: 400, offX: 352, offY: 0 }, 'drawer opens to the left, min height');
  assert.deepEqual(S.shellRect(deck, 'right', true), { x: 1000, y: 200, width: 720, height: 400, offX: 0, offY: 0 });
  assert.deepEqual(S.shellRect(deck, 'top', true), { x: 1000, y: -172, width: 368, height: 672, offX: 0, offY: 372 });
  assert.deepEqual(S.shellRect(deck, 'bottom', false), { x: 1000, y: 200, width: 368, height: 346, offX: 0, offY: 0 });
});

test('snapMini: release nearer the full list shows every session, else stats only', () => {
  const stops = { bar: 90, full: 250 };
  assert.equal(S.snapMini(100, stops), false);
  assert.equal(S.snapMini(169, stops), false);
  assert.equal(S.snapMini(170, stops), true);
  assert.equal(S.snapMini(400, stops), true);
  assert.equal(S.snapMini(400, { bar: 90, full: 90 }), false, 'no sessions: nothing to show');
});

test('shellRect: the sidebar minimises on its own and keeps room beside a short deck', () => {
  const bar = { x: 1000, y: 200, width: 368, height: 90 };
  assert.deepEqual(S.shellRect(bar, 'left', false), { x: 954, y: 200, width: 414, height: 108, offX: 46, offY: 0 }, 'full rail needs 108 px');
  assert.deepEqual(S.shellRect(bar, 'left', true, true), { x: 978, y: 200, width: 390, height: 90, offX: 22, offY: 0 }, 'thin strip, no drawer');
  assert.deepEqual(S.shellRect(bar, 'top', false, true), { x: 1000, y: 178, width: 368, height: 112, offX: 0, offY: 22 });
});

test('zoom scales the rail and drawer around the deck; unknown zooms fall back to 100 %', () => {
  const deck = { x: 500, y: 100, width: 460, height: 300 };
  const r1 = S.shellRect(deck, 'left', false, false, 1);
  const r2 = S.shellRect(deck, 'left', false, false, 1.5);
  assert.equal(r2.offX, Math.round(1.5 * (S.RAIL + S.GAP)));
  assert.ok(r2.width > r1.width);
  assert.equal(S.clampZoom(1.25), 1.25);
  assert.equal(S.clampZoom(3), 1);
});
