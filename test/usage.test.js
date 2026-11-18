const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUsage, autoRefreshUntil } = require('../src/usage');

const H = 3600e3;
const NOW = 1_800_000_000_000;
const file = (...samples) => JSON.stringify({ version: 2, samples });

test('latest sample wins, values rounded and clamped', () => {
  const u = parseUsage(file(
    { t: NOW - 3 * H, org: 'a', u: { fh: 90, sd: 40 } },
    { t: NOW - 10 * 60e3, org: 'a', u: { fh: 7.4, sd: 120 } },
  ), NOW);
  assert.deepEqual(u, { at: NOW - 10 * 60e3, fiveHour: 7, weekly: 100, stale: false });
});

test('auto-refresh window is 24 h after the last tray right-click', () => {
  assert.equal(autoRefreshUntil(JSON.stringify({ planUsageLastTrayOpenAt: NOW })), NOW + 24 * H);
  assert.equal(autoRefreshUntil('{}'), null);
  assert.equal(autoRefreshUntil('nope'), null);
});

test('old samples: 5-hour value dropped after 5 h, weekly after 7 days, marked stale', () => {
  const u = parseUsage(file({ t: NOW - 6 * H, org: 'a', u: { fh: 100, sd: 38 } }), NOW);
  assert.equal(u.fiveHour, null);
  assert.equal(u.weekly, 38);
  assert.equal(u.stale, true);
  assert.equal(parseUsage(file({ t: NOW - 8 * 24 * H, u: { fh: 1, sd: 2 } }), NOW).weekly, null);
});

test('garbage and empty files give null', () => {
  assert.equal(parseUsage('not json', NOW), null);
  assert.equal(parseUsage(file(), NOW), null);
  assert.equal(parseUsage('{"version":2}', NOW), null);
});
