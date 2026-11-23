const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installHooks, uninstallHooks, hooksInstalled, EVENTS } = require('../src/hooksConfig');

function tmpSettings(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-'));
  const file = path.join(dir, 'settings.json');
  if (content !== undefined) fs.writeFileSync(file, JSON.stringify(content, null, 2));
  return { dir, file, backupDir: path.join(dir, 'backups') };
}

const userHook = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] };

test('install adds every event, keeps user hooks and other settings; uninstall restores exactly', () => {
  const original = { model: 'opus', hooks: { PreToolUse: [userHook] }, enabledPlugins: { a: true } };
  const { file, backupDir } = tmpSettings(original);
  installHooks({ settingsFile: file, port: 4777, token: 't'.repeat(48), backupDir });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.model, 'opus');
  assert.deepEqual(after.hooks.PreToolUse[0], userHook);
  for (const [ev] of EVENTS) assert.ok(after.hooks[ev].length >= 1, ev);
  assert.ok(hooksInstalled(file));
  assert.ok(fs.readdirSync(backupDir).length >= 1, 'backup written');

  installHooks({ settingsFile: file, port: 4777, token: 't'.repeat(48), backupDir }); // idempotent
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.Stop.length, 1);

  uninstallHooks({ settingsFile: file, backupDir });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original);
  assert.equal(hooksInstalled(file), false);
});

test('missing settings file is created; invalid JSON is never overwritten', () => {
  const a = tmpSettings();
  installHooks({ settingsFile: a.file, port: 4777, token: 'x'.repeat(48), backupDir: a.backupDir });
  assert.ok(hooksInstalled(a.file));
  uninstallHooks({ settingsFile: a.file, backupDir: a.backupDir });
  assert.deepEqual(JSON.parse(fs.readFileSync(a.file, 'utf8')), {});

  const b = tmpSettings();
  fs.writeFileSync(b.file, '{ "model": "opus", ');
  assert.throws(() => installHooks({ settingsFile: b.file, port: 4777, token: 'x'.repeat(48), backupDir: b.backupDir }));
  assert.equal(fs.readFileSync(b.file, 'utf8'), '{ "model": "opus", ');
});

test('prod and dev copies only touch their own hooks; dev never gets PermissionRequest', () => {
  const { file, backupDir } = tmpSettings({});
  installHooks({ settingsFile: file, port: 4777, token: 'p'.repeat(48), backupDir });
  installHooks({ settingsFile: file, port: 4778, token: 'd'.repeat(48), backupDir, observe: true });
  let h = JSON.parse(fs.readFileSync(file, 'utf8')).hooks;
  assert.equal(h.Stop.length, 2);
  assert.equal(h.PermissionRequest.length, 1, 'only prod answers permissions');
  assert.ok(h.PermissionRequest[0].hooks[0].url.includes(':4777/'));
  uninstallHooks({ settingsFile: file, backupDir, port: 4778 });
  h = JSON.parse(fs.readFileSync(file, 'utf8')).hooks;
  assert.equal(h.Stop.length, 1);
  assert.ok(hooksInstalled(file, 4777));
  assert.equal(hooksInstalled(file, 4778), false);
});
