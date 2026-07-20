// The bulk ownership command against a REAL in-memory sql.js database.
//
// The headline case is "a concurrent quick-add is not lost": the bug that made the barrier
// necessary was a bulk command reading a row, a per-row write committing, and the bulk
// transaction then overwriting it with a value computed from the stale read. Every
// individual write succeeded and the edit vanished anyway.
// Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests, query } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { enqueueWrite, __resetCollectionWritesForTests } from './collectionWrites.js';
import { setOwnedInSet, ownedRowKey, subscribeCollection } from './ownedRepository.js';
import { applyBulkOwned, undoBulkOwned } from './bulkOwnedRepository.js';

const require = createRequire(import.meta.url);
let sdb;

function defer() { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; }
const tick = () => new Promise((r) => setTimeout(r, 0));
const qtyOf = async (pid, cardId, slug) =>
  (await query('SELECT qty_owned FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, slug]))[0]?.qty_owned ?? 0;

// Mirrors the real interactive quick-add (Collection.jsx:503): a read-modify-write on a
// set row. Its read is exactly the one a bulk command can invalidate, which is the point.
const quickAdd = async (cardId, set, delta) => {
  const cur = await qtyOf('P', cardId, set);
  return setOwnedInSet(cardId, set, Math.max(0, cur + delta), 'P');
};

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  // Every operation resolves on a MACROTASK, not a microtask. This is not decoration: the
  // real backend is Capacitor SQLite across a native bridge, so each call genuinely yields to
  // the event loop and other work can interleave between a read and the write derived from
  // it. A Promise.resolve() backend runs each command to completion before anything else gets
  // a turn, which makes every concurrency test in this file unable to fail - verified by
  // disabling the barrier and watching all 17 still pass.
  const later = (v) => new Promise((res) => setTimeout(() => res(v), 0));
  __setBackendForTests({
    query(sql, params = []) { const st = sdb.prepare(sql); try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return later(r); } finally { st.free(); } },
    run(sql, params = []) { sdb.run(sql, params); return later(); },
    exec(sql) { sdb.exec(sql); return later(); },
    // The statements still commit atomically as one unit; only the resolution is deferred.
    tx(statements) { sdb.run('BEGIN;'); try { for (const [s, v = []] of statements) sdb.run(s, v); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return later(); },
    persist() { return later(); },
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);   // the real schema, in order
});

beforeEach(async () => {
  sdb.run('DELETE FROM owned_cards;');
  sdb.run('DELETE FROM profiles;');
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at,updated_at) VALUES('P','p',10,'t','t');");
  __setActiveIdForTests('P');
  __resetCollectionWritesForTests();
});

const T = (cardId, set = '001') => ({ cardId, set });

test('add1 raises every selected row and reports confirmed counts', async () => {
  const r = await applyBulkOwned('add1', [T('a'), T('b')]);
  assert.equal(r.changed, 2);
  assert.equal(r.confirmed, true);
  assert.equal(await qtyOf('P', 'a', '001'), 1);
  assert.equal(await qtyOf('P', 'b', '001'), 1);
});

test('ensure1 leaves an already-owned row alone and reports it as unchanged', async () => {
  await applyBulkOwned('add1', [T('a'), T('a')]);         // a -> 1 (deduped)
  await applyBulkOwned('add1', [T('a')]);                 // a -> 2
  const r = await applyBulkOwned('ensure1', [T('a'), T('b')]);
  assert.equal(r.changed, 1, 'only b was raised');
  assert.equal(r.unchanged, 1);
  assert.equal(await qtyOf('P', 'a', '001'), 2, 'a was preserved, not reset to 1');
  assert.equal(await qtyOf('P', 'b', '001'), 1);
});

test('remove1 clamps at zero', async () => {
  await applyBulkOwned('add1', [T('a')]);
  const r = await applyBulkOwned('remove1', [T('a'), T('b')]);
  assert.equal(r.changed, 1);
  assert.equal(await qtyOf('P', 'a', '001'), 0);
});

test('a quick-add mid read-modify-write is NOT overwritten by a bulk command', async () => {
  // THE test. A quick-add is a read-modify-write, so it has a window between reading a row
  // and writing it back. The lost update this whole design exists to prevent is:
  //   quick reads 1 -> bulk reads 1, plans 2, commits 2 -> quick commits its own 1+1 = 2
  // Final value 2, when both +1s succeeded and it should be 3. Every write returned success.
  //
  // The gate holds the quick-add precisely in that window so the race is deterministic rather
  // than hoped for. With the barrier, bulk cannot claim exclusivity until this admitted write
  // finishes, so it reads 2 and commits 3.
  await applyBulkOwned('add1', [T('a')]);                  // a = 1
  const gate = defer();
  const quick = enqueueWrite(ownedRowKey('P', 'a', '001', false), async () => {
    const cur = await qtyOf('P', 'a', '001');              // reads 1
    await gate.p;                                          // ...held mid read-modify-write
    await setOwnedInSet('a', '001', cur + 1, 'P');         // writes 2, from the value it read
  });
  await tick();                                            // let it reach the gate

  const bulk = applyBulkOwned('add1', [T('a')]);
  await tick();
  gate.resolve();
  await Promise.all([quick, bulk]);

  assert.equal(await qtyOf('P', 'a', '001'), 3,
    'a +1 was lost: the bulk write was computed from a read that predates the quick-add commit');
});

