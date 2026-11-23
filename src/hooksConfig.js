// Adds / removes AgentDeck's hooks in ~/.claude/settings.json.
// AgentDeck installs on launch and removes on quit: Claude Code hot-loads hook changes,
// and a hook pointing at a closed port logs an error on every tool call.
const fs = require('fs');
const path = require('path');

const EVENTS = [
  // [event, matcher, timeoutSeconds]
  ['SessionStart', null, 5],
  ['UserPromptSubmit', null, 5],
  ['PreToolUse', '*', 5],
  ['PostToolUse', '*', 5],
  ['PostToolUseFailure', '*', 5],
  ['PermissionRequest', '*', 3600], // held open until you click in the panel (or answer in Claude)
  ['PermissionDenied', '*', 5],
  ['Notification', null, 5],
  ['Stop', null, 5],
  ['StopFailure', null, 5],
  ['SubagentStart', null, 5],
  ['SubagentStop', null, 5],
  ['SessionEnd', null, 5],
];

const TOKEN_HEADER = 'X-AgentDeck-Token';

// A prod copy (port 4777) and a dev copy (4778) can run side by side: each only touches the hooks that point at
// its own port, so one quitting never cuts the other off. Without a port: every Flocklet hook (old behaviour).
const hookUrl = (port) => `http://127.0.0.1:${port}/hook`;
const isOurs = (group, port = null) => (group.hooks || []).some(
  (h) => h && h.type === 'http' && h.headers && TOKEN_HEADER in h.headers && (port == null || h.url === hookUrl(port)));

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  return text.trim() ? JSON.parse(text) : {}; // throws on invalid JSON: never overwrite a file we can't parse
}

function writeSettings(file, data, backupDir) {
  if (backupDir && fs.existsSync(file)) {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(file, path.join(backupDir, `settings.${Date.now()}.json`));
    const old = fs.readdirSync(backupDir).filter((f) => /^settings\.\d+\.json$/.test(f)).sort();
    for (const f of old.slice(0, -10)) fs.rmSync(path.join(backupDir, f), { force: true });
  }
  const tmp = `${file}.agentdeck.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function stripOurs(data, port = null) {
  const hooks = data.hooks || {};
  let removed = 0;
  for (const ev of Object.keys(hooks)) {
    if (!Array.isArray(hooks[ev])) continue;
    const kept = hooks[ev].filter((g) => !isOurs(g, port));
    removed += hooks[ev].length - kept.length;
    if (kept.length) hooks[ev] = kept; else delete hooks[ev];
  }
  if (data.hooks && !Object.keys(data.hooks).length) delete data.hooks;
  return removed;
}

// observe: every event except PermissionRequest, so this copy can never hold Claude up (the dev copy).
function installHooks({ settingsFile, port, token, backupDir, observe = false }) {
  const data = readSettings(settingsFile);
  stripOurs(data, port);
  data.hooks = data.hooks || {};
  const url = hookUrl(port);
  for (const [ev, matcher, timeout] of EVENTS) {
    if (observe && ev === 'PermissionRequest') continue;
    const group = { hooks: [{ type: 'http', url, headers: { [TOKEN_HEADER]: token }, timeout }] };
    (data.hooks[ev] = data.hooks[ev] || []).push(matcher ? { matcher, ...group } : group);
  }
  writeSettings(settingsFile, data, backupDir);
}

function uninstallHooks({ settingsFile, backupDir, port = null }) {
  const data = readSettings(settingsFile);
  if (stripOurs(data, port) > 0) writeSettings(settingsFile, data, backupDir);
}

function hooksInstalled(settingsFile, port = null) {
  try {
    const hooks = readSettings(settingsFile).hooks || {};
    return Object.values(hooks).some((groups) => Array.isArray(groups) && groups.some((g) => isOurs(g, port)));
  } catch { return false; }
}

module.exports = { installHooks, uninstallHooks, hooksInstalled, EVENTS };
