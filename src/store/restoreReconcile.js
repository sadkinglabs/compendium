// Startup reconciliation for an interrupted replacement - Increment 5 of
// docs/proposals/restore-semantics.md (Rev 4), the startup table in §3.
//
// replaceAll commits everything destructive in ONE transaction, but four things still happen
// after that commit: the active profile is reconciled, the Primary role is asserted, the
// recovery pointer is published, the journal row is retired. A process death anywhere in that
// window must be FINISHED at the next boot - and never concluded the other way. The journal
// row is the single durable fact that decides which, because it commits WITH the data:
//
//   no restore_pending row   the replacement did NOT commit. Whatever candidate file a dead
//                            attempt wrote is an orphan; sweep it. The previously published
//                            recovery point survives, because sweepOrphans keeps exactly what
//                            the pointer names.
//   restore_pending present  the replacement DID commit. Finish idempotently from the ids the
//                            row carries, and retire the row only once everything else holds.
//
// POSITION IS THE CONTRACT (asserted in bootOrder.test.mjs): this runs immediately after
// openDatabase(), before the catalog seed, the art cache, the ledger canonicalisation and
// initProfiles(). The canonicalisation converts EVERY profile and initProfiles() makes one
// active, so any profile read or write ahead of reconciliation silently resurrects the
// pre-restore profile - and the symptom only appears one boot later.
//
// NEVER THROWS, NEVER BLOCKS BOOT. The data is already committed. A reconciliation failure is
// logged, the journal row is LEFT in place so the next boot retries the finish, and the user
// keeps an app whose data is intact. Locking them out to complete bookkeeping would invert
// the risk this whole design exists to manage.
import { query, run } from './db.js';
import { switchProfile, setPrimary } from './profileRepository.js';
import { promote, sweepOrphans } from './recoveryStore.js';
import { RESTORE_PENDING_KEY } from './replacePlan.js';

/**
 * Finish or abandon an interrupted replacement. Resolves (never rejects) with one of:
 *   { status: 'idle', swept }                       no journal - nothing committed; orphans swept
 *   { status: 'finished', activeProfileId, swept }  journal found and retired; the finish holds
 *   { status: 'deferred', error }                   the finish failed; the journal row remains
 */
export async function reconcileRestore() {
  try {
    const rows = await query('SELECT value FROM catalog_meta WHERE key=?;', [RESTORE_PENDING_KEY]);

    if (!rows.length) {
      // The replacement did not commit, so nothing here may touch a profile: the device state
      // IS the current state. Only housekeeping remains - a crashed attempt's candidate file
      // is an orphan by definition, and the sweep spares the published point.
      const swept = await sweepOrphans();
      return { status: 'idle', swept };
    }

    // The replacement committed. Every step is idempotent, so a crash between any two of them
    // simply replays this path at the next boot:
    //   setPrimary     clear-all/set-one in one tx - the same result on every run
    //   switchProfile  the repository's own boundary (never a direct Preferences write), sets
    //                  the in-memory id and Preferences together
    //   promote        re-publishing the already-published id writes the same pointer row and
    //                  skips the previous-file delete (prev.id === id), so a mid-publish crash
    //                  cannot delete the previous point twice
    // The journal row is retired LAST: it is the retry ticket, and clearing it before the
    // pointer commits could strand a finished replacement with no published recovery point.
    const { candidateId, intendedActiveId, intendedPrimaryId } = JSON.parse(rows[0].value);
    await setPrimary(intendedPrimaryId);
    await switchProfile(intendedActiveId);
    await promote(candidateId);
    await run('DELETE FROM catalog_meta WHERE key=?;', [RESTORE_PENDING_KEY]);

    // Housekeeping only, and only now: before promote the candidate is unnamed by the pointer
    // and a sweep would delete the recovery point itself. A sweep failure must not make a
    // finished replacement look failed.
    let swept = [];
    try { swept = await sweepOrphans(); } catch { /* the next boot's sweep collects it */ }
    return { status: 'finished', activeProfileId: intendedActiveId, swept };
  } catch (e) {
    // Deliberately swallowed: the journal row is still in place, so the next boot retries.
    console.error('restore reconciliation failed - will retry at next boot', e);
    return { status: 'deferred', error: String(e?.message || e) };
  }
}
