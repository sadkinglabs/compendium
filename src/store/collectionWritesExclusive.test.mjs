// The exclusive Collection-write barrier (withExclusiveCollectionWrites).
//
// These tests exist because an atomic transaction is NOT sufficient on its own. A bulk
// command reads current quantities, computes absolute after-values, then writes them. If a
// per-row write commits inside that window, the bulk write overwrites it and the edit is
// silently lost even though every individual write succeeded.
//
// Pure - no DB. Forces the exact orderings with deferred promises. Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueWrite, settleCollectionWrites, withExclusiveCollectionWrites, withProfileSwitchWriteBarrier,
  __resetCollectionWritesForTests,
} from './collectionWrites.js';

function defer() { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; }

// A POSITIVE phase ("the holder is inside fn", "the write started") is proven by a milestone
// promise the code itself resolves - never inferred from elapsed turns.
//
// A NEGATIVE ("this write has NOT run") cannot be proven that way; absence of an event has no
// event. settleTurns bounds it instead: after a proven milestone, drain several macrotask
// turns so anything runnable would have run, then assert it did not. That is the honest shape
// for a negative, and it is anchored to a milestone rather than replacing one.
const settleTurns = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

test('a write queued BEFORE the barrier drains first', async () => {
  __resetCollectionWritesForTests();
  const log = [];
  const d = defer();
  const writeStarted = defer();
  const w = enqueueWrite('row', async () => { log.push('write-start'); writeStarted.resolve(); await d.p; log.push('write-end'); });

  const bulk = withExclusiveCollectionWrites(async () => { log.push('bulk'); });
  await writeStarted.p;                       // proven, not guessed
  await settleTurns();
  assert.deepEqual(log, ['write-start'], 'bulk waits for the in-flight write');

  d.resolve();
  await Promise.all([w, bulk]);
  assert.deepEqual(log, ['write-start', 'write-end', 'bulk'], 'bulk runs only after the drain');
});

test('a write queued WHILE bulk holds the barrier waits behind it', async () => {
  // The case a plain settle cannot cover: settling proves the queue was idle a moment ago,
  // not that it stays idle. This write must not land between bulk's read and its write.
  __resetCollectionWritesForTests();
  const log = [];
  const gate = defer();
  const holderEntered = defer();
  const bulk = withExclusiveCollectionWrites(async () => {
    log.push('bulk-start');
    holderEntered.resolve();
    await gate.p;
    log.push('bulk-end');
  });
  await holderEntered.p;                      // proven: the holder owns the barrier
  assert.deepEqual(log, ['bulk-start']);

  const w = enqueueWrite('row', async () => { log.push('write'); });
  await settleTurns();
  assert.deepEqual(log, ['bulk-start'], 'the write is gated, not running');

  gate.resolve();
  await Promise.all([bulk, w]);
  assert.deepEqual(log, ['bulk-start', 'bulk-end', 'write'], 'it ran only after bulk released');
});

test('a write queued DURING the drain waits for bulk, it does not join the drain', async () => {
  // The ordering bug the barrier closes. Admission shuts before the drain begins, so a write
  // arriving mid-drain is PARKED - it neither runs ahead of the holder nor counts toward the
  // drain the holder is waiting on. See the timing test below: asserting this order alone is
  // not enough, because a deadlock produces the same order four seconds later.
  __resetCollectionWritesForTests();
  const log = [];
  const d = defer();
  const earlyStarted = defer();
  enqueueWrite('row', async () => { log.push('early-start'); earlyStarted.resolve(); await d.p; log.push('early-end'); });

  const bulk = withExclusiveCollectionWrites(async () => { log.push('bulk'); });
  await earlyStarted.p;                       // proven: the drain has real work to wait on

  const late = enqueueWrite('row', async () => { log.push('late'); });
  await settleTurns();

  d.resolve();
  await Promise.all([bulk, late]);
  assert.deepEqual(log, ['early-start', 'early-end', 'bulk', 'late'],
    'late write is behind bulk, not between the drain and bulk');
});

test('a write queued immediately AFTER bulk commits runs normally', async () => {
  __resetCollectionWritesForTests();
  const log = [];
  await withExclusiveCollectionWrites(async () => { log.push('bulk'); });
  await enqueueWrite('row', async () => { log.push('write'); });
  assert.deepEqual(log, ['bulk', 'write'], 'the barrier released cleanly');
});

test('exclusive holders serialize against each other', async () => {
  // A profile switch and a bulk command take the same barrier, so they cannot interleave.
  __resetCollectionWritesForTests();
  const log = [];
  const g1 = defer();
  const aEntered = defer();
  const a = withExclusiveCollectionWrites(async () => { log.push('a-start'); aEntered.resolve(); await g1.p; log.push('a-end'); });
  await aEntered.p;
  const b = withExclusiveCollectionWrites(async () => { log.push('b'); });
  await settleTurns();
  assert.deepEqual(log, ['a-start'], 'b waits for a');
  g1.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(log, ['a-start', 'a-end', 'b']);
});

test('a rejecting holder releases the barrier and does not wedge the queue', async () => {
  __resetCollectionWritesForTests();
  await assert.rejects(withExclusiveCollectionWrites(async () => { throw new Error('bulk failed'); }), /bulk failed/);
  const log = [];
  await enqueueWrite('row', async () => { log.push('write'); });
  assert.deepEqual(log, ['write'], 'the queue still works after a failed holder');
  await withExclusiveCollectionWrites(async () => { log.push('bulk2'); });
  assert.deepEqual(log, ['write', 'bulk2'], 'and the barrier is reusable');
});

