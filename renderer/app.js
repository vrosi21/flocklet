// Flocklet overlay. Untrusted strings (titles, commands, messages) only ever go
// through text nodes; innerHTML is used solely for constant SVGs (icons below, pets.js).
const api = window.agentdeck;
// Which window this page is: Main, a board (?board=<id>) or the carried pet (?view=carry).
const PARAMS = new URLSearchParams(location.search);
const BOARD_ID = PARAMS.get('board');
const VIEW = BOARD_ID ? 'board' : PARAMS.get('view') === 'carry' ? 'carry' : 'main';
document.documentElement.classList.add(`v-${VIEW}`);
// The cards this page shows: its board's (a board window), or the board opened on Main's card, or Main's own.
const myBoard = () => (VIEW === 'board' ? BOARD_ID : (state && state.ui.boardView) || null);
const onDeck = (cards) => cards.filter((c) => (c.board || null) === myBoard());
const T = window.FlockletThemes;
const P = window.FlockletPets;
const EPOCH = Date.now();
let state = null;
const prevStates = new Map();
let firstRender = true;

const ICONS = window.FlockletIcons; // icons.js (shared with the tour)

// ---------- pets ----------
// --age keeps each loop in phase across re-renders (render() rebuilds the DOM often).
function pet(kind, petState, extra = {}) {
  const el = h('div', { class: 'pet', 'data-s': petState, ...extra });
  el.style.setProperty('--age', `-${Date.now() - EPOCH}ms`);
  el.innerHTML = P.petSvg(kind); // constant markup only
  const e = extra['data-key'] && emotes.get(extra['data-key']);
  if (e) showEmote(el, e);
  return el;
}

// Emotes: now and then a busy pet does something cute for a moment (a hop, a heart, a little tune, a twirl,
// a stretch, sparkles). About one per pet every 40 s, at most two at once; never for idle, asleep or stuck pets.
const EMOTES = ['hop', 'heart', 'note', 'twirl', 'stretch', 'sparkle'];
const EMOTE_MS = 1600;
const EMOTE_STATES = new Set(['working', 'thinking', 'done']);
const emotes = new Map(); // session key -> { kind, at }; kept here so a re-render mid-emote carries on
const lastEmote = new Map();
function showEmote(el, e) {
  el.dataset.emote = e.kind;
  el.style.setProperty('--eage', `-${Date.now() - e.at}ms`); // continue where the emote is, not from the start
}
const petEls = (key) => document.querySelectorAll(`.pet[data-key="${CSS.escape(key)}"]`);
function emote(key, kind) {
  const e = { kind, at: Date.now() };
  emotes.set(key, e);
  lastEmote.set(key, e.at);
  for (const el of petEls(key)) showEmote(el, e);
  setTimeout(() => { if (emotes.get(key) !== e) return; emotes.delete(key); for (const el of petEls(key)) delete el.dataset.emote; }, EMOTE_MS);
}
setInterval(() => {
  if (!state || state.ui.emotes === false || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (emotes.size >= 2) return;
  const now = Date.now();
  const keys = [...new Set([...document.querySelectorAll('.pet[data-key]')]
    .filter((el) => EMOTE_STATES.has(el.dataset.s)).map((el) => el.dataset.key))]
    .filter((k) => !emotes.has(k) && now - (lastEmote.get(k) || 0) > 20e3);
  if (!keys.length || Math.random() > Math.min(0.5, keys.length * 0.075)) return;
  emote(keys[Math.floor(Math.random() * keys.length)], EMOTES[Math.floor(Math.random() * EMOTES.length)]);
}, 3000);
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

// ---------- pieces ----------
function header({ ui }, deck) {
  const counts = G.count(deck);
  const status = counts.waiting ? 'waiting' : counts.working ? 'working' : 'quiet';
  const logo = h('span', { class: 'logo', title: 'Flocklet' });
  logo.innerHTML = P.petSvg('chick'); // constant markup only
  logo.append(h('span', { class: `dot ${status}` }));
  return h('header', { class: 'header' },
    ui.board ? h('span', { class: `bdot ${status}` }) : logo,
    ui.board ? boardName(ui.board) : h('span', { class: 'title' }, 'Flocklet'),
    !ui.collapsed && h('span', { class: 'count' }, String(counts.working + counts.waiting + counts.done)),
    h('span', { class: 'spacer' }),
    ui.board && btn('popout', 'Give this board its own window (or drag its tab in the sidebar out of Flocklet)', () => api.board({ op: 'popout', id: ui.board.id })),
    btn(ui.muted ? 'mute' : 'sound', ui.muted ? 'Sound off (click to turn on)' : 'Sound on (click to mute)', () => api.set({ muted: !ui.muted })),
    btn('dock', 'Pet dock: only the pets, like a taskbar', () => api.set({ dock: true })),
    btn(ui.collapsed ? 'down' : 'up', ui.collapsed ? 'Expand' : 'Collapse', () => api.set({ collapsed: !ui.collapsed })),
    btn('minimise', 'Minimise this card: the sidebar stays, and so do your boards (click Home to bring it back)', () => api.set({ mainHidden: true })));
}

// ---------- boards (src/boards.js): a board window's header, its name and its style ----------
const BOARD_ICONS = ['home', 'star', 'heart', 'bolt', 'flask', 'book', 'code', 'brush', 'music', 'leaf', 'rocket', 'coffee', 'flag', 'box', 'globe', 'cap']; // = src/boards.js ICONS
let renaming = false;
let boardStyleOpen = false;
// Click the name to rename it; Enter or clicking away saves, Escape keeps the old one.
function boardName(b) {
  if (renaming) {
    return h('input', { class: 'text bname', 'data-focus': 'bname', value: b.name, maxlength: '40', 'aria-label': 'Board name',
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); else if (e.key === 'Escape') { e.target.value = b.name; e.target.blur(); } },
      onblur: (e) => {
        renaming = false;
        const v = e.target.value.trim();
        if (v && v !== b.name) api.board({ op: 'rename', id: b.id, name: v });
        render();
      } });
  }
  return h('button', { class: 'title bname', title: 'Click to rename', onclick: () => { renaming = true; focusAfterRender = 'bname'; render(); } }, b.name);
}
function boardHeader({ ui }, deck) {
  const b = ui.board || { id: BOARD_ID, name: 'Board' };
  const n = G.count(deck);
  const status = n.waiting ? 'waiting' : n.working ? 'working' : 'quiet';
  return h('header', { class: 'header bheader' },
    h('span', { class: `bdot ${status}` }),
    boardName(b),
    h('span', { class: 'count' }, String(n.working + n.waiting + n.done)),
    h('span', { class: 'spacer' }),
    btn('brush', 'Style and icon of this board', () => { boardStyleOpen = !boardStyleOpen; render(); }, { class: `ib${boardStyleOpen ? ' on' : ''}` }),
    btn('dock', 'Pet dock: only the pets, like a taskbar', () => api.board({ op: 'dock', id: b.id, on: true })),
    btn('dockin', 'Move into Main: it becomes a tab in the sidebar (or drag this window onto Main)', () => api.board({ op: 'inside', id: b.id })),
    btn('more', 'More: same style as Main, delete', () => api.boardMenu(b.id)),
    btn('minimise', 'Hide this board (its button in the sidebar brings it back)', () => api.board({ op: 'hide', id: b.id })));
}
// A style tile (a ready-made palette + font). Hover previews it, click picks it.
function styleTile(t, pr) {
  const look = T.LOOKS.find((l) => l.id === pr.look);
  const aa = h('span', { class: 'paa' }, 'Aa');
  aa.style.fontFamily = look.font;
  const on = t.palette === pr.palette && t.look === pr.look;
  return h('button', { class: `ptile${on ? ' on' : ''}`, title: pr.blurb, ...hoverPreview({ ...t, palette: pr.palette, look: pr.look }),
    onclick: () => pickTheme({ ...t, palette: pr.palette, look: pr.look }) }, swatchDot(pr, 'pdot'), aa, h('span', { class: 'pname2' }, pr.name));
}
// A board's own style, right on the board: tiles, shuffle, light/dark, or back to Main's style.
function boardStyle(ui) {
  const t = ui.theme || T.DEFAULT;
  const b = ui.board;
  return h('div', { class: 'bstyle', onmouseleave: previewOff },
    b && h('div', { class: 'iconpick', role: 'radiogroup', 'aria-label': 'Icon' }, [null, ...BOARD_ICONS].map((k) =>
      h('button', { class: `ipick${(b.icon || null) === k ? ' on' : ''}`, title: k ? `Icon: ${k}` : 'Its first letter',
        'aria-label': k || 'first letter', onclick: () => api.board({ op: 'icon', id: b.id, icon: k }) },
      k ? icon(k) : (b.name.trim()[0] || 'B').toUpperCase()))),
    h('div', { class: 'ptiles' }, T.PRESETS.map((pr) => styleTile(t, pr))),
    h('div', { class: 'btnrow' },
      h('button', { class: 'b', title: 'A new style that goes well together', onclick: () => pickTheme(T.shuffle(t, {})) }, 'Shuffle'),
      h('div', { class: 'seg' }, T.MODES.map((m) =>
        h('button', { class: `segb${t.mode === m.id ? ' on' : ''}`, ...hoverPreview({ ...t, mode: m.id }), onclick: () => pickTheme({ ...t, mode: m.id }) }, m.name)))),
    b && b.ownTheme
      ? h('button', { class: 'b ghostb', onclick: () => { preview = null; api.board({ op: 'theme', id: b.id, theme: null }); } }, 'Same style as Main')
      : h('div', { class: 'hint' }, 'Looks like Main until you pick a style here.'));
}
// ---------- right-click on a session: what you can do with it, in this window's own style ----------
let ctx = null;
function closeMenu() { if (ctx) { ctx.remove(); ctx = null; } }
function sessionMenu(e, c, where) {
  e.preventDefault();
  e.stopPropagation();
  closeMenu();
  if (innerWidth < 230 || innerHeight < 230) { api.sessionMenu(c.key, where === 'dock'); return; } // too small a window (a dock): Windows' own menu
  const ui = state.ui;
  const here = c.board || null;
  const item = (label, lead, fn) => h('button', { class: 'ctxi', role: 'menuitem', onclick: () => { closeMenu(); fn(); } },
    h('span', { class: 'ctxic' }, lead), h('span', { class: 'ctxt' }, label));
  const boards = [{ id: null, name: 'Main' }, ...(ui.boards || [])].filter((b) => b.id !== here);
  ctx = h('div', { class: 'ctxmenu', role: 'menu', 'aria-label': c.name },
    h('div', { class: 'ctxhead' }, c.name),
    c.canJump && item('Open in Claude', icon('jump'), () => api.jump(c.hostId)),
    where === 'dock' && item(dockOpen === c.key ? 'Hide the details' : 'Details', icon(dockOpen === c.key ? 'down' : 'up'), () => clickDockPet(c)),
    item(c.pinned ? 'Unpin' : 'Pin: keep this card', icon('pin'), () => api.pin(c.key, !c.pinned)),
    c.group === 'active' && !c.pinned && item('Hide this card', icon('close'), () => api.hideCard(c.id)),
    item(c.quiet ? 'Turn notifications on' : 'Mute notifications', icon(c.quiet ? 'bell' : 'bellOff'), () => api.quiet(c.key, !c.quiet)),
    where !== 'dock' && item('Pet and colour', icon('brush'), () => togglePetMenu(c, where)),
    h('div', { class: 'ctxsep' }),
    h('div', { class: 'ctxlabel' }, 'Move to'),
    boards.map((b) => item(b.name, b.id ? boardSquare(b) : icon('home'), () => api.board({ op: 'move', id: b.id, items: { keys: [c.key], name: c.name } }))),
    item('A new board', icon('plus'), () => api.board({ op: 'new', items: { keys: [c.key], name: c.name } })));
  document.body.append(ctx);
  const r = ctx.getBoundingClientRect();
  ctx.style.left = `${Math.max(6, Math.min(e.clientX, innerWidth - r.width - 6))}px`;
  ctx.style.top = `${Math.max(6, Math.min(e.clientY, innerHeight - r.height - 6))}px`;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) ctx.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 120, easing: 'ease-out' });
}
document.addEventListener('pointerdown', (e) => { if (ctx && !e.target.closest('.ctxmenu')) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (ctx && e.key === 'Escape') { e.stopPropagation(); closeMenu(); } }, true);
window.addEventListener('blur', closeMenu);

