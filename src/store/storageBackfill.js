// Storage's boot backfill - the one pass that gives every existing collection its places.
//
// Every owned copy must be in exactly one place, and "Unfiled" is a place. A database written
// before v12 has neither, so this creates an Unfiled container for every profile and puts each
// row's copies in it. After it runs, for every owned row:
//
//     qty_owned = SUM(storage_allocations.qty for that row)
//
// WHY IT IS NOT IN THE MIGRATION. This is DATA, not DDL. exec() maps to Android's execSQL(), which
// refuses queries outright, and the native statement splitter is quote-unaware - so migrations
// carry schema only. It follows the canonicaliseBoot pattern instead: plan in JS, parameterised
// statements, one transaction, idempotent on re-run.
//
// WHY IT RUNS AFTER CANONICALISATION. Canonicalisation reshapes and MERGES the very rows this
// reads. Running first would allocate against rows about to be merged; running second means the
// ledger has already settled into its final row identities, and on a first upgrade there are no
// allocations for the merge to have to carry. (Canonicalisation still re-parents allocations,
// because it is shape-first and may re-run later, after Storage exists.)
//
// It takes NO interactive write barrier: it runs before a profile is resolved, so there is no
// interactive work to exclude.
import { query as dbQuery, tx as dbTx } from './db.js';
import { uuid as newId, nowIso } from './ids.js';
import { SYSTEM_KIND, UNFILED_NAME, DEFAULT_COLOUR } from './storageVocabulary.js';

export const BACKFILL_MARKER_KEY = 'storage_backfill_version';
export const BACKFILL_VERSION = 1;

/**
 * Decide what one owned row needs, given what is already allocated to it.
 *
 * PURE, and deliberately total: every case is named, and the unnameable one fails closed. An
 * interrupted pass leaves rows in mixed states, so "no marker" cannot be read as "nothing done".
 *
 *   0 owned,  0 placed -> nothing. A wishlist-only row holds no copies, and a zero-quantity
 *                         allocation would violate CHECK (qty > 0). `0 = SUM(none)` already holds.
 *   n owned,  0 placed -> place all n in Unfiled. The upgrade case.
 *   n owned,  n placed -> already done. Preserve the existing places exactly.
 *   anything else      -> FAIL CLOSED. A partial or excess sum means copies were placed somewhere
 *                         this pass cannot see, and inventing the difference would put the app in
 *                         the exact state the model exists to prevent.
 */
export function planRowBackfill({ qty_owned = 0, placed = 0 }) {
  const owned = Number(qty_owned) || 0;
  const sum = Number(placed) || 0;
  if (owned === sum) return { action: owned === 0 ? 'empty' : 'keep', qty: 0 };
  if (sum === 0 && owned > 0) return { action: 'place', qty: owned };
  return { action: 'fail', qty: 0 };
}

