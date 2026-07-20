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
  enqueueWrite, settleCollectionWrites, withExclusiveCollectionWrites,
  __resetCollectionWritesForTests,
} from './collectionWrites.js';

function defer() { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; }
const tick = () => new Promise((r) => setTimeout(r, 0));

test('a write queued BEFORE the barrier drains first', async () => {
  __resetCollectionWritesForTests();
  const log = [];
  const d = defer();
  const w = enqueueWrite('row', async () => { log.push('write-start'); await d.p; log.push('write-end'); });

  const bulk = withExclusiveCollectionWrites(async () => { log.push('bulk'); });
  await tick();
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
  const bulk = withExclusiveCollectionWrites(async () => {
    log.push('bulk-start');
    await gate.p;
    log.push('bulk-end');
  });
  await tick();
  assert.deepEqual(log, ['bulk-start']);

  const w = enqueueWrite('row', async () => { log.push('write'); });
  await tick();
  assert.deepEqual(log, ['bulk-start'], 'the write is gated, not running');

  gate.resolve();
  await Promise.all([bulk, w]);
  assert.deepEqual(log, ['bulk-start', 'bulk-end', 'write'], 'it ran only after bulk released');
});

test('a write queued DURING the drain waits for bulk, it does not join the drain', async () => {
  // The exact ordering bug the barrier closes. Exclusivity is claimed before the drain, so a
  // write arriving mid-drain sees a held gate. If the drain came first, this write would slip
  // in ahead of bulk and be overwritten by it.
  __resetCollectionWritesForTests();
  const log = [];
  const d = defer();
  enqueueWrite('row', async () => { log.push('early-start'); await d.p; log.push('early-end'); });

  const bulk = withExclusiveCollectionWrites(async () => { log.push('bulk'); });
  await tick();

  const late = enqueueWrite('row', async () => { log.push('late'); });
  await tick();

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
  const a = withExclusiveCollectionWrites(async () => { log.push('a-start'); await g1.p; log.push('a-end'); });
  await tick();
  const b = withExclusiveCollectionWrites(async () => { log.push('b'); });
  await tick();
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
  const bulk = withExclusiveCollectionWrites(async () => { await gate.p; });
  await tick();
  const bad = enqueueWrite('row', async () => { throw new Error('nope'); });
  const good = enqueueWrite('row', async () => { log.push('good'); });
  gate.resolve();
  await bulk;
  await assert.rejects(bad, /nope/);
  await good;
  assert.deepEqual(log, ['good']);
});

test('the barrier drain is bounded, so a hung write cannot freeze it forever', async () => {
  __resetCollectionWritesForTests();
  const never = defer();          // deliberately never resolved
  enqueueWrite('row', async () => { await never.p; });
  const log = [];
  await withExclusiveCollectionWrites(async () => { log.push('bulk'); }, 20);
  assert.deepEqual(log, ['bulk'], 'bulk proceeded after the bounded drain timed out');
  never.resolve();
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
  const holder = withExclusiveCollectionWrites(async () => {
    insideBarrier = true;
    await gate.p;
    insideBarrier = false;
  });
  await tick();
  const w = enqueueWrite('row', async () => { order.push(insideBarrier ? 'INSIDE' : 'outside'); });
  await tick();
  gate.resolve();
  await Promise.all([holder, w]);
  assert.deepEqual(order, ['outside'], 'the write never ran while the holder owned the barrier');
});

test('settleCollectionWrites still resolves for a queue gated behind the barrier', async () => {
  // A gated write keeps `pending` above zero, so settle must not resolve early and claim
  // idleness while work is parked behind the barrier.
  __resetCollectionWritesForTests();
  const gate = defer();
  const bulk = withExclusiveCollectionWrites(async () => { await gate.p; });
  await tick();
  const w = enqueueWrite('row', async () => {});
  let settled = false;
  const s = settleCollectionWrites().then(() => { settled = true; });
  await tick();
  assert.equal(settled, false, 'work is still outstanding behind the barrier');
  gate.resolve();
  await Promise.all([bulk, w, s]);
  assert.equal(settled, true);
});