// ---------- tooltips in this window's own style (Windows' plain ones only where they would not fit) ----------
(function tooltips() {
  let tip = null;
  let target = null;
  let timer = 0;
  const hide = () => { clearTimeout(timer); timer = 0; if (tip) { tip.remove(); tip = null; } target = null; };
  const show = () => {
    if (!target || !target.isConnected || !target.dataset.tip) return;
    tip = h('div', { class: 'tip', role: 'tooltip' }, target.dataset.tip);
    document.body.append(tip);
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let y = r.bottom + 6;
    if (y + t.height > innerHeight - 4) y = r.top - t.height - 6;
    tip.style.left = `${Math.max(4, Math.min(innerWidth - t.width - 4, r.left + r.width / 2 - t.width / 2))}px`;
    tip.style.top = `${Math.max(4, y)}px`;
  };
  document.addEventListener('mouseover', (e) => {
    if (innerWidth < 240 || innerHeight < 150 || VIEW === 'carry') return; // a small window (dock, bare sidebar)
    const el = e.target.closest && e.target.closest('[title], [data-tip]');
    if (el === target) return;
    hide();
    if (!el || document.documentElement.classList.contains('carrying')) return;
    if (el.hasAttribute('title')) {
      const text = el.getAttribute('title');
      el.removeAttribute('title');
      if (!text) return;
      el.dataset.tip = text;
    }
    target = el;
    timer = setTimeout(show, 450);
  });
  document.addEventListener('mouseout', (e) => { if (target && !(e.relatedTarget && target.contains(e.relatedTarget))) hide(); });
  for (const ev of ['pointerdown', 'wheel', 'keydown']) document.addEventListener(ev, hide, true);
  window.addEventListener('blur', hide);
})();

// ---------- minimised bar ----------
// Collapsed panel: every session in the Sessions list by state.
// States that need you (waiting, error) get a strong colour; click anything to expand.
const CHIP_WORD = { waiting: 'need you', error: 'error', working: 'working', done: 'done', idle: 'idle' };
function miniBar(cards) {
  const n = G.stateCounts(cards);
  const expand = () => api.set({ collapsed: false });
  const chips = G.STATE_ORDER.filter((k) => n[k]).map((k) =>
    h('button', { class: `chip ${k}`, title: `${n[k]} ${k === 'waiting' ? 'waiting for you' : k}. Click to expand`, onclick: expand },
      h('b', null, String(n[k])), ` ${k === 'waiting' && n[k] === 1 ? 'needs you' : CHIP_WORD[k]}`));
  return h('div', { class: 'minibar', onclick: expand },
    h('div', { class: 'chips' }, chips.length ? chips : h('span', { class: 'chip idle' }, 'no sessions')),
  );
}

