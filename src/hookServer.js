// Local HTTP endpoint that Claude Code's `type: "http"` hooks POST to.
// onEvent(ev, reply) returns true when it keeps the request open (a held PermissionRequest)
// and answers later via reply.send(obj | null). Otherwise the request gets an empty 200 at once,
// which Claude Code treats as "no opinion".
const http = require('http');
const crypto = require('crypto');

const MAX_BODY = 10 * 1024 * 1024; // Write/Edit inputs can be large

function tokenMatches(given, expected) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function startHookServer({ port, token, onEvent, onError = () => {} }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const end = (code) => { res.writeHead(code); res.end(); };
      if (req.method !== 'POST' || req.url !== '/hook') return end(404);
      if (req.headers.origin) return end(403); // browsers always send Origin; Claude Code does not
      if (!tokenMatches(req.headers['x-agentdeck-token'], token)) return end(401);

      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { end(413); req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => {
        if (res.writableEnded) return;
        let ev;
        try { ev = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return end(400); }
        const reply = {
          send(obj) {
            if (res.writableEnded || res.destroyed) return;
            if (!obj) return end(200);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(obj));
          },
          onClose(fn) { res.on('close', () => { if (!res.writableEnded) fn(); }); },
        };
        let held = false;
        try { held = onEvent(ev, reply) === true; } catch (e) { onError(e); }
        if (!held) reply.send(null);
      });
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      server.on('error', onError);
      resolve(server);
    });
  });
}

module.exports = { startHookServer };
