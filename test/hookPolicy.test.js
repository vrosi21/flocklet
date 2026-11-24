const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const H = require('../src/hookPolicy');

const url = 'http://127.0.0.1:4777/hook';

test('hooks run unless a policy or your own setting switches them off', () => {
  assert.equal(H.blockedReason({ url }), null);
  assert.equal(H.blockedReason({ managed: [{ allowManagedHooksOnly: true }], url }), 'org-only');
  assert.equal(H.blockedReason({ managed: [{ disableAllHooks: true }], url }), 'org-off');
  assert.equal(H.blockedReason({ managed: [{ strictPluginOnlyCustomization: ['hooks'] }], url }), 'org-only');
  assert.equal(H.blockedReason({ user: { disableAllHooks: true }, url }), 'you-off');
  assert.equal(H.blockedReason({ managed: [{ allowManagedHooksOnly: false }], user: { disableAllHooks: false }, url }), null);
  for (const k of ['org-only', 'org-off', 'you-off', 'url']) assert.match(H.MESSAGES[k], /session list still works/);
});

test('hook address allow-list: * is a wildcard, localhost counts, an empty list blocks', () => {
  assert.equal(H.blockedReason({ user: { allowedHttpHookUrls: ['https://hooks.example.com/*'] }, url }), 'url');
  assert.equal(H.blockedReason({ managed: [{ allowedHttpHookUrls: ['http://127.0.0.1:*'] }], url }), null);
  assert.equal(H.blockedReason({ user: { allowedHttpHookUrls: ['http://localhost:*'] }, url }), null, 'no false alarm');
  assert.equal(H.blockedReason({ user: { allowedHttpHookUrls: [] }, url }), 'url');
  assert.equal(H.urlAllowed(url, ['HTTP://127.0.0.1:4777/HOOK']), true, 'case-insensitive');
  assert.equal(H.urlAllowed(url, ['http://127.0.0.1:4778/*']), false);
});

test('reads the registry policy, the managed file and its drop-in folder, and your settings', async () => {
  const files = {
    [path.join('P', 'ClaudeCode', 'managed-settings.json')]: '{"companyName":"x"}',
    [path.join('P', 'ClaudeCode', 'managed-settings.d', '10-hooks.json')]: '{"allowManagedHooksOnly":true}',
    'user.json': '﻿{"disableAllHooks":false}',
  };
  const fs = {
    readFileSync: (f) => { if (f in files) return files[f]; throw new Error('ENOENT'); },
    readdirSync: (d) => { if (d === path.join('P', 'ClaudeCode', 'managed-settings.d')) return ['10-hooks.json', '.hidden.json', 'notes.txt']; throw new Error('ENOENT'); },
  };
  const regQuery = async (key) => (key.startsWith('HKLM')
    ? '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\ClaudeCode\r\n    Settings    REG_SZ    {"disableAllHooks": false}\r\n'
    : Promise.reject(new Error('not found')));
  const p = await H.readPolicies({ fs, regQuery, programFiles: 'P', settingsFile: 'user.json' });
  assert.equal(p.managed.length, 3);
  assert.deepEqual(p.user, { disableAllHooks: false });
  assert.equal(H.blockedReason({ ...p, url }), 'org-only');
});
