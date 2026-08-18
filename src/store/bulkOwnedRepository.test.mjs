// The bulk ownership command against a REAL in-memory sql.js database.
//
// TESTING RULE FOR THIS FILE (earned the hard way, twice):
//   A concurrency test must PROVE each required interleaving with explicit gates, and must
//   demonstrate sensitivity by failing when its protection is replaced with a pass-through.
//
// Both halves matter. Earlier versions of these tests asserted the final state under a
// friendly scheduler and passed with the barrier entirely removed - they proved an outcome,
// not that the mechanism caused it. And they used `await tick()` as evidence that a phase had
// been reached, which infers a boundary from elapsed turns rather than observing it. Every
// milestone below is a promise resolved by the code that reached it.
//
// Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests, query as dbQuery, tx as dbTx } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { enqueueWrite, withExclusiveCollectionWrites, __resetCollectionWritesForTests } from './collectionWrites.js';
import { setOwnedInSet, ownedRowKey, subscribeCollection } from './ownedRepository.js';
import { createBulkOwnedCommands } from './bulkOwnedRepository.js';
import { bulkApplyMessage, bulkUndoMessage } from './bulkResultMessage.js';

const require = createRequire(import.meta.url);
let sdb;

function defer() { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; }
const qtyOf = async (pid, cardId, slug) =>
  (await dbQuery('SELECT qty_owned FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, slug]))[0]?.qty_owned ?? 0;

const T = (cardId, set = '001') => ({ cardId, set });

/** Build a command pair with overridable dependencies. Defaults are the production ones. */
function commands(overrides = {}) {
  return createBulkOwnedCommands({
    exclusive: withExclusiveCollectionWrites,
    query: dbQuery,
    tx: dbTx,
    notify: () => {},
    activeProfileId: () => 'P',
    ...overrides,
  });
}

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  // Every operation resolves on a MACROTASK, not a microtask. This is not decoration: the
  // real backend is Capacitor SQLite across a native bridge, so each call genuinely yields to
  // the event loop and other work can interleave between a read and the write derived from
  // it. With a Promise.resolve() backend each command ran to completion before anything else
  // got a turn, which made every concurrency test here incapable of failing.
  const later = (v) => new Promise((res) => setTimeout(() => res(v), 0));
  __setBackendForTests({
    query(sql, params = []) { const st = sdb.prepare(sql); try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return later(r); } finally { st.free(); } },
    run(sql, params = []) { sdb.run(sql, params); return later(); },
    exec(sql) { sdb.exec(sql); return later(); },
    // Statements still commit atomically as one unit; only the resolution is deferred.
    tx(statements) { sdb.run('BEGIN;'); try { for (const [s, v = []] of statements) sdb.run(s, v); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return later(); },
    persist() { return later(); },
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);
});

beforeEach(async () => {
  sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards;');
  sdb.run('DELETE FROM profiles;');
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at,updated_at) VALUES('P','p',10,'t','t');");
  __setActiveIdForTests('P');
  __resetCollectionWritesForTests();
});

/* ---------------- basic behaviour ---------------- */

test('add1 raises every selected row and reports confirmed counts', async () => {
  const r = await commands().applyBulkOwned('add1', [T('a'), T('b')]);
  assert.equal(r.confirmed, true);
  assert.equal(r.changed, 2);
  assert.equal(await qtyOf('P', 'a', '001'), 1);
  assert.equal(await qtyOf('P', 'b', '001'), 1);
});

test('ensure1 leaves an already-owned row alone and reports it as unchanged', async () => {
  const c = commands();
  await c.applyBulkOwned('add1', [T('a')]);
  await c.applyBulkOwned('add1', [T('a')]);                 // a = 2
  const r = await c.applyBulkOwned('ensure1', [T('a'), T('b')]);
  assert.equal(r.changed, 1, 'only b was raised');
  assert.equal(r.unchanged, 1);
  assert.equal(await qtyOf('P', 'a', '001'), 2, 'a preserved, not reset to 1');
});

test('remove1 clamps at zero', async () => {
  const c = commands();
  await c.applyBulkOwned('add1', [T('a')]);
  const r = await c.applyBulkOwned('remove1', [T('a'), T('b')]);
  assert.equal(r.changed, 1);
  assert.equal(await qtyOf('P', 'a', '001'), 0);
});

