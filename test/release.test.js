const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../src/release');

test('settings move once from the old agentdeck folder, own files only', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'flocklet-appdata-'));
  const old = path.join(appData, 'agentdeck');
  fs.mkdirSync(path.join(old, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(old, 'config.json'), '{"a":1}');
  fs.writeFileSync(path.join(old, 'deck.json'), '[]');
  fs.writeFileSync(path.join(old, 'Cookies'), 'chromium stuff');
  assert.equal(R.migrateSettings(appData), true);
  const dir = R.settingsDir(appData);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['config.json', 'deck.json']);
  assert.ok(fs.existsSync(path.join(old, 'config.json')), 'old folder is left alone');
  fs.writeFileSync(path.join(dir, 'config.json'), '{"a":2}');
  assert.equal(R.migrateSettings(appData), false, 'never twice');
  assert.equal(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'), '{"a":2}');
});

test('start with Windows: on by default for the installed app, never for a source copy', () => {
  const calls = [];
  const app = (isPackaged) => ({ isPackaged, setLoginItemSettings: (o) => calls.push(o) });
  const cfg = {};
  R.initStartup(app(false), cfg, () => {});
  assert.equal(cfg.startup, undefined);
  assert.equal(calls.length, 0);
  let saved = 0;
  R.initStartup(app(true), cfg, () => { saved += 1; });
  assert.deepEqual([cfg.startup, saved, calls.at(-1)], [true, 1, { openAtLogin: true }]);
  R.setStartup(app(true), cfg, false);
  assert.deepEqual([cfg.startup, calls.at(-1)], [false, { openAtLogin: false }]);
  R.initStartup(app(true), cfg, () => { saved += 1; });
  assert.deepEqual([cfg.startup, saved], [false, 1], 'your choice sticks');
});

test('release notes become short plain text', () => {
  assert.equal(R.plainNotes('<h2>New</h2><ul><li>Pet dock</li><li>Fix &amp; polish</li></ul>'), 'New\n• Pet dock\n• Fix & polish');
  assert.equal(R.plainNotes([{ note: 'a' }, { note: 'b' }]), 'a\nb');
  assert.equal(R.plainNotes(null), '');
});
