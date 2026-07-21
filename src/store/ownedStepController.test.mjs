// Controller-level durability tests (Collection UX proposal §8). Pure: injected read/write/
// notify/isAlive, no DB and no DOM. Proves the optimistic-reconcile, unmount, and mid-chain
// failure behaviour that repository calls alone cannot prove. Run: npm run test:ui
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedStepController } from './ownedStepController.js';

// A controllable deferred write: each call parks a {resolve,reject}; the test settles them.
function deferredWrites() {
  const calls = [];
  const write = () => new Promise((resolve, reject) => calls.push({ resolve, reject }));
  return { write, calls };
}
const flush = () => new Promise((r) => setImmediate(r));

test('displayed = max(0, confirmedQty + pendingDelta) through interleaved taps', async () => {
  const { write } = deferredWrites();
  const c = createOwnedStepController({ read: async () => 0, write });
  c.init(2);
  assert.equal(c.displayed(), 2);
  c.step(+1); assert.equal(c.displayed(), 3);
  c.step(+1); assert.equal(c.displayed(), 4);
  c.step(-1); assert.equal(c.displayed(), 3);
  // clamp at zero even if provisional deltas overshoot downward
  c.step(-9); assert.equal(c.displayed(), 0);
});

test('on drain, confirmedQty is replaced from the authoritative read and provisional clears', async () => {
  const { write, calls } = deferredWrites();
  let authoritative = 5;
  const c = createOwnedStepController({ read: async () => authoritative, write });
  c.init(5);
  c.step(+1); c.step(+1);            // displayed 7, two writes in flight
  assert.equal(c.pending(), 2);
  authoritative = 7;                 // the store now reflects both writes
  calls[0].resolve(); calls[1].resolve();
  await flush(); await flush();
  const s = c.getState();
  assert.equal(s.pendingDelta, 0, 'provisional cleared after drain');
  assert.equal(s.confirmedQty, 7, 'confirmed from authoritative read');
  assert.equal(s.displayed, 7);
  assert.equal(s.error, false);
});

test('a rejected write restores confirmedQty from the authoritative read and notifies', async () => {
  const { write, calls } = deferredWrites();
  const notes = [];
  let authoritative = 3;
  const c = createOwnedStepController({ read: async () => authoritative, write, notify: (r) => notes.push(r) });
  c.init(3);
  c.step(+1);                        // displayed 4 optimistically
  assert.equal(c.displayed(), 4);
  authoritative = 3;                 // write will fail -> store unchanged
  calls[0].reject(new Error('offline'));
  await flush(); await flush();
  const s = c.getState();
  assert.equal(s.displayed, 3, 'restored to authoritative');
  assert.equal(s.error, true);
  assert.deepEqual(notes, ['save-failed'], 'notified exactly once');
});

test('mid-chain failure: provisional not cleared early; exactly one reconcile + one notify at drain', async () => {
  const { write, calls } = deferredWrites();
  const notes = [];
  const reads = [];
  let authoritative = 10;
  const c = createOwnedStepController({
    read: async () => { reads.push(1); return authoritative; },
    write, notify: (r) => notes.push(r),
  });
  c.init(10);
  c.step(+1); c.step(+1); c.step(+1);   // three writes queued, displayed 13
  assert.equal(c.pending(), 3);
  // first write FAILS while the other two are still in flight
  calls[0].reject(new Error('offline'));
  await flush();
  assert.equal(c.getState().pendingDelta, 3, 'provisional NOT cleared mid-chain');
  assert.equal(reads.length, 0, 'no reconcile while writes remain in flight');
  // remaining two succeed; store reflects the two that landed
  authoritative = 12;
  calls[1].resolve(); calls[2].resolve();
  await flush(); await flush();
  assert.equal(reads.length, 1, 'exactly one authoritative read at drain');
  assert.deepEqual(notes, ['save-failed'], 'exactly one failure notify for the chain');
  assert.equal(c.getState().confirmedQty, 12);
  assert.equal(c.getState().pendingDelta, 0);
});

test('after unmount (isAlive false) the write still fires but no state is applied', async () => {
  const { write, calls } = deferredWrites();
  let alive = true;
  let authoritative = 4;
  const changes = [];
  const c = createOwnedStepController({
    read: async () => authoritative, write, isAlive: () => alive,
    onChange: (s) => changes.push(s.displayed),
  });
  c.init(4);
  c.step(+1);
  assert.equal(calls.length, 1, 'the durable write was still enqueued');
  alive = false;                      // component unmounts
  authoritative = 5;
  calls[0].resolve();
  await flush(); await flush();
  // reconcile must be dropped: confirmedQty stays as it was, no post-unmount apply
  assert.equal(c.getState().confirmedQty, 4, 'no state applied after unmount');
});

