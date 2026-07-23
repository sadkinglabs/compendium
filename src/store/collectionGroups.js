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
import { rowMatchesOwn, ownActive as ownIsActive } from './collectionFilter.js';
import { UNCATEGORISED_BUCKET, UNCATEGORISED_LABEL, isUncategorised, canonicalPrinting } from './printings.js';
import { printingFinishes } from './printingRows.js';

// `wishSet` holds WANTED collector-item keys `card_id|variant_slug` (card + set + finish), NOT bare
// card ids - a want is per printing (v11), so an Alpha want must not light up the Beta drill. Under a
// finish scope, only that finish's want counts; with no scope, either finish in the set counts.
const wishedIn = (wishSet, cardId, setCode, finishes) => {
  if (!setCode) return false;   // a want is never uncategorised (see the collector-item model)
  let std = false; let foil = false;
  try { std = wishSet.has(`${cardId}|${canonicalPrinting(setCode, false)}`); } catch { /* not a real set */ }
  try { foil = wishSet.has(`${cardId}|${canonicalPrinting(setCode, true)}`); } catch { /* not a real set */ }
  if (!finishes.length) return std || foil;
  return (finishes.includes('standard') && std) || (finishes.includes('foil') && foil);
};

// Catalog finish availability for a printing - permissive if the card's variants can't be read.
const availOf = (card, setCode) => { try { return printingFinishes(card, setCode); } catch { return { nonFoil: true, foil: true }; } };

export function groupCollection({
  pool, owBySet, wishSet, sets = [], own = {}, setLabel = {}, setRank = () => 0,
}) {
  const g = new Map();   // code -> { code, name, rows:[{card,set,owned,foil,updated,finishAvail}] }
  const push = (code, name, row) => {
    let x = g.get(code);
    if (!x) { x = { code, name: name || setLabel[code] || code, rows: [] }; g.set(code, x); }
    x.rows.push(row);
  };

  // ONE ownership predicate, applied identically to printed rows and to the Uncategorised pile.
  // `own` = { states, playset, qty, finishes } (see collectionFilter). When no ownership-derived
  // axis is active every printing passes; the finish scope reframes owned/missing/playset/qty AND
  // gates catalog availability. Wishlist is judged per collector item, finish-scoped (see wishedIn).
  const active = ownIsActive(own);
  const finishes = own.finishes || [];
  const matches = (row, isWish) => (active ? rowMatchesOwn(row, isWish, own) : true);

  for (const c of (pool || [])) {
    for (const s of (c._sets || [])) {
      if (!s.code) continue;
      // Per-printing set filter (a real set name; 'Uncategorised' never matches a printing).
      if (sets.length && !sets.includes(s.name)) continue;
      const oc = owBySet.get(c.card_id + '|' + s.code);
      const row = { card: c, set: s.code, owned: oc?.owned || 0, foil: oc?.foil || 0, updated: oc?.updated || '', finishAvail: availOf(c, s.code) };
      if (!matches(row, wishedIn(wishSet, c.card_id, s.code, finishes))) continue;
      push(s.code, s.name, row);
    }
  }

  // Set-less ('' ) owned rows recovered into an "Uncategorised" group. The SET gate is the only
  // special case left: they belong to no printed set, so they appear under no set filter or
  // under the explicit "Uncategorised" chip. Their OWNERSHIP is judged by the same `matches`
  // as everything else. Availability is permissive (no set to check); a want is never uncategorised.
  if (sets.length === 0 || sets.includes(UNCATEGORISED_LABEL)) {
    const byId = new Map((pool || []).map((c) => [c.card_id, c]));
    for (const [k, v] of owBySet) {
      const i = k.lastIndexOf('|');
      if (!isUncategorised(k.slice(i + 1))) continue;                // only the uncategorised bucket
      const owned = v.owned || 0, foil = v.foil || 0;
      if (owned + foil === 0) continue;                             // no row to recover
      const card = byId.get(k.slice(0, i));
      if (!card) continue;
      const row = { card, set: UNCATEGORISED_BUCKET, owned, foil, updated: v.updated || '', finishAvail: { nonFoil: true, foil: true } };
      if (!matches(row, false)) continue;
      push(UNCATEGORISED_BUCKET, UNCATEGORISED_LABEL, row);
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