// Stretched minimised bar: deck sessions as one-line rows, urgent first. Click a row to jump in.
function miniList(cards, on) {
  const rank = (c) => G.STATE_ORDER.indexOf(c.state) + 1 || 9;
  const rows = cards.filter((c) => c.group === 'active').sort((a, b) => rank(a) - rank(b));
  const row = (c) => h('div', { class: `mrow ${c.state}${c.canJump ? '' : ' nolink'}`, style: petColor(c), title: c.cwd || '',
    onclick: () => c.canJump && api.jump(c.hostId), oncontextmenu: (e) => sessionMenu(e, c, 'mini') },
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
          ...hoverPreview({ ...t, palette: p.id }), onclick: () => { preview = null; set({ palette: p.id }); } });
        b.style.setProperty('--s-bg', p.swatch.bg);
        b.style.setProperty('--s-acc', p.swatch.accent);
        b.style.setProperty('--s-warn', p.swatch.warn);
        return b;
      })),
    h('div', { class: 'trow' }, h('span', { class: 'tlabel' }, 'Look'),
      T.LOOKS.map((l) => {
        const aa = h('span', { class: 'aa' }, 'Aa');
        aa.style.fontFamily = l.font;
        return h('button', { class: `lookchip${t.look === l.id ? ' on' : ''}`, ...hoverPreview({ ...t, look: l.id }),
          onclick: () => { preview = null; set({ look: l.id }); } }, aa, l.name);
      })),
    h('div', { class: 'trow' }, h('span', { class: 'tlabel' }, 'Light / dark'),
      h('div', { class: 'seg' }, T.MODES.map((m) =>
        h('button', { class: `segb${t.mode === m.id ? ' on' : ''}`, ...hoverPreview({ ...t, mode: m.id }),
          onclick: () => { preview = null; set({ mode: m.id }); } }, m.name)))));
}

// Hover a style choice: the real panel shows it until the pointer leaves (nothing is saved until you click).
let preview = null;
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
function previewOn(theme) { preview = T.normalizeTheme(theme); applyTheme(state.ui); }
function previewOff() { if (!preview) return; preview = null; applyTheme(state.ui); }
const hoverPreview = (theme) => ({ onmouseenter: () => previewOn(theme), onmouseleave: previewOff });
function pickTheme(theme) { preview = null; api.set({ theme }); }

function applyTheme(ui) {
  const t = preview || ui.theme || T.DEFAULT;
  const d = document.documentElement.dataset;
  if (d.palette !== t.palette) d.palette = t.palette;
  if (d.look !== t.look) d.look = t.look;
  const mode = preview ? T.resolveMode(preview, systemDark()) : ui.mode || T.resolveMode(t, false);
  if (d.mode !== mode) d.mode = mode;
  const glass = String(ui.glass || 0);
  if (d.glass !== glass) d.glass = glass;
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
  const el = pet(c.pet, P.petState(c), { title: `${P.PET_NAMES[c.pet] || 'Pet'} · click to change, drag to move`, class: 'pet pickable', 'data-key': c.key });
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
    case 'error': return c.limited
      ? h('div', { class: 'line2 tired' }, 'Out of usage', h('span', { class: 'muted' }, ' · napping until your limit resets'))
      : h('div', { class: 'line2 err' }, 'Stopped', c.error && h('span', { class: 'muted' }, ` · ${c.error}`));
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
  const el = h('div', { class: `card ${c.state}${depth ? ' child' : ''}${c.pinned ? ' pinned' : ''}${c.canJump ? ' canjump' : ''}`,
    style: `${petColor(c)};--depth:${depth}`, title: c.cwd || '', 'data-k': c.key },
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
      ? btn('pin', 'Pinned: click to unpin', () => api.pin(c.key, false), { class: 'ib on pinned' })
      : [btn('pin', 'Pin: keep this card', () => api.pin(c.key, true), { class: 'ib hoverish' }),
        btn('close', 'Hide this card until it does something new', () => api.hideCard(c.id))]));
  if (c.canJump) el.addEventListener('click', () => api.jump(c.hostId));
  el.addEventListener('contextmenu', (e) => sessionMenu(e, c, 'deck'));
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
  return h('div', { class: `ghost${depth ? ' child' : ''}${c.canJump ? '' : ' nolink'}`, style: `${petColor(c)};--depth:${depth}`, 'data-k': c.key,
    title: `${c.name}: parent session, not on the deck${c.cwd ? `\n${c.cwd}` : ''}`,
    onclick: () => c.canJump && api.jump(c.hostId), oncontextmenu: (e) => sessionMenu(e, c, 'deck') },
  avatar(c),
  foldArrow(it),
  h('span', { class: 'name' }, c.name),
  foldBadge(it),
  h('span', { class: 'tag' }, 'parent'),
  STATE_WORD[c.state] && h('span', { class: `sbadge ${c.state}` }, STATE_WORD[c.state]),
  c.canJump && btn('jump', 'Open in Claude', () => api.jump(c.hostId), { class: 'ib small hoverish' }));
}

// Rename a project (your name instead of its folder's) or one of your groups: the pencil on its header.
let renamingGroup = null;
function groupLabel(it, mode) {
  if (renamingGroup !== it.key || !(mode === 'folder' || (mode === 'custom' && it.key))) return h('span', { class: 'glabel' }, it.label);
  const done = (e, save) => {
    if (renamingGroup !== it.key) return;
    renamingGroup = null;
    const v = e.target.value.trim();
    if (save && v !== it.label) {
      if (mode === 'folder') api.projectName(it.key, v); // empty: back to the folder's name
      else if (v) api.group({ op: 'rename', id: it.key, name: v });
    }
    render();
  };
  return h('input', { class: 'text gname', 'data-focus': 'gname', value: it.label, maxlength: '40', 'aria-label': 'Name',
    onclick: (e) => e.stopPropagation(),
    onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') done(e, true); else if (e.key === 'Escape') done(e, false); },
    onblur: (e) => done(e, true) });
}
function groupHeader(it, editable = false, mode = (state && state.ui.groupBy) || 'folder') {
  const canRename = it.key && (mode === 'folder' || mode === 'custom');
  return h('div', { class: `ghdr${it.foldable ? ' foldable' : ''}`, style: it.color ? `--gc:var(--g${it.color})` : '', 'data-h': it.key,
    onclick: () => it.foldable && renamingGroup !== it.key && api.fold(G.foldKeyOf(it), !it.folded) },
    foldArrow(it),
    h('span', { class: 'gdot' }), groupLabel(it, mode), h('span', { class: 'gcount' }, String(it.count)),
    canRename && renamingGroup !== it.key && btn('pencil', mode === 'folder' ? 'Rename this project (only here in Flocklet)' : 'Rename this group',
      () => { renamingGroup = it.key; focusAfterRender = 'gname'; render(); }, { class: 'ib small hoverish' }),
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
    style: `${petColor(c)};--depth:${depth}`, title: c.cwd || '', onclick: () => c.canJump && api.jump(c.hostId),
    oncontextmenu: (e) => sessionMenu(e, c, 'list') },
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
  const arranged = G.arrange(hits, ui.groupBy, { all: cards, groups: ui.groups, showEmptyGroups: !query, folderOrder: ui.folderOrder, names: ui.projectNames });
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
  : c.state === 'done' ? '✓' : c.state === 'error' ? (c.limited ? 'z' : '×') : null);