/** Injectable for tests; production wiring is the default export below. */
export function createStorageBackfill({ query, tx, uuid = newId, now = nowIso }) {
  return async function backfillStorage() {
    const marker = await query('SELECT value FROM _meta WHERE key=?;', [BACKFILL_MARKER_KEY]);
    const stamped = marker.length ? Number(marker[0].value) : null;
    if (stamped != null && stamped >= BACKFILL_VERSION) {
      // SHAPE-FIRST, like the canonicalisation marker: a stamp is an optimisation, never a promise.
      // The stamp says the pass RAN; the shape says whether the database is actually in the state
      // the pass exists to produce. Only both together are grounds to skip.
      //
      // WHAT THIS PROBE USED TO MISS, and why it is worth naming. It asked one question - "is there
      // an owned row with copies and NO allocation" - which is only the untouched-upgrade shape. It
      // was blind to a row that is PARTIALLY placed (owns 3, placed 1: it has an allocation, so the
      // probe was satisfied) and blind to a profile with NO UNFILED CONTAINER (nothing about
      // allocations mentions containers). Both are states the writers now fail closed on, so the
      // probe would have skipped the one pass that could report them, and every ownership tap in
      // that profile would fail with no explanation at boot.
      //
      // ONE query, three questions, and no correlated subquery in the common path - this runs on
      // every cold start, and the N+1 lesson applies to boot most of all. Two whole-table SUMs and
      // an anti-join over profiles are three index scans; the per-row correlated form is one
      // subquery per owned row, which on a large collection is the difference between a scan and a
      // stall.
      //
      // WHAT IT STILL CANNOT SEE: a COMPENSATING imbalance - one row over by two while another is
      // under by two - nets to zero and passes. That needs two independent faults that happen to
      // cancel, and the per-row planner below is the authority whenever anything else disagrees.
      // Stated rather than left implicit, because a probe's blind spot is a property of the system.
      const probe = (await query(`
        SELECT (SELECT COALESCE(SUM(qty_owned),0) FROM owned_cards) owned,
               (SELECT COALESCE(SUM(qty),0) FROM storage_allocations) placed,
               (SELECT COUNT(*) FROM owned_cards o
                 WHERE o.qty_owned > 0
                   AND NOT EXISTS (SELECT 1 FROM storage_allocations a WHERE a.owned_card_id = o.id)) unplaced,
               (SELECT COUNT(*) FROM profiles p
                  LEFT JOIN storage_containers c ON c.profile_id = p.id AND c.is_system = 1
                 WHERE c.id IS NULL) homeless;`))[0] || {};
      const settled = Number(probe.owned || 0) === Number(probe.placed || 0)
        && !Number(probe.unplaced || 0)
        && !Number(probe.homeless || 0);
      if (settled) return { skipped: true, reason: 'done' };
    }

    const profiles = await query('SELECT id FROM profiles;');
    if (!profiles.length) return { skipped: true, reason: 'no-profiles' };

    const stamp = now();
    const statements = [];
    const unfiledOf = new Map();

    // EVERY profile gets an Unfiled container, including an empty one. A profile with no cards
    // still needs somewhere for its first card to go, and creating it lazily on first use is one
    // more path that can fail.
    const existing = await query('SELECT id, profile_id FROM storage_containers WHERE is_system=1;');
    for (const c of existing) unfiledOf.set(c.profile_id, c.id);
    for (const p of profiles) {
      if (unfiledOf.has(p.id)) continue;
      const id = uuid();
      unfiledOf.set(p.id, id);
      statements.push([
        `INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at)
         VALUES(?,?,?,?,'',?,-1,1,?,?);`,
        [id, p.id, SYSTEM_KIND, UNFILED_NAME, DEFAULT_COLOUR, stamp, stamp],
      ]);
    }

    // One grouped read, not one per row - the listDecks N+1 lesson applies to boot most of all.
    const rows = await query(`
      SELECT o.id, o.profile_id, o.qty_owned, o.created_at,
             COALESCE((SELECT SUM(a.qty) FROM storage_allocations a WHERE a.owned_card_id = o.id), 0) placed
        FROM owned_cards o;`);

    let placed = 0;
    let kept = 0;
    for (const r of rows) {
      const plan = planRowBackfill(r);
      if (plan.action === 'fail') {
        throw new Error(
          `storageBackfill: owned row ${r.id} has ${r.qty_owned} copies but ${r.placed} placed - `
          + 'refusing to invent the difference.',
        );
      }
      if (plan.action === 'keep') { kept++; continue; }
      if (plan.action === 'empty') continue;
      const container = unfiledOf.get(r.profile_id);
      if (!container) throw new Error(`storageBackfill: profile ${r.profile_id} has no Unfiled container.`);
      placed++;
      statements.push([
        `INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?);`,
        [uuid(), r.profile_id, container, r.id, plan.qty, r.created_at || stamp, stamp],
      ]);
    }

    // THE MARKER, in the SAME transaction as the work. Written separately it could survive a failed
    // backfill and permanently skip a pass that never happened - which is how "runs once" becomes a
    // hope rather than a fact.
    statements.push([
      `INSERT INTO _meta(key,value) VALUES(?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value;`,
      [BACKFILL_MARKER_KEY, String(BACKFILL_VERSION)],
    ]);

    // THE ASSERTIONS, inside the transaction so a violation rolls the whole thing back. SQLite has
    // no bare "fail if" outside a trigger, so each provokes a PRIMARY KEY collision on the marker
    // row written immediately above: the SELECT yields nothing - and cannot collide - unless the
    // condition it guards is true.
    statements.push([
      `INSERT INTO _meta(key,value)
         SELECT ?, 'storage-backfill-equality-violated'
         WHERE EXISTS (
           SELECT 1 FROM owned_cards o
            WHERE o.qty_owned <> COALESCE((SELECT SUM(a.qty) FROM storage_allocations a WHERE a.owned_card_id = o.id), 0));`,
      [BACKFILL_MARKER_KEY],
    ]);
    statements.push([
      `INSERT INTO _meta(key,value)
         SELECT ?, 'storage-backfill-unfiled-count-violated'
         WHERE EXISTS (
           SELECT p.id FROM profiles p
            LEFT JOIN storage_containers c ON c.profile_id = p.id AND c.is_system = 1
            GROUP BY p.id HAVING COUNT(c.id) <> 1);`,
      [BACKFILL_MARKER_KEY],
    ]);

    await tx(statements);
    return { placed, kept, containers: statements.length ? unfiledOf.size : 0 };
  };
}

export const backfillStorage = createStorageBackfill({ query: dbQuery, tx: dbTx });
