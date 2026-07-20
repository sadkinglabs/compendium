// Element vocabulary and per-card element bucketing.
//
// A LEAF module: imports nothing, so anything may depend on it safely.
//
// This used to live in deckStats.js, which is a Decks-flavoured module. That was fine while
// only Decks needed it, but Collection's grouping needs the same bucketing, and importing
// deckStats from Collection pulled a Decks-chunk module into a second lazy chunk - which
// changed module init order in the MINIFIED build and produced a temporal-dead-zone crash
// that the unminified build, the tests, check:types and `npm run build` all missed. Only the
// installed release APK showed it.
//
// The lesson is worth keeping: a shared helper parked in a feature-flavoured module is a
// latent chunking hazard, not just a naming wart. deckStats re-exports both names so its own
// callers are untouched.
export const EL_ORDER = ['Air', 'Earth', 'Fire', 'Water', 'Multi', 'Neutral'];

/** One bucket per card: 0 elements → Neutral, >1 → Multi, otherwise the element. */
export function elemKey(e) {
  const els = (e.elements || []).filter((x) => x && x.toLowerCase() !== 'none');
  return els.length === 0 ? 'Neutral' : els.length > 1 ? 'Multi' : els[0];
}
