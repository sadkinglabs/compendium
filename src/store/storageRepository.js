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
import { assertCanonicalSlug } from './printings.js';

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
 * already there. Paired either with the matching qty_owned increase or with a removal from another
 * place in the same transaction - never issued alone.
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
 * Is a TOTAL removal - a decrease whose target is zero - refused, and why? Returns the same
 * conflict shape planGlobalRemoval returns, or null when the row may legitimately be emptied.
 *
 * OWNER RULING, 2026-08-19. This used to be an unconditional fast path: a target of zero cleared
 * every allocation and deleted the row however the copies were filed, on the argument that total
 * removal needs no attribution - when every copy leaves there is nothing to guess. That argument
 * was about the COUNT and forgot the FILING. Where a copy lives is user data in its own right: an
 * accidental last-copy minus silently discarded the record that three copies were in the Beta
 * binder, and re-adding them landed everything in Unfiled with no way back. So the rule is now the
 * one the rest of the model already follows - any decrease that would eat into filed copies is
 * refused and names the places - and zero is not exempt from it.
 *
 * The asymmetry this closes was already visible in the code: clearing a count to zero on a row that
 * also carried a WANT went through planGlobalRemoval and refused, while the same gesture on a row
 * without a want deleted the row and its filing outright. One of those two was wrong.
 *
 * A row whose copies are ALL in Unfiled, or which has no places at all, is emptied exactly as
 * before - there is nothing filed to lose. This says nothing about the EXEMPT writers (import and
 * restore reconciliation, boot canonicalisation, triage's cleanup of already-drained rows); they do
 * not ask, because they either replace the whole ledger authoritatively or move the places with the
 * copies rather than discarding them.
 *
 * Takes no quantity: a total removal removes whatever is there, so the placements themselves are
 * the authoritative statement of how many copies would have to leave.
 */
export function totalRemovalConflict(placements = []) {
  const filed = placements.filter((p) => !p.is_system);
  if (!filed.length) return null;
  return {
    requested: placements.reduce((n, p) => n + (Number(p.qty) || 0), 0),
    unfiled: placements.find((p) => p.is_system)?.qty || 0,
    // The same field the partial-decrease conflict carries, so one message function serves both.
    filed: filed.map((p) => ({ container_id: p.container_id, qty: p.qty })),
  };
}

/**
 * WILL a decrease to `target` be refused? The question the OPTIMISTIC steppers ask BEFORE they
 * paint a provisional count - and nothing else. It is not a gate on the write.
 *
 * WHY IT EXISTS. A stepper shows the new count the instant you tap and reconciles against the store
 * when the write lands. That is right for a write that succeeds and wrong for one the wall refuses:
 * the count painted 1 -> 0, the refusal toast arrived, and the reconcile snapped it back to 1. The
 * user saw the app do the thing and then undo it, which reads as a bug in a wall that is working.
 * Asking here lets a tap that is going to be refused simply not paint - the toast is then the only
 * thing that happens, and nothing moves.
 *
 * WHY ONE PREDICATE COVERS BOTH PLANNERS. Since the zero exemption was closed (owner ruling,
 * 2026-08-19 - see totalRemovalConflict) the refusal rule is uniform, and the algebra says so.
 * By the defining equality a row's copies are its placements, so `total = filed + unfiled`.
 * planGlobalRemoval refuses when `before - target > unfiled`, i.e. `before - target > before - filed`,
 * i.e. `target < filed`. totalRemovalConflict refuses when `filed > 0`, which at `target = 0` is the
 * same inequality. One line states both.
 *
 * WHAT IT IS NOT. It is not authority and it never decides a write. A caller may only use it to
 * decide whether to show a PROVISIONAL number; the write is enqueued either way, and the store's
 * own refusal (or its unexpected success) is what the count ultimately follows. Local knowledge can
 * be stale - the ledger read that feeds `filed` is a snapshot - and a stale prediction must cost at
 * most a count that moves once at reconcile instead of instantly. It must never suppress a write.
 *
 * THE RISK, NAMED. This duplicates a rule the planners already enforce, and duplicated rules drift.
 * The mitigation is the agreement test in storageCoordination.test.mjs, which walks a grid of
 * (filed, unfiled, target) and asserts this function and the planners answer identically for every
 * cell - so a change to either side that separates them fails rather than mispaints.
 *
 * Clamps both inputs at zero, mirroring the `Math.max(0, ...)` every ownership writer applies to a
 * target before it plans anything.
 *
 * @param {{ target?: number|null, filed?: number|null }} [args] the decrease's target quantity and
 *   the copies currently filed. Either missing means "not known", which never predicts a refusal.
 * @returns {boolean} true when a caller may NOT paint this decrease optimistically.
 */
export function predictGlobalRemovalRefusal({ target, filed } = {}) {
  return Math.max(0, Number(target) || 0) < Math.max(0, Number(filed) || 0);
}

/** The filed total the predicate above takes: copies in places that are not Unfiled. */
export function filedTotal(placements = []) {
  return (placements || []).reduce((n, p) => (p?.is_system ? n : n + (Number(p?.qty) || 0)), 0);
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
 * Statements clearing every allocation for an owned row, for the paths that DELETE the row itself.
 *
 * Without this the delete fails outright: allocations reference owned rows with ON DELETE RESTRICT,
 * deliberately, so a user's filing can never be silently discarded as a side effect of a count
 * reaching zero. RESTRICT turns that from a silent loss into a loud one - which is only an
 * improvement if every legitimate delete clears its allocations first. This is that.
 *
 * WHICH DELETES ARE LEGITIMATE changed on 2026-08-19 (see totalRemovalConflict). This used to list
 * "a stepper reaching zero, bulk Set-to-0, an import reconciling a row away" as its callers without
 * qualification. Two of those are now conditional: an INTERACTIVE zero - the steppers and the bulk
 * Set/Adjust commands - may only reach here once `totalRemovalConflict` has said the row holds
 * nothing filed, because clearing a filed allocation is exactly the silent loss RESTRICT exists to
 * prevent. Unconditional callers are the EXEMPT ones only: import/restore reconciliation, which
 * replaces the ledger authoritatively, and boot canonicalisation, which re-parents the places it
 * clears rather than discarding them.
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
 * Refuse a TOTAL removal that would discard the user's filing - the guard every writer that DELETES
 * an owned row outright must run before it composes a single statement.
 *
 * It exists as one function rather than five copies because the five delete sites in
 * ownedRepository are the same decision wearing five conditions, and the one that gets forgotten is
 * always the one nobody reasoned about. Two of the five (the want writers) cannot reach a filed row
 * today - they delete only when the row ALREADY holds no copies, and by the defining equality a row
 * with no copies has no places - but that safety lives in another function's arithmetic, one edit
 * away from being untrue. Guarding all five makes "no interactive delete discards filing" provable
 * by inspection instead of by argument, at the cost of one indexed read on a path that is taken
 * only when a row is being removed.
 *
 * THROWS BEFORE ANYTHING IS WRITTEN, so a refused gesture leaves the ledger exactly as it was.
 *
 * The read is outside the transaction, like every other read in this module, and the coordination
 * that closes the window is the caller's: the interactive writers all run inside the per-row
 * `enqueueWrite` chain keyed on the collector item, which is the SAME chain the filing writers in
 * storageDirectory use, and the multi-item filers hold the exclusive barrier. A copy therefore
 * cannot be filed into a binder between this read and the delete it authorises.
 */
export async function assertNoFiledCopies(query, ownedCardId, action = 'storage') {
  if (!ownedCardId) return;
  const conflict = totalRemovalConflict(await readPlacements(query, ownedCardId));
  if (conflict) throw new StorageConflict(conflict, action);
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
 *
 * THOSE READS HAPPEN OUTSIDE THE TRANSACTION, which makes the caller's coordination load-bearing
 * rather than merely tidy. Between the read and the commit, another write admitted to the SAME row
 * would leave this one composing a count from before and a place from after. Production cannot
 * reach that - the per-row chain serialises same-row writes and bulk holds the exclusive barrier -
 * and the counterfactual in bulkOwnedRepository.test.mjs demonstrates it by removing the barrier
 * on purpose, where the equality assertion now refuses the write. The assertion is the BACKSTOP
 * for that window, never a licence to skip the coordination that closes it.
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
export function placeUnfiledByKeyStatements({ profileId, cardId, variantSlug, qty, expectOwned = null, now = nowIso() }) {
  if (!(qty > 0)) return [];
  // A key-resolved statement matches by variant_slug, so a UI bucket here would match nothing and
  // report success - the exact silence that cost us undoBulkOwned. See assertCanonicalSlug.
  assertCanonicalSlug(variantSlug, 'placeUnfiledByKeyStatements');
  // `expectOwned` carries UNDO's conditional guard down to the places. Undo restores a row only
  // while it still holds what the bulk write left there, and the allocation must be governed by
  // the SAME condition in the SAME transaction - otherwise an undo the guard declined would still
  // move the copies. It runs BEFORE the owned UPDATE, while the row still holds the expected value.
  const guard = expectOwned == null ? '' : ' AND o.qty_owned=?';
  return [[
    `INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at)
     SELECT ?, o.profile_id, c.id, o.id, ?, ?, ?
       FROM owned_cards o JOIN storage_containers c ON c.profile_id = o.profile_id AND c.is_system = 1
      WHERE o.profile_id=? AND o.card_id=? AND o.variant_slug=?${guard}
     ON CONFLICT(container_id,owned_card_id) DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at;`,
    [uuid(), qty, now, now, profileId, cardId, variantSlug, ...(expectOwned == null ? [] : [expectOwned])],
  ]];
}

/**
 * The mirror of the above: take `qty` copies out of Unfiled for a row named by its KEY, under the
 * same optional guard.
 *
 * Two statements, and the ORDER is load-bearing. CHECK (qty > 0) forbids an allocation of zero, so
 * a place emptied by the removal must be DELETED, not updated to 0. Deleting the exact-match case
 * FIRST and updating the strictly-greater case second is the only order that is correct for both:
 * update-then-delete would take a place holding 4, reduce it to 2, and then delete it as an exact
 * match for a removal of 2.
 *
 * If Unfiled cannot cover the removal NEITHER statement matches and nothing happens - deliberately
 * silent here, because this form is only used where an equality assertion rides in the same
 * transaction to turn that silence into a rollback.
 */
export function takeUnfiledByKeyStatements({ profileId, cardId, variantSlug, qty, expectOwned = null, now = nowIso() }) {
  if (!(qty > 0)) return [];
  assertCanonicalSlug(variantSlug, 'takeUnfiledByKeyStatements');
  const guard = expectOwned == null ? '' : ' AND o.qty_owned=?';
  const owned = [profileId, cardId, variantSlug, ...(expectOwned == null ? [] : [expectOwned])];
  const selector = `container_id = (SELECT id FROM storage_containers WHERE profile_id=? AND is_system=1)
        AND owned_card_id = (SELECT o.id FROM owned_cards o WHERE o.profile_id=? AND o.card_id=? AND o.variant_slug=?${guard})`;
  return [
    [`DELETE FROM storage_allocations WHERE ${selector} AND qty = ?;`, [profileId, ...owned, qty]],
    [`UPDATE storage_allocations SET qty = qty - ?, updated_at = ? WHERE ${selector} AND qty > ?;`,
      [qty, now, profileId, ...owned, qty]],
  ];
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
  // DELIBERATELY NOT assertCanonicalSlug. This names rows to CHECK, not a key to write, and a
  // legacy row is a perfectly legitimate thing to check - triage drains v10 keys, so it asserts
  // over them by design.
  //
  // And the two cannot be told apart by value anyway: the UI's uncategorised bucket and the v10
  // legacy key are BOTH the empty string. That collision is the root of the whole defect class -
  // no guard can distinguish them, so the distinction has to be enforced by INTENT, at the write
  // boundary where only a canonical key can be correct. Here, any string is a fair target.
  for (const k of keys) {
    if (typeof k?.variantSlug !== 'string') {
      throw Object.assign(new Error(`${action}: equality guard needs a variant_slug string, got ${JSON.stringify(k?.variantSlug)}`), { name: 'InvalidPrinting' });
    }
  }
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

/**
 * THE allocation half of any absolute ownership plan - the one implementation every module that
 * moves qty_owned composes, rather than each growing its own.
 *
 * `changes` is `[{ rowId, cardId, variantSlug, before, after }]`, with `rowId` null for a row the
 * caller is about to create. The result is split because ORDER is a correctness property, not a
 * preference:
 *
 *   `pre`  runs BEFORE the owned statements. Removals and clears belong here, and a clear MUST
 *          precede the row DELETE it enables - allocations reference owned rows under RESTRICT,
 *          so deleting a row that still has places fails outright rather than silently.
 *   `post` runs AFTER them. A place has to resolve a row that exists.
 *
 * Conflicts are collected across every change and RETURNED, never thrown: whether an
 * unsatisfiable item fails one row or the whole command is the caller's policy, not this
 * function's. Every caller today - bulk Set, bulk Adjust, the absolute import - fails the whole
 * command, because a bulk write that files part of someone's collection is worse than one that
 * explains itself. (The doc here used to add "undo drops the row". There is no bulk-ownership undo:
 * `bulkOwnedRepository` was deleted on 2026-08-18 and the proposal's undo clause was struck with it.)
 *
 * REACHING ZERO IS A CONFLICT TOO when the row holds filed copies - owner ruling, 2026-08-19. The
 * zero branch below used to be an unconditional clear, so a bulk Set-to-0 over a filed selection
 * silently threw the user's filing away while a bulk Adjust that stopped one copy short of zero
 * refused. See totalRemovalConflict for why that split was wrong.
 */
export async function planAllocationChanges({ query, profileId, changes, now = nowIso(), chunk = 400 }) {
  // Zero targets are IN this read. They were excluded while the zero branch was unconditional, and
  // the exclusion was the bug: a row nobody read the places for is a row nobody can refuse.
  const decreasing = changes.filter((c) => c.after < c.before && c.rowId);
  const byRow = new Map();
  const ids = decreasing.map((c) => c.rowId);
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const rows = await query(
      `SELECT a.id, a.owned_card_id, a.container_id, a.qty, c.is_system
         FROM storage_allocations a JOIN storage_containers c ON c.id = a.container_id
        WHERE a.owned_card_id IN (${slice.map(() => '?').join(',')});`, slice);
    for (const r of rows) byRow.set(r.owned_card_id, [...(byRow.get(r.owned_card_id) || []), r]);
  }

  const pre = [];
  const post = [];
  const conflicts = [];
  for (const c of changes) {
    if (c.after === c.before) continue;
    if (c.after > c.before) {
      // Key-resolved rather than id-resolved: the row may not exist yet, and the statement that
      // creates it is in the same transaction.
      post.push(...placeUnfiledByKeyStatements({ profileId, cardId: c.cardId, variantSlug: c.variantSlug, qty: c.after - c.before, now }));
    } else if (c.after === 0) {
      // Total removal: allowed only when nothing is filed, and then the WHOLE row's places go -
      // there is no quantity to plan, which is why this clears rather than composing a removal.
      const conflict = totalRemovalConflict(byRow.get(c.rowId) || []);
      if (conflict) conflicts.push({ cardId: c.cardId, variantSlug: c.variantSlug, target: 0, ...conflict });
      else if (c.rowId) pre.push(...clearAllocationsStatements(c.rowId));
    } else {
      const plan = planGlobalRemoval(byRow.get(c.rowId) || [], c.before - c.after);
      if (plan.conflict) conflicts.push({ cardId: c.cardId, variantSlug: c.variantSlug, target: c.after, ...plan.conflict });
      else pre.push(...removalStatements(plan, now));
    }
  }
  return { pre, post, conflicts };
}
