// The sort-option vocabularies for every surface that stacks sort keys.
//
// A LEAF module: imports nothing, so anything may depend on it safely. That is the whole point.
// These lists are needed by a component (RefineSheet renders them), by a pure comparator module
// (collectionFilter orders by them) and by tests (which must assert against the REAL lists, not
// fixtures). Parking them in any one of those pulls that one into the others - and a shared
// helper parked in a feature-flavoured module is a latent chunking hazard, not just a naming
// wart. See the same lesson recorded in elements.js.
//
// OPTION OBJECTS, not [key, label] tuples. A tuple cannot say which direction a key must START
// in, and the reducer that consumed the old tuples assumed ascending for everything. Every deck
// key genuinely ascends, so that assumption was invisible there - but "Recently added" means
// newest-first, and adding it ascending would have made the control contradict its own label.
//
// `asc` means ONE thing everywhere: the natural forward order of the underlying value. A to Z,
// palette order, increasing scarcity, oldest to newest. "Recently added" is therefore the
// DESCENDING view of an ascending timestamp - it declares `defaultDir: 'desc'` rather than
// redefining what ascending means.

/** Deck Add Cards. Every key ascends, which is why the option migration is a no-op there. */
export const DECK_SORT_OPTIONS = Object.freeze([
  Object.freeze({ key: 'name', label: 'Name', defaultDir: 'asc' }),
  Object.freeze({ key: 'cost', label: 'Mana Cost', defaultDir: 'asc' }),
  Object.freeze({ key: 'element', label: 'Element', defaultDir: 'asc' }),
  Object.freeze({ key: 'th', label: 'Threshold Amount', defaultDir: 'asc' }),
]);

/** List Arrange. `added` is the one key whose default direction is not ascending. */
export const LIST_SORT_OPTIONS = Object.freeze([
  Object.freeze({ key: 'name', label: 'Name', defaultDir: 'asc' }),
  Object.freeze({ key: 'element', label: 'Element', defaultDir: 'asc' }),
  Object.freeze({ key: 'rarity', label: 'Rarity', defaultDir: 'asc' }),
  Object.freeze({ key: 'added', label: 'Recently added', defaultDir: 'desc' }),
]);