const bubbleSig = (c) => `${c.state}|${(c.waiting && c.waiting.id) || ''}|${c.since || ''}`;
function markSeen(c) {
  if (!bubbleOf(c) || seenBubbles.get(c.key) === bubbleSig(c)) return;
  seenBubbles.set(c.key, bubbleSig(c));
  render();
}
// A pet's details: its card pops up above the dock (status, step, ctx, answer box); again folds it.
function clickDockPet(c) {
  seenBubbles.set(c.key, bubbleSig(c));
  dockOpen = dockOpen === c.key ? null : c.key;
  render();
}
// Click a pet: a quick hop, and you are in its chat. A pet with no chat to open shows its details instead.
function hopToChat(c) {
  if (!c.canJump) { clickDockPet(c); return; }
  seenBubbles.set(c.key, bubbleSig(c));
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) emote(c.key, 'hop');
  api.jump(c.hostId);
}
const DOCK_WORD = { waiting: 'needs you', working: 'working', done: 'done', error: 'stopped with an error', idle: 'idle' };
const dockWord = (c) => (c.limited ? 'out of usage' : DOCK_WORD[c.state] || 'idle');
function dockPet(c, open, names) {
  const b = bubbleOf(c);
  const unseen = b && seenBubbles.get(c.key) !== bubbleSig(c);
  const word = c.state === 'waiting' && c.waiting ? (WAIT_LABEL[c.waiting.kind] || 'Needs you') : dockWord(c);
  const on = !!open && open.key === c.key;
  return h('button', { class: `dpet ${c.state}${c.limited ? ' limited' : ''}${on ? ' on' : ''}${names ? ' named' : ''}${c.canJump ? ' canjump' : ''}`, style: petColor(c),
    title: `${c.name}: ${word} · ${c.canJump ? 'click: open the chat · arrow: details' : 'click: details'} · drag: move`,
    'aria-label': `${c.name}: ${word}`, 'data-k': c.key,
    onclick: () => hopToChat(c), onmouseenter: () => markSeen(c),
    oncontextmenu: (e) => sessionMenu(e, c, 'dock') },
  unseen && h('span', { class: `bubble ${c.limited ? 'limited' : c.state}` }, b),
  c.canJump && h('span', { class: 'dinfo', 'aria-hidden': 'true', title: on ? 'Hide the details' : 'Details',
    onclick: (e) => { e.stopPropagation(); clickDockPet(c); } }, icon(on ? 'down' : 'up')),
  h('span', { class: 'dpetimg' }, pet(c.pet, P.petState(c), { 'data-key': c.key })),
  names && h('span', { class: 'dname' }, c.name),
  h('span', { class: `dbar ${c.limited ? 'limited' : c.state}` }));
}
// Groups follow the panel's grouping (Projects / Groups / All) and its folds: a folded group is one stacked
// icon with a count; sessions that need you stay visible next to it.
function dockGroups(cards, ui) {
  const active = cards.filter((c) => c.group === 'active');
  const items = G.arrange(active, ui.groupBy === 'tree' ? 'none' : ui.groupBy, { all: cards, groups: ui.groups, folderOrder: ui.folderOrder, names: ui.projectNames });
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
const toCards = () => { dockOpen = null; if (VIEW === 'board') api.board({ op: 'dock', id: BOARD_ID, on: false }); else api.set({ dock: false }); };
function dockView(cards, ui) {
  const groups = dockGroups(cards, ui);
  const all = groups.flatMap((g) => g.cards);
  const open = dockOpen && all.find((c) => c.key === dockOpen);
  if (dockOpen && !open) dockOpen = null;
  const names = !!ui.dockNames;
  let budget = DOCK_MAX;
  let more = 0;
  const labelled = !!ui.dockGroupNames && groups.filter((g) => g.label).length > 1; // off by default; one group: its name adds nothing
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
    if (!g.label || !labelled) return h('div', { class: 'dgroup plain' }, h('div', { class: 'dpets' }, pets));
    return h('div', { class: `dgroup${g.folded ? ' folded' : ''}`, 'data-h': g.key },
      h('button', { class: 'dglabel', title: g.folded ? `Unfold ${g.label}` : `Fold ${g.label}`,
        style: g.color ? `color:var(--g${g.color})` : '', onclick: () => api.fold(`h:${g.key}`, !g.folded) }, g.label),
      h('div', { class: 'dpets' }, pets));
  }).filter(Boolean);
  return [
    open && h('div', { class: 'dockpop' }, card(open, 0)),
    h('div', { class: `dockbar${names ? ' named' : ''}`, oncontextmenu: (e) => { e.preventDefault(); if (VIEW === 'board') api.boardMenu(BOARD_ID); else api.dockMenu(); } },
      blocks.length ? blocks : h('span', { class: 'dempty' }, VIEW === 'board' ? 'No pets on this board' : 'No pets on the deck'),
      more > 0 && h('button', { class: 'dmore', title: `${more} more: open the panel`, onclick: () => toCards() }, `+${more}`),
      h('div', { class: 'dend' },
        btn('expand', VIEW === 'board' ? 'Show as cards' : 'Open the full panel', () => toCards(), { class: 'ib small' }),
        VIEW === 'board'
          ? btn('minimise', 'Hide this board (its button in the sidebar brings it back)', () => api.board({ op: 'hide', id: BOARD_ID }), { class: 'ib small' })
          : btn('minimise', 'Minimise this dock: the sidebar stays (click Home to bring it back)', () => api.set({ mainHidden: true }), { class: 'ib small' })))
  ];
}

