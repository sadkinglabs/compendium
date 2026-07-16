import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingEntries } from './changelog.js';
import { CHANGELOG } from '../content/changelog.js';

// This file lives in src/store/ so `npm run test:query` (src/store/**/*.test.mjs)
// actually discovers it. The proposal originally put it in src/content/, which
// is covered by NO glob - test:codex is scripts/codex/**, test:ui is
// src/pillars/**. It would have passed green forever by never running. If you
// move this file, check the globs in package.json first.

const E = (build) => ({ build, version: 'x', changes: [] });
// Newest-first, the order src/content/changelog.js is authored in.
const LOG = [E(38), E(37), E(36), E(35), E(10)];
const builds = (r) => r.map((e) => e.build);

test('fresh install returns every entry at or below current', () => {
  assert.deepEqual(builds(pendingEntries(LOG, null, 38)), [38, 37, 36, 35, 10]);
});

test('catch-up returns only unseen entries, newest first', () => {
  assert.deepEqual(builds(pendingEntries(LOG, 36, 38)), [38, 37]);
});

// The revision-2 rule, pinned. seen=35, current=37, and 37 has no entry of its
// own: build 36's notes are real and unseen, and the absence of notes for 37 is
// not a reason to withhold them. An earlier draft of this proposal asserted the
// opposite ("current build with no entry returns []"), which would have made the
// implementation and the tests contradict each other.
test('current build with no entry still returns earlier unseen entries', () => {
  const log = [E(36), E(35)];
  assert.deepEqual(builds(pendingEntries(log, 35, 37)), [36]);
});

test('entries authored ahead of the shipped build are excluded', () => {
  // Notes for 38 are written; the running APK is 36. 38 stays invisible.
  assert.deepEqual(builds(pendingEntries(LOG, 36, 36)), []);
  assert.deepEqual(builds(pendingEntries(LOG, 35, 36)), [36]);
});

test('seen equal to current returns nothing', () => {
  assert.deepEqual(pendingEntries(LOG, 38, 38), []);
});

test('downgrade returns nothing', () => {
  // Sideloading an older APK must not replay notes, and must not stamp the
  // high-water mark back down (no dismissal fires if nothing is shown).
  assert.deepEqual(pendingEntries(LOG, 38, 35), []);
});

test('non-numeric current returns empty rather than throwing', () => {
  assert.deepEqual(pendingEntries(LOG, 36, Number('nonsense')), []);
  assert.deepEqual(pendingEntries(LOG, 36, undefined), []);
});

// THE BOUNDARY GUARD. Under string comparison '9' > '35' is true, so a gate that
// forgot Number() would return [] here instead of every entry in 10..35. Every
// other case in this file passes with two-digit builds either way; this is the
// one that fails. Do not delete it because it "looks like the catch-up test".
test('numeric comparison, not lexicographic', () => {
  assert.deepEqual(builds(pendingEntries(LOG, 9, 35)), [35, 10]);
  // and the same defect seen from the other side
  assert.deepEqual(builds(pendingEntries([E(9)], null, 35)), [9]);
});

// Guards the DATA, not the logic: a bad edit to src/content/changelog.js is the
// likeliest future defect here, and every other test in this file uses fixtures.
test('changelog data is well formed', () => {
  assert.ok(CHANGELOG.length > 0, 'changelog must not be empty');
  const seen = new Set();
  let prev = Infinity;
  for (const e of CHANGELOG) {
    assert.ok(Number.isInteger(e.build), `build must be an integer: ${JSON.stringify(e.build)}`);
    assert.ok(!seen.has(e.build), `duplicate build ${e.build}`);
    seen.add(e.build);
    assert.ok(e.build < prev, `entries must be newest-first: ${e.build} follows ${prev}`);
    prev = e.build;
    assert.ok(typeof e.version === 'string' && e.version, `build ${e.build} needs a version`);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `build ${e.build} needs an ISO date`);
    for (const c of e.changes || []) {
      assert.ok(['added', 'changed', 'fixed'].includes(c.kind), `build ${e.build}: bad kind "${c.kind}"`);
      assert.ok(typeof c.text === 'string' && c.text, `build ${e.build}: a change needs text`);
    }
  }
});
