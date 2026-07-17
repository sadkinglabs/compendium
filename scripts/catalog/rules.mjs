// Rules importer: the Codex CSV (title,content,subcodexes) -> the
// articles_normalized.json shape { id, title, content, subentries:[{id,label,content}] }.
//
// Row model (verified against the real export):
//   - a row with a NON-EMPTY title is an ARTICLE, in file order; its content is
//     column 2; it opens a new "current article".
//   - a row with a BLANK title carries exactly one SUB-ENTRY of the current article
//     in its `subcodexes` cell, as "Label:  content" (split on the FIRST colon;
//     label before, content after, both trimmed). It is appended to the current
//     article's subentries.
//
// Ids are REUSED from the current committed articles so existing marginalia / saved
// / link targets never break: an existing title (or an existing parent+label)
// reuses its exact id; only a genuinely new article/label gets a fresh slug. A
// current id the CSV no longer produces is REPORTED (never silently dropped),
// because a note may target it.
import { parseCsvWithHeader } from './csv.mjs';
import { articleSlug, subSlug } from './slug.mjs';

export const CODEX_HEADER = ['title', 'content', 'subcodexes'];

/** Build the reuse maps from the current committed articles array. */
export function buildIdReuse(currentArticles) {
  const titleToId = new Map();          // exact article title -> id
  const subToId = new Map();            // `${parentId}\u0000${label}` -> subentry id
  const knownArticleIds = new Set();
  const knownSubIds = new Set();
  for (const a of currentArticles || []) {
    titleToId.set(a.title, a.id);
    knownArticleIds.add(a.id);
    for (const s of a.subentries || []) {
      subToId.set(`${a.id}\u0000${s.label}`, s.id);
      knownSubIds.add(s.id);
    }
  }
  return { titleToId, subToId, knownArticleIds, knownSubIds };
}

/**
 * Compile the Codex CSV text into the articles_normalized shape.
 * @returns { articles, report } where report lists new/removed ids and any issues.
 */
export function compileRules(csvText, currentArticles = []) {
  const { rows } = parseCsvWithHeader(csvText, CODEX_HEADER, 'rules CSV');
  const reuse = buildIdReuse(currentArticles);
  const articles = [];
  let current = null;
  const newArticles = [];
  const newSubs = [];
  const seenIds = new Set();
  const issues = [];

  rows.forEach((row, i) => {
    const line = i + 2; // 1-based, +1 for the header
    const title = (row[0] ?? '').trim();
    const content = (row[1] ?? '').trim();
    const sub = (row[2] ?? '').trim();

    if (title) {
      const id = reuse.titleToId.get(title) ?? articleSlug(title);
      if (!reuse.titleToId.has(title)) newArticles.push(title);
      if (seenIds.has(id)) issues.push(`rules CSV line ${line}: duplicate article id "${id}" (title ${JSON.stringify(title)})`);
      seenIds.add(id);
      current = { id, title, content, subentries: [] };
      articles.push(current);
      return;
    }

    // blank-title row: a sub-entry of the current article
    if (!sub) return; // fully blank row: skip
    if (!current) { issues.push(`rules CSV line ${line}: sub-entry with no preceding article: ${JSON.stringify(sub.slice(0, 60))}`); return; }
    const colon = sub.indexOf(':');
    if (colon < 0) { issues.push(`rules CSV line ${line}: sub-entry has no "Label: content" colon`); return; }
    const label = sub.slice(0, colon).trim();
    const body = sub.slice(colon + 1).trim();
    const id = reuse.subToId.get(`${current.id}\u0000${label}`) ?? subSlug(current.id, label);
    if (!reuse.subToId.has(`${current.id}\u0000${label}`)) newSubs.push(`${current.title} / ${label}`);
    if (seenIds.has(id)) issues.push(`rules CSV line ${line}: duplicate sub-entry id "${id}"`);
    seenIds.add(id);
    current.subentries.push({ id, label, content: body });
  });

  // Removed: a current id the CSV no longer produces (marginalia may target it).
  const removedArticles = [...reuse.knownArticleIds].filter((id) => !seenIds.has(id));
  const removedSubs = [...reuse.knownSubIds].filter((id) => !seenIds.has(id));

  const subentryCount = articles.reduce((n, a) => n + a.subentries.length, 0);
  return {
    articles,
    report: {
      articles: articles.length,
      subentries: subentryCount,
      newArticles,
      newSubs,
      removedArticles,
      removedSubs,
      issues,
    },
  };
}
