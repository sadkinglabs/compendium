// Canonical rarity order for Sorcery.
//
// This is a real scarcity order (Ordinary is the commonest, Unique the scarcest), so it
// cannot be derived from the strings themselves - alphabetical would give Elite, Exceptional,
// Ordinary, Unique, which is meaningless. It has to be stated once, and this is that once.
//
// `deckStats.js` held a private copy of this list; it now imports from here. Anything that
// needs to order, group or rank by rarity belongs on this module rather than restating it.
export const RARITY_ORDER = ['Ordinary', 'Exceptional', 'Elite', 'Unique'];

const RANK = new Map(RARITY_ORDER.map((r, i) => [r, i]));

/** Sort rank, ascending from commonest. Unknown or missing rarities sort last, never first,
 *  so bad catalog data cannot displace real cards at the top of a group. */
export function rarityRank(rarity) {
  const i = RANK.get(rarity);
  return i === undefined ? RARITY_ORDER.length : i;
}
