// Session state for AgentDeck. Pure Node (no Electron) so it can be unit-tested.
//
// Two inputs are merged here:
//   applyRegistry(list) - snapshots of ~/.claude/sessions/<pid>.json (title, desktop id, busy/idle/waiting)
//   applyHook(ev)       - Claude Code hook payloads POSTed to the local server
// snapshot() turns it into the view model the overlay renders.
//
// Each session keeps a queue of "waits" (things blocked on the user). A wait created from a held
// PermissionRequest carries a requestId; when it is cleared for any reason other than the user
// answering in the panel, onRelease(requestId) fires so the held HTTP request can be closed.
const { describeTool, describePermission, clip } = require('./describe');
const { permissionSuggestions, questionsOf } = require('./decisions');

const FORGET_MS = 10 * 60e3;     // sessions gone from the registry are dropped after this

function blank(id) {
  return {
    id, hostId: null, regName: null, desktopTitle: null, cwd: null, entrypoint: null,
    inRegistry: false, inDesktop: false, parentHostId: null, lastActivityAt: 0,
    onDeck: false,          // shown as a card until the user clicks X
    transcriptPath: null, context: null, // { tokens, pct, window, model }
    state: 'idle',          // idle | working | waiting | done | error
    activity: null, turnStartedAt: 0, lastEventAt: 0, doneAt: 0,
    plan: null,             // { items: [{content, status}], step? }
    waits: [],              // [{ requestId, kind, tool, toolUseId, title, detail, since, ... }]
    lastPre: null,          // last PreToolUse, used to give PermissionRequest a tool_use_id
    lastMessage: null, error: null, subagents: 0,
  };
}

const textOf = (resp) => {
  if (typeof resp === 'string') return resp;
  if (Array.isArray(resp)) return resp.map((b) => (b && b.text) || '').join(' ');
  return resp ? JSON.stringify(resp) : '';
};

