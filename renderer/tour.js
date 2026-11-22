// Flocklet's first-run tour (and "What's new" after an update). A little booklet: one idea per page,
// big pictures, little text. Every choice uses the same settings channel as the panel, so it applies live.
// Demo cards are fake: they never touch real sessions. Pages are listed in tour-pages.js (id, since, title);
// a new feature adds an entry there and a renderer in PAGE below.
const api = window.agentdeck;
const T = window.FlockletThemes;
const P = window.FlockletPets;
const TP = window.FlockletTour;
const ICONS = window.FlockletIcons;
const EPOCH = Date.now();

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'whatsnew' ? 'whatsnew' : 'tour';
const plan = TP.pagesFor({ seen: params.get('seen') || null, current: params.get('version') || '0.0.0', forceTour: mode === 'tour' });
const pages = plan.pages;
let at = 0;
let ui = {};
let demoAnswer = null; // what you clicked on the demo permission card
let mixOpen = false;    // style page: palette and look pickers instead of the presets
let viewPick = null;    // views page: the view you are looking at (null = the one you use)

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
function pet(kind, petState, cls = '') {
  const el = h('div', { class: `pet ${cls}`, 'data-s': petState });
  el.style.setProperty('--age', `-${Date.now() - EPOCH}ms`);
  el.innerHTML = P.petSvg(kind); // constant markup only
  return el;
}
const slot = (n) => `--pc:var(--g${n})`;
function icon(name) {
  const s = h('span', { class: 'ic' });
  s.innerHTML = ICONS[name]; // constant markup only
  return s;
}
const ib = (name, cls = 'ib') => h('span', { class: cls }, icon(name));
const chickSvg = (cls) => { const el = h('span', { class: cls }); el.innerHTML = P.petSvg('chick'); return el; }; // constant markup only

// ---------- pictures of the real app ----------
// Built from the panel's own classes (style.css) with made-up sessions, so they look exactly like Flocklet
// in your current colours. They are pictures: inert, nothing in them reacts or touches a real session.
const DEMO = [
  { name: 'Fix the login bug', pet: 'mochi', slot: 3, state: 'working', ctx: 34, step: [3, 5, 'Run the tests'], t: '4m' },
  { name: 'Tidy the repo', pet: 'chip', slot: 1, state: 'waiting', t: '12s' },
  { name: 'Write the README', pet: 'ghost', slot: 4, state: 'done', t: '2m' },
  { name: 'Plan the release', pet: 'chick', slot: 6, state: 'idle' },
];
const PET_STATE = { working: 'working', waiting: 'waiting', done: 'done', idle: 'asleep' };
function demoCard(d) {
  const line = d.state === 'waiting' ? h('div', { class: 'line2 wait' }, 'Needs permission', h('span', { class: 'sep' }, '·'), h('span', { class: 'timer' }, d.t))
    : d.state === 'done' ? h('div', { class: 'line2 ok' }, 'Done', h('span', { class: 'sep' }, '·'), h('span', { class: 'timer' }, `${d.t} ago`))
      : h('div', { class: 'line2' }, 'Running npm test');
  return h('div', { class: `card ${d.state}`, style: slot(d.slot) },
    pet(d.pet, PET_STATE[d.state]),
    h('div', { class: 'body' },
      h('div', { class: 'row1' }, h('span', { class: 'name' }, d.name), d.ctx && h('span', { class: 'tag ctx' }, `ctx ${d.ctx}%`)),
      line,
      d.step && h('div', { class: 'line3' }, h('span', { class: 'step' }, `${d.step[0]}/${d.step[1]}`), h('span', { class: 'steplabel' }, d.step[2]),
        h('span', { class: 'bar', style: `--p:${d.step[0] / d.step[1]}` }, h('i')), h('span', { class: 'timer' }, d.t))),
    h('div', { class: 'actions' }, ib('jump'), ib('close')));
}
function demoHeader(collapsed) {
  const logo = chickSvg('logo');
  logo.append(h('span', { class: 'dot waiting' }));
  return h('header', { class: 'header' }, logo, h('span', { class: 'title' }, 'Flocklet'), !collapsed && h('span', { class: 'count' }, '3'),
    h('span', { class: 'spacer' }), ib(ui.muted ? 'mute' : 'sound'), ib('dock'), ib(collapsed ? 'down' : 'up'), ib('minimise'));
}
const demoMeter = (cls, label, v) => h('div', { class: cls }, h('span', { class: 'mlabel' }, label),
  h('span', { class: 'bar' }, h('i', { style: `--p:${v / 100}` })), h('span', { class: 'mval' }, `${v}%`));
