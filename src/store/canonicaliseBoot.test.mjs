// Boot canonicalisation: the SQL adapter around the pure planner.
//
// These tests use a fake query/tx pair rather than a database, because what needs proving here
// is the SHAPE of the work - statement order, identity handling, the marker, and that a failure
// commits nothing. The planner's own semantics are proven in canonicalise.test.mjs.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanonicaliser, CANONICAL_MARKER_KEY, CANONICAL_VERSION } from './canonicaliseBoot.js';

// A fake database that records what it was asked to do. `tx` is all-or-nothing by definition
// here: it either records every statement or, on a forced failure, records none.
function fakeDb({ owned = [], cards = [], allocations = [], marker = null, failTx = false } = {}) {
  const committed = [];
  let txCalls = 0;
  return {
    committed,
    get txCalls() { return txCalls; },
    async query(sql, params = []) {
      if (sql.includes('_meta')) return marker ? [{ value: String(marker) }] : [];
      // The straggler probe: how many LEGACY rows remain, regardless of the marker.
      if (sql.includes('COUNT(*)')) {
        return [{ n: owned.filter((r) => r.variant_slug === '' || r.variant_slug === 'foil').length }];
      }
      if (sql.includes('FROM storage_allocations')) return allocations;
      if (sql.includes('FROM owned_cards')) return owned;
      if (sql.includes('FROM cards')) return cards;
      return [];
    },
    async tx(statements) {
      txCalls++;
      if (failTx) throw new Error('transaction failed');
      committed.push(...statements);
      return true;
    },
  };
}

const card = (id, codes) => ({ card_id: id, sets: JSON.stringify(codes.map((c) => ({ code: c, name: c }))) });
const owned = (o) => ({
  id: 'r1', profile_id: 'p1', card_id: 'c1', variant_slug: '', qty_owned: 0, qty_wanted: 0,
  notes: '', created_at: '2026-01-01', updated_at: '2026-01-01', ...o,
});
const sqlOf = (db) => db.committed.map(([s]) => s.replace(/\s+/g, ' ').trim());
const run = (db) => createCanonicaliser({ query: db.query, tx: db.tx, uuid: (() => { let n = 0; return () => `new-${++n}`; })(), now: () => '2026-07-21' })();

/* ---------------- the marker ---------------- */

test('an already-canonical database is skipped without a transaction', async () => {
  // NOTE the canonical variant_slug. An earlier version of this test used a '' row and still
  // expected a skip - it was asserting the very bug the marker hardening removes.
  const db = fakeDb({ marker: 11, owned: [owned({ variant_slug: 'uncategorised', qty_owned: 1 })] });
  const res = await run(db);
  assert.equal(res.skipped, true);
  assert.equal(db.txCalls, 0, 'no transaction is opened at all');
});

test('a marker from a FUTURE version is skipped, never downgraded or reinterpreted', async () => {
  // Legacy rows present AND a future marker: still hands off. Data written by a newer version
  // means something we do not know, and converting it would be worse than leaving it.
  const db = fakeDb({ marker: 12, owned: [owned({ variant_slug: '', qty_owned: 1 })] });
  const res = await run(db);
  assert.equal(res.skipped, true);
  assert.equal(res.reason, 'future-marker');
  assert.equal(db.txCalls, 0);
});

test('marker 11 WITH legacy rows converts them anyway - the marker is only an optimisation', async () => {
  // The failure this prevents: one missed writer recreates a '' row after conversion, the
  // marker says "done", and that row stays invisible to v11 readers forever. Ledger shape is
  // the invariant; the marker is just a way to skip work when the shape is already right.
  const db = fakeDb({
    marker: 11,
    owned: [owned({ id: 'straggler', variant_slug: '', qty_owned: 2 })],
    cards: [card('c1', ['004'])],
  });
  const res = await run(db);
  assert.notEqual(res.skipped, true, 'it must NOT skip');
  assert.equal(db.txCalls, 1, 'the straggler is converted in a transaction');
  assert.equal(res.inserted, 1);
  assert.equal(res.deleted, 1);
});

test('marker 11 with a CLEAN ledger still skips, so the common path stays cheap', async () => {
  const db = fakeDb({
    marker: 11,
    owned: [owned({ variant_slug: 'uncategorised', qty_owned: 1 })],
  });
  const res = await run(db);
  assert.equal(res.skipped, true);
  assert.equal(res.reason, 'clean');
  assert.equal(db.txCalls, 0);
});

