// Coordination around the Storage mutation core (docs/proposals/collection-storage.md).
//
// WHY THIS FILE EXISTS. Revision 3 of the proposal put EVERY ownership mutation under
// `withExclusiveCollectionWrites`. That self-deadlocks, and it would have hung the first ownership
// tap anyone made: the interactive steppers already run INSIDE the queue - OwnedControl enqueues on
// the collector-item key and calls the repository from within that callback - so the write is
// ADMITTED by the time the callback runs, and a barrier requested there waits for admitted work to
// drain, including itself.
//
// The rule that replaced it is one sentence: COORDINATION IS CHOSEN BY THE CALLING TIER; THE CORE
// NEVER ACQUIRES IT. These tests hold that rule to account, because it is invisible in a diff and
// catastrophic in the hand.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueWrite, withExclusiveCollectionWrites, withProfileSwitchWriteBarrier, settleCollectionWrites,
} from './collectionWrites.js';
import {
  planRemoval, removalStatements, clearAllocationsStatements, clearAllocationsForManyStatements,
  createUnfiledStatements,
} from './storageRepository.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

/* ---------------- the core acquires nothing ---------------- */

test('the core is coordination-free: every export is callable with no queue at all', () => {
  // If any of these reached for a barrier or a queue, this test would hang rather than fail - which
  // is exactly how the deadlock would have shipped. Calling them bare is the assertion.
  assert.deepEqual(planRemoval([{ id: 'a', container_id: 'c', qty: 2, is_system: 0 }], 1),
    { taken: [{ id: 'a', take: 1, left: 1 }], shortfall: 0 });
  assert.equal(removalStatements({ taken: [{ id: 'a', take: 1, left: 1 }] }).length, 1);
  assert.equal(clearAllocationsStatements('o1').length, 1);
  assert.equal(clearAllocationsForManyStatements(['o1', 'o2', 'o1']).length, 1);
  assert.equal(createUnfiledStatements('p1', 'u1', 'T').length, 1);
});

test('DOES NOT SELF-DEADLOCK: the core runs inside an enqueued write, as the steppers call it', async () => {
  // The exact production shape: OwnedControl enqueues on the collector-item key and calls the
  // repository from within that callback. If the core ever takes the exclusive barrier, this never
  // resolves.
  let ran = false;
  const p = enqueueWrite('profile|card|set|std', async () => {
    // Whatever the core does here must not need exclusivity.
    const plan = planRemoval([{ id: 'a1', container_id: 'u', qty: 3, is_system: 1 }], 2);
    assert.equal(plan.shortfall, 0);
    ran = true;
    return 'ok';
  });
  const settled = await Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), 1500))]);
  assert.equal(settled, 'ok', 'the write completed rather than waiting on itself');
  assert.equal(ran, true);
});

/* ---------------- ordering the tiers actually rely on ---------------- */

test('RAPID TAP: writes on one collector item run in order, never concurrently', async () => {
  // The stepper's whole correctness argument is that each write re-reads in its turn. Two taps
  // overlapping on one row would read the same "before" value and lose an increment.
  const order = [];
  let inFlight = 0;
  const tap = (n) => enqueueWrite('p|c|s|std', async () => {
    inFlight++;
    assert.equal(inFlight, 1, 'two writes on one row overlapped');
    await tick();
    order.push(n);
    inFlight--;
  });
  await Promise.all([tap(1), tap(2), tap(3)]);
  assert.deepEqual(order, [1, 2, 3], 'tap order is preserved');
});

test('SCANNER: a capture shares the stepper chain, so overlapping scans cannot lose an increment', async () => {
  // Scanner writes only ever INCREASE quantities, so they cannot strand an allocation - but two
  // captures of the same printing must still serialise, and they only do if the scanner builds the
  // SAME key the stepper does.
  const key = 'p1|card-x|001|std';
  let total = 0;
  const capture = () => enqueueWrite(key, async () => { const before = total; await tick(); total = before + 1; });
  await Promise.all([capture(), capture(), capture()]);
  assert.equal(total, 3, 'three captures, three copies - a read-modify-write that raced would lose one');
});

