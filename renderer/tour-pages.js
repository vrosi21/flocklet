// Which tour pages to show. Pure, shared by the main process (should the tour open?) and the tour window.
// To add a page for a new feature: add an entry here with `since` = the version that ships it, and a renderer
// for its id in tour.js. New users see every page; people who update see only pages newer than what they saw.
(function (root) {
  const PAGES = [
    { id: 'hello', since: '0.4.0', title: 'Hi, I am Flocklet' },
    { id: 'flock', since: '0.4.0', title: 'Your flock' },
    { id: 'answer', since: '0.4.0', title: 'Answer from here' },
    { id: 'style', since: '0.4.0', title: 'Pick a style' },
    { id: 'pets', since: '0.4.0', title: 'Pets' },
    { id: 'views', since: '0.4.0', title: 'Three ways to see it' },
    { id: 'loop', since: '0.4.0', title: 'Stay in the loop' },
  ];

  // "0.4.10" > "0.4.9". Missing parts count as 0; anything unparsable counts as 0.0.0.
  function compareVersions(a, b) {
    const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
    return 0;
  }

  // seen: the version whose tour you last finished (null = never). Returns { mode, pages }:
  // 'tour' = everything (first run, or opened by hand), 'whatsnew' = only newer pages, 'none' = nothing to show.
  function pagesFor({ seen = null, current, forceTour = false, pages = PAGES } = {}) {
    if (forceTour || !seen) {
      const all = pages.filter((p) => compareVersions(p.since, current) <= 0);
      return all.length ? { mode: 'tour', pages: all } : { mode: 'none', pages: [] }; // nothing shipped yet: no empty window
    }
    const fresh = pages.filter((p) => compareVersions(p.since, seen) > 0 && compareVersions(p.since, current) <= 0);
    return fresh.length ? { mode: 'whatsnew', pages: fresh } : { mode: 'none', pages: [] };
  }

  const api = { PAGES, compareVersions, pagesFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlockletTour = api;
})(typeof window !== 'undefined' ? window : this);
