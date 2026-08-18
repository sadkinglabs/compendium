// The Storage boot backfill (docs/proposals/collection-storage.md).
//
// This pass runs on EVERY existing collection, before the app is usable, before a profile is
// resolved, on data shapes produced by builds we cannot inspect. So the cases below are not a
// sample - they are the enumeration the proposal committed to: fresh install, empty profile,
// wishlist-only rows, several profiles, an interrupted pass, and the states that must fail closed
// rather than be guessed at.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStorageBackfill, planRowBackfill, BACKFILL_MARKER_KEY, BACKFILL_VERSION,
} from './storageBackfill.js';

// A fake database recording what it was asked to do. tx is all-or-nothing by definition here.
function fakeDb({ profiles = [], owned = [], containers = [], marker = null, failTx = false } = {}) {
  const committed = [];
  let txCalls = 0;
  return {
    committed,
    get txCalls() { return txCalls; },
    async query(sql) {
      if (sql.includes('FROM _meta')) return marker == null ? [] : [{ value: String(marker) }];
      if (sql.includes('NOT EXISTS')) {
        return [{ n: owned.filter((o) => o.qty_owned > 0 && !(o.placed > 0)).length }];
      }
      if (sql.includes('FROM profiles')) return profiles;
      if (sql.includes('FROM storage_containers')) return containers;
      if (sql.includes('FROM owned_cards')) return owned;
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
const run = (db) => createStorageBackfill({
  query: db.query, tx: db.tx, uuid: (() => { let n = 0; return () => `new-${++n}`; })(), now: () => 'T',
})();
const sqlOf = (db) => db.committed.map(([s]) => s.replace(/\s+/g, ' ').trim());

/* ---------------- the pure decision, every case named ---------------- */

test('planRowBackfill names every case, and the unnameable one fails closed', () => {
  // A wishlist-only row: no copies, so no allocation. A zero-quantity row would violate
  // CHECK (qty > 0) and fail boot - this distinction is the one that would have done it.
  assert.deepEqual(planRowBackfill({ qty_owned: 0, placed: 0 }), { action: 'empty', qty: 0 });
  assert.deepEqual(planRowBackfill({ qty_owned: 4, placed: 0 }), { action: 'place', qty: 4 });
  assert.deepEqual(planRowBackfill({ qty_owned: 4, placed: 4 }), { action: 'keep', qty: 0 });
  // Partial and excess are NOT repairable: copies sit somewhere this pass cannot see, and
  // inventing the difference produces exactly the drift the model exists to prevent.
  assert.equal(planRowBackfill({ qty_owned: 4, placed: 1 }).action, 'fail');
  assert.equal(planRowBackfill({ qty_owned: 4, placed: 9 }).action, 'fail');
  assert.equal(planRowBackfill({ qty_owned: 0, placed: 2 }).action, 'fail');
});

/* ---------------- the upgrade ---------------- */

test('an upgrading profile gets an Unfiled container and all its copies in it', async () => {
  const db = fakeDb({
    profiles: [{ id: 'p1' }],
    owned: [{ id: 'o1', profile_id: 'p1', qty_owned: 4, placed: 0, created_at: 'a' }],
  });
  const res = await run(db);
  assert.equal(res.placed, 1);
  const sql = sqlOf(db);
  assert.ok(sql.some((s) => s.includes('INSERT INTO storage_containers')), 'the place is created');
  const alloc = db.committed.find(([s]) => s.includes('INSERT INTO storage_allocations'));
  assert.equal(alloc[1][4], 4, 'every copy is placed, not one row per copy');
});

test('a wishlist-only row gets NO allocation - a zero-quantity one would fail the CHECK', async () => {
  const db = fakeDb({
    profiles: [{ id: 'p1' }],
    owned: [{ id: 'w1', profile_id: 'p1', qty_owned: 0, placed: 0, created_at: 'a' }],
  });
  const res = await run(db);
  assert.equal(res.placed, 0);
  assert.equal(sqlOf(db).filter((s) => s.includes('INSERT INTO storage_allocations')).length, 0);
});

test('an EMPTY profile still gets its Unfiled container', async () => {
  // It has nowhere to put a first card otherwise, and creating it lazily on first use is one more
  // path that can fail.
  const db = fakeDb({ profiles: [{ id: 'p1' }], owned: [] });
  await run(db);
  assert.equal(sqlOf(db).filter((s) => s.includes('INSERT INTO storage_containers')).length, 1);
});

test('several profiles each get exactly one container, and rows land in their OWN', async () => {
  const db = fakeDb({
    profiles: [{ id: 'p1' }, { id: 'p2' }],
    owned: [
      { id: 'o1', profile_id: 'p1', qty_owned: 1, placed: 0, created_at: 'a' },
      { id: 'o2', profile_id: 'p2', qty_owned: 2, placed: 0, created_at: 'a' },
    ],
  });
  await run(db);
  const containers = db.committed.filter(([s]) => s.includes('INSERT INTO storage_containers'));
  assert.equal(containers.length, 2);
  const byProfile = new Map(containers.map(([, p]) => [p[1], p[0]]));
  for (const [, p] of db.committed.filter(([s]) => s.includes('INSERT INTO storage_allocations'))) {
    assert.equal(p[2], byProfile.get(p[1]), 'an allocation never crosses into another profile');
  }
});

test('a fresh install with no profiles does nothing at all', async () => {
  const db = fakeDb({ profiles: [], owned: [] });
  const res = await run(db);
  assert.equal(res.skipped, true);
  assert.equal(db.txCalls, 0);
});

/* ---------------- idempotence and interruption ---------------- */

test('a marked, complete database is skipped without a transaction', async () => {
  const db = fakeDb({
    marker: BACKFILL_VERSION,
    profiles: [{ id: 'p1' }],
    owned: [{ id: 'o1', profile_id: 'p1', qty_owned: 2, placed: 2, created_at: 'a' }],
  });
  const res = await run(db);
  assert.equal(res.skipped, true);
  assert.equal(db.txCalls, 0);
});

test('SHAPE-FIRST: a marker is an optimisation, never a promise', async () => {
  // The failure this prevents: a marker written by an interrupted or buggy pass permanently skips
  // work that never happened, leaving copies in no place at all - invisible forever.
  const db = fakeDb({
    marker: BACKFILL_VERSION,
    profiles: [{ id: 'p1' }],
    owned: [{ id: 'o1', profile_id: 'p1', qty_owned: 2, placed: 0, created_at: 'a' }],
  });
  const res = await run(db);
  assert.notEqual(res.skipped, true, 'it must NOT skip');
  assert.equal(res.placed, 1);
});

test('re-running over an already-placed row preserves its existing places', async () => {
  const db = fakeDb({
    profiles: [{ id: 'p1' }],
    containers: [{ id: 'u1', profile_id: 'p1' }],
    owned: [{ id: 'o1', profile_id: 'p1', qty_owned: 3, placed: 3, created_at: 'a' }],
  });
  const res = await run(db);
  assert.equal(res.kept, 1);
  assert.equal(res.placed, 0, 'nothing is re-placed, so a second run cannot double a collection');
  assert.equal(sqlOf(db).filter((s) => s.includes('INSERT INTO storage_containers')).length, 0,
    'and the existing container is reused, never duplicated');
});

test('an interrupted pass leaves no marker, so the next boot completes it', async () => {
  const db = fakeDb({
    profiles: [{ id: 'p1' }],
    owned: [{ id: 'o1', profile_id: 'p1', qty_owned: 1, placed: 0, created_at: 'a' }],
    failTx: true,
  });
  await assert.rejects(run(db), /transaction failed/);
  assert.equal(db.committed.length, 0, 'no statement survived - marker included');
});

/* ---------------- failing closed ---------------- */

test('a partially-placed row ABORTS rather than inventing the difference', async () => {
  const db = fakeDb({
    profiles: [{ id: 'p1' }],
    owned: [{ id: 'o1', profile_id: 'p1', qty_owned: 4, placed: 1, created_at: 'a' }],
  });
  await assert.rejects(run(db), /refusing to invent/);
  assert.equal(db.txCalls, 0, 'nothing was committed');
});

/* ---------------- the marker and the assertions travel together ---------------- */

test('the marker is written in the SAME transaction, after guarded assertions', async () => {
  const db = fakeDb({
    profiles: [{ id: 'p1' }],
    owned: [{ id: 'o1', profile_id: 'p1', qty_owned: 1, placed: 0, created_at: 'a' }],
  });
  await run(db);
  assert.equal(db.txCalls, 1, 'exactly one transaction');
  const sql = sqlOf(db);
  const markerAt = sql.findIndex((s) => s.includes('ON CONFLICT(key) DO UPDATE'));
  assert.ok(markerAt >= 0, 'the marker is part of the committed statements');
  // Each assertion provokes a PRIMARY KEY collision on the marker row written above it, so a
  // violation rolls the whole transaction back rather than reporting success.
  assert.ok(sql.some((s) => s.includes('storage-backfill-equality-violated')));
  assert.ok(sql.some((s) => s.includes('storage-backfill-unfiled-count-violated')));
  for (const [s, p] of db.committed) {
    assert.ok(Array.isArray(p), `params missing for: ${s}`);
  }
});
