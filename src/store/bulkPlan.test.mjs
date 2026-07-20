import test from 'node:test';
import assert from 'node:assert/strict';
import { planBulk, planUndo, resolveUndo, describePlan } from './bulkPlan.js';

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

test('undo restores rows that are untouched since the write', () => {
  const plan = planBulk('add1', [{ cardId: 'a', set: '001' }], ledger({ 'a|001': 2 }));
  const undo = planUndo(plan.changes);
  const { safe, conflicts } = resolveUndo(undo, ledger({ 'a|001': 3 }));   // still 3, as committed
  assert.deepEqual(safe, [{ cardId: 'a', set: '001', to: 2 }]);
  assert.equal(conflicts.length, 0);
});

test('undo REFUSES a row edited since the write, and reports it', () => {
  // The whole reason undo is not an inverse delta. An inverse would blindly subtract 1 and
  // silently destroy the user's intervening edit.
  const plan = planBulk('add1', [{ cardId: 'a', set: '001' }], ledger({ 'a|001': 2 }));
  const undo = planUndo(plan.changes);
  const { safe, conflicts } = resolveUndo(undo, ledger({ 'a|001': 7 }));   // user edited it
  assert.equal(safe.length, 0);
  assert.deepEqual(conflicts, [{ cardId: 'a', set: '001', expect: 3, found: 7, to: 2 }]);
});

test('undo of ensure1 restores only the rows it actually raised', () => {
  const q = ledger({ 'a|001': 0, 'b|001': 3 });
  const plan = planBulk('ensure1', [{ cardId: 'a', set: '001' }, { cardId: 'b', set: '001' }], q);
  const undo = planUndo(plan.changes);
  assert.equal(undo.restores.length, 1, 'b was never changed, so undo must not touch it');
  const { safe } = resolveUndo(undo, ledger({ 'a|001': 1, 'b|001': 3 }));
  assert.deepEqual(safe, [{ cardId: 'a', set: '001', to: 0 }]);
});

test('undo is built from what committed, not from what was intended', () => {
  const plan = planBulk('add1', [
    { cardId: 'a', set: '001' }, { cardId: 'b', set: '001' },
  ], ledger({ 'a|001': 0, 'b|001': 0 }));
  const committed = plan.changes.slice(0, 1);        // only the first row reached the db
  const undo = planUndo(committed);
  assert.equal(undo.restores.length, 1);
  assert.equal(undo.restores[0].cardId, 'a');
});

test('describePlan counts changed rows, not selected rows', () => {
  const q = ledger({ 'a|001': 0, 'b|001': 3 });
  const plan = planBulk('ensure1', [{ cardId: 'a', set: '001' }, { cardId: 'b', set: '001' }], q);
  assert.equal(describePlan(plan), 'Marked 1 card as owned');
});

test('an unknown operation is rejected rather than guessed', () => {
  assert.throws(() => planBulk('double', [{ cardId: 'a', set: '001' }], ledger({})), /unknown bulk op/);
});