// ---------- sidebar rail + drawers ----------
// The rail sits on one side of the deck (ui.rail); its drawer opens outward beyond it (main sizes the window).
const openDrawer = (name) => {
  menuFor = null;
  if (state.ui.panelsHidden) api.set({ panelsHidden: false, drawer: name }); // panels hidden: bring them back with it
  else api.set({ drawer: state.ui.drawer === name ? null : name });
};
const unhide = () => { if (state.ui.panelsHidden || state.ui.mainHidden) api.set({ panelsHidden: false, mainHidden: false }); };
// A board's square: its colours, and its icon or first letter.
function boardSquare(b) {
  const pal = T.PALETTES.find((p) => p.id === (b.theme || {}).palette) || T.PALETTES[0];
  const sq = h('span', { class: `bsq${b.icon ? ' hasicon' : ''}` }, b.icon ? icon(b.icon) : (b.name.trim()[0] || 'B').toUpperCase());
  sq.style.setProperty('--s-bg', pal.swatch.bg);
  sq.style.setProperty('--s-acc', pal.swatch.accent);
  return sq;
}
// ---------- where something happened: a board you are not looking at says so on its tab or toggle ----------
// amber = needs you, red = stopped, green = finished since you last looked (with a count). When the chime plays,
// the tab or toggle it came from pulses; a board window shows it on its own panel.
const lookedAt = new Map(); // board id ('main' for Main) -> when you last had it in front of you
const pings = new Map(); // board id ('main') -> { at, kind } of the last sound from it
const bid = (id) => id || 'main';
function news(cards, id) {
  const mine = cards.filter((c) => (c.board || null) === id && c.group === 'active');
  const since = lookedAt.get(bid(id)) || EPOCH;
  return {
    waiting: mine.filter((c) => c.state === 'waiting').length,
    error: mine.filter((c) => c.state === 'error' && !c.limited && (c.since || 0) > since).length,
    done: mine.filter((c) => c.state === 'done' && (c.since || 0) > since).length,
  };
}
function newsDot(n) {
  if (n.waiting) return h('span', { class: 'rdot' });
  if (n.error) return h('span', { class: 'rdot err' });
  if (n.done) return h('span', { class: 'rdot done' }, n.done > 1 ? String(n.done) : '');
  return null;
}
const needs = (n) => {
  const w = [n.waiting && `${n.waiting} need${n.waiting > 1 ? '' : 's'} you`, n.error && `${n.error} stopped`, n.done && `${n.done} finished`].filter(Boolean);
  return w.length ? ` · ${w.join(', ')}` : '';
};
const quiet = { waiting: 0, error: 0, done: 0 };
// The pulse on a tab or toggle: its class and how far in it is (so a re-render does not restart it).
function pingOn(el, id) {
  const p = pings.get(bid(id));
  if (!p || Date.now() - p.at > 2700) return el;
  el.classList.add('ping', p.kind);
  el.style.setProperty('--pa', `-${Date.now() - p.at}ms`);
  return el;
}
// Main's card shows one board at a time: Main itself, or a board that lives on it. Drop a session on a tab to move it.
function railTabs(ui, cards) {
  const view = ui.boardView || null;
  const home = view ? news(cards, null) : quiet;
  const tab = (b) => {
    const n = view === b.id ? quiet : news(cards, b.id);
    return pingOn(h('button', { class: `rbtn rtab${view === b.id ? ' on' : ''}`, 'data-drop': `board:${b.id}`, 'data-board': b.id, 'aria-label': b.name,
      title: `${b.name}${needs(n)}: show it on the main card · drag it out of Flocklet for its own window · right-click for more`,
      onclick: () => { unhide(); api.board({ op: 'view', id: b.id }); }, oncontextmenu: (e) => { e.preventDefault(); api.boardMenu(b.id); } },
    boardSquare(b), newsDot(n)), view === b.id ? '-' : b.id);
  };
  return h('div', { class: 'rsec rtabs', title: '' },
    pingOn(h('button', { class: `rbtn rtab home${view || ui.mainHidden ? '' : ' on'}`, 'data-drop': 'main', 'aria-label': 'Main',
      title: ui.mainHidden ? `Main${needs(home)}: show the main card` : view ? `Main${needs(home)}: your sessions that are on no board`
        : 'Main: click again to minimise the card (the sidebar and your boards stay)',
      onclick: () => {
        if (state.ui.mainHidden || state.ui.panelsHidden) { unhide(); api.board({ op: 'view', id: null }); }
        else if (!view) api.set({ mainHidden: true }); // you are on it: minimise it
        else api.board({ op: 'view', id: null });
      } },
    icon('home'), newsDot(home)), view ? null : '-'),
    (ui.boards || []).filter((b) => b.inside).map(tab),
    h('button', { class: 'rbtn rtab add', 'data-drop': 'new', 'aria-label': 'New board',
      title: 'New board on the main card (or drop a session or group here)', onclick: () => { unhide(); api.board({ op: 'new' }); } }, icon('plus')));
}
// Boards in their own windows: one toggle each (show / hide), and a menu for all of them.
function railWindows(ui, cards) {
  const outside = (ui.boards || []).filter((b) => !b.inside);
  const toggle = (b) => {
    const n = b.visible ? quiet : news(cards, b.id); // a window you can see tells you itself
    return pingOn(h('button', { class: `rbtn rtoggle${b.visible ? ' on' : ''}`, 'data-drop': `board:${b.id}`, 'data-board': b.id, 'aria-label': b.name,
      'aria-pressed': b.visible ? 'true' : 'false',
      title: `${b.name}${needs(n)}: ${b.visible ? 'hide' : 'show'} its window · drag it onto the tabs to put it on the main card · right-click for more`,
      onclick: () => { if (state.ui.panelsHidden) { unhide(); return; } api.board({ op: 'toggle', id: b.id }); },
      oncontextmenu: (e) => { e.preventDefault(); api.boardMenu(b.id); } },
    boardSquare(b), h('span', { class: 'rwin' }), newsDot(n)), b.visible ? '-' : b.id);
  };
  return h('div', { class: `rsec rwins${outside.length ? '' : ' empty'}` },
    outside.map(toggle),
    h('span', { class: 'rslot', title: 'Drop a tab here to give it its own window' }),
    outside.length > 0 && btn('layers', 'All board windows: hide them, bring back the ones you hid, show them', () => api.boardMenu(null), { class: 'ib small rall' }));
}
// The Sessions / Settings card: two tabs, a grip to dock it on another side of the deck, close.
function drawerCard(cards, ui) {
  const tabs = [['sessions', 'Sessions'], ['settings', 'Settings']];
  return [
    h('div', { class: 'dtop' },
      h('div', { class: 'seg dtabs' }, tabs.map(([k, label]) =>
        h('button', { class: `segb${ui.drawer === k ? ' on' : ''}`, onclick: () => api.set({ drawer: k }) }, label))),
      h('span', { class: 'spacer' }),
      h('div', { class: 'dgrip', title: 'Drag to another side of the panel' }, icon('grip')),
      btn('close', 'Close', () => api.set({ drawer: null }), { class: 'ib small' })),
    ui.drawer === 'sessions' ? browser(cards, ui) : settingsDrawer(ui),
  ];
}
function railButton(name, iconName, label, badge) {
  const on = state.ui.drawer === name;
  return h('button', { class: `rbtn${on ? ' on' : ''}`, title: on ? `Close ${label}` : label, 'aria-label': label,
    'aria-pressed': on ? 'true' : 'false', onclick: () => openDrawer(name) },
  icon(iconName), badge != null && h('span', { class: 'rbadge' }, String(badge)));
}
const ZOOMS = [[0.9, 'Small'], [1, 'Normal'], [1.25, 'Large'], [1.5, 'Extra large']];
const FEEL = [['mood', 'Mood', 'Calm', 'Playful'], ['crisp', 'Edges', 'Soft', 'Crisp']];
const GLASS = ['Off', 'Light', 'Medium', 'Strong'];
const shuffleLocks = { palette: false, look: false, mode: false };
// A slider being dragged: hold re-renders (a live event would rebuild it under the pointer), catch up after.
let holdRender = false, renderMissed = false;
let carryHold = false;   // carry.js: a pet is being carried, keep the DOM still until it lands
let afterRender = null;  // carry.js: one-shot hook run right after the next render (the landing animation)
window.addEventListener('pointerup', () => { if (!holdRender) return; holdRender = false; if (renderMissed) { renderMissed = false; render(); } });
const themeName = (t) => `${(T.PALETTES.find((p) => p.id === t.palette) || {}).name} + ${(T.LOOKS.find((l) => l.id === t.look) || {}).name}`;
function swatchDot(t, cls = 'sdot') {
  const pal = T.PALETTES.find((p) => p.id === t.palette) || T.PALETTES[0];
  const el = h('span', { class: cls });
  el.style.setProperty('--s-bg', pal.swatch.bg);
  el.style.setProperty('--s-acc', pal.swatch.accent);
  return el;
}
function slider(label, min, max, value, labels, onInput, onChange) {
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: '1', value: String(value), 'aria-label': label,
    onpointerdown: () => { holdRender = true; } });
  input.addEventListener('input', () => onInput(Number(input.value)));
  input.addEventListener('change', () => onChange(Number(input.value)));
  return h('label', { class: 'slider' }, h('span', { class: 'slname' }, label), input,
    h('span', { class: 'slends' }, h('span', null, labels[0]), h('span', null, labels[1])));
}

