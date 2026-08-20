// One place that turns an ownership-step failure into a toast, so OwnedControl and useCollectionRefine
// speak with a single voice (the exact drift the message module was extracted to prevent).
//
// For a storage-decrease refusal - the "wall" you hit when you lower a count whose copies are filed -
// it resolves the filed containers to names FIRST, so the toast says WHERE the copies are: "3 copies
// are filed in Beta binder (2), Bulk box (1) - return them to Unfiled to lower this." The card sheet's
// Storage ledger, right below the count, is the route to do exactly that. A failed name read degrades
// gracefully to the plain WHAT + WHY.
import { toast } from '../feedback.js';
import { stepFailureMessage } from '../store/ownedStepMessage.js';
import { filedPlacesSummary } from '../store/storageDirectory.js';

export async function showStepFailure(reason, cause) {
  let places = null;
  if (cause?.name === 'StorageConflict' && cause?.detail?.filed?.length) {
    try { places = await filedPlacesSummary(cause.detail.filed); } catch { places = null; }
  }
  const m = stepFailureMessage(reason, cause, places || null);
  toast(m.text, { tone: m.tone });
}
