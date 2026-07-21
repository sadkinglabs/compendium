// The ownership taxonomy - three states, one definition, both row paths.
//
// This exists because "owned" was a boolean computed two different ways in the same file, so
// {owned: 0, foil: 1} was "not owned" inside a set and "owned" under Unspecified. Earlier
// still, the filter and the completion tally disagreed, which hid a real card: Beta read
// 401/402 while "Not owned" returned nothing, because the missing card was owned in foil only.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownershipOf, ownershipOfRow, countsTowardCompletion, OWNERSHIP_STATES } from './ownership.js';

test('a non-foil copy is regular', () => {
  assert.equal(ownershipOf(1, 0), 'regular');
  assert.equal(ownershipOf(3, 5), 'regular', 'having foils too does not change it');
});

test('foil copies with no non-foil are foilOnly - real ownership, not progress', () => {
  assert.equal(ownershipOf(0, 1), 'foilOnly');
});

test('neither is missing', () => {
  assert.equal(ownershipOf(0, 0), 'missing');
  assert.equal(ownershipOf(undefined, undefined), 'missing');
  assert.equal(ownershipOf(null, null), 'missing');
});

test('the states are exhaustive and mutually exclusive', () => {
  const seen = new Set();
  for (const [o, f] of [[2, 0], [0, 2], [0, 0], [1, 1]]) seen.add(ownershipOf(o, f));
  for (const s of seen) assert.ok(OWNERSHIP_STATES.includes(s), `${s} is not a declared state`);
});

test('only regular counts toward completion', () => {
  assert.equal(countsTowardCompletion('regular'), true);
  assert.equal(countsTowardCompletion('foilOnly'), false, 'owner ruling: foils are not progress');
  assert.equal(countsTowardCompletion('missing'), false);
});

test('a foil-only card is NOT claimed to be un-owned', () => {
  // The whole point of three states. The old pair had to call this "Not owned", which is
  // false - the user is holding the card.
  const state = ownershipOf(0, 2);
  assert.notEqual(state, 'missing');
  assert.equal(countsTowardCompletion(state), false);
});

test('ownershipOfRow reads the {owned, foil} row shape', () => {
  assert.equal(ownershipOfRow({ owned: 0, foil: 1 }), 'foilOnly');
  assert.equal(ownershipOfRow(undefined), 'missing');
});

test('string quantities from the database do not break the classification', () => {
  assert.equal(ownershipOf('2', '0'), 'regular');
  assert.equal(ownershipOf('0', '1'), 'foilOnly');
});
