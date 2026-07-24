// Pure tests for the alphabet-rail jump coordinator. Run: npm run test:ui
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialRailState as init, railReducer as r, shouldCommit } from './alphabetRailState.js';

const run = (state, ...events) => events.reduce(r, state);
const pick = (over = {}) => ({ type: 'PICK', requestId: 1, signature: 'sig', modelKey: 'mk', letter: 'M', idx: 300, ...over });

test('a pick waits while the rendered count has not reached the target index', () => {
  const s = run(init, pick(), { type: 'OBSERVE', count: 100, signature: 'sig', modelKey: 'mk' });
  assert.equal(shouldCommit(s), false, 'count 100 <= idx 300 -> not ready');
  assert.equal(s.pending.letter, 'M');
});

test('once the growth paint passes the index, the pick is ready to commit', () => {
  const s = run(init, pick(), { type: 'OBSERVE', count: 301, signature: 'sig', modelKey: 'mk' });
  assert.equal(shouldCommit(s), true, 'count 301 > idx 300 -> ready');
});

test('already-rendered (set drill / small result) is ready on the first observe', () => {
  const s = run(init, pick({ idx: 4 }), { type: 'OBSERVE', count: 50, signature: 'sig', modelKey: 'mk' });
  assert.equal(shouldCommit(s), true);
});

test('last pick wins - a newer pick supersedes the older, which never commits', () => {
  const s = run(init,
    pick({ requestId: 1, letter: 'M', idx: 300 }),
    pick({ requestId: 2, letter: 'T', idx: 800 }),
    { type: 'OBSERVE', count: 900, signature: 'sig', modelKey: 'mk' });
  assert.equal(s.pending.requestId, 2);
  assert.equal(s.pending.letter, 'T');
  // The stale requestId 1 cannot commit.
  const s2 = r(s, { type: 'COMMIT_OK', requestId: 1 });
  assert.equal(s2.committedLetter, null, 'stale commit ignored');
  const s3 = r(s, { type: 'COMMIT_OK', requestId: 2 });
  assert.equal(s3.committedLetter, 'T');
});

test('a signature change cancels a pending pick', () => {
  const s = run(init, pick(), { type: 'OBSERVE', count: 400, signature: 'DIFFERENT', modelKey: 'mk' });
  assert.equal(s.pending, null);
  assert.equal(shouldCommit(s), false);
});

test('a modelKey change (membership/order) cancels, even under the same signature', () => {
  const s = run(init, pick(), { type: 'OBSERVE', count: 400, signature: 'sig', modelKey: 'MK2' });
  assert.equal(s.pending, null);
});

test('an equivalent re-allocation (same signature AND modelKey) does NOT cancel', () => {
  const s = run(init, pick(), { type: 'OBSERVE', count: 400, signature: 'sig', modelKey: 'mk' });
  assert.equal(shouldCommit(s), true, 'same world -> the jump survives the rerender');
});

test('a missing anchor drops the pick with no announcement (fail closed)', () => {
  const s = run(init, pick(), { type: 'OBSERVE', count: 400, signature: 'sig', modelKey: 'mk' },
    { type: 'COMMIT_MISS', requestId: 1 });
  assert.equal(s.pending, null);
  assert.equal(s.committedLetter, null, 'no announcement on a missing anchor');
});

test('commit is exactly-once: a second COMMIT_OK after success changes nothing', () => {
  const s = run(init, pick(), { type: 'OBSERVE', count: 400, signature: 'sig', modelKey: 'mk' },
    { type: 'COMMIT_OK', requestId: 1 });
  assert.equal(s.committedLetter, 'M');
  assert.equal(s.pending, null);
  const again = r(s, { type: 'COMMIT_OK', requestId: 1 });
  assert.deepEqual(again, s, 'no pending -> no-op');
});

test('COMMIT_OK before ready is ignored (cannot commit an unrendered target)', () => {
  const s = run(init, pick(), { type: 'OBSERVE', count: 100, signature: 'sig', modelKey: 'mk' },
    { type: 'COMMIT_OK', requestId: 1 });
  assert.equal(s.committedLetter, null);
  assert.equal(s.pending.letter, 'M', 'pick still waiting');
});

test('CANCEL clears a pending pick (duck / teardown / unmount)', () => {
  const s = run(init, pick(), { type: 'CANCEL' });
  assert.equal(s.pending, null);
  assert.equal(shouldCommit(s), false);
});
