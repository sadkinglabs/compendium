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

/** Select EVERY row in the current (filtered) result - the full derived set, not the rendered prefix. */
export function selectAllRows(rows) {
  return new Map(rows.map((r) => [selKey(r.card.card_id, r.set), selVal(r)]));
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
