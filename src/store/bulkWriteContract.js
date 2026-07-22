// The write-outcome contract shared by every bulk collection command (wanted paste, owned import).
//
// A web `tx()` commits sql.js and THEN awaits IndexedDB persistence, so a persist failure rejects
// AFTER the in-memory rows already changed. "Nothing was written" would be a lie, and a retry
// would double the write. So a rejection carries where it failed:
//
//   { phase: 'prewrite' | 'transaction', writeState: 'none' | 'unknown' }
//
//   - prewrite/none: the barrier timed out or validation threw BEFORE `tx()` - nothing ran, so
//     "Nothing was added" is safe and no cache is invalidated.
//   - transaction/unknown: `tx()` was invoked and rejected - the write may have landed. The
//     command invalidates the cache regardless, and the caller must reconcile and say "couldn't
//     confirm", never "nothing written", and never auto-retry.
//
// One definition, imported by both commands, so the two cannot drift on the field that carries
// the safety guarantee.

// 'prewrite' describes a validation/barrier failure more honestly than 'barrier', since a
// validation throw is also before any write. `writeState` is the safety-bearing field.
export function bulkWriteError(phase, writeState, message) {
  const e = new Error(message);
  e.name = 'BulkWriteError';
  e.phase = phase;
  e.writeState = writeState;
  return e;
}

/** Per-item quantity ceiling (§7.5 input bounds). A single line may not want/own more than this. */
export const MAX_ITEM_QTY = 999;
/** Per-batch item ceiling (§7.5). With MAX_ITEM_QTY this also makes merged totals safe by
 *  construction (2000 x 999 is far below Number.MAX_SAFE_INTEGER), so an overflow cannot arise. */
export const MAX_BATCH_ITEMS = 2000;
