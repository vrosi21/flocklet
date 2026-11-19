// Flocklet overlay. Untrusted strings (titles, commands, messages) only ever go
// through text nodes; innerHTML is used solely for constant SVGs (icons below, pets.js).
const api = window.agentdeck;
const T = window.FlockletThemes;
const P = window.FlockletPets;
const EPOCH = Date.now();
let state = null;
const prevStates = new Map();
let firstRender = true;

const ICONS = {
  jump: '<svg viewBox="0 0 16 16"><path d="M6 3.5h6.5V10M12.5 3.5 4 12" /></svg>',
  close: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>',
  sound: '<svg viewBox="0 0 16 16"><path d="M3 6.5h2.5L9 4v8L5.5 9.5H3z" /><path d="M11 6.2a2.6 2.6 0 0 1 0 3.6" /></svg>',
  mute: '<svg viewBox="0 0 16 16"><path d="M3 6.5h2.5L9 4v8L5.5 9.5H3z" /><path d="M11 6.5l3 3M14 6.5l-3 3" /></svg>',
  up: '<svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4" /></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" /></svg>',
  chev: '<svg viewBox="0 0 16 16"><path d="M4.5 6l3.5 3.5L11.5 6" /></svg>',
  pin: '<svg viewBox="0 0 16 16"><path d="M6 2.5h4M7 2.5v4L5 9.5h6L9 6.5v-4M8 9.5V14" /></svg>',
  more: '<svg viewBox="0 0 16 16"><path d="M4 8h.01M8 8h.01M12 8h.01" stroke-width="2.6" /></svg>',
  bell: '<svg viewBox="0 0 16 16"><path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3zM6.5 14h3" /></svg>',
  bellOff: '<svg viewBox="0 0 16 16"><path d="M4 11V7.5a4 4 0 0 1 6.2-3.3M12 7.5V11l1 1.5H5M6.5 14h3M2.5 2.5l11 11" /></svg>',
  list: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M3 8h10M3 11.5h6" /></svg>',
  gear: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" /></svg>',
  dock: '<svg viewBox="0 0 16 16"><rect x="2.5" y="9.5" width="11" height="4" rx="1.5" /><path d="M5 7h.01M8 7h.01M11 7h.01" stroke-width="2.4" /></svg>',
  expand: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M2.5 6h11" /></svg>',
  minimise: '<svg viewBox="0 0 16 16"><path d="M4 11.5h8" /></svg>',
  sidebar: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="10" rx="2" /><path d="M6.5 3v10" /></svg>',
  grip: '<svg viewBox="0 0 16 16"><path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" stroke-width="2.4" /></svg>',
  refresh: '<svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.8v2.9h-2.9" /></svg>',
  brush: '<svg viewBox="0 0 16 16"><path d="M13.5 2.5 7.8 8.2M9.3 9.7 6.3 6.7M6.3 9.7c-1.6-.3-3 .7-3 2.3 0 .6-.3 1-.8 1.3 1.7.7 4.3.3 4.8-1.7" /></svg>',
};

// ---------- pets ----------
// --age keeps each loop in phase across re-renders (render() rebuilds the DOM often).
function pet(kind, petState, extra = {}) {
  const el = h('div', { class: 'pet', 'data-s': petState, ...extra });
  el.style.setProperty('--age', `-${Date.now() - EPOCH}ms`);
  el.innerHTML = P.petSvg(kind); // constant markup only
  return el;
}
const petColor = (c) => `--pc:var(--g${c.colorSlot || P.colorSlot(c.hue)})`;

function icon(name) {
  const s = document.createElement('span');
  s.className = 'ic';
  s.innerHTML = ICONS[name]; // constant markup only
  return s;
}

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function btn(name, title, onclick, extra = {}) {
  return h('button', { class: 'ib', title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); onclick(); }, ...extra }, icon(name));
}