test('a bulk command mid-flight does not lose a quick-add that arrives after it', async () => {
  // The mirror case: the quick-add arrives while bulk holds the barrier, so it is parked and
  // its read happens AFTER the bulk transaction. Its read must therefore see the bulk's value.
  await applyBulkOwned('add1', [T('a')]);                  // a = 1
  const bulk = applyBulkOwned('add1', [T('a')]);           // -> 2
  await tick();
  const quick = enqueueWrite(ownedRowKey('P', 'a', '001', false), () => quickAdd('a', '001', 1));
  await Promise.all([bulk, quick]);
  assert.equal(await qtyOf('P', 'a', '001'), 3, 'the parked quick-add read the post-bulk value');
});

test('an empty plan writes nothing, confirms, and offers no undo', async () => {
  const r = await applyBulkOwned('remove1', [T('a')]);     // nothing owned
  assert.equal(r.changed, 0);
  assert.equal(r.confirmed, true);
  assert.equal(r.undo, null);
});

test('exactly ONE broadcast per bulk command, not one per row', async () => {
  let bumps = 0;
  const off = subscribeCollection(() => { bumps += 1; });
  await applyBulkOwned('add1', [T('a'), T('b'), T('c')]);
  off();
  assert.equal(bumps, 1, `3 rows produced ${bumps} broadcasts`);
});

test('a no-op command does not broadcast at all', async () => {
  let bumps = 0;
  const off = subscribeCollection(() => { bumps += 1; });
  await applyBulkOwned('remove1', [T('zzz')]);
  off();
  assert.equal(bumps, 0);
});

test('undo restores rows untouched since the write', async () => {
  await applyBulkOwned('add1', [T('a')]);                  // a = 1
  const r = await applyBulkOwned('add1', [T('a'), T('b')]); // a = 2, b = 1
  const u = await undoBulkOwned(r.undo);
  assert.equal(u.applied, 2);
  assert.equal(u.conflicts, 0);
  assert.equal(await qtyOf('P', 'a', '001'), 1, 'restored to its pre-bulk value');
  assert.equal(await qtyOf('P', 'b', '001'), 0);
});

test('undo REFUSES a row edited since the write and preserves that edit', async () => {
  // The SQL guard doing its job. The barrier coordinates this process; the guard protects the
  // persistence boundary, so a user edit between the bulk write and the undo survives.
  const r = await applyBulkOwned('add1', [T('a'), T('b')]);   // a = 1, b = 1
  await quickAdd('a', '001', 4);                              // user edits a -> 5
  const u = await undoBulkOwned(r.undo);
  assert.equal(u.applied, 1, 'only b was restored');
  assert.equal(u.conflicts, 1);
  assert.equal(await qtyOf('P', 'a', '001'), 5, "the user's edit survived the undo");
  assert.equal(await qtyOf('P', 'b', '001'), 0);
});

test('undo of ensure1 reverses only the rows it actually raised', async () => {
  await applyBulkOwned('add1', [T('a')]);
  await applyBulkOwned('add1', [T('a')]);                  // a = 2
  const r = await applyBulkOwned('ensure1', [T('a'), T('b')]);
  const u = await undoBulkOwned(r.undo);
  assert.equal(u.applied, 1);
  assert.equal(await qtyOf('P', 'a', '001'), 2, 'never touched by the command or its undo');
  assert.equal(await qtyOf('P', 'b', '001'), 0);
});

test('a failed transaction writes nothing and rejects, so there is nothing to undo', async () => {
  const realTx = sdb.run.bind(sdb);
  let armed = true;
  sdb.run = (sql, params) => {
    if (armed && /INSERT INTO owned_cards/.test(sql)) { armed = false; throw new Error('disk full'); }
    return realTx(sql, params);
  };
  await assert.rejects(applyBulkOwned('add1', [T('a'), T('b')]), /disk full/);
  sdb.run = realTx;
  assert.equal(await qtyOf('P', 'a', '001'), 0, 'the transaction rolled back');
  assert.equal(await qtyOf('P', 'b', '001'), 0);
});

test('the barrier is released after a failed transaction', async () => {
  const realTx = sdb.run.bind(sdb);
  let armed = true;
  sdb.run = (sql, params) => {
    if (armed && /INSERT INTO owned_cards/.test(sql)) { armed = false; throw new Error('boom'); }
    return realTx(sql, params);
  };
  await assert.rejects(applyBulkOwned('add1', [T('a')]), /boom/);
  sdb.run = realTx;
  const r = await applyBulkOwned('add1', [T('a')]);
  assert.equal(r.changed, 1, 'the queue still works after a failed command');
});

test('the same printing selected twice is written once', async () => {
  const r = await applyBulkOwned('add1', [T('a'), T('a'), T('a')]);
  assert.equal(r.changed, 1);
  assert.equal(await qtyOf('P', 'a', '001'), 1, 'not 3');
});

test('one card in two printings is two independent rows', async () => {
  await applyBulkOwned('add1', [T('a', '001'), T('a', '002')]);
  assert.equal(await qtyOf('P', 'a', '001'), 1);
  assert.equal(await qtyOf('P', 'a', '002'), 1);
});

test("the Unspecified printing ('') is a real, writable row", async () => {
  const r = await applyBulkOwned('add1', [T('a', '')]);
  assert.equal(r.changed, 1);
  assert.equal(await qtyOf('P', 'a', ''), 1);
});

test('a selection larger than one query chunk is handled whole', async () => {
  // readQuantities chunks its bound parameters; the command must not silently drop the tail.
  const targets = Array.from({ length: 950 }, (_, i) => T(`c${i}`));
  const r = await applyBulkOwned('add1', targets);
  assert.equal(r.changed, 950);
  assert.equal(await qtyOf('P', 'c0', '001'), 1);
  assert.equal(await qtyOf('P', 'c949', '001'), 1, 'the last row past the chunk boundary landed');
});
