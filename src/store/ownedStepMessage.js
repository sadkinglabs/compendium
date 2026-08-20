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
// Naming the actual container needs a read (a conflict carries container ids, not names), so this
// function stays pure and takes an optional pre-resolved `places` phrase - the caller resolves it
// via storageDirectory.filedPlacesSummary and passes it in. With it, the wall names WHERE the copies
// are and points to the fix; without it (or if the read fails) it degrades to the plain WHAT + WHY.

/**
 * @param reason  'save-failed' | 'unconfirmed' | 'save-failed-unresolved'
 * @param cause   the rejection, when there was one
 * @param places  optional resolved phrase, e.g. "Beta binder (2), Bulk box (1)"
 * @returns { text, tone }
 */
export function stepFailureMessage(reason, cause, places = null) {
  if (reason === 'unconfirmed') {
    return { text: "Saved, but couldn't refresh - reopen to confirm", tone: 'danger' };
  }
  if (cause?.name === 'StorageConflict') {
    const filed = (cause.detail?.filed || []).reduce((n, f) => n + (Number(f.qty) || 0), 0);
    // The count comes from the conflict itself rather than from anything the UI tracks, so it
    // cannot disagree with the reason the write was refused.
    const head = filed > 0
      ? `${filed} ${filed === 1 ? 'copy is' : 'copies are'} filed`
      : 'those copies are filed';
    const where = places ? ` in ${places}` : ' away';
    const tail = reason === 'save-failed-unresolved'
      ? ' - return them to Unfiled to lower this, then reopen to confirm'
      : ' - return them to Unfiled to lower this';
    return { text: `${head}${where}${tail}`, tone: 'danger' };
  }
  return {
    text: reason === 'save-failed-unresolved'
      ? "Couldn't save, and couldn't check - reopen to confirm"
      : "Couldn't save; count restored",
    tone: 'danger',
  };
}
