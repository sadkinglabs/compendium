// The Collection's OWNERSHIP-DERIVED refine axes - the part of the refine sheet that the catalog
// pool query (getPool) cannot answer because it depends on what the profile owns. Kept pure and
// DOM-free so the whole "does this printing pass the ownership/playset/finish/quantity filter, and
// in what order" question is node-testable, not a device round-trip.
//
// A row is the set-drill shape { card, set, owned, foil, updated, finishAvail } - `owned` is the
// non-foil count, `foil` the foil count, `updated` the printing's latest updated_at (ISO, for the
// sort), and `finishAvail` = { nonFoil, foil } the catalog's finish availability for this printing.
import { rarityRank } from './rarity.js';
import { playsetOf, isAvatar } from './playset.js';

// The vocabularies the sheet renders, defined here so the UI and the predicate can never drift.
export const OWN_STATES = [['owned', 'Owned'], ['missing', 'Missing'], ['wishlist', 'Wishlisted']];
export const FINISHES = [['standard', 'Standard'], ['foil', 'Foil']];
export const PLAYSET_KEYS = [['complete', 'Completed'], ['partial', 'Missing copies'], ['over', 'More than a playset']];
// 'updated' (not 'added'): a want can create the row before any copy is owned, so no shared-row
// timestamp is a true acquisition time - see ownedBySet. This sorts by collector-record activity.
export const SORT_KEYS = [['name-asc', 'Name A → Z'], ['name-desc', 'Name Z → A'], ['updated', 'Recently updated'], ['rarity-asc', 'Rarity']];

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
 * Is at least one of the SELECTED finishes a real catalog printing for this row? `finishAvail` =
 * { nonFoil, foil } comes off the row (from printingFinishes). A foil-only card under Standard scope
 * fails here, so the surface never presents an impossible collector item (a Standard Winter River)
 * as something the user "lacks". No scope => always allowed. Missing availability => permissive.
 */
export function finishAllowed(row, finishes = []) {
  if (!finishes.length) return true;
  const a = row?.finishAvail || { nonFoil: true, foil: true };
  return (finishes.includes('standard') && a.nonFoil) || (finishes.includes('foil') && a.foil);
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
  // Finish is a REAL filter: a printing whose catalog offers none of the selected finishes is not a
  // valid collector item under this scope, so it drops out entirely (a foil-only card under Standard).
  if (finishes.length && !finishAllowed(row, finishes)) return false;
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

// Rarity rank that sorts AVATARS dead last: real avatars carry a rarity (Templar is Elite,
// Witch/Dragonlord Unique), but they are not collected as rarity playsets, so they must not
// interleave with normal Elites/Uniques. Ordering is: known rarities (Ordinary->Unique), then
// unknown/no-rarity (rarityRank's own last slot), then avatars one past that.
const rarityRankFor = (card) => (isAvatar(card) ? rarityRank(undefined) + 1 : rarityRank(card?.rarity));

/**
 * A within-section row comparator for the chosen sort key. Default (name-asc) matches the grid's
 * historical A-Z, so an unset sort changes nothing.
 *   name-asc/name-desc - alphabetical
 *   updated            - latest updated_at (collector-record activity), NEWEST first; blanks last
 *   rarity-asc         - Ordinary -> Unique; then unknown/no-rarity; then avatars (dead last)
 * Every key breaks ties by name-asc so the order is total and stable.
 */
export function rowComparator(sortKey = 'name-asc', cardOf = (x) => x) {
  const nameAsc = byName(cardOf);
  if (sortKey === 'name-desc') return (a, b) => nameAsc(b, a);
  if (sortKey === 'rarity-asc') return (a, b) => (rarityRankFor(cardOf(a)) - rarityRankFor(cardOf(b))) || nameAsc(a, b);
  if (sortKey === 'updated') {
    return (a, b) => {
      const av = a?.updated || '';
      const bv = b?.updated || '';
      if (av === bv) return nameAsc(a, b);
      if (!av) return 1;           // no timestamp sorts last
      if (!bv) return -1;
      return bv < av ? -1 : 1;     // newest (largest ISO) first
    };
  }
  return nameAsc;
}
