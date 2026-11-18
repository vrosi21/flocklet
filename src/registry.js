// Watches ~/.claude/sessions/<pid>.json - one file per live Claude Code process.
// Desktop sessions carry hostSessionId (local_...), the sidebar title and busy/idle status.
// Undocumented app internals: keep all knowledge of this format in this file.
const fs = require('fs');
const path = require('path');

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readRegistry(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const f of names) {
    if (!/^\d+\.json$/.test(f)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (d && d.sessionId && isAlive(d.pid)) out.push(d);
    } catch { /* file mid-write; next scan picks it up */ }
  }
  return out;
}

function watchRegistry(dir, onList, { pollMs = 4000 } = {}) {
  let timer = null;
  const scan = () => {
    clearTimeout(timer);
    timer = setTimeout(() => onList(readRegistry(dir)), 150);
  };
  let watcher = null;
  try { watcher = fs.watch(dir, scan); } catch { /* dir missing: polling still works */ }
  const poll = setInterval(scan, pollMs); // fs.watch can miss events on Windows
  scan();
  return () => { clearTimeout(timer); clearInterval(poll); if (watcher) watcher.close(); };
}

module.exports = { readRegistry, watchRegistry };
