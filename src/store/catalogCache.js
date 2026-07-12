// In-memory catalog cache. The `cards` table is seeded once (keyed by
// CATALOG_VERSION) and today NEVER changes at runtime, yet the rich Refine
// engine (getPool), Codex search, and the Set/Artist filter lists used to
// re-`SELECT` the whole catalog and re-`JSON.parse` its wide JSON columns
// (thresholds / elements / sets / variants) on every debounced keystroke -
// thousands of parses per stroke across the SQLite/WASM boundary, all redundant.
//
// getCatalog() reads + parses the catalog exactly ONCE per session and hands
// back the shared, frozen array. Each row keeps its raw string columns (so
// JSON-parsing consumers like thresholdRuns/elementPips/cardMatchesQuery keep
// working unchanged) PLUS pre-parsed helper fields (prefixed `_`) that the hot
// filter/sort paths read directly:
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
// ─────────────────────────────  MUTATION CONTRACT  ─────────────────────────────
// The cache assumes the catalog is immutable for the life of the cache. When that
// stops being true (downloadable data packs, live server patches, user-editable
// cards), every write to the `cards` table MUST go through this contract:
//
//   1. Write to SQLite inside a tx() (the source of truth), then
//   2. call invalidateCatalog().
//
// invalidateCatalog() does TWO things, and both are required to prevent stale data:
//   (a) drops the parsed cache, so the NEXT getCatalog() re-reads + re-parses the
//       new rows (cache COHERENCE); and
//   (b) bumps catalogRev() and notifies subscribeCatalog() listeners, so screens
//       that already rendered a pool re-fetch (UI FRESHNESS). Dropping the cache
//       alone is not enough - a mounted list holds the rows from its last fetch
//       and will not re-query on its own.
//
// NEVER mutate a returned row in place to "edit a card" - the rows are shared and
// frozen (Object.freeze throws on write in strict mode). An edit is a DB write +
// invalidateCatalog(), never `row.cost = 5`. See the wiring notes at the bottom.
import { query } from './db.js';

let _cache = null;
let _rev = 0;
const _subs = new Set();

const jp = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

/** The full immutable card catalog, parsed once and cached for the session.
 *  Rebuilt automatically on the first call after invalidateCatalog(). */
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
    Object.freeze(c);   // enforce the read-only contract: edits go through the DB, not the row
  }
  _cache = rows;
  return _cache;
}

/** Monotonic catalog revision - bumped on every invalidation. Screens key their
 *  catalog reads to this (like `rev`/`collectionRev`) so an effect re-runs when
 *  the catalog changes. */
export function catalogRev() { return _rev; }

/** Subscribe to catalog changes (pack install / live update / card edit).
 *  Returns an unsubscribe fn. Mirrors ownedRepository's subscribeCollection. */
export function subscribeCatalog(cb) { _subs.add(cb); return () => _subs.delete(cb); }

/** Drop the parsed cache AND notify subscribers. Call after ANY write to the
 *  `cards` table (re-seed, pack install, live patch, card edit). Both halves are
 *  required: (a) the null'd cache forces a fresh parse on next getCatalog();
 *  (b) the bump/notify makes mounted views re-fetch instead of showing stale rows. */
export function invalidateCatalog() {
  _cache = null;
  _rev++;
  for (const cb of [..._subs]) { try { cb(_rev); } catch { /* a bad subscriber can't block the others */ } }
}
