// The Collection's OWNERSHIP-DERIVED refine axes - the part of the refine sheet that the catalog
// pool query (getPool) cannot answer because it depends on what the profile owns. Kept pure and
// DOM-free so the whole "does this printing pass the ownership/playset/finish/quantity filter, and
// in what order" question is node-testable, not a device round-trip.
//
// A row is the set-drill shape { card, set, owned, foil, updated, finishAvail } - `owned` is the
// non-foil count, `foil` the foil count, `updated` the printing's latest updated_at (ISO, for the
// sort), and `finishAvail` = { nonFoil, foil } the catalog's finish availability for this printing.
import { rarityRank, RARITY_ORDER } from './rarity.js';
import { playsetOf, isAvatar } from './playset.js';
import { EL_ORDER, elemKey } from './elements.js';

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

/* ---------------- stacked sort (docs/proposals/arrange-stacked-sort.md) ----------------
 *
 * The option vocabulary itself lives in the leaf module sortOptions.js, so the sheet that renders
 * it, the comparator that orders by it and the tests that assert against it can all reach it
 * without reaching each other. Re-exported here for callers already importing from this module.
 */
export { LIST_SORT_OPTIONS } from './sortOptions.js';

/**
 * The comparator registry. Each entry ranks a row into `{ tier, v }`:
 *   tier 0 - a KNOWN value, ordered by `v`, and the only tier a `desc` flip inverts
 *   tier 1 - a TAIL value (unrecognised element, unknown rarity, avatar, blank timestamp)
 *
 * Tails sort last in BOTH directions, which is why the tier is compared before direction is
 * applied. Reversing the whole result instead would float blank timestamps and avatars to the
 * top the moment a key is flipped.
 *
 * Private on purpose - descriptive metadata (`order: 'palette'`) was rejected in review as a
 * drift surface, so the ordering lives in executable code and LIST_SORT_COMPARATOR_KEYS exposes
 * only the key set, for the exhaustiveness gate.
 */
const RARITY_KNOWN_MAX = RARITY_ORDER.length - 1;   // 3: Ordinary, Exceptional, Elite, Unique

const LIST_KEY_RANK = {
  name: (row, cardOf) => ({ tier: 0, v: String(cardOf(row)?.name || '') }),
  element: (row, cardOf) => {
    const k = elemKey(cardOf(row));
    const i = EL_ORDER.indexOf(k);
    return i === -1 ? { tier: 1, v: String(k || '') } : { tier: 0, v: i };
  },
  // rarityRankFor already encodes both tails: 0-3 known, 4 unknown/no-rarity, 5 avatar. Avatars
  // carry a real rarity (Templar is Elite) but are not collected as rarity playsets, so they must
  // not interleave - and they stay behind unknown, in that fixed order, in both directions.
  rarity: (row, cardOf) => {
    const r = rarityRankFor(cardOf(row));
    return r <= RARITY_KNOWN_MAX ? { tier: 0, v: r } : { tier: 1, v: r };
  },
  // Row-level, not card-level: a list entry's own creation time. Ascending is oldest-first;
  // the option's `defaultDir: 'desc'` is what makes the first tap read newest-first.
  added: (row) => {
    const v = row?.created_at || '';
    return v ? { tier: 0, v } : { tier: 1, v: '' };
  },
};

/** The comparator keys this module can order. Exported for the exhaustiveness gate only. */
export const LIST_SORT_COMPARATOR_KEYS = Object.freeze(Object.keys(LIST_KEY_RANK));

const cmpVal = (x, y) => (typeof x === 'number'
  ? (x < y ? -1 : x > y ? 1 : 0)
  : String(x).localeCompare(String(y), 'en', { sensitivity: 'base' }));

function keyCompare(rank, a, b, dir, cardOf) {
  const ra = rank(a, cardOf);
  const rb = rank(b, cardOf);
  if (ra.tier !== rb.tier) return ra.tier - rb.tier;   // tails last, never inverted
  const d = cmpVal(ra.v, rb.v);
  if (ra.tier !== 0) return d;                         // tail-vs-tail keeps its fixed order
  return dir === 'desc' ? -d : d;
}

const validDir = (d) => (d === 'desc' ? 'desc' : 'asc');

/**
 * Build a comparator for an ordered stack of `{ key, dir }`. The complete chain is:
 *
 *   1. the selected keys, in priority order, each with its own direction
 *   2. implicit Name ascending when those tie
 *   3. a stable row identity, when the caller supplies one
 *
 * Step 2 is not decoration. EVERY comparator this replaces already ended in a name tiebreak, so
 * without it "sort by Rarity" would order each rarity run by opaque identity instead of A-Z.
 * When Name is itself selected, step 2 is a no-op: a tie there means the names are equal.
 *
 * Step 3 is what makes the order TOTAL. Names collide legitimately - a Wishlist is collector-item
 * grain, so one card can appear at several printings under one name. Without `identityOf` the
 * contract is only "stable for a deterministic input order", not total.
 *
 * An empty stack is Name ascending, which is exactly the historical default.
 */
export function stackComparator(stack = [], { cardOf = (x) => x, identityOf = null } = {}) {
  const keys = (Array.isArray(stack) ? stack : [])
    .filter((s) => s && LIST_KEY_RANK[s.key])
    .map((s) => ({ rank: LIST_KEY_RANK[s.key], dir: validDir(s.dir) }));
  return (a, b) => {
    for (const { rank, dir } of keys) {
      const d = keyCompare(rank, a, b, dir, cardOf);
      if (d !== 0) return d;
    }
    const n = keyCompare(LIST_KEY_RANK.name, a, b, 'asc', cardOf);
    if (n !== 0) return n;
    if (identityOf) {
      const ia = String(identityOf(a) ?? '');
      const ib = String(identityOf(b) ?? '');
      if (ia !== ib) return ia < ib ? -1 : 1;
    }
    return 0;
  };
}

/**
 * Legacy single-value sorts, mapped to stacks that PRESERVE their present direction. `added`
 * is the one that matters: it has always meant newest-first, and normalising it to ascending
 * would silently reverse every existing arrangement.
 */
const LEGACY_LIST_SORT = {
  name: [],
  'name-asc': [],
  'name-desc': [{ key: 'name', dir: 'desc' }],
  element: [{ key: 'element', dir: 'asc' }],
  rarity: [{ key: 'rarity', dir: 'asc' }],
  'rarity-asc': [{ key: 'rarity', dir: 'asc' }],
  added: [{ key: 'added', dir: 'desc' }],
  updated: [{ key: 'added', dir: 'desc' }],
};

/** Accept either shape and return a clean stack. Unknown keys are dropped, never guessed at. */
export function normaliseSort(value) {
  if (Array.isArray(value)) {
    return value
      .filter((s) => s && LIST_KEY_RANK[s.key])
      .map((s) => ({ key: s.key, dir: validDir(s.dir) }));
  }
  const legacy = LEGACY_LIST_SORT[value];
  return legacy ? legacy.map((s) => ({ ...s })) : [];
}
