// Printing identity - what `variant_slug` means.
//
// A printing is identified by its set code: '001' Alpha, '002' Beta, with a ':f' suffix for
// the foil printing ('001:f'). The empty string is the UNCATEGORISED bucket: you own the
// card, but which set was never established - a text import of a reprinted name, or a
// scan the picker could not disambiguate.
//
// WHY THE EMPTY STRING IS A FOOTGUN, AND WHY IT IS STILL THE VALUE.
// It is falsy, so `if (slug)` and `slug || fallback` silently treat a real, ownable printing
// as absent. That has bitten this codebase more than once - hence `setDrill != null` in the
// router rather than a truthiness check.
//
// Naming it does not make it truthy. This module exists so the INTENT is legible and new code
// cannot spell the sentinel wrong; it is not a fix for the falsiness. Use `isUncategorised()`
// rather than testing the value yourself, and never `if (slug)` to mean "has a printing".
//
// WHY WE HAVE NOT CHANGED THE VALUE (yet).
// `''` is the DDL DEFAULT on owned_cards, card_list_entries AND deck_entries, sits inside two
// UNIQUE indexes, and appears in the profile export format - so every backup already taken
// contains it. Changing it is a forward-only migration, not a rename.
//
// And a rename would not fix the real problem: the `''` row is OVERLOADED. It is both the
// uncategorised bucket for `qty_owned` AND the only home of `qty_wanted`, the
// wishlist, which is variant-agnostic and has nowhere else to live. Renaming would produce a
// row called "uncategorised" that still holds two unrelated things - the muddle preserved
// behind a better name, and harder to see. Dropping stale `''` rows would take the whole
// wishlist with them.
//
// The real change is to give the wishlist its own home; after that the printing sentinel can
// be anything. That is a schema-v11 proposal, deliberately not folded into a refactor.
//
// ---------------------------------------------------------------------------
// THE FOUR KEYS. Every one of them is declared HERE and nowhere else.
//
// The v11 strings were briefly declared a second time inside the canonicaliser, and the two
// declarations drifted: writers kept emitting '' while canonicalisation emitted 'uncategorised',
// so a converted row was invisible to every reader. That is the whole reason this block exists.
// No production module may spell these values itself - import them or the predicates below.
// ---------------------------------------------------------------------------

/** v10 ownership: copies whose set was never established, non-foil. */
export const LEGACY_UNCATEGORISED = '';
/** v10 ownership: the card-level foil row - foil copies with no set recorded. */
export const LEGACY_FOIL = 'foil';
/** v11 ownership: set not established yet, non-foil. */
export const UNCATEGORISED = 'uncategorised';
/** v11 ownership: set not established yet, foil. */
export const UNCATEGORISED_FOIL = 'uncategorised:f';

// The SAME empty string, in a different table, meaning something else entirely.
//
// In `owned_cards` it meant "the set is not established yet" - a state expected to be RESOLVED.
// In `deck_entries` and `card_list_entries` it means "any collector item satisfies this": a deck
// does not care which Lightning Bolt, and a wishlist entry's set lives on its `owned_cards` row.
// That is a settled preference, not a gap, so this constant does NOT migrate with the others.
export const ANY_PRINTING = '';

// The GROUPING code for the uncategorised bucket - a UI/aggregation concept, never storage.
// Readers bucket all four ownership keys above onto this one code, which is what lets a mixed
// v10/v11 ledger group correctly while the migration is only half-adopted.
export const UNCATEGORISED_BUCKET = '';

// User-facing name for that bucket.
//
// LOAD-BEARING, not decoration: this string is both the label in SET_LABEL and the pseudo-set
// value the group filter matches on (`sets.includes(...)` in collectionGroups.js). It was
// duplicated as a literal in both places, so changing the wording in one silently broke
// filtering in the other. Exported here so they cannot drift apart again.
export const UNCATEGORISED_LABEL = 'Uncategorised';

/** True for a v10 ownership key. These are what canonicalisation rewrites. */
export function isLegacyPrinting(slug) {
  const s = normalizePrinting(slug);
  return s === LEGACY_UNCATEGORISED || s === LEGACY_FOIL;
}

/**
 * True when this row belongs to the uncategorised bucket, in EITHER schema and either finish.
 *
 * Deliberately accepts all four forms. During the transition a single ledger can hold both, and
 * a reader that recognised only one would silently drop the other from the Collection.
 */
export function isUncategorised(slug) {
  const s = normalizePrinting(slug);
  return s === LEGACY_UNCATEGORISED || s === LEGACY_FOIL
      || s === UNCATEGORISED || s === UNCATEGORISED_FOIL;
}