test('the same printing selected twice is written once', async () => {
  const r = await commands().applyBulkOwned('add1', [T('a'), T('a'), T('a')]);
  assert.equal(r.changed, 1);
  assert.equal(await qtyOf('P', 'a', '001'), 1, 'not 3');
});

test('one card in two printings is two independent rows', async () => {
  await commands().applyBulkOwned('add1', [T('a', '001'), T('a', '002')]);
  assert.equal(await qtyOf('P', 'a', '001'), 1);
  assert.equal(await qtyOf('P', 'a', '002'), 1);
});

test("the uncategorised bucket ('') is a real, writable row, stored canonically", async () => {
  // '' is the UI bucket code; the canonical storage key is 'uncategorised'. The bulk commands
  // translate at the boundary, so a caller passing the bucket still edits the right row.
  await commands().applyBulkOwned('add1', [T('a', '')]);
  assert.equal(await qtyOf('P', 'a', 'uncategorised'), 1, 'stored under the canonical key');
  assert.equal(await qtyOf('P', 'a', ''), 0, 'and NOT under the v10 key');
});

test('a selection larger than one query chunk is handled whole', async () => {
  const targets = Array.from({ length: 950 }, (_, i) => T(`c${i}`));
  const r = await commands().applyBulkOwned('add1', targets);
  assert.equal(r.changed, 950);
  assert.equal(await qtyOf('P', 'c949', '001'), 1, 'the last row past the chunk boundary landed');
});

/* ---------------- the counterfactual ---------------- */

/**
 * The lost-update scenario, parameterised by barrier implementation.
 *
 * A quick-add is a read-modify-write, so it has a window between reading a row and writing it
 * back. The lost update is:
 *   quick reads 1 -> bulk reads 1, plans 2, commits 2 -> quick commits its own 1+1 = 2
 * Final value 2, when both +1s succeeded and it should be 3. Every write returned success.
 *
 * Milestones are observed, never assumed: `quickHasRead` is resolved BY the quick-add after
 * its read completes, so the bulk command demonstrably starts from a point where a stale read
 * already exists.
 */
async function lostUpdateScenario(exclusive) {
  const c = commands({ exclusive });
  await c.applyBulkOwned('add1', [T('a')]);                 // a = 1

  const quickHasRead = defer();
  const allowQuickWrite = defer();
  const quick = enqueueWrite(ownedRowKey('P', 'a', '001', false), async () => {
    const cur = await qtyOf('P', 'a', '001');               // reads 1
    quickHasRead.resolve();                                 // PROOF the read happened
    await allowQuickWrite.p;                                // held mid read-modify-write
    await setOwnedInSet('a', '001', cur + 1, 'P');          // writes from the value it read
  });

  await quickHasRead.p;                                     // not a scheduling guess
  const bulk = c.applyBulkOwned('add1', [T('a')]);
  allowQuickWrite.resolve();
  await Promise.all([quick, bulk]);
  return qtyOf('P', 'a', '001');
}

test('COUNTERFACTUAL: without the barrier the scenario loses an increment', async () => {
  // If this ever passes at 3, the scenario has stopped exercising the race and every
  // barrier test in this file is worthless. It is the sensitivity check for all of them.
  const final = await lostUpdateScenario((fn) => fn());
  assert.equal(final, 2, 'expected the pass-through barrier to lose the quick-add increment');
});

test('COUNTERFACTUAL: with the real barrier both increments survive', async () => {
  const final = await lostUpdateScenario(withExclusiveCollectionWrites);
  assert.equal(final, 3, 'the barrier must serialise the quick-add ahead of the bulk read');
});

test('a quick-add arriving mid-command is parked and reads the post-bulk value', async () => {
  await commands().applyBulkOwned('add1', [T('a')]);        // a = 1, ungated setup

  // Only the command under test is gated, and the gate is released from OUTSIDE its await.
  const txEntered = defer();
  const allowTx = defer();
  const gated = commands({
    tx: async (stmts) => { txEntered.resolve(); await allowTx.p; return dbTx(stmts); },
  });
  const bulk = gated.applyBulkOwned('add1', [T('a')]);
  await txEntered.p;                                        // PROOF the command reached its tx

  const quick = enqueueWrite(ownedRowKey('P', 'a', '001', false), async () => {
    const cur = await qtyOf('P', 'a', '001');
    await setOwnedInSet('a', '001', cur + 1, 'P');
  });
  allowTx.resolve();
  await Promise.all([bulk, quick]);
  assert.equal(await qtyOf('P', 'a', '001'), 3, 'the parked quick-add read the post-bulk value');
});

