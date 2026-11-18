// Gives the app its own face on Windows: writes build/flocklet.ico from the Puffball pixel art and
// makes node_modules/electron/dist/Flocklet.exe, a copy of electron.exe with our icon and name.
// Task Manager shows the exe's FileDescription; the Start-menu shortcut (see main.js) uses the icon.
// Run again after `npm install` replaces Electron:  npm run brand
const fs = require('fs');
const path = require('path');
const { chickBitmap } = require('../src/trayIcon');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

// One ICO entry as a 32-bit BMP (DIB): BITMAPINFOHEADER, bottom-up BGRA rows, then a 1-bit AND mask.
function dibEntry(size) {
  const { buf, width: n } = chickBitmap({ size });
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(n, 4);
  header.writeInt32LE(n * 2, 8); // height counts colour + mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) buf.copy(pixels, (n - 1 - y) * n * 4, y * n * 4, (y + 1) * n * 4);
  const maskRow = Math.ceil(n / 32) * 4;
  const mask = Buffer.alloc(maskRow * n, 0); // all 0: alpha channel decides
  return Buffer.concat([header, pixels, mask]);
}

function buildIco(sizes = SIZES) {
  const entries = sizes.map(dibEntry);
  const dir = Buffer.alloc(6 + 16 * sizes.length);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // icon
  dir.writeUInt16LE(sizes.length, 4);
  let offset = dir.length;
  sizes.forEach((s, i) => {
    const o = 6 + 16 * i;
    dir[o] = s >= 256 ? 0 : s;
    dir[o + 1] = s >= 256 ? 0 : s;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(entries[i].length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += entries[i].length;
  });
  return Buffer.concat([dir, ...entries]);
}

async function main() {
  const root = path.join(__dirname, '..');
  const ico = path.join(root, 'build', 'flocklet.ico');
  fs.mkdirSync(path.dirname(ico), { recursive: true });
  fs.writeFileSync(ico, buildIco());
  console.log('icon:', ico);

  const dist = path.join(root, 'node_modules', 'electron', 'dist');
  const src = path.join(dist, 'electron.exe');
  const exe = path.join(dist, 'Flocklet.exe');
  const tmp = `${exe}.tmp`;
  fs.copyFileSync(src, tmp);
  const rcedit = require('rcedit');
  const { version } = require('../package.json');
  await rcedit(tmp, {
    icon: ico,
    'file-version': version,
    'product-version': version,
    'version-string': {
      FileDescription: 'Flocklet',
      ProductName: 'Flocklet',
      InternalName: 'Flocklet',
      OriginalFilename: 'Flocklet.exe',
      CompanyName: 'Flocklet',
      LegalCopyright: '',
    },
  });
  fs.renameSync(tmp, exe); // fails if Flocklet.exe is running: quit Flocklet first
  console.log('exe:', exe);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { buildIco };
