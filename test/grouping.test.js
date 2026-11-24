const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../renderer/grouping');

const card = (key, extra = {}) => ({ key, hostId: key, name: key, cwd: 'C:\\p\\one', state: 'idle', group: 'idle', parentHostId: null, ...extra });
const shape = (items) => items.map((i) => (i.type === 'header' ? `# ${i.label} (${i.count})` : `${'  '.repeat(i.depth)}${i.type === 'ghost' ? '~' : ''}${i.card.key}`));

test('pins keep a session on the deck and are counted', () => {
  const cards = G.decorate([card('a'), card('b', { group: 'active', state: 'working' })], { pins: ['a'], groupOf: { b: 'g1' } });
  assert.equal(cards[0].pinned, true);
  assert.equal(cards[0].group, 'active');
  assert.equal(cards[1].groupId, 'g1');
  assert.deepEqual(G.count(cards), { working: 1, waiting: 0, done: 0, idle: 0, pinned: 1 });
});

test('tree: children indented under parents; missing parents shown as ghosts; urgent subtree first', () => {
  const all = [
    card('kid2', { parentHostId: 'mom', state: 'waiting' }),
    card('solo'),
    card('mom'),
    card('kid1', { parentHostId: 'mom' }),
    card('grandkid', { parentHostId: 'kid1' }),
  ];
  assert.deepEqual(shape(G.arrange(all, 'tree')), ['mom', '  kid2', '  kid1', '    grandkid', 'solo']);
  // Deck shows only kid2 and solo: mom appears as a ghost so kid2 keeps its place.
  const deck = [all[0], all[1]];
  assert.deepEqual(shape(G.arrange(deck, 'tree', { all })), ['~mom', '  kid2', 'solo']);
});

test('folder sections and custom groups (with empty groups in the browser)', () => {
  const cards = [card('a', { cwd: 'C:\\x\\Api' }), card('b', { cwd: 'C:\\x\\web\\' }), card('c', { cwd: 'c:\\X\\api' })];
  assert.deepEqual(shape(G.arrange(cards, 'folder')), ['# Api (2)', 'a', 'c', '# web (1)', 'b']);

  const groups = [{ id: 'g1', name: 'School', color: 3 }, { id: 'g2', name: 'Jobs', color: 5 }];
  const decorated = G.decorate(cards, { groupOf: { b: 'g2', c: 'gone' } });
  assert.deepEqual(shape(G.arrange(decorated, 'custom', { groups })), ['# Jobs (1)', 'b', '# Ungrouped (2)', 'a', 'c']);
  assert.deepEqual(shape(G.arrange(decorated, 'custom', { groups, showEmptyGroups: true })),
    ['# School (0)', '# Jobs (1)', 'b', '# Ungrouped (2)', 'a', 'c']);
});

test('projects: tree inside each folder, children follow their top parent, worktrees join their project', () => {
  const all = [
    card('kid', { cwd: 'C:\\x\\web', parentHostId: 'mom', state: 'waiting' }), // other folder, stays with mom
    card('solo', { cwd: 'C:\\x\\web' }),
    card('mom', { cwd: 'C:\\x\\api' }),
    card('wt', { cwd: 'C:\\x\\api\\.claude\\worktrees\\brave-tesla-1a2b3c' }),
  ];
  assert.deepEqual(shape(G.arrange(all, 'folder')), ['# api (3)', 'mom', '  kid', 'wt', '# web (1)', 'solo']);
  // On the deck only kid + solo: mom shows as a ghost (not counted) in api.
  assert.deepEqual(shape(G.arrange([all[0], all[1]], 'folder', { all })), ['# api (1)', '~mom', '  kid', '# web (1)', 'solo']);
  assert.equal(G.folderName('C:\\x\\shop\\.claude\\worktrees\\brave-tesla-1a2b3c'), 'shop');
  assert.equal(G.MODES[0], 'folder', 'projects is the default mode');
});

test('fold: headers and parents collapse, sessions that need you stay visible', () => {
  const all = [
    card('mom', { cwd: 'C:\\x\\api' }),
    card('kid1', { cwd: 'C:\\x\\api', parentHostId: 'mom' }),
    card('kid2', { cwd: 'C:\\x\\api', parentHostId: 'mom', state: 'waiting' }),
    card('grand', { cwd: 'C:\\x\\api', parentHostId: 'kid1' }),
    card('solo', { cwd: 'C:\\x\\web' }),
  ];
  const items = G.arrange(all, 'folder');
  assert.deepEqual(shape(items), ['# api (4)', 'mom', '  kid1', '    grand', '  kid2', '# web (1)', 'solo']);
  // Nothing folded: same rows, foldable marks on headers and parents only.
  const open = G.fold(items, []);
  assert.deepEqual(shape(open), shape(items));
  assert.deepEqual(open.filter((i) => i.foldable).map((i) => G.foldKeyOf(i)), ['h:c:\\x\\api', 'p:mom', 'p:kid1', 'h:c:\\x\\web']);
  // Fold mom: kid1 + grand hidden, kid2 (waiting) stays.
  const f1 = G.fold(items, ['p:mom']);
  assert.deepEqual(shape(f1), ['# api (4)', 'mom', '  kid2', '# web (1)', 'solo']);
  assert.deepEqual(f1.find((i) => i.card && i.card.key === 'mom') && [f1[1].hidden, f1[1].hiddenWaiting], [3, 1]);
  // Fold a whole project.
  const f2 = G.fold(items, ['h:c:\\x\\api']);
  assert.deepEqual(shape(f2), ['# api (4)', '  kid2', '# web (1)', 'solo']);
  assert.deepEqual([f2[0].hidden, f2[0].hiddenWaiting], [4, 1]);
});