test('the marker is written in the SAME transaction as the data', async () => {
  const db = fakeDb({ owned: [owned({ qty_owned: 2 })], cards: [card('c1', ['001'])] });
  await run(db);
  assert.equal(db.txCalls, 1, 'exactly one transaction');
  const markerStmt = db.committed.find(([s]) => s.includes('INSERT INTO _meta') && s.includes('ON CONFLICT'));
  assert.ok(markerStmt, 'the marker is part of the committed statements');
  assert.deepEqual(markerStmt[1], [CANONICAL_MARKER_KEY, String(CANONICAL_VERSION)]);
});

/* ---------------- statement shape and order ---------------- */

test('deletes are ordered before inserts so a released key can be reused', async () => {
  const db = fakeDb({
    owned: [owned({ id: 'legacy', variant_slug: '', qty_owned: 2, qty_wanted: 1 })],
    cards: [card('c1', ['004'])],
  });
  await run(db);
  const sql = sqlOf(db);
  const firstDelete = sql.findIndex((s) => s.startsWith('DELETE'));
  const firstInsert = sql.findIndex((s) => s.startsWith('INSERT INTO owned_cards'));
  assert.ok(firstDelete >= 0 && firstInsert >= 0);
  assert.ok(firstDelete < firstInsert, 'delete precedes insert or the unique index can trip');
});

test('a split inserts two NEW rows and releases the source row', async () => {
  const db = fakeDb({
    owned: [owned({ id: 'legacy', qty_owned: 2, qty_wanted: 1 })],
    cards: [card('c1', ['004'])],
  });
  const res = await run(db);
  assert.equal(res.inserted, 2, 'the split produced two rows needing ids');
  assert.equal(res.updated, 0);
  assert.equal(res.deleted, 1);
  const del = db.committed.find(([s]) => s.startsWith('DELETE'));
  assert.deepEqual(del[1], ['legacy'], 'exactly the released id, nothing else');
});

test('a row already at its destination is UPDATED in place, never re-inserted', async () => {
  const db = fakeDb({
    owned: [
      owned({ id: 'keep', variant_slug: '004', qty_owned: 1 }),
      owned({ id: 'legacy', variant_slug: '', qty_wanted: 2 }),
    ],
    cards: [card('c1', ['004'])],
  });
  const res = await run(db);
  assert.equal(res.updated, 1);
  const upd = db.committed.find(([s]) => s.startsWith('UPDATE owned_cards'));
  assert.equal(upd[1][upd[1].length - 1], 'keep', 'updated by its existing id');
  assert.equal(res.deleted, 1, 'the consumed legacy row is deleted');
});

test('every statement is parameterized - nothing is interpolated into SQL', async () => {
  const db = fakeDb({
    owned: [owned({ id: 'legacy', qty_owned: 1, notes: "it's a '; DROP TABLE owned_cards; --" })],
    cards: [card('c1', ['004'])],
  });
  await run(db);
  for (const [sql, params] of db.committed) {
    assert.ok(Array.isArray(params), `params missing for: ${sql}`);
    assert.ok(!sql.includes('DROP TABLE'), 'a note never reaches the SQL text');
  }
});

/* ---------------- failure is closed ---------------- */

test('a failed transaction commits nothing and propagates so boot fails closed', async () => {
  const db = fakeDb({ owned: [owned({ qty_owned: 1 })], cards: [card('c1', ['004'])], failTx: true });
  await assert.rejects(run(db), /transaction failed/);
  assert.equal(db.committed.length, 0, 'no statement survived the failure');
});

test('BOTH assertions are present, guarded, and last', async () => {
  // Step 4 of the proposal always required two: no legacy key survived, AND the equality holds for
  // every row that has places. This pass shipped with only the first, which is the one that
  // matters least here - canonicalisation MERGES rows, so it is precisely the arithmetic the
  // second assertion covers that this pass can get wrong.
  const db = fakeDb({ owned: [owned({ qty_owned: 1 })], cards: [card('c1', ['004'])] });
  await run(db);
  const tail = db.committed.slice(-2).map(([sql]) => sql);
  assert.ok(tail[0].includes('legacy-keys-survived-canonicalisation'));
  assert.ok(tail[1].includes('canonicalisation-broke-the-equality'), 'the equality is asserted too');
  for (const sql of tail) {
    assert.ok(sql.includes('WHERE EXISTS'), 'guarded, so a clean run inserts nothing');
    assert.ok(!sql.includes('ON CONFLICT'), 'no conflict clause - the collision IS the assertion');
  }
  // Scoped to rows that HAVE places. Canonicalisation runs BEFORE the backfill, so on a first
  // upgrade every row owns copies and has no allocation at all; a global form would fail every
  // genuine v11 upgrade.
  assert.ok(tail[1].includes('EXISTS (SELECT 1 FROM storage_allocations'),
    'a row with no places belongs to the backfill, not to this pass');
});

