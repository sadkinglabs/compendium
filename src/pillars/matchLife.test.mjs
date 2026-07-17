// Characterization fixtures for the life/max model (src/pillars/matchLife.js).
// Run: npm run test:ui   (node --test)
//
// STAGE A. These pin the CURRENT, verbatim behavior of the life arithmetic, derived by
// direct inspection of LifeCounter.jsx (change L372-375, setMax L403, init L47/50-51) - NOT
// by copying that logic into a shim. They execute the new module; equivalence to the
// component rests on (1) the extraction being a literal move, reviewable line-for-line in
// the same commit, and (2) on-device observation (see the proposal's verification plan).
//
// Deliberately NOT asserted here: "life never goes below zero" and "max never exceeds 20".
// Under Stage A's verbatim open-delta / passthrough contracts those do NOT universally hold
// (an unreachable -5 delta, or a tampered resume snapshot, are outside the UI but inside the
// function). They become true - and get asserted - in Stage B, which is the whole point of
// closing the domain and validating restore. This file is REPLACED with the Stage B contract
// in the next commit; keeping it verbatim first is what proves Stage A changed no behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initSide, restoreSide, stepLife, maxSide } from './matchLife.js';

// --- stepLife: the tap arithmetic, verbatim -------------------------------------

test('tap down moves life and reports changed', () => {
  assert.deepEqual(stepLife({ life: 20, max: 20 }, -1), { side: { life: 19, max: 20 }, changed: true, refused: false });
});

test('tap up caps at max as a no-op (dd.tap already counted it)', () => {
  // L374/L375: next = min(20, 21) = 20 === life -> changed:false. Not refused (life > 0).
  assert.deepEqual(stepLife({ life: 20, max: 20 }, +1), { side: { life: 20, max: 20 }, changed: false, refused: false });
});

test('tap down to exactly zero is allowed and changed', () => {
  assert.deepEqual(stepLife({ life: 1, max: 20 }, -1), { side: { life: 0, max: 20 }, changed: true, refused: false });
});

test('the door holds: minus at/under zero is refused, side unchanged (L372)', () => {
  assert.deepEqual(stepLife({ life: 0, max: 20 }, -1), { side: { life: 0, max: 20 }, changed: false, refused: true });
});

test('recovery from zero is a normal changed step, not refused', () => {
  assert.deepEqual(stepLife({ life: 0, max: 20 }, +1), { side: { life: 1, max: 20 }, changed: true, refused: false });
});

test('STAGE A verbatim quirk: an unreachable big negative delta is NOT floored', () => {
  // The UI only ever sends -1/+1, so this never happens in the app - but the verbatim
  // arithmetic min(max, life+delta) computes it, and Stage A must characterize the truth,
  // not a wish. Stage B closes the domain so this input throws instead.
  assert.deepEqual(stepLife({ life: 1, max: 20 }, -5), { side: { life: -4, max: 20 }, changed: true, refused: false });
});

// --- maxSide: setMax arithmetic, verbatim ---------------------------------------

test('maxSide lowers max and pulls life down to fit (L403)', () => {
  assert.deepEqual(maxSide({ life: 15, max: 20 }, 10), { life: 10, max: 10 });
});

test('maxSide raising max leaves life alone', () => {
  assert.deepEqual(maxSide({ life: 5, max: 20 }, 18), { life: 5, max: 18 });
});

test('STAGE A verbatim quirk: maxSide does NOT bound max to 20 (the stepper does, upstream)', () => {
  assert.deepEqual(maxSide({ life: 5, max: 20 }, 25), { life: 5, max: 25 });
});

// --- initSide / restoreSide: the seed + resume entrances, verbatim --------------

test('initSide seeds life = max from the (already-clamped) start', () => {
  assert.deepEqual(initSide(20), { life: 20, max: 20 });
});

test('STAGE A verbatim quirk: initSide passthrough does not clamp (caller clamps at L47)', () => {
  assert.deepEqual(initSide(999), { life: 999, max: 999 });
});

test('restoreSide reconstructs a normal in-range snapshot unchanged', () => {
  assert.deepEqual(restoreSide({ life: 5, max: 10 }), { life: 5, max: 10 });
});

test('STAGE A verbatim quirk: restoreSide passes an out-of-range snapshot THROUGH (the bug Stage B closes)', () => {
  // This documents the live defect (metric #9): a tampered pMax:999 resumes uncapped today.
  assert.deepEqual(restoreSide({ life: 20, max: 999 }), { life: 20, max: 999 });
});
