// Plan usage (5-hour + weekly %) from Claude desktop's own history file:
//   %LOCALAPPDATA%\Claude-Data\claude_<id>\plan-usage-history.json
//   { version: 2, samples: [{ t: ms, org, u: { fh: 5-hour %, sd: 7-day %, ... } }] }
// Verified in the app's code (5.11492): the app appends a sample whenever it fetches usage (at most
// every 4.5 min). It polls every 5-15 min, but only for 24 h after its tray icon was right-clicked
// (config.json -> planUsageLastTrayOpenAt). We watch the file so new samples show up instantly,
// report that 24 h window, and drop values whose limit window has certainly reset since.
// Undocumented app internals: keep all knowledge of these files in this module.
const fs = require('fs');
const path = require('path');

const FIVE_H = 5 * 3600e3;
const WEEK = 7 * 24 * 3600e3;
const STALE_MS = 25 * 60e3;              // poller runs every <= 15 min while active
const AUTO_REFRESH_MS = 24 * 3600e3;
const HISTORY = 'plan-usage-history.json';

function findProfileDir(localAppData = process.env.LOCALAPPDATA) {
  if (!localAppData) return null;
  const root = path.join(localAppData, 'Claude-Data');
  let best = null;
  let bestMtime = 0;
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch { return null; }
  for (const d of dirs) {
    try {
      const m = fs.statSync(path.join(root, d, HISTORY)).mtimeMs;
      if (m > bestMtime) { best = path.join(root, d); bestMtime = m; }
    } catch { /* no history in this profile */ }
  }
  return best;
}

const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);

function parseUsage(text, now = Date.now()) {
  let samples;
  try { samples = JSON.parse(text).samples; } catch { return null; }
  if (!Array.isArray(samples)) return null;
  let s = null;
  for (const x of samples) if (x && typeof x.t === 'number' && x.u && (!s || x.t > s.t)) s = x;
  if (!s) return null;
  const age = Math.max(0, now - s.t);
  return {
    at: s.t,
    fiveHour: age < FIVE_H ? pct(s.u.fh) : null, // older than the window: it has reset since
    weekly: age < WEEK ? pct(s.u.sd) : null,
    stale: age > STALE_MS,
  };
}

// When Claude's background refresh stops (24 h after the last tray right-click), or null if unknown.
function autoRefreshUntil(configText) {
  try {
    const t = JSON.parse(configText).planUsageLastTrayOpenAt;
    return typeof t === 'number' && Number.isFinite(t) ? t + AUTO_REFRESH_MS : null;
  } catch { return null; }
}

function readUsage(dir, now = Date.now()) {
  let usage = null;
  try { usage = parseUsage(fs.readFileSync(path.join(dir, HISTORY), 'utf8'), now); } catch { return null; }
  if (!usage) return null;
  let until = null;
  try { until = autoRefreshUntil(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch { /* optional */ }
  return { ...usage, autoRefreshUntil: until, autoRefreshOn: until !== null && now < until };
}

function watchUsage(onUsage, { everyMs = 60e3, locate = findProfileDir } = {}) {
  let dir = null;
  let watcher = null;
  let debounce = null;
  const tick = () => {
    const found = locate();
    if (found !== dir) {
      if (watcher) watcher.close();
      watcher = null;
      dir = found;
      if (dir) {
        // The app writes atomically (temp file + rename), so watch the folder, not the file.
        try {
          watcher = fs.watch(dir, (_ev, name) => {
            if (name !== HISTORY && name !== 'config.json') return;
            clearTimeout(debounce);
            debounce = setTimeout(tick, 300);
          });
        } catch { /* polling still works */ }
      }
    }
    onUsage(dir ? readUsage(dir) : null);
  };
  tick();
  const timer = setInterval(tick, everyMs); // also re-ages the reading
  return () => { clearInterval(timer); clearTimeout(debounce); if (watcher) watcher.close(); };
}

module.exports = { parseUsage, autoRefreshUntil, readUsage, findProfileDir, watchUsage, STALE_MS };
