// core/lint.js
// Non-fatal authoring checks for v2c packs + topTags summary.

export function lint(v2c) {
  // --- Safe inputs ---
  const ids     = Array.isArray(v2c?.ids)  ? v2c.ids  : [];
  const idx     = Array.isArray(v2c?.idx)  ? v2c.idx  : [];
  const html    = Array.isArray(v2c?.html) ? v2c.html : [];
  const tagsArr = Array.isArray(v2c?.tags) ? v2c.tags : [];

  // --- Build adjacency with bounds checks ---
  const adj = new Map(ids.map(id => [id, []]));
  for (let i = 0; i < ids.length; i++) {
    const fromId = ids[i];
    const edges = Array.isArray(idx[i]) ? idx[i] : [];
    for (const j of edges) {
      if (Number.isInteger(j) && j >= 0 && j < ids.length) {
        adj.get(fromId).push(ids[j]);
      }
    }
  }

  // --- Reachability from start ---
  const seen = new Set();
  if (typeof v2c?.start === "string" && adj.has(v2c.start)) {
    const q = [v2c.start];
    seen.add(v2c.start);
    while (q.length) {
      const cur = q.shift();
      for (const n of (adj.get(cur) || [])) {
        if (!seen.has(n)) { seen.add(n); q.push(n); }
      }
    }
  }
  const unreachable = ids.filter(id => !seen.has(id));

  // --- Dangling idx references (defensive) ---
  const dangling = [];
  for (let i = 0; i < ids.length; i++) {
    const arr = Array.isArray(idx[i]) ? idx[i] : [];
    for (const j of arr) {
      if (!Number.isInteger(j) || j < 0 || j >= ids.length) {
        dangling.push([ids[i], `#${j}`]);
      }
    }
  }

  // --- Empty passages ---
  const empty = [];
  for (let i = 0; i < html.length; i++) {
    const s = (typeof html[i] === "string" ? html[i] : "").trim();
    if (s.length === 0) empty.push(ids[i]);
  }

  // --- Duplicate tags per passage + tag frequency (case-insensitive) ---
  const duplicateTagPairs = [];
  const tagFreq = new Map(); // tag -> count of nodes that have it
  for (let i = 0; i < ids.length; i++) {
    const arr = Array.isArray(tagsArr[i]) ? tagsArr[i] : [];
    const local = new Set();
    for (const tRaw of arr) {
      const t = String(tRaw || "").trim().toLowerCase();
      if (!t) continue;
      if (local.has(t)) duplicateTagPairs.push([ids[i], t]);
      else local.add(t);
    }
    for (const t of local) tagFreq.set(t, (tagFreq.get(t) || 0) + 1);
  }

  const topTags = Array.from(tagFreq, ([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    counts: {
      unreachable: unreachable.length,
      dangling: dangling.length,
      empty: empty.length,
      duplicateTagPairs: duplicateTagPairs.length,
      uniqueTags: tagFreq.size
    },
    examples: {
      unreachable: unreachable.slice(0, 10),
      dangling: dangling.slice(0, 10),
      empty: empty.slice(0, 10),
      duplicateTagPairs: duplicateTagPairs.slice(0, 10)
    },
    topTags
  };
}




