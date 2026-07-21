// The Collection card grouping - pure over its inputs so it is node-testable. (A
// pure test would have caught the "Uncategorised" filter bug where the pseudo-set
// reached the catalog pool query and emptied it.)
//
// It groups the pool's printings by set, applies the ownership lens/chips, and
// recovers the set-less '' owned rows into an "Uncategorised" group.
//
// CALLER CONTRACT for the "Uncategorised" set filter:
//   - `sets` may include the pseudo-value UNCATEGORISED_LABEL. Import it - do NOT spell it
//     as a literal, or a wording change breaks filtering silently. No printed set is named
//     that, so here it ONLY gates the '' recovery.
//   - The caller must NOT pass it to the catalog pool query (getPool filters
//     by printed set name, so it would return an empty pool).
//   - Whenever it is selected, the caller must provide a pool that is NOT
//     narrowed by set (other filters are fine), so the set-less owned cards - which can
//     belong to any printed set - are present in the pool to be recovered here.
import { ownershipOf } from './ownership.js';
import { UNCATEGORISED, UNCATEGORISED_LABEL, isUncategorised } from './printings.js';

export function groupCollection({
  pool, owBySet, wishSet, sets = [], viewMode = 'all',
  ownScope = [], ownActive = false, setLabel = {}, setRank = () => 0,
}) {
  const g = new Map();   // code -> { code, name, rows:[{card,set,owned,foil}] }
  const push = (code, name, row) => {
    let x = g.get(code);
    if (!x) { x = { code, name: name || setLabel[code] || code, rows: [] }; g.set(code, x); }
    x.rows.push(row);
  };

  // ONE ownership test, applied identically to printed rows and to the Uncategorised pile.
  // They used to diverge - printed rows counted non-foil, Uncategorised counted foil too - so
  // {owned:0, foil:1} was "not owned" in a set and "owned" under Uncategorised. See ownership.js.
  const chip = (state, isWish) => ownScope.includes(state)
    || (ownScope.includes('wishlist') && isWish);
  const matches = (state, isWish) => {
    // viewMode is a legacy lens kept for callers that want a fixed slice; the live surface
    // passes 'all' and drives everything through the multi-select chips.
    if (viewMode === 'owned') return state === 'regular';
    if (viewMode === 'unowned') return state !== 'regular';
    return ownActive ? chip(state, isWish) : true;
  };

  for (const c of (pool || [])) {
    const isWish = wishSet.has(c.card_id);
    for (const s of (c._sets || [])) {
      if (!s.code) continue;
      // Per-printing set filter (a real set name; 'Uncategorised' never matches a printing).
      if (sets.length && !sets.includes(s.name)) continue;
      const oc = owBySet.get(c.card_id + '|' + s.code);
      const owned = oc?.owned || 0, foil = oc?.foil || 0;
      if (!matches(ownershipOf(owned, foil), isWish)) continue;
      push(s.code, s.name, { card: c, set: s.code, owned, foil });
    }
  }

  // Set-less ('' ) owned rows recovered into an "Uncategorised" group. The SET gate is the only
  // special case left: they belong to no printed set, so they appear under no set filter or
  // under the explicit "Uncategorised" chip. Their OWNERSHIP is judged by the same `matches`
  // as everything else, so a foil-only Uncategorised row is foilOnly here too.
  if (sets.length === 0 || sets.includes(UNCATEGORISED_LABEL)) {
    const byId = new Map((pool || []).map((c) => [c.card_id, c]));
    for (const [k, v] of owBySet) {
      const i = k.lastIndexOf('|');
      if (!isUncategorised(k.slice(i + 1))) continue;                // only the uncategorised bucket
      const owned = v.owned || 0, foil = v.foil || 0;
      if (owned + foil === 0) continue;                             // no row to recover
      const card = byId.get(k.slice(0, i));
      if (!card) continue;
      if (!matches(ownershipOf(owned, foil), wishSet.has(card.card_id))) continue;
      push(UNCATEGORISED, UNCATEGORISED_LABEL, { card, set: UNCATEGORISED, owned, foil });
    }
  }
  return [...g.values()].sort((a, b) => setRank(a.code) - setRank(b.code));
}

// The set list to pass to the catalog pool query: strip the uncategorised pseudo-set,
// and when it is selected drop set narrowing entirely (other filters still apply) so the
// set-less owned cards are present in the pool for groupCollection to recover.
export function poolSetFilter(sets = []) {
  return sets.includes(UNCATEGORISED_LABEL) ? [] : sets;
}
