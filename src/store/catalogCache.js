// In-memory catalog cache. The `cards` table is seeded once (keyed by
// CATALOG_VERSION) and NEVER changes at runtime, yet the rich Refine engine
// (getPool), Codex search, and the Set/Artist filter lists used to re-`SELECT`
// the whole catalog and re-`JSON.parse` its wide JSON columns (thresholds /
// elements / sets / variants) on every debounced keystroke - thousands of
// parses per stroke across the SQLite/WASM boundary, all of it redundant.
//
// getCatalog() reads + parses the catalog exactly ONCE per session and hands
// back the shared array. Each row keeps its raw string columns intact (so
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
// Callers MUST treat the returned rows as read-only (they are shared); every
// current consumer already does. Invalidated only on re-seed.
import { query } from './db.js';

let _cache = null;

const jp = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

/** The full immutable card catalog, parsed once and cached for the session. */
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
  }
  _cache = rows;
  return _cache;
}

/** Drop the cache so the next getCatalog() re-reads the DB (call after re-seed). */
export function invalidateCatalog() { _cache = null; }
