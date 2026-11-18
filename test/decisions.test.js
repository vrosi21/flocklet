const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDecision, permissionSuggestions } = require('../src/decisions');
const { Broker } = require('../src/broker');
const { SessionStore } = require('../src/store');

const bashEv = {
  hook_event_name: 'PermissionRequest', session_id: 's', tool_name: 'Bash',
  tool_input: { command: 'npm run build' },
  permission_suggestions: [
    { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm run build' }], behavior: 'allow', destination: 'localSettings' },
    { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
    { type: 'addDirectories', directories: ['C:\\tmp'], destination: 'session' },
  ],
};

const qEv = {
  hook_event_name: 'PermissionRequest', session_id: 's', tool_name: 'AskUserQuestion',
  tool_input: { questions: [
    { question: 'Format?', header: 'Format', multiSelect: false, options: [{ label: 'PDF' }, { label: 'DOCX' }] },
    { question: 'Extras?', header: 'Extras', multiSelect: true, options: [{ label: 'TOC' }, { label: 'Index' }] },
  ] },
};

test('allow / deny replies have the documented shape', () => {
  assert.deepEqual(buildDecision(bashEv, { type: 'allow' }),
    { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  const deny = buildDecision(bashEv, { type: 'deny', reason: '  use pnpm  ' }).hookSpecificOutput.decision;
  assert.deepEqual(deny, { behavior: 'deny', message: 'use pnpm' });
  assert.match(buildDecision(bashEv, { type: 'deny' }).hookSpecificOutput.decision.message, /Flocklet/);
});

test('always-allow only offers safe suggestions and passes the original object through', () => {
  const offered = permissionSuggestions(bashEv.permission_suggestions);
  assert.deepEqual(offered.map((s) => s.index), [0, 2], 'bypassPermissions is never offered');
  assert.match(offered[0].label, /Bash\(npm run build\)/);
  const d = buildDecision(bashEv, { type: 'always', index: 0 }).hookSpecificOutput.decision;
  assert.equal(d.behavior, 'allow');
  assert.deepEqual(d.updatedPermissions, [bashEv.permission_suggestions[0]]);
  assert.throws(() => buildDecision(bashEv, { type: 'always', index: 1 }), /unknown suggestion/);
});

test('question answers: labels validated, multi-select comma-joined, Other text allowed', () => {
  const d = buildDecision(qEv, { type: 'answer', answers: [{ labels: ['DOCX'] }, { labels: ['TOC', 'Index'] }] })
    .hookSpecificOutput.decision;
  assert.equal(d.behavior, 'allow');
  assert.deepEqual(d.updatedInput.answers, { 'Format?': 'DOCX', 'Extras?': 'TOC, Index' });
  assert.deepEqual(d.updatedInput.questions, qEv.tool_input.questions, 'original questions kept');

  const other = buildDecision(qEv, { type: 'answer', answers: [{ labels: [], other: 'Markdown' }, { labels: ['TOC'] }] });
  assert.equal(other.hookSpecificOutput.decision.updatedInput.answers['Format?'], 'Markdown');

  assert.throws(() => buildDecision(qEv, { type: 'answer', answers: [{ labels: ['EXE'] }, { labels: ['TOC'] }] }), /unknown option/);
  assert.throws(() => buildDecision(qEv, { type: 'answer', answers: [{ labels: ['PDF', 'DOCX'] }, { labels: ['TOC'] }] }), /single-select/);
  assert.throws(() => buildDecision(qEv, { type: 'answer', answers: [{ labels: ['PDF'] }, { labels: [] }] }), /unanswered/);
  assert.throws(() => buildDecision(bashEv, { type: 'answer', answers: [] }), /not a question/);
});

function fakeReply() {
  const r = { sent: [], closeFns: [] };
  r.send = (o) => r.sent.push(o);
  r.onClose = (fn) => r.closeFns.push(fn);
  return r;
}

test('native answer releases the held request; panel answer does not double-reply', () => {
  const broker = new Broker();
  const store = new SessionStore({ onRelease: (id) => broker.release(id) });
  const hook = (ev, opts) => store.applyHook({ session_id: 's', ...ev }, opts);

  // 1) user answers in Claude: tool runs, PostToolUse arrives -> empty reply
  hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b1', tool_input: bashEv.tool_input });
  const r1 = fakeReply();
  const id1 = broker.hold(bashEv, r1);
  hook(bashEv, { requestId: id1 });
  let card = store.snapshot().cards[0];
  assert.equal(card.waiting.actionable, true);
  assert.equal(card.waiting.suggestions.length, 2);
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'b1', tool_input: bashEv.tool_input });
  assert.deepEqual(r1.sent, [null]);
  assert.equal(broker.get(id1), null);

  // 2) user answers in the panel: exactly one reply, the decision
  hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b2', tool_input: bashEv.tool_input });
  const r2 = fakeReply();
  const id2 = broker.hold(bashEv, r2);
  hook(bashEv, { requestId: id2 });
  const out = buildDecision(bashEv, { type: 'allow' });
  assert.equal(broker.decide(id2, out), true);
  store.resolveWait(id2);
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'b2', tool_input: bashEv.tool_input });
  assert.deepEqual(r2.sent, [out]);
  assert.equal(store.snapshot().cards[0].state, 'working');

  // 3) Claude Code drops the request (timeout): card stays, but no longer actionable
  const r3 = fakeReply();
  const id3 = broker.hold(bashEv, r3);
  hook(bashEv, { requestId: id3 });
  r3.closeFns.forEach((fn) => fn());
  store.markStale(id3);
  card = store.snapshot().cards[0];
  assert.equal(card.state, 'waiting');
  assert.equal(card.waiting.actionable, false);
  assert.equal(broker.decide(id3, out), false);
});

test('two prompts in one session queue up; Stop releases everything', () => {
  const released = [];
  const store = new SessionStore({ onRelease: (id) => released.push(id) });
  store.applyHook({ session_id: 's', ...bashEv }, { requestId: 'r1' });
  store.applyHook({ session_id: 's', ...qEv }, { requestId: 'r2' });
  const card = store.snapshot().cards[0];
  assert.equal(card.waiting.kind, 'permission');
  assert.equal(card.moreWaiting, 1);
  store.applyHook({ session_id: 's', hook_event_name: 'Stop' });
  assert.deepEqual(released.sort(), ['r1', 'r2']);
  assert.equal(store.snapshot().cards[0].state, 'done');
});
