// Boot canonicalisation - the impure half of the v10 -> v11 ledger conversion.
//
// The decisions all live in canonicalise.js, which is pure. This module does only the things
// that need the outside world: read the ledger and the catalog, turn the plan into SQL, commit
// it in ONE transaction, and record that it happened.
//
// WHY IT CANNOT BE A SCHEMA MIGRATION. Deciding where a legacy want belongs requires asking
// "does this card belong to one set or several?", and that question needs the catalog.
// `openDatabase()` runs MIGRATIONS before `seedCatalogIfNeeded()`, so at migration time the
// catalog may be absent or stale. Boot order is therefore:
//
//     DDL -> seed catalog -> CANONICALISE (here) -> initProfiles() -> Collection is reachable
//
// WHY THERE IS NO WRITE BARRIER. Every interactive writer in the Collection reaches the
// database through the active profile, and this runs before `initProfiles()` resolves one.
// There is no reachable writer to race with, which is a stronger guarantee than a barrier
// would give and the reason one is not taken here.
//
// FAILURE IS CLOSED. Any throw propagates into the boot effect's catch, which puts the app in
// the error state. Collection is never rendered against a half-converted ledger; the user sees
// a failed boot and their v10 data is still intact for the next attempt.
import { query as dbQuery, tx as dbTx } from './db.js';
import { uuid as newId, nowIso } from './ids.js';
import { planLedger } from './canonicalise.js';
import { SQL_IS_LEGACY } from './printings.js';

/** Where the marker lives. `_meta` is app-global and already holds `schema_version`. */
export const CANONICAL_MARKER_KEY = 'owned_cards_canonical_version';
export const CANONICAL_VERSION = 11;

const OWNED_COLUMNS = 'id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at';

/**
 * Build the canonicaliser over injected primitives so the whole path is testable without a
 * database. Production wiring is the default export below.
 */
export function createCanonicaliser({ query, tx, uuid = newId, now = nowIso }) {
  /**
   * @returns { skipped } when the marker already records this version, otherwise
   *          { planned, inserted, updated, deleted } describing what was committed.
   */
  return async function canonicaliseLedger() {
    // THE MARKER IS AN OPTIMISATION. THE LEDGER SHAPE IS THE INVARIANT.
    //
    // Trusting the marker alone would make one missed writer permanent: a legacy callsite (or an
    // import) recreates a '' row after conversion, the marker says "done", and that row is never
    // converted again - invisible to v11 readers forever. That is exactly the failure that
    // stopped the previous increment, so the check is shape-first.
    //
    //   marker > 11              -> skip. Future data; downgrading or reinterpreting it is worse
    //                               than leaving it alone.
    //   marker = 11, no legacy   -> skip. The common path, and the only one that saves work.
    //   marker = 11, legacy rows -> convert them anyway, transactionally.
    //   marker < 11 or absent    -> convert.
    const marker = (await query('SELECT value FROM _meta WHERE key=?;', [CANONICAL_MARKER_KEY]))[0];
    const recorded = marker ? parseInt(marker.value, 10) : 0;
    if (recorded > CANONICAL_VERSION) return { skipped: true, reason: 'future-marker' };
    if (recorded === CANONICAL_VERSION) {
      const stragglers = await query(
        `SELECT COUNT(*) n FROM owned_cards WHERE ${SQL_IS_LEGACY()};`,
      );
      if (!Number(stragglers[0]?.n || 0)) return { skipped: true, reason: 'clean' };
      // Fall through and convert. A re-run is safe: the planner is idempotent, so rows that are
      // already canonical are left exactly as they are.
    }

    // EVERY profile, not the active one - this runs before a profile is resolved, and a
    // database with three profiles must not leave two of them in v10 shape under v11 code.
    const rows = await query(`SELECT ${OWNED_COLUMNS} FROM owned_cards;`);

    // Catalog set membership, read once. A card the catalog does not know maps to [], which
    // the planner treats as "park it" rather than "guess".
    const setsById = new Map();
    for (const c of await query('SELECT card_id, sets FROM cards;')) {
      try {
        const parsed = JSON.parse(c.sets || '[]');
        setsById.set(c.card_id, Array.isArray(parsed) ? parsed.map((s) => s?.code).filter(Boolean) : []);
      } catch { setsById.set(c.card_id, []); }
    }

    const plan = planLedger(rows, (cardId) => setsById.get(cardId) || []);
    const stamp = now();
    const statements = [];

    // ORDER MATTERS. Deletes run before inserts so a new row can take a key a released row is
    // vacating without tripping the unique index. Retained rows are updated in place: their id
    // is the one that already sat at that key, so an UPDATE is correct and an INSERT would
    // collide.
    if (plan.releasedIds.length) {
      // Chunked: SQLite has a host-parameter limit (999 by default) and a large collection can
      // release more rows than that in one statement.
      for (let i = 0; i < plan.releasedIds.length; i += 400) {
        const chunk = plan.releasedIds.slice(i, i + 400);
        statements.push([
          `DELETE FROM owned_cards WHERE id IN (${chunk.map(() => '?').join(',')});`,
          chunk,
        ]);
      }
    }

    let inserted = 0;
    let updated = 0;
    for (const r of plan.rows) {
      if (r.needsId) {
        inserted++;
        statements.push([
          `INSERT INTO owned_cards(${OWNED_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?);`,
          [uuid(), r.profile_id, r.card_id, r.variant_slug, r.qty_owned || 0, r.qty_wanted || 0,
            r.notes || '', r.created_at || stamp, r.updated_at || stamp],
        ]);
      } else {
        updated++;
        statements.push([
          'UPDATE owned_cards SET variant_slug=?, qty_owned=?, qty_wanted=?, notes=?, created_at=?, updated_at=? WHERE id=?;',
          [r.variant_slug, r.qty_owned || 0, r.qty_wanted || 0, r.notes || '',
            r.created_at || stamp, r.updated_at || stamp, r.id],
        ]);
      }
    }

    // The marker, in the SAME transaction as the data. Written afterwards it could be lost to a
    // crash, and the next boot would re-run a conversion that had already happened - harmless
    // because the planner is idempotent, but it would mean the marker never told the truth.
    statements.push([
      `INSERT INTO _meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`,
      [CANONICAL_MARKER_KEY, String(CANONICAL_VERSION)],
    ]);

    // THE ASSERTION, inside the transaction so a violation rolls the whole thing back.
    //
    // SQLite has no bare "fail if" statement outside a trigger, so this deliberately provokes a
    // PRIMARY KEY collision on `_meta.key`: the row above already exists by now, and this
    // INSERT has no conflict clause. The guard means it inserts NOTHING - and therefore cannot
    // collide - unless a legacy key survived. If one did, the constraint fires, the transaction
    // rolls back, boot fails closed, and the user's v10 data is untouched.
    statements.push([
      `INSERT INTO _meta(key,value)
         SELECT ?, 'legacy-keys-survived-canonicalisation'
         WHERE EXISTS (SELECT 1 FROM owned_cards WHERE ${SQL_IS_LEGACY()});`,
      [CANONICAL_MARKER_KEY],
    ]);

    await tx(statements);
    return { planned: plan.touched, inserted, updated, deleted: plan.releasedIds.length };
  };
}

/** Production instance, bound to the real database. */
export const canonicaliseLedger = createCanonicaliser({ query: dbQuery, tx: dbTx });
