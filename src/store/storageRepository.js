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
 * Statements removing `qty` copies of an owned row, taking from Unfiled first and then from the
 * fullest container, and deleting any allocation that reaches zero (CHECK forbids a zero row, and
 * a copy that is nowhere is the state this model exists to prevent).
 *
 * `placements` is [{ id, container_id, qty, is_system }] for that owned row, already read by the
 * caller inside its transaction - this function is pure so the ordering is testable without a
 * database.
 */
export function planRemoval(placements, qty) {
  let remaining = qty;
  const taken = [];
  // Unfiled first because it is unambiguous - those copies are in no stated place. Then the
  // fullest container, deterministically, so the same input always produces the same plan.
  const order = [...placements].sort((a, b) => (b.is_system ? 1 : 0) - (a.is_system ? 1 : 0) || b.qty - a.qty || String(a.id).localeCompare(String(b.id)));
  for (const p of order) {
    if (remaining <= 0) break;
    const take = Math.min(p.qty, remaining);
    if (take > 0) { taken.push({ id: p.id, take, left: p.qty - take }); remaining -= take; }
  }
  return { taken, shortfall: remaining };
}

/** Statements for a plan produced by planRemoval. */
export function removalStatements(plan, now = nowIso()) {
  return plan.taken.map(({ id, left }) => (left > 0
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
