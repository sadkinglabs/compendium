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

/* ---------------- the cause travels with the failure ---------------- */

test('notify receives the REJECTION, not just the fact of one', async () => {
  // A device pass found the app reporting a refused write as "Couldn't save" - the same words it
  // uses for a disk error. The controller had the rejection in hand and dropped it. It stays
  // DOM-free and renders nothing; it just stops discarding what the message needs.
  const refusal = Object.assign(new Error('refused'), { name: 'StorageConflict', detail: { filed: [{ qty: 3 }] } });
  const seen = [];
  const c = createOwnedStepController({
    read: async () => 3,
    write: async () => { throw refusal; },
    notify: (reason, cause) => seen.push([reason, cause]),
    schedule: (fn) => fn(),
  });
  c.init(3);
  c.step(-1);
  await flush(); await flush(); await flush();
  assert.deepEqual(seen.map(([r]) => r), ['save-failed']);
  assert.equal(seen[0][1], refusal, 'the same error object, so a caller can read its detail');
});

test('the FIRST rejection in a chain is the one reported', async () => {
  // Later taps in a drained chain are usually the same refusal repeated; the first is the one the
  // user actually caused.
  const first = Object.assign(new Error('one'), { name: 'StorageConflict' });
  const second = new Error('two');
  let n = 0;
  const seen = [];
  const c = createOwnedStepController({
    read: async () => 3,
    write: async () => { throw (++n === 1 ? first : second); },
    notify: (reason, cause) => seen.push(cause),
    schedule: (fn) => fn(),
  });
  c.init(3);
  c.step(-1);
  c.step(-1);
  await flush(); await flush(); await flush();
  assert.equal(seen.length, 1, 'one notify per drained chain');
  assert.equal(seen[0], first);
});

/* ---------------- holding the optimism, never the write ---------------- */
//
// The storage wall refuses a decrease that would eat into filed copies, so the stepper painted
// 1 -> 0, toasted, and snapped back to 1: the app appearing to undo itself over behaviour that is
// working. `holdDelta` lets a caller that can predict the refusal decline to paint. Every test here
// exists to hold the line that the prediction touches PRESENTATION ONLY.

test('a HELD tap paints nothing but still enqueues the durable write', () => {
  const { write, calls } = deferredWrites();
  const asked = [];
  const c = createOwnedStepController({
    read: async () => 1, write,
    holdDelta: (delta, shown) => { asked.push([delta, shown]); return delta < 0; },
  });
  c.init(1);
  c.step(-1);
  assert.equal(c.displayed(), 1, 'the count did not move');
  assert.equal(c.getState().pendingDelta, 0, 'nothing provisional, so nothing to snap back later');
  assert.equal(c.getState().heldDelta, -1, 'but the tap is accounted for rather than forgotten');
  assert.equal(calls.length, 1, 'the write went out anyway - local knowledge never gates a write');
  assert.equal(c.pending(), 1, 'and it is a normal member of the chain');
  assert.deepEqual(asked, [[-1, 1]], 'asked with the PRE-tap count, so a hook can target displayed + delta');
});

test('a held tap that is REFUSED never moves the count, and reports exactly as it does today', async () => {
  const refusal = Object.assign(new Error('refused'), { name: 'StorageConflict', detail: { filed: [{ qty: 1 }] } });
  const shown = [];
  const seen = [];
  const c = createOwnedStepController({
    read: async () => 1,
    write: async () => { throw refusal; },
    notify: (reason, cause) => seen.push([reason, cause]),
    onChange: (s) => shown.push(s.displayed),
    holdDelta: (delta) => delta < 0,
    schedule: (fn) => fn(),
  });
  c.init(1);
  c.step(-1);
  await flush(); await flush(); await flush();
  assert.deepEqual([...new Set(shown)], [1], '1 -> 0 -> toast -> 1 was the glitch; now nothing moves at any point');
  assert.deepEqual(seen, [['save-failed', refusal]], 'the same honest failure, carrying the cause the toast needs');
  assert.equal(c.getState().heldDelta, 0, 'the drained chain cleared its held accounting');
  assert.equal(c.getState().confirmation, null, 'a refused chain credits nothing');
});

test('a held tap that unexpectedly SUCCEEDS moves the count once, at reconcile', async () => {
  // The prediction is made from a local snapshot, so it can be stale. When it is, the write lands
  // and the authoritative read is what moves the number - once, in the right direction. A stale
  // prediction costs a beat of latency and never a lost write.
  const { write, calls } = deferredWrites();
  let authoritative = 1;
  const c = createOwnedStepController({ read: async () => authoritative, write, holdDelta: (d) => d < 0 });
  c.init(1);
  c.step(-1);
  assert.equal(c.displayed(), 1, 'nothing provisional while it is in flight');
  authoritative = 0;                       // the filed snapshot was out of date; storage took the copy
  calls[0].resolve();
  await flush(); await flush();
  assert.equal(c.displayed(), 0, 'the authoritative read moves it');
  assert.equal(c.getState().confirmation.appliedDelta, -1, 'credited with what it actually put into storage');
});

