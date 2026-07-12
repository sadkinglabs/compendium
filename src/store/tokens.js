// Game TOKENS - creatures/sites generated during play (Frogs, Foot Soldiers,
// Rubble, Skeletons…), not cards you collect or deckbuild. The Collection hides
// them so the owned/set counts and the add flows stay about real cards.
//
// Source of truth: Curiosa's card.search `category === 'Token'` - which lists the
// seven canonical tokens Bruin, Foot Soldier, Frog, Lance, Rubble, Skeleton,
// Tawny. Our local catalog (from Lexicum) carries per-art variants Curiosa folds
// into one name (Frog (Blue/Green/Red), Foot Soldier 1/2/3, …), so we match the
// explicit set below plus a prefix guard for the two families with many variants.
// Update this list if a future set prints new tokens.
const TOKEN_NAMES = new Set([
  'Frog', 'Frog (Blue)', 'Frog (Green)', 'Frog (Red)',
  'Foot Soldier 1', 'Foot Soldier 2', 'Foot Soldier 3', 'Foot Soldiers',
  'Foot Soldier (English)', 'Foot Soldier (Saracen)',
  'Rubble', 'Bruin', 'Tawny', 'Skeleton', 'Lance',
]);

/** True if the card is a game token (excluded from the Collection). */
export function isTokenCard(card) {
  const n = card?.name;
  if (!n) return false;
  if (TOKEN_NAMES.has(n)) return true;
  // Catch numbered / parenthetical art variants of the many-variant token families.
  return /^Foot Soldiers?\b/.test(n) || /^Frog\s*\(/.test(n);
}
