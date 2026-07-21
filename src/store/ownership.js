// The ONE ownership taxonomy for a card printing.
//
// This exists because a boolean could not carry the question. "Owned" was computed two
// different ways in the same file - printed rows used `owned > 0`, the Unspecified pile used
// `owned + foil > 0` - so the identical physical state ({owned: 0, foil: 1}) was "not owned"
// on one screen and "owned" on another. Before that, the filter and the completion tally
// disagreed, which hid a real card from a real collection: Beta read 401/402 while "Not owned"
// returned nothing, because the missing card was owned in foil only.
//
// Three states, because there are three:
//   regular   - you have a non-foil copy. The only state that counts toward completion.
//   foilOnly  - you have the card, but only in foil. Real ownership; not collection progress.
//   missing   - you do not have it at all.
//
// Wishlist is deliberately NOT a fourth state. It is an independent axis - you can want a card
// you already own - so it stays its own facet rather than being folded in here.
//
// The chips are multi-select, so "what do I still need in non-foil" is simply
// foilOnly + missing. That is why this replaces "Not owned": completion can keep counting only
// `regular` without the UI ever having to claim a foil-only card is not owned.
export const OWNERSHIP_STATES = ['regular', 'foilOnly', 'missing'];

/** @returns 'regular' | 'foilOnly' | 'missing' */
export function ownershipOf(owned, foil) {
  if ((Number(owned) || 0) > 0) return 'regular';
  if ((Number(foil) || 0) > 0) return 'foilOnly';
  return 'missing';
}

/** Convenience for the common `{ owned, foil }` row shape (a missing row is `missing`). */
export function ownershipOfRow(row) {
  return ownershipOf(row?.owned, row?.foil);
}

/** Does this printing count toward set completion? Exactly one state does. */
export function countsTowardCompletion(state) {
  return state === 'regular';
}