function demoRail() {
  const rb = (name, badge) => h('span', { class: 'rbtn' }, icon(name), badge && h('span', { class: 'rbadge' }, badge));
  return h('nav', { class: 'rail pane' }, rb('list', '4'), h('span', { class: 'spacer' }), rb('gear'), ib('minimise', 'ib small rmin'), h('div', { class: 'rgrip' }, icon('grip')));
}
function demoView(view) {
  const side = ui.rail || 'left';
  if (view === 'dock') {
    const bubble = { waiting: '!', done: '✓' };
    const dpet = (d) => h('span', { class: `dpet ${d.state}`, style: slot(d.slot) },
      bubble[d.state] && h('span', { class: `bubble ${d.state}` }, bubble[d.state]),
      h('span', { class: 'dpetimg' }, pet(d.pet, PET_STATE[d.state]), h('span', { class: `ddot ${d.state}` })));
    return h('div', { class: 'shell docked vshell' }, h('div', { class: 'panel dock' },
      h('div', { class: 'dockbar' }, h('div', { class: 'dgroup plain' }, h('div', { class: 'dpets' }, DEMO.map(dpet))),
        h('span', { class: 'dsep' }), h('div', { class: 'dend' }, ib('minimise', 'ib small'), chickSvg('dlogo')))));
  }
  const panel = view === 'mini'
    ? h('div', { class: 'panel collapsed' }, demoHeader(true),
      h('div', { class: 'minibar' },
        h('div', { class: 'chips' }, h('span', { class: 'chip waiting' }, h('b', null, '1'), ' needs you'),
          h('span', { class: 'chip working' }, h('b', null, '1'), ' working'), h('span', { class: 'chip done' }, h('b', null, '1'), ' done')),
        h('div', { class: 'mmeters' }, demoMeter('mmeter', '5h', 42), demoMeter('mmeter', 'wk', 18))))
    : h('div', { class: 'panel' }, demoHeader(false),
      h('div', { class: 'usage' }, h('div', { class: 'meters' }, demoMeter('meter', '5h', 42), demoMeter('meter', 'Week', 18), ib('refresh', 'ib small'))),
      h('div', { class: 'list' }, DEMO.slice(0, 3).map(demoCard)));
  return h('div', { class: `shell side-${side}${view === 'mini' ? ' minimised' : ''} vshell` }, demoRail(), panel);
}
// Scale a picture down until it fits its frame (measured at full size first, so it is never cropped).
function fitStages() {
  for (const stage of document.querySelectorAll('.vstage')) {
    const art = stage.firstElementChild;
    if (!art) continue;
    art.style.zoom = '1';
    const k = Math.min(1, (stage.clientWidth - 24) / art.offsetWidth, (stage.clientHeight - 20) / art.offsetHeight);
    art.style.zoom = String(Math.max(0.4, Math.floor(k * 100) / 100));
  }
}

