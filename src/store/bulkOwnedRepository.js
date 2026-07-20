// Bulk ownership commands for Collection.
//
// ONE protocol for all three operations (add1 / ensure1 / remove1). add1 and remove1 could
// be expressed as atomic SQL deltas and would then need no barrier, but their undo still
// requires an authoritative before-value and a confirmed after-value - so bypassing the
// barrier would save almost nothing while creating a second persistence protocol to test and
// maintain. A ~65ms exclusive operation in a single-user UI is not meaningful contention.
//
// The whole command runs inside ONE exclusive holder, in this order:
//
//   capture profile -> exclusive admission -> authoritative read -> plan
//     -> one transaction -> authoritative read-back -> confirmed result + undo record
//     -> release -> one broadcast
//
// Nothing is broadcast and no Undo is offered until after confirmation. The barrier is what
// makes the authoritative read trustworthy: without it a per-row write can commit between
// the read and the transaction, and the transaction - atomic though it is - overwrites it.
//
// Device evidence for the transaction shape (Pixel 9 Pro XL, WebView 150.0.7871.46, real
// 486-row database): 400 upserts in one transaction 43.8ms, 1000 upserts 129.7ms, before-read
// 7.5ms, read-back 5.4ms. One transaction is the right boundary; batching would reintroduce
// the partial-failure problem the transaction exists to prevent.
import { query, tx } from './db.js';
import { activeProfileId } from './profileRepository.js';
import { withExclusiveCollectionWrites } from './collectionWrites.js';
import { planBulk, planUndo, classifyUndoOutcome } from './bulkPlan.js';
import { uuid, nowIso } from './ids.js';
import { notifyOwnedChanged } from './ownedRepository.js';

/** Read the current quantities for exactly the rows we are about to touch. Chunked because
 *  SQLite has a bound-parameter ceiling and a selection can be arbitrarily large. */
const CHUNK = 400;

async function readQuantities(pid, targets) {
  const map = new Map();
  for (let i = 0; i < targets.length; i += CHUNK) {
    const slice = targets.slice(i, i + CHUNK);
    const rows = await query(
      `SELECT card_id, variant_slug, qty_owned FROM owned_cards
       WHERE profile_id=? AND (${slice.map(() => '(card_id=? AND variant_slug=?)').join(' OR ')});`,
      [pid, ...slice.flatMap((t) => [t.cardId, t.set ?? ''])]
    );
    for (const r of rows) map.set(`${r.card_id}|${r.variant_slug}`, r.qty_owned);
  }
  return map;
}

/** Upsert one row to an ABSOLUTE quantity. Absolute (not a delta) because the plan was
 *  computed from an authoritative read under the barrier, and because undo needs a
 *  before/after pair that a delta cannot supply for ensure1. */
function upsertStatement(pid, change, now) {
  return [
    `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
     VALUES(?,?,?,?,?,0,'',?,?)
     ON CONFLICT(profile_id,card_id,variant_slug)
     DO UPDATE SET qty_owned=excluded.qty_owned, updated_at=excluded.updated_at;`,
    [uuid(), pid, change.cardId, change.set, change.after, now, now],
  ];
}

/**
 * Apply a bulk ownership operation.
 *
 * @param op       'add1' | 'ensure1' | 'remove1'
 * @param targets  [{ cardId, set }] - the snapshotted selection
 * @returns {
 *   changed, unchanged,          // counts, from the CONFIRMED read-back
 *   confirmed: boolean,          // false means the write may have landed but we cannot prove it
 *   undo: { profileId, restores } | null,   // null unless confirmed - never offer Undo otherwise
 * }
 * @throws if the barrier could not be achieved, or the transaction failed. Either way nothing
 *         was written and there is nothing to undo.
 */
export async function applyBulkOwned(op, targets) {
  // Captured OUTSIDE the barrier callback so the whole command is bound to the profile the
  // user was looking at, exactly as the per-row writes bind theirs.
  const pid = activeProfileId();
  const result = await withExclusiveCollectionWrites(async () => {
    const before = await readQuantities(pid, targets);
    const plan = planBulk(op, targets, (cardId, set) => before.get(`${cardId}|${set}`) || 0);
    if (!plan.changes.length) return { changed: 0, unchanged: plan.unchanged, confirmed: true, undo: null };

    const now = nowIso();
    await tx(plan.changes.map((c) => upsertStatement(pid, c, now)));

    // Authoritative read-back INSIDE the barrier. The confirmation is what the database says,
    // never what the plan intended.
    let after;
    try {
      after = await readQuantities(pid, plan.changes);
    } catch {
      // The write probably landed; we cannot prove it. Report unconfirmed and withhold Undo -
      // offering to reverse a write we cannot verify is worse than offering nothing.
      return { changed: plan.changes.length, unchanged: plan.unchanged, confirmed: false, undo: null };
    }
    const committed = plan.changes.filter((c) => (after.get(`${c.cardId}|${c.set}`) || 0) === c.after);
    const confirmed = committed.length === plan.changes.length;
    return {
      changed: committed.length,
      unchanged: plan.unchanged,
      confirmed,
      undo: confirmed ? { profileId: pid, ...planUndo(committed) } : null,
    };
  });
  // ONE broadcast, after the barrier released and only for work that actually landed.
  if (result.changed > 0) notifyOwnedChanged();
  return result;
}

/**
 * Reverse a bulk operation.
 *
 * The SQL guard is not redundant with the JavaScript barrier. The barrier coordinates this
 * process; the guard protects the persistence boundary itself, so a row is restored only
 * while it still holds the value the bulk write left there. Anything else - a quick-add, an
 * import, another bulk command - means the user has moved on, and that edit is preserved
 * rather than discarded by the undo meant to protect it.
 *
 * @returns { applied, conflicts } counts, from an authoritative read-back
 */
export async function undoBulkOwned(undoRecord) {
  if (!undoRecord?.restores?.length) return { applied: 0, conflicts: 0 };
  const pid = undoRecord.profileId;
  const result = await withExclusiveCollectionWrites(async () => {
    const now = nowIso();
    // Conditional: the WHERE clause carries the guard, so the check and the write are one
    // statement and nothing can slip between them.
    await tx(undoRecord.restores.map((r) => ([
      `UPDATE owned_cards SET qty_owned=?, updated_at=?
       WHERE profile_id=? AND card_id=? AND variant_slug=? AND qty_owned=?;`,
      [r.to, now, pid, r.cardId, r.set, r.expect],
    ])));
    const after = await readQuantities(pid, undoRecord.restores);
    return classifyUndoOutcome(undoRecord, (cardId, set) => after.get(`${cardId}|${set}`) || 0);
  });
  if (result.applied.length > 0) notifyOwnedChanged();
  return { applied: result.applied.length, conflicts: result.conflicts.length };
}