// Simple: the few things most people change, in plain words. Everything else is one click away (Advanced).
function simpleSettings(ui) {
  const t = ui.theme || T.DEFAULT;
  const feel = T.feelOf(t);
  const lockChip = (k, label) => h('button', { class: `lock${shuffleLocks[k] ? ' on' : ''}`, 'aria-pressed': shuffleLocks[k] ? 'true' : 'false',
    title: shuffleLocks[k] ? `${label} stays when you shuffle` : `Keep the ${label.toLowerCase()} when you shuffle`,
    onclick: () => { shuffleLocks[k] = !shuffleLocks[k]; render(); } }, shuffleLocks[k] ? `Keep ${label.toLowerCase()} \u2713` : `Keep ${label.toLowerCase()}`);
  const presetTile = (pr) => styleTile(t, pr);
  const zi = Math.max(0, ZOOMS.findIndex(([z]) => z === (ui.zoom || 1)));
  return [
    h('section', null, h('div', { class: 'slabel' }, 'Style'),
      h('div', { class: 'ptiles' }, T.PRESETS.map(presetTile)),
      h('div', { class: 'btnrow' },
        h('button', { class: 'b', title: 'A new style that goes well together', onclick: () => pickTheme(T.shuffle(t, shuffleLocks)) }, 'Shuffle'),
        lockChip('palette', 'Colours'), lockChip('look', 'Font'), lockChip('mode', 'Light/dark')),
      (ui.canUndoTheme || (ui.recentThemes || []).length > 0) && h('div', { class: 'btnrow recent' },
        h('button', { class: 'b ghostb', disabled: !ui.canUndoTheme, onclick: () => api.undoTheme() }, 'Undo'),
        (ui.recentThemes || []).length > 0 && h('span', { class: 'hint' }, 'Recent'),
        (ui.recentThemes || []).map((r) => h('button', { class: 'recentb', title: themeName(r), 'aria-label': `Back to ${themeName(r)}`,
          ...hoverPreview(r), onclick: () => pickTheme(r) }, swatchDot(r))))),
    h('section', null, h('div', { class: 'slabel' }, 'Feel'),
      FEEL.map(([k, name, lo, hi]) => slider(name, 0, 4, Math.round(feel[k] * 4), [lo, hi],
        (v) => { const f = { ...feel, [k]: v / 4 }; previewOn(T.fromFeel(f.mood, f.crisp, t)); },
        (v) => { const f = { ...feel, [k]: v / 4 }; pickTheme(T.fromFeel(f.mood, f.crisp, t)); })),
      slider('Glass', 0, 3, ui.glass || 0, ['Solid', 'See-through'], (v) => { document.documentElement.dataset.glass = String(v); },
        (v) => api.set({ glass: v })),
      slider('Size', 0, 3, zi, ['Small', 'Extra large'], () => {}, (v) => api.set({ zoom: ZOOMS[v][0] })),
      h('div', { class: 'hint' }, `Size: ${ZOOMS[zi][1]} (${Math.round(ZOOMS[zi][0] * 100)} %)`)),
    h('section', null, h('div', { class: 'slabel' }, 'View'),
      h('div', { class: 'seg' },
        h('button', { class: `segb${!ui.dock && !ui.collapsed ? ' on' : ''}`, onclick: () => api.set({ dock: false, collapsed: false }) }, 'Panel'),
        h('button', { class: `segb${!ui.dock && ui.collapsed ? ' on' : ''}`, onclick: () => api.set({ dock: false, collapsed: true }) }, 'Minimised'),
        h('button', { class: `segb${ui.dock ? ' on' : ''}`, onclick: () => api.set({ dock: true }) }, 'Pet dock'))),
    h('section', null, h('div', { class: 'slabel' }, 'Alerts'),
      toggleEl(!ui.muted, 'Chime when a session needs you or finishes', () => api.set({ muted: !ui.muted })),
      toggleEl(ui.notify !== false, 'Windows notifications', () => api.set({ notify: ui.notify === false }))),
    h('button', { class: 'b ghostb more', onclick: () => api.set({ settingsAdvanced: true }) }, 'All settings \u2192'),
  ];
}
const toggleEl = (on, label, onclick) => h('button', { class: `toggle${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick },
  h('span', { class: 'knob' }), label);

function settingsDrawer(ui) {
  const advanced = !!ui.settingsAdvanced;
  return h('div', { class: 'settings', 'data-scroll': advanced ? 'settings-adv' : 'settings', onmouseleave: previewOff },
    h('div', { class: 'dheadrow' }, h('h3', { class: 'dhead' }, advanced ? 'All settings' : 'Settings'),
      advanced && h('button', { class: 'b ghostb', onclick: () => api.set({ settingsAdvanced: false }) }, '\u2190 Simple')),
    advanced ? advancedSettings(ui) : simpleSettings(ui));
}

// Advanced: every manual setting, as before, plus size.
function advancedSettings(ui) {
  const sideBtn = (side, label) => h('button', { class: `segb${ui.rail === side ? ' on' : ''}`, onclick: () => api.set({ rail: side }) }, label);
  const toggle = toggleEl;
  return [
    h('section', null, h('div', { class: 'slabel' }, 'View'),
      h('div', { class: 'seg' },
        h('button', { class: `segb${!ui.dock && !ui.collapsed ? ' on' : ''}`, onclick: () => api.set({ dock: false, collapsed: false }) }, 'Panel'),
        h('button', { class: `segb${!ui.dock && ui.collapsed ? ' on' : ''}`, onclick: () => api.set({ dock: false, collapsed: true }) }, 'Minimised'),
        h('button', { class: `segb${ui.dock ? ' on' : ''}`, onclick: () => api.set({ dock: true }) }, 'Pet dock'))),
    h('section', null, h('div', { class: 'slabel' }, 'Order'),
      h('div', { class: 'hint' }, 'Drag a card, a pet or a group name to move it. A parent takes its children along. Drop it on a tab in the sidebar to move it to that board, on + for a new one, or outside Flocklet for a board in its own window.'),
      ui.ordered && h('div', { class: 'btnrow' },
        h('button', { class: 'b', onclick: () => api.order({ reset: true }) }, 'Back to automatic order')),
      ui.ordered && h('div', { class: 'hint' }, 'Automatic: sessions that need you first, then the most recent.')),
    h('section', null, h('div', { class: 'slabel' }, 'Sidebar side'),
      h('div', { class: 'seg' }, sideBtn('left', 'Left'), sideBtn('right', 'Right'), sideBtn('top', 'Top'), sideBtn('bottom', 'Bottom')),
      h('div', { class: 'hint' }, 'Or drag the dots at the end of the sidebar to any side.')),
    h('section', null, h('div', { class: 'slabel' }, 'Sound and alerts'),
      toggle(!ui.muted, 'Chime when a session needs you or finishes', () => api.set({ muted: !ui.muted })),
      toggle(ui.notify !== false, 'Windows notifications', () => api.set({ notify: ui.notify === false }))),
    h('section', null, h('div', { class: 'slabel' }, 'Tour'),
      h('div', { class: 'btnrow' }, h('button', { class: 'b', onclick: () => api.openTour() }, 'Show the tour')),
      h('div', { class: 'hint' }, 'A one-minute walk through what Flocklet can do. Your choices there apply right away.')),
    h('section', null, h('div', { class: 'slabel' }, 'App'),
      ui.startup == null
        ? h('div', { class: 'hint' }, 'Start with Windows and updates work in the installed app (this copy runs from source).')
        : toggle(!!ui.startup, 'Start with Windows', () => api.set({ startup: !ui.startup })),
      ui.dev
        ? h('div', { class: 'hint' }, 'Dev copy: debug log is always on.')
        : toggle(!!ui.debug, 'Debug log', () => api.set({ debug: !ui.debug })),
      !ui.dev && h('div', { class: 'hint' }, 'Adds event names and timings to a log file on this PC, for bug reports. No prompts or file contents; nothing is sent.'),
      h('div', { class: 'btnrow' },
        ui.updates && h('button', { class: 'b', onclick: () => api.checkUpdates() }, 'Check for updates'),
        h('span', { class: 'hint' }, `Flocklet ${ui.version || ''}`))),
    h('section', null, h('div', { class: 'slabel' }, 'Pets and dock'),
      toggle(!!ui.dockNames, 'Names under the pets', () => api.set({ dockNames: !ui.dockNames })),
      toggle(!!ui.dockGroupNames, 'Project and group names above the pets', () => api.set({ dockGroupNames: !ui.dockGroupNames })),
      toggle(ui.emotes !== false, 'Busy pets do little emotes', () => api.set({ emotes: ui.emotes === false })),
      h('div', { class: 'hint' }, 'Pets are grouped like the panel (Projects / Groups / All). Right-click the dock for more.')),
    h('section', null, h('div', { class: 'slabel' }, 'Size'),
      h('div', { class: 'seg' }, ZOOMS.map(([z, name]) =>
        h('button', { class: `segb${(ui.zoom || 1) === z ? ' on' : ''}`, onclick: () => api.set({ zoom: z }) }, name))),
      h('div', { class: 'btnrow' },
        h('button', { class: 'b', onclick: () => api.drag('right', 'reset', 0, 0) }, 'Reset width'),
        h('button', { class: 'b', onclick: () => api.drag('bottom', 'reset', 0, 0) }, 'Automatic height')),
      h('div', { class: 'hint' }, 'Drag the panel edges to resize; double-click an edge to reset it.')),
    h('section', null, h('div', { class: 'slabel' }, 'Look'), themer(ui)),
    h('section', null, h('div', { class: 'slabel' }, 'Glass'),
      h('div', { class: 'seg' }, GLASS.map((name, i) =>
        h('button', { class: `segb${(ui.glass || 0) === i ? ' on' : ''}`, onclick: () => api.set({ glass: i }) }, name))),
      h('div', { class: 'hint' }, 'How much of your desktop shows through the panel.')),
  ];
}
function renderShell(cards, ui) {
  const shell = document.getElementById('shell');
  if (VIEW !== 'main') { // a board window: just the panel, no sidebar; joined edges lose their margin (magnet)
    const j = ui.joined || {};
    shell.className = `shell solo${ui.dock ? ' docked' : ''}${['left', 'right', 'top', 'bottom'].filter((k) => j[k]).map((k) => ` j-${k}`).join('')}`;
    shell.style.setProperty('--deckw', `${ui.width || 340}px`);
    if (ui.deckHeight != null) shell.style.setProperty('--deckh', `${ui.deckHeight - 24}px`); else shell.style.removeProperty('--deckh');
    document.getElementById('rail').replaceChildren();
    document.getElementById('drawer').hidden = true;
    return;
  }
  const side = ui.rail || 'left';
  const dside = ui.drawerSide || 'right';
  const bare = !!ui.panelsHidden || !!ui.mainHidden; // only the sidebar
  shell.className = `shell side-${side} dside-${dside}${ui.dock ? ' docked' : ui.collapsed ? ' minimised' : ''}${ui.drawer && !bare ? ' open' : ''}${bare ? ' bare' : ''}`;
  document.body.classList.toggle('docked', !!ui.dock);
  shell.style.setProperty('--deckw', `${ui.width || 368}px`);
  if (ui.deckHeight != null) shell.style.setProperty('--deckh', `${ui.deckHeight - 24}px`); else shell.style.removeProperty('--deckh');
  const rail = document.getElementById('rail');
  rail.classList.remove('min');
  shell.classList.remove('railmin');
  // The sidebar never hides. Its eye hides the panels (Main's card, Sessions / Settings, every board) and brings
  // the same ones back; minimise sends everything to the tray.
  rail.replaceChildren(...[
    railButton('sessions', 'list', 'Sessions', cards.length),
    railTabs(ui, cards),
    railWindows(ui, cards),
    h('span', { class: 'spacer' }),
    railButton('settings', 'gear', 'Settings'),
    btn(bare ? 'eye' : 'eyeOff', bare ? 'Show the panels again' : 'Hide the panels (Main, Sessions / Settings, boards): only this sidebar stays',
      () => api.set({ panelsHidden: !bare }), { class: `ib small rhide${bare ? ' on' : ''}` }),
    btn('minimise', 'Minimise everything to the tray (the tray chick or Ctrl+Alt+A brings it back)', () => api.hide(), { class: 'ib small rmin' }),
    h('div', { class: 'rgrip', id: 'rgrip', title: 'Drag to another side of the panel' }, icon('grip')),
  ].filter(Boolean));
  popRail(rail);
  const drawer = document.getElementById('drawer');
  drawer.hidden = !ui.drawer || bare; // opens beside the panel, the minimised bar and the pet dock alike
  if (drawer.hidden) drawer.replaceChildren();
  else drawer.replaceChildren(...drawerCard(cards, ui));
}

// A board that just arrived in the sidebar (dropped on it, or made) pops in.
let lastRailBoards = null;
function popRail(rail) {
  const ids = [...rail.querySelectorAll('[data-board]')].map((el) => el.dataset.board);
  if (lastRailBoards && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const el of rail.querySelectorAll('[data-board]')) {
      if (lastRailBoards.has(el.dataset.board)) continue;
      el.animate([{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1.25)', opacity: 1, offset: 0.6 }, { transform: 'none' }],
        { duration: 420, easing: 'ease-out' });
    }
  }
  lastRailBoards = new Set(ids);
}

// Drag the rail's dots, or the card's, to dock it on another side: the side of the panel nearest the pointer wins.
// The card goes left or right only.
(function dockByDrag() {
  let dragging = false;
  let what = 'rail'; // or 'drawerSide' (the Sessions / Settings card)
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
    const grip = e.target.closest('#rgrip, .dgrip');
    if (!grip || e.button !== 0) return;
    what = grip.id === 'rgrip' ? 'rail' : 'drawerSide';
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    dragging = true;
    document.body.classList.add('docking');
  });
  shell.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (what === 'drawerSide') {
      const r = document.getElementById('panel').getBoundingClientRect();
      shell.dataset.dock = e.clientX < r.left + r.width / 2 ? 'left' : 'right';
    } else shell.dataset.dock = sideAt(e.clientX, e.clientY);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('docking');
    const side = shell.dataset.dock;
    delete shell.dataset.dock;
    const now = what === 'rail' ? state.ui.rail : state.ui.drawerSide || state.ui.rail;
    if (side && side !== now && e.type === 'pointerup') api.set({ [what]: side });
  };
  shell.addEventListener('pointerup', end);
  shell.addEventListener('pointercancel', end);
  shell.addEventListener('lostpointercapture', end);
})();

// ---------- render ----------
let lastKeys = null; // the cards on this page last time: new ones pop in
function render() {
  if (holdRender || carryHold) { renderMissed = true; return; }
  if (VIEW === 'carry' || !state) return;
  const { cards, ui, hooks } = state;
  const deck = onDeck(cards);
  const panel = document.getElementById('panel');
  if (VIEW === 'main') { // what is in front of you counts as seen: Main's card, and board windows that show
    const now = Date.now();
    if (!ui.panelsHidden && !ui.collapsed && !ui.dock) lookedAt.set(bid(myBoard()), now);
    for (const b of ui.boards || []) if (!b.inside && b.visible) lookedAt.set(b.id, now);
  }
  if (ui.board && ui.board.fresh && !renaming && (VIEW === 'board' || ui.boardView === ui.board.id)) { // just made: name it
    renaming = true;
    focusAfterRender = 'bname';
    api.board({ op: 'seen', id: ui.board.id });
  }
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focus : null;
  const caret = focused ? document.activeElement.selectionStart : null;
  applyTheme(ui);
  let kids;
  {
    const pinged = panelPing && Date.now() - panelPing.at < 2700 ? ` pinged ${panelPing.kind}` : '';
    panel.className = `panel${ui.dock ? ' dock' : ui.collapsed ? ' collapsed' : ''}${ui.fixedHeight ? ' fixed' : ''}${pinged}`;
    if (pinged) panel.style.setProperty('--pa', `-${Date.now() - panelPing.at}ms`);
    kids = ui.dock ? dockView(deck, ui).filter(Boolean) : [VIEW === 'board' ? boardHeader(state, deck) : header(state, deck)];
    if (VIEW === 'board' && boardStyleOpen) kids.push(boardStyle(ui));
    if (ui.dock) { /* pet dock: nothing else */ } else if (ui.collapsed) kids.push(miniBar(cards));
    if (ui.collapsed && !ui.dock) kids.push(miniList(deck, ui.miniList)); // always built, so its full height can be measured
    if (!ui.collapsed && !ui.dock) {
      if (!hooks.ok) kids.push(h('div', { class: 'banner' }, hooks.blocked ? hooks.error : `Live updates off: ${hooks.error}. Showing session list only.`));
      const active = deck.filter((c) => c.group === 'active');
      let items = G.fold(G.arrange(active, ui.groupBy, { all: cards, groups: ui.groups, folderOrder: ui.folderOrder, names: ui.projectNames }), ui.folded);
      // a board with one project or group: its header would only repeat the board's name
      if (myBoard() && items.filter((it) => it.type === 'header').length === 1 && !items.some((it) => it.folded)) items = items.filter((it) => it.type !== 'header');
      const empty = myBoard() ? 'Nothing here right now. Drag a group or a session onto this board.'
        : 'No agent is working right now. Pin sessions from Sessions in the sidebar to keep them here.';
      kids.push(h('div', { class: 'list', 'data-scroll': 'deck' }, items.length
        ? items.map((it) => (it.type === 'header' ? groupHeader(it, false, ui.groupBy) : withPetMenu(it.type === 'ghost' ? ghostRow(it.card, it.depth, it) : card(it.card, it.depth, it), it.card, it.depth, 'deck')))
        : h('div', { class: 'empty' }, empty)));
    }
  }
  // render() rebuilds the DOM, which resets every list to the top: keep each scroll position.
  const scrolls = new Map([...document.querySelectorAll('[data-scroll]')].map((el) => [el.dataset.scroll, el.scrollTop]));
  panel.replaceChildren(...kids);
  renderShell(cards, ui);
  for (const el of document.querySelectorAll('[data-scroll]')) {
    if (scrolls.has(el.dataset.scroll)) el.scrollTop = scrolls.get(el.dataset.scroll);
  }
  if (afterRender) { const f = afterRender; afterRender = null; f(); }
  popNew(panel);
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

// A card that just arrived (a new session, or one dropped here from another board) pops in.
function popNew(panel) {
  const els = [...panel.querySelectorAll('[data-k]')];
  const now = new Set(els.map((el) => el.dataset.k));
  if (lastKeys && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const el of els) {
      if (lastKeys.has(el.dataset.k)) continue;
      el.animate([{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1.03)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
        { duration: 320, easing: 'ease-out' });
    }
  }
  lastKeys = now;
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

// The sidebar's own length (its buttons, without the stretchy gap): the window's size when the panels are hidden.
function railLength() {
  const rail = document.getElementById('rail');
  if (!rail || !rail.children.length) return 0;
  const down = rail.offsetHeight >= rail.offsetWidth;
  const cs = getComputedStyle(rail);
  const kids = [...rail.children].filter((el) => !el.classList.contains('spacer'));
  const gap = parseFloat(cs.rowGap || cs.gap) || 4;
  const sum = kids.reduce((n, el) => n + (down ? el.offsetHeight : el.offsetWidth), 0) + gap * kids.length;
  return Math.ceil(sum + (down ? parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) : parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) + 12);
}
function reportSize() {
  const panel = document.getElementById('panel');
  if (VIEW === 'carry') return;
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
  const ss = getComputedStyle(document.getElementById('shell'));
  const pad = (k) => parseFloat(ss[k]) || 0;
  const total = Math.ceil(height + pad('paddingTop') + pad('paddingBottom')); // shell margins: 8 above, 16 below (room for the shadow)
  const mini = panel.querySelector('.minilist');
  const bar = mini && !mini.classList.contains('off') ? total - listFull : total;
  const dockbar = panel.querySelector('.dockbar');
  const pop = panel.querySelector('.dockpop');
  const dockW = dockbar ? Math.ceil(Math.max(dockbar.scrollWidth, pop ? pop.scrollWidth : 0) + pad('paddingLeft') + pad('paddingRight') + 2) : 0;
  api.resize(total, { bar, full: bar + listFull, dockW, rail: railLength() });
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

let panelPing = null; // a board window: { at, kind } of the last news on this board
function detectTransitions(cards) {
  let sound = null;
  const from = new Map(); // board id ('main') -> what happened there
  for (const c of cards) {
    const before = prevStates.get(c.id);
    if (!firstRender && before !== c.state) {
      let kind = null;
      if (c.state === 'waiting') { sound = 'attention'; kind = 'waiting'; }
      else if ((c.state === 'done' || c.state === 'error') && (before === 'working' || before === 'waiting')) {
        sound = sound || 'done';
        kind = c.state === 'error' ? 'error' : 'done';
      }
      if (kind && c.group === 'active' && !(from.get(bid(c.board)) === 'waiting')) from.set(bid(c.board), kind);
    }
    prevStates.set(c.id, c.state);
  }
  firstRender = false;
  const now = Date.now();
  for (const [id, kind] of from) pings.set(id, { at: now, kind });
  if (VIEW === 'board' && from.has(BOARD_ID)) panelPing = { at: now, kind: from.get(BOARD_ID) };
  if (sound && VIEW === 'main') chime(sound); // one chime: board windows see the same news and stay quiet
}

api.onDropzone((on) => document.getElementById('panel').classList.toggle('dropzone', on));
api.onFx((what) => {
  if (what.startsWith('details:')) { // from Windows' own session menu in a small dock
    const c = (state.cards || []).find((x) => x.key === what.slice(8));
    if (c) clickDockPet(c);
    return;
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const p = document.getElementById('panel');
  if (what === 'vanish') { // emptied: the board shrinks away
    p.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(0.6)', opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
    return;
  }
  if (what !== 'into-main') return;
  p.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(1.03)', opacity: 1, offset: 0.25 }, { transform: 'scale(0.15)', opacity: 0 }],
    { duration: 260, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' });
});
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
