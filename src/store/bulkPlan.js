import { normalizePrinting } from './printings.js';
// Planning and undo for Collection bulk writes.
//
// Two rules drive everything here, and both came out of review rather than intuition.
//
// 1. A PLAN CONTAINS ONLY ROWS THAT ACTUALLY CHANGE. "Ensure at least 1" over a card you
//    already own three of is a no-op, and a no-op must not appear in the plan. If it did, the
//    confirmation would over-report ("changed 42 cards" when it changed 9) and, worse, undo
//    would have a before/after pair for a row it never touched.
//
// 2. UNDO IS NOT AN INVERSE DELTA, AND ITS GUARD IS NOT A PRE-CHECK. It stores each row's
//    before AND committed-after value, and the restore statement is CONDITIONAL - it may
//    touch a row only while that row still holds the committed-after value. An inverse delta
//    cannot express "Ensure at least 1" (it does not know which rows it actually raised), and
//    checking-then-writing would leave a window in which another edit lands and gets
//    discarded by the very guard meant to protect it. Conflicts are therefore reported from an
//    authoritative read-back AFTER the transaction, never from a read before it.
//
// Neither rule is sufficient alone. Both assume the caller holds the exclusive Collection
// write barrier (`withExclusiveCollectionWrites`) across authoritative read, plan,
// transaction and confirmation - otherwise a per-row write can commit between the read and
// the transaction, and an atomic bulk write still silently overwrites it.
//
// Pure and DOM-free, and it never touches the database: quantities arrive through callbacks
// so the whole thing is testable without a backend.

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
    const set = normalizePrinting(t.set ?? t.variant_slug);
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
 * Turn a COMMITTED, CONFIRMED plan into an undo record.
 *
 * Only ever call this once the whole transaction has committed and been authoritatively
 * confirmed. If the transaction failed there is nothing to undo; if confirmation failed the
 * caller must report "unconfirmed" and withhold Undo entirely, because offering to reverse a
 * write we cannot prove happened is worse than offering nothing.
 *
 * `expect` is what the write left in the row. It is the guard the restore is conditional on,
 * not merely a record of intent.
 */
export function planUndo(committedChanges) {
  return {
    restores: (committedChanges || []).map((c) => ({
      cardId: c.cardId, set: c.set, expect: c.after, to: c.before,
    })),
  };
}

/**
 * Classify an undo AFTER its conditional transaction has run, from an authoritative read-back.
 *
 * The conflict check cannot live before the write. Classifying rows from a pre-read and then
 * writing them is read-then-write: another edit can land in between, and the undo would
 * discard exactly the edit the check exists to protect. So the guard belongs in the statement
 * (restore only WHERE the quantity still equals `expect`), and this function reports what
 * actually happened by comparing the read-back against the intended value.
 *
 * @param undoRecord  from planUndo
 * @param qtyAfterOf  (cardId, set) => quantity read back AFTER the restore transaction
 * @returns { applied: [{cardId,set,to}], conflicts: [{cardId,set,expect,found,to}] }
 */
export function classifyUndoOutcome(undoRecord, qtyAfterOf) {
  const applied = [];
  const conflicts = [];
  for (const r of (undoRecord?.restores) || []) {
    const found = Number(qtyAfterOf(r.cardId, r.set)) || 0;
    // The guarded statement either restored the row (it now holds `to`) or declined to touch
    // it. A row that reads back as `to` is restored regardless of how it got there.
    if (found === r.to) applied.push({ cardId: r.cardId, set: r.set, to: r.to });
    else conflicts.push({ cardId: r.cardId, set: r.set, expect: r.expect, found, to: r.to });
  }
  return { applied, conflicts };
}

/**
 * Structured counts for a plan. Deliberately NOT prose: past-tense copy ("Added 1 to 42
 * cards") must be formed from a confirmed repository result, never from a plan, or a caller
 * can announce durable work that has not happened yet.
 */
export function summarizePlan(plan) {
  return { op: plan.op, changed: plan.changes.length, unchanged: plan.unchanged };
}
