import { UNSPECIFIED_PRINTING, normalizePrinting } from './printings.js';

// Selection state for Collection bulk mode.
//
// The central rule, and the reason this is a module rather than a useState: selection is
// SNAPSHOTTED, never derived from the active filter. "Select all 42 results" captures those
// 42 rows and holds them. If it were derived, changing a filter afterwards would silently add
// or remove rows from a pending destructive operation, and the user would confirm a delete
// over a set they never saw.
//
// The cost of snapshotting is that the selection can contain rows the grid is no longer
// showing. That is a presentation problem, not a correctness one, and it is answered by
// `hiddenCount` - the surface must disclose "N selected cards are hidden by the current
// filters" rather than quietly showing a count that does not match the grid. Presentation
// must never imply a state that is not true.
//
// Ownership is per printing, so every key carries the set. A card owned in Alpha and Beta is
// two independently selectable rows.

/** Stable key for one owned row. `set` may be '' - that is the Unspecified printing, a real
 *  row, not a missing value. */
export function selectionKey(cardId, set) {
  return `${cardId}|${normalizePrinting(set)}`;
}

export function parseSelectionKey(key) {
  const i = String(key).indexOf('|');
  return i < 0 ? { cardId: key, set: UNSPECIFIED_PRINTING } : { cardId: key.slice(0, i), set: key.slice(i + 1) };
}

/** Snapshot the given rows. Takes a copy so later mutation of `rows` cannot reach back in. */
export function snapshot(rows) {
  return new Set((rows || []).map((r) => selectionKey(r.cardId ?? r.card_id, r.set ?? r.variant_slug)));
}

export function toggle(selection, cardId, set) {
  const next = new Set(selection);
  const key = selectionKey(cardId, set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

export function isSelected(selection, cardId, set) {
  return selection.has(selectionKey(cardId, set));
}

/** Union of a snapshot with the existing selection, so "select all" after hand-picking adds
 *  rather than replaces. Clearing is an explicit action, never a side effect of selecting. */
export function addAll(selection, rows) {
  const next = new Set(selection);
  for (const k of snapshot(rows)) next.add(k);
  return next;
}

export function clear() {
  return new Set();
}

/**
 * How many selected rows are NOT in the currently visible set. This is the number the surface
 * has to disclose; without it the count lies. Returns 0 when everything selected is on screen.
 */
export function hiddenCount(selection, visibleRows) {
  const visible = snapshot(visibleRows);
  let n = 0;
  for (const key of selection) if (!visible.has(key)) n += 1;
  return n;
}

/** Rows from `rows` whose owned quantity is 0 - the "select all missing" helper. `qtyOf` is
 *  supplied by the caller so this module never touches the database. */
export function missingRows(rows, qtyOf) {
  return (rows || []).filter((r) => !(qtyOf(r.cardId ?? r.card_id, r.set ?? r.variant_slug) > 0));
}

/** Rows with at least one copy - the "select all owned" helper. */
export function ownedRows(rows, qtyOf) {
  return (rows || []).filter((r) => qtyOf(r.cardId ?? r.card_id, r.set ?? r.variant_slug) > 0);
}
