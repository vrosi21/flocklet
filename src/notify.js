// Which state changes deserve a Windows notification. Pure, so it can be tested without Electron.
const { clip } = require('./describe');

const WAIT_TEXT = { permission: 'needs permission', question: 'has a question', plan: 'has a plan for you', input: 'needs you' };

// prev: Map key -> state from the last snapshot (mutated). Returns notifications to show.
function transitions(prev, cards, { enabled = true, quiet = [], first = false } = {}) {
  const muted = new Set(quiet);
  const out = [];
  for (const c of cards) {
    const before = prev.get(c.key);
    prev.set(c.key, c.state);
    if (first || !enabled || muted.has(c.key) || before === undefined || before === c.state) continue;
    if (c.state === 'waiting') {
      out.push({ key: c.key, hostId: c.hostId, kind: 'waiting',
        title: `${c.name} ${WAIT_TEXT[c.waiting && c.waiting.kind] || 'needs you'}`,
        body: clip((c.waiting && c.waiting.title) || 'Open it to continue.', 180) });
    } else if (c.state === 'done' && (before === 'working' || before === 'waiting')) {
      out.push({ key: c.key, hostId: c.hostId, kind: 'done', title: `${c.name} is done`, body: clip(c.lastMessage || 'Finished its turn.', 180) });
    } else if (c.state === 'error') {
      out.push({ key: c.key, hostId: c.hostId, kind: 'error', title: `${c.name} stopped`, body: clip(c.error || 'Stopped with an error.', 180) });
    }
  }
  return out;
}

module.exports = { transitions };
