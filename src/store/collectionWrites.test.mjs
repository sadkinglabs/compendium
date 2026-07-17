// Coordinator mechanics for the Collection write queue (src/store/collectionWrites.js).
// Pure - no DB. Forces the exact orderings with deferred promises. Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueWrite, settleCollectionWrites, __resetCollectionWritesForTests } from './collectionWrites.js';
import { ownedRowKey, listRowKey } from './ownedRepository.js';

function defer() { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; }
const tick = () => new Promise((r) => setTimeout(r, 0));

test('same-key writes serialize in order', async () => {
  __resetCollectionWritesForTests();
  const log = [];
  const d1 = defer();
  const p1 = enqueueWrite('k', async () => { log.push('1-start'); await d1.p; log.push('1-end'); });
  const p2 = enqueueWrite('k', async () => { log.push('2-start'); });
  await tick();
  assert.deepEqual(log, ['1-start'], 'second write waits behind the first');
  d1.resolve();
  await Promise.all([p1, p2]);
  assert.deepEqual(log, ['1-start', '1-end', '2-start']);
});

test('different-key writes run concurrently', async () => {
  __resetCollectionWritesForTests();
  const started = [];
  const d = defer();
  enqueueWrite('a', async () => { started.push('a'); await d.p; });
  enqueueWrite('b', async () => { started.push('b'); });
  await tick();
  assert.deepEqual([...started].sort(), ['a', 'b'], 'b is not blocked by a-on-another-key');
  d.resolve();
});

test('the returned promise rejects to the caller on failure', async () => {
  __resetCollectionWritesForTests();
  await assert.rejects(enqueueWrite('k', async () => { throw new Error('boom'); }), /boom/);
});

test('a rejected write does not wedge the next same-key write', async () => {
  __resetCollectionWritesForTests();
  let ran = false;
  enqueueWrite('k', async () => { throw new Error('boom'); }).catch(() => {});
  await enqueueWrite('k', async () => { ran = true; });
  assert.equal(ran, true);
});

test('ignoring a rejected write produces NO unhandled rejection', async () => {
  __resetCollectionWritesForTests();
  const seen = [];
  const onUnhandled = (e) => seen.push(e);
  process.on('unhandledRejection', onUnhandled);
  enqueueWrite('k', async () => { throw new Error('ignored'); });   // caller ignores the returned promise
  await new Promise((r) => setTimeout(r, 20));                       // flush micro + macro tasks
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(seen, [], 'the recovered internal tail handles result even when the caller ignores it');
});

test('settle resolves once pending writes drain', async () => {
  __resetCollectionWritesForTests();
  const d = defer();
  enqueueWrite('k', async () => { await d.p; });
  let settled = false;
  const s = settleCollectionWrites().then(() => { settled = true; });
  await tick();
  assert.equal(settled, false, 'not settled while a write is pending');
  d.resolve();
  await s;
  assert.equal(settled, true);
});

test('settle is bounded, and a timed-out waiter is not retained', async () => {
  __resetCollectionWritesForTests();
  const d = defer();
  enqueueWrite('k', async () => { await d.p; });   // hangs past the timeout window
  const t0 = Date.now();
  await settleCollectionWrites(20);                 // times out rather than hanging forever
  assert.ok(Date.now() - t0 >= 15, 'settle waited ~the timeout, then resolved');
  d.resolve();                                      // the hung write finally completes...
  await tick();
  await settleCollectionWrites();                   // ...and this resolves immediately with no double-fire/crash
});

test('row keys are equal iff the persisted rows are equal (incl. foil variants)', () => {
  const P = 'p1', C = 'card1';
  const cases = [
    { set: '', foil: false, slug: '' },       // unspecified regular / wanted share this row
    { set: '', foil: true, slug: 'foil' },    // unspecified foil
    { set: '001', foil: false, slug: '001' }, // set regular
    { set: '001', foil: true, slug: '001:f' },// set foil
  ];
  const keys = cases.map((c) => ownedRowKey(P, C, c.set, c.foil));
  assert.equal(new Set(keys).size, keys.length, 'distinct persisted rows -> distinct keys');
  for (const c of cases) assert.equal(ownedRowKey(P, C, c.set, c.foil), `o:${P}:${C}:${c.slug}`);
  assert.equal(ownedRowKey(P, C, '', false), ownedRowKey(P, C, '', false), 'same row -> same key');
  assert.notEqual(ownedRowKey('p2', C, '', false), ownedRowKey(P, C, '', false), 'profile is part of row identity');
  assert.notEqual(listRowKey(P, 'L1', C), listRowKey(P, 'L2', C), 'list is part of row identity');
});
