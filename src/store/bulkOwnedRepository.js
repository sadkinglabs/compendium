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
import {
  clearAllocationsStatements, placeUnfiledByKeyStatements, takeUnfiledByKeyStatements,
  assertEqualityStatements, planGlobalRemoval, removalStatements, StorageConflict,
} from './storageRepository.js';

// SQLite has a bound-parameter ceiling and a selection can be arbitrarily large.
const CHUNK = 400;

export function createBulkOwnedCommands({ exclusive, query, tx, notify, activeProfileId }) {
  /** Current rows for exactly the ones we are about to touch: `{ id, qty }` by UI bucket key.
   *  The id is not decoration - a decrease has to find the row's PLACES, and they are keyed by it. */
  async function readRows(pid, targets) {
    const map = new Map();
    for (let i = 0; i < targets.length; i += CHUNK) {
      const slice = targets.slice(i, i + CHUNK);
      const rows = await query(
        `SELECT id, card_id, variant_slug, qty_owned FROM owned_cards
         WHERE profile_id=? AND (${slice.map(() => '(card_id=? AND variant_slug=?)').join(' OR ')});`,
        // TRANSLATED at the boundary. `t.set` is a UI bucket code ('' for uncategorised, or a
        // real set); storage keys are canonical. Reading with the raw bucket looked for a row
        // that no longer exists, so the read reported nothing owned and the write below then
        // created a legacy twin alongside the real row.
        [pid, ...slice.flatMap((t) => [t.cardId, canonicalPrinting(t.set, false)])]
      );
      // Keyed by the UI bucket the caller asked about, so the plan can look its own targets up.
      for (const r of rows) map.set(`${r.card_id}|${parsePrinting(r.variant_slug).set}`, { id: r.id, qty: r.qty_owned });
    }
    return map;
  }

  /** Quantities alone, for the two callers that only ever needed the number. */
  async function readQuantities(pid, targets) {
    return new Map([...(await readRows(pid, targets))].map(([k, v]) => [k, v.qty]));
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

  /** Every place held by a set of owned rows, chunked, as `Map<owned_card_id, placements[]>`.
   *  One query per chunk rather than one per row: a selection can be hundreds of cards, and the
   *  per-row read that reads well in a unit test is a few hundred round trips on a device. */
  async function readPlacementsFor(ids) {
    const map = new Map();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const rows = await query(
        `SELECT a.id, a.owned_card_id, a.container_id, a.qty, c.is_system
           FROM storage_allocations a JOIN storage_containers c ON c.id = a.container_id
          WHERE a.owned_card_id IN (${chunk.map(() => '?').join(',')});`, chunk);
      for (const r of rows) map.set(r.owned_card_id, [...(map.get(r.owned_card_id) || []), r]);
    }
    return map;
  }

  /**
   * The allocation half of a bulk plan, and the place sec 5's whole-command rejection lives.
   *
   * A mixed selection where some items are satisfiable and some are not FAILS WHOLE. A bulk
   * command that half-applies is worse than one that explains itself, so the conflicts are
   * collected across every change and thrown together - the caller gets the full list of items
   * and the containers holding their copies, not the first one that failed.
   *
   * Reaching ZERO is not a conflict, and that asymmetry is the model rather than an exception.
   * The wall exists because a quantity model cannot know WHICH physical copy left; when every
   * copy leaves, there is nothing to attribute and no guess to make. A partial decrease into
   * filed copies is ambiguous; total removal is not.
   */
  async function planPlaces(pid, changes, before, now) {
    const decreasing = changes.filter((c) => c.after < c.before && c.after > 0);
    const placements = await readPlacementsFor(decreasing.map((c) => before.get(`${c.cardId}|${c.set}`)?.id).filter(Boolean));

    const statements = [];
    const conflicts = [];
    for (const c of changes) {
      const row = before.get(`${c.cardId}|${c.set}`);
      const slug = canonicalPrinting(c.set, false);
      if (c.after > c.before) {
        // Key-resolved, not id-resolved: the row may not exist yet, and the upsert that creates
        // it is the statement immediately before this one in the same transaction.
        statements.push(...placeUnfiledByKeyStatements({ profileId: pid, cardId: c.cardId, variantSlug: slug, qty: c.after - c.before, now }));
      } else if (c.after === 0) {
        if (row) statements.push(...clearAllocationsStatements(row.id));
      } else {
        const plan = planGlobalRemoval(placements.get(row?.id) || [], c.before - c.after);
        if (plan.conflict) conflicts.push({ cardId: c.cardId, set: c.set, target: c.after, ...plan.conflict });
        else statements.push(...removalStatements(plan, now));
      }
    }
    if (conflicts.length) {
      const e = new StorageConflict(conflicts[0], 'bulkOwned');
      e.detail = { items: conflicts };
      e.message = `bulkOwned: ${conflicts.length} of ${changes.length} items hold copies outside Unfiled`;
      throw e;
    }
    return statements;
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
      const before = await readRows(pid, targets);
      const plan = planBulk(op, targets, (cardId, set) => before.get(`${cardId}|${set}`)?.qty || 0);
      if (!plan.changes.length) {
        return { confirmed: true, attempted: 0, changed: 0, unchanged: plan.unchanged, undo: null };
      }

      const now = nowIso();
      const places = await planPlaces(pid, plan.changes, before, now);
      await tx([
        ...plan.changes.map((c) => upsertStatement(pid, c, now)),
        ...places,
        // The whole command's equality, checked inside the transaction. Every statement above can
        // fail to match silently - a place that resolved no row, a removal Unfiled could not
        // cover - and a bulk write that half-holds the invariant is exactly what the transaction
        // boundary exists to prevent. This turns any such silence into a rollback.
        ...assertEqualityStatements(pid, plan.changes.map((c) => ({ cardId: c.cardId, variantSlug: canonicalPrinting(c.set, false) })), 'bulkOwned'),
      ]);
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
      // A restore that would have to take copies Unfiled does not hold is DROPPED here rather than
      // allowed to fail the transaction. The equality assertion below would otherwise turn one
      // unsatisfiable row into a total undo failure, and a per-row conflict already has a channel:
      // the row is left alone and the read-back classifies it exactly as it classifies a row the
      // user edited. The read is advisory - the SQL guard on qty_owned remains the authority.
      const rows = await readRows(pid, restores);
      const placements = await readPlacementsFor(restores.map((r) => rows.get(`${r.cardId}|${r.set}`)?.id).filter(Boolean));
      const applied = restores.filter((r) => {
        if (r.to >= r.expect) return true;
        const id = rows.get(`${r.cardId}|${r.set}`)?.id;
        return !planGlobalRemoval(placements.get(id) || [], r.expect - r.to).conflict;
      });
      if (!applied.length) {
        return { confirmed: true, attempted: restores.length, applied: 0, conflicts: restores.length };
      }

      // Conditional: the WHERE clause carries the guard, so the check and the write are one
      // statement and nothing can slip between them. The PLACES carry the same guard and run
      // FIRST, while the row still holds the value the guard names - after the owned UPDATE it
      // no longer would, and the two halves would disagree about whether the undo happened.
      await tx([
        ...applied.flatMap((r) => (r.to > r.expect
          ? placeUnfiledByKeyStatements({ profileId: pid, cardId: r.cardId, variantSlug: r.set, qty: r.to - r.expect, expectOwned: r.expect, now })
          : takeUnfiledByKeyStatements({ profileId: pid, cardId: r.cardId, variantSlug: r.set, qty: r.expect - r.to, expectOwned: r.expect, now }))),
        ...applied.map((r) => ([
          `UPDATE owned_cards SET qty_owned=?, updated_at=?
           WHERE profile_id=? AND card_id=? AND variant_slug=? AND qty_owned=?;`,
          [r.to, now, pid, r.cardId, r.set, r.expect],
        ])),
        ...assertEqualityStatements(pid, applied.map((r) => ({ cardId: r.cardId, variantSlug: r.set })), 'undoBulkOwned'),
      ]);
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
