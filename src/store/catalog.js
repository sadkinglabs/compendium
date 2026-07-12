// Catalog seeding - loads the shared, read-only reference data (cards, rules,
// FAQs, link graph) from Lexicum's dataset into the catalog tables on first run.
// Idempotent: keyed by CATALOG_VERSION in catalog_meta; re-seed clears + reloads.
import { query, tx, persist } from './db.js';
import { invalidateCatalog } from './catalogCache.js';

// Native-safe bulk insert. Each row becomes ONE parameterized statement bound by
// '?' placeholders - never inline SQL literals. This is critical: sql.js (web)
// parses a full multi-statement inline script fine, but the native plugin's
// hand-rolled statement splitter cuts INSERTs at any ';' inside a string literal
// (rule prose is full of semicolons), which dumped raw SQL tuples into columns.
// Positional '?' binding is identical on both backends and immune to semicolons,
// quotes and comments in the data. The whole seed runs in one tx() so a mid-way
// failure rolls back rather than leaving a half-populated catalog.
function insertStmts(table, cols, rows, toRow) {
  const ncols = cols.split(',').length;
  const placeholders = '(' + Array(ncols).fill('?').join(',') + ')';
  const stmt = `INSERT INTO ${table}(${cols}) VALUES ${placeholders};`;
  return rows.map((r) => [stmt, toRow(r)]);
}

export const CATALOG_VERSION = 1;
const BASE = import.meta.env.BASE_URL; // './' -> resolves relative to the page

/** curiosa-style slug, so it matches faqs[].cards and gives a stable card_id. */
export function cardSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function fetchJson(file) {
  const res = await fetch(`${BASE}catalog/${file}`);
  if (!res.ok) throw new Error(`catalog: failed to load ${file} (${res.status})`);
  return res.json();
}

async function getCatalogCounts() {
  const one = async (t) => (await query(`SELECT COUNT(*) c FROM ${t};`))[0]?.c ?? 0;
  return {
    cards: await one('cards'),
    rules: await one('rules'),
    faqs: await one('faqs'),
    links: await one('link_graph'),
  };
}

/** Seed once. Returns { seeded, counts }. `onProgress(label)` (optional) is called
 *  only on the first-run / version-bump path so the splash can show what the
 *  one-time multi-second setup is doing instead of a frozen screen. */
export async function seedCatalogIfNeeded(onProgress) {
  const cur = (await query("SELECT value FROM catalog_meta WHERE key='version';"))[0]?.value;
  if (cur === String(CATALOG_VERSION)) {
    return { seeded: false, counts: await getCatalogCounts() };   // warm boot: fast, no progress
  }

  onProgress?.('Fetching the catalogue…');
  const [cardsObj, articles, faqs, links] = await Promise.all([
    fetchJson('cards.json'),
    fetchJson('articles_normalized.json'),
    fetchJson('faqs.json'),
    fetchJson('link_graph.json'),
  ]);

  const ruleRows = [];
  for (const art of articles) {
    ruleRows.push([art.id, null, art.title, art.content ?? '', 'sorcery']);
    for (const sub of art.subentries ?? []) ruleRows.push([sub.id, art.id, sub.label, sub.content ?? '', 'sorcery']);
  }

  // Whole seed as ONE atomic transaction of parameterized statements.
  const statements = [
    ['DELETE FROM cards;'], ['DELETE FROM rules;'], ['DELETE FROM faqs;'], ['DELETE FROM link_graph;'],
    ...insertStmts('cards',
      'card_id,name,type,sub_types,rarity,elements,cost,attack,defence,life,thresholds,rules_text,is_avatar,is_site,sets,variants,image_slug,system',
      Object.values(cardsObj), (c) => [
        cardSlug(c.name), c.name, c.type ?? null,
        JSON.stringify(c.subTypes ?? []), c.rarity ?? null, JSON.stringify(c.elements ?? []),
        c.cost ?? null, c.attack ?? null, c.defence ?? null, c.life ?? null,
        JSON.stringify(c.thresholds ?? {}), c.rulesText ?? '',
        c.isAvatar ? 1 : 0, c.isSite ? 1 : 0,
        JSON.stringify(c.sets ?? []), JSON.stringify(c.variants ?? []), c.image ?? null, 'sorcery',
      ]),
    ...insertStmts('rules', 'rule_id,parent_id,title,content,system', ruleRows, (r) => r),
    ...insertStmts('faqs', 'faq_id,question,answer,card_ids,source', faqs,
      (f) => [f.id, f.question, f.answer, JSON.stringify(f.cards ?? []), f.source ?? null]),
    ...insertStmts('link_graph', 'source_id,source_type,target_id,target_type', links,
      (l) => [l.source, 'rule', l.target, l.target_type]),
    ['INSERT OR REPLACE INTO catalog_meta(key,value) VALUES(?,?);', ['version', String(CATALOG_VERSION)]],
  ];

  onProgress?.('Setting up for offline use…');
  await tx(statements);
  await persist();
  invalidateCatalog();   // the parsed in-memory cache must not outlive a re-seed

  return { seeded: true, counts: await getCatalogCounts() };
}
