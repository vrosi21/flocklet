// Puffball as 16×16 pixel art for the tray (and toasts). Pure Node: returns a BGRA buffer
// for nativeImage.createFromBitmap, so it can be unit-tested without Electron.
const PIXELS = [
  '.......OOO......',
  '......O..O......',
  '.......O........',
  '.....SSSSSS.....',
  '...SSYYYYYYSS...',
  '..SYYYYYYYYYYS..',
  '.SYYYYYYYYYYYYS.',
  '.SYYEWYYYYEWYYS.',
  'SYYYEEYYYYEEYYYS',
  'SYPPYYYOOYYYPPYS',
  'SYYYYBBBBBBYYYYS',
  '.SYYBBBBBBBBYYS.',
  '.SYYBBBBBBBBYYS.',
  '..SYYBBBBBBYYS..',
  '...SSYYYYYYSS...',
  '.....SSSSSS.....',
];
const COLORS = {
  Y: '#ffd23f', // body
  B: '#ffe68a', // belly
  S: '#d9a400', // outline, readable on light and dark taskbars
  O: '#ff8c42', // tuft, beak
  E: '#2a1f1a', // eyes
  W: '#ffffff', // eye highlight
  P: '#ff9ec0', // blush
};

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// size: output pixels (multiple of 16). dot: optional status colour drawn bottom-right.
function chickBitmap({ size = 32, dot = null } = {}) {
  const scale = Math.max(1, Math.round(size / 16));
  const n = 16 * scale;
  const buf = Buffer.alloc(n * n * 4);
  const put = (x, y, [r, g, b], a = 1) => {
    const i = (y * n + x) * 4;
    buf[i] = Math.round(b * a); buf[i + 1] = Math.round(g * a); buf[i + 2] = Math.round(r * a); buf[i + 3] = Math.round(255 * a); // BGRA, premultiplied
  };
  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      const hex = COLORS[PIXELS[py][px]];
      if (!hex) continue;
      const c = rgb(hex);
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(px * scale + dx, py * scale + dy, c);
    }
  }
  if (dot) {
    const c = rgb(dot);
    const ring = rgb('#19191d');
    const cx = n - 3.6 * scale, cy = n - 3.6 * scale, r = 3 * scale;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r) put(x, y, c);
        else if (d <= r + scale * 0.75) put(x, y, ring);
      }
    }
  }
  return { buf, width: n, height: n, scaleFactor: n / 16 };
}

module.exports = { chickBitmap, PIXELS, COLORS };
