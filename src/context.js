// How full a session's context window is, from the last assistant message's usage in its transcript
// (input + cache creation + cache read tokens: the same formula Claude Code's status line uses).
const fs = require('fs');

const TAIL_BYTES = 512 * 1024;

// Context window sizes we have actually verified. Unknown models show tokens only, never a guess.
const WINDOWS = [
  [/^claude-opus-5-5(\b|$)/, 1_000_000], // desktop get_usage: contextWindow 1000000 (2026-11-17)
];

function windowFor(model) {
  if (typeof model !== 'string') return null;
  if (/\[1m\]/i.test(model)) return 1_000_000;
  for (const [re, size] of WINDOWS) if (re.test(model)) return size;
  return null;
}

function usedTokens(u) {
  if (!u) return null;
  const n = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  return n > 0 ? n : null;
}

// Last main-thread assistant usage in the tail of a transcript (subagent turns are skipped).
function readContext(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; } // first line of the tail is usually cut
      if (r.type !== 'assistant' || r.isSidechain || !r.message) continue;
      const tokens = usedTokens(r.message.usage);
      if (tokens == null) continue;
      const window = windowFor(r.message.model);
      return { tokens, model: r.message.model || null, window, pct: window ? Math.min(100, Math.round((tokens / window) * 100)) : null };
    }
  } catch { /* missing or locked transcript */ } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
  return null;
}

module.exports = { readContext, windowFor, usedTokens };
