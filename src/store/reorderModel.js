// The COMMIT half of manual list ordering, with no DOM in it: what a list becomes when one row is
// dropped on another position.
//
// WHY IT IS ITS OWN MODULE. The gesture is dnd-kit's (see `components/DragReorderList.jsx`, which
// replaced a hand-rolled hook on 2026-08-21), and the geometry that used to live here - which slot
// the finger is over, how far each displaced row slides, how far the lifted row may travel, the
// pinned-run clamp - went with it. What a library cannot own is what the DROP MEANS to the data: the
// exact ordering the repositories are asked to write. That is decidable at a desk, it is where an
// off-by-one would survive a device pass, and so it stays here with its tests.
//
// `reorderList` is also the base of `pillars/librarySections.js`, which maps a section-local drop
// back into the Library's global order.

/**
 * The list `items` becomes when the row at `from` is dropped on `to`.
 *
 * Splice-out-then-splice-in: `to` names a position in the list AFTER the row has left it, which is
 * the same definition dnd-kit's sortable target index uses. Out-of-range or no-op moves return the
 * input array unchanged (identity, so a caller can cheaply detect "nothing happened" and skip the
 * write).
 */
export function reorderList(items, from, to) {
  const list = items || [];
  if (!Number.isInteger(from) || !Number.isInteger(to)) return list;
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
