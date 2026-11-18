// Theme catalogue shared by the main process (validation, tray menu) and the overlay (picker).
// Colours live in theme.css; this file only knows ids, names, native modes and swatch colours.
(function (root) {
  const PALETTES = [
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

  // palette = the palette's own mode; windows = follow the Windows app theme.
  const MODES = [
    { id: 'palette', name: 'Auto' },
    { id: 'light', name: 'Light' },
    { id: 'dark', name: 'Dark' },
    { id: 'windows', name: 'Windows' },
  ];

  const DEFAULT = { palette: 'campfire', look: 'pocket', mode: 'palette' };
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

  const api = { PALETTES, LOOKS, MODES, DEFAULT, normalizeTheme, resolveMode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlockletThemes = api;
})(typeof window !== 'undefined' ? window : this);