function hueOf(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

class SessionStore {
  constructor({ now = () => Date.now(), onRelease = () => {} } = {}) {
    this.sessions = new Map();
    this.pendingDeck = new Set(); // deck keys restored from disk, applied when the session shows up
    this.now = now;
    this.onRelease = onRelease;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(); }

  _get(id) {
    let r = this.sessions.get(id);
    if (!r) { r = blank(id); this.sessions.set(id, r); this._claimDeck(r); }
    return r;
  }

  _addWait(r, w) {
    r.waits.push(w);
    r.state = 'waiting';
    r.onDeck = true;
  }

  // Remove waits matching pred. release=true: the user did not answer in the panel.
  _removeWaits(r, pred, { release = true } = {}) {
    const keep = [];
    for (const w of r.waits) {
      if (pred(w)) { if (release && w.requestId) this.onRelease(w.requestId); } else keep.push(w);
    }
    const changed = keep.length !== r.waits.length;
    r.waits = keep;
    if (changed && !keep.length && r.state === 'waiting') r.state = 'working';
    return changed;
  }

  _findByRequest(requestId) {
    for (const r of this.sessions.values()) if (r.waits.some((w) => w.requestId === requestId)) return r;
    return null;
  }

  // X on a card. It comes back on the next prompt, question or permission request.
  setContext(id, ctx) {
    const r = this.sessions.get(id);
    if (!r || JSON.stringify(r.context) === JSON.stringify(ctx)) return;
    r.context = ctx;
    this._emit();
  }

  // Sessions on the deck and where their transcript is (from hooks, or derived like Claude Code names it).
  contextTargets(projectsDir, join) {
    const out = [];
    for (const r of this.sessions.values()) {
      if (!r.onDeck) continue;
      let file = r.transcriptPath;
      if (!file && r.cwd && !r.id.startsWith('local_')) file = join(projectsDir, r.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${r.id}.jsonl`);
      if (file) out.push({ id: r.id, file });
    }
    return out;
  }

  hide(id) {
    const r = this.sessions.get(id);
    if (!r) return;
    r.onDeck = false;
    if (!r.inDesktop && !r.inRegistry) this._forget(r);
    this._emit();
  }

  // Cards survive restarts: keys are desktop ids where known (CLI ids change on restart).
  deckKeys() {
    return [...this.sessions.values()].filter((r) => r.onDeck).map((r) => r.hostId || r.id).sort();
  }

  restoreDeck(keys) {
    for (const k of keys || []) if (typeof k === 'string') this.pendingDeck.add(k);
    for (const r of this.sessions.values()) this._claimDeck(r);
    this._emit();
  }

  _claimDeck(r) {
    for (const k of [r.hostId, r.id]) {
      if (k && this.pendingDeck.delete(k)) r.onDeck = true;
    }
  }

  // The user answered in the panel: drop the wait without releasing (the broker already replied).
  resolveWait(requestId) {
    const r = this._findByRequest(requestId);
    if (r && this._removeWaits(r, (w) => w.requestId === requestId, { release: false })) this._emit();
  }

  // Claude Code closed the held request (timeout): the card stays, but buttons can't act any more.
  markStale(requestId) {
    const r = this._findByRequest(requestId);
    if (!r) return;
    for (const w of r.waits) if (w.requestId === requestId) w.requestId = null;
    this._emit();
  }

  applyRegistry(list) {
    const at = this.now();
    const seen = new Set();
    for (const e of list) {
      if (!e || !e.sessionId) continue;
      seen.add(e.sessionId);
      const r = this._get(e.sessionId);
      r.inRegistry = true;
      if (e.hostSessionId) { r.hostId = e.hostSessionId; this._dedupeHost(r); this._claimDeck(r); }
      r.regName = e.name || r.regName;
      r.cwd = e.cwd || r.cwd;
      r.entrypoint = e.entrypoint || r.entrypoint;
      const changedAt = e.statusUpdatedAt || 0;
      if (e.status === 'busy' && (r.state === 'idle' || ((r.state === 'done' || r.state === 'error') && changedAt > r.doneAt))) {
        // Busy before we heard any hook (widget started mid-turn, or a turn started by the app itself).
        r.state = 'working';
        r.turnStartedAt = changedAt || at;
        r.activity = r.activity || 'Working…';
        r.onDeck = true;
      } else if (e.status === 'idle' && r.state === 'working' && changedAt > r.lastEventAt) {
        // Turn ended and we missed Stop (e.g. widget was restarted).
        r.state = r.lastMessage ? 'done' : 'idle';
        r.doneAt = changedAt;
        r.activity = null;
      } else if (e.status === 'waiting' && !r.waits.length) {
        // The registry knows the session is blocked on you even if we missed the hook.
        this._addWait(r, { requestId: null, kind: 'input', tool: null, toolUseId: null, since: changedAt || at,
          title: 'Waiting for you in Claude', detail: '', fromRegistry: true });
      }
      if (e.status !== 'waiting' && this._removeWaits(r, (w) => w.fromRegistry) && !r.waits.length) {
        r.state = e.status === 'busy' ? 'working' : r.lastMessage ? 'done' : 'idle';
      }
    }
    for (const [id, r] of this.sessions) {
      if (seen.has(id)) continue;
      r.inRegistry = false;
      if (!r.inDesktop && !r.onDeck && at - r.lastEventAt > FORGET_MS) this._forget(r);
    }
    this._emit();
  }

  // Every non-archived session from Claude desktop's own store, running or not.
  applyDesktop(list) {
    const seenHosts = new Set();
    for (const s of list) {
      if (!s || !s.hostId || s.archived) continue;
      seenHosts.add(s.hostId);
      let r = (s.cliSessionId && this.sessions.get(s.cliSessionId)) || this._byHost(s.hostId);
      if (!r) r = this._get(s.cliSessionId || s.hostId);
      r.hostId = s.hostId;
      this._dedupeHost(r);
      this._claimDeck(r);
      r.inDesktop = true;
      r.desktopTitle = s.title || r.desktopTitle;
      r.cwd = r.cwd || s.cwd;
      r.parentHostId = s.parentHostId;
      r.lastActivityAt = Math.max(r.lastActivityAt, s.lastActivityAt || 0);
      r.entrypoint = r.entrypoint || 'claude-desktop';
    }
    for (const r of [...this.sessions.values()]) {
      if (!r.inDesktop || seenHosts.has(r.hostId)) continue;
      r.inDesktop = false; // archived or deleted in the app
      if (!r.inRegistry && !r.onDeck) this._forget(r);
    }
    this._emit();
  }

  _byHost(hostId) {
    for (const r of this.sessions.values()) if (r.hostId === hostId) return r;
    return null;
  }

  // A desktop session gets a new CLI id when the app restarts its process: fold the old record in.
  _dedupeHost(keep) {
    for (const other of [...this.sessions.values()]) {
      if (other === keep || other.hostId !== keep.hostId) continue;
      if (other.lastEventAt > keep.lastEventAt && keep.state === 'idle') {
        for (const k of ['state', 'activity', 'turnStartedAt', 'doneAt', 'plan', 'lastMessage', 'error', 'lastEventAt']) keep[k] = other[k];
      }
      keep.desktopTitle = keep.desktopTitle || other.desktopTitle;
      keep.inDesktop = keep.inDesktop || other.inDesktop;
      keep.parentHostId = keep.parentHostId || other.parentHostId;
      keep.lastActivityAt = Math.max(keep.lastActivityAt, other.lastActivityAt);
      keep.onDeck = keep.onDeck || other.onDeck;
      this._forget(other);
    }
  }

  _forget(r) {
    this._removeWaits(r, () => true);
    this.sessions.delete(r.id);
  }

  applyHook(ev, { at = this.now(), requestId = null } = {}) {
    if (!ev || !ev.session_id || !ev.hook_event_name) return;
    const r = this._get(ev.session_id);
    r.lastEventAt = at;
    if (ev.cwd && !r.cwd) r.cwd = ev.cwd;
    if (typeof ev.transcript_path === 'string') r.transcriptPath = ev.transcript_path;
    const tool = ev.tool_name;
    const input = ev.tool_input || {};

    switch (ev.hook_event_name) {
      case 'SessionStart':
        break;

      case 'UserPromptSubmit':
        this._removeWaits(r, () => true);
        Object.assign(r, { state: 'working', turnStartedAt: at, activity: 'Thinking…', plan: null,
          lastMessage: null, error: null, onDeck: true });
        break;

      case 'PreToolUse': {
        if (r.state !== 'working' && r.state !== 'waiting') { r.state = 'working'; r.turnStartedAt = at; r.onDeck = true; }
        const label = describeTool(tool, input);
        if (label) r.activity = label;
        r.lastPre = { toolUseId: ev.tool_use_id, tool, at };
        break;
      }

      case 'PermissionRequest': {
        // No tool_use_id on this event; the PreToolUse for the same tool arrives ~50 ms earlier.
        const paired = r.lastPre && r.lastPre.tool === tool && at - r.lastPre.at < 5000 ? r.lastPre.toolUseId : null;
        const kind = tool === 'AskUserQuestion' ? 'question' : tool === 'ExitPlanMode' ? 'plan' : 'permission';
        this._removeWaits(r, (w) => w.fromRegistry || w.kind === 'input'); // superseded by the real thing
        this._addWait(r, {
          requestId, kind, tool, toolUseId: paired, since: at, ...describePermission(tool, input),
          suggestions: kind === 'permission' ? permissionSuggestions(ev.permission_suggestions) : [],
          questions: kind === 'question' ? questionsOf(input) : [],
        });
        break;
      }

      case 'PostToolUse':
      case 'PostToolUseFailure':
      case 'PermissionDenied': {
        let matchedByName = false;
        this._removeWaits(r, (w) => {
          if (!w.tool) return true; // generic "needs input" wait: Claude moved on
          if (w.toolUseId) return w.toolUseId === ev.tool_use_id;
          if (w.tool === tool && !matchedByName) { matchedByName = true; return true; }
          return false;
        });
        if (ev.hook_event_name === 'PostToolUse') this._applyPlanTool(r, ev);
        break;
      }

      case 'Notification': {
        const t = ev.notification_type;
        if (!r.waits.length && (t === 'permission_prompt' || t === 'agent_needs_input' || t === 'elicitation_dialog')) {
          this._addWait(r, { requestId: null, kind: 'input', tool: null, toolUseId: null, since: at,
            title: clip(ev.message || 'Claude needs your input', 160), detail: '' });
        }
        break;
      }

      case 'Stop':
        this._removeWaits(r, () => true);
        Object.assign(r, { state: 'done', doneAt: at, activity: null,
          lastMessage: ev.last_assistant_message ? clip(ev.last_assistant_message, 280) : r.lastMessage });
        if (r.plan) r.plan.items.forEach((i) => { i.status = 'completed'; });
        break;

      case 'StopFailure':
        this._removeWaits(r, () => true);
        Object.assign(r, { state: 'error', doneAt: at, activity: null, onDeck: true,
          error: clip(ev.error || 'stopped with an error', 120) });
        break;

      case 'SubagentStart': r.subagents += 1; break;
      case 'SubagentStop': r.subagents = Math.max(0, r.subagents - 1); break;

      case 'SessionEnd':
        // The app stops idle processes; that must not remove a card or a sidebar session.
        this._removeWaits(r, () => true);
        if (r.state === 'working') r.state = r.lastMessage ? 'done' : 'idle';
        if (!r.inDesktop && !r.onDeck) this._forget(r);
        break;
    }
    this._emit();
  }

  _applyPlanTool(r, ev) {
    const input = ev.tool_input || {};
    if (ev.tool_name === 'mcp__ccd_turn__update_plan') {
      let items = r.plan ? r.plan.items.map((i) => ({ ...i })) : [];
      if (Array.isArray(input.items)) {
        items = input.items.map((i) => ({ content: String(i.content ?? ''), status: i.status || 'pending' }));
      }
      if (input.advance) {
        const cur = items.findIndex((i) => i.status === 'in_progress');
        if (cur >= 0) items[cur].status = 'completed';
        const next = items.findIndex((i) => i.status === 'pending');
        if (next >= 0) items[next].status = 'in_progress';
      }
      for (const n of input.done || []) if (items[n - 1]) items[n - 1].status = 'completed';
      if (input.start && items[input.start - 1]) items[input.start - 1].status = 'in_progress';
      r.plan = { items };
      // The app's own reply is the source of truth for the counter: "Plan updated: step 3 of 7 ..."
      const m = /step (\d+) of (\d+)/i.exec(textOf(ev.tool_response));
      if (m) r.plan.step = { index: +m[1], total: +m[2] };
    } else if (ev.tool_name === 'mcp__ccd_turn__wrap_up' && r.plan) {
      r.plan.items.forEach((i) => { i.status = 'completed'; });
      r.plan.step = null;
    } else if (ev.tool_name === 'TodoWrite' && Array.isArray(input.todos)) {
      r.plan = { items: input.todos.map((t) => ({
        content: String((t.status === 'in_progress' && t.activeForm) || t.content || ''), status: t.status || 'pending' })) };
    }
  }

  static progressOf(plan) {
    if (!plan || !plan.items.length) return null;
    const total = plan.items.length;
    const completed = plan.items.filter((i) => i.status === 'completed').length;
    const curIdx = plan.items.findIndex((i) => i.status === 'in_progress');
    const index = plan.step && plan.step.total === total ? plan.step.index : curIdx >= 0 ? curIdx + 1 : completed;
    const label = curIdx >= 0 ? plan.items[curIdx].content : completed === total ? 'All steps done' : plan.items[completed]?.content || '';
    return { index, total, ratio: total ? completed / total : 0, label: clip(label, 60) };
  }

  snapshot() {
    const now = this.now();
    const cards = [];
    for (const r of this.sessions.values()) {
      const active = r.onDeck;
      const w = r.waits[0];
      cards.push({
        id: r.id,
        key: r.hostId || r.id, // stable across restarts: used for pins and groups
        hostId: r.hostId,
        name: r.desktopTitle || r.regName || (r.cwd ? r.cwd.split(/[\\/]/).filter(Boolean).pop() : null) || r.id.slice(0, 8),
        parentHostId: r.parentHostId,
        lastActivityAt: Math.max(r.lastActivityAt, r.lastEventAt),
        cwd: r.cwd,
        state: r.state,
        activity: r.activity,
        progress: r.state === 'idle' ? null : SessionStore.progressOf(r.plan),
        waiting: w ? {
          id: w.requestId, kind: w.kind, title: w.title, detail: w.detail,
          actionable: !!w.requestId && (w.kind === 'permission' || w.kind === 'question'),
          suggestions: w.suggestions || [], questions: w.questions || [],
        } : null,
        moreWaiting: Math.max(0, r.waits.length - 1),
        lastMessage: r.lastMessage,
        error: r.error,
        since: r.state === 'working' || r.state === 'waiting' ? (w ? w.since : r.turnStartedAt) : r.doneAt,
        subagents: r.subagents,
        context: r.context,
        canJump: !!r.hostId,
        terminal: !!r.entrypoint && r.entrypoint !== 'claude-desktop',
        hue: hueOf(r.id),
        group: active ? 'active' : 'idle',
      });
    }
    const rank = { waiting: 0, error: 1, working: 2, done: 3, idle: 4 };
    cards.sort((a, b) => rank[a.state] - rank[b.state] ||
      (b.since || b.lastActivityAt || 0) - (a.since || a.lastActivityAt || 0) || a.name.localeCompare(b.name));
    const counts = { working: 0, waiting: 0, done: 0, idle: 0 };
    for (const c of cards) {
      if (c.group === 'idle') counts.idle += 1;
      else if (c.state === 'waiting') counts.waiting += 1;
      else if (c.state === 'working') counts.working += 1;
      else counts.done += 1;
    }
    return { cards, counts, at: now };
  }
}

module.exports = { SessionStore };