test('a DIFFERENT collector item is not blocked by a slow write on another', async () => {
  // Per-row chains, not a global lock: filing one card must not stall a stepper on a different one.
  const seen = [];
  const slow = enqueueWrite('p|c1|s|std', async () => { await new Promise((r) => setTimeout(r, 40)); seen.push('slow'); });
  const fast = enqueueWrite('p|c2|s|std', async () => { seen.push('fast'); });
  await Promise.all([slow, fast]);
  assert.deepEqual(seen, ['fast', 'slow'], 'the second row did not wait behind the first');
});

/* ---------------- the tier that DOES take the barrier ---------------- */

test('STEPPER vs BULK: a bulk command waits for an in-flight stepper, then excludes new ones', async () => {
  const events = [];
  let releaseStepper;
  const stepper = enqueueWrite('p|c|s|std', async () => {
    events.push('stepper:start');
    await new Promise((r) => { releaseStepper = r; });
    events.push('stepper:end');
  });
  await tick();                                   // let the stepper be admitted

  const bulk = withExclusiveCollectionWrites(async () => { events.push('bulk:run'); });
  await tick();
  assert.ok(!events.includes('bulk:run'), 'the bulk command must not start over an admitted write');

  // A write arriving AFTER the gate closed is parked - the holder must not wait for it, or it
  // would be waiting on something waiting on the holder.
  const parked = enqueueWrite('p|c|s|std', async () => { events.push('parked:run'); });

  releaseStepper();
  await bulk;
  assert.deepEqual(events.slice(0, 3), ['stepper:start', 'stepper:end', 'bulk:run'],
    'admitted work drains, THEN the holder runs');
  assert.ok(!events.includes('parked:run'), 'and work that arrived after the gate stayed parked');
  await parked;
  assert.ok(events.includes('parked:run'), 'released once the holder finished');
  await settleCollectionWrites();
});

test('PROFILE SWITCH uses the tolerant barrier, not the fail-closed bulk one', async () => {
  // Two semantics, two exported functions, deliberately - a caller has to NAME the tolerant path.
  // A profile switch must not fail closed behind a slow in-flight write; a bulk command must.
  assert.notEqual(withProfileSwitchWriteBarrier, withExclusiveCollectionWrites);
  const out = await withProfileSwitchWriteBarrier(async () => 'switched');
  assert.equal(out, 'switched');
  await settleCollectionWrites();
});

/* ---------------- the removal order the model depends on ---------------- */

test('removal takes from Unfiled first, then the fullest container, deterministically', async () => {
  const places = [
    { id: 'binder', container_id: 'b', qty: 3, is_system: 0 },
    { id: 'unfiled', container_id: 'u', qty: 2, is_system: 1 },
    { id: 'box', container_id: 'x', qty: 5, is_system: 0 },
  ];
  // Unfiled is unambiguous - those copies are in no stated place - so it goes first. Then the
  // fullest, so the same input always produces the same plan.
  const plan = planRemoval(places, 4);
  assert.deepEqual(plan.taken.map((t) => t.id), ['unfiled', 'box']);
  assert.equal(plan.taken[0].left, 0, 'Unfiled is emptied');
  assert.equal(plan.taken[1].left, 3, 'the remainder comes off the fullest');
  assert.equal(plan.shortfall, 0);

  // A removal larger than everything held reports a shortfall rather than inventing a negative.
  assert.equal(planRemoval(places, 99).shortfall, 89);
  // An emptied allocation is DELETED, never left at zero - CHECK (qty > 0) forbids the row, and a
  // zero-quantity place is a copy that is nowhere.
  const stmts = removalStatements(planRemoval(places, 2));
  assert.ok(stmts[0][0].startsWith('DELETE FROM storage_allocations'));
});
