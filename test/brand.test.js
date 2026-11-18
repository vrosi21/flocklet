const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIco } = require('../scripts/brand');

test('ico: directory matches entries, 256 stored as 0', () => {
  const ico = buildIco([16, 256]);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 2);
  const e = (i, off) => 6 + 16 * i + off;
  assert.equal(ico[e(0, 0)], 16);
  assert.equal(ico[e(1, 0)], 0);
  const size0 = ico.readUInt32LE(e(0, 8)), off0 = ico.readUInt32LE(e(0, 12));
  assert.equal(size0, 40 + 16 * 16 * 4 + 4 * 16);
  assert.equal(ico.readUInt32LE(e(1, 12)), off0 + size0);
  assert.equal(ico.readInt32LE(off0 + 8), 32, 'DIB height is doubled');
  assert.equal(ico.length, ico.readUInt32LE(e(1, 12)) + ico.readUInt32LE(e(1, 8)));
});