function applyTheme() {
  const t = ui.theme || T.DEFAULT;
  const d = document.documentElement.dataset;
  d.palette = t.palette;
  d.look = t.look;
  d.mode = ui.mode || T.resolveMode(t, false);
}
const toggle = (on, label, onclick, hint) => h('button', { class: `toggle${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick },
  h('span', { class: 'knob' }), h('span', null, label, hint && h('span', { class: 'thint' }, hint)));

// ---------- pages ----------
const PAGE = {
  hello: () => [
    h('div', { class: 'hero' }, pet('chick', 'idle', 'big')),
    h('h1', null, 'Hi, I am Flocklet.'),
    h('p', { class: 'lead' }, 'I keep an eye on your Claude Code sessions, so you can work somewhere else and still see who needs you.'),
    h('p', { class: 'small' }, 'This takes about a minute. Everything you pick here changes Flocklet right away, and you can change it again later in Settings.'),
  ],

  flock: () => [
    h('h1', null, 'Your flock'),
    h('p', { class: 'lead' }, 'Every session is a little pet. Its mood shows what the agent is doing.'),
    h('div', { class: 'democard', style: slot(3) },
      pet('mochi', 'working'),
      h('div', { class: 'dbody' },
        h('div', { class: 'drow' }, h('b', null, 'Fix the login bug'), h('span', { class: 'tag' }, 'ctx 34%')),
        h('div', { class: 'dline' }, 'Running npm test'),
        h('div', { class: 'dstep' }, h('span', { class: 'step' }, '3/5'), h('span', { class: 'bar' }, h('i', { style: '--p:0.6' })))),
      h('div', { class: 'dact' }, h('span', { class: 'ic' }, '↗'), h('span', { class: 'ic' }, '✕'))),
    h('ul', { class: 'points' },
      h('li', null, h('b', null, 'Moods: '), 'thinking, working, waiting for you, done, error, asleep.'),
      h('li', null, h('b', null, '↗ '), 'jumps straight into that session in Claude.'),
      h('li', null, h('b', null, '✕ '), 'hides a card until it does something new. Pin a session to keep it.'),
      h('li', null, h('b', null, 'Grouped by project, '), 'with side sessions tucked under their parent. Fold any group.')),
  ],

  answer: () => [
    h('h1', null, 'Answer from here'),
    h('p', { class: 'lead' }, 'When Claude asks for permission or asks a question, you can answer in Flocklet. No window switching.'),
    h('div', { class: 'democard waiting', style: slot(1) },
      pet('chip', 'waiting'),
      h('div', { class: 'dbody' },
        h('div', { class: 'drow' }, h('b', null, 'Tidy the repo'), h('span', { class: 'tag' }, 'demo')),
        h('div', { class: 'dline wait' }, 'Needs permission'),
        h('div', { class: 'dcmd' }, 'npm install left-pad'),
        demoAnswer
          ? h('div', { class: 'dok' }, `${demoAnswer}. That is all it takes: the real ones work the same, and Claude carries on right away.`)
          : h('div', { class: 'btnrow' },
            h('button', { class: 'b primary', onclick: () => { demoAnswer = 'Allowed'; render(); } }, 'Allow ', h('span', { class: 'kbd' }, 'A')),
            h('button', { class: 'b', onclick: () => { demoAnswer = 'Always allowed'; render(); } }, 'Always'),
            h('button', { class: 'b danger', onclick: () => { demoAnswer = 'Denied'; render(); } }, 'Deny ', h('span', { class: 'kbd' }, 'D'))))),
    h('p', { class: 'small' }, 'Try it: this card is a demo and does nothing. Questions work the same way, with their options as buttons (keys 1-9).'),
  ],

  style: () => {
    const t = ui.theme || T.DEFAULT;
    const set = (patch) => api.set({ theme: patch });
    const cur = T.presetOf(t);
    const modeFor = (p) => (t.mode === 'windows' ? ui.mode || 'dark' : T.resolveMode({ palette: p.palette, look: p.look, mode: t.mode }, false));
    const tile = (p, i) => {
      const pv = h('div', { class: 'pv', 'data-palette': p.palette, 'data-look': p.look, 'data-mode': modeFor(p), inert: true },
        h('div', { class: 'pvhead' }, chickSvg('logo'), h('span', { class: 'title' }, 'Flocklet')),
        demoCard({ ...DEMO[i % 2 ? 1 : 0], ctx: null, step: null })); // short card: names stay readable when small
      return h('button', { class: `preset${cur && cur.id === p.id ? ' on' : ''}`, onclick: () => set({ palette: p.palette, look: p.look }) },
        pv, h('span', { class: 'pname' }, h('b', null, p.name), i === 0 && h('span', { class: 'tag' }, 'default')), h('span', { class: 'small' }, p.blurb));
    };
    const mixer = () => [
      h('div', { class: 'pick' }, h('div', { class: 'plabel' }, 'Colours'),
        h('div', { class: 'swrow' }, T.PALETTES.map((p) => {
          const b = h('button', { class: `swatch big${t.palette === p.id ? ' on' : ''}`, title: p.name, 'aria-label': p.name, onclick: () => set({ palette: p.id }) });
          b.style.setProperty('--s-bg', p.swatch.bg);
          b.style.setProperty('--s-acc', p.swatch.accent);
          b.style.setProperty('--s-warn', p.swatch.warn);
          return h('div', { class: 'swcell' }, b, h('span', null, p.name));
        }))),
      h('div', { class: 'pick' }, h('div', { class: 'plabel' }, 'Fonts and shapes'),
        h('div', { class: 'lookrow' }, T.LOOKS.map((l) => {
          const aa = h('span', { class: 'aa' }, 'Aa');
          aa.style.fontFamily = l.font;
          return h('button', { class: `lookchip${t.look === l.id ? ' on' : ''}`, onclick: () => set({ look: l.id }) }, aa, l.name);
        }))),
    ];
    return [
      h('h1', null, 'Pick a style'),
      h('p', { class: 'lead' }, mixOpen ? 'Mix any colours with any fonts. Flocklet changes as you click.' : 'Colours and fonts in one click. Flocklet changes as you pick.'),
      mixOpen ? mixer() : h('div', { class: 'presets' }, T.PRESETS.map(tile)),
      h('div', { class: 'moderow' },
        h('span', { class: 'plabel' }, 'Light or dark'),
        h('div', { class: 'seg' }, T.MODES.filter((m) => m.id !== 'palette' || t.mode === 'palette').map((m) =>
          h('button', { class: `segb${t.mode === m.id ? ' on' : ''}`, onclick: () => set({ mode: m.id }) }, m.name))),
        h('span', { class: 'small' }, t.mode === 'windows' ? `Auto follows Windows (${ui.mode || 'dark'} now)` : 'Auto follows Windows'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'b ghostb', onclick: () => { mixOpen = !mixOpen; render(); } }, mixOpen ? '← Ready-made styles' : 'Mix your own →')),
    ];
  },

  pets: () => [
    h('h1', null, 'Pets'),
    h('p', { class: 'lead' }, 'Each session gets its own pet and colour. Click a pet on any card to change it.'),
    h('div', { class: 'petrow' }, P.PETS.map((k, i) =>
      h('div', { class: 'petcell', style: slot(i + 2) },
        pet(k, ['working', 'thinking', 'done', 'asleep'][i % 4], 'mid'),
        h('b', null, P.PET_NAMES[k]),
        h('span', { class: 'small' }, ['working', 'thinking', 'done', 'asleep'][i % 4]),
        h('button', { class: 'b ghostb', onclick: () => api.petMenu('all', null, k) }, 'Use for all')))),
    h('p', { class: 'small' }, '"Use for all" gives every session this pet. You can still change single ones later.'),
  ],

  views: () => {
    const using = ui.dock ? 'dock' : ui.collapsed ? 'mini' : 'panel';
    const view = viewPick || using;
    const VIEWS = [
      ['panel', 'Panel', 'Every card with its details. The sidebar holds all sessions and Settings.', { dock: false, collapsed: false }],
      ['mini', 'Minimised', 'One slim bar: who needs you, who is working, and your usage.', { dock: false, collapsed: true }],
      ['dock', 'Pet dock', 'Only the pets, like a taskbar. A bubble pops up when one needs you.', { dock: true }],
    ];
    const cur = VIEWS.find((v) => v[0] === view);
    return [
      h('h1', null, 'Three ways to see it'),
      h('p', { class: 'lead' }, 'Big when you want details, tiny when you only want to know who needs you.'),
      h('div', { class: 'vtabs' }, VIEWS.map(([id, name]) => h('button', { class: `vtab${view === id ? ' on' : ''}`,
        onclick: () => { viewPick = id; render(); } }, name, using === id && h('span', { class: 'tag' }, 'in use')))),
      h('div', { class: 'vstage', inert: true }, demoView(view)),
      h('div', { class: 'vfoot' },
        h('span', { class: 'small vdesc' }, cur[2]),
        using === view ? h('span', { class: 'small using' }, 'You are using this one.')
          : h('button', { class: 'b primary', onclick: () => api.set(cur[3]) }, `Use ${cur[1]}`)),
      view !== 'dock'
        ? h('div', { class: 'moderow' }, h('span', { class: 'plabel' }, 'Sidebar side'),
          h('div', { class: 'seg' }, [['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']].map(([sd, n]) =>
            h('button', { class: `segb${(ui.rail || 'left') === sd ? ' on' : ''}`, onclick: () => api.set({ rail: sd }) }, n))),
          h('span', { class: 'small' }, 'or drag its dots to any side'))
        : h('div', { class: 'moderow' }, h('span', { class: 'small' }, 'Click a pet to see its card and answer it. Right-click the dock for more.')),
    ];
  },

  loop: () => [
    h('h1', null, 'Stay in the loop'),
    h('p', { class: 'lead' }, 'Flocklet tells you when a session finishes or needs you, even when it is hidden.'),
    h('div', { class: 'toggles' },
      toggle(ui.notify !== false, 'Windows notifications', () => api.set({ notify: ui.notify === false }), 'click one to jump into that session'),
      toggle(!ui.muted, 'A little chime', () => api.set({ muted: !ui.muted })),
      ui.startup != null && toggle(!!ui.startup, 'Start with Windows', () => api.set({ startup: !ui.startup }))),
    h('ul', { class: 'points' },
      h('li', null, h('span', { class: 'kbd' }, 'Ctrl+Alt+A'), ' shows or hides Flocklet.'),
      h('li', null, h('b', null, 'The chick in the tray: '), 'click to bring Flocklet back, right-click for the menu.'),
      h('li', null, h('b', null, 'Updates install themselves: '), 'you get a "Restart now" when a new version is ready.')),
    h('p', { class: 'small' }, 'You can open this tour again any time: tray menu or Settings.'),
  ],
};

// ---------- frame ----------
function finish() { api.tourDone(mode); }
function go(n) { at = Math.max(0, Math.min(pages.length - 1, n)); viewPick = null; render(); }

function render() {
  applyTheme();
  const root = document.getElementById('tour');
  if (!pages.length) { finish(); return; }
  const page = pages[at];
  const last = at === pages.length - 1;
  const body = (PAGE[page.id] || (() => [h('h1', null, page.title)]))();
  root.replaceChildren(
    h('header', { class: 'thead' },
      h('span', { class: 'tbrand' }, mode === 'whatsnew' ? `What's new in Flocklet ${params.get('version') || ''}` : 'Flocklet'),
      h('button', { class: 'ib', title: 'Close the tour', 'aria-label': 'Close the tour', onclick: finish }, '✕')),
    h('main', { class: `tpage p-${page.id}` }, body),
    h('footer', { class: 'tfoot' },
      at === 0 ? h('button', { class: 'b ghostb', onclick: finish }, mode === 'whatsnew' ? 'Close' : 'Skip')
        : h('button', { class: 'b ghostb', onclick: () => go(at - 1) }, '← Back'),
      h('div', { class: 'tdots' }, pages.map((p, i) =>
        h('button', { class: `tdot${i === at ? ' on' : ''}`, title: p.title, 'aria-label': `Page ${i + 1}: ${p.title}`, onclick: () => go(i) }))),
      last ? h('button', { class: 'b primary', onclick: finish }, 'Done')
        : h('button', { class: 'b primary', onclick: () => go(at + 1) }, at === 0 && mode === 'tour' ? 'Show me around' : 'Next →')));
  requestAnimationFrame(fitStages);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') go(at + 1);
  else if (e.key === 'ArrowLeft') go(at - 1);
  else if (e.key === 'Escape') finish();
  else if (pages[at] && pages[at].id === 'answer' && !demoAnswer && (e.key === 'a' || e.key === 'd')) { demoAnswer = e.key === 'a' ? 'Allowed' : 'Denied'; render(); }
});

api.onState((s) => { ui = s.ui || {}; render(); });
render();
api.ready();
