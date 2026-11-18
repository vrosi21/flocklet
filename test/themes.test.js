const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../renderer/themes');

test('normalizeTheme falls back to Campfire + Pocket + palette mode', () => {
  assert.deepEqual(T.normalizeTheme(undefined), { palette: 'campfire', look: 'pocket', mode: 'palette' });
  assert.deepEqual(T.normalizeTheme({ palette: 'nope', look: 'shell', mode: 7 }), { palette: 'campfire', look: 'shell', mode: 'palette' });
  assert.deepEqual(T.normalizeTheme({ palette: 'lagoon', look: 'tube', mode: 'light', extra: 1 }), { palette: 'lagoon', look: 'tube', mode: 'light' });
});

test('resolveMode: palette uses its native mode, windows follows the system', () => {
  assert.equal(T.resolveMode({ palette: 'campfire' }), 'dark');
  assert.equal(T.resolveMode({ palette: 'marshmallow' }), 'light');
  assert.equal(T.resolveMode({ palette: 'marshmallow', mode: 'dark' }), 'dark');
  assert.equal(T.resolveMode({ mode: 'windows' }, true), 'dark');
  assert.equal(T.resolveMode({ mode: 'windows' }, false), 'light');
});

test('theme.css has a native block and a twin block for every palette, and a block for every look', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'theme.css'), 'utf8');
  const sel = (s) => s.replace(/[[\]]/g, (c) => '\\' + c);
  for (const p of T.PALETTES) {
    const twin = p.native === 'dark' ? 'light' : 'dark';
    assert.match(css, new RegExp(sel(`[data-palette="${p.id}"]`) + '\\s*[,{]'), `${p.id} native block`);
    assert.match(css, new RegExp(sel(`[data-palette="${p.id}"][data-mode="${twin}"]`)), `${p.id} ${twin} twin`);
  }
  for (const l of T.LOOKS) assert.match(css, new RegExp(sel(`[data-look="${l.id}"]`)), `${l.id} look block`);
});
