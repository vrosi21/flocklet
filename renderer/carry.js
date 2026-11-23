// Drag to reorder (decided 2026-11-23): pick up a card, a pet in the dock, or a group by its name, and carry
// it to a new spot among its siblings (inside its own group; a parent takes its children along). While carried,
// the card folds into its pet, which dangles under the pointer; the others make room. The new order goes to
// main (G.placeBlock) and shows at once (G.reorderBlock). Loaded after app.js and uses its globals
// (state, api, G, P, h, pet, render, emote, carryHold, afterRender, renderMissed, petFor, menuFor).
(function () {
  const START_PX = 6; // a press that moves less than this is a click
  const NEST_H = 46; // the landing spot in the panel, while you carry
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NOOP = { finished: Promise.resolve(), cancel() {} };
  const anim = (el, kf, o) => (still() || !el || !el.animate ? NOOP : el.animate(kf, o));
  const esc = (k) => CSS.escape(k);
  const pcOf = (c) => `var(--g${c.colorSlot || P.colorSlot(c.hue)})`;
  const deckBox = () => document.querySelector('.list[data-scroll="deck"]');
  const dockBox = () => document.querySelector('.dockbar');
  let press = null; // a press on something you can carry, not yet moved far enough
  let drag = null; // what you carry
  let swallowClick = false; // the click that ends a drag is not a click

  // The arranged items (unfolded, so folded children move too), split into sections at each header.
  function layout(where) {
    const ui = state.ui;
    const mode = where === 'dock' && ui.groupBy === 'tree' ? 'none' : ui.groupBy;
    const active = state.cards.filter((c) => c.group === 'active');
    const secs = [];
    let cur = null;
    for (const it of G.arrange(active, mode, { all: state.cards, groups: ui.groups, folderOrder: ui.folderOrder })) {
      if (it.type === 'header') { cur = { key: it.key, label: it.label, items: [] }; secs.push(cur); continue; }
      if (!cur) { cur = { key: null, label: null, items: [] }; secs.push(cur); }
      cur.items.push({ key: it.card.key, depth: it.depth, card: it.card, ghost: it.type === 'ghost' });
    }
    return { mode, secs };
  }
  const parentOf = (items, i) => { for (let j = i - 1; j >= 0; j--) if (items[j].depth < items[i].depth) return j; return -1; };

  // A section in the panel: its header and everything up to the next header.
  function sectionEls(box, key) {
    const hd = box.querySelector(`:scope > [data-h="${esc(key)}"]`);
    if (!hd) return [];
    const els = [hd];
    for (let n = hd.nextElementSibling; n && !n.hasAttribute('data-h'); n = n.nextElementSibling) if (!n.classList.contains('nest')) els.push(n);
    return els;
  }

  // What the press picked up: the unit (it + its children), its siblings on screen (the places it can go).
  function begin(p) {
    const box = p.where === 'dock' ? dockBox() : deckBox();
    if (!box || !state) return null;
    const { mode, secs } = layout(p.where);
    const elOf = (k) => box.querySelector(`[data-k="${esc(k)}"]`);
    let d;
    if (p.kind === 'card') {
      const sec = secs.find((s) => s.items.some((x) => x.key === p.key));
      if (!sec) return null;
      const items = sec.items;
      const i = items.findIndex((x) => x.key === p.key);
      const end = G.unitEnd(items, i);
      const par = parentOf(items, i);
      const units = [];
      items.forEach((x, j) => {
        if (j === i || x.depth !== items[i].depth || parentOf(items, j) !== par || !elOf(x.key)) return;
        units.push({ j, els: items.slice(j, G.unitEnd(items, j)).map((y) => elOf(y.key)).filter(Boolean) });
      });
      const mine = items.slice(i, end).map((x) => elOf(x.key)).filter(Boolean);
      if (!mine.length) return null;
      d = { kind: 'card', sec, i, end, units, mine, card: items[i].card, depth: items[i].depth,
        extra: items.slice(i + 1, end).filter((x) => !x.ghost).length };
      d.orig = units.findIndex((u) => u.j > i);
    } else {
      if (mode !== 'folder' && mode !== 'custom') return null;
      const movable = (s) => s.key != null && !(mode === 'custom' && s.key === ''); // "Ungrouped" stays last
      const si = secs.findIndex((s) => s.key === p.key);
      if (si < 0 || !movable(secs[si])) return null;
      const elsOf = (s) => (p.where === 'dock'
        ? [box.querySelector(`:scope > .dgroup[data-h="${esc(s.key)}"]`)].filter(Boolean) : sectionEls(box, s.key));
      const units = [];
      secs.forEach((s, j) => { if (j !== si && movable(s)) { const els = elsOf(s); if (els.length) units.push({ j, els }); } });
      const mine = elsOf(secs[si]);
      if (!mine.length) return null;
      const cards = secs[si].items.filter((x) => !x.ghost).map((x) => x.card);
      d = { kind: 'group', si, units, mine, sec: secs[si], cards, card: cards[0] || secs[si].items[0].card };
      d.orig = units.findIndex((u) => u.j > si);
    }
    if (d.orig < 0) d.orig = d.units.length;
    return Object.assign(d, { where: p.where, box, mode, secs, key: p.key, slot: d.orig, ready: false,
      x: 0, y: 0, vx: 0, vy: 0, ang: 0, av: 0, px: p.x, py: p.y });
  }

  // Pick up: the pet pops out and follows the pointer; the card folds into it; a nest marks where it will land.
  function lift(d) {
    petFor = null;
    menuFor = null;
    for (const m of d.box.querySelectorAll('.petpop')) m.remove();
    carryHold = true;
    document.documentElement.classList.add('carrying');
    const body = h('div', { class: 'cbody' });
    if (d.kind === 'card') {
      body.append(pet(d.card.pet, 'carry'));
      if (d.extra > 0) body.append(h('span', { class: 'cbadge' }, `+${d.extra}`));
    } else {
      const hud = h('div', { class: 'huddle' }, d.cards.slice(0, 3).map((c) => {
        const el = pet(c.pet, 'carry');
        el.style.setProperty('--pc', pcOf(c));
        return el;
      }));
      body.append(hud, h('span', { class: 'cbadge' }, String(d.cards.length)), d.sec.label && h('span', { class: 'ctag' }, d.sec.label));
    }
    const carrier = h('div', { class: `carrier in-${d.where}${d.kind === 'group' ? ' flock' : ''}` }, body);
    carrier.style.setProperty('--pc', pcOf(d.card));
    document.body.append(carrier);
    d.carrier = carrier;
    d.body = body;
    const src = d.kind === 'card' ? d.mine[0].querySelector('.pet') : null;
    const r0 = src && src.getBoundingClientRect();
    const cr = carrier.getBoundingClientRect();
    d.cw = cr.width;
    d.ch = cr.height;
    d.x = r0 ? r0.left + r0.width / 2 - d.cw / 2 : d.px - d.cw / 2;
    d.y = r0 ? r0.top : d.py - d.ch / 2;
    carrier.style.transform = `translate(${d.x}px, ${d.y}px)`;
    anim(body.firstChild, [{ transform: 'scale(0.85)' }, { transform: 'scale(1.2) translateY(-3px)', offset: 0.45 }, { transform: 'none' }],
      { duration: 280, easing: 'ease-out' });

    const nest = h('div', { class: `nest ${d.where === 'dock' ? (d.kind === 'group' ? 'dgnest' : 'dnest') : d.kind === 'group' ? 'gnest' : 'cnest'}${d.depth ? ' child' : ''}` });
    nest.style.setProperty('--pc', pcOf(d.card));
    if (d.depth) nest.style.setProperty('--depth', String(d.depth));
    d.nest = nest;
    if (d.where === 'dock') { placeNest(d); return; }
    // the card (and its children) folds into the pet, then a short nest takes its place
    const top = d.mine[0].getBoundingClientRect().top;
    const bottom = d.mine[d.mine.length - 1].getBoundingClientRect().bottom;
    d.fromH = bottom - top;
    const cx = r0 ? r0.left + r0.width / 2 : d.px;
    const cy = r0 ? r0.top + r0.height / 2 : d.py;
    const folds = d.mine.map((el) => {
      const r = el.getBoundingClientRect();
      el.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`;
      return anim(el, [{ transform: 'none', opacity: 1 }, { transform: 'scale(0.16)', opacity: 0 }],
        { duration: 170, easing: 'cubic-bezier(.55,0,.8,.3)', fill: 'forwards' }).finished;
    });
    Promise.all(folds).then(() => { if (drag === d && !d.landing) placeNest(d); });
  }

  function placeNest(d) {
    if (d.ready) return;
    d.ready = true;
    d.mine[0].parentNode.insertBefore(d.nest, d.mine[0]);
    for (const el of d.mine) el.style.display = 'none';
    if (d.where === 'deck') {
      anim(d.nest, [{ height: `${d.fromH}px` }, { height: `${d.kind === 'group' ? 30 : NEST_H}px` }],
        { duration: 200, easing: 'cubic-bezier(.3,.7,.4,1)' });
    }
  }

  // The pet hangs from the pointer: it trails a little, swings with the speed, stretches when it falls.
  function frame() {
    const d = drag;
    if (!d || d.landing) return;
    const dock = d.where === 'dock';
    const tx = Math.max(2, Math.min(innerWidth - d.cw - 2, d.px - d.cw / 2));
    const ty = Math.max(2, Math.min(innerHeight - d.ch - 2, d.py - (dock ? d.ch * 0.5 : 8)));
    const k = still() ? 1 : 0.38;
    const nx = d.x + (tx - d.x) * k;
    const ny = d.y + (ty - d.y) * k;
    d.vx = nx - d.x;
    d.vy = ny - d.y;
    d.x = nx;
    d.y = ny;
    const want = Math.max(-30, Math.min(30, d.vx * 2.6));
    d.av = (d.av + (want - d.ang) * 0.16) * 0.8;
    d.ang += d.av;
    const st = 1 + Math.max(-0.07, Math.min(0.1, d.vy * 0.012));
    d.carrier.style.transform = `translate(${d.x}px, ${d.y}px)`;
    d.body.style.transform = still() ? '' : `rotate(${d.ang.toFixed(2)}deg) scale(${(2 - st).toFixed(3)}, ${st.toFixed(3)})`;
    if (d.ready) { autoScroll(d); moveNest(d, slotAt(d)); }
    d.raf = requestAnimationFrame(frame);
  }

  function span(els) {
    let r = null;
    for (const el of els) {
      if (el.style.display === 'none') continue;
      const b = el.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      r = r ? { top: Math.min(r.top, b.top), bottom: Math.max(r.bottom, b.bottom), left: Math.min(r.left, b.left), right: Math.max(r.right, b.right) }
        : { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    }
    return r;
  }
  // The slot under the pointer: before the first sibling whose middle is past it (the panel stacks, the dock runs).
  function slotAt(d) {
    const down = d.where === 'deck';
    const pos = down ? d.py : d.px;
    for (let s = 0; s < d.units.length; s++) {
      const r = span(d.units[s].els);
      if (r && pos < (down ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2)) return s;
    }
    return d.units.length;
  }

  // Move the nest to a slot; the others slide to their new places (FLIP: measure, move, animate the difference).
  function moveNest(d, slot) {
    if (slot === d.slot || !d.units.length) return;
    const parent = d.nest.parentNode;
    let ref;
    if (slot < d.units.length) ref = d.units[slot].els[0];
    else { const last = d.units[d.units.length - 1].els; ref = last[last.length - 1].nextElementSibling; }
    d.slot = slot;
    if (ref === d.nest) return;
    const kids = [...parent.children].filter((n) => n.style.display !== 'none');
    const before = new Map(kids.map((n) => [n, n.getBoundingClientRect()]));
    parent.insertBefore(d.nest, ref);
    flip(before, 180);
  }
  function flip(before, ms) {
    for (const [n, r] of before) {
      if (!n.isConnected) continue;
      const b = n.getBoundingClientRect();
      const dx = r.left - b.left;
      const dy = r.top - b.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      anim(n, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: ms, easing: 'cubic-bezier(.2,.8,.3,1)' });
    }
  }

  function autoScroll(d) {
    if (d.where !== 'deck') return;
    const r = d.box.getBoundingClientRect();
    const edge = 28;
    const v = d.py < r.top + edge ? -(r.top + edge - d.py) / 3 : d.py > r.bottom - edge ? (d.py - r.bottom + edge) / 3 : 0;
    if (v) d.box.scrollTop += Math.max(-14, Math.min(14, v));
  }

  // Let go: the pet flies into the nest and lands with a squish and a puff of dust; then the card unfolds
  // in its new place. Escape (or a cancelled pointer) takes it back home.
  async function finish(commit) {
    const d = drag;
    if (!d || d.landing) return;
    cancelAnimationFrame(d.raf);
    placeNest(d);
    if (commit) moveNest(d, slotAt(d)); else moveNest(d, d.orig);
    d.landing = true;
    const moved = commit && d.slot !== d.orig;
    await land(d);
    puffs(d);
    const from = rects(d);
    if (moved) save(d);
    afterRender = () => settle(d, from, moved);
    carryHold = false;
    renderMissed = false;
    render();
    if (drag === d) { // render did not run (another hold): tidy up anyway
      afterRender = null;
      settle(d, from, moved);
    }
  }

  function land(d) {
    const n = d.nest.getBoundingClientRect();
    let tx;
    let ty;
    if (d.where === 'dock') { tx = n.left + n.width / 2 - d.cw / 2; ty = n.top + (n.height - d.ch) / 2 - 2; }
    else if (d.kind === 'card') { tx = n.left + 29 - d.cw / 2; ty = n.top + 8; } // where the card's pet sits
    else { tx = n.left + 6; ty = n.top - 6; }
    d.body.style.transform = '';
    d.carrier.style.transform = `translate(${tx}px, ${ty}px)`;
    const a = anim(d.carrier, [{ transform: `translate(${d.x}px, ${d.y}px)` }, { transform: `translate(${tx}px, ${ty}px)` }],
      { duration: 200, easing: 'cubic-bezier(.3,.9,.4,1)' });
    anim(d.body, [{ transform: `rotate(${d.ang}deg)` }, { transform: 'rotate(0deg) scale(1.12, 0.82)', offset: 0.68 },
      { transform: 'scale(0.95, 1.07)', offset: 0.85 }, { transform: 'none' }], { duration: 320, easing: 'ease-out' });
    d.x = tx;
    d.y = ty;
    return a.finished;
  }

  function puffs(d) {
    if (still()) return;
    const cx = d.x + d.cw / 2;
    const cy = d.y + d.ch - 3;
    for (let i = 0; i < 5; i++) {
      const p = h('span', { class: 'puff' });
      p.style.left = `${cx - 3}px`;
      p.style.top = `${cy - 3}px`;
      document.body.append(p);
      const dx = (i - 2) * 7 + (Math.random() * 4 - 2);
      const dy = -(1 + Math.random() * 5);
      p.animate([{ transform: 'translate(0, 0) scale(0.6)', opacity: 0.9 }, { transform: `translate(${dx}px, ${dy}px) scale(1.6)`, opacity: 0 }],
        { duration: 420, easing: 'ease-out', fill: 'forwards' }).finished.then(() => p.remove());
    }
  }

  // Positions before the re-render, to slide everything from there (FLIP) once the new order is drawn.
  const idOf = (el) => (el.dataset.k != null ? `k:${el.dataset.k}` : `h:${el.dataset.h}`);
  const selOf = (d) => (d.where === 'deck' ? ':scope > [data-k], :scope > [data-h]' : d.kind === 'group' ? ':scope > .dgroup[data-h]' : '.dpet[data-k]');
  function rects(d) {
    const m = new Map();
    for (const el of d.box.querySelectorAll(selOf(d))) if (el.style.display !== 'none') m.set(idOf(el), el.getBoundingClientRect());
    return m;
  }

  // Save the new order: one section's keys (cards), or the projects / your groups (a group).
  function save(d) {
    const ui = state.ui;
    if (d.kind === 'card') {
      const items = d.sec.items;
      const to = d.slot < d.units.length ? d.units[d.slot].j : G.unitEnd(items, d.units[d.units.length - 1].j);
      const keys = G.moveUnit(items, d.i, to).map((x) => x.key);
      const op = { cards: keys };
      if (d.mode === 'folder') op.folders = d.secs.map((s) => s.key); // the projects stay where they are
      api.order(op);
      state.cards = G.reorderBlock(state.cards, keys);
      state.ui = { ...ui, ordered: true, ...(op.folders ? { folderOrder: op.folders } : {}) };
      return;
    }
    const list = d.secs.map((s) => ({ key: s.key, depth: 0 }));
    const to = d.slot < d.units.length ? d.units[d.slot].j : d.units[d.units.length - 1].j + 1;
    const keys = G.moveUnit(list, d.si, to).map((x) => x.key);
    if (d.mode === 'folder') {
      api.order({ folders: keys });
      state.ui = { ...ui, folderOrder: keys, ordered: true };
    } else {
      const ids = keys.filter((k) => k !== '');
      api.order({ groups: ids });
      state.ui = { ...ui, groups: ids.map((id) => ui.groups.find((g) => g.id === id)).filter(Boolean) };
    }
  }

  // After the re-render: everything slides from where it was, and what you carried unfolds from its pet.
  function settle(d, from, moved) {
    document.documentElement.classList.remove('carrying');
    if (drag === d) drag = null;
    const box = d.where === 'dock' ? dockBox() : deckBox();
    const done = () => d.carrier.remove();
    if (!box) { done(); return; }
    const landed = new Set(d.kind === 'card' ? d.sec.items.slice(d.i, d.end).map((x) => `k:${x.key}`) : [`h:${d.key}`]);
    let els = [];
    for (const el of box.querySelectorAll(selOf(d))) {
      const id = idOf(el);
      if (landed.has(id)) els.push(el);
      else if (from.has(id)) flip(new Map([[el, from.get(id)]]), 220);
    }
    if (d.where === 'deck' && d.kind === 'group') els = sectionEls(box, d.key);
    if (d.where === 'dock') {
      done();
      els.forEach((el) => anim(el, [{ transform: 'scale(0.5)', opacity: 0.4 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.6 }, { transform: 'none' }],
        { duration: 300, easing: 'ease-out' }));
    } else {
      const head = els[0] && (els[0].querySelector('.pet') || els[0]);
      const hr = head && head.getBoundingClientRect();
      const cx = hr ? hr.left + hr.width / 2 : d.x + d.cw / 2;
      const cy = hr ? hr.top + hr.height / 2 : d.y + d.ch / 2;
      els.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        el.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`;
        anim(el, [{ transform: 'scale(0.16)', opacity: 0 }, { transform: 'scale(1.015)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
          { duration: 280, delay: i * 30, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'backwards' });
      });
      anim(d.carrier, [{ opacity: 1 }, { opacity: 0 }], { duration: 110, delay: 170, fill: 'forwards' }).finished.then(done);
      if (still()) done();
    }
    // the pet likes its new spot
    if (d.kind === 'card' && state.ui.emotes !== false && !still()) setTimeout(() => emote(d.key, moved ? 'heart' : 'hop'), 260);
  }

  // ---- input ----
  document.addEventListener('pointerdown', (e) => {
    swallowClick = false;
    if (e.button !== 0 || drag || !state) return;
    const t = e.target;
    if (!(t instanceof Element) || t.closest('input, textarea, select, .waitbox, .petpop, .actions, .dend, .dmore, .newgroup')) return;
    let p = null;
    if (t.closest('.list[data-scroll="deck"]')) {
      if (t.closest('button')) return;
      const row = t.closest('.card[data-k], .ghost[data-k]');
      const hd = t.closest('.ghdr[data-h]');
      if (row) p = { where: 'deck', kind: 'card', key: row.dataset.k };
      else if (hd) p = { where: 'deck', kind: 'group', key: hd.dataset.h };
    } else if (t.closest('.dockbar')) {
      const pe = t.closest('.dpet[data-k]');
      const g = t.closest('.dglabel, .dstack') && t.closest('.dgroup[data-h]');
      if (pe) p = { where: 'dock', kind: 'card', key: pe.dataset.k };
      else if (g) p = { where: 'dock', kind: 'group', key: g.dataset.h };
    }
    press = p && { ...p, x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  window.addEventListener('pointermove', (e) => {
    if (drag) {
      if (e.buttons === 0 && !drag.landing) { finish(true); return; } // the release happened where we did not hear it
      drag.px = e.clientX;
      drag.py = e.clientY;
      return;
    }
    if (!press || e.pointerId !== press.id) return;
    if (e.buttons === 0) { press = null; return; }
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < START_PX) return;
    const d = begin(press);
    press = null;
    if (!d) return;
    drag = d;
    swallowClick = true;
    d.px = e.clientX;
    d.py = e.clientY;
    try { document.body.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    lift(d);
    d.raf = requestAnimationFrame(frame);
  });
  window.addEventListener('pointerup', () => { press = null; if (drag) finish(true); });
  window.addEventListener('pointercancel', () => { press = null; if (drag) finish(false); });
  window.addEventListener('blur', () => { press = null; if (drag) finish(true); });
  window.addEventListener('keydown', (e) => {
    if (drag && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  }, true);
  window.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
