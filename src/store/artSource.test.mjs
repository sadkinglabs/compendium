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

/* ------------------------------------------------------------------ */
/* paintState - the no-refade decision (art-first-paint Increment 1)   */
/* ------------------------------------------------------------------ */
import { paintState } from './artSource.js';

test('a painted key stays HIDDEN until its own decode, but carries NO ceremony', () => {
  // Two owner rulings, 2026-08-15: (1) pre-load visibility painted the WebView's broken-image
  // glyph (Codex Cards) - visibility gates on THIS identity's load, no exceptions; (2) available
  // art shows immediately once rastered - the shimmer/fade exist to cover a DOWNLOAD, nothing else.
  const p = paintState({ src: 'cap://art/k', gen: 0, loadedSrc: null, loadedGen: -1, painted: true });
  assert.equal(p.shown, false, 'no identity is visible before ITS load event');
  assert.equal(p.shimmer, false, 'warm keys must not replay the loading affordance');
  assert.equal(p.transition, 'none', 'available art appears the frame it rasters - no fade');
});

test('a LOCAL candidate (on-device cached file) is available: no shimmer, no fade, still load-gated', () => {
  const waiting = paintState({ src: 'cap://f/k', gen: 0, loadedSrc: null, loadedGen: -1, painted: false, local: true });
  assert.equal(waiting.shown, false, 'even a local file waits for its own decode (glyph guard)');
  assert.equal(waiting.shimmer, false, 'a local file is not downloading - nothing to advertise');
  assert.equal(waiting.transition, 'none');
  const done = paintState({ src: 'cap://f/k', gen: 0, loadedSrc: 'cap://f/k', loadedGen: 0, painted: false, local: true });
  assert.equal(done.shown, true, 'shows the frame it rasters');
});

test('REVERSE REGRESSION: an unpainted key still shimmers and still fades', () => {
  // The criterion that matters most: a genuine first load - and equally a re-download after a
  // quarantine, since quarantine evicts painted - must keep its loading affordance, or a slow CDN
  // fetch looks like a broken image.
  const p = paintState({ src: 'cap://art/k', gen: 0, loadedSrc: null, loadedGen: -1, painted: false });
  assert.equal(p.shown, false, 'not decoded yet, not painted: must not be visible');
  assert.equal(p.shimmer, true, 'the loading affordance must be present');
  assert.equal(p.transition, 'opacity .3s ease', 'and the decode must still fade in');
});

test('an unpainted key becomes shown when THIS src+gen has decoded', () => {
  const p = paintState({ src: 'cap://art/k', gen: 2, loadedSrc: 'cap://art/k', loadedGen: 2, painted: false });
  assert.equal(p.shown, true);
  assert.equal(p.shimmer, false);
});

test('a quarantine re-resolve (same src, NEW gen) is treated as undecoded - the stale-frame guard holds', () => {
  const p = paintState({ src: 'cap://art/k', gen: 3, loadedSrc: 'cap://art/k', loadedGen: 2, painted: false });
  assert.equal(p.shown, false, 'gen mismatch means the fresh <img> has not decoded');
  assert.equal(p.shimmer, true);
});

test('no src means nothing to show and nothing to shimmer over', () => {
  for (const painted of [true, false]) {
    const p = paintState({ src: null, gen: 0, loadedSrc: null, loadedGen: -1, painted });
    assert.equal(p.shown, false);
    assert.equal(p.shimmer, false, 'a shimmer with no candidate would advertise a load that is not happening');
  }
});