function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h ${m % 60}m`;
  return `${Math.floor(hr / 24)}d ${hr % 24}h`;
}
const timer = (ts, prefix = '') => h('span', { class: 'timer', 'data-since': ts, 'data-prefix': prefix }, prefix + ago(ts));

// ---------- usage ----------
function meter(label, v, title) {
  const level = v == null ? 'none' : v >= 90 ? 'hot' : v >= 70 ? 'warm' : '';
  return h('div', { class: `meter ${level}`, title },
    h('span', { class: 'mlabel' }, label),
    h('span', { class: 'bar' }, h('i', { style: `--p:${(v ?? 0) / 100}` })),
    h('span', { class: 'mval' }, v == null ? '–' : `${v}%`));
}

const clock = (ts) => new Date(ts).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

let refreshSpinUntil = 0;
function usageRow(u) {
  const tip = u.autoRefreshOn ? `From the Claude app, refreshed every 5-15 min until ${clock(u.autoRefreshUntil)}.`
    : 'From the Claude app. It only refreshes for 24 h after you right-click its tray icon.';
  const refresh = h('button', {
    class: `ib small${Date.now() < refreshSpinUntil ? ' spin' : ''}`, title: 'Refresh usage now', 'aria-label': 'Refresh usage now',
    onclick: (e) => { e.stopPropagation(); refreshSpinUntil = Date.now() + 1500; api.refreshUsage(); render(); },
  }, icon('refresh'));
  const meters = h('div', { class: 'meters' },
    meter('5h', u.fiveHour, u.fiveHour == null ? 'No reading inside the current 5-hour window' : '5-hour limit'),
    meter('Week', u.weekly, 'Weekly limit, all models'),
    refresh);
  const info = u.stale ? h('div', { class: 'unudge' }, 'Reading from ', timer(u.at), ' ago') : null;
  return h('div', { class: `usage${u.stale ? ' stale' : ''}`, title: tip }, meters, info);
}

// ---------- pieces ----------
function header({ counts, ui, usage }) {
  const status = counts.waiting ? 'waiting' : counts.working ? 'working' : 'quiet';
  const logo = h('span', { class: 'logo', title: 'Flocklet' });
  logo.innerHTML = P.petSvg('chick'); // constant markup only
  logo.append(h('span', { class: `dot ${status}` }));
  return h('header', { class: 'header' },
    logo,
    h('span', { class: 'title' }, 'Flocklet'),
    !ui.collapsed && h('span', { class: 'count' }, String(counts.working + counts.waiting + counts.done)),
    h('span', { class: 'spacer' }),
    btn(ui.muted ? 'mute' : 'sound', ui.muted ? 'Sound off (click to turn on)' : 'Sound on (click to mute)', () => api.set({ muted: !ui.muted })),
    btn('dock', 'Pet dock: only the pets, like a taskbar', () => api.set({ dock: true })),
    btn(ui.collapsed ? 'down' : 'up', ui.collapsed ? 'Expand' : 'Collapse', () => api.set({ collapsed: !ui.collapsed })),
    btn('minimise', 'Minimise to tray (click the tray chick or Ctrl+Alt+A to bring it back)', () => api.hide()));
}

// ---------- minimised bar ----------
// Collapsed panel: every session in the Sessions list by state, plus small usage meters.
// States that need you (waiting, error) get a strong colour; click anything to expand.
const CHIP_WORD = { waiting: 'need you', error: 'error', working: 'working', done: 'done', idle: 'idle' };
function miniBar(cards, usage) {
  const n = G.stateCounts(cards);
  const expand = () => api.set({ collapsed: false });
  const chips = G.STATE_ORDER.filter((k) => n[k]).map((k) =>
    h('button', { class: `chip ${k}`, title: `${n[k]} ${k === 'waiting' ? 'waiting for you' : k}. Click to expand`, onclick: expand },
      h('b', null, String(n[k])), ` ${k === 'waiting' && n[k] === 1 ? 'needs you' : CHIP_WORD[k]}`));
  const mm = (label, v) => {
    if (v == null) return null;
    const level = v >= 90 ? 'hot' : v >= 70 ? 'warm' : '';
    return h('div', { class: `mmeter ${level}`, title: `${label === '5h' ? '5-hour' : 'Weekly'} limit: ${v}%` },
      h('span', { class: 'mlabel' }, label),
      h('span', { class: 'bar' }, h('i', { style: `--p:${v / 100}` })),
      h('span', { class: 'mval' }, `${v}%`));
  };
  const showUsage = usage && usage.source !== 'none';
  return h('div', { class: 'minibar', onclick: expand },
    h('div', { class: 'chips' }, chips.length ? chips : h('span', { class: 'chip idle' }, 'no sessions')),
    showUsage && h('div', { class: `mmeters${usage.stale ? ' stale' : ''}` },
      mm('5h', usage.fiveHour), mm('wk', usage.weekly)),
    showUsage && h('button', { // same refresh as the panel's ↻ (re-reads Claude's usage file)
      class: `ib small mrefresh${Date.now() < refreshSpinUntil ? ' spin' : ''}`, title: 'Refresh usage now', 'aria-label': 'Refresh usage now',
      onclick: (e) => { e.stopPropagation(); refreshSpinUntil = Date.now() + 1500; api.refreshUsage(); render(); } }, icon('refresh')));
}

// Stretched minimised bar: deck sessions as one-line rows, urgent first. Click a row to jump in.
function miniList(cards, on) {
  const rank = (c) => G.STATE_ORDER.indexOf(c.state) + 1 || 9;
  const rows = cards.filter((c) => c.group === 'active').sort((a, b) => rank(a) - rank(b));
  const row = (c) => h('div', { class: `mrow ${c.state}${c.canJump ? '' : ' nolink'}`, style: petColor(c), title: c.cwd || '',
    onclick: () => c.canJump && api.jump(c.hostId) },
  miniPick(c, 'mini'),
  h('span', { class: 'name' }, c.name),
  STATE_WORD[c.state] && h('span', { class: `sbadge ${c.state}` }, STATE_WORD[c.state]),
  c.pinned ? btn('pin', 'Unpin: leaves the deck once it is idle', () => api.pin(c.key, false), { class: 'ib small on rowact' })
    : btn('close', 'Hide until it does something new', () => api.hideCard(c.id), { class: 'ib small rowact' }));
  return h('div', { class: `list minilist${on ? '' : ' off'}`, 'data-scroll': 'mini' }, rows.length ? rows.map((c) => withPetMenu(row(c), c, 0, 'mini'))
    : h('div', { class: 'empty' }, 'Nothing on the deck.'));
}

// ---------- theme picker ----------
function themer(ui) {
  const t = ui.theme || T.DEFAULT;
  const set = (patch) => api.set({ theme: patch });
  return h('div', { class: 'themer', onclick: (e) => e.stopPropagation() },
    h('div', { class: 'trow' }, h('span', { class: 'tlabel' }, 'Palette'),
      T.PALETTES.map((p) => {
        const b = h('button', { class: `swatch${t.palette === p.id ? ' on' : ''}`, title: p.name, 'aria-label': p.name,
          onclick: () => set({ palette: p.id }) });
        b.style.setProperty('--s-bg', p.swatch.bg);
        b.style.setProperty('--s-acc', p.swatch.accent);
        b.style.setProperty('--s-warn', p.swatch.warn);
        return b;
      })),
    h('div', { class: 'trow' }, h('span', { class: 'tlabel' }, 'Look'),
      T.LOOKS.map((l) => {
        const aa = h('span', { class: 'aa' }, 'Aa');
        aa.style.fontFamily = l.font;
        return h('button', { class: `lookchip${t.look === l.id ? ' on' : ''}`, onclick: () => set({ look: l.id }) }, aa, l.name);
      })),
    h('div', { class: 'trow' }, h('span', { class: 'tlabel' }, 'Light / dark'),
      h('div', { class: 'seg' }, T.MODES.map((m) =>
        h('button', { class: `segb${t.mode === m.id ? ' on' : ''}`, onclick: () => set({ mode: m.id }) }, m.name)))));
}

function applyTheme(ui) {
  const t = ui.theme || T.DEFAULT;
  const d = document.documentElement.dataset;
  if (d.palette !== t.palette) d.palette = t.palette;
  if (d.look !== t.look) d.look = t.look;
  const mode = ui.mode || T.resolveMode(t, false);
  if (d.mode !== mode) d.mode = mode;
}

// Click a session's pet to open its pet menu (petMenu below).
let petFor = null; // '<where>:<session key>' of the open pet menu (deck, list or mini), so it opens once
function togglePetMenu(c, where) {
  const k = `${where}:${c.key}`;
  petFor = petFor === k ? null : k;
  menuFor = null;
  render();
  if (petFor) requestAnimationFrame(() => { const m = document.querySelector('.petpop'); if (m) m.scrollIntoView({ block: 'nearest' }); });
}
function avatar(c) {
  const el = pet(c.pet, P.petState(c), { title: `${P.PET_NAMES[c.pet] || 'Pet'} · click to change`, class: 'pet pickable' });
  el.addEventListener('click', (e) => { e.stopPropagation(); togglePetMenu(c, 'deck'); });
  return el;
}

const SLOTS = [1, 2, 3, 4, 5, 6];
function petMenu(c, depth = 0) {
  const st = P.petState(c);
  return h('div', { class: 'petpop', style: `${petColor(c)};--depth:${depth}`, onclick: (e) => e.stopPropagation() },
    h('div', { class: 'pophead' }, h('span', { class: 'muted' }, 'Pet for '), c.name),
    h('div', { class: 'petpick big' }, P.PETS.map((k) =>
      h('button', { class: c.pet === k ? 'on' : '', title: P.PET_NAMES[k], 'aria-label': `Pet: ${P.PET_NAMES[k]}`,
        onclick: () => api.pet(c.key, k) }, pet(k, st), h('span', { class: 'pname' }, P.PET_NAMES[k])))),
    h('div', { class: 'swatches' }, SLOTS.map((n) =>
      h('button', { class: `sw${c.colorSlot === n ? ' on' : ''}`, style: `--sw:var(--g${n})`, title: `Colour ${n}`,
        'aria-label': `Colour ${n}`, onclick: () => api.petMenu('color', c.key, n) }))),
    h('div', { class: 'btnrow' },
      h('button', { class: 'b', title: 'Every session gets this pet (colours stay)',
        onclick: () => { api.petMenu('all', null, c.pet); petFor = null; } }, `${P.PET_NAMES[c.pet]} for all`),
      c.petChosen && h('button', { class: 'b ghost', onclick: () => api.petMenu('reset', c.key) }, 'Reset to auto'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'b ghost', onclick: () => { petFor = null; render(); } }, 'Done')));
}
const miniPick = (c, where) => h('button', { class: 'mini pickable', title: 'Change pet and colour', 'aria-label': 'Change pet and colour',
  onclick: (e) => { e.stopPropagation(); togglePetMenu(c, where); } });
const withPetMenu = (el, c, depth, where) => (petFor === `${where}:${c.key}` ? [el, petMenu(c, depth)] : el);

const WAIT_LABEL = { permission: 'Needs permission', question: 'Asks a question', plan: 'Plan ready for review', input: 'Needs you' };

function statusLine(c) {
  switch (c.state) {
    case 'waiting': return h('div', { class: 'line2 wait' }, WAIT_LABEL[c.waiting?.kind] || 'Needs you', h('span', { class: 'sep' }, '·'), timer(c.since));
    case 'done': return h('div', { class: 'line2 ok' }, 'Done', h('span', { class: 'sep' }, '·'), timer(c.since, ''), ' ago');
    case 'error': return h('div', { class: 'line2 err' }, 'Stopped', c.error && h('span', { class: 'muted' }, ` · ${c.error}`));
    case 'working': return h('div', { class: 'line2' }, c.activity || 'Working…');
    default: return h('div', { class: 'line2 muted' }, 'Idle');
  }
}

// ---------- answering from the panel ----------
// Per-request UI drafts (selected options, typed text) survive the frequent re-renders.
const drafts = new Map();
function draftFor(id) {
  if (!drafts.has(id)) drafts.set(id, { sel: {}, other: {}, otherOn: {}, denyOpen: false, reason: '', alwaysOpen: false });
  return drafts.get(id);
}

const kbd = (k) => h('span', { class: 'kbd' }, k);
const jumpPill = (c, text = 'Open in Claude') => c.canJump &&
  h('button', { class: 'pill', onclick: () => api.jump(c.hostId) }, text, icon('jump'));

function decide(w, action) {
  api.decide(w.id, action);
  drafts.delete(w.id);
}

function answersOf(w, d) {
  return w.questions.map((q, qi) => ({
    labels: [...(d.sel[qi] || [])],
    other: d.otherOn[qi] ? (d.other[qi] || '').trim() : '',
  }));
}
const complete = (w, d) => answersOf(w, d).every((a) => a.labels.length || a.other);

function pickOption(w, d, qi, label) {
  const q = w.questions[qi];
  const cur = new Set(d.sel[qi] || []);
  if (q.multiSelect) { if (cur.has(label)) cur.delete(label); else cur.add(label); }
  else { cur.clear(); cur.add(label); d.otherOn[qi] = false; }
  d.sel[qi] = [...cur];
  render();
}

function permissionBox(c, w, d) {
  const single = w.suggestions.length === 1 ? w.suggestions[0] : null;
  if (d.denyOpen) {
    return h('div', { class: 'btnrow' },
      h('input', { class: 'text', 'data-focus': `deny-${w.id}`, placeholder: 'Tell Claude why (optional)', value: d.reason,
        oninput: (e) => { d.reason = e.target.value; } }),
      h('button', { class: 'b danger', onclick: () => decide(w, { type: 'deny', reason: d.reason }) }, 'Deny'),
      h('button', { class: 'b ghost', onclick: () => { d.denyOpen = false; render(); } }, 'Back'));
  }
  return [
    h('div', { class: 'btnrow' },
      h('button', { class: 'b primary', onclick: () => decide(w, { type: 'allow' }) }, 'Allow', kbd('A')),
      single && h('button', { class: 'b', title: single.label, onclick: () => decide(w, { type: 'always', index: single.index }) }, 'Always allow'),
      w.suggestions.length > 1 && h('button', { class: 'b', onclick: () => { d.alwaysOpen = !d.alwaysOpen; render(); } },
        'Always…', icon(d.alwaysOpen ? 'up' : 'down')),
      h('button', { class: 'b danger', onclick: () => { d.denyOpen = true; render(); } }, 'Deny', kbd('D')),
    ),
    single && h('div', { class: 'hint' }, single.label),
    d.alwaysOpen && w.suggestions.length > 1 && h('div', { class: 'menu' },
      w.suggestions.map((s) => h('button', { class: 'menuitem', onclick: () => decide(w, { type: 'always', index: s.index }) }, s.label))),
  ];
}

function questionBox(c, w, d) {
  return [
    ...w.questions.map((q, qi) => h('div', { class: 'q' },
      w.questions.length > 1 && h('div', { class: 'qhead' }, q.header),
      qi > 0 && h('div', { class: 'wtitle' }, q.question),
      h('div', { class: 'opts' },
        q.options.map((o, oi) => {
          const on = (d.sel[qi] || []).includes(o.label);
          return h('button', { class: `opt${on ? ' on' : ''}${q.multiSelect ? ' multi' : ''}`, onclick: () => pickOption(w, d, qi, o.label) },
            h('span', { class: 'mark' }),
            h('span', { class: 'olabel' }, o.label, o.description && h('span', { class: 'odesc' }, o.description)),
            qi === 0 && oi < 9 && kbd(String(oi + 1)));
        }),
        d.otherOn[qi]
          ? h('input', { class: 'text', 'data-focus': `other-${w.id}-${qi}`, placeholder: 'Type your answer', value: d.other[qi] || '',
            oninput: (e) => { d.other[qi] = e.target.value; syncSubmit(w, d); } })
          : h('button', { class: `opt other${q.multiSelect ? ' multi' : ''}`, onclick: () => {
            d.otherOn[qi] = true;
            if (!q.multiSelect) d.sel[qi] = [];
            focusAfterRender = `other-${w.id}-${qi}`;
            render();
          } }, h('span', { class: 'mark' }), h('span', { class: 'olabel' }, 'Other…'))))),
    h('div', { class: 'btnrow' },
      h('button', { class: 'b primary', 'data-submit': w.id, disabled: !complete(w, d),
        onclick: () => complete(w, d) && decide(w, { type: 'answer', answers: answersOf(w, d) }) }, 'Answer', kbd('↵')),
    ),
  ];
}

function syncSubmit(w, d) {
  const b = document.querySelector(`[data-submit="${CSS.escape(w.id)}"]`);
  if (b) b.disabled = !complete(w, d);
}

function waitBox(c) {
  const w = c.waiting;
  const d = w.id ? draftFor(w.id) : null;
  return h('div', { class: 'waitbox', onclick: (e) => e.stopPropagation() },
    h('div', { class: 'wtitle' }, w.title),
    w.kind !== 'question' && w.detail && h('div', { class: 'wdetail' }, w.detail),
    !w.actionable ? jumpPill(c, 'Answer in Claude')
      : w.kind === 'question' ? questionBox(c, w, d) : permissionBox(c, w, d),
    c.moreWaiting > 0 && h('div', { class: 'hint' }, `+${c.moreWaiting} more waiting in this session`));
}

function detailLine(c) {
  if (c.state === 'waiting' && c.waiting) return waitBox(c);
  if (c.state === 'done' && c.lastMessage) return h('div', { class: 'lastmsg' }, c.lastMessage);
  if (c.state === 'working') {
    const p = c.progress;
    return h('div', { class: 'line3' },
      p && h('span', { class: 'step' }, `${p.index}/${p.total}`),
      p && h('span', { class: 'steplabel' }, p.label),
      h('span', { class: `bar${p ? '' : ' indet'}`, style: p ? `--p:${p.ratio}` : '' }, h('i')),
      timer(c.since));
  }
  return null;
}

const G = window.AgentDeckGrouping;
const STATE_WORD = { working: 'working', waiting: 'needs you', done: 'done', error: 'error', idle: '' };

// Fold arrow + "N hidden · M need you" badge for a foldable header or parent (see G.fold).
function foldArrow(it) {
  if (!it || !it.foldable) return null;
  const what = it.type === 'header' ? `"${it.label}"` : 'sub-sessions';
  return btn('chev', it.folded ? `Show ${what}` : `Fold ${what}`, () => api.fold(G.foldKeyOf(it), !it.folded),
    { class: `ib small fold${it.folded ? ' folded' : ''}` });
}
function foldBadge(it) {
  if (!it || !it.folded || !it.hidden) return null;
  return h('span', { class: `fbadge${it.hiddenWaiting ? ' hot' : ''}` },
    `${it.hidden} hidden`, it.hiddenWaiting ? ` · ${it.hiddenWaiting} need${it.hiddenWaiting > 1 ? '' : 's'} you` : '');
}

function card(c, depth = 0, it = null) {
  const el = h('div', { class: `card ${c.state}${depth ? ' child' : ''}${c.pinned ? ' pinned' : ''}`,
    style: `${petColor(c)};--depth:${depth}`, title: c.cwd || '' },
  avatar(c),
  h('div', { class: 'body' },
    h('div', { class: 'row1' },
      foldArrow(it),
      h('span', { class: 'name' }, c.name),
      foldBadge(it),
      c.terminal && h('span', { class: 'tag' }, 'terminal'),
      c.subagents > 0 && h('span', { class: 'tag' }, `+${c.subagents} subagent${c.subagents > 1 ? 's' : ''}`),
      ctxTag(c),
      c.quiet && h('span', { class: 'quietmark', title: 'Notifications muted for this session' }, icon('bellOff'))),
    statusLine(c),
    detailLine(c)),
  h('div', { class: 'actions' },
    btn('jump', c.canJump ? 'Open this session in Claude' : 'Terminal session (no desktop link)', () => api.jump(c.hostId), { disabled: !c.canJump }),
    c.pinned
      ? btn('pin', 'Pinned. Click to unpin', () => api.pin(c.key, false), { class: 'ib on' })
      : btn('close', 'Hide this card until it does something new', () => api.hideCard(c.id))));
  if (c.canJump) el.addEventListener('click', () => api.jump(c.hostId));
  return el;
}

const kTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`);
function ctxTag(c) {
  const x = c.context;
  if (!x) return null;
  const level = x.pct == null ? '' : x.pct >= 95 ? ' hot' : x.pct >= 80 ? ' warm' : '';
  const title = x.pct == null
    ? `${kTokens(x.tokens)} tokens in context (window size of ${x.model || 'this model'} unknown)`
    : `${kTokens(x.tokens)} of ${kTokens(x.window)} tokens in context`;
  return h('span', { class: `tag ctx${level}`, title }, x.pct == null ? `${kTokens(x.tokens)} ctx` : `ctx ${x.pct}%`);
}

