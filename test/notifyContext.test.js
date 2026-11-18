const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transitions } = require('../src/notify');
const { readContext, windowFor } = require('../src/context');

const c = (key, state, extra = {}) => ({ key, hostId: `local_${key}`, name: key.toUpperCase(), state, ...extra });

test('notifies on needs-you, done and error transitions only', () => {
  const prev = new Map();
  assert.deepEqual(transitions(prev, [c('a', 'working'), c('b', 'idle')], { first: true }), [], 'nothing on startup');
  assert.deepEqual(transitions(prev, [c('a', 'working'), c('b', 'idle')]), [], 'no change, no toast');

  const out = transitions(prev, [
    c('a', 'waiting', { waiting: { kind: 'question', title: 'Which format?' } }),
    c('b', 'done', { lastMessage: 'old news' }), // idle -> done is not a finished turn we saw
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { key: 'a', hostId: 'local_a', kind: 'waiting', title: 'A has a question', body: 'Which format?' });

  const done = transitions(prev, [c('a', 'done', { lastMessage: 'All set.' }), c('b', 'error', { error: 'rate_limit' })]);
  assert.deepEqual(done.map((n) => [n.kind, n.title, n.body]), [['done', 'A is done', 'All set.'], ['error', 'B stopped', 'rate_limit']]);
});

test('muted sessions and the global switch stay silent', () => {
  const prev = new Map([['a', 'working'], ['b', 'working']]);
  const cards = [c('a', 'done'), c('b', 'done')];
  assert.deepEqual(transitions(prev, cards, { quiet: ['a'] }).map((n) => n.key), ['b']);
  const prev2 = new Map([['a', 'working']]);
  assert.deepEqual(transitions(prev2, [c('a', 'done')], { enabled: false }), []);
});

test('context: last main-thread usage, % only for known window sizes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-ctx-'));
  const file = path.join(dir, 't.jsonl');
  const line = (o) => JSON.stringify(o);
  fs.writeFileSync(file, [
    line({ type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 100000 } } }),
    line({ type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 2, cache_creation_input_tokens: 998, cache_read_input_tokens: 249000 } } }),
    line({ type: 'assistant', isSidechain: true, message: { model: 'claude-haiku-5-5', usage: { input_tokens: 5 } } }),
    line({ type: 'user', message: { content: 'hi' } }),
  ].join('\n') + '\n');
  assert.deepEqual(readContext(file), { tokens: 250000, model: 'claude-opus-5-5', window: 1000000, pct: 25 });

  fs.writeFileSync(file, line({ type: 'assistant', message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 42000 } } }) + '\n');
  assert.deepEqual(readContext(file), { tokens: 42000, model: 'claude-sonnet-5-5', window: null, pct: null });
  assert.equal(windowFor('claude-sonnet-5-5[1m]'), 1000000);
  assert.equal(readContext(path.join(dir, 'missing.jsonl')), null);
});
