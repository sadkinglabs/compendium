// Planning and undo for Collection bulk writes.
//
// Two rules drive everything here, and both came out of review rather than intuition.
//
// 1. A PLAN CONTAINS ONLY ROWS THAT ACTUALLY CHANGE. "Ensure at least 1" over a card you
//    already own three of is a no-op, and a no-op must not appear in the plan. If it did, the
//    confirmation would over-report ("changed 42 cards" when it changed 9) and, worse, undo
//    would have a before/after pair for a row it never touched.
//
// 2. UNDO IS NOT AN INVERSE DELTA. It stores each row's before AND committed-after value, and
//    restores a row only if that row's CURRENT value still equals the committed-after value.
//    An inverse delta cannot express "Ensure at least 1" (it does not know which rows it
//    actually raised), and applying one blindly would silently overwrite any edit the user
//    made between the bulk write and the undo. Rows that moved on are reported as conflicts,
//    never overwritten.
//
// Pure and DOM-free, and it never touches the database: current quantities arrive through a
// `qtyOf` callback so the whole thing is testable without a backend.

export const BULK_OPS = ['add1', 'ensure1', 'remove1'];

/** Resulting quantity for one row under one operation. Clamped at 0 - quantities are counts
 *  of physical cards and cannot go negative. */
function nextQty(op, before) {
  const n = Number(before) || 0;
  if (op === 'add1') return n + 1;
  if (op === 'ensure1') return Math.max(n, 1);
  if (op === 'remove1') return Math.max(0, n - 1);
  throw new Error(`unknown bulk op: ${op}`);
}

/**
 * Build the write plan.
 * @param op       one of BULK_OPS
 * @param targets  [{ cardId, set }] - the snapshotted selection
 * @param qtyOf    (cardId, set) => current owned quantity
 * @returns { op, changes: [{ cardId, set, before, after }], unchanged: n }
 *          `changes` is what gets written and what undo is built from; `unchanged` exists so
 *          the confirmation can be honest about a selection that was already satisfied.
 */
export function planBulk(op, targets, qtyOf) {
  if (!BULK_OPS.includes(op)) throw new Error(`unknown bulk op: ${op}`);
  const changes = [];
  let unchanged = 0;
  const seen = new Set();
  for (const t of targets || []) {
    const cardId = t.cardId ?? t.card_id;
    const set = t.set ?? t.variant_slug ?? '';
    // Deduplicate: the same printing must never be written twice in one transaction, or the
    // second write's "before" would be the first write's result and undo would be wrong.
    const key = `${cardId}|${set}`;
    if (!cardId || seen.has(key)) continue;
    seen.add(key);
    const before = Number(qtyOf(cardId, set)) || 0;
    const after = nextQty(op, before);
    if (after === before) { unchanged += 1; continue; }
    changes.push({ cardId, set, before, after });
  }
  return { op, changes, unchanged };
}

/**
 * Turn a committed plan into an undo record. Kept separate from `planBulk` because it must be
 * built from what was actually COMMITTED, not from what was intended - if the transaction
 * wrote a subset, undoing the intent would corrupt rows the write never reached.
 */
export function planUndo(committedChanges) {
  return {
    restores: (committedChanges || []).map((c) => ({
      cardId: c.cardId, set: c.set, expect: c.after, to: c.before,
    })),
  };
}

/**
 * Split an undo record against the database's current state.
 *
 * A row is safe to restore only while it still holds the value the bulk write left there. If
 * anything changed it since - a quick-add tap, another bulk op, an import - restoring would
 * silently discard that edit, so the row becomes a conflict and is reported instead.
 *
 * @returns { safe: [{cardId,set,to}], conflicts: [{cardId,set,expect,found,to}] }
 */
export function resolveUndo(undoRecord, qtyOf) {
  const safe = [];
  const conflicts = [];
  for (const r of (undoRecord?.restores) || []) {
    const found = Number(qtyOf(r.cardId, r.set)) || 0;
    if (found === r.expect) safe.push({ cardId: r.cardId, set: r.set, to: r.to });
    else conflicts.push({ cardId: r.cardId, set: r.set, expect: r.expect, found, to: r.to });
  }
  return { safe, conflicts };
}

/** Human-facing summary of what a plan will do. Copy lives with the logic so the count in the
 *  toast and the count in the transaction cannot diverge. */
export function describePlan(plan) {
  const n = plan.changes.length;
  if (!n) return 'Nothing to change';
  const noun = n === 1 ? 'card' : 'cards';
  if (plan.op === 'add1') return `Added 1 to ${n} ${noun}`;
  if (plan.op === 'ensure1') return `Marked ${n} ${noun} as owned`;
  return `Removed 1 from ${n} ${noun}`;
}
