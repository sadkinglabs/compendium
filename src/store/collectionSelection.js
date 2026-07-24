// Bulk-selection over a Collection grid, as PURE reducer + payload helpers so the contract is a unit
// test, not a device round-trip. Selection is a SNAPSHOT keyed `card_id|set`, capturing each picked
// printing's {card, set, owned, foil} at pick time - it changes ONLY on an explicit user action
// (toggle / select-all / deselect-all / clear), never because filters or progressive rendering moved
// the derived rows underneath it. Used by both the set drill and the ALL view.
import { printingFinishes } from './printingRows.js';
import { MAX_BATCH_ITEMS } from './bulkWriteContract.js';

export { MAX_BATCH_ITEMS };
export const selKey = (cardId, set) => `${cardId}|${set}`;
export const selVal = (row) => ({ card: row.card, set: row.set, owned: row.owned || 0, foil: row.foil || 0 });

/** Toggle one printing in the snapshot. Returns a NEW Map. `rows` supplies the row to capture on add. */
export function toggleSelected(selected, cardId, set, rows) {
  const next = new Map(selected);
  const key = selKey(cardId, set);
  if (next.has(key)) { next.delete(key); return next; }
  const row = rows.find((r) => r.card.card_id === cardId && r.set === set);
  if (row) next.set(key, selVal(row));
  return next;
}

/**
 * Select all: UNION the current (filtered) result into the existing snapshot - the full derived set,
 * not the rendered prefix, and ADDED to (never replacing) what was already hand-picked or selected
 * under an earlier filter. Clearing is only ever the explicit Deselect-all action. Returns a NEW Map.
 */
export function selectAllRows(selected, rows) {
  const next = new Map(selected);
  for (const r of rows) next.set(selKey(r.card.card_id, r.set), selVal(r));
  return next;
}

/** True iff EVERY current row is in the snapshot (membership, not counts). A disjoint result of the
 *  same size is NOT "all selected" - that count-equality bug wrongly showed "Deselect all". */
export function allRowsSelected(selected, rows) {
  if (!rows.length) return false;
  for (const r of rows) if (!selected.has(selKey(r.card.card_id, r.set))) return false;
  return true;
}

/**
 * The one presentation contract for a selection over a grid: the running count, whether EVERY current
 * row is selected (drives Select-all vs Deselect-all), and how many picks the active filter now hides.
 * Both Collection surfaces (set drill + ALL) derive their pill/action-bar state through this, so the
 * two can't drift apart (e.g. one disclosing hidden picks while the other silently edits them).
 */
export function selectionSummary(selected, rows) {
  return { count: selected.size, allSelected: allRowsSelected(selected, rows), hidden: hiddenSelectedCount(selected, rows) };
}

/** How many selected items are NOT in the currently derived rows (hidden by the active filter). */
export function hiddenSelectedCount(selected, rows) {
  if (!selected.size) return 0;
  const visible = new Set(rows.map((r) => selKey(r.card.card_id, r.set)));
  let n = 0;
  for (const k of selected.keys()) if (!visible.has(k)) n += 1;
  return n;
}

/**
 * Edit-copies payload: only the printings that actually HAVE the chosen finish (a non-foil-only card
 * can't take a foil; a foil-only card like Winter River can't take a standard). Returns
 * `{ items:[{card,set}], skipped }`. This is the authoritative payload the 2000 guard counts.
 */
export function editCopiesEligible(values, foil) {
  const items = [];
  let skipped = 0;
  for (const { card, set } of values) {
    let fin;
    try { fin = printingFinishes(card, set); } catch { fin = { nonFoil: true, foil: false }; }
    if (foil ? fin.foil : fin.nonFoil) items.push({ card, set });
    else skipped += 1;
  }
  return { items, skipped };
}

/** New-list payload: DISTINCT card ids - selected printings collapse to card grain (one entry each). */
export function newListCardIds(values) {
  return [...new Set(values.map(({ card }) => card.card_id))];
}

/** The batch guard: an actual payload over MAX_BATCH_ITEMS is refused whole (never split or capped). */
export const overBatch = (count) => count > MAX_BATCH_ITEMS;
