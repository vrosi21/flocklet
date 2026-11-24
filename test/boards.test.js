const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/boards');

const card = (key, extra = {}) => ({ key, hostId: key, cwd: 'C:/p/one', groupId: null, parentHostId: null, ...extra });
const cfgWith = (boards = []) => ({ boards: B.normalizeBoards(boards), sessionBoard: {}, hiddenByAll: [], view: null });

test('placement: your move first, then the parent, then the group, then the project; the rest stays on Main', () => {
  const cfg = cfgWith([{ id: 'b_00000001', projects: ['c:/p/two'] }, { id: 'b_00000002', groups: ['g_x'] }]);
  cfg.sessionBoard = { moved: 'b_00000002', back: 'main' };
  const cards = [
    card('plain'),
    card('proj', { cwd: 'C:/p/two' }),
    card('grp', { groupId: 'g_x', cwd: 'C:/p/two' }),
    card('moved'),
    card('kid', { parentHostId: 'moved' }),
    card('back', { cwd: 'C:/p/two' }),
    card('wt', { cwd: 'C:/p/two/.claude/worktrees/x' }),
  ];
  const at = Object.fromEntries(B.place(cards, cfg).map((c) => [c.key, c.board]));
  assert.deepEqual(at, { plain: null, proj: 'b_00000001', grp: 'b_00000002', moved: 'b_00000002', kid: 'b_00000002', back: null, wt: 'b_00000001' });
});

test('moving a project moves the rule and clears single moves; a card moves on its own', () => {
  const cfg = cfgWith([{ id: 'b_00000001', projects: ['c:/p/one'] }]);
  B.addBoard(cfg, { id: 'b_00000002', name: '  Two  ', pos: { x: 10.4, y: 20 }, items: { keys: ['a', 'b'], project: 'c:/p/one' } });
  assert.deepEqual(cfg.boards.map((b) => [b.id, b.name, b.projects]), [['b_00000001', 'Board', []], ['b_00000002', 'Two', ['c:/p/one']]]);
  assert.deepEqual(cfg.boards[1].pos, { x: 10, y: 20 });
  B.moveTo(cfg, { keys: ['a'] }, null);
  assert.deepEqual(cfg.sessionBoard, { a: 'main' });
  B.moveTo(cfg, { keys: ['a', 'b'], project: 'c:/p/one' }, 'b_00000001');
  assert.deepEqual(cfg.sessionBoard, {}, 'cards follow the project again');
  assert.deepEqual(cfg.boards[0].projects, ['c:/p/one']);
  B.moveTo(cfg, { keys: ['x'] }, 'b_99999999');
  assert.deepEqual(cfg.sessionBoard, { x: 'main' }, 'an unknown board means Main');
});

test('removing a board sends its sessions back to Main', () => {
  const cfg = cfgWith([{ id: 'b_00000001', inside: true }]);
  cfg.sessionBoard = { a: 'b_00000001', b: 'main' };
  cfg.view = 'b_00000001';
  B.removeBoard(cfg, 'b_00000001');
  assert.deepEqual([cfg.boards.length, cfg.sessionBoard, cfg.view], [0, { b: 'main' }, null]);
});

test('magnet: near an edge it sticks, with its offset along that edge; far away it floats', () => {
  const main = { x: 100, y: 100, width: 300, height: 400 };
  assert.deepEqual(B.snapTo({ x: 410, y: 150, width: 200, height: 100 }, main), { side: 'right', along: 50 });
  assert.deepEqual(B.snapTo({ x: 120, y: 505, width: 200, height: 100 }, main), { side: 'bottom', along: 20 });
  assert.deepEqual(B.snapTo({ x: -95, y: 100, width: 200, height: 100 }, main), { side: 'left', along: 0 });
  assert.equal(B.snapTo({ x: 600, y: 150, width: 200, height: 100 }, main), null);
  const moved = { x: 0, y: 0, width: 300, height: 450 };
  assert.deepEqual(B.stuckPos(moved, { width: 200, height: 100 }, { side: 'right', along: 50 }), { x: 300, y: 50 });
  assert.deepEqual(B.stuckPos(moved, { width: 200, height: 100 }, { side: 'bottom', along: 20 }), { x: 20, y: 450 });
  assert.deepEqual(B.stuckPos(moved, { width: 200, height: 100 }, { side: 'top', along: 0 }), { x: 0, y: -100 });
});

test('hide all, bring back the hidden ones, show all', () => {
  const cfg = cfgWith([{ id: 'b_00000001' }, { id: 'b_00000002', visible: false }, { id: 'b_00000003', inside: true }]);
  cfg.view = 'b_00000003';
  B.hideAll(cfg);
  assert.deepEqual([cfg.boards.map((b) => b.visible), cfg.view, cfg.hiddenByAll], [[false, false, true], null, ['b_00000001', 'b_00000003']]);
  B.restoreHidden(cfg);
  assert.deepEqual([cfg.boards.map((b) => b.visible), cfg.view], [[true, false, true], 'b_00000003'], 'only what hide-all hid comes back');
  B.showAll(cfg);
  assert.deepEqual(cfg.boards.map((b) => b.visible), [true, true, true]);
});

test('saved boards are checked: bad ids, names and sides are dropped or fixed', () => {
  const list = B.normalizeBoards([{ id: 'nope' }, { id: 'b_0000000a', name: '', width: 9999, stuck: { side: 'up', along: 1 } }]);
  assert.deepEqual(list.map((b) => [b.id, b.name, b.width, b.stuck, b.visible, b.inside]), [['b_0000000a', 'Board', 640, null, true, false]]);
  assert.deepEqual(B.normalizeSessionBoard({ a: 'b_0000000a', b: 'b_gone', 'bad key!': 'main', c: 'main' }, list), { a: 'b_0000000a', c: 'main' });
});