/* ---------------- unconfirmed results ---------------- */

test('transaction succeeds but read-back THROWS: unconfirmed, no counts, no undo', async () => {
  let calls = 0;
  const c = commands({
    query: async (sql, params) => {
      calls += 1;
      if (calls === 2) throw new Error('read-back failed');   // 1 = before-read, 2 = read-back
      return dbQuery(sql, params);
    },
  });
  const r = await c.applyBulkOwned('add1', [T('a'), T('b')]);
  assert.equal(r.confirmed, false);
  assert.equal(r.attempted, 2);
  assert.equal(r.changed, null, 'counts must be null, not the plan intent and not zero');
  assert.equal(r.unchanged, null);
  assert.equal(r.undo, null, 'no undo may be offered for a write we cannot describe');
  assert.equal(await qtyOf('P', 'a', '001'), 1, 'the write did land');
});

test('transaction succeeds but read-back MISMATCHES: unconfirmed, no counts, no undo', async () => {
  const c = commands({
    query: async (sql, params) => {
      const rows = await dbQuery(sql, params);
      // Corrupt the read-back so persisted state does not match what the plan modelled.
      return rows.map((r) => ({ ...r, qty_owned: r.qty_owned + 99 }));
    },
  });
  const r = await c.applyBulkOwned('add1', [T('a')]);
  assert.equal(r.confirmed, false);
  assert.equal(r.changed, null);
  assert.equal(r.undo, null, 'before/after pairs are untrustworthy when the read-back disagrees');
});

test('an unconfirmed apply still broadcasts once, because persisted state may have changed', async () => {
  let bumps = 0;
  let calls = 0;
  const c = commands({
    notify: () => { bumps += 1; },
    query: async (sql, params) => { calls += 1; if (calls === 2) throw new Error('nope'); return dbQuery(sql, params); },
  });
  const r = await c.applyBulkOwned('add1', [T('a')]);
  assert.equal(r.confirmed, false);
  assert.equal(bumps, 1, 'cache invalidation is not a success announcement, and is still owed');
});

test('undo transaction succeeds but read-back THROWS: unconfirmed, no counts', async () => {
  const c0 = commands();
  const r = await c0.applyBulkOwned('add1', [T('a'), T('b')]);
  let calls = 0;
  let bumps = 0;
  const c = commands({
    notify: () => { bumps += 1; },
    query: async (sql, params) => { calls += 1; if (calls === 1) throw new Error('read-back failed'); return dbQuery(sql, params); },
  });
  const u = await c.undoBulkOwned(r.undo);
  assert.equal(u.confirmed, false);
  assert.equal(u.attempted, 2);
  assert.equal(u.applied, null, 'we cannot say which restores landed');
  assert.equal(u.conflicts, null);
  assert.equal(bumps, 1, 'the restores may have landed, so the broadcast is still owed');
});

test('a failed transaction writes nothing, rejects, and does NOT broadcast', async () => {
  let bumps = 0;
  const c = commands({
    notify: () => { bumps += 1; },
    tx: async () => { throw new Error('disk full'); },
  });
  await assert.rejects(c.applyBulkOwned('add1', [T('a'), T('b')]), /disk full/);
  assert.equal(await qtyOf('P', 'a', '001'), 0, 'nothing was written');
  assert.equal(bumps, 0, 'nothing changed, so nothing to invalidate');
});

test('the barrier is released after a failed transaction', async () => {
  const bad = commands({ tx: async () => { throw new Error('boom'); } });
  await assert.rejects(bad.applyBulkOwned('add1', [T('a')]), /boom/);
  const r = await commands().applyBulkOwned('add1', [T('a')]);
  assert.equal(r.changed, 1, 'the queue still works after a failed command');
});

/* ---------------- broadcasts ---------------- */

test('exactly ONE broadcast per bulk command, not one per row', async () => {
  let bumps = 0;
  await commands({ notify: () => { bumps += 1; } }).applyBulkOwned('add1', [T('a'), T('b'), T('c')]);
  assert.equal(bumps, 1, `3 rows produced ${bumps} broadcasts`);
});

