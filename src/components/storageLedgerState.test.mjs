import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLedgerTarget } from './storageLedgerState.js';

const ledger = () => ({
  total: 4,
  places: [
    { id: 'unfiled', is_system: 1, qty: 4 },
    { id: 'binder', is_system: 0, qty: 0 },
    { id: 'deck', is_system: 0, qty: 0 },
  ],
});

test('a card-ledger target derives the live Unfiled remainder without touching other places', () => {
  const once = applyLedgerTarget(ledger(), 'binder', 1);
  const twice = applyLedgerTarget(once, 'deck', 2);
  assert.deepEqual(twice.places.map((p) => [p.id, p.qty]), [
    ['unfiled', 1], ['binder', 1], ['deck', 2],
  ]);
  assert.equal(twice.places.reduce((n, p) => n + p.qty, 0), twice.total);
});

test('a second target uses the rendered committed value rather than the pre-write quantity', () => {
  const once = applyLedgerTarget(ledger(), 'binder', 1);
  const twice = applyLedgerTarget(once, 'binder', 2);
  assert.deepEqual(twice.places.map((p) => p.qty), [2, 2, 0]);
});

test('invalid or system targets cannot manufacture a filing state', () => {
  const before = ledger();
  assert.equal(applyLedgerTarget(before, 'missing', 1), before);
  assert.equal(applyLedgerTarget(before, 'unfiled', 1), before);
  assert.equal(applyLedgerTarget(before, 'binder', -1), before);
});
