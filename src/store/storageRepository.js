// Storage - the transactional core (docs/proposals/collection-storage.md).
//
// THE MODEL. Allocations ARE the ownership. A copy is never claimed against a separate total, it is
// MOVED between places, and "Unfiled" is a place like any other. `owned_cards.qty_owned` stays a
// real materialised column - every reader keeps reading it - but it is the SUM this module
// maintains, not a second number that can drift from it. After any operation:
//
//     qty_owned = SUM(storage_allocations.qty for that owned row)
//
// THIS MODULE ACQUIRES NO COORDINATION, and that is a hard rule rather than a style choice. The
// interactive steppers already run INSIDE the per-row write queue: OwnedControl enqueues on the
// collector-item key and calls the repository from within that callback, so the write is ADMITTED
// by the time the callback runs. A core that asked for the exclusive barrier there would wait for
// admitted work to drain - including itself - and every ownership tap would hang until the timeout.
//
// So the tiers are:
//   - interactive, one collector item -> the caller's existing enqueueWrite chain
//   - multi-item or profile-wide      -> withExclusiveCollectionWrites around the core
//   - boot                            -> its own transaction, no interactive barrier
//
// Everything here returns STATEMENTS rather than executing them, so a caller can compose them into
// the transaction it already has. That is what lets seven existing ownership writers route through
// one place without any of them giving up their own atomicity.
import { uuid, nowIso } from './ids.js';
import { SYSTEM_KIND, UNFILED_NAME, DEFAULT_COLOUR } from './storageVocabulary.js';

/** The Unfiled container for a profile, or null. Read-only; callers decide what to do about it. */
export async function unfiledContainerId(query, profileId) {
  const rows = await query('SELECT id FROM storage_containers WHERE profile_id=? AND is_system=1;', [profileId]);
  return rows[0]?.id || null;
}

/**
 * Statements creating a profile's Unfiled container. Every profile has exactly one, always - the
 * partial unique index guarantees AT MOST one, and calling this at every creation path is what
 * guarantees AT LEAST one. sort_order -1 keeps it pinned above user containers.
 */
export function createUnfiledStatements(profileId, id = uuid(), now = nowIso()) {
  return [[
    `INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at)
     VALUES(?,?,?,?,'',?,-1,1,?,?);`,
    [id, profileId, SYSTEM_KIND, UNFILED_NAME, DEFAULT_COLOUR, now, now],
  ]];
}

/**
 * Statements placing `qty` copies of an owned row into a container, merging with whatever is
 * already there. Paired with a matching change to qty_owned by the caller - never on its own.
 */
export function placeStatements({ profileId, containerId, ownedCardId, qty, now = nowIso() }) {
  if (!(qty > 0)) return [];
  return [[
    `INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(container_id,owned_card_id) DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at;`,
    [uuid(), profileId, containerId, ownedCardId, qty, now, now],
  ]];
}

/**
 * Plan a GLOBAL removal - the count stepper, bulk Adjust, bulk Set. It takes from **Unfiled only**.
 *
 * There is deliberately no fallback to another container, and this is the single most important
 * rule in the module. An earlier version of this function took from Unfiled and then from the
 * fullest container, which is the "drain and guess" behaviour the whole model exists to remove: a
 * quantity model cannot know which physical copy left, so a global minus that reaches into a binder
 * is the app inventing a fact about the user's shelf. Filed copies are removed where they live.
 *
 * Returns either a plan or a CONFLICT. A conflict produces no statements at all - the caller shows
 * the user where the copies actually are, and the write does not happen.
 */
export function planGlobalRemoval(placements, qty) {
  const unfiled = placements.find((p) => p.is_system);
  const available = unfiled?.qty || 0;
  if (qty > available) {
    return {
      conflict: {
        requested: qty,
        unfiled: available,
        // What the caller needs to name the places rather than say "cannot".
        filed: placements.filter((p) => !p.is_system).map((p) => ({ container_id: p.container_id, qty: p.qty })),
      },
      taken: [],
    };
  }
  return { conflict: null, taken: qty > 0 ? [{ id: unfiled.id, take: qty, left: available - qty }] : [] };
}

/**
 * Plan a removal from ONE NAMED container - removing a copy from inside the place it lives, which
 * is unambiguous and needs no attribution. Over-removal is a conflict, never a silent clamp.
 */
export function planPlaceRemoval(placement, qty) {
  const have = placement?.qty || 0;
  if (!placement || qty > have) return { conflict: { requested: qty, available: have }, taken: [] };
  return { conflict: null, taken: qty > 0 ? [{ id: placement.id, take: qty, left: have - qty }] : [] };
}

/**
 * Statements for a plan from either planner. A conflict yields NOTHING - a rejected removal must
 * not half-apply. An allocation reaching zero is DELETED rather than left at 0: CHECK (qty > 0)
 * forbids the row, and a zero-quantity place is a copy that is nowhere.
 */
export function removalStatements(plan, now = nowIso()) {
  if (!plan || plan.conflict) return [];
  return (plan.taken || []).map(({ id, left }) => (left > 0
    ? ['UPDATE storage_allocations SET qty=?, updated_at=? WHERE id=?;', [left, now, id]]
    : ['DELETE FROM storage_allocations WHERE id=?;', [id]]));
}

/**
 * Statements clearing every allocation for an owned row, for the paths that DELETE the row itself
 * (a stepper reaching zero, bulk Set-to-0, an import reconciling a row away).
 *
 * Without this the delete fails outright: allocations reference owned rows with ON DELETE RESTRICT,
 * deliberately, so a user's filing can never be silently discarded as a side effect of a count
 * reaching zero. RESTRICT turns that from a silent loss into a loud one - which is only an
 * improvement if every legitimate delete clears its allocations first. This is that.
 */
export function clearAllocationsStatements(ownedCardId) {
  return [['DELETE FROM storage_allocations WHERE owned_card_id=?;', [ownedCardId]]];
}

/** As above, for many owned rows at once (bulk Set-to-0). */
export function clearAllocationsForManyStatements(ownedCardIds) {
  const ids = [...new Set(ownedCardIds.filter(Boolean))];
  if (!ids.length) return [];
  return [[`DELETE FROM storage_allocations WHERE owned_card_id IN (${ids.map(() => '?').join(',')});`, ids]];
}