// A parent that is not on the deck, shown as a small session card so its children visibly hang under it
// (a plain text row read like a group header).
function ghostRow(c, depth, it = null) {
  return h('div', { class: `ghost${depth ? ' child' : ''}${c.canJump ? '' : ' nolink'}`, style: `${petColor(c)};--depth:${depth}`,
    title: `${c.name}: parent session, not on the deck${c.cwd ? `\n${c.cwd}` : ''}`,
    onclick: () => c.canJump && api.jump(c.hostId) },
  avatar(c),
  foldArrow(it),
  h('span', { class: 'name' }, c.name),
  foldBadge(it),
  h('span', { class: 'tag' }, 'parent'),
  STATE_WORD[c.state] && h('span', { class: `sbadge ${c.state}` }, STATE_WORD[c.state]),
  c.canJump && btn('jump', 'Open in Claude', () => api.jump(c.hostId), { class: 'ib small hoverish' }));
}

function groupHeader(it, editable = false) {
  return h('div', { class: `ghdr${it.foldable ? ' foldable' : ''}`, style: it.color ? `--gc:var(--g${it.color})` : '',
    onclick: () => it.foldable && api.fold(G.foldKeyOf(it), !it.folded) },
    foldArrow(it),
    h('span', { class: 'gdot' }), h('span', { class: 'glabel' }, it.label), h('span', { class: 'gcount' }, String(it.count)),
    foldBadge(it),
    editable && it.key && btn('close', `Delete group "${it.label}" (sessions stay)`, () => api.group({ op: 'delete', id: it.key }), { class: 'ib small hoverish' }));
}

