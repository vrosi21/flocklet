const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionStore } = require('../src/store');

const SID = 'cli-1';
function setup() {
  let t = 1_000_000;
  const store = new SessionStore({ now: () => t });
  const hook = (name, extra = {}) => store.applyHook({ session_id: SID, hook_event_name: name, cwd: 'C:\\x\\proj', ...extra });
  const card = () => store.snapshot().cards.find((c) => c.id === SID);
  return { store, hook, card, tick: (ms) => { t += ms; } };
}

test('registry entry gives title, desktop id and idle group', () => {
  const { store, card } = setup();
  store.applyRegistry([{ sessionId: SID, hostSessionId: 'local_abc', name: 'My task', status: 'idle', entrypoint: 'claude-desktop' }]);
  const c = card();
  assert.equal(c.name, 'My task');
  assert.equal(c.hostId, 'local_abc');
  assert.equal(c.canJump, true);
  assert.equal(c.group, 'idle');
});

test('busy in registry before any hook shows as working', () => {
  const { store, card } = setup();
  store.applyRegistry([{ sessionId: SID, hostSessionId: 'local_abc', name: 'T', status: 'busy', statusUpdatedAt: 999_000 }]);
  assert.equal(card().state, 'working');
  assert.equal(card().group, 'active');
  assert.equal(card().activity, 'Working…');
});

test('prompt -> tool activity -> plan progress from update_plan', () => {
  const { hook, card } = setup();
  hook('UserPromptSubmit', { prompt: 'go' });
  assert.equal(card().state, 'working');
  hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'npm i', description: 'Install deps' } });
  assert.equal(card().activity, 'Install deps');
  hook('PostToolUse', {
    tool_name: 'mcp__ccd_turn__update_plan', tool_use_id: 't2',
    tool_input: { items: [
      { content: 'Scaffold', status: 'completed' },
      { content: 'Build UI', status: 'in_progress' },
      { content: 'Test', status: 'pending' },
    ] },
    tool_response: [{ type: 'text', text: 'Plan shown (3 steps).' }],
  });
  assert.deepEqual(card().progress, { index: 2, total: 3, ratio: 1 / 3, label: 'Build UI' });
  hook('PostToolUse', {
    tool_name: 'mcp__ccd_turn__update_plan', tool_use_id: 't3', tool_input: { advance: true },
    tool_response: [{ type: 'text', text: 'Plan updated: step 3 of 3 is in progress.' }],
  });
  const p = card().progress;
  assert.equal(p.index, 3);
  assert.equal(p.label, 'Test');
  assert.equal(p.ratio, 2 / 3);
  // the plan tool itself must not overwrite the activity line
  hook('PreToolUse', { tool_name: 'mcp__ccd_turn__update_plan', tool_use_id: 't4', tool_input: { advance: true } });
  assert.equal(card().activity, 'Install deps');
});

test('permission waits pair with PreToolUse and clear only on the matching tool result', () => {
  const { hook, card, tick } = setup();
  hook('UserPromptSubmit');
  hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'rm -rf build' } });
  tick(40);
  hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
  let c = card();
  assert.equal(c.state, 'waiting');
  assert.equal(c.waiting.kind, 'permission');
  assert.equal(c.waiting.detail, 'rm -rf build');
  hook('PostToolUse', { tool_name: 'Read', tool_use_id: 'r9', tool_input: { file_path: 'a.txt' } });
  assert.equal(card().state, 'waiting', 'a parallel tool finishing must not clear the wait');
  hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'rm -rf build' } });
  c = card();
  assert.equal(c.state, 'working');
  assert.equal(c.waiting, null);
});

test('a plan rejected in the app (no PostToolUse) clears once Claude moves on', () => {
  const { hook, card, tick } = setup();
  hook('UserPromptSubmit');
  hook('PreToolUse', { tool_name: 'ExitPlanMode', tool_use_id: 'p1', tool_input: { plan: 'v1' } });
  tick(40);
  hook('PermissionRequest', { tool_name: 'ExitPlanMode', tool_input: { plan: 'v1' } });
  assert.equal(card().waiting.kind, 'plan');
  hook('PreToolUse', { tool_name: 'Read', tool_use_id: 's1', agent_id: 'sub-1', tool_input: { file_path: 'a' } });
  assert.equal(card().waiting.kind, 'plan', 'a subagent tool must not clear it');
  tick(60_000); // rejected with feedback: Claude edits the plan and asks again
  hook('PreToolUse', { tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: 'plan.md' } });
  assert.equal(card().waiting, null);
  assert.equal(card().state, 'working');
  hook('PreToolUse', { tool_name: 'ExitPlanMode', tool_use_id: 'p2', tool_input: { plan: 'v2' } });
  tick(40);
  hook('PermissionRequest', { tool_name: 'ExitPlanMode', tool_input: { plan: 'v2' } });
  assert.equal(card().waiting.kind, 'plan');
  hook('PostToolUse', { tool_name: 'ExitPlanMode', tool_use_id: 'p2', tool_input: { plan: 'v2' } });
  assert.equal(card().waiting, null);
  assert.equal(card().moreWaiting, 0);
});

test('AskUserQuestion becomes a question card with the question text', () => {
  const { hook, card } = setup();
  hook('UserPromptSubmit');
  const tool_input = { questions: [{ question: 'Which format?', header: 'Format', options: [{ label: 'PDF' }, { label: 'DOCX' }] }] };
  hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q1', tool_input });
  hook('PermissionRequest', { tool_name: 'AskUserQuestion', tool_input });
  const c = card();
  assert.equal(c.waiting.kind, 'question');
  assert.equal(c.waiting.title, 'Which format?');
  assert.equal(c.waiting.detail, 'PDF · DOCX');
});

