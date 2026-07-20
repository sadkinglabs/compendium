// Grouping for the Collection card grid, plus the data the A-Z rail needs.
//
// Grouping is NOT sorting, and the distinction is load-bearing. "Group by element" produces
// sections with headers; it does not reorder a flat list. Modelling these as sort keys would
// leak the wrong abstraction into the refine sheet, the query state and the tests, so the two
// controls stay separate: `Group by: none | element | rarity`, alphabetical WITHIN every group.
//
// Pure and DOM-free on purpose - this is the part of the redesign that can be tested without
// a device, so it should carry as much of the logic as possible.
import { EL_ORDER, elemKey } from './deckStats.js';
import { RARITY_ORDER } from './rarity.js';

export const GROUP_MODES = ['none', 'element', 'rarity'];

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' });

/** The rail bucket for a card: its first letter, or '#' for anything not A-Z (numerals,
 *  quotes, diacritics that fold outside the alphabet). Folding to '#' rather than dropping
 *  the card is what keeps the rail's counts honest against the grid. */
export function letterOf(name) {
  const ch = String(name || '').trim().charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
}

/**
 * Group cards into rendered sections.
 * @returns [{ key, label, cards }] - always alphabetical within a section, and sections
 *          themselves in a meaningful order (element palette order, rarity scarcity order).
 *          Empty sections are omitted; a mode that yields one section still returns an array
 *          so the caller renders one code path rather than branching on mode.
 */
export function groupCards(cards, mode = 'none') {
  const list = [...(cards || [])].sort(byName);
  if (mode !== 'element' && mode !== 'rarity') {
    return [{ key: 'all', label: '', cards: list }];
  }
  const order = mode === 'element' ? EL_ORDER : RARITY_ORDER;
  const keyOf = mode === 'element' ? elemKey : ((c) => c.rarity);
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

/**
 * Index data for the A-Z rail. Only meaningful in ungrouped alphabetical mode; element and
 * rarity grouping use section headers instead, and the caller hides the rail.
 *
 * Every letter is returned, present or not, because the rail is a fixed-height scrub track -
 * letters must not reflow as filters change. `count: 0` is the caller's cue to collapse that
 * letter to a dot.
 *
 * @returns [{ letter, count, index }] where index is the position of the first matching card
 *          in the sorted list, or -1 when the letter is empty.
 */
export function letterIndex(cards) {
  const list = [...(cards || [])].sort(byName);
  const seen = new Map();
  list.forEach((c, i) => {
    const l = letterOf(c.name);
    if (!seen.has(l)) seen.set(l, { count: 0, index: i });
    seen.get(l).count += 1;
  });
  const letters = ['#', ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))];
  return letters.map((letter) => {
    const hit = seen.get(letter);
    return { letter, count: hit ? hit.count : 0, index: hit ? hit.index : -1 };
  });
}
