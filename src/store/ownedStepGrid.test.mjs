// Binding-level tests for the grid's ownership steps. The pure controller tests cannot cover
// a CALLER that bypasses the controller - which is exactly the defect this module fixes - so
// these drive the binding the grid actually uses. Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedStepGrid } from './ownedStepGrid.js';

function harness({ readImpl } = {}) {
  const writes = [];
  const notes = [];
  const changes = new Map();               // key -> last displayed value
  let store = new Map();                   // key -> authoritative qty
  const grid = createOwnedStepGrid({
    read: readImpl || (async (key) => store.get(key) ?? 0),
    write: (key, delta) => new Promise((resolve, reject) => writes.push({ key, delta, resolve, reject })),
    notify: (r) => notes.push(r),
    onChange: (key, st) => changes.set(key, st.displayed),
  });
  return { grid, writes, notes, changes, store: () => store, setStore: (m) => { store = m; } };
}
const flush = () => new Promise((r) => setImmediate(r));

test('a tap shows optimistically and enqueues the durable write', () => {
  const h = harness();
  h.grid.step('c1|001', 2, +1);
  assert.equal(h.changes.get('c1|001'), 3, 'displayed immediately');
  assert.equal(h.writes.length, 1, 'write enqueued');
  assert.equal(h.grid.pending('c1|001'), 1);
});

test('on drain the row confirms from the authoritative store', async () => {
  const h = harness();
  h.grid.step('c1|001', 2, +1);
  h.store().set('c1|001', 3);
  h.writes[0].resolve();
  await flush(); await flush();
  assert.equal(h.grid.pending('c1|001'), 0);
  assert.equal(h.grid.state('c1|001').confirmedQty, 3);
  assert.equal(h.grid.state('c1|001').pendingDelta, 0);
});

test('a REJECTED write restores the true count and tells the user', async () => {
  const h = harness();
  h.store().set('c1|001', 2);
  h.grid.step('c1|001', 2, +1);
  assert.equal(h.changes.get('c1|001'), 3, 'optimistic');
  h.writes[0].reject(new Error('disk full'));
  await flush(); await flush();
  assert.equal(h.changes.get('c1|001'), 2, 'restored to what storage actually holds');
  assert.deepEqual(h.notes, ['save-failed'], 'user was told');
});

test('rapid taps on one row settle to the correct final count', async () => {
  const h = harness();
  h.grid.step('c1|001', 0, +1);
  h.grid.step('c1|001', 0, +1);
  h.grid.step('c1|001', 0, +1);
  assert.equal(h.changes.get('c1|001'), 3);
  h.store().set('c1|001', 3);
  h.writes.forEach((w) => w.resolve());
  await flush(); await flush();
  assert.equal(h.grid.state('c1|001').confirmedQty, 3);
  assert.equal(h.grid.pendingAny(), false);
});

test('rows are independent - one failing does not disturb another', async () => {
  const h = harness();
  h.store().set('a|001', 1); h.store().set('b|001', 5);
  h.grid.step('a|001', 1, +1);
  h.grid.step('b|001', 5, +1);
  h.writes[0].reject(new Error('nope'));   // row a fails
  h.store().set('b|001', 6);
  h.writes[1].resolve();                   // row b succeeds
  await flush(); await flush();
  assert.equal(h.changes.get('a|001'), 1, 'a restored');
  assert.equal(h.changes.get('b|001'), 6, 'b confirmed');
});

test('reseed confirms a row whose own reconcile read had failed', async () => {
  let readOk = false;
  const h = harness({ readImpl: async () => { if (!readOk) throw new Error('db down'); return 4; } });
  h.grid.step('c1|001', 3, +1);
  h.writes[0].resolve();                   // write SUCCEEDED; storage is 4
  await flush(); await flush();
  // read failed -> must NOT snap back to 3
  assert.equal(h.changes.get('c1|001'), 4, 'provisional kept');
  assert.equal(h.grid.state('c1|001').error, true);
  readOk = true;
  h.grid.reseed('c1|001', 4);              // the bulk refresh confirms it
  assert.equal(h.grid.state('c1|001').confirmedQty, 4);
  assert.equal(h.grid.state('c1|001').error, false);
});

test('reseed is ignored while a write is still in flight', () => {
  const h = harness();
  h.grid.step('c1|001', 2, +1);            // pending
  h.grid.reseed('c1|001', 99);             // a bulk refresh must not stomp the optimistic value
  assert.equal(h.changes.get('c1|001'), 3);
});
