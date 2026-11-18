const test = require('node:test');
const assert = require('node:assert/strict');
const { chickBitmap, PIXELS, COLORS } = require('../src/trayIcon');

test('pixel map is 16x16 and only uses known colours', () => {
  assert.equal(PIXELS.length, 16);
  for (const row of PIXELS) {
    assert.equal(row.length, 16);
    for (const ch of row) assert.ok(ch === '.' || COLORS[ch], `unknown pixel ${ch}`);
  }
});

test('bitmap is BGRA at the asked size, with transparent corners', () => {
  for (const size of [32, 64]) {
    const { buf, width, height } = chickBitmap({ size });
    assert.equal(width, size);
    assert.equal(height, size);
    assert.equal(buf.length, size * size * 4);
    assert.equal(buf[3], 0, 'top-left corner transparent');
  }
});

test('status dot paints the bottom-right corner area', () => {
  const plain = chickBitmap({ size: 32 });
  const dotted = chickBitmap({ size: 32, dot: '#f5b942' });
  const i = (25 * 32 + 25) * 4;
  assert.deepEqual([...dotted.buf.subarray(i, i + 4)], [0x42, 0xb9, 0xf5, 255]);
  assert.notDeepEqual([...plain.buf.subarray(i, i + 4)], [...dotted.buf.subarray(i, i + 4)]);
});
