// How the Decks Library is divided into sections, and what a drag inside one of them means for the
// library as a whole. No DOM, no React - the arithmetic only.
//
// WHY THIS EXISTS. `listDecks` orders `starred DESC, lib_order ASC`, so a favourite always outranks
// a plain deck no matter what `lib_order` says. That boundary shipped INVISIBLE - one flat list with
// a star badge in the corner - and the drag had to defend it with a clamp the user could feel but
// not see. Owner ruling 2026-08-21: make the boundary structural instead. The Library renders as
// "Favourites" and "My Decks", each its own list, and the clamp becomes unnecessary because there
// is no longer a single list to cross.
//
// THE MAPPING IS THE RISK. Each section drags in its OWN index space (0..len-1), but
// `reorderDecks` demands one array naming every deck in the profile, favourites first. Translating
// a section-local (from, to) into that global array is exactly the off-by-one that would survive a
// device pass, so it lives here with tests rather than inline in the pager.
import { reorderList } from '../store/reorderModel.js';

/** Section keys, in the order they render. `label` is what the SectionLabel rubric shows. */
const SECTIONS = [
  { key: 'fav', label: 'FAVOURITES', match: (d) => !!d.starred },
  { key: 'rest', label: 'MY DECKS', match: (d) => !d.starred },
];

/**
 * Split a deck list into its rendered sections.
 *
 * A section appears ONLY when it has rows: no "Favourites" over nothing, and equally no "My Decks"
 * header when every deck is starred. Applied to whatever is DISPLAYED, so a search that matches
 * only favourites hides the "My Decks" header too.
 *
 * Membership is derived by predicate rather than by trusting the incoming order to be contiguous.
 * That costs one pass and buys the guarantee `reorderDecks` enforces below the UI - favourites
 * first, always - even if a caller ever hands over a list the query did not sort.
 *
 * @param {Array<{id:string, starred?:any}>} rows
 * @returns {Array<{key:string, label:string, rows:Array}>} non-empty sections, in render order
 */
export function librarySections(rows) {
  const list = rows || [];
  const out = [];
  for (const s of SECTIONS) {
    const matched = list.filter(s.match);
    if (matched.length) out.push({ key: s.key, label: s.label, rows: matched });
  }
  return out;
}

/**
 * The whole library after the row at `from` in section `key` is dropped on `to`.
 *
 * The result is the concatenation of every section in render order - favourites, then the rest -
 * with only the named section resequenced, which is precisely the shape `reorderDecks` accepts.
 * A reorder in one section therefore cannot disturb another, and cannot invent an arrangement the
 * `starred DESC` query could not reproduce.
 *
 * Returns the INPUT array by identity when nothing moved (unknown section, no-op or out-of-range
 * indices), matching `reorderList`'s contract so a caller can cheaply detect "nothing happened".
 *
 * @param {Array} rows   the full ordered deck list
 * @param {string} key   which section the drag happened in
 * @param {number} from
 * @param {number} to
 */
export function reorderInSection(rows, key, from, to) {
  const list = rows || [];
  const sections = librarySections(list);
  const target = sections.find((s) => s.key === key);
  if (!target) return list;
  const moved = reorderList(target.rows, from, to);
  if (moved === target.rows) return list;
  return sections.flatMap((s) => (s.key === key ? moved : s.rows));
}
