// Link-graph regenerator: the card <-> article reference edges consumed by Codex
// "Mentioned in" / "Cards mentioned" and the `examples` filter.
//
// Derivation (reverse-engineered and proven byte-identical against the committed
// public/catalog/link_graph.json - see linkGraph.test.mjs):
//   - Sources are emitted in article file order: each article, then its
//     sub-entries, each source drawing edges from its OWN text (article.content or
//     subentry.content).
//   - Per source, a CARDS pass then a RULES pass:
//       cards: /\[\[([^\]]*)\]\]/g   -> target_type 'card', target = the name
//       rules: /\(\(([^)]*)\)\)/g    -> resolved below
//     The rules regex is `[^)]*` (any char except a close paren) ON PURPOSE: it is
//     what the original generator used, and it is why a malformed `))X((` typo that
//     runs into a later single ')' is dropped instead of capturing a runaway blob.
//   - Every captured string is whitespace-normalised (runs -> one space, trimmed).
//   - A rule ref resolves, case-insensitively, against sub-entry LABELS first, then
//     article TITLES: a hit becomes a 'subentry'/'article' edge carrying
//     `target_title` (the ref text); a miss becomes an 'unresolved_article' edge.
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

function resolvers(articles) {
  const labelToSub = new Map();  // lower(label) -> subentry id
  const titleToArt = new Map();  // lower(title) -> article id
  for (const a of articles) {
    titleToArt.set(norm(a.title).toLowerCase(), a.id);
    for (const s of a.subentries || []) labelToSub.set(norm(s.label).toLowerCase(), s.id);
  }
  return { labelToSub, titleToArt };
}

function edgesFrom(sourceId, text, { labelToSub, titleToArt }) {
  const out = [];
  let m;
  const cardRe = /\[\[([^\]]*)\]\]/g;
  while ((m = cardRe.exec(text || ''))) out.push({ source: sourceId, target_type: 'card', target: norm(m[1]) });
  const ruleRe = /\(\(([^)]*)\)\)/g;
  while ((m = ruleRe.exec(text || ''))) {
    const ref = norm(m[1]);
    const key = ref.toLowerCase();
    if (labelToSub.has(key)) out.push({ source: sourceId, target_type: 'subentry', target: labelToSub.get(key), target_title: ref });
    else if (titleToArt.has(key)) out.push({ source: sourceId, target_type: 'article', target: titleToArt.get(key), target_title: ref });
    else out.push({ source: sourceId, target_type: 'unresolved_article', target: ref });
  }
  return out;
}

/** Regenerate the full link_graph edge array from an articles_normalized array. */
export function regenerateLinkGraph(articles) {
  const res = resolvers(articles);
  const edges = [];
  for (const a of articles) {
    edges.push(...edgesFrom(a.id, a.content, res));
    for (const s of a.subentries || []) edges.push(...edgesFrom(s.id, s.content, res));
  }
  return edges;
}

/**
 * The hard Increment-1 gate: regenerating from the CURRENT committed articles must
 * byte-reproduce the CURRENT committed link_graph. If it does not, the extractor
 * does not model the committed artifact and the run STOPS for a separately-reviewed
 * curated-baseline decision (never a report note). Compares canonical JSON so
 * incidental file whitespace is not the subject of the test.
 */
export function assertReproducesCommitted(currentArticles, committedLinkGraph) {
  const regen = regenerateLinkGraph(currentArticles);
  const a = JSON.stringify(regen);
  const b = JSON.stringify(committedLinkGraph);
  if (a !== b) {
    let firstDiff = -1;
    for (let i = 0; i < Math.max(regen.length, committedLinkGraph.length); i++) {
      if (JSON.stringify(regen[i]) !== JSON.stringify(committedLinkGraph[i])) { firstDiff = i; break; }
    }
    const err = new Error(
      `link-graph byte-reproduction FAILED: the extractor does not reproduce the committed link_graph.json ` +
      `(regen ${regen.length} edges vs committed ${committedLinkGraph.length}, first diff at ${firstDiff}). ` +
      `STOP: this requires a separately-reviewed curated-baseline design, not a report note.`);
    err.firstDiff = firstDiff;
    err.regen = regen[firstDiff];
    err.committed = committedLinkGraph[firstDiff];
    throw err;
  }
  return regen.length;
}
