// The Collection pillar's nav cache - extracted so it can be tested without a DOM.
//
// WHY IT EXISTS. The pillar is unmounted whenever a Codex detail or the scanner takes over,
// so without this cache Back would dump you at Overview instead of the set drill or open list
// you came from.
//
// WHY IT IS PROFILE-AWARE. It holds `listOpen`, a whole list row (id, name, kind). It used to
// be profile-agnostic, so: open profile A's list, switch to B, return to Collection, and A's
// list was restored under B - its name and entries rendered, and Export could hand them over.
// Writes had always refused a foreign list id; reads had not.
//
// The guard here is deliberately only HALF the fix. The repository also scopes every
// child-list read by joining `card_lists.profile_id`, so the boundary holds even if a stale
// id reaches it by some other path. A UI cache that polices itself is one refactor away from
// leaking, and a repository that trusts its caller is one bug away from the same.
export const FRESH_SESSION = {
  profileId: null,
  view: 'overview',
  listOpen: null,
  sheetCard: null,
  sheetSet: null,
  setDrill: null,
  q: '',
  filter: 'all',
  types: [],
  rarities: [],
  els: [],
  groupBy: 'none',
};

let session = { ...FRESH_SESSION };

/**
 * Reconcile the cache with the active profile and return it.
 *
 * On mismatch it is replaced WHOLESALE rather than having `listOpen` cleared. Clearing the
 * fields that look profile-owned is exactly how this class of bug survives: the next person
 * to add a field has to remember, and will not. Everything here belongs to one profile, so
 * everything goes.
 */
export function resetCollectionSessionFor(profileId) {
  if (session.profileId !== profileId) session = { ...FRESH_SESSION, profileId };
  return session;
}

/** The live cache. Only valid after resetCollectionSessionFor has run for this mount. */
export function collectionSession() {
  return session;
}

/** Test-only: forget everything, including which profile the cache belonged to. */
export function __resetCollectionSessionForTests() {
  session = { ...FRESH_SESSION };
}