/* ---------------- every profile, not the active one ---------------- */

test('all profiles are converted, since none is active yet at this point in boot', async () => {
  const db = fakeDb({
    owned: [
      owned({ id: 'a', profile_id: 'p1', qty_owned: 1 }),
      owned({ id: 'b', profile_id: 'p2', qty_owned: 2 }),
      owned({ id: 'c', profile_id: 'p3', variant_slug: 'foil', qty_owned: 3 }),
    ],
    cards: [card('c1', ['004'])],
  });
  const res = await run(db);
  assert.equal(res.inserted, 3, 'one converted row per profile');
  const profiles = db.committed
    .filter(([s]) => s.startsWith('INSERT INTO owned_cards'))
    .map(([, p]) => p[1]);
  assert.deepEqual(profiles.sort(), ['p1', 'p2', 'p3']);
});

test('the ledger read is not scoped to a profile', async () => {
  const seen = [];
  const db = fakeDb({ owned: [], cards: [] });
  const wrapped = { ...db, query: async (sql, p) => { seen.push(sql); return db.query(sql, p); } };
  await createCanonicaliser({ query: wrapped.query, tx: db.tx })();
  const ledgerRead = seen.find((s) => s.includes('FROM owned_cards'));
  assert.ok(ledgerRead && !/profile_id\s*=/.test(ledgerRead), 'no profile filter on the boot read');
});

/* ---------------- nothing to do ---------------- */

test('an empty ledger still records the marker, so it is not re-planned every boot', async () => {
  const db = fakeDb({ owned: [], cards: [] });
  const res = await run(db);
  assert.equal(res.inserted, 0);
  assert.equal(res.deleted, 0);
  assert.ok(db.committed.some(([s]) => s.includes('ON CONFLICT') && s.includes('_meta')));
});

test('a catalog with unparseable sets does not throw - the card is simply parked', async () => {
  const db = fakeDb({
    owned: [owned({ id: 'legacy', qty_wanted: 1 })],
    cards: [{ card_id: 'c1', sets: '{not json' }],
  });
  const res = await run(db);
  assert.equal(res.inserted, 1, 'the want is preserved rather than lost to a parse error');
});

/* ---------------- the assertion, against a REAL engine ---------------- */

