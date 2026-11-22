const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../renderer/tour-pages');

test('versions compare by number, not text', () => {
  assert.equal(T.compareVersions('0.4.10', '0.4.9'), 1);
  assert.equal(T.compareVersions('0.4.0', '0.4.0'), 0);
  assert.equal(T.compareVersions('0.3.2', '0.4.0'), -1);
  assert.equal(T.compareVersions('1.0', '0.9.9'), 1);
});

test('new users get the whole tour, updates only what is new, nothing twice', () => {
  const pages = [{ id: 'a', since: '0.4.0' }, { id: 'b', since: '0.4.0' }, { id: 'c', since: '0.5.0' }, { id: 'later', since: '9.0.0' }];
  const ids = (r) => [r.mode, r.pages.map((p) => p.id)];
  assert.deepEqual(ids(T.pagesFor({ seen: null, current: '0.5.0', pages })), ['tour', ['a', 'b', 'c']], 'first run: all shipped pages');
  assert.deepEqual(ids(T.pagesFor({ seen: '0.4.0', current: '0.5.0', pages })), ['whatsnew', ['c']], 'update: only newer pages');
  assert.deepEqual(ids(T.pagesFor({ seen: '0.5.0', current: '0.5.1', pages })), ['none', []], 'seen everything');
  assert.deepEqual(ids(T.pagesFor({ seen: '0.5.0', current: '0.5.1', forceTour: true, pages })), ['tour', ['a', 'b', 'c']], 'opened by hand');
  assert.deepEqual(ids(T.pagesFor({ seen: null, current: '0.3.2', pages })), ['none', []], 'older build: no empty tour window');
});

test('every page has an id, a version and a title', () => {
  for (const p of T.PAGES) assert.ok(p.id && /^\d+\.\d+\.\d+$/.test(p.since) && p.title, JSON.stringify(p));
  assert.equal(new Set(T.PAGES.map((p) => p.id)).size, T.PAGES.length);
});