test('MIXED chain, painted then held: one reconcile, one notify, and it lands on the store', async () => {
  // Three copies with one filed. Two minuses are safely predictable and paint; the third would take
  // the row below its filed total, so it holds - and it is the one the store refuses.
  const { write, calls } = deferredWrites();
  const notes = [];
  const reads = [];
  let authoritative = 3;
  const c = createOwnedStepController({
    read: async () => { reads.push(1); return authoritative; },
    write, notify: (r) => notes.push(r),
    holdDelta: (delta, shown) => shown + delta < 1,     // filed = 1
  });
  c.init(3);
  c.step(-1); assert.equal(c.displayed(), 2, 'predicted-safe taps paint exactly as before');
  c.step(-1); assert.equal(c.displayed(), 1);
  c.step(-1); assert.equal(c.displayed(), 1, 'the tap into the filed copies paints nothing');
  assert.equal(c.pending(), 3, 'three writes, all of them enqueued');
  authoritative = 1;
  calls[0].resolve(); calls[1].resolve();
  calls[2].reject(Object.assign(new Error('refused'), { name: 'StorageConflict' }));
  await flush(); await flush(); await flush();
  assert.equal(reads.length, 1, 'one authoritative read for the whole chain');
  assert.deepEqual(notes, ['save-failed'], 'one notify for the chain, per the existing contract');
  assert.equal(c.getState().confirmedQty, 1);
  assert.equal(c.displayed(), 1, 'the two that landed are shown; the refused one never was');
  assert.equal(c.getState().pendingDelta, 0);
  assert.equal(c.getState().heldDelta, 0);
});

test('MIXED chain, held then painted: appliedDelta credits BOTH kinds of tap', async () => {
  // The interleaving is forced rather than predicted, because the accounting must hold for any
  // order the hook produces - not only the ones a real predicate happens to make.
  const { write, calls } = deferredWrites();
  const script = [true, false, true];
  let n = 0;
  let authoritative = 5;
  const c = createOwnedStepController({ read: async () => authoritative, write, holdDelta: () => script[n++] });
  c.init(5);
  c.step(-1); assert.equal(c.displayed(), 5, 'held');
  c.step(+1); assert.equal(c.displayed(), 6, 'painted');
  c.step(-1); assert.equal(c.displayed(), 6, 'held');
  authoritative = 4;                       // 5 - 1 + 1 - 1, all three landed
  calls.forEach((w) => w.resolve());
  await flush(); await flush();
  assert.equal(c.getState().confirmedQty, 4);
  assert.equal(c.displayed(), 4, 'reconciled to the authoritative value regardless of what was painted');
  assert.equal(c.getState().confirmation.appliedDelta, -1, 'the chain put one fewer copy in storage: +1 painted, -2 held');
  assert.equal(c.getState().confirmation.version, 1, 'one confirmation for the chain');
});

test('the hold hook defaults to never-hold, and a throwing one paints rather than silently holding', () => {
  const { write } = deferredWrites();
  const a = createOwnedStepController({ read: async () => 3, write });
  a.init(3); a.step(-1);
  assert.equal(a.displayed(), 2, 'no hook at all - every existing consumer is untouched');
  const b = createOwnedStepController({ read: async () => 3, write, holdDelta: () => { throw new Error('bad prediction'); } });
  b.init(3); b.step(-1);
  assert.equal(b.displayed(), 2, 'a broken prediction degrades to today, never to a tap that does nothing visible');
  assert.equal(b.getState().heldDelta, 0);
});

test('init clears held accounting, so a recovered row cannot credit a previous chain', async () => {
  // The one route by which held state outlives its own chain: a failed reconcile read deliberately
  // keeps the chain's accounting (the provisional value is the best estimate of storage), and the
  // recovery is an authoritative init from the collection broadcast. That init has to reset BOTH
  // accumulators, or the next chain is credited with taps that already happened.
  const { write, calls } = deferredWrites();
  const timers = [];
  let readOk = false;
  const c = createOwnedStepController({
    read: async () => { if (!readOk) throw new Error('db down'); return 9; },
    write, holdDelta: () => true, schedule: (fn) => timers.push(fn),
  });
  c.init(4);
  c.step(-1);                              // held, and the write itself lands
  calls[0].resolve();
  await flush(); await flush();
  assert.equal(c.getState().heldDelta, -1, 'the failed reconcile leaves the chain unresolved');
  readOk = true;
  c.init(3);                               // the collection broadcast confirms the row instead
  assert.equal(c.getState().heldDelta, 0);
  c.step(+1);
  calls[1].resolve();
  await flush(); await flush();
  assert.equal(c.getState().confirmation.appliedDelta, 1, 'credited with its own tap alone, not the previous chain');
});

test('a chain that succeeds after a failure does not carry the stale cause into the next one', async () => {
  const boom = Object.assign(new Error('nope'), { name: 'StorageConflict' });
  let fail = true;
  const seen = [];
  const c = createOwnedStepController({
    read: async () => 3,
    write: async () => { if (fail) throw boom; },
    notify: (reason, cause) => seen.push(cause),
    schedule: (fn) => fn(),
  });
  c.init(3);
  c.step(-1);
  await flush(); await flush(); await flush();
  fail = false;
  c.step(1);
  await flush(); await flush(); await flush();
  assert.equal(seen.length, 1, 'the successful chain notifies nothing at all');
});
