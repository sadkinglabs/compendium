// What to tell the user when an optimistic ownership step does not land.
//
// It lives here, next to bulkResultMessage.js, for the reason that module gives: the two consumers
// (OwnedControl and useCollectionRefine) previously each carried their own copy of the same ternary,
// which is how two surfaces end up describing one outcome differently.
//
// THE DISTINCTION THIS EXISTS TO DRAW. A failed write and a REFUSED write are not the same event.
// "Couldn't save; count restored" is right for a disk error and wrong for a storage conflict: the
// app declined to guess which physical copy left, which is the model working as designed, and
// reporting it as a malfunction teaches the user to distrust a wall that is protecting them.
//
// Naming the actual container needs the Storage surfaces (increment 3) - a conflict carries
// container ids, not names, and resolving them here would mean a read inside a toast. So this says
// WHAT and WHY, and leaves WHERE to the sheet that can offer a route to it.

/**
 * @param reason  'save-failed' | 'unconfirmed' | 'save-failed-unresolved'
 * @param cause   the rejection, when there was one
 * @returns { text, tone }
 */
export function stepFailureMessage(reason, cause) {
  if (reason === 'unconfirmed') {
    return { text: "Saved, but couldn't refresh - reopen to confirm", tone: 'danger' };
  }
  if (cause?.name === 'StorageConflict') {
    const filed = (cause.detail?.filed || []).reduce((n, f) => n + (Number(f.qty) || 0), 0);
    // The count comes from the conflict itself rather than from anything the UI tracks, so it
    // cannot disagree with the reason the write was refused.
    const where = filed > 0
      ? `${filed} ${filed === 1 ? 'copy is' : 'copies are'} filed away`
      : 'those copies are filed away';
    return {
      text: reason === 'save-failed-unresolved'
        ? `${where} - remove them where they are stored, then reopen to confirm`
        : `${where} - remove them where they are stored`,
      tone: 'danger',
    };
  }
  return {
    text: reason === 'save-failed-unresolved'
      ? "Couldn't save, and couldn't check - reopen to confirm"
      : "Couldn't save; count restored",
    tone: 'danger',
  };
}
