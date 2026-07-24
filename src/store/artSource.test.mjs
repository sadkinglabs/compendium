// The pure card-art reducer (src/store/artSource.js) - proved without a DOM. Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, reduce, visibleCandidate } from './artSource.js';

const local = (src = 'file://a') => ({ kind: 'local', src });
const remote = (src = 'https://cdn/a') => ({ kind: 'remote', src });

test('initial: peeked -> shown flash-free; a fresh key -> resolving; a falsy key -> broken', () => {
  assert.deepEqual(initial('k', remote()), { key: 'k', phase: 'shown', cand: remote(), gen: 0 });
  assert.deepEqual(initial('k', null), { key: 'k', phase: 'resolving', cand: null, gen: 0 });
  assert.deepEqual(initial(null, null), { key: null, phase: 'broken', cand: null, gen: 0 });
});

test('KEY resets state (including a stuck broken) - the CardArt "broken retained across cards" defect', () => {
  const broken = { key: 'a', phase: 'broken', cand: null, gen: 3 };
  assert.deepEqual(reduce(broken, { type: 'KEY', key: 'b', peeked: null }), { key: 'b', phase: 'resolving', cand: null, gen: 0 });
  assert.deepEqual(reduce(broken, { type: 'KEY', key: 'b', peeked: remote() }), { key: 'b', phase: 'shown', cand: remote(), gen: 0 });
});

test('RESOLVED shows the candidate, only while resolving/quarantining', () => {
  const resolving = initial('k', null);
  assert.equal(reduce(resolving, { type: 'RESOLVED', key: 'k', cand: remote() }).phase, 'shown');
  const shown = { key: 'k', phase: 'shown', cand: remote(), gen: 0 };
  assert.deepEqual(reduce(shown, { type: 'RESOLVED', key: 'k', cand: local() }), shown, 'a RESOLVED while shown is ignored');
});

test('RESOLVED null (zero-image / falsy) -> broken, deterministic fallback only', () => {
  const resolving = initial('k', null);
  assert.deepEqual(reduce(resolving, { type: 'RESOLVED', key: 'k', cand: null }), { key: 'k', phase: 'broken', cand: null, gen: 0 });
});

test('a quarantine re-resolve to the SAME local uri still bumps gen (forces an <img> remount)', () => {
  const quar = { key: 'k', phase: 'quarantining', cand: local('file://x'), gen: 1 };
  const next = reduce(quar, { type: 'RESOLVED', key: 'k', cand: local('file://x') });
  assert.deepEqual(next, { key: 'k', phase: 'shown', cand: local('file://x'), gen: 2 });
});

test('IMG_ERROR on a LOCAL candidate -> quarantining (delete + retry)', () => {
  const shown = { key: 'k', phase: 'shown', cand: local(), gen: 0 };
  assert.equal(reduce(shown, { type: 'IMG_ERROR', key: 'k' }).phase, 'quarantining');
});

test('IMG_ERROR on a REMOTE candidate -> broken (Phase 5: no bundled legacy, deterministic fallback shows)', () => {
  const shown = { key: 'k', phase: 'shown', cand: remote(), gen: 0 };
  assert.deepEqual(reduce(shown, { type: 'IMG_ERROR', key: 'k' }), { key: 'k', phase: 'broken', cand: null, gen: 0 });
});

test('a stale async result for a SUPERSEDED key is dropped (the generation guard)', () => {
  const state = initial('B', null);   // reducer is now bound to B
  // a late RESOLVED/IMG_ERROR produced for the old key A must not touch B's state
  assert.deepEqual(reduce(state, { type: 'RESOLVED', key: 'A', cand: remote() }), state);
  assert.deepEqual(reduce(state, { type: 'IMG_ERROR', key: 'A' }), state);
});

test('visibleCandidate returns null on a key mismatch (no stale paint on a recycled tile frame)', () => {
  const stateA = { key: 'A', phase: 'shown', cand: remote('https://cdn/A'), gen: 0 };
  assert.equal(visibleCandidate(stateA, 'A'), stateA.cand, 'matching key paints its candidate');
  assert.equal(visibleCandidate(stateA, 'B'), null, 'a tile flipped to B must NOT paint A for a frame');
});