// ---------- sessions browser ----------
let query = '';
let menuFor = null;     // key of the row whose group menu is open
let newGroupName = '';

function createGroup(key) {
  if (!newGroupName.trim()) return;
  api.group({ op: 'create', name: newGroupName, key: key || undefined });
  newGroupName = '';
  menuFor = null;
  render();
}

function newGroupRow(key) {
  return h('div', { class: 'newgroup' },
    h('input', { class: 'text', 'data-focus': `newgroup-${key || 'top'}`, placeholder: key ? 'New group with this session' : 'New group name',
      value: newGroupName, oninput: (e) => { newGroupName = e.target.value; },
      onkeydown: (e) => { if (e.key === 'Enter') createGroup(key); } }),
    h('button', { class: 'b', onclick: (e) => { e.stopPropagation(); createGroup(key); } }, 'Add'));
}

function groupMenu(c, ui, depth) {
  return h('div', { class: 'gmenu', style: `--depth:${depth};${petColor(c)}`, onclick: (e) => e.stopPropagation() },
    h('div', { class: 'petpick' }, P.PETS.map((k) =>
      h('button', { class: c.pet === k ? 'on' : '', title: P.PET_NAMES[k], 'aria-label': `Pet: ${P.PET_NAMES[k]}`,
        onclick: () => api.pet(c.key, k) }, pet(k, 'idle')))),
    ui.groups.map((g) => h('button', { class: `menuitem${c.groupId === g.id ? ' on' : ''}`,
      onclick: () => { api.group({ op: 'assign', key: c.key, id: g.id }); menuFor = null; } },
    h('span', { class: 'gdot', style: `--gc:var(--g${g.color})` }), g.name)),
    c.groupId && h('button', { class: 'menuitem', onclick: () => { api.group({ op: 'assign', key: c.key, id: null }); menuFor = null; } }, 'Remove from group'),
    h('button', { class: 'menuitem', onclick: () => { api.quiet(c.key, !c.quiet); menuFor = null; } },
      icon(c.quiet ? 'bell' : 'bellOff'), c.quiet ? 'Unmute notifications' : 'Mute notifications'),
    newGroupRow(c.key));
}

