// Turn a bulk-write REJECTION into an honest user message + how the caller should treat the
// selection. The load-bearing rule: an INDETERMINATE write (a BulkWriteError with
// writeState==='unknown' - on web the transaction applied and THEN persistence rejected) is NEVER
// reported as a definite failure or a success, because a blind retry could double a quantity. Used
// only on the catch path; a resolved promise means success.
//
// A REFUSED write is not a FAILED one, and the second rule this module carries. A storage conflict
// is the app declining to guess which physical copy left a binder - the model working as designed -
// and "Couldn't update those cards" reports it as a malfunction, teaching the user to distrust a
// wall that is protecting their filing. That is the same distinction ownedStepMessage draws for the
// single-card stepper; the bulk commands had no equivalent until the zero-target wall landed
// (owner ruling 2026-08-19), so a Set-to-0 or Adjust-down over filed copies said nothing useful.
// The bulk wall deliberately does NOT name containers the way the stepper's does: one selection can
// span a dozen places, and a toast enumerating them is noise rather than a route to the fix.
//
// PURE and tiny on purpose, so the "unknown is never definite" property is a unit test, not a hope.
export function bulkWriteFailure(error) {
  const indeterminate = !!(error && error.name === 'BulkWriteError' && error.writeState === 'unknown');
  // Only a DEFINITE refusal can be described this way. An indeterminate write may have landed, so
  // it keeps its own copy whatever else the error carries.
  const filed = indeterminate ? 0 : (error?.storageConflict?.items?.length || 0);
  return {
    indeterminate,
    filed,
    tone: indeterminate ? 'warn' : 'danger',
    // Indeterminate: point at the refreshed counts, never invite a retry. Refused: say what is in
    // the way and how to clear it. Definite (prewrite/none, or any non-bulk error): nothing was
    // written, so a plain failure + safe retry.
    copy: indeterminate
      ? "Couldn't confirm the update - check the refreshed counts before trying again."
      : filed
        ? `${filed} ${filed === 1 ? 'printing has' : 'printings have'} copies filed away - return them to Unfiled first.`
        : "Couldn't update those cards.",
    // Keep the selection ONLY on a definite failure (nothing was written, retry is safe). On an
    // indeterminate write the selection must be cleared so it cannot read as a retry invitation.
    keepSelection: !indeterminate,
  };
}
