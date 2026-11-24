// Will Claude Code run Flocklet's hooks? Read-only: Flocklet looks at the same policy Claude Code reads and says so
// when hooks are switched off; it never changes or works around that policy (code.claude.com/docs/en/hooks,
// /settings, /managed-settings; checked 2026-11-24).
//   - managed policy (an admin's): C:\Program Files\ClaudeCode\managed-settings.json + managed-settings.d\*.json,
//     and the registry value HKLM / HKCU \SOFTWARE\Policies\ClaudeCode "Settings" (JSON).
//   - your own ~/.claude/settings.json
// Server-managed policy (from the admin console) is not on disk in a known place, so it cannot be seen here.
const path = require('path');

const REG_KEYS = ['HKLM\\SOFTWARE\\Policies\\ClaudeCode', 'HKCU\\SOFTWARE\\Policies\\ClaudeCode'];

const parse = (text) => { try { const v = JSON.parse(String(text).replace(/^\uFEFF/, '')); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
// allowedHttpHookUrls patterns use * as the wildcard. The docs show "http://localhost:*" but do not say whether it
// covers 127.0.0.1, so a localhost pattern counts as allowing Flocklet (no false alarm).
function urlAllowed(url, patterns) {
  const asLocalhost = url.replace('//127.0.0.1', '//localhost');
  return patterns.some((p) => {
    if (typeof p !== 'string') return false;
    const re = new RegExp(`^${p.split('*').map(escapeRe).join('.*')}$`, 'i');
    return re.test(url) || re.test(asLocalhost);
  });
}

// managed: the admin's policy documents; user: your ~/.claude/settings.json. Returns null (hooks run) or why not.
function blockedReason({ managed = [], user = null, url }) {
  const m = managed.filter(Boolean);
  if (m.some((s) => s.allowManagedHooksOnly === true)) return 'org-only';
  if (m.some((s) => s.disableAllHooks === true)) return 'org-off';
  if (m.some((s) => Array.isArray(s.strictPluginOnlyCustomization) && s.strictPluginOnlyCustomization.includes('hooks'))) return 'org-only';
  if (user && user.disableAllHooks === true) return 'you-off';
  const lists = [...m, user].filter((s) => s && Array.isArray(s.allowedHttpHookUrls)).map((s) => s.allowedHttpHookUrls);
  if (lists.length && !urlAllowed(url, lists.flat())) return 'url';
  return null;
}

const MESSAGES = {
  'org-only': 'Your organisation lets Claude Code run only its own hooks, so live states and answering from here are off. The session list still works.',
  'org-off': 'Your organisation has switched off Claude Code hooks, so live states and answering from here are off. The session list still works.',
  'you-off': 'Hooks are switched off in your Claude Code settings (disableAllHooks), so live states and answering from here are off. The session list still works.',
  url: "Your Claude Code settings only allow some hook addresses and Flocklet's is not one of them, so live states and answering from here are off. The session list still works.",
};

// Read the policy documents Claude Code would read. fs and a promisified `reg query` runner are passed in.
async function readPolicies({ fs, regQuery, programFiles, settingsFile }) {
  const managed = [];
  for (const key of REG_KEYS) {
    try {
      const out = await regQuery(key);
      const m = /Settings\s+REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(out || '');
      if (m) managed.push(parse(m[1].trim()));
    } catch { /* no policy there */ }
  }
  const dir = path.join(programFiles || 'C:\\Program Files', 'ClaudeCode');
  try { managed.push(parse(fs.readFileSync(path.join(dir, 'managed-settings.json'), 'utf8'))); } catch { /* none */ }
  try {
    for (const f of fs.readdirSync(path.join(dir, 'managed-settings.d')).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort()) {
      try { managed.push(parse(fs.readFileSync(path.join(dir, 'managed-settings.d', f), 'utf8'))); } catch { /* unreadable */ }
    }
  } catch { /* no drop-in folder */ }
  let user = null;
  try { user = parse(fs.readFileSync(settingsFile, 'utf8')); } catch { /* none yet */ }
  return { managed: managed.filter(Boolean), user };
}

module.exports = { blockedReason, urlAllowed, readPolicies, MESSAGES, REG_KEYS };
