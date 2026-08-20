// The commit half of drag reordering: what a list becomes when a row is dropped elsewhere.
//
// The geometry tests that used to sit beside these (crossing points, row pitches, drop offsets,
// pinned-run bounds) went with the hand-rolled gesture on 2026-08-21 - dnd-kit owns that arithmetic
// now. What remains is the part the library never sees: the ordering handed to the repositories.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reorderList } from './reorderModel.js';

test('reorderList splices out then in - `to` is a position in the list the row has already left', () => {
  const l = ['a', 'b', 'c', 'd'];
  assert.deepEqual(reorderList(l, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(reorderList(l, 3, 1), ['a', 'd', 'b', 'c']);
  assert.deepEqual(reorderList(l, 0, 3), ['b', 'c', 'd', 'a']);
});

test('reorderList returns the SAME array for a no-op, so a caller can skip the write', () => {
  const l = ['a', 'b', 'c'];
  assert.equal(reorderList(l, 1, 1), l);
  assert.equal(reorderList(l, 1, 9), l);
  assert.equal(reorderList(l, -1, 0), l);
  assert.equal(reorderList(l, 0, null), l);
  assert.deepEqual(reorderList(l, 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(l, ['a', 'b', 'c'], 'and it never mutates the input');
});