// The tests above prove the assertion statement is PRESENT. They cannot prove it WORKS: a fake
// tx has no constraints to violate. This runs the real statements through real SQLite, because
// the whole rollback guarantee rests on a deliberate PRIMARY KEY collision actually firing.
test('a surviving legacy key aborts the real transaction and leaves no marker', async () => {
  const initSqlJs = (await import('sql.js')).default;
  const { readFileSync } = await import('node:fs');
  const SQL = await initSqlJs({ wasmBinary: readFileSync('node_modules/sql.js/dist/sql-wasm.wasm') });
  const db = new SQL.Database();
  db.run(`CREATE TABLE _meta(key TEXT PRIMARY KEY, value TEXT);
          CREATE TABLE owned_cards(id TEXT PRIMARY KEY, variant_slug TEXT NOT NULL DEFAULT '');`);

  const attempt = (slugs) => {
    // This fixture builds a two-table schema by hand, deliberately - it is testing the guard
    // itself, not the app's schema. No storage tables exist here, so none to clear.
    db.run('DELETE FROM _meta; DELETE FROM owned_cards;');
    slugs.forEach((s, i) => db.run('INSERT INTO owned_cards(id,variant_slug) VALUES(?,?);', [`r${i}`, s]));
    try {
      db.run('BEGIN;');
      db.run(`INSERT INTO _meta(key,value) VALUES('owned_cards_canonical_version','11')
              ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
      db.run(`INSERT INTO _meta(key,value)
                SELECT 'owned_cards_canonical_version','legacy-keys-survived-canonicalisation'
                WHERE EXISTS (SELECT 1 FROM owned_cards WHERE variant_slug='' OR variant_slug='foil');`);
      db.run('COMMIT;');
      return { committed: true, marker: db.exec("SELECT value FROM _meta WHERE key='owned_cards_canonical_version';") };
    } catch (e) {
      db.run('ROLLBACK;');
      return { committed: false, error: String(e.message), marker: db.exec("SELECT value FROM _meta WHERE key='owned_cards_canonical_version';") };
    }
  };

  const clean = attempt(['uncategorised', 'uncategorised:f', '001']);
  assert.equal(clean.committed, true, 'a clean ledger commits');
  assert.equal(clean.marker[0].values[0][0], '11', 'and records the marker');

  for (const legacy of ['', 'foil']) {
    const bad = attempt(['uncategorised', legacy]);
    assert.equal(bad.committed, false, `a surviving ${legacy === '' ? 'empty-string' : 'foil'} key must abort`);
    assert.match(bad.error, /UNIQUE constraint failed/);
    assert.equal(bad.marker.length, 0, 'the rollback removed the marker too - nothing is half-done');
  }

  db.close();
});

/* ---------------- Storage: filing survives a boot-time merge ---------------- */

// The failure this feature was most likely to ship, named in the proposal's Self-Critique: two
// owned rows for one card collapsing into one, each carrying an allocation to the SAME container,
// whose quantities must SUM under the unique index rather than collide - and whose sum must still
// equal the merged qty_owned. It runs at boot, on data shapes produced by old builds, and no
// fixture in the repo naturally contains it.
test('STORAGE: a merge carries allocations to the destination row, summing per container', async () => {
  const db = fakeDb({
    cards: [card('c1', ['001'])],
    // Two legacy rows for one card: both hold copies, so both land on the same uncategorised key
    // and one of them is released.
    owned: [
      { id: 'r1', profile_id: 'p1', card_id: 'c1', variant_slug: '', qty_owned: 2, qty_wanted: 0, notes: '', created_at: 'a', updated_at: 'a' },
      { id: 'r2', profile_id: 'p1', card_id: 'c1', variant_slug: 'foil', qty_owned: 0, qty_wanted: 0, notes: '', created_at: 'a', updated_at: 'a' },
    ],
    allocations: [
      { id: 'a1', profile_id: 'p1', container_id: 'binder', owned_card_id: 'r1', qty: 1, created_at: 'a' },
      { id: 'a2', profile_id: 'p1', container_id: 'unfiled', owned_card_id: 'r1', qty: 1, created_at: 'a' },
    ],
  });
  await run(db);

  const sql = db.committed.map(([q]) => q).join(' ');
  const allocDeleteAt = db.committed.findIndex(([q]) => q.includes('DELETE FROM storage_allocations'));
  const ownedDeleteAt = db.committed.findIndex(([q]) => q.includes('DELETE FROM owned_cards'));
  assert.ok(allocDeleteAt >= 0, 'allocations on released rows are cleared');
  assert.ok(allocDeleteAt < ownedDeleteAt, 'and cleared BEFORE the rows they reference - RESTRICT requires it');

  const reinserts = db.committed.filter(([q]) => q.includes('INSERT INTO storage_allocations'));
  assert.equal(reinserts.length, 2, 'both places are re-homed, not just the first');
  assert.ok(sql.includes('ON CONFLICT(container_id,owned_card_id) DO UPDATE SET qty = qty + excluded.qty'),
    'two allocations landing on one container SUM rather than collide');
  // Every re-homed allocation names a real destination, never a released row.
  for (const [, params] of reinserts) assert.notEqual(params[3], 'r1');
  const totalQty = reinserts.reduce((n, [, p]) => n + p[4], 0);
  assert.equal(totalQty, 2, 'the copies are conserved: qty_owned still equals the sum of its places');
});

test('STORAGE: an allocation on a released row that held no copies ABORTS rather than guessing', async () => {
  const db = fakeDb({
    cards: [card('c1', ['001'])],
    // A wishlist-only legacy row: it holds a want and no copies, so it has no owned destination.
    owned: [{ id: 'r1', profile_id: 'p1', card_id: 'c1', variant_slug: '', qty_owned: 0, qty_wanted: 3, notes: '', created_at: 'a', updated_at: 'a' }],
    // ...yet something filed copies against it. That is corruption, and re-homing it would be an
    // invention. Fail closed: the transaction never runs and no marker is written.
    allocations: [{ id: 'a1', profile_id: 'p1', container_id: 'binder', owned_card_id: 'r1', qty: 1, created_at: 'a' }],
  });
  await assert.rejects(run(db), /refusing to guess/);
  assert.equal(db.txCalls, 0, 'nothing was committed');
});