function sessionRow(c, depth, dim, ui, it = null) {
  const open = menuFor === c.key;
  const row = h('div', { class: `srow${dim ? ' dim' : ''}${c.canJump ? '' : ' nolink'}${open ? ' open' : ''}`,
    style: `${petColor(c)};--depth:${depth}`, title: c.cwd || '', onclick: () => c.canJump && api.jump(c.hostId) },
  foldArrow(it) || h('span', { class: 'foldgap' }),
  miniPick(c, 'list'),
  h('span', { class: 'name' }, c.name),
  foldBadge(it),
  STATE_WORD[c.state] && h('span', { class: `sbadge ${c.state}` }, STATE_WORD[c.state]),
  btn('pin', c.pinned ? 'Unpin' : 'Pin: keep it as a card', () => api.pin(c.key, !c.pinned), { class: `ib small${c.pinned ? ' on' : ' hoverish'}` }),
  c.quiet && h('span', { class: 'quietmark', title: 'Notifications muted' }, icon('bellOff')),
  btn('more', 'Group, mute…', () => { menuFor = open ? null : c.key; render(); }, { class: 'ib small hoverish' }));
  return open ? [row, groupMenu(c, ui, depth)] : withPetMenu(row, c, depth, 'list');
}

const MODE_LABELS = [['folder', 'Projects'], ['tree', 'Tree'], ['custom', 'Groups'], ['none', 'All']];

function browser(cards, ui) {
  const hits = G.search(cards, query);
  const arranged = G.arrange(hits, ui.groupBy, { all: cards, groups: ui.groups, showEmptyGroups: !query });
  const items = query ? arranged : G.fold(arranged, ui.folded); // a search shows every match
  return h('div', { class: 'browser' },
    h('div', { class: 'btools' },
      h('input', { class: 'text search', 'data-focus': 'search', placeholder: `Search ${cards.length} sessions`, value: query,
        oninput: (e) => { query = e.target.value; render(); } }),
      h('div', { class: 'seg' }, MODE_LABELS.map(([m, label]) =>
        h('button', { class: `segb${ui.groupBy === m ? ' on' : ''}`, onclick: () => api.set({ groupBy: m }) }, label)))),
    ui.groupBy === 'custom' && !query && newGroupRow(null),
    h('div', { class: 'blist', 'data-scroll': 'sessions' }, items.length
      ? items.map((it) => (it.type === 'header' ? groupHeader(it, ui.groupBy === 'custom')
        : sessionRow(it.card, it.depth, it.type === 'ghost', ui, it)))
      : h('div', { class: 'empty' }, 'No session matches.')));
}

// ---------- pet dock ----------
// A taskbar of the deck's pets. Speech bubbles (? question, ! permission, ✓ done, × error) stay until you
// hover or click that pet. Click a pet that needs you: its card (with the answer box) pops up above the dock.
const DOCK_MAX = 14;
let dockOpen = null; // key of the session whose card is popped up
const seenBubbles = new Map(); // key -> signature of the event you already saw
const bubbleOf = (c) => (c.state === 'waiting' ? (c.waiting && c.waiting.kind === 'permission' ? '!' : '?')
  : c.state === 'done' ? '✓' : c.state === 'error' ? '×' : null);
