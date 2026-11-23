const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../renderer/themes');

test('normalizeTheme falls back to the neutral default (Graphite + Studio, following Windows)', () => {
  assert.deepEqual(T.normalizeTheme(undefined), { palette: 'graphite', look: 'studio', mode: 'windows' });
  assert.deepEqual(T.normalizeTheme({ palette: 'nope', look: 'shell', mode: 7 }), { palette: 'graphite', look: 'shell', mode: 'windows' });
  assert.deepEqual(T.normalizeTheme({ palette: 'campfire', look: 'pocket', mode: 'palette' }), { palette: 'campfire', look: 'pocket', mode: 'palette' }, 'old configs keep their theme');
  assert.deepEqual(T.normalizeTheme({ palette: 'lagoon', look: 'tube', mode: 'light', extra: 1 }), { palette: 'lagoon', look: 'tube', mode: 'light' });
});

test('resolveMode: palette uses its native mode, windows follows the system', () => {
  assert.equal(T.resolveMode({ palette: 'campfire', mode: 'palette' }), 'dark');
  assert.equal(T.resolveMode({ palette: 'marshmallow', mode: 'palette' }), 'light');
  assert.equal(T.resolveMode({ palette: 'campfire' }, true), 'dark', 'default mode follows Windows');
  assert.equal(T.resolveMode({ palette: 'campfire' }, false), 'light');
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

test('presets name real palettes and looks, and the first one is the default', () => {
  assert.ok(T.PRESETS.length >= 4);
  assert.equal(new Set(T.PRESETS.map((p) => p.id)).size, T.PRESETS.length);
  for (const p of T.PRESETS) {
    assert.ok(T.PALETTES.some((x) => x.id === p.palette), p.id);
    assert.ok(T.LOOKS.some((x) => x.id === p.look), p.id);
    assert.ok(p.name && p.blurb, p.id);
  }
  assert.equal(T.presetOf(T.DEFAULT).id, T.PRESETS[0].id);
  assert.equal(T.presetOf({ palette: 'lagoon', look: 'tube' }), null, 'a mix of your own is no preset');
  assert.equal(T.MODES[0].id, T.DEFAULT.mode, 'Auto (follow Windows) comes first');
});

test('every palette and look has a feel score', () => {
  for (const x of [...T.PALETTES, ...T.LOOKS]) assert.ok(T.TRAITS[x.id], x.id);
});

test('shuffle never repeats, respects locks and favours good pairs', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cur = { palette: 'graphite', look: 'studio', mode: 'windows' };
  const counts = new Map();
  for (let i = 0; i < 3000; i++) {
    const t = T.shuffle(cur, {}, rnd);
    assert.ok(!(t.palette === cur.palette && t.look === cur.look));
    const k = `${t.palette}/${t.look}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  assert.ok((counts.get('phosphor/tube') || 0) > (counts.get('marshmallow/arcade') || 0) * 3, 'a preset beats a clash');
  for (let i = 0; i < 200; i++) {
    const t = T.shuffle(cur, { palette: true, mode: true }, rnd);
    assert.equal(t.palette, 'graphite');
    assert.equal(t.mode, 'windows');
  }
  assert.deepEqual(T.shuffle(cur, { palette: true, look: true, mode: true }, rnd), cur);
});

test('the feel sliders land on matching themes and read back', () => {
  const calm = T.fromFeel(0, 0.5, T.DEFAULT);
  assert.equal(calm.palette, 'graphite');
  const loud = T.fromFeel(1, 1, T.DEFAULT);
  assert.ok(T.TRAITS[loud.palette].mood >= 0.7 && T.TRAITS[loud.look].mood >= 0.7, JSON.stringify(loud));
  assert.equal(loud.mode, T.DEFAULT.mode, 'light / dark is untouched');
  assert.deepEqual(T.feelOf(T.DEFAULT), { mood: 0, crisp: 0.5 });
});
