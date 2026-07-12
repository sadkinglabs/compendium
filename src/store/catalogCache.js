// In-memory catalog cache. The `cards` table is seeded from the app's own
// bundled data (public/catalog/*.json) and is IMMUTABLE at runtime. It changes
// only across app versions: when a new Sorcery set ships, the app is updated
// with new bundled JSON and a bumped CATALOG_VERSION, and seedCatalogIfNeeded()
// re-seeds at boot (see catalog.js). There are no runtime writes to `cards` -
// no downloadable packs, no live server patches, no user-editable cards.
//
// Before this cache, the rich Refine engine (getPool), Codex search, and the
// Set/Artist filter lists re-`SELECT`ed the whole catalog and re-`JSON.parse`d
// its wide JSON columns (thresholds / elements / sets / variants) on every
// debounced keystroke - thousands of parses per stroke across the SQLite/WASM
// boundary, all redundant. getCatalog() reads + parses the catalog exactly ONCE
// per session and hands back the shared, frozen array. Each row keeps its raw
// string columns (so JSON-parsing consumers like thresholdRuns/elementPips/
// cardMatchesQuery keep working unchanged) PLUS pre-parsed helper fields
// (prefixed `_`) that the hot filter/sort paths read directly:
//   _th        parsed thresholds object   { air, earth, fire, water }
//   _els       parsed elements array (raw, incl. 'none')
//   _elsF      elements with 'none' stripped, for multi-element / element sort
//   _el0       first real element, lowercased ('zzz' if none) - element sort key
//   _sets      parsed sets array   [{ name, ... }]
//   _variants  parsed variants array [{ artist, ... }]
//   _totalTh   air+earth+fire+water threshold total
//   _nameLc    name.toLowerCase()      - name search + name sort key
//   _rulesLc   rules_text.toLowerCase() - Codex full-text search
//   id         alias of card_id (Codex reads `id`, the deckbuilder reads card_id)
//
// Rows are Object.frozen: returned rows are SHARED across all callers, so they
// must be read-only (consumers that need to tag a row - hasNote/saved - map to a
// fresh object first; every current one already does). This guards the whole
// point of the cache: handing back shared objects instead of re-parsing.
//
// Invalidation: a version-bump re-seed happens at boot BEFORE any getCatalog()
// call (the cache is still cold, module state is fresh on process start), so the
// first read naturally builds from the new rows. invalidateCatalog() is called
// by the re-seed anyway as a belt-and-braces reset in case a re-seed ever runs
// after the cache warmed (e.g. a future in-app "reset data" action).
import { query } from './db.js';

let _cache = null;
let _faqs = null;

const jp = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

/** The full immutable card catalog, parsed once and cached for the session.
 *  Rebuilt on the first call after invalidateCatalog(). */
export async function getCatalog() {
  if (_cache) return _cache;
  const rows = await query(
    'SELECT card_id, name, type, sub_types, rarity, elements, cost, attack, defence, life, thresholds, rules_text, is_avatar, is_site, sets, variants, image_slug FROM cards;'
  );
  for (const c of rows) {
    c.id = c.card_id;
    c._th = jp(c.thresholds, {});
    c._els = jp(c.elements, []);
    c._elsF = c._els.filter((x) => x && x.toLowerCase() !== 'none');
    c._el0 = (c._elsF[0] || 'zzz').toLowerCase();
    c._sets = jp(c.sets, []);
    c._variants = jp(c.variants, []);
    c._totalTh = (c._th.air || 0) + (c._th.earth || 0) + (c._th.fire || 0) + (c._th.water || 0);
    c._nameLc = c.name.toLowerCase();
    c._rulesLc = (c.rules_text || '').toLowerCase();
    Object.freeze(c);   // enforce read-only: the rows are shared
  }
  _cache = rows;
  return _cache;
}

/** FAQs are immutable catalog data too. faqCardSet() (search) and faqsForCard()
 *  (card detail) both scanned the faqs table (a LIKE '%"id"%' substring scan for
 *  the latter) on every call. Parse the table once; the consumers filter the
 *  cached, pre-parsed rows in JS. Ordered by rowid so faqsForCard keeps its
 *  original ordering. */
export async function getFaqs() {
  if (_faqs) return _faqs;
  const rows = await query('SELECT faq_id, question, answer, card_ids FROM faqs ORDER BY rowid;');
  for (const f of rows) f._cards = jp(f.card_ids, []);
  _faqs = rows;
  return _faqs;
}

/** Drop the caches so the next getCatalog()/getFaqs() re-reads the DB. Called by
 *  the re-seed path (catalog.js) when CATALOG_VERSION changes. */
export function invalidateCatalog() { _cache = null; _faqs = null; }
