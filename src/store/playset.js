// A card's PLAYSET: the legal number of copies you may own, capped by rarity
// (Ordinary 4 · Exceptional 3 · Elite 2 · Unique 1). "Any number of" cards, cards with no rarity,
// and AVATARS are UNCAPPED - they stand outside the playset concept, so a playset filter or a
// completion seal never applies. Avatars DO carry a rarity in the catalog; they are uncapped because
// `isAvatar` names them explicitly, not because they lack rarity. SITES are NOT excluded - a Site
// keeps its rarity cap and a normal playset.
//
// Leaf module (no store imports) so both the UI (CollectionCardViews) and the pure collection
// filter/group layer can share ONE definition of "a playset" without a cycle. deckRepository
// re-exports RARITY_LIMITS + isUnlimited from here so its public API is unchanged.
export const RARITY_LIMITS = { Ordinary: 4, Exceptional: 3, Elite: 2, Unique: 1 };

export const isUnlimited = (card) => /any number of/i.test(card?.rules_text || '');

// The DB column is is_avatar; the catalog JSON uses isAvatar. Real avatars DO carry a rarity in the
// catalog (Templar is Elite; Witch and Dragonlord are Unique), but an avatar is not collected as a
// rarity playset, so it is treated as uncapped here and sorted apart from normal rarities elsewhere.
export const isAvatar = (card) => Boolean(card?.is_avatar || card?.isAvatar);

// Returns `{ limit, capped, complete }`:
//   limit    - the playset size (0 when uncapped)
//   capped   - the card has a real rarity cap and is not "any number of"
//   complete - capped AND total reaches the limit (>= limit, matching the collected seal)
export function playsetOf(card, total) {
  const limit = RARITY_LIMITS[card?.rarity];
  const capped = !!limit && !isUnlimited(card) && !isAvatar(card);   // avatars have a rarity but no playset
  return { limit: capped ? limit : 0, capped, complete: capped && total >= limit };
}
