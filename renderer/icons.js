// Line icons (16x16, stroked by CSS). Shared by the panel (app.js) and the tour, so its pictures match the app.
// Constant markup only: the renderers put these in with innerHTML.
(function (root) {
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
    home: '<svg viewBox="0 0 16 16"><path d="M2.5 7.5 8 3l5.5 4.5M4 6.5V13h8V6.5" /></svg>',
    plus: '<svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></svg>',
    dockin: '<svg viewBox="0 0 16 16"><path d="M7 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9M13.5 2.5 8.5 7.5M8.5 3.8v3.7h3.7" /></svg>',
    back: '<svg viewBox="0 0 16 16"><path d="M9.5 4 5.5 8l4 4" /></svg>',
    popout: '<svg viewBox="0 0 16 16"><path d="M9 2.5h4.5V7M13.5 2.5 8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" /></svg>',
    layers: '<svg viewBox="0 0 16 16"><path d="M8 2.5 14 5.5 8 8.5 2 5.5z" /><path d="M2 8.5l6 3 6-3" /><path d="M2 11.2l6 3 6-3" /></svg>',
    brush: '<svg viewBox="0 0 16 16"><path d="M13.5 2.5 7.8 8.2M9.3 9.7 6.3 6.7M6.3 9.7c-1.6-.3-3 .7-3 2.3 0 .6-.3 1-.8 1.3 1.7.7 4.3.3 4.8-1.7" /></svg>',
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ICONS;
  else root.FlockletIcons = ICONS;
})(typeof window !== 'undefined' ? window : this);
