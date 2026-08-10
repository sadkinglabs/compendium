// The snapshot write gate: the mechanism that makes a backup a CONSISTENT picture of the database.
// Run: npm run test:query
//
// Codex Blocker 1. A backup built from sequential reads with nothing protecting them can contain
// mutually inconsistent data AND a perfectly valid checksum - the worst combination, because the
// artifact looks verified. Worse, both backends share ONE connection, so a write issued during a
// read transaction does not merely race the reads: it JOINS the transaction and is committed or
// rolled back with it.
//
// So the assertions here are not "the backup looks right". They are, precisely:
//   1. a write issued mid-snapshot is NOT visible to the snapshot
//   2. it is NOT enrolled in the snapshot's transaction  (proven by CALL ORDER, not by outcome)
//   3. it is NOT lost - it lands after the commit
// Plus the failure paths: a throwing snapshot must not wedge the app or leak a transaction.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  __setBackendForTests, __resetWriteGateForTests, query, run, exec, tx, snapshot,
} from './db.js';

const require = createRequire(import.meta.url);
let sdb;
let calls;          // ordered log of backend operations - the evidence for assertion 2
let realBackend;    // so a test that swaps the backend cannot poison the ones after it

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

test('a write issued DURING a snapshot is invisible to it, not enrolled in it, and not lost', async () => {
  const gate = defer();
  let firstRead, secondRead;

  const backup = snapshot(async () => {
    firstRead = names();
    await gate.p;                 // hold the snapshot open across an await, as a real backup does
    secondRead = names();
    return 'done';
  });

  await tick();                                    // let the snapshot reach its await
  const write = run("INSERT INTO t(name) VALUES('during');");   // deliberately NOT awaited yet
  await tick();

  // 1. Invisible: the write has not been applied, so the snapshot's second read matches its first.
  gate.resolve();
  assert.equal(await backup, 'done');
  assert.deepEqual(firstRead, ['before']);
  assert.deepEqual(secondRead, ['before'], 'a write landed inside the snapshot');

  // 3. Not lost: it completes once the gate opens.
  await write;
  assert.deepEqual(names(), ['before', 'during']);

  // 2. Not enrolled: the write reached the backend only AFTER the transaction was committed.
  //    Outcome alone cannot prove this - a write enrolled in a COMMITTED transaction also survives.
  //    Call order can.
  assert.ok(calls.indexOf('run') > calls.indexOf('endRead'),
    `write was issued inside the snapshot transaction: ${calls.join(' -> ')}`);
});

test('tx() is gated too, not just run()', async () => {
  const gate = defer();
  const backup = snapshot(async () => { await gate.p; return names(); });
  await tick();
  const write = tx([["INSERT INTO t(name) VALUES('via-tx');"]]);
  await tick();
  gate.resolve();
  assert.deepEqual(await backup, ['before'], 'a tx landed inside the snapshot');
  await write;
  assert.ok(calls.indexOf('tx') > calls.indexOf('endRead'), calls.join(' -> '));
  assert.deepEqual(names(), ['before', 'via-tx']);
});

test('exec() is gated too - DDL cannot slip into a snapshot either', async () => {
  const gate = defer();
  const backup = snapshot(async () => { await gate.p; return 'ok'; });
  await tick();
  const ddl = exec('CREATE TABLE IF NOT EXISTS later (x TEXT);');
  await tick();
  gate.resolve();
  await backup;
  await ddl;
  assert.ok(calls.indexOf('exec') > calls.indexOf('endRead'), calls.join(' -> '));
});

test('reads are NOT gated - a snapshot must not block the rest of the app from reading', async () => {
  const gate = defer();
  const backup = snapshot(async () => { await gate.p; return 'ok'; });
  await tick();
  // If query() awaited the gate this would hang and the test would time out.
  const rows = await query('SELECT name FROM t;');
  assert.deepEqual(rows.map((r) => r.name), ['before']);
  gate.resolve();
  await backup;
});

test('a snapshot that THROWS still ends its transaction and releases the gate', async () => {
  await assert.rejects(snapshot(async () => { throw new Error('backup blew up'); }), /backup blew up/);

  // Transaction closed: endRead ran despite the throw.
  assert.ok(calls.includes('endRead'), `transaction left open: ${calls.join(' -> ')}`);

  // Gate released: a later write completes rather than hanging forever. A leaked gate would wedge
  // every write in the app until reload, which is a far worse outcome than a failed backup.
  await run("INSERT INTO t(name) VALUES('after-failure');");
  assert.deepEqual(names(), ['after-failure', 'before']);
});

test('snapshots serialise - two concurrent backups cannot interleave', async () => {
  const a = defer();
  const first = snapshot(async () => { await a.p; return 'first'; });
  await tick();
  const second = snapshot(async () => 'second');
  await tick();

  // The second has not started: only one beginRead so far.
  assert.equal(calls.filter((c) => c === 'beginRead').length, 1, calls.join(' -> '));

  a.resolve();
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  assert.deepEqual(calls.filter((c) => c === 'beginRead' || c === 'endRead'),
    ['beginRead', 'endRead', 'beginRead', 'endRead']);
});

test('a backend without snapshot support is refused loudly rather than silently unprotected', async () => {
  const good = { query: () => Promise.resolve([]), run: () => Promise.resolve(), exec: () => Promise.resolve(), tx: () => Promise.resolve(), persist: () => Promise.resolve(), beginRead: () => Promise.resolve(), endRead: () => Promise.resolve() };
  const { beginRead, endRead, ...withoutSnapshot } = good;
  __setBackendForTests(withoutSnapshot);
  await assert.rejects(snapshot(async () => 'x'), /does not support snapshot reads/);
  // And the gate is not left held after that refusal - afterEach restores the real backend, so a
  // leaked gate would show up as the NEXT test hanging rather than as a clear failure here.
  __setBackendForTests(good);
  await snapshot(async () => 'ok');
});
