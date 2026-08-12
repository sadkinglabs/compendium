// The admission boundary: every write is visible from admission until it settles, and an exclusive
// session can close the doors. Increment 1 of docs/proposals/restore-semantics.md (Rev 4).
// Run: npm run test:query
//
// These tests are the gate for the whole restore programme. The proposal is explicit: if this
// primitive cannot serve its three consumers - snapshot(), the profile-switch barrier, the restore
// session - without deadlock, the programme stops. So the assertions here are about ORDERING and
// LIVENESS, not outcomes:
//   - an admitted-but-unresolved write holds quiescence open until it settles
//   - the exclusive claim closes admission SYNCHRONOUSLY, so nothing slips in during the drain
//   - a second claimant is refused, never queued
//   - the owner's own operations are admitted, so the session cannot deadlock itself
//   - snapshot() keeps its deliberate external-write deadlock, re-based on the same primitive
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  __setBackendForTests, __resetWriteGateForTests,
  run, exec, tx, snapshot, awaitQuiescence, acquireExclusiveSession, RestoreInProgressError,
} from './db.js';

const require = createRequire(import.meta.url);
let sdb;
let calls;          // ordered log of backend operations - the ordering evidence
let realBackend;

const rowsOf = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; }
  finally { st.free(); }
};

const defer = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const names = () => rowsOf('SELECT name FROM t ORDER BY name;').map((r) => r.name);

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  realBackend = {
    query: (s, p = []) => { calls.push('query'); return Promise.resolve(rowsOf(s, p)); },
    run: (s, p = []) => { calls.push('run'); sdb.run(s, p); return Promise.resolve(); },
    exec: (s) => { calls.push('exec'); sdb.run(s); return Promise.resolve(); },
    tx: (st) => {
      calls.push('tx');
      sdb.run('BEGIN;');
      try { for (const [s, p = []] of st) sdb.run(s, p); sdb.run('COMMIT;'); }
      catch (e) { sdb.run('ROLLBACK;'); throw e; }
      return Promise.resolve();
    },
    persist: () => Promise.resolve(),
    beginRead: () => { calls.push('beginRead'); sdb.run('BEGIN;'); return Promise.resolve(); },
    endRead: () => { calls.push('endRead'); sdb.run('COMMIT;'); return Promise.resolve(); },
  };
  __setBackendForTests(realBackend);
});

beforeEach(() => {
  sdb.run('DROP TABLE IF EXISTS t; CREATE TABLE t (name TEXT);');
  sdb.run("INSERT INTO t(name) VALUES('before');");
  calls = [];
});

afterEach(() => {
  __resetWriteGateForTests();
  __setBackendForTests(realBackend);   // a test may swap it; never leak that into the next one
});

/* ------------------------------------------------------------------ */
/* Quiescence tracks admissions, not just calls                        */
/* ------------------------------------------------------------------ */

test('a write past admission but held unresolved blocks awaitQuiescence until it settles', async () => {
  const held = defer();
  __setBackendForTests({ ...realBackend, run: () => { calls.push('run'); return held.p; } });

  const write = run("INSERT INTO t(name) VALUES('slow');");
  await tick();                        // the write has reached the backend and is stuck there
  assert.ok(calls.includes('run'), 'the write never reached the backend');

  let quiet = false;
  const q = awaitQuiescence().then(() => { quiet = true; });
  await tick();
  await tick();
  assert.equal(quiet, false, 'quiescence reported while a write was still in flight');

  held.resolve();
  await write;
  await q;
  assert.equal(quiet, true);
});

test('settle() runs even when the underlying backend call throws', async () => {
  __setBackendForTests({ ...realBackend, run: () => Promise.reject(new Error('disk on fire')) });
  await assert.rejects(run('INSERT INTO t(name) VALUES(?);', ['x']), /disk on fire/);

  // The failed write settled: quiescence is immediate, and an exclusive claim is not blocked
  // behind a ghost admission.
  let quiet = false;
  awaitQuiescence().then(() => { quiet = true; });
  await tick();
  assert.equal(quiet, true, 'a throwing write never settled its admission');

  const session = await acquireExclusiveSession();
  session.release();
});

