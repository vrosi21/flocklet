// Agent pets: four original characters, each one SVG holding every expression.
// CSS (style.css, "pets") shows the right eyes/bubble per data-s and animates them.
// All markup here is built from constants only (never from session data), so app.js can
// keep its rule of using innerHTML solely for constant SVG. Colours come from classes
// (inline style attributes would be blocked by the page CSP).
(function (root) {
  const PETS = ['chick', 'mochi', 'chip', 'ghost'];
  const PET_NAMES = { chick: 'Puffball', mochi: 'Mochi blob', chip: 'Chip bot', ghost: 'Ghost puff' };
  const STATES = ['idle', 'thinking', 'working', 'waiting', 'done', 'error', 'asleep'];
  const ASLEEP_AFTER_MS = 15 * 60e3;

  // Card -> pet state. Idle has no Zzz; only a long idle (asleep) does.
  function petState(card, now = Date.now()) {
    switch (card && card.state) {
      // The store sets activity "Thinking…" at turn start, before the first tool call.
      case 'working': return card.activity && !/^thinking/i.test(card.activity) ? 'working' : 'thinking';
      case 'waiting': return 'waiting';
      case 'done': return 'done';
      case 'error': return 'error';
      default: {
        const since = card && (card.since || card.lastActivityAt);
        return since && now - since > ASLEEP_AFTER_MS ? 'asleep' : 'idle';
      }
    }
  }

  const defaultPet = (hue) => PETS[Math.abs(Math.round(Number(hue) || 0)) % PETS.length];
  const colorSlot = (hue) => (Math.abs(Math.round(Number(hue) || 0)) % 6) + 1; // -> var(--g1..g6)

  // ---- shared face parts (eyes at lx/rx, height y, size s) ----
  const f = (n) => +n.toFixed(2);
  function eyes(lx, rx, y, s) {
    const open = [lx, rx].map((x) =>
      `<ellipse class="p-eye" cx="${x}" cy="${y}" rx="${f(2 * s)}" ry="${f(2.5 * s)}"/>` +
      `<circle class="p-hl" cx="${f(x + 0.7 * s)}" cy="${f(y - 0.9 * s)}" r="${f(0.8 * s)}"/>`).join('');
    const arc = (dy) => [lx, rx].map((x) => `<path class="p-line" d="M${f(x - 2 * s)} ${y} q${f(2 * s)} ${f(dy * s)} ${f(4 * s)} 0"/>`).join('');
    const brows = `<path class="p-line" d="M${f(lx - 2.2 * s)} ${f(y - 3.9 * s)} L${f(lx + 1.9 * s)} ${f(y - 2.8 * s)}"/>` +
      `<path class="p-line" d="M${f(rx + 2.2 * s)} ${f(y - 3.9 * s)} L${f(rx - 1.9 * s)} ${f(y - 2.8 * s)}"/>`;
    const swirl = [lx, rx].map((x) =>
      `<path class="p-line" d="M${x} ${y} m${f(-1.9 * s)} 0 a${f(1.9 * s)} ${f(1.9 * s)} 0 1 1 ${f(1.9 * s)} ${f(1.9 * s)} a${f(1 * s)} ${f(1 * s)} 0 1 1 ${f(-0.9 * s)} ${f(-1.1 * s)}"/>`).join('');
    return `<g class="eyes-open">${open}</g><g class="eyes-closed">${arc(1.7)}</g><g class="eyes-happy">${arc(-2.6)}</g>` +
      `<g class="eyes-focus">${open}${brows}</g><g class="eyes-swirl">${swirl}</g>`;
  }
  const blush = (lx, rx, y) => [lx, rx].map((x) => `<ellipse class="p-blush" cx="${x}" cy="${y}" rx="2.2" ry="1.3"/>`).join('');

  // ---- bubbles, top-right ----
  const BUBBLES =
    '<g class="bub-dots"><rect class="p-bub" x="24" y="0.5" width="11.5" height="7" rx="3.5"/>' +
      '<circle class="p-bubtx" cx="27" cy="4" r="0.9"/><circle class="p-bubtx" cx="29.75" cy="4" r="0.9"/><circle class="p-bubtx" cx="32.5" cy="4" r="0.9"/></g>' +
    '<g class="bub-bang"><circle class="p-bub" cx="31" cy="5" r="4.4"/><rect class="p-bubtx" x="30.3" y="2.2" width="1.4" height="3.6" rx="0.7"/><circle class="p-bubtx" cx="31" cy="7.3" r="0.8"/></g>' +
    '<g class="bub-x"><circle class="p-bub" cx="31" cy="5" r="4.4"/><path class="p-bubline" d="M29.3 3.3l3.4 3.4M32.7 3.3l-3.4 3.4"/></g>' +
    '<g class="bub-z"><path class="p-zline" d="M26 6.5h3l-3 3.4h3"/><path class="p-zline z2" d="M31 1.2h2.6l-2.6 3h2.6"/></g>' +
    '<g class="spark"><path class="p-spark" d="M31 0.6l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z"/><path class="p-spark s2" d="M4.5 4l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z"/></g>';

  const BODIES = {
    chick:
      '<ellipse class="p-beak" cx="13" cy="33.6" rx="2.4" ry="1.3"/><ellipse class="p-beak" cx="21" cy="33.6" rx="2.4" ry="1.3"/>' +
      '<ellipse class="p-shade wing-l" cx="4.6" cy="22" rx="2.6" ry="4" transform="rotate(20 4.6 22)"/>' +
      '<g class="wing-r"><ellipse class="p-shade" cx="29.4" cy="22" rx="2.6" ry="4" transform="rotate(-20 29.4 22)"/></g>' +
      '<circle class="p-body" cx="17" cy="20" r="13"/>' +
      '<ellipse class="p-belly" cx="17" cy="25.5" rx="8" ry="5.8"/>' +
      '<path class="p-tuft tuft" d="M16 7.4q-2.2-4.6 1.6-5.3q3.1-.3 1.6 2.7"/>' +
      eyes(12.5, 21.5, 18.5, 1) +
      '<path class="p-beak" d="M15.4 21.6q1.6-1.3 3.2 0q-1.6 2.5-3.2 0z"/>' +
      blush(8.8, 25.2, 22.6),
    mochi:
      '<path class="p-body" d="M3.5 32.5Q2.5 12 18 12Q33.5 12 32.5 32.5Q18 34.5 3.5 32.5Z"/>' +
      '<ellipse class="p-shine" cx="11.5" cy="17" rx="3" ry="1.6" transform="rotate(-20 11.5 17)"/>' +
      eyes(13.5, 22.5, 23.5, 0.85) +
      blush(9.6, 26.4, 27.2),
    chip:
      '<path class="p-pins" d="M3.5 18h3M3.5 23h3M3.5 28h3M29.5 18h3M29.5 23h3M29.5 28h3"/>' +
      '<path class="p-stem tuft" d="M18 12.5V8.5"/><path class="p-leaf tuft" d="M18 8.6q0-4.6 4.6-5.6q0 4.6-4.6 5.6z"/>' +
      '<rect class="p-body" x="6.5" y="12.5" width="23" height="21.5" rx="4"/>' +
      '<rect class="p-screen" x="9.5" y="15.5" width="17" height="12" rx="2.5"/>' +
      eyes(14.5, 21.5, 21.5, 0.7) +
      '<circle class="p-led" cx="11.2" cy="30.8" r="1"/>',
    ghost:
      '<path class="p-ghost" d="M5 33V18Q5 6 18 6Q31 6 31 18V33q-2.17-2.4-4.33 0t-4.33 0t-4.33 0t-4.33 0t-4.33 0t-4.33 0Z"/>' +
      eyes(13.5, 22.5, 17.5, 0.85) +
      '<ellipse class="p-eye mouth" cx="18" cy="22.4" rx="1.2" ry="1.4"/>' +
      blush(9.8, 26.2, 21.4),
  };

  const SVG = {};
  for (const k of PETS) {
    SVG[k] = `<svg viewBox="0 0 36 36" class="pet-svg pet-${k}" aria-hidden="true"><g class="pet-figure">${BODIES[k]}</g>${BUBBLES}</svg>`;
  }
  const petSvg = (kind) => SVG[PETS.includes(kind) ? kind : 'chick'];

  const api = { PETS, PET_NAMES, STATES, ASLEEP_AFTER_MS, petState, defaultPet, colorSlot, petSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlockletPets = api;
})(typeof window !== 'undefined' ? window : this);