const bubbleSig = (c) => `${c.state}|${(c.waiting && c.waiting.id) || ''}|${c.since || ''}`;
function markSeen(c) {
  if (!bubbleOf(c) || seenBubbles.get(c.key) === bubbleSig(c)) return;
  seenBubbles.set(c.key, bubbleSig(c));
  render();
}
// Click any pet: its card pops up above the dock (status, step, ctx, answer box); click again to fold it.
function clickDockPet(c) {
  seenBubbles.set(c.key, bubbleSig(c));
  dockOpen = dockOpen === c.key ? null : c.key;
  render();
}
const DOCK_WORD = { waiting: 'needs you', working: 'working', done: 'done', error: 'stopped with an error', idle: 'idle' };
function dockPet(c, open, names) {
  const b = bubbleOf(c);
  const unseen = b && seenBubbles.get(c.key) !== bubbleSig(c);
  const word = c.state === 'waiting' && c.waiting ? (WAIT_LABEL[c.waiting.kind] || 'Needs you') : DOCK_WORD[c.state] || 'idle';
  return h('button', { class: `dpet ${c.state}${open && open.key === c.key ? ' on' : ''}${names ? ' named' : ''}`, style: petColor(c),
    title: `${c.name}: ${word} · double-click to open`, 'aria-label': `${c.name}: ${word}`,
    onclick: () => clickDockPet(c), ondblclick: () => c.canJump && api.jump(c.hostId), onmouseenter: () => markSeen(c) },
  unseen && h('span', { class: `bubble ${c.state}` }, b),
  h('span', { class: 'dpetimg' }, pet(c.pet, P.petState(c)), h('span', { class: `ddot ${c.state}` })),
  names && h('span', { class: 'dname' }, c.name));
}
// Groups follow the panel's grouping (Projects / Groups / All) and its folds: a folded group is one stacked
// icon with a count; sessions that need you stay visible next to it.
function dockGroups(cards, ui) {
  const active = cards.filter((c) => c.group === 'active');
  const items = G.arrange(active, ui.groupBy === 'tree' ? 'none' : ui.groupBy, { all: cards, groups: ui.groups });
  const groups = [];
  let cur = null;
  for (const it of items) {
    if (it.type === 'header') { cur = { key: it.key, label: it.label, color: it.color, folded: (ui.folded || []).includes(`h:${it.key}`), cards: [] }; groups.push(cur); continue; }
    if (it.type !== 'card') continue;
    if (!cur) { cur = { key: null, label: null, cards: [] }; groups.push(cur); }
    cur.cards.push(it.card);
  }
  return groups.filter((g) => g.cards.length);
}
function dockView(cards, ui) {
  const groups = dockGroups(cards, ui);
  const all = groups.flatMap((g) => g.cards);
  const open = dockOpen && all.find((c) => c.key === dockOpen);
  if (dockOpen && !open) dockOpen = null;
  const names = !!ui.dockNames;
  let budget = DOCK_MAX;
  let more = 0;
  const blocks = groups.map((g) => {
    const urgent = g.folded ? g.cards.filter((c) => c.state === 'waiting' || c.state === 'error') : [];
    const pets = [];
    if (g.folded) {
      const top = g.cards[0];
      pets.push(h('button', { class: 'dstack', style: petColor(top), title: `${g.label}: ${g.cards.length} sessions · click to unfold`,
        'aria-label': `${g.label}, folded, ${g.cards.length} sessions`, onclick: () => api.fold(`h:${g.key}`, false) },
      pet(top.pet, P.petState(top)), h('span', { class: 'dcount' }, String(g.cards.length))));
    }
    for (const c of g.folded ? urgent : g.cards) {
      if (budget <= 0) { more += 1; continue; }
      budget -= 1;
      pets.push(dockPet(c, open, names));
    }
    if (!pets.length) return null;
    if (!g.label) return h('div', { class: 'dgroup plain' }, h('div', { class: 'dpets' }, pets));
    return h('div', { class: `dgroup${g.folded ? ' folded' : ''}`, style: g.color ? `--gc:var(--g${g.color})` : '' },
      h('div', { class: 'dpets' }, pets),
      h('button', { class: 'dglabel', title: g.folded ? `Unfold ${g.label}` : `Fold ${g.label}`,
        onclick: () => api.fold(`h:${g.key}`, !g.folded) }, g.label));
  }).filter(Boolean);
  const logo = h('button', { class: 'dlogo', title: 'Back to the panel', 'aria-label': 'Back to the panel',
    onclick: () => { dockOpen = null; api.set({ dock: false }); } });
  logo.innerHTML = P.petSvg('chick'); // constant markup only
  return [
    open && h('div', { class: 'dockpop' }, card(open, 0)),
    h('div', { class: `dockbar${names ? ' named' : ''}`, oncontextmenu: (e) => { e.preventDefault(); api.dockMenu(); } },
      blocks.length ? blocks : h('span', { class: 'dempty' }, 'No pets on the deck'),
      more > 0 && h('button', { class: 'dmore', title: `${more} more: open the panel`, onclick: () => api.set({ dock: false }) }, `+${more}`),
      h('span', { class: 'dsep' }),
      h('div', { class: 'dend' },
        btn('minimise', 'Minimise to tray', () => api.hide(), { class: 'ib small' }),
        logo)),
  ];
}