/* ------------------------------------------------------------------ */
/* The exclusive session                                               */
/* ------------------------------------------------------------------ */

test('an external write attempted mid-session is refused with RestoreInProgressError', async () => {
  const session = await acquireExclusiveSession();
  try {
    await assert.rejects(run("INSERT INTO t(name) VALUES('intruder');"), RestoreInProgressError);
    await assert.rejects(exec("INSERT INTO t(name) VALUES('intruder');"), RestoreInProgressError);
    await assert.rejects(tx([["INSERT INTO t(name) VALUES('intruder');"]]), RestoreInProgressError);
    // Refused means refused: nothing reached the backend, nothing is parked to run later.
    assert.deepEqual(calls, [], `a refused write reached the backend: ${calls.join(' -> ')}`);
    assert.deepEqual(names(), ['before']);
  } finally {
    session.release();
  }
  // Release reopens admission - the app is not left read-only after a session ends.
  await run("INSERT INTO t(name) VALUES('after');");
  assert.deepEqual(names(), ['after', 'before']);
});

test('an external snapshot attempted mid-session is refused too', async () => {
  const session = await acquireExclusiveSession();
  try {
    await assert.rejects(snapshot(async () => 'x'), RestoreInProgressError);
    assert.ok(!calls.includes('beginRead'), 'a refused snapshot opened a transaction');
  } finally {
    session.release();
  }
});

test('two simultaneous exclusive claimants: one is refused, not queued', async () => {
  // Both claims are issued before either is awaited - the synchronous check-and-set is what
  // decides, not scheduling luck. The loser's outcome is captured, not awaited raw, so its
  // rejection is handled in the same turn it happens.
  const first = acquireExclusiveSession();
  const second = acquireExclusiveSession().then(() => null, (e) => e);

  const session = await first;
  assert.ok((await second) instanceof RestoreInProgressError, 'the second claimant was not refused');

  // Not queued: the refusal is FINAL. A settled promise cannot later resolve into a session, so
  // the loser can never wake up owning a database in whatever state the winner left behind.
  session.release();
  assert.ok((await second) instanceof RestoreInProgressError);

  // The database is usable again - the refused claim did not wedge admission.
  const third = await acquireExclusiveSession();
  third.release();
});

test('admit-at-boundary: a write arriving during acquisition cannot slip in after the drain', async () => {
  const held = defer();
  __setBackendForTests({ ...realBackend, run: (s, p = []) => { calls.push('run'); return held.p.then(() => { sdb.run(s, p); }); } });

  const early = run("INSERT INTO t(name) VALUES('early');");   // admitted BEFORE the claim
  await tick();

  let acquired = false;
  const claim = acquireExclusiveSession().then((s) => { acquired = true; return s; });

  // Admission closed at the claim, synchronously - this write arrives DURING the drain and must be
  // refused, not admitted into the set the owner is waiting out (or worse, run after it).
  const late = run("INSERT INTO t(name) VALUES('late');");
  await assert.rejects(late, RestoreInProgressError);

  // The owner is still draining: the early write has not settled.
  await tick();
  assert.equal(acquired, false, 'acquisition completed while an admitted write was in flight');

  held.resolve();
  await early;
  const session = await claim;
  try {
    assert.equal(calls.filter((c) => c === 'run').length, 1, `the refused write ran: ${calls.join(' -> ')}`);
    assert.deepEqual(names(), ['before', 'early'], 'the drained state contains a write refused at the boundary');
  } finally {
    session.release();
  }
});