test('a rejecting gated write does not wedge writes behind it', async () => {
  __resetCollectionWritesForTests();
  const log = [];
  const gate = defer();
  const entered = defer();
  const bulk = withExclusiveCollectionWrites(async () => { entered.resolve(); await gate.p; });
  await entered.p;
  const bad = enqueueWrite('row', async () => { throw new Error('nope'); });
  const good = enqueueWrite('row', async () => { log.push('good'); });
  gate.resolve();
  await bulk;
  await assert.rejects(bad, /nope/);
  await good;
  assert.deepEqual(log, ['good']);
});

test('a timed-out PRE-EXISTING write prevents the holder from running at all', async () => {
  // Fail closed. The barrier was never achieved, so running `fn` would mean performing an
  // "exclusive" read-and-write alongside an active writer - the exact corruption the
  // barrier exists to prevent. A hung storage operation must cost a failed command, never
  // a silently lost edit.
  __resetCollectionWritesForTests();
  const never = defer();          // deliberately never resolved
  enqueueWrite('row', async () => { await never.p; });
  let ran = false;
  await assert.rejects(
    withExclusiveCollectionWrites(async () => { ran = true; }, { timeoutMs: 20 }),
    /timed out draining/,
  );
  assert.equal(ran, false, 'the callback must NOT run when exclusivity was not achieved');
  never.resolve();
});

test('withProfileSwitchWriteBarrier proceeds on a timeout - the sole tolerant path', async () => {
  // A profile switch does not read-then-write the ledger, and queued writes carry an
  // explicit profileId, so they commit under the profile they were scheduled for whatever
  // the active id becomes. Its drain preserves visibility, not correctness, so a hung write
  // must not be able to trap the user in a profile. Tolerance is a separate exported
  // function rather than an option precisely so a read-then-write holder cannot opt into it.
  __resetCollectionWritesForTests();
  const never = defer();
  enqueueWrite('row', async () => { await never.p; });
  let ran = false;
  await withProfileSwitchWriteBarrier(async () => { ran = true; }, { timeoutMs: 20 });
  assert.equal(ran, true, 'the switch completed despite the hung write');
  never.resolve();
});

test('a mid-drain arrival does not add the drain timeout to the holder', async () => {
  // Regression guard for a barrier that looked correct and was a deadlock. When a parked
  // write counted toward the holder's drain, the holder waited on a write that was waiting
  // on the holder, and only the timeout broke it. Ordering assertions alone passed; the
  // cost was ~4s per bulk command. Timing is therefore part of the contract.
  __resetCollectionWritesForTests();
  const d = defer();
  enqueueWrite('row', async () => { await d.p; });

  const t0 = Date.now();
  const bulk = withExclusiveCollectionWrites(async () => {}, { timeoutMs: 4000 });
  await settleTurns(2);                    // let the holder claim admission and begin draining
  enqueueWrite('row', async () => {});     // arrives mid-drain, must not extend the drain
  d.resolve();
  await bulk;
  const ms = Date.now() - t0;
  assert.ok(ms < 500, `holder took ${ms}ms; a parked write is being counted in its drain`);
});

test('a parked write does not keep the NEXT holder from seeing an empty drain', async () => {
  // Parked writes are admitted synchronously when the gate reopens, so a following holder
  // either counts them in its own drain or they have already run. It must never hold a
  // barrier that excludes nothing while an admitted write is about to execute.
  __resetCollectionWritesForTests();
  const order = [];
  const gate = defer();
  const firstEntered = defer();
  const first = withExclusiveCollectionWrites(async () => { order.push('h1'); firstEntered.resolve(); await gate.p; });
  await firstEntered.p;
  const w = enqueueWrite('row', async () => { order.push('write'); });
  await settleTurns();
  gate.resolve();
  await first;
  const second = withExclusiveCollectionWrites(async () => { order.push('h2'); });
  await Promise.all([w, second]);
  assert.deepEqual(order, ['h1', 'write', 'h2'], 'the parked write ran before the next holder');
});

test('a write cannot land between a holder acquiring the barrier and releasing it', async () => {
  // Stands in for the profile switch, which flips the active id INSIDE the barrier. If a
  // write could run in that window it would commit under the wrong profile. The real
  // switchProfile path is covered against the database in collectionWritesProfile.test.mjs;
  // this asserts the coordination primitive it now relies on.
  __resetCollectionWritesForTests();
  const order = [];
  const gate = defer();
  let insideBarrier = false;
  const entered = defer();
  const holder = withExclusiveCollectionWrites(async () => {
    insideBarrier = true;
    entered.resolve();
    await gate.p;
    insideBarrier = false;
  });
  await entered.p;
  const w = enqueueWrite('row', async () => { order.push(insideBarrier ? 'INSIDE' : 'outside'); });
  await settleTurns();
  gate.resolve();
  await Promise.all([holder, w]);
  assert.deepEqual(order, ['outside'], 'the write never ran while the holder owned the barrier');
});

test('settleCollectionWrites still resolves for a queue gated behind the barrier', async () => {
  // A gated write keeps `pending` above zero, so settle must not resolve early and claim
  // idleness while work is parked behind the barrier.
  __resetCollectionWritesForTests();
  const gate = defer();
  const entered = defer();
  const bulk = withExclusiveCollectionWrites(async () => { entered.resolve(); await gate.p; });
  await entered.p;
  const w = enqueueWrite('row', async () => {});
  let settled = false;
  const s = settleCollectionWrites().then(() => { settled = true; });
  await settleTurns();
  assert.equal(settled, false, 'work is still outstanding behind the barrier');
  gate.resolve();
  await Promise.all([bulk, w, s]);
  assert.equal(settled, true);
});