test('search matches name or folder; tree keeps the matched child under a ghost parent', () => {
  const all = [card('mom', { name: 'Course hub' }), card('kid', { name: 'Lab 2 report', parentHostId: 'mom' }), card('other', { name: 'Job hunt', cwd: 'C:\\jobs' })];
  const hits = G.search(all, 'lab');
  assert.deepEqual(hits.map((c) => c.key), ['kid']);
  assert.deepEqual(shape(G.arrange(hits, 'tree', { all })), ['~mom', '  kid']);
  assert.deepEqual(G.search(all, 'JOBS').map((c) => c.key), ['other']);
});

test('stateCounts: every listed session by state, unknown states count as idle', () => {
  const cards = [card('a', { state: 'waiting' }), card('b', { state: 'working' }), card('c'), card('d', { state: 'error' }),
    card('e', { state: 'done' }), card('f', { state: 'weird' })];
  assert.deepEqual(G.stateCounts(cards), { waiting: 1, error: 1, working: 1, done: 1, idle: 2 });
  assert.deepEqual(G.STATE_ORDER, ['waiting', 'error', 'working', 'done', 'idle'], 'needs-you states first');
});

test('your order: placed cards keep their place, new ones come first in the store order', () => {
  const cards = [card('n1'), card('a'), card('b'), card('n2'), card('c')];
  const out = G.applyOrder(cards, ['c', 'a', 'b']);
  assert.deepEqual(out.map((c) => c.key), ['n1', 'n2', 'c', 'a', 'b']);
  assert.deepEqual(out.map((c) => !!c.ordered), [false, false, true, true, true]);
  assert.equal(G.applyOrder(cards, []), cards, 'no order: untouched');
});

test('a drop rewrites one section as a block, the rest of the saved order stays', () => {
  assert.deepEqual(G.placeBlock(['x', 'a', 'y', 'b'], ['b', 'a']), ['x', 'b', 'a', 'y']);
  assert.deepEqual(G.placeBlock(['x'], ['p', 'q']), ['p', 'q', 'x'], 'unknown keys go in front');
  const cards = [card('a'), card('x'), card('b'), card('c')];
  assert.deepEqual(G.reorderBlock(cards, ['c', 'a', 'b']).map((c) => c.key), ['c', 'x', 'a', 'b'], 'keys take the places they had');
});

test('moveUnit: an item moves with its children, only to a sibling spot', () => {
  const items = [{ key: 'a', depth: 0 }, { key: 'a1', depth: 1 }, { key: 'a2', depth: 1 }, { key: 'b', depth: 0 }, { key: 'c', depth: 0 }];
  const keys = (l) => l.map((x) => x.key);
  assert.equal(G.unitEnd(items, 0), 3);
  assert.deepEqual(keys(G.moveUnit(items, 0, 5)), ['b', 'c', 'a', 'a1', 'a2'], 'parent to the end, children along');
  assert.deepEqual(keys(G.moveUnit(items, 4, 0)), ['c', 'a', 'a1', 'a2', 'b']);
  assert.deepEqual(keys(G.moveUnit(items, 2, 1)), ['a', 'a2', 'a1', 'b', 'c'], 'children swap under their parent');
  assert.deepEqual(keys(G.moveUnit(items, 0, 2)), keys(items), 'inside itself: no move');
});

test('a placed tree keeps its spot even when a child needs you; projects follow your folder order', () => {
  const kid = card('kid', { parentHostId: 'mom', state: 'waiting', group: 'active' });
  const all = G.applyOrder([kid, card('solo', { group: 'active' }), card('mom', { group: 'active' })], ['solo', 'mom', 'kid']);
  assert.deepEqual(shape(G.arrange(all, 'tree', { all })), ['solo', 'mom', '  kid']);
  const auto = [kid, card('solo', { group: 'active' }), card('mom', { group: 'active' })];
  assert.deepEqual(shape(G.arrange(auto, 'tree', { all: auto })), ['mom', '  kid', 'solo'], 'unplaced: the urgent tree first');
  const two = [card('p', { cwd: 'C:/one' }), card('q', { cwd: 'C:/two' })];
  assert.deepEqual(shape(G.arrange(two, 'folder', { folderOrder: ['c:/two', 'c:/one'] })), ['# two (1)', 'q', '# one (1)', 'p']);
  assert.deepEqual(shape(G.arrange(two, 'folder')), ['# one (1)', 'p', '# two (1)', 'q'], 'no folder order: as they appear');
  assert.deepEqual(shape(G.arrange(two, 'folder', { names: { 'c:/two': 'Website' } })), ['# one (1)', 'p', '# Website (1)', 'q'], 'your name for a project');
});
