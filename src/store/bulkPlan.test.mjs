import test from 'node:test';
import assert from 'node:assert/strict';
import { planBulk, planUndo, classifyUndoOutcome, summarizePlan } from './bulkPlan.js';

// qtyOf stub: a map keyed the same way the real ledger is keyed (card + printing).
const ledger = (obj) => (cardId, set) => obj[`${cardId}|${set}`] || 0;

test('add1 raises every selected row', () => {
  const q = ledger({ 'a|001': 0, 'b|001': 3 });
  const plan = planBulk('add1', [{ cardId: 'a', set: '001' }, { cardId: 'b', set: '001' }], q);
  assert.deepEqual(plan.changes, [
    { cardId: 'a', set: '001', before: 0, after: 1 },
    { cardId: 'b', set: '001', before: 3, after: 4 },
  ]);
  assert.equal(plan.unchanged, 0);
});

test('ensure1 leaves already-owned rows OUT of the plan', () => {
  // The distinction that justifies having two operations at all: a card owned 3 times is
  // untouched, and must not appear in the plan or it would be over-reported and mis-undone.
  const q = ledger({ 'a|001': 0, 'b|001': 3, 'c|001': 1 });
  const plan = planBulk('ensure1', [
    { cardId: 'a', set: '001' }, { cardId: 'b', set: '001' }, { cardId: 'c', set: '001' },
  ], q);
  assert.deepEqual(plan.changes, [{ cardId: 'a', set: '001', before: 0, after: 1 }]);
  assert.equal(plan.unchanged, 2, 'b and c were already satisfied');
});

test('remove1 clamps at zero and reports the no-ops', () => {
  const q = ledger({ 'a|001': 1, 'b|001': 0 });
  const plan = planBulk('remove1', [{ cardId: 'a', set: '001' }, { cardId: 'b', set: '001' }], q);
  assert.deepEqual(plan.changes, [{ cardId: 'a', set: '001', before: 1, after: 0 }]);
  assert.equal(plan.unchanged, 1, 'cannot remove from a row already at zero');
});

test('the same printing selected twice is written once', () => {
  // Two writes to one row in a single transaction would make the second row's "before" the
  // first one's result, which would corrupt undo.
  const q = ledger({ 'a|001': 0 });
  const plan = planBulk('add1', [{ cardId: 'a', set: '001' }, { cardId: 'a', set: '001' }], q);
  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.changes[0], { cardId: 'a', set: '001', before: 0, after: 1 });
});

test('the same card in different printings is two independent rows', () => {
  const q = ledger({ 'a|001': 0, 'a|002': 5 });
  const plan = planBulk('add1', [{ cardId: 'a', set: '001' }, { cardId: 'a', set: '002' }], q);
  assert.equal(plan.changes.length, 2);
  assert.deepEqual(plan.changes.map((c) => c.after), [1, 6]);
});

test("the Unspecified printing ('') is a real row, not a missing value", () => {
  const q = ledger({ 'a|': 2 });
  const plan = planBulk('add1', [{ cardId: 'a', set: '' }], q);
  assert.deepEqual(plan.changes, [{ cardId: 'a', set: '', before: 2, after: 3 }]);
});

test('an undo record carries the guard value the restore is conditional on', () => {
  const plan = planBulk('add1', [{ cardId: 'a', set: '001' }], ledger({ 'a|001': 2 }));
  const undo = planUndo(plan.changes);
  assert.deepEqual(undo.restores, [{ cardId: 'a', set: '001', expect: 3, to: 2 }]);
});

test('undo reports applied from the read-back AFTER its transaction', () => {
  const plan = planBulk('add1', [{ cardId: 'a', set: '001' }], ledger({ 'a|001': 2 }));
  const undo = planUndo(plan.changes);
  // The guarded statement matched, so the row now reads back at its original value.
  const { applied, conflicts } = classifyUndoOutcome(undo, ledger({ 'a|001': 2 }));
  assert.deepEqual(applied, [{ cardId: 'a', set: '001', to: 2 }]);
  assert.equal(conflicts.length, 0);
});

test('undo reports a conflict when the guard declined to touch an edited row', () => {
  // The lost-update this design exists to prevent. The row was edited after the bulk write,
  // so the conditional restore matched nothing and the read-back still shows the user's
  // value. An inverse delta would have blindly subtracted 1 and destroyed it.
  const plan = planBulk('add1', [{ cardId: 'a', set: '001' }], ledger({ 'a|001': 2 }));
  const undo = planUndo(plan.changes);
  const { applied, conflicts } = classifyUndoOutcome(undo, ledger({ 'a|001': 7 }));
  assert.equal(applied.length, 0, "the user's edit survived");
  assert.deepEqual(conflicts, [{ cardId: 'a', set: '001', expect: 3, found: 7, to: 2 }]);
});

test('classification is post-hoc, so it cannot bless a row it is about to lose', () => {
  // Guarding before the write would classify from a value that can go stale in the gap.
  // Here the pre-write value matched `expect` and the post-write read-back does not, and the
  // row is still correctly reported as a conflict rather than as applied.
  const undo = { restores: [{ cardId: 'a', set: '001', expect: 3, to: 2 }] };
  const { applied, conflicts } = classifyUndoOutcome(undo, ledger({ 'a|001': 3 }));
  assert.equal(applied.length, 0);
  assert.equal(conflicts[0].found, 3, 'the row never moved to `to`, so it was not restored');
});

test('undo of ensure1 covers only the rows it actually raised', () => {
  const q = ledger({ 'a|001': 0, 'b|001': 3 });
  const plan = planBulk('ensure1', [{ cardId: 'a', set: '001' }, { cardId: 'b', set: '001' }], q);
  const undo = planUndo(plan.changes);
  assert.equal(undo.restores.length, 1, 'b was never changed, so undo must not touch it');
  const { applied } = classifyUndoOutcome(undo, ledger({ 'a|001': 0, 'b|001': 3 }));
  assert.deepEqual(applied, [{ cardId: 'a', set: '001', to: 0 }]);
});

test('an empty undo record classifies cleanly', () => {
  const { applied, conflicts } = classifyUndoOutcome(planUndo([]), ledger({}));
  assert.deepEqual(applied, []);
  assert.deepEqual(conflicts, []);
});

test('summarizePlan returns counts, not prose', () => {
  // Past-tense copy must be formed from a confirmed repository result. If this module
  // returned "Added 1 to 42 cards", a caller could announce durable work that never landed.
  const q = ledger({ 'a|001': 0, 'b|001': 3 });
  const plan = planBulk('ensure1', [{ cardId: 'a', set: '001' }, { cardId: 'b', set: '001' }], q);
  assert.deepEqual(summarizePlan(plan), { op: 'ensure1', changed: 1, unchanged: 1 });
});

test('an unknown operation is rejected rather than guessed', () => {
  assert.throws(() => planBulk('double', [{ cardId: 'a', set: '001' }], ledger({})), /unknown bulk op/);
});
