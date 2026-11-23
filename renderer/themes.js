// Theme catalogue shared by the main process (validation, tray menu) and the overlay (picker).
// Colours live in theme.css; this file only knows ids, names, native modes and swatch colours.
(function (root) {
  const PALETTES = [
    { id: 'graphite', name: 'Graphite', native: 'dark', swatch: { bg: '#1c1d20', accent: '#7aa7ff', warn: '#f2b84b' } },
    { id: 'campfire', name: 'Campfire', native: 'dark', swatch: { bg: '#17151a', accent: '#ef7d52', warn: '#f5b942' } },
    { id: 'crimson-hour', name: 'Crimson hour', native: 'dark', swatch: { bg: '#1a1013', accent: '#e8364f', warn: '#ffb547' } },
    { id: 'midnight-plum', name: 'Midnight plum', native: 'dark', swatch: { bg: '#15111f', accent: '#9d6bff', warn: '#ffcc66' } },
    { id: 'lagoon', name: 'Lagoon', native: 'dark', swatch: { bg: '#0e1a1c', accent: '#2ec4b6', warn: '#ffb85c' } },
    { id: 'concrete', name: 'Concrete', native: 'dark', swatch: { bg: '#18191b', accent: '#ffd23f', warn: '#ff8c42' } },
    { id: 'marshmallow', name: 'Marshmallow', native: 'light', swatch: { bg: '#fbf3ec', accent: '#f2765e', warn: '#e09a1c' } },
    { id: 'phosphor', name: 'Phosphor', native: 'dark', swatch: { bg: '#0a0f0b', accent: '#5cff8a', warn: '#ffd35c' } },
  ];

  // font: the look's title font, so a picker chip can preview it.
  const LOOKS = [
    { id: 'pocket', name: 'Pocket', font: '"Pixelify Sans"' },
    { id: 'puff', name: 'Puff', font: 'Fredoka' },
    { id: 'studio', name: 'Studio', font: 'Inter' },
    { id: 'shell', name: 'Shell', font: '"JetBrains Mono"' },
    { id: 'arcade', name: 'Arcade', font: 'Silkscreen' },
    { id: 'tube', name: 'Tube', font: 'VT323' },
  ];

  // windows = follow the Windows app theme (the default, shown as "Auto"); palette = the palette's own mode.
  const MODES = [
    { id: 'windows', name: 'Auto' },
    { id: 'light', name: 'Light' },
    { id: 'dark', name: 'Dark' },
    { id: 'palette', name: "Palette's own" },
  ];

  // Ready-made palette + look pairs (the tour's style page). The first one is the default for new installs.
  const PRESETS = [
    { id: 'neutral', name: 'Neutral', palette: 'graphite', look: 'studio', blurb: 'Calm and clean' },
    { id: 'campfire', name: 'Campfire', palette: 'campfire', look: 'pocket', blurb: 'Warm, a bit pixel' },
    { id: 'soft', name: 'Marshmallow', palette: 'marshmallow', look: 'puff', blurb: 'Soft and round' },
    { id: 'terminal', name: 'Terminal', palette: 'phosphor', look: 'tube', blurb: 'Green screen' },
    { id: 'arcade', name: 'Arcade', palette: 'midnight-plum', look: 'arcade', blurb: 'Retro game' },
    { id: 'workshop', name: 'Workshop', palette: 'concrete', look: 'shell', blurb: 'All code font' },
  ];

  const DEFAULT = { palette: PRESETS[0].palette, look: PRESETS[0].look, mode: 'windows' };
  const has = (list, id) => list.some((x) => x.id === id);

  function normalizeTheme(t) {
    const src = t && typeof t === 'object' ? t : {};
    return {
      palette: has(PALETTES, src.palette) ? src.palette : DEFAULT.palette,
      look: has(LOOKS, src.look) ? src.look : DEFAULT.look,
      mode: has(MODES, src.mode) ? src.mode : DEFAULT.mode,
    };
  }

  // The light/dark value that goes on <html data-mode>. systemDark only matters for 'windows'.
  function resolveMode(theme, systemDark) {
    const t = normalizeTheme(theme);
    if (t.mode === 'light' || t.mode === 'dark') return t.mode;
    if (t.mode === 'windows') return systemDark ? 'dark' : 'light';
    return PALETTES.find((p) => p.id === t.palette).native;
  }

  const presetOf = (t) => PRESETS.find((p) => t && p.palette === t.palette && p.look === t.look) || null;

  // ---------- feel: two plain sliders and a shuffle that leans toward good pairs ----------
  // mood: 0 calm .. 1 playful. crisp: 0 soft .. 1 crisp (contrast, hard edges). Hand-scored.
  const TRAITS = {
    graphite: { mood: 0.1, crisp: 0.5 }, campfire: { mood: 0.5, crisp: 0.5 }, 'crimson-hour': { mood: 0.6, crisp: 0.8 },
    'midnight-plum': { mood: 0.7, crisp: 0.6 }, lagoon: { mood: 0.4, crisp: 0.45 }, concrete: { mood: 0.45, crisp: 0.9 },
    marshmallow: { mood: 0.75, crisp: 0.25 }, phosphor: { mood: 0.75, crisp: 0.95 },
    studio: { mood: 0.1, crisp: 0.5 }, shell: { mood: 0.3, crisp: 0.8 }, puff: { mood: 0.7, crisp: 0.15 },
    pocket: { mood: 0.75, crisp: 0.6 }, arcade: { mood: 0.95, crisp: 0.9 }, tube: { mood: 0.85, crisp: 0.7 },
  };
  const isPreset = (pal, look) => PRESETS.some((p) => p.palette === pal && p.look === look);
  // How well a palette and a look go together: same mood and edge, and a bonus for the hand-made presets.
  function pairScore(pal, look) {
    const a = TRAITS[pal], b = TRAITS[look];
    return 1 - Math.abs(a.mood - b.mood) * 0.7 - Math.abs(a.crisp - b.crisp) * 0.5 + (isPreset(pal, look) ? 0.6 : 0);
  }
  // Where the sliders sit for a theme (rounded to the 5 stops 0, .25, .5, .75, 1).
  const stop = (v) => Math.round(v * 4) / 4;
  function feelOf(t) {
    const n = normalizeTheme(t);
    return { mood: stop((TRAITS[n.palette].mood + TRAITS[n.look].mood) / 2), crisp: stop((TRAITS[n.palette].crisp + TRAITS[n.look].crisp) / 2) };
  }
  // The best pair for a slider position: close to the target, and a good pair. Light / dark stays as it is.
  function fromFeel(mood, crisp, current) {
    const cur = normalizeTheme(current);
    let best = null;
    for (const p of PALETTES) for (const l of LOOKS) {
      const m = (TRAITS[p.id].mood + TRAITS[l.id].mood) / 2, c = (TRAITS[p.id].crisp + TRAITS[l.id].crisp) / 2;
      const score = -Math.hypot(m - mood, c - crisp) * 3 + pairScore(p.id, l.id) * 0.35;
      if (!best || score > best.score) best = { score, palette: p.id, look: l.id };
    }
    return { ...cur, palette: best.palette, look: best.look };
  }
  // Shuffle: a weighted pick over every allowed pair (good pairs much more likely), never the one you have.
  // locks: { palette, look, mode } true = keep that part.
  function shuffle(current, locks = {}, rnd = Math.random) {
    const cur = normalizeTheme(current);
    const pairs = [];
    for (const p of PALETTES) for (const l of LOOKS) {
      if (locks.palette && p.id !== cur.palette) continue;
      if (locks.look && l.id !== cur.look) continue;
      if (p.id === cur.palette && l.id === cur.look) continue;
      pairs.push({ palette: p.id, look: l.id, w: Math.max(0.05, pairScore(p.id, l.id)) ** 3 });
    }
    let mode = cur.mode;
    if (!locks.mode) {
      const r = rnd();
      mode = r < 0.55 ? 'windows' : r < 0.85 ? 'palette' : r < 0.93 ? 'dark' : 'light';
    }
    if (!pairs.length) return { ...cur, mode }; // both parts locked: only light / dark can change
    let x = rnd() * pairs.reduce((sum, q) => sum + q.w, 0);
    for (const q of pairs) { x -= q.w; if (x <= 0) return { palette: q.palette, look: q.look, mode }; }
    const last = pairs[pairs.length - 1];
    return { palette: last.palette, look: last.look, mode };
  }

  const api = { PALETTES, LOOKS, MODES, PRESETS, DEFAULT, TRAITS, normalizeTheme, resolveMode, presetOf, pairScore, feelOf, fromFeel, shuffle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlockletThemes = api;
})(typeof window !== 'undefined' ? window : this);