test('a FAILED authoritative read is not treated as confirmation', async () => {
  const { write, calls } = deferredWrites();
  let readOk = false;
  const c = createOwnedStepController({
    read: async () => { if (!readOk) throw new Error('db down'); return 6; },
    write,
  });
  c.init(5);
  c.step(+1);                          // write SUCCEEDS; storage is now 6
  calls[0].resolve();
  await flush(); await flush();
  // The reconcile read failed. Snapping back to 5 would show a value storage no longer holds.
  assert.equal(c.displayed(), 6, 'provisional value kept, not reverted to pre-write');
  assert.equal(c.getState().error, true, 'flagged rather than silently stale');
  // The next successful read (via the collection broadcast -> init) confirms it.
  readOk = true;
  c.init(6);
  assert.equal(c.getState().confirmedQty, 6);
  assert.equal(c.getState().pendingDelta, 0);
  assert.equal(c.getState().error, false);
});

test('a failed reconcile read RETRIES to confirmation on its own', async () => {
  const { write, calls } = deferredWrites();
  const timers = [];
  let attempts = 0;
  const c = createOwnedStepController({
    read: async () => { attempts += 1; if (attempts < 3) throw new Error('db busy'); return 6; },
    write,
    schedule: (fn) => timers.push(fn),      // deterministic ladder
  });
  c.init(5);
  c.step(+1);                                // write succeeds; storage is 6
  calls[0].resolve();
  await flush(); await flush();
  assert.equal(c.getState().error, true, 'flagged unconfirmed after the first failed read');
  assert.equal(c.displayed(), 6, 'provisional value kept');
  // Recovery must NOT depend on some unrelated future ledger mutation - the controller's own
  // ladder gets there. Drive the scheduled retries; no init() is ever called.
  timers.shift()(); await flush(); await flush();   // retry 1 - still failing
  timers.shift()(); await flush(); await flush();   // retry 2 - succeeds
  assert.equal(c.getState().confirmedQty, 6, 'confirmed by its own retry');
  assert.equal(c.getState().pendingDelta, 0);
  assert.equal(c.getState().error, false);
});

test('an exhausted retry ladder tells the user the value is unconfirmed', async () => {
  const { write, calls } = deferredWrites();
  const timers = [];
  const notes = [];
  const c = createOwnedStepController({
    read: async () => { throw new Error('db down'); },
    write, notify: (r) => notes.push(r),
    schedule: (fn) => timers.push(fn),
  });
  c.init(5);
  c.step(+1);
  calls[0].resolve();                        // the WRITE succeeded
  await flush(); await flush();
  while (timers.length) { timers.shift()(); await flush(); await flush(); }
  assert.deepEqual(notes, ['unconfirmed'], 'reported once, and distinct from a save failure');
  assert.equal(c.displayed(), 6, 'still shows the value the write committed');
});

test('init does not stomp an in-flight optimistic value', async () => {
  const { write, calls } = deferredWrites();
  const c = createOwnedStepController({ read: async () => 0, write });
  c.init(2);
  c.step(+1);                         // pending, displayed 3
  c.init(99);                         // a late mount read arrives mid-flight -> ignored
  assert.equal(c.displayed(), 3, 'in-flight optimistic value preserved');
  calls[0].resolve();
  await flush(); await flush();
});

test('write REJECTED and reads exhausted is its own state - we never claim "restored"', async () => {
  const { write, calls } = deferredWrites();
  const timers = [];
  const notes = [];
  const c = createOwnedStepController({
    read: async () => { throw new Error('db down'); },
    write, notify: (r) => notes.push(r),
    schedule: (fn) => timers.push(fn),
  });
  c.init(5);
  c.step(+1);
  calls[0].reject(new Error('write failed'));       // BOTH the write and every read fail
  await flush(); await flush();
  while (timers.length) { timers.shift()(); await flush(); await flush(); }
  assert.deepEqual(notes, ['save-failed-unresolved'],
    'distinct from save-failed: the count was NOT restored, it is still provisional');
  assert.notEqual(c.getState().pendingDelta, 0, 'the unresolved delta is still on screen');
  assert.equal(c.getState().error, true);
});
