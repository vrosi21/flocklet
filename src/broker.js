// Holds PermissionRequest hook requests open until the user clicks in the panel.
// Claude desktop shows its own dialog at the same time; whichever answers first wins.
// If the native dialog wins, Claude does NOT cancel our request, so the store tells us
// (via release) once the tool ran and we close the request with an empty reply.
const crypto = require('crypto');

class Broker {
  constructor({ maxHoldMs = 3550e3, onGone = () => {} } = {}) {
    this.pending = new Map();
    this.maxHoldMs = maxHoldMs; // stay under the hook's 3600 s timeout
    this.onGone = onGone;       // request closed by Claude Code before anyone answered
  }

  hold(ev, reply) {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => this.release(id), this.maxHoldMs);
    this.pending.set(id, { ev, reply, timer });
    reply.onClose(() => {
      const p = this.pending.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(id);
      this.onGone(id);
    });
    return id;
  }

  get(id) { return this.pending.get(id) || null; }

  _take(id) {
    const p = this.pending.get(id);
    if (!p) return null;
    clearTimeout(p.timer);
    this.pending.delete(id);
    return p;
  }

  // No opinion: Claude keeps using its own dialog / result.
  release(id) { const p = this._take(id); if (p) p.reply.send(null); }

  decide(id, output) {
    const p = this._take(id);
    if (!p) return false;
    p.reply.send(output);
    return true;
  }

  releaseAll() { for (const id of [...this.pending.keys()]) this.release(id); }
}

module.exports = { Broker };
