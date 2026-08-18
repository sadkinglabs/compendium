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

/* ---------------- routing the ownership writers ---------------- */
//
// Everything above is the vocabulary; everything below is what makes the equality hold when an
// ordinary writer moves qty_owned. Increment 1 shipped the vocabulary and wired only the DELETE
// paths, so an increase raised the count while its Unfiled allocation stood still - the defining
// equality broken by the first + tap. These are the pieces the seven ownership writers compose.

/**
 * A decrease that cannot be satisfied from Unfiled. NOT a failure so much as a question the app
 * may not answer on the user's behalf: the copies are filed somewhere, and a quantity model cannot
 * know which physical copy left. Carries the structured detail §5 requires - requested, what
 * Unfiled actually holds, and the containers holding the rest - so a caller can name the places
 * rather than say "cannot".
 *
 * Nothing renders this yet; the Storage surfaces land in increment 3. Until then it fails the
 * write closed, which is the correct behaviour with or without a sheet to explain it.
 */
export class StorageConflict extends Error {
  constructor(detail, action = 'storage') {
    super(`${action}: ${detail?.requested} copies requested but Unfiled holds ${detail?.unfiled}`);
    this.name = 'StorageConflict';
    this.detail = detail;
  }
}

/** Every place one owned row's copies are, with the flag the global planner sorts Unfiled by. */
export async function readPlacements(query, ownedCardId) {
  return query(
    `SELECT a.id, a.container_id, a.qty, c.is_system
       FROM storage_allocations a JOIN storage_containers c ON c.id = a.container_id
      WHERE a.owned_card_id = ?;`,
    [ownedCardId],
  );
}

/**
 * Statements taking one owned row from `before` copies to `after`, places included.
 *
 * An INCREASE puts the new copies in Unfiled and touches no other container: the user's filing is
 * a fact about their shelf, and acquiring a copy does not put it in a binder. A DECREASE goes
 * through planGlobalRemoval, which takes from Unfiled and refuses rather than reaching further.
 *
 * ASYNC because a decrease has to read the places first, and only a decrease does. The increase
 * path needs the Unfiled id alone, so the common interactive + tap costs one small indexed read.
 */
export async function reconcileOwnedStatements({ query, profileId, ownedCardId, before, after, action = 'storage', now = nowIso() }) {
  if (after === before) return [];
  if (after > before) {
    const containerId = await unfiledContainerId(query, profileId);
    // Fail closed. Every profile has an Unfiled container - the creation paths guarantee at least
    // one and the partial unique index guarantees at most one - so its absence means the backfill
    // did not run on this profile, and placing copies nowhere would be worse than refusing.
    if (!containerId) throw new Error(`${action}: profile ${profileId} has no Unfiled container.`);
    return placeStatements({ profileId, containerId, ownedCardId, qty: after - before, now });
  }
  const plan = planGlobalRemoval(await readPlacements(query, ownedCardId), before - after);
  if (plan.conflict) throw new StorageConflict(plan.conflict, action);
  return removalStatements(plan, now);
}

/**
 * Statements placing `qty` copies into Unfiled, resolving BOTH the owned row and the container in
 * SQL rather than in JavaScript.
 *
 * This exists for the read-free upsert writers - the scanner's addOwnedCopies, the resolved import
 * - whose whole point is that they never read before they write, so two overlapping increments
 * cannot lose each other. Resolving the owned row id in JS would reintroduce exactly the
 * read-modify-write those writers were built to avoid. The row is guaranteed to exist because the
 * upsert that creates it is the statement immediately before this one in the same transaction.
 *
 * The WHERE clause is not optional: SQLite cannot tell an upsert's ON from a join's ON in an
 * INSERT ... SELECT without one.
 */
export function placeUnfiledByKeyStatements({ profileId, cardId, variantSlug, qty, now = nowIso() }) {
  if (!(qty > 0)) return [];
  return [[
    `INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at)
     SELECT ?, o.profile_id, c.id, o.id, ?, ?, ?
       FROM owned_cards o JOIN storage_containers c ON c.profile_id = o.profile_id AND c.is_system = 1
      WHERE o.profile_id=? AND o.card_id=? AND o.variant_slug=?
     ON CONFLICT(container_id,owned_card_id) DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at;`,
    [uuid(), qty, now, now, profileId, cardId, variantSlug],
  ]];
}

/**
 * A guard for the statement above, in the same transaction, for the rows it just touched.
 *
 * A SELECT-sourced insert that matches nothing inserts nothing and reports success - the precise
 * shape of the silence this whole exercise is about. SQLite has no bare "fail if" outside a
 * trigger, so this provokes a constraint violation on a row that cannot legally exist: qty 0 fails
 * CHECK (qty > 0), and the sentinel container fails the container foreign key. Whichever fires
 * first rolls the whole transaction back. The SELECT yields nothing at all - and so provokes
 * nothing - unless the equality is already broken for one of the named rows.
 */
export function assertEqualityStatements(profileId, keys, action = 'storage') {
  if (!keys?.length) return [];
  const pairs = keys.map(() => '(o.card_id=? AND o.variant_slug=?)').join(' OR ');
  return [[
    `INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at)
     SELECT ?, o.profile_id, '${action}-equality-violated', o.id, 0, '', ''
       FROM owned_cards o
      WHERE o.profile_id=? AND (${pairs})
        AND o.qty_owned <> COALESCE((SELECT SUM(a.qty) FROM storage_allocations a WHERE a.owned_card_id=o.id), 0);`,
    [uuid(), profileId, ...keys.flatMap((k) => [k.cardId, k.variantSlug])],
  ]];
}
