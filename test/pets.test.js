const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../renderer/pets');

const now = 1_000_000_000;
test('pet state follows the card', () => {
  assert.equal(P.petState({ state: 'working', activity: 'Editing app.js' }, now), 'working');
  assert.equal(P.petState({ state: 'working', activity: 'Thinking…' }, now), 'thinking');
  assert.equal(P.petState({ state: 'working', activity: null }, now), 'thinking');
  assert.equal(P.petState({ state: 'waiting' }, now), 'waiting');
  assert.equal(P.petState({ state: 'done' }, now), 'done');
  assert.equal(P.petState({ state: 'error' }, now), 'error');
});

test('idle stays awake (no Zzz) until 15 minutes pass, then the pet falls asleep', () => {
  assert.equal(P.petState({ state: 'idle', since: now - 60e3 }, now), 'idle');
  assert.equal(P.petState({ state: 'idle' }, now), 'idle');
  assert.equal(P.petState({ state: 'idle', since: 0, lastActivityAt: now - 16 * 60e3 }, now), 'asleep');
});

test('every pet svg carries every expression and bubble; colours come from classes only', () => {
  for (const k of P.PETS) {
    const svg = P.petSvg(k);
    for (const part of ['eyes-open', 'eyes-closed', 'eyes-happy', 'eyes-focus', 'eyes-swirl', 'bub-dots', 'bub-bang', 'bub-x', 'bub-z', 'spark']) {
      assert.ok(svg.includes(`class="${part}"`), `${k} has ${part}`);
    }
    assert.ok(!/style=|fill="#|<script/i.test(svg), `${k}: no inline style, hex fill or script`);
  }
  assert.equal(P.petSvg('unknown'), P.petSvg('chick'));
});

test('default pet and colour slot are stable per hue', () => {
  assert.equal(P.defaultPet(0), 'chick');
  assert.equal(P.defaultPet(5), 'mochi');
  assert.equal(P.colorSlot(0), 1);
  assert.equal(P.colorSlot(11), 6);
});
