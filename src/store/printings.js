// Printing identity - what `variant_slug` means.
//
// A printing is identified by its set code: '001' Alpha, '002' Beta, with a ':f' suffix for
// the foil printing ('001:f'). The empty string is the UNSPECIFIED printing: you own the
// card, but which printing was never established - a text import of a reprinted name, or a
// scan the picker could not disambiguate.
//
// WHY THE EMPTY STRING IS A FOOTGUN, AND WHY IT IS STILL THE VALUE.
// It is falsy, so `if (slug)` and `slug || fallback` silently treat a real, ownable printing
// as absent. That has bitten this codebase more than once - hence `setDrill != null` in the
// router rather than a truthiness check.
//
// Naming it does not make it truthy. This module exists so the INTENT is legible and new code
// cannot spell the sentinel wrong; it is not a fix for the falsiness. Use `isUnspecified()`
// rather than testing the value yourself, and never `if (slug)` to mean "has a printing".
//
// WHY WE HAVE NOT CHANGED THE VALUE (yet).
// `''` is the DDL DEFAULT on owned_cards, card_list_entries AND deck_entries, sits inside two
// UNIQUE indexes, and appears in the profile export format - so every backup already taken
// contains it. Changing it is a forward-only migration, not a rename.
//
// And a rename would not fix the real problem: the `''` row is OVERLOADED. It is both the
// unspecified-printing bucket for `qty_owned` AND the only home of `qty_wanted`, the
// wishlist, which is variant-agnostic and has nowhere else to live. Renaming would produce a
// row called "unspecified" that still holds two unrelated things - the muddle preserved
// behind a better name, and harder to see. Dropping stale `''` rows would take the whole
// wishlist with them.
//
// The real change is to give the wishlist its own home; after that the printing sentinel can
// be anything. That is a schema-v11 proposal, deliberately not folded into a refactor.
export const UNSPECIFIED_PRINTING = '';

/** True when this row is the unspecified-printing bucket. Prefer this to comparing values. */
export function isUnspecified(slug) {
  return normalizePrinting(slug) === UNSPECIFIED_PRINTING;
}

/** True when this printing is a foil ('001:f'). The legacy card-level 'foil' row counts too. */
export function isFoilPrinting(slug) {
  const s = normalizePrinting(slug);
  return s === 'foil' || s.endsWith(':f');
}

/**
 * Coerce a printing to its canonical string. `null`/`undefined` mean "no printing given",
 * which IS the unspecified bucket - the one place the falsiness is the intended reading.
 */
export function normalizePrinting(slug) {
  return slug == null ? UNSPECIFIED_PRINTING : String(slug);
}

/** The set code behind a printing, foil or not: '001:f' -> '001'. */
export function setCodeOf(slug) {
  const s = normalizePrinting(slug);
  return s.endsWith(':f') ? s.slice(0, -2) : s;
}