/**
 * Split a stored key into its grouping bucket and finish - the one reader primitive.
 *
 * '001'             -> { set: '001', foil: false }
 * '001:f'           -> { set: '001', foil: true  }
 * ''                -> { set: '',    foil: false }   legacy uncategorised
 * 'foil'            -> { set: '',    foil: true  }   legacy card-level foil
 * 'uncategorised'   -> { set: '',    foil: false }   v11
 * 'uncategorised:f' -> { set: '',    foil: true  }   v11
 */
export function parsePrinting(slug) {
  const s = normalizePrinting(slug);
  if (s === LEGACY_FOIL) return { set: UNCATEGORISED_BUCKET, foil: true };
  const foil = s.endsWith(':f');
  const set = foil ? s.slice(0, -2) : s;
  if (set === UNCATEGORISED) return { set: UNCATEGORISED_BUCKET, foil };
  return { set, foil };
}

/**
 * Every storage key a (bucket, finish) pair can be sitting on right now.
 *
 * A read that names exact slugs must name BOTH schemas, or it stops seeing a row the moment
 * canonicalisation converts it. Returns one slug for a real set and two for the uncategorised
 * bucket, which is the only place the two schemas disagree.
 */
export function printingSlugs(set, foil) {
  if (set === UNCATEGORISED_BUCKET || set == null) {
    return foil ? [LEGACY_FOIL, UNCATEGORISED_FOIL] : [LEGACY_UNCATEGORISED, UNCATEGORISED];
  }
  return [foil ? `${set}:f` : set];
}

/**
 * The ONE key a v11 writer may store for a (set, finish) pair.
 *
 * `printingSlugs` is its read-side counterpart: reads must name every slug a row could be
 * sitting on during the transition, but a write has to choose exactly one, and it is always
 * the canonical form. A writer that returned a legacy key here would quietly reintroduce the
 * state the migration exists to remove.
 */
export function canonicalPrinting(set, foil) {
  if (!set || set === UNCATEGORISED_BUCKET) return foil ? UNCATEGORISED_FOIL : UNCATEGORISED;
  return foil ? `${set}:f` : set;
}

// SQL fragments, shared so a predicate cannot be spelled differently in two queries.
//
// SQL_IS_FOIL already covered 'uncategorised:f' by accident, because it ends in ':f'. Accident
// is not a contract, so it is stated here and tested.
export const SQL_IS_FOIL = (col = 'variant_slug') => `(${col}='${LEGACY_FOIL}' OR ${col} LIKE '%:f')`;
export const SQL_IS_LEGACY = (col = 'variant_slug') => `(${col}='${LEGACY_UNCATEGORISED}' OR ${col}='${LEGACY_FOIL}')`;
export const SQL_IS_UNCATEGORISED = (col = 'variant_slug') => `(${SQL_IS_LEGACY(col)} OR ${col}='${UNCATEGORISED}' OR ${col}='${UNCATEGORISED_FOIL}')`;

/** True when this printing is a foil ('001:f'). The legacy card-level 'foil' row counts too. */
export function isFoilPrinting(slug) {
  const s = normalizePrinting(slug);
  return s === LEGACY_FOIL || s.endsWith(':f');
}

/**
 * Coerce a printing to its canonical string. `null`/`undefined` mean "no printing given",
 * which IS the uncategorised bucket - the one place the falsiness is the intended reading.
 */
export function normalizePrinting(slug) {
  return slug == null ? LEGACY_UNCATEGORISED : String(slug);
}

/** The set code behind a printing, foil or not: '001:f' -> '001'. */
export function setCodeOf(slug) {
  const s = normalizePrinting(slug);
  return s.endsWith(':f') ? s.slice(0, -2) : s;
}

/**
 * The display name of a card's SOLE SET, or null when the name belongs to more than one.
 *
 * It establishes a SET and nothing more - not a finish, and not an exact catalog variant.
 * The Collection grain is card + set + finish; this answers only the middle term.
 *
 * Used by list rows for their set pill. The rule is "say nothing rather than guess": the pill
 * previously rendered `sets[0].name`, an array index, so a wishlisted Albespine Pikemen showed
 * "ALPHA" because Alpha sorts first, while the copies in hand were Beta. It was correct
 * exactly when it could not be wrong - single-set cards - and silently wrong on every
 * reprint, which taught the reader that wants were tied to a printing when nothing stored one.
 *
 * When wants become per-printing (schema v11) the row carries a real printing and rows should
 * show THAT instead of calling this.
 *
 * @param setsJson the catalog `sets` field: a JSON array of { code, name }
 */
export function soleSetName(setsJson) {
  try {
    const s = JSON.parse(setsJson || '[]');
    if (!Array.isArray(s) || s.length !== 1) return null;
    return s[0]?.name || null;
  } catch { return null; }
}
