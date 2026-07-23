// Turn a bulk-write REJECTION into an honest user message + how the caller should treat the
// selection. The load-bearing rule: an INDETERMINATE write (a BulkWriteError with
// writeState==='unknown' - on web the transaction applied and THEN persistence rejected) is NEVER
// reported as a definite failure or a success, because a blind retry could double a quantity. Used
// only on the catch path; a resolved promise means success.
//
// PURE and tiny on purpose, so the "unknown is never definite" property is a unit test, not a hope.
export function bulkWriteFailure(error) {
  const indeterminate = !!(error && error.name === 'BulkWriteError' && error.writeState === 'unknown');
  return {
    indeterminate,
    tone: indeterminate ? 'warn' : 'danger',
    // Indeterminate: point at the refreshed counts, never invite a retry. Definite (prewrite/none, or
    // any non-bulk error): nothing was written, so a plain failure + safe retry.
    copy: indeterminate
      ? "Couldn't confirm the update - check the refreshed counts before trying again."
      : "Couldn't update those cards.",
    // Keep the selection ONLY on a definite failure (nothing was written, retry is safe). On an
    // indeterminate write the selection must be cleared so it cannot read as a retry invitation.
    keepSelection: !indeterminate,
  };
}
