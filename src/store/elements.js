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

/**
 * Read a card's elements regardless of which shape the caller holds.
 *
 * `cards.elements` is stored as a JSON STRING. Deck entries arrive already parsed (an array),
 * catalog-cache rows carry a parsed copy on `_els`, and raw pool/catalog rows still hold the
 * string. `elemKey` previously assumed the array shape and called `.filter` on it, so grouping
 * the set drill by element threw "elements.filter is not a function" and blanked the screen -
 * while grouping by rarity worked, because rarity is a plain string field.
 *
 * Normalising here rather than at each call site means the next caller cannot reintroduce it.
 */
export function readElements(e) {
  if (!e) return [];
  if (Array.isArray(e._els)) return e._els;          // catalog cache pre-parses to this
  const raw = e.elements;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

/** One bucket per card: 0 elements → Neutral, >1 → Multi, otherwise the element. */
export function elemKey(e) {
  const els = readElements(e).filter((x) => x && String(x).toLowerCase() !== 'none');
  return els.length === 0 ? 'Neutral' : els.length > 1 ? 'Multi' : els[0];
}
