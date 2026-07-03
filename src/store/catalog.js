// Catalog seeding - loads the shared, read-only reference data (cards, rules,
// FAQs, link graph) from Lexicum's dataset into the catalog tables on first run.
// Idempotent: keyed by CATALOG_VERSION in catalog_meta; re-seed clears + reloads.
import { query, exec, persist } from './db.js';

// SQL literal escaping for the bulk-insert fast path.
const esc = (v) => v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? String(v)
  : "'" + String(v).replace(/'/g, "''") + "'";

// Build INSERT statement strings (multi-row, chunked) - accumulated and run as
// ONE transactional execute, so the whole seed is a single bridge round-trip.
function insertSql(table, cols, rows, toRow, chunk = 500) {
  const out = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const tuples = rows.slice(i, i + chunk).map((r) => '(' + toRow(r).map(esc).join(',') + ')').join(',');
    if (tuples) out.push(`INSERT INTO ${table}(${cols}) VALUES ${tuples};`);
  }
  return out;
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

/** Seed once. Returns { seeded, counts }. */
export async function seedCatalogIfNeeded() {
  const cur = (await query("SELECT value FROM catalog_meta WHERE key='version';"))[0]?.value;
  if (cur === String(CATALOG_VERSION)) {
    return { seeded: false, counts: await getCatalogCounts() };
  }

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

  // Whole seed as ONE transactional script - a single bridge round-trip.
  const sql = [
    'DELETE FROM cards;', 'DELETE FROM rules;', 'DELETE FROM faqs;', 'DELETE FROM link_graph;',
    ...insertSql('cards',
      'card_id,name,type,sub_types,rarity,elements,cost,attack,defence,life,thresholds,rules_text,is_avatar,is_site,sets,variants,image_slug,system',
      Object.values(cardsObj), (c) => [
        cardSlug(c.name), c.name, c.type ?? null,
        JSON.stringify(c.subTypes ?? []), c.rarity ?? null, JSON.stringify(c.elements ?? []),
        c.cost ?? null, c.attack ?? null, c.defence ?? null, c.life ?? null,
        JSON.stringify(c.thresholds ?? {}), c.rulesText ?? '',
        c.isAvatar ? 1 : 0, c.isSite ? 1 : 0,
        JSON.stringify(c.sets ?? []), JSON.stringify(c.variants ?? []), c.image ?? null, 'sorcery',
      ]),
    ...insertSql('rules', 'rule_id,parent_id,title,content,system', ruleRows, (r) => r),
    ...insertSql('faqs', 'faq_id,question,answer,card_ids,source', faqs,
      (f) => [f.id, f.question, f.answer, JSON.stringify(f.cards ?? []), f.source ?? null]),
    ...insertSql('link_graph', 'source_id,source_type,target_id,target_type', links,
      (l) => [l.source, 'rule', l.target, l.target_type]),
    `INSERT OR REPLACE INTO catalog_meta(key,value) VALUES('version','${CATALOG_VERSION}');`,
  ].join('\n');

  await exec(sql);
  await persist();

  return { seeded: true, counts: await getCatalogCounts() };
}
