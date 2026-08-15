// Grouping for the Collection card grid.
//
// The A-Z rail helpers (letterOf / letterIndex) were written here and REMOVED again: the rail
// is Phase 4 and nothing consumed them. Tested-but-unconsumed exports calcify a contract
// nobody has had to live with yet, so they land with the rail rather than before it.
//
// Grouping is NOT sorting, and the distinction is load-bearing. "Group by element" produces
// sections with headers; it does not reorder a flat list. Modelling these as sort keys would
// leak the wrong abstraction into the refine sheet, the query state and the tests, so the two
// controls stay separate: `Group by: none | element | rarity`, alphabetical WITHIN every group.
//
// Pure and DOM-free on purpose - this is the part of the redesign that can be tested without
// a device, so it should carry as much of the logic as possible.
import { EL_ORDER, elemKey } from './elements.js';   // leaf module - NOT deckStats (see elements.js)
import { RARITY_ORDER } from './rarity.js';

export const GROUP_MODES = ['none', 'element', 'rarity', 'set'];

// Callers hold different shapes: the sets home has bare catalog cards, the set drill has
// {card, set, owned, foil} ownership rows. An accessor keeps this module working on both
// without either side reshaping data purely to satisfy it - reshaping would detach the
// grouped result from the row the grid actually needs to render.
const identity = (x) => x;

// The DB column is is_avatar; the catalog JSON uses isAvatar. Accept both so this works on a
// pool row and on a raw catalog card without the caller normalising first.
const isAvatarCard = (c) => Boolean(c?.is_avatar || c?.isAvatar);
const byNameWith = (cardOf) => (a, b) =>
  String(cardOf(a).name || '').localeCompare(String(cardOf(b).name || ''), 'en', { sensitivity: 'base' });

/**
 * Group cards into rendered sections.
 * @param comparator optional within-section order (row, row) => number. Defaults to name A-Z, so
 *        an unset sort preserves the historical grid order. Grouping still SECTIONS by element or
 *        rarity; the comparator only orders WITHIN a section.
 * @returns [{ key, label, cards }] - sorted within a section, and sections themselves in a
 *          meaningful order (element palette order, rarity scarcity order). Empty sections are
 *          omitted; a mode that yields one section still returns an array so the caller renders one
 *          code path rather than branching on mode.
 */
export function groupCards(cards, mode = 'none', cardOf = identity, comparator = null, opts = {}) {
  const order2 = comparator || byNameWith(cardOf);
  const list = [...(cards || [])].sort(order2);
  // 'set' grouping (List Arrange): the SET vocabulary stays with the CALLER - which
  // set a row belongs to is a surface decision (wishlist rows carry their exact
  // printing; card-grain rows use what their set pill shows), and the set
  // rank/label tables live in sets.js, which this leaf module must not import.
  // opts: setOf(row) -> bucket key; setRank(key) -> sort number; setLabel(key) -> heading.
  if (mode === 'set') {
    const setOf = opts.setOf || ((r) => cardOf(r)?.set);
    const rank = opts.setRank || (() => 0);
    const label = opts.setLabel || ((k) => String(k));
    const buckets = new Map();
    for (const c of list) {
      const k = setOf(c) || 'Unknown';
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(c);
    }
    return [...buckets.keys()]
      .sort((a, b) => (rank(a) - rank(b)) || String(label(a)).localeCompare(String(label(b))))
      .map((k) => ({ key: k, label: label(k), cards: buckets.get(k) }));
  }
  if (mode !== 'element' && mode !== 'rarity') {
    return [{ key: 'all', label: '', cards: list }];
  }
  const order = mode === 'element' ? EL_ORDER : RARITY_ORDER;
  // Avatars genuinely have no rarity in Sorcery, so bucketing them as "Unknown" reads like a
  // data fault when it is correct data. They get their own named section instead, after the
  // four real rarities.
  const keyOf = mode === 'element'
    ? ((r) => elemKey(cardOf(r)))
    : ((r) => { const c = cardOf(r); return c.rarity || (isAvatarCard(c) ? 'Avatar' : null); });
  const buckets = new Map();
  for (const c of list) {
    // Unknown values bucket under their own literal key so nothing silently vanishes from
    // the grid; they render after the known sections rather than being dropped.
    const k = keyOf(c) || 'Unknown';
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(c);
  }
  const known = order.filter((k) => buckets.has(k)).map((k) => ({ key: k, label: k, cards: buckets.get(k) }));
  const extra = [...buckets.keys()].filter((k) => !order.includes(k)).sort()
    .map((k) => ({ key: k, label: k, cards: buckets.get(k) }));
  return [...known, ...extra];
}