test('an empty plan writes nothing, confirms, broadcasts nothing, offers no undo', async () => {
  let bumps = 0;
  const r = await commands({ notify: () => { bumps += 1; } }).applyBulkOwned('remove1', [T('zzz')]);
  assert.equal(r.confirmed, true);
  assert.equal(r.changed, 0);
  assert.equal(r.undo, null);
  assert.equal(bumps, 0, 'no transaction ran, so no cache invalidation is owed');
});

test('the production instance wires the real subscription', async () => {
  // The default export must actually be connected; the injected `notify` in every other test
  // would happily hide a production instance that broadcasts to nothing.
  const { applyBulkOwned } = await import('./bulkOwnedRepository.js');
  let bumps = 0;
  const off = subscribeCollection(() => { bumps += 1; });
  await applyBulkOwned('add1', [T('a')]);
  off();
  assert.equal(bumps, 1);
});

/* ---------------- undo ---------------- */

test('undo restores rows untouched since the write', async () => {
  const c = commands();
  await c.applyBulkOwned('add1', [T('a')]);                 // a = 1
  const r = await c.applyBulkOwned('add1', [T('a'), T('b')]); // a = 2, b = 1
  const u = await c.undoBulkOwned(r.undo);
  assert.equal(u.confirmed, true);
  assert.equal(u.applied, 2);
  assert.equal(u.conflicts, 0);
  assert.equal(await qtyOf('P', 'a', '001'), 1);
  assert.equal(await qtyOf('P', 'b', '001'), 0);
});

test('undo REFUSES a row edited since the write and preserves that edit', async () => {
  const c = commands();
  const r = await c.applyBulkOwned('add1', [T('a'), T('b')]);
  await setOwnedInSet('a', '001', 5, 'P');                  // user edits a -> 5
  const u = await c.undoBulkOwned(r.undo);
  assert.equal(u.applied, 1, 'only b was restored');
  assert.equal(u.conflicts, 1);
  assert.equal(await qtyOf('P', 'a', '001'), 5, "the user's edit survived the undo");
});

test('undo of ensure1 reverses only the rows it actually raised', async () => {
  const c = commands();
  await c.applyBulkOwned('add1', [T('a')]);
  await c.applyBulkOwned('add1', [T('a')]);                 // a = 2
  const r = await c.applyBulkOwned('ensure1', [T('a'), T('b')]);
  const u = await c.undoBulkOwned(r.undo);
  assert.equal(u.applied, 1);
  assert.equal(await qtyOf('P', 'a', '001'), 2, 'never touched by the command or its undo');
});

/* ---------------- the copy boundary ---------------- */

test('an unconfirmed result CANNOT produce past-tense success copy', async () => {
  const msg = bulkApplyMessage({ confirmed: false, attempted: 42, changed: null, unchanged: null, undo: null }, 'add1');
  assert.equal(msg.tone, 'warning');
  assert.equal(msg.canUndo, false);
  assert.doesNotMatch(msg.text, /^Added|^Marked|^Removed/, 'must not read as a completed action');
  assert.match(msg.text, /could not confirm/);
});

test('confirmed copy reports the read-back count and offers undo', () => {
  const msg = bulkApplyMessage({ confirmed: true, attempted: 3, changed: 3, unchanged: 1, undo: { restores: [1] } }, 'ensure1');
  assert.equal(msg.tone, 'success');
  assert.equal(msg.canUndo, true);
  assert.match(msg.text, /Marked 3 cards as owned/);
  assert.match(msg.text, /1 already up to date/);
});

test('confirmed-but-zero-changed is neutral, not success, and offers no undo', () => {
  const msg = bulkApplyMessage({ confirmed: true, attempted: 0, changed: 0, unchanged: 5, undo: null }, 'ensure1');
  assert.equal(msg.tone, 'neutral');
  assert.equal(msg.canUndo, false);
  assert.doesNotMatch(msg.text, /Marked/);
});

test('undo copy surfaces conflicts rather than swallowing them', () => {
  const msg = bulkUndoMessage({ confirmed: true, attempted: 3, applied: 2, conflicts: 1 });
  assert.equal(msg.tone, 'warning');
  assert.match(msg.text, /Undid 2 changes/);
  assert.match(msg.text, /1 kept, changed since/);
});

test('unconfirmed undo copy does not claim anything was undone', () => {
  const msg = bulkUndoMessage({ confirmed: false, attempted: 4, applied: null, conflicts: null });
  assert.equal(msg.tone, 'warning');
  assert.doesNotMatch(msg.text, /^Undid/);
  assert.match(msg.text, /could not confirm/);
});
