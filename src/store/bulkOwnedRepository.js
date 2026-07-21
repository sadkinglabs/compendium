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
// THE RESULT CONTRACT. `confirmed` is the only thing a caller may key success off.
//   - confirmed: true   counts are authoritative, from the read-back. Undo may be offered.
//   - confirmed: false  the transaction resolved but we could not verify what it left behind.
//                       `changed`/`unchanged` are NULL - not zero, and not the plan's intent,
//                       because we do not know them. Undo is withheld: offering to reverse a
//                       write we cannot describe is worse than offering nothing. `attempted`
//                       says how many rows the transaction carried and is the only quantity
//                       available.
//   - throws            the barrier was not achieved, or the transaction failed. Nothing was
//                       written and there is nothing to undo.
//
// The broadcast is a CACHE INVALIDATION, not a success announcement. It fires once whenever a
// transaction actually executed - including the unconfirmed case, because persisted state may
// well have changed and stale UI would be worse than a redundant refresh. User-facing copy
// must key off `confirmed`; see bulkResultMessage.js.
//
// Dependencies are injected so the same scenario can run against a pass-through barrier and
// against the real one. That counterfactual is AUTOMATED (see the test file) rather than a
// one-off manual mutation, because twice in this increment a test passed while proving
// nothing: once when a deadlock produced the same ordering as a working barrier, and once
// when a friendly scheduler meant the dangerous interleaving never occurred at all.
//
// Device evidence for the transaction shape (Pixel 9 Pro XL, WebView 150.0.7871.46, real
// 486-row database): 400 upserts in one transaction 43.8ms, 1000 upserts 129.7ms, before-read
// 7.5ms, read-back 5.4ms. One transaction is the right boundary; batching would reintroduce
// the partial-failure problem the transaction exists to prevent.
import { query as dbQuery, tx as dbTx } from './db.js';
import { activeProfileId as realActiveProfileId } from './profileRepository.js';
import { withExclusiveCollectionWrites } from './collectionWrites.js';
import { planBulk, planUndo, classifyUndoOutcome } from './bulkPlan.js';
import { uuid, nowIso } from './ids.js';
import { canonicalPrinting, parsePrinting } from './printings.js';
import { notifyOwnedChanged } from './ownedRepository.js';

// SQLite has a bound-parameter ceiling and a selection can be arbitrarily large.
const CHUNK = 400;

export function createBulkOwnedCommands({ exclusive, query, tx, notify, activeProfileId }) {
  /** Current quantities for exactly the rows we are about to touch. */
  async function readQuantities(pid, targets) {
    const map = new Map();
    for (let i = 0; i < targets.length; i += CHUNK) {
      const slice = targets.slice(i, i + CHUNK);
      const rows = await query(
        `SELECT card_id, variant_slug, qty_owned FROM owned_cards
         WHERE profile_id=? AND (${slice.map(() => '(card_id=? AND variant_slug=?)').join(' OR ')});`,
        // TRANSLATED at the boundary. `t.set` is a UI bucket code ('' for uncategorised, or a
        // real set); storage keys are canonical. Reading with the raw bucket looked for a row
        // that no longer exists, so the read reported nothing owned and the write below then
        // created a legacy twin alongside the real row.
        [pid, ...slice.flatMap((t) => [t.cardId, canonicalPrinting(t.set, false)])]
      );
      // Keyed by the UI bucket the caller asked about, so the plan can look its own targets up.
      for (const r of rows) map.set(`${r.card_id}|${parsePrinting(r.variant_slug).set}`, r.qty_owned);
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
      // Canonical on the way out, for the same reason the read translates on the way in.
      [uuid(), pid, change.cardId, canonicalPrinting(change.set, false), change.after, now, now],
    ];
  }

  /**
   * Apply a bulk ownership operation.
   * @param op       'add1' | 'ensure1' | 'remove1'
   * @param targets  [{ cardId, set }] - the snapshotted selection
   */
  async function applyBulkOwned(op, targets) {
    // Captured OUTSIDE the barrier callback so the command is bound to the profile the user
    // was looking at, exactly as the per-row writes bind theirs.
    const pid = activeProfileId();
    let ranTransaction = false;
    const result = await exclusive(async () => {
      const before = await readQuantities(pid, targets);
      const plan = planBulk(op, targets, (cardId, set) => before.get(`${cardId}|${set}`) || 0);
      if (!plan.changes.length) {
        return { confirmed: true, attempted: 0, changed: 0, unchanged: plan.unchanged, undo: null };
      }

      const now = nowIso();
      await tx(plan.changes.map((c) => upsertStatement(pid, c, now)));
      ranTransaction = true;   // from here the database may differ, confirmed or not

      const unconfirmed = {
        confirmed: false, attempted: plan.changes.length, changed: null, unchanged: null, undo: null,
      };

      let after;
      try {
        after = await readQuantities(pid, plan.changes);
      } catch {
        return unconfirmed;   // the write likely landed; we cannot describe it, so we do not
      }
      // The confirmation is what the database says, never what the plan intended. One
      // mismatched row means persisted state is not what we modelled, so the before/after
      // pairs are not trustworthy as an undo record either.
      const allMatch = plan.changes.every((c) => (after.get(`${c.cardId}|${c.set}`) || 0) === c.after);
      if (!allMatch) return unconfirmed;

      return {
        confirmed: true,
        attempted: plan.changes.length,
        changed: plan.changes.length,
        unchanged: plan.unchanged,
        undo: { profileId: pid, ...planUndo(plan.changes) },
      };
    });
    if (ranTransaction) notify();   // cache invalidation, not a success announcement
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
   */
  async function undoBulkOwned(undoRecord) {
    const restores = undoRecord?.restores || [];
    if (!restores.length) return { confirmed: true, attempted: 0, applied: 0, conflicts: 0 };
    const pid = undoRecord.profileId;
    let ranTransaction = false;
    const result = await exclusive(async () => {
      const now = nowIso();
      // Conditional: the WHERE clause carries the guard, so the check and the write are one
      // statement and nothing can slip between them.
      await tx(restores.map((r) => ([
        `UPDATE owned_cards SET qty_owned=?, updated_at=?
         WHERE profile_id=? AND card_id=? AND variant_slug=? AND qty_owned=?;`,
        [r.to, now, pid, r.cardId, r.set, r.expect],
      ])));
      ranTransaction = true;

      let after;
      try {
        after = await readQuantities(pid, restores);
      } catch {
        // Some restores may have landed. We cannot say which, so we report neither.
        return { confirmed: false, attempted: restores.length, applied: null, conflicts: null };
      }
      const outcome = classifyUndoOutcome(undoRecord, (cardId, set) => after.get(`${cardId}|${set}`) || 0);
      return {
        confirmed: true,
        attempted: restores.length,
        applied: outcome.applied.length,
        conflicts: outcome.conflicts.length,
      };
    });
    if (ranTransaction) notify();
    return result;
  }

  return { applyBulkOwned, undoBulkOwned };
}

const production = createBulkOwnedCommands({
  exclusive: withExclusiveCollectionWrites,
  query: dbQuery,
  tx: dbTx,
  notify: notifyOwnedChanged,
  activeProfileId: realActiveProfileId,
});

export const applyBulkOwned = production.applyBulkOwned;
export const undoBulkOwned = production.undoBulkOwned;