// ---------- sidebar rail + drawers ----------
// The rail sits on one side of the deck (ui.rail); its drawer opens outward beyond it (main sizes the window).
const openDrawer = (name) => { menuFor = null; api.set({ drawer: state.ui.drawer === name ? null : name }); };
function railButton(name, iconName, label, badge) {
  const on = state.ui.drawer === name;
  return h('button', { class: `rbtn${on ? ' on' : ''}`, title: on ? `Close ${label}` : label, 'aria-label': label,
    'aria-pressed': on ? 'true' : 'false', onclick: () => openDrawer(name) },
  icon(iconName), badge != null && h('span', { class: 'rbadge' }, String(badge)));
}
function settingsDrawer(ui) {
  const sideBtn = (side, label) => h('button', { class: `segb${ui.rail === side ? ' on' : ''}`, onclick: () => api.set({ rail: side }) }, label);
  const toggle = (on, label, onclick) => h('button', { class: `toggle${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick },
    h('span', { class: 'knob' }), label);
  return h('div', { class: 'settings', 'data-scroll': 'settings' },
    h('h3', { class: 'dhead' }, 'Settings'),
    h('section', null, h('div', { class: 'slabel' }, 'View'),
      h('div', { class: 'seg' },
        h('button', { class: `segb${!ui.dock && !ui.collapsed ? ' on' : ''}`, onclick: () => api.set({ dock: false, collapsed: false }) }, 'Panel'),
        h('button', { class: `segb${!ui.dock && ui.collapsed ? ' on' : ''}`, onclick: () => api.set({ dock: false, collapsed: true }) }, 'Minimised'),
        h('button', { class: `segb${ui.dock ? ' on' : ''}`, onclick: () => api.set({ dock: true }) }, 'Pet dock'))),
    h('section', null, h('div', { class: 'slabel' }, 'Sidebar side'),
      h('div', { class: 'seg' }, sideBtn('left', 'Left'), sideBtn('right', 'Right'), sideBtn('top', 'Top'), sideBtn('bottom', 'Bottom')),
      h('div', { class: 'hint' }, 'Or drag the dots at the end of the sidebar to any side.')),
    h('section', null, h('div', { class: 'slabel' }, 'Sound and alerts'),
      toggle(!ui.muted, 'Chime when a session needs you or finishes', () => api.set({ muted: !ui.muted })),
      toggle(ui.notify !== false, 'Windows notifications', () => api.set({ notify: ui.notify === false }))),
    h('section', null, h('div', { class: 'slabel' }, 'App'),
      ui.startup == null
        ? h('div', { class: 'hint' }, 'Start with Windows and updates work in the installed app (this copy runs from source).')
        : toggle(!!ui.startup, 'Start with Windows', () => api.set({ startup: !ui.startup })),
      h('div', { class: 'btnrow' },
        ui.updates && h('button', { class: 'b', onclick: () => api.checkUpdates() }, 'Check for updates'),
        h('span', { class: 'hint' }, `Flocklet ${ui.version || ''}`))),
    h('section', null, h('div', { class: 'slabel' }, 'Pet dock'),
      toggle(!!ui.dockNames, 'Names under the pets', () => api.set({ dockNames: !ui.dockNames })),
      h('div', { class: 'hint' }, 'Pets are grouped like the panel (Projects / Groups / All). Right-click the dock for more.')),
    h('section', null, h('div', { class: 'slabel' }, 'Size'),
      h('div', { class: 'btnrow' },
        h('button', { class: 'b', onclick: () => api.drag('right', 'reset', 0, 0) }, 'Reset width'),
        h('button', { class: 'b', onclick: () => api.drag('bottom', 'reset', 0, 0) }, 'Automatic height')),
      h('div', { class: 'hint' }, 'Drag the panel edges to resize; double-click an edge to reset it.')),
    h('section', null, h('div', { class: 'slabel' }, 'Look'), themer(ui)));
}
function renderShell(cards, ui) {
  const shell = document.getElementById('shell');
  const side = ui.rail || 'left';
  shell.className = `shell side-${side}${ui.dock ? ' docked' : ui.collapsed ? ' minimised' : ''}${ui.drawer && !ui.dock ? ' open' : ''}`;
  document.body.classList.toggle('docked', !!ui.dock);
  shell.style.setProperty('--deckw', `${ui.width || 368}px`);
  if (ui.deckHeight != null) shell.style.setProperty('--deckh', `${ui.deckHeight - 16}px`); else shell.style.removeProperty('--deckh');
  const rail = document.getElementById('rail');
  rail.classList.toggle('min', !!ui.railMin);
  shell.classList.toggle('railmin', !!ui.railMin);
  if (ui.railMin) { // sidebar minimised on its own: a thin strip that opens it again
    rail.replaceChildren(h('button', { class: 'rexpand', title: 'Show the sidebar', 'aria-label': 'Show the sidebar',
      onclick: () => api.set({ railMin: false }) }, icon('sidebar')));
  } else {
    rail.replaceChildren(
      railButton('sessions', 'list', 'Sessions', cards.length),
      h('span', { class: 'spacer' }),
      railButton('settings', 'gear', 'Settings'),
      btn('minimise', 'Minimise the sidebar', () => api.set({ railMin: true }), { class: 'ib small rmin' }),
      h('div', { class: 'rgrip', id: 'rgrip', title: 'Drag to another side of the panel' }, icon('grip')));
  }
  const drawer = document.getElementById('drawer');
  drawer.hidden = !ui.drawer || !!ui.dock || !!ui.railMin; // drawers open while minimised too, not in the pet dock
  if (drawer.hidden) drawer.replaceChildren();
  else drawer.replaceChildren(ui.drawer === 'sessions' ? browser(cards, ui) : settingsDrawer(ui));
}

// Drag the rail's dots to dock it on another side: the side of the panel nearest the pointer wins.
(function dockByDrag() {
  let dragging = false;
  const sideAt = (x, y) => {
    const r = document.getElementById('panel').getBoundingClientRect();
    const d = { left: Math.abs(x - r.left), right: Math.abs(x - r.right), top: Math.abs(y - r.top), bottom: Math.abs(y - r.bottom) };
    if (x < r.left) d.left = -1;
    if (x > r.right) d.right = -1;
    if (y < r.top) d.top = -1;
    if (y > r.bottom) d.bottom = -1;
    return Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
  };
  const shell = document.getElementById('shell');
  shell.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#rgrip') || e.button !== 0) return;
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    dragging = true;
    document.body.classList.add('docking');
  });
  shell.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    shell.dataset.dock = sideAt(e.clientX, e.clientY);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('docking');
    const side = shell.dataset.dock;
    delete shell.dataset.dock;
    if (side && side !== state.ui.rail && e.type === 'pointerup') api.set({ rail: side });
  };
  shell.addEventListener('pointerup', end);
  shell.addEventListener('pointercancel', end);
  shell.addEventListener('lostpointercapture', end);
})();

// ---------- render ----------
function render() {
  const { cards, ui, hooks } = state;
  const panel = document.getElementById('panel');
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focus : null;
  const caret = focused ? document.activeElement.selectionStart : null;
  panel.className = `panel${ui.dock ? ' dock' : ui.collapsed ? ' collapsed' : ''}${ui.fixedHeight ? ' fixed' : ''}`;
  applyTheme(ui);
  const kids = ui.dock ? dockView(cards, ui).filter(Boolean) : [header(state)];
  if (ui.dock) { /* pet dock: nothing else */ } else if (ui.collapsed) kids.push(miniBar(cards, state.usage));
  if (ui.collapsed && !ui.dock) kids.push(miniList(cards, ui.miniList)); // always built, so its full height can be measured
  if (!ui.collapsed && !ui.dock && state.usage) kids.push(usageRow(state.usage));
  if (!ui.collapsed && !ui.dock) {
    if (!hooks.ok) kids.push(h('div', { class: 'banner' }, `Live updates off: ${hooks.error}. Showing session list only.`));
    const active = cards.filter((c) => c.group === 'active');
    const items = G.fold(G.arrange(active, ui.groupBy, { all: cards, groups: ui.groups }), ui.folded);
    kids.push(h('div', { class: 'list', 'data-scroll': 'deck' }, items.length
      ? items.map((it) => (it.type === 'header' ? groupHeader(it) : withPetMenu(it.type === 'ghost' ? ghostRow(it.card, it.depth, it) : card(it.card, it.depth, it), it.card, it.depth, 'deck')))
      : h('div', { class: 'empty' }, 'No agent is working right now. Pin sessions from Sessions in the sidebar to keep them here.')));
  }
  // render() rebuilds the DOM, which resets every list to the top: keep each scroll position.
  const scrolls = new Map([...document.querySelectorAll('[data-scroll]')].map((el) => [el.dataset.scroll, el.scrollTop]));
  panel.replaceChildren(...kids);
  renderShell(cards, ui);
  for (const el of document.querySelectorAll('[data-scroll]')) {
    if (scrolls.has(el.dataset.scroll)) el.scrollTop = scrolls.get(el.dataset.scroll);
  }
  const live = new Set(cards.map((c) => c.waiting && c.waiting.id).filter(Boolean));
  for (const id of drafts.keys()) if (!live.has(id)) drafts.delete(id);
  const want = focusAfterRender || focused;
  focusAfterRender = null;
  const el = want && document.querySelector(`[data-focus="${CSS.escape(want)}"]`);
  if (el) {
    el.focus();
    if (want === focused && caret != null) { try { el.setSelectionRange(caret, caret); } catch { /* not a text field */ } }
  } else {
    const deny = document.querySelector('[data-focus^="deny-"]');
    if (deny && document.activeElement === document.body) deny.focus();
  }
  requestAnimationFrame(reportSize);
}

// Re-rendering replaces DOM nodes, so never do it mid-click or while typing.
let focusAfterRender = null;
let pointerDown = false;
let renderPending = false;
const typing = () => { const a = document.activeElement; return a && a.tagName === 'INPUT'; };
function scheduleRender() {
  if (pointerDown || typing()) { renderPending = true; return; }
  renderPending = false;
  render();
}
const flush = () => setTimeout(() => { if (renderPending) scheduleRender(); }, 0);
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
document.addEventListener('pointerup', () => { pointerDown = false; flush(); }, true);
document.addEventListener('focusout', flush);

// ---------- keyboard (panel focused) ----------
function topActionable() {
  if (!state) return null;
  return state.cards.find((c) => c.group === 'active' && c.waiting && c.waiting.actionable) || null;
}
document.addEventListener('keydown', (e) => {
  const c = topActionable();
  if (typing()) {
    if (e.key === 'Escape') { e.target.blur(); }
    const box = e.target.dataset ? e.target.dataset.focus || '' : '';
    if (e.key === 'Escape' && (menuFor || petFor || dockOpen)) { menuFor = null; petFor = null; dockOpen = null; render(); }
    if (e.key === 'Enter' && c && (box.startsWith('deny-') || box.startsWith('other-'))) {
      const w = c.waiting;
      const d = draftFor(w.id);
      if (w.kind === 'permission' && d.denyOpen) decide(w, { type: 'deny', reason: d.reason });
      else if (w.kind === 'question' && complete(w, d)) decide(w, { type: 'answer', answers: answersOf(w, d) });
    }
    return;
  }
  if (!c || e.ctrlKey || e.altKey || e.metaKey) return;
  const w = c.waiting;
  const d = draftFor(w.id);
  const k = e.key.toLowerCase();
  if (w.kind === 'permission' && k === 'a') decide(w, { type: 'allow' });
  else if (w.kind === 'permission' && k === 'd') { d.denyOpen = true; focusAfterRender = `deny-${w.id}`; render(); }
  else if (w.kind === 'question' && /^[1-9]$/.test(k)) {
    const o = w.questions[0].options[Number(k) - 1];
    if (o) pickOption(w, d, 0, o.label);
  } else if (w.kind === 'question' && e.key === 'Enter' && complete(w, d)) {
    decide(w, { type: 'answer', answers: answersOf(w, d) });
  } else return;
  e.preventDefault();
});

// ---------- resize strips ----------
// Sends drag deltas (screen pixels since the press) to main, at most once per frame.
for (const el of document.querySelectorAll('.rz')) {
  const edge = el.dataset.edge;
  let from = null;
  let queued = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    from = { x: e.screenX, y: e.screenY };
    document.body.classList.add('resizing');
    api.drag(edge, 'start', 0, 0);
  });
  el.addEventListener('pointermove', (e) => {
    if (!from) return;
    if (e.buttons === 0) { end(); return; } // the release happened somewhere we did not hear it
    const pending = !!queued;
    queued = [e.screenX - from.x, e.screenY - from.y];
    if (!pending) requestAnimationFrame(() => { if (queued && from) api.drag(edge, 'move', ...queued); queued = null; });
  });
  function end() {
    if (!from) return;
    if (queued) api.drag(edge, 'move', ...queued);
    from = null; queued = null;
    document.body.classList.remove('resizing');
    api.drag(edge, 'end', 0, 0);
  }
  // The window resizes under the pointer, so the release can land outside the strip or the window:
  // end on any of these.
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  window.addEventListener('pointerup', end);
  window.addEventListener('blur', end);
  el.addEventListener('dblclick', () => api.drag(edge, 'reset', 0, 0));
}

function reportSize() {
  const panel = document.getElementById('panel');
  let height = 0;
  let listFull = 0;
  for (const el of panel.children) {
    const cs = getComputedStyle(el);
    const isList = el.classList.contains('list') || el.classList.contains('idle-list');
    if (el.classList.contains('minilist')) {
      listFull = el.scrollHeight;
      if (el.classList.contains('off')) continue;
    }
    const own = isList ? el.scrollHeight : el.offsetHeight;
    height += own + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
  }
  const ps = getComputedStyle(panel);
  height += ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((s, k) => s + parseFloat(ps[k]), 0);
  const total = Math.ceil(height) + 16; // + panel margin
  const mini = panel.querySelector('.minilist');
  const bar = mini && !mini.classList.contains('off') ? total - listFull : total;
  const dockbar = panel.querySelector('.dockbar');
  const pop = panel.querySelector('.dockpop');
  const dockW = dockbar ? Math.ceil(Math.max(dockbar.scrollWidth, pop ? pop.scrollWidth : 0)) + 18 : 0; // + shell padding, border
  api.resize(total, { bar, full: bar + listFull, dockW });
}

// ---------- sound ----------
let audio = null;
function chime(kind) {
  if (state.ui.muted) return;
  try {
    audio = audio || new AudioContext();
    const notes = kind === 'attention' ? [784, 1047] : [659, 880];
    notes.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      const t = audio.currentTime + i * 0.13;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.3);
    });
  } catch { /* no audio device */ }
}

function detectTransitions(cards) {
  let sound = null;
  for (const c of cards) {
    const before = prevStates.get(c.id);
    if (!firstRender && before !== c.state) {
      if (c.state === 'waiting') sound = 'attention';
      else if ((c.state === 'done' || c.state === 'error') && (before === 'working' || before === 'waiting')) sound = sound || 'done';
    }
    prevStates.set(c.id, c.state);
  }
  firstRender = false;
  if (sound) chime(sound);
}

api.onState((s) => {
  state = s;
  detectTransitions(s.cards);
  scheduleRender();
});
setInterval(() => {
  for (const el of document.querySelectorAll('.timer[data-since]')) {
    el.textContent = (el.dataset.prefix || '') + ago(Number(el.dataset.since));
  }
}, 1000);
api.ready();

// A click anywhere outside the pet menu closes it.
document.addEventListener('click', (e) => {
  if (petFor && !e.target.closest('.petpop')) { petFor = null; render(); }
});
