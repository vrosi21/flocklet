// Claude desktop's own session store: every sidebar session, whether its process runs or not.
//   %LOCALAPPDATA%\Claude-Data\claude_<id>\claude-code-sessions\<account>\<org>\local_<id>.json
// The ~/.claude/sessions registry only lists sessions with a live process, and the app stops idle
// ones; this store is why sessions no longer vanish from the deck.
// Undocumented app internals: keep all knowledge of this format in this module.
const fs = require('fs');
const path = require('path');

function sessionDirs(localAppData = process.env.LOCALAPPDATA) {
  const out = [];
  if (!localAppData) return out;
  const root = path.join(localAppData, 'Claude-Data');
  const ls = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };
  for (const profile of ls(root)) {
    const base = path.join(root, profile, 'claude-code-sessions');
    for (const account of ls(base)) {
      for (const org of ls(path.join(base, account))) out.push({ dir: path.join(base, account, org), account });
    }
  }
  return out;
}

function toSession(d, account) {
  if (!d || typeof d.sessionId !== 'string' || !d.sessionId.startsWith('local_')) return null;
  return {
    hostId: d.sessionId,
    cliSessionId: typeof d.cliSessionId === 'string' ? d.cliSessionId : null,
    title: typeof d.title === 'string' ? d.title : null,
    cwd: typeof d.cwd === 'string' ? d.cwd : null,
    archived: d.isArchived === true,
    parentHostId: d.spawnedFrom && typeof d.spawnedFrom.sessionId === 'string' ? d.spawnedFrom.sessionId : null,
    lastActivityAt: typeof d.lastActivityAt === 'number' ? d.lastActivityAt : 0,
    account,
  };
}

// cache: Map<file, {mtimeMs, session}> so only changed files are parsed again.
function readDesktopSessions(cache = new Map(), locate = sessionDirs) {
  const all = [];
  const live = new Set();
  for (const { dir, account } of locate()) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!/^local_[A-Za-z0-9-]+\.json$/.test(n)) continue;
      const file = path.join(dir, n);
      live.add(file);
      let mtimeMs;
      try { mtimeMs = fs.statSync(file).mtimeMs; } catch { continue; }
      const hit = cache.get(file);
      if (hit && hit.mtimeMs === mtimeMs) { if (hit.session) all.push(hit.session); continue; }
      let session = null;
      try { session = toSession(JSON.parse(fs.readFileSync(file, 'utf8')), account); } catch { /* mid-write */ continue; }
      cache.set(file, { mtimeMs, session });
      if (session) all.push(session);
    }
  }
  for (const f of cache.keys()) if (!live.has(f)) cache.delete(f);
  // Several logins can leave stores behind: keep the account with the most recent activity.
  let current = null;
  let latest = -1;
  for (const s of all) if (s.lastActivityAt > latest) { latest = s.lastActivityAt; current = s.account; }
  return all.filter((s) => s.account === current);
}

function watchDesktopSessions(onList, { everyMs = 5000 } = {}) {
  const cache = new Map();
  const tick = () => onList(readDesktopSessions(cache));
  tick();
  const timer = setInterval(tick, everyMs);
  return () => clearInterval(timer);
}

module.exports = { readDesktopSessions, watchDesktopSessions, toSession };
