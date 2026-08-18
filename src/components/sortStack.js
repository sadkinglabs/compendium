// The shared ordered-sort-stack reducer (docs/proposals/arrange-stacked-sort.md).
//
// Pure and DOM-free so both refine surfaces - Deck Add Cards and List Arrange - get identical
// tap semantics without either owning them.
//
// WHY IT TAKES THE OPTION OBJECT, NOT A KEY. The version this replaces lived inside RefineSheet
// and hardcoded `dir: 'asc'` on every add. That is fine for the deckbuilder, where every key
// ascends, and silently wrong for "Recently added", which has always meant newest-first: tapping
// it would have listed the OLDEST first, a control contradicting its own label.
//
// The fix is not a lookup table of default directions - a lookup can miss, and a missing entry
// would fall back to ascending, reintroducing the same bug through a quieter door. The sheet
// already holds the option object when it renders the row, so it passes the whole thing. There
// is no lookup, therefore no lookup failure, therefore no fallback. An option that does not
// declare a real direction is REJECTED rather than defaulted.

/** An option is usable only if it names a key and commits to a direction. */
export function isValidSortOption(option) {
  return Boolean(option)
    && typeof option.key === 'string' && option.key.length > 0
    && (option.defaultDir === 'asc' || option.defaultDir === 'desc');
}

/**
 * Add the option to the stack (at the end - tap order IS priority order), or remove it if it is
 * already there. An invalid option returns the stack UNCHANGED: the tap is ignored rather than
 * guessed at. Dev builds throw, so a malformed option list fails loudly in development and
 * inertly in a user's hands.
 */
export function toggleSort(stack, option) {
  const list = Array.isArray(stack) ? stack : [];
  if (!isValidSortOption(option)) {
    if (import.meta.env?.DEV) throw new Error(`toggleSort: option must declare key + defaultDir 'asc'|'desc', got ${JSON.stringify(option)}`);
    return list;
  }
  const i = list.findIndex((s) => s.key === option.key);
  return i >= 0
    ? list.filter((s) => s.key !== option.key)
    : [...list, { key: option.key, dir: option.defaultDir }];
}

/** Flip one key's direction, leaving its position in the priority order alone. */
export function flipSort(stack, key) {
  const list = Array.isArray(stack) ? stack : [];
  return list.map((s) => (s.key === key ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s));
}

/** Where `key` sits in the priority order, or -1. */
export function sortIndex(stack, key) {
  const list = Array.isArray(stack) ? stack : [];
  return list.findIndex((s) => s.key === key);
}
