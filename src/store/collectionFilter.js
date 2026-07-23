// The Collection's OWNERSHIP-DERIVED refine axes - the part of the refine sheet that the catalog
// pool query (getPool) cannot answer because it depends on what the profile owns. Kept pure and
// DOM-free so the whole "does this printing pass the ownership/playset/finish/quantity filter, and
// in what order" question is node-testable, not a device round-trip.
//
// A row is the set-drill shape { card, set, owned, foil, added } - `owned` is the non-foil count,
// `foil` the foil count, `added` the printing's first-added timestamp (ISO, for the sort).
import { rarityRank } from './rarity.js';
import { playsetOf } from './playset.js';

// The vocabularies the sheet renders, defined here so the UI and the predicate can never drift.
export const OWN_STATES = [['owned', 'Owned'], ['missing', 'Missing'], ['wishlist', 'Wishlisted']];
export const FINISHES = [['standard', 'Standard'], ['foil', 'Foil']];
export const PLAYSET_KEYS = [['complete', 'Completed'], ['partial', 'Missing copies'], ['over', 'More than a playset']];
export const SORT_KEYS = [['name-asc', 'Name A → Z'], ['name-desc', 'Name Z → A'], ['added', 'Recently added'], ['rarity-asc', 'Rarity']];

const cmp = (a, op, b) => (op === '=' ? a === b : op === '<=' ? a <= b : a >= b);

/**
 * Effective owned count for a printing under a FINISH scope. `finishes` is a subset of
 * ['standard','foil']; EMPTY means both finishes count. This single number is what every
 * ownership-derived filter evaluates, so selecting a finish reframes Owned/Missing, Playset and
 * the Owned-amount comparator all at once, consistently.
 */
export function effOwned(row, finishes = []) {
  const owned = row?.owned || 0;
  const foil = row?.foil || 0;
  if (!finishes.length) return owned + foil;
  return (finishes.includes('standard') ? owned : 0) + (finishes.includes('foil') ? foil : 0);
}

/**
 * Does the row satisfy a PLAYSET selection (any-of subset of ['complete','partial','over'])?
 * Uncapped cards (unlimited / no rarity) can never satisfy a playset filter - they have no playset.
 *   complete: total >= rarity limit (matches the collected seal)
 *   over:     total >  rarity limit
 *   partial:  0 < total < rarity limit
 */
export function matchesPlayset(row, playset = [], finishes = []) {
  if (!playset.length) return true;
  const { limit, capped } = playsetOf(row.card, 0);
  if (!capped) return false;
  const t = effOwned(row, finishes);
  return playset.some((p) => (p === 'complete' ? t >= limit
    : p === 'over' ? t > limit
      : p === 'partial' ? (t > 0 && t < limit) : false));
}

/**
 * The full ownership-derived predicate. `own` = { states, playset, qty, finishes }:
 *   states   - subset of ['owned','missing','wishlist'] (any-of; a group, so OR within it)
 *   playset  - subset of PLAYSET keys (any-of)
 *   qty      - { op:'>='|'<='|'=', val:number|null } comparator on the effective owned count
 *   finishes - subset of ['standard','foil'] scope (empty = both)
 * Groups combine with AND (a row must pass every ACTIVE group); an empty group is inactive.
 */
export function rowMatchesOwn(row, isWish, own = {}) {
  const { states = [], playset = [], qty = null, finishes = [] } = own;
  const t = effOwned(row, finishes);
  if (states.length) {
    const ok = (states.includes('owned') && t > 0)
      || (states.includes('missing') && t === 0)
      || (states.includes('wishlist') && isWish);
    if (!ok) return false;
  }
  if (playset.length && !matchesPlayset(row, playset, finishes)) return false;
  if (qty && qty.val != null && !cmp(t, qty.op, qty.val)) return false;
  return true;
}

/** Is any ownership-derived axis active (so the caller should apply the predicate)? */
export function ownActive(own = {}) {
  const { states = [], playset = [], qty = null, finishes = [] } = own;
  return states.length > 0 || playset.length > 0 || (qty && qty.val != null) || finishes.length > 0;
}

const byName = (cardOf) => (a, b) =>
  String(cardOf(a).name || '').localeCompare(String(cardOf(b).name || ''), 'en', { sensitivity: 'base' });

/**
 * A within-section row comparator for the chosen sort key. Default (name-asc) matches the grid's
 * historical A-Z, so an unset sort changes nothing.
 *   name-asc/name-desc - alphabetical
 *   added              - first-added timestamp, NEWEST first; missing timestamps sort last
 *   rarity-asc         - Ordinary -> Unique (rarityRank); avatars/no-rarity last
 * Every key breaks ties by name-asc so the order is total and stable.
 */
export function rowComparator(sortKey = 'name-asc', cardOf = (x) => x) {
  const nameAsc = byName(cardOf);
  if (sortKey === 'name-desc') return (a, b) => nameAsc(b, a);
  if (sortKey === 'rarity-asc') return (a, b) => (rarityRank(cardOf(a).rarity) - rarityRank(cardOf(b).rarity)) || nameAsc(a, b);
  if (sortKey === 'added') {
    return (a, b) => {
      const av = a?.added || '';
      const bv = b?.added || '';
      if (av === bv) return nameAsc(a, b);
      if (!av) return 1;           // no timestamp sorts last
      if (!bv) return -1;
      return bv < av ? -1 : 1;     // newest (largest ISO) first
    };
  }
  return nameAsc;
}
