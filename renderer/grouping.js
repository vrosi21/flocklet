// How cards are arranged: pins, hierarchy (parent -> children), folders, custom groups, search.
// Pure functions shared by the main process (pins), the overlay (layout) and the tests:
// loaded with <script> in the overlay (window.AgentDeckGrouping) and require() in Node.
(function (root) {
  const MODES = ['folder', 'tree', 'custom', 'none'];
  const MAX_DEPTH = 4;

  // A worktree session (<project>/.claude/worktrees/<name>) belongs to its project, like in Claude's sidebar.
  const projectRoot = (cwd) => (cwd || '').replace(/[\\/]+$/, '').replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/i, '');
  const folderKey = (cwd) => projectRoot(cwd).toLowerCase();
  const folderName = (cwd) => projectRoot(cwd).split(/[\\/]/).filter(Boolean).pop() || 'No folder';

  // Apply the user's pins and group assignments. Pinned sessions always stay on the deck.
  function decorate(cards, { pins = [], groupOf = {} } = {}) {
    const pinned = new Set(pins);
    return cards.map((c) => {
      const isPinned = pinned.has(c.key);
      return { ...c, pinned: isPinned, groupId: groupOf[c.key] || null, group: isPinned ? 'active' : c.group };
    });
  }

  function count(cards) {
    const counts = { working: 0, waiting: 0, done: 0, idle: 0, pinned: 0 };
    for (const c of cards) {
      if (c.pinned) counts.pinned += 1;
      if (c.group !== 'active') counts.idle += 1;
      else if (c.state === 'waiting') counts.waiting += 1;
      else if (c.state === 'working') counts.working += 1;
      else if (c.state === 'done' || c.state === 'error') counts.done += 1;
    }
    return counts;
  }

  // Every session in the Sessions list by state, most urgent first (for the minimised bar).
  const STATE_ORDER = ['waiting', 'error', 'working', 'done', 'idle'];
  function stateCounts(cards) {
    const out = Object.fromEntries(STATE_ORDER.map((k) => [k, 0]));
    for (const c of cards) out[STATE_ORDER.includes(c.state) ? c.state : 'idle'] += 1;
    return out;
  }

  function search(cards, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.cwd || '').toLowerCase().includes(q));
  }

  // Parent/child forest. `cards` are shown as real rows; ancestors that are not in `cards` but exist
  // in `all` are shown as "ghost" rows so children still sit under the right parent.
  // Subtrees are ordered by their most urgent card (cards arrive sorted: waiting first, then recent).
  function forest(cards, all) {
    const byHost = new Map();
    for (const c of all) if (c.hostId) byHost.set(c.hostId, c);
    const order = new Map(all.map((c, i) => [c.key, i]));
    cards.forEach((c, i) => { if (!order.has(c.key)) order.set(c.key, all.length + i); });
    const real = new Set(cards.map((c) => c.key));
    const nodes = new Map();
    const node = (c) => {
      let n = nodes.get(c.key);
      if (!n) { n = { card: c, ghost: !real.has(c.key), children: [], hasParent: false }; nodes.set(c.key, n); }
      return n;
    };
    for (const c of cards) {
      let child = node(c);
      let cur = c;
      for (let guard = 0; guard < 10 && cur.parentHostId && byHost.has(cur.parentHostId); guard++) {
        const parentCard = byHost.get(cur.parentHostId);
        if (parentCard.key === c.key) break; // cycle
        const parent = node(parentCard);
        if (!parent.children.includes(child)) parent.children.push(child);
        child.hasParent = true;
        child = parent;
        cur = parentCard;
      }
    }
    const score = (n) => {
      let s = n.ghost ? Infinity : order.get(n.card.key);
      for (const ch of n.children) s = Math.min(s, score(ch));
      n.score = s;
      return s;
    };
    const roots = [...nodes.values()].filter((n) => !n.hasParent);
    roots.forEach(score);
    const out = [];
    const walk = (n, depth) => {
      out.push({ type: n.ghost ? 'ghost' : 'card', card: n.card, depth: Math.min(depth, MAX_DEPTH) });
      n.children.sort((a, b) => a.score - b.score).forEach((ch) => walk(ch, depth + 1));
    };
    roots.sort((a, b) => a.score - b.score).forEach((r) => walk(r, 0));
    return out;
  }

  function sections(cards, keyOf, labelOf, orderOf, extra = []) {
    const map = new Map();
    for (const s of extra) map.set(s.key, { ...s, first: Infinity, cards: [] });
    cards.forEach((c, i) => {
      const k = keyOf(c);
      if (!map.has(k)) map.set(k, { key: k, label: labelOf(k, c), first: i, cards: [] });
      const s = map.get(k);
      s.first = Math.min(s.first, i);
      s.cards.push(c);
    });
    const list = [...map.values()].sort((a, b) => (orderOf(a.key) - orderOf(b.key)) || (a.first - b.first));
    return list.flatMap((s) => [
      { type: 'header', key: s.key, label: s.label, count: s.cards.length, color: s.color || null },
      ...s.cards.map((card) => ({ type: 'card', card, depth: 0 })),
    ]);
  }

  // Project folders, each with its parent/child tree. A whole tree goes into the folder of its top
  // parent, so a child never leaves its parent. Folders and trees keep the urgency order of the forest.
  function folderForest(cards, all) {
    const map = new Map();
    let cur = null;
    for (const it of forest(cards, all)) {
      if (it.depth === 0) {
        const k = folderKey(it.card.cwd);
        if (!map.has(k)) map.set(k, { key: k, label: folderName(it.card.cwd), count: 0, items: [] });
        cur = map.get(k);
      }
      cur.items.push(it);
      if (it.type === 'card') cur.count += 1;
    }
    return [...map.values()].flatMap((s) => [
      { type: 'header', key: s.key, label: s.label, count: s.count, color: null }, ...s.items]);
  }

  // Returns render items: {type:'header', key, label, count, color} | {type:'card'|'ghost', card, depth}
  function arrange(cards, mode, { all = cards, groups = [], showEmptyGroups = false } = {}) {
    if (mode === 'tree') return forest(cards, all);
    if (mode === 'folder') return folderForest(cards, all);
    if (mode === 'custom') {
      const idx = new Map(groups.map((g, i) => [g.id, i]));
      const byId = new Map(groups.map((g) => [g.id, g]));
      const extra = showEmptyGroups ? groups.map((g) => ({ key: g.id, label: g.name, color: g.color })) : [];
      return sections(cards,
        (c) => (byId.has(c.groupId) ? c.groupId : ''),
        (k) => (byId.has(k) ? byId.get(k).name : 'Ungrouped'),
        (k) => (idx.has(k) ? idx.get(k) : 1e9),
        extra).map((it) => (it.type === 'header' && byId.has(it.key) ? { ...it, color: byId.get(it.key).color } : it));
    }
    return cards.map((card) => ({ type: 'card', card, depth: 0 }));
  }

  // Fold keys: 'h:<header key>' for a project/group header, 'p:<card key>' for a parent's children.
  const foldKeyOf = (it) => (it.type === 'header' ? `h:${it.key}` : `p:${it.card.key}`);

  // Collapse folded headers and parents. Sessions that need you stay visible even when folded.
  // Marks each foldable item with {foldable, folded, hidden, hiddenWaiting} for the fold arrow and badge.
  function fold(items, folded = []) {
    const set = new Set(folded);
    const out = [];
    let owner = null; // folded header or parent currently hiding items
    let ownerDepth = -1; // hide items deeper than this (header: -1 = everything until next header)
    items.forEach((it, i) => {
      const next = items[i + 1];
      if (owner && (it.type === 'header' || (owner.type !== 'header' && it.depth <= ownerDepth))) owner = null;
      const foldable = it.type === 'header' || (next && next.type !== 'header' && next.depth > it.depth);
      if (owner) {
        if (it.type === 'card') owner.hidden += 1;
        if (it.card && it.card.state === 'waiting') owner.hiddenWaiting += 1;
        if (!(it.type === 'card' && it.card.state === 'waiting')) return; // needs you: keep it visible
        out.push(it);
        return;
      }
      const row = foldable ? { ...it, foldable: true, folded: set.has(foldKeyOf(it)), hidden: 0, hiddenWaiting: 0 } : it;
      out.push(row);
      if (row.folded) { owner = row; ownerDepth = it.type === 'header' ? -1 : it.depth; }
    });
    return out;
  }

  const api = { MODES, decorate, count, search, arrange, forest, folderName, projectRoot, fold, foldKeyOf, stateCounts, STATE_ORDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgentDeckGrouping = api;
})(typeof window !== 'undefined' ? window : this);