test("the owner's own readTransaction and tx do not deadlock inside its session", async () => {
  const session = await acquireExclusiveSession();
  try {
    // The capture shape: a consistent read spanning an await, exactly like a backup's.
    const seen = await session.readTransaction(async () => {
      const first = names();
      await tick();
      return { first, second: names() };
    });
    assert.deepEqual(seen.first, ['before']);
    assert.deepEqual(seen.second, ['before']);
    assert.deepEqual(calls.filter((c) => c === 'beginRead' || c === 'endRead'), ['beginRead', 'endRead']);

    // The replacement shape: an owner-scoped transaction, after the read has committed.
    await session.tx([
      ['DELETE FROM t;'],
      ["INSERT INTO t(name) VALUES('replaced');"],
    ]);
    assert.deepEqual(names(), ['replaced']);
  } finally {
    session.release();
  }
});

/* ------------------------------------------------------------------ */
/* snapshot(), re-based, keeps its external contract                   */
/* ------------------------------------------------------------------ */

test('snapshot() still deadlocks an external write issued inside it - delayed, never run within', async () => {
  // The full deadlock (fn awaiting its own write) would hang the suite, which is exactly the
  // property: the write cannot run while the snapshot holds the gate. So fn starts the write,
  // observes that it has not run, and returns WITHOUT awaiting it.
  let ranInside = null;
  let write;
  await snapshot(async () => {
    write = run("INSERT INTO t(name) VALUES('inside');");
    await tick();
    await tick();
    ranInside = calls.includes('run');
  });
  assert.equal(ranInside, false, 'a write ran inside the snapshot that should have deadlocked it');

  // Delayed, not dropped: the moment the snapshot commits, the write proceeds - after endRead.
  await write;
  assert.ok(calls.indexOf('run') > calls.indexOf('endRead'), calls.join(' -> '));
  assert.deepEqual(names(), ['before', 'inside']);
});

test('a snapshot in flight is drained by an exclusive claim, and writes it delayed drain too', async () => {
  // The three-consumer interaction the proposal flags as the deadlock risk: a snapshot holds the
  // gate, a write is admitted but parked behind it, and a claimant closes admission. The claim
  // must wait for BOTH (they were admitted first) and both complete on their own - no cycle.
  const gate = defer();
  const backup = snapshot(async () => { await gate.p; return names(); });
  await tick();
  const parked = run("INSERT INTO t(name) VALUES('parked');");
  await tick();

  let acquired = false;
  const claim = acquireExclusiveSession().then((s) => { acquired = true; return s; });
  await tick();
  assert.equal(acquired, false, 'acquisition completed while a snapshot held the gate');

  gate.resolve();
  assert.deepEqual(await backup, ['before'], 'the parked write leaked into the snapshot');
  await parked;
  const session = await claim;
  session.release();
  assert.deepEqual(names(), ['before', 'parked']);
});

test('acquisition is BOUNDED: a write that never settles surrenders the claim, it does not shut the database', async () => {
  // The token is published before the wait, so an unbounded acquisition would leave every external
  // write refused for the life of the process - the app read-only, with no error and no way back.
  // A stuck write must therefore cost the restore, never the database.
  const stuck = defer();
  __setBackendForTests({ ...realBackend, run: () => stuck.p });   // this write never resolves
  const held = run("INSERT INTO t(name) VALUES('stuck');");
  await tick();

  await assert.rejects(
    acquireExclusiveSession({ timeoutMs: 30 }),
    /did not settle within 30ms/,
    'acquisition must give up rather than wait forever',
  );

  // The critical assertion: the claim was surrendered, so ordinary writes work again.
  stuck.resolve();
  await held;
  __setBackendForTests(realBackend);
  await run("INSERT INTO t(name) VALUES('after');");
  assert.deepEqual(names(), ['after', 'before'], 'writes must be admitted again after a failed claim');

  // And a later, legitimate claim can still succeed - the database is not wedged.
  const session = await acquireExclusiveSession();
  session.release();
});
