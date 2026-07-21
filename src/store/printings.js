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
// PHASE B (this change): the names below say what each `''` MEANS. The value is untouched, so
// this is a pure rename - reversible by `git revert`, unlike everything after it.
export const UNCATEGORISED = '';

// The SAME character, in a different table, meaning something else entirely.
//
// In `owned_cards`, `''` means "you own copies whose set is not established yet" - a state
// that is expected to be RESOLVED, and the contents of the To Be Categorised pile.
// In `deck_entries` and `card_list_entries`, `''` means "any collector item satisfies this" -
// a deck does not care which Lightning Bolt, and a wishlist entry's set lives on its
// `owned_cards` row, not here. That is a settled preference, not a gap.
//
// Two constants, not one, precisely because they are equal today. A single shared constant
// would invite a future reader to propagate ownership triage into deck rows - the exact class
// of bug the v11 work exists to end. If the ownership sentinel ever changes value, this one
// must NOT follow it.
export const ANY_PRINTING = '';

/** The pre-v11 card-level foil row: foil copies with no set recorded. */
export const LEGACY_FOIL_PRINTING = 'foil';

// User-facing name for the uncategorised ownership bucket.
//
// LOAD-BEARING, not decoration: this string is both the label in SET_LABEL and the pseudo-set
// value that the group filter matches on (`sets.includes(...)` in collectionGroups.js). It was
// duplicated as a literal in both places, so changing the wording in one silently broke
// filtering in the other. Exported here so they cannot drift apart again.
export const UNCATEGORISED_LABEL = 'Uncategorised';

/** True when this row is the uncategorised bucket. Prefer this to comparing values. */
export function isUncategorised(slug) {
  return normalizePrinting(slug) === UNCATEGORISED;
}

/** True when this printing is a foil ('001:f'). The legacy card-level 'foil' row counts too. */
export function isFoilPrinting(slug) {
  const s = normalizePrinting(slug);
  return s === LEGACY_FOIL_PRINTING || s.endsWith(':f');
}

/**
 * Coerce a printing to its canonical string. `null`/`undefined` mean "no printing given",
 * which IS the uncategorised bucket - the one place the falsiness is the intended reading.
 */
export function normalizePrinting(slug) {
  return slug == null ? UNCATEGORISED : String(slug);
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