test('finished cards stay until X, come back on new activity, and survive restarts', () => {
  const { store, hook, card, tick } = setup();
  store.applyRegistry([{ sessionId: SID, hostSessionId: 'local_k', status: 'idle' }]);
  hook('UserPromptSubmit');
  hook('PostToolUse', { tool_name: 'mcp__ccd_turn__update_plan', tool_input: { items: [{ content: 'A', status: 'in_progress' }] } });
  hook('Stop', { last_assistant_message: 'All set.' });
  tick(5 * 3600e3);
  let c = card();
  assert.equal(c.state, 'done');
  assert.equal(c.lastMessage, 'All set.');
  assert.equal(c.group, 'active', 'no time limit any more');
  assert.deepEqual(store.deckKeys(), ['local_k']);

  hook('SessionEnd');
  assert.equal(card().group, 'active', 'the app stopping the process does not remove the card');

  store.hide(SID);
  assert.equal(card().group, 'idle');
  assert.deepEqual(store.deckKeys(), []);
  hook('UserPromptSubmit');
  assert.equal(card().group, 'active', 'new activity brings it back');

  const fresh = new SessionStore();
  fresh.restoreDeck(['local_k']);
  fresh.applyRegistry([{ sessionId: 'cli-new', hostSessionId: 'local_k', status: 'idle' }]);
  assert.equal(fresh.snapshot().cards[0].group, 'active', 'restored after restart, matched by desktop id');
});

test('registry idle after a missed Stop ends the working state, but never clears a wait', () => {
  const { store, hook, card, tick } = setup();
  hook('UserPromptSubmit');
  tick(5000);
  store.applyRegistry([{ sessionId: SID, status: 'idle', statusUpdatedAt: 1_000_000 + 9000 }]);
  assert.equal(card().state, 'idle');

  hook('UserPromptSubmit');
  hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'x' } });
  tick(5000);
  store.applyRegistry([{ sessionId: SID, status: 'idle', statusUpdatedAt: 1_000_000 + 99_000 }]);
  assert.equal(card().state, 'waiting');
});

test('registry "waiting" status flags a wait the hooks missed, and clears when it ends', () => {
  const { store, card } = setup();
  store.applyRegistry([{ sessionId: SID, hostSessionId: 'local_abc', status: 'waiting', statusUpdatedAt: 999_000 }]);
  assert.equal(card().state, 'waiting');
  assert.equal(card().waiting.kind, 'input');
  store.applyRegistry([{ sessionId: SID, hostSessionId: 'local_abc', status: 'busy', statusUpdatedAt: 1_000_000 }]);
  assert.equal(card().state, 'working');
  assert.equal(card().waiting, null);
});

test('sessions that leave the registry are forgotten after a while', () => {
  const { store, hook, tick } = setup();
  hook('SessionStart');
  store.applyRegistry([]);
  assert.equal(store.snapshot().cards.length, 1);
  tick(11 * 60e3);
  store.applyRegistry([]);
  assert.equal(store.snapshot().cards.length, 0);
});

test('desktop store keeps sessions listed after their process stops; archived ones go', () => {
  const { store, tick } = setup();
  const desk = [
    { hostId: 'local_a', cliSessionId: 'cli-a', title: 'Pinned thing', cwd: 'C:\\p', archived: false, parentHostId: null, lastActivityAt: 5 },
    { hostId: 'local_b', cliSessionId: 'cli-b', title: 'Child', cwd: 'C:\\p', archived: false, parentHostId: 'local_a', lastActivityAt: 9 },
    { hostId: 'local_c', cliSessionId: 'cli-c', title: 'Old', cwd: 'C:\\p', archived: true, parentHostId: null, lastActivityAt: 1 },
  ];
  store.applyDesktop(desk);
  store.applyRegistry([]); // no live processes at all
  tick(60 * 60e3);
  store.applyRegistry([]);
  let cards = store.snapshot().cards;
  assert.deepEqual(cards.map((c) => c.name), ['Child', 'Pinned thing'], 'most recent first, archived hidden');
  assert.equal(cards[0].parentHostId, 'local_a');
  assert.ok(cards.every((c) => c.canJump && c.group === 'idle'));

  store.applyDesktop([{ ...desk[0], archived: true }, desk[1]]);
  cards = store.snapshot().cards;
  assert.deepEqual(cards.map((c) => c.name), ['Child']);
});

test('desktop title wins over registry name; new CLI id for the same desktop session is merged', () => {
  const { store } = setup();
  store.applyDesktop([{ hostId: 'local_a', cliSessionId: 'cli-old', title: 'Renamed in app', archived: false, lastActivityAt: 1 }]);
  store.applyRegistry([{ sessionId: 'cli-new', hostSessionId: 'local_a', name: 'stale name', status: 'busy', statusUpdatedAt: 999_000 }]);
  const cards = store.snapshot().cards;
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'cli-new');
  assert.equal(cards[0].name, 'Renamed in app');
  assert.equal(cards[0].state, 'working');
});

test('waiting cards sort first and counts add up', () => {
  let t = 1;
  const store = new SessionStore({ now: () => t });
  const ev = (id, name, extra = {}) => store.applyHook({ session_id: id, hook_event_name: name, ...extra });
  ev('a', 'UserPromptSubmit');
  ev('b', 'UserPromptSubmit');
  ev('b', 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'x' } });
  ev('c', 'UserPromptSubmit');
  ev('c', 'Stop', { last_assistant_message: 'ok' });
  const snap = store.snapshot();
  assert.deepEqual(snap.cards.map((c) => c.id), ['b', 'a', 'c']);
  assert.deepEqual(snap.counts, { working: 1, waiting: 1, done: 1, idle: 0 });
});
