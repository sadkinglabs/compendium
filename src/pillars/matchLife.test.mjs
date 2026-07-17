// Fixtures for the life/max safety boundary (src/pillars/matchLife.js).
// Run: npm run test:ui   (node --test)
//
// STAGE B. Two jobs: (1) pin the invariant this module exists to guarantee - 1<=max<=20 and
// 0<=life<=max at EVERY entrance - because it protects a game rule (life <= 20) that a corrupt
// resume snapshot could otherwise break; (2) lock the closed tap domain and the fail-loud
// guards, which are what make the invariant hold for every invocation rather than just the
// reachable ones. The reachable ±1 tap arithmetic is IDENTICAL to Stage A (same cap, same
// floor, same no-op) - the change is that out-of-range and non-finite inputs are now closed
// off instead of computed.
//
// NOT covered here (honest, mirroring ddArming.test.mjs): the numeral animation, haptics, and
// pointer hit-testing are DOM/compositor behavior with no harness in this repo. Verified on
// device; see the proposal's verification plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initSide, restoreSide, applyStep, applyMax, LIFE_CAP, MIN_MAX } from './matchLife.js';

/** The invariant, as a reusable assertion. */
function assertInvariant(side, ctx = '') {
  assert.ok(Number.isFinite(side.life) && Number.isFinite(side.max), `finite ${ctx}`);
  assert.ok(side.max >= MIN_MAX && side.max <= LIFE_CAP, `max in [1,20] ${ctx}: ${side.max}`);
  assert.ok(side.life >= 0 && side.life <= side.max, `life in [0,max] ${ctx}: ${JSON.stringify(side)}`);
}

// --- applyStep: reachable arithmetic (unchanged from Stage A) --------------------

test('tap down moves life and reports changed', () => {
  assert.deepEqual(applyStep({ life: 20, max: 20 }, -1), { side: { life: 19, max: 20 }, changed: true, refused: false });
});

test('tap up caps at max as a no-op (dd.tap already counted it)', () => {
  assert.deepEqual(applyStep({ life: 20, max: 20 }, +1), { side: { life: 20, max: 20 }, changed: false, refused: false });
});

test('tap down to exactly zero is allowed and changed', () => {
  assert.deepEqual(applyStep({ life: 1, max: 20 }, -1), { side: { life: 0, max: 20 }, changed: true, refused: false });
});

test('the door holds: minus at/under zero is refused, side unchanged', () => {
  assert.deepEqual(applyStep({ life: 0, max: 20 }, -1), { side: { life: 0, max: 20 }, changed: false, refused: true });
});

test('recovery from zero is a normal changed step, not refused', () => {
  assert.deepEqual(applyStep({ life: 0, max: 20 }, +1), { side: { life: 1, max: 20 }, changed: true, refused: false });
});

// --- applyStep: the CLOSED DOMAIN (Stage B) -------------------------------------

test('applyStep throws on any dir that is not -1 | 1', () => {
  for (const bad of [0, -5, 2, +2, 1.5, '1', NaN, Infinity, null, undefined]) {
    assert.throws(() => applyStep({ life: 10, max: 20 }, bad), RangeError, `dir=${JSON.stringify(bad)}`);
  }
});

test('applyStep throws on a non-finite side field', () => {
  assert.throws(() => applyStep({ life: NaN, max: 20 }, -1), TypeError);
  assert.throws(() => applyStep({ life: 10, max: Infinity }, -1), TypeError);
});

// --- initSide: the seed entrance, now capped ------------------------------------

test('initSide seeds life = max from an in-range seed', () => {
  assert.deepEqual(initSide(20), { life: 20, max: 20 });
});

test('initSide clamps an over-cap seed to 20 (Stage A passed 999 through; now closed)', () => {
  assert.deepEqual(initSide(999), { life: 20, max: 20 });
});

test('initSide floors a below-min seed to MIN_MAX', () => {
  assert.deepEqual(initSide(0), { life: 1, max: 1 });
});

test('initSide throws on non-finite / non-number seed', () => {
  for (const bad of [NaN, Infinity, -Infinity, '20', undefined, null]) {
    assert.throws(() => initSide(bad), TypeError, `seed=${JSON.stringify(bad)}`);
  }
});

// --- restoreSide: the RESUME entrance, now validated (the metric #9 fix) ---------

test('restoreSide reconstructs a normal in-range snapshot unchanged', () => {
  assert.deepEqual(restoreSide({ life: 5, max: 10 }), { life: 5, max: 10 });
});

test('restoreSide clamps a tampered 999 snapshot to 20 - THE FIX (Stage A preserved the bug)', () => {
  assert.deepEqual(restoreSide({ life: 20, max: 999 }), { life: 20, max: 20 });
  assert.deepEqual(restoreSide({ life: 999, max: 999 }), { life: 20, max: 20 });
});

test('restoreSide clamps life into [0, max]', () => {
  assert.deepEqual(restoreSide({ life: 99, max: 10 }), { life: 10, max: 10 });   // life above max
  assert.deepEqual(restoreSide({ life: -5, max: 10 }), { life: 0, max: 10 });    // life below zero
});

test('restoreSide floors a degenerate max to MIN_MAX', () => {
  assert.deepEqual(restoreSide({ life: 5, max: 0 }), { life: 1, max: 1 });
});

test('restoreSide throws on non-finite fields', () => {
  assert.throws(() => restoreSide({ life: NaN, max: 20 }), TypeError);
  assert.throws(() => restoreSide({ life: 10, max: Infinity }), TypeError);
  assert.throws(() => restoreSide(), TypeError);
});

// --- applyMax: now bounds max to [1,20] -----------------------------------------

test('applyMax lowers max and pulls life down to fit', () => {
  assert.deepEqual(applyMax({ life: 15, max: 20 }, 10), { life: 10, max: 10 });
});

test('applyMax raising max leaves life alone, and clamps max to 20 (Stage A did not)', () => {
  assert.deepEqual(applyMax({ life: 5, max: 20 }, 18), { life: 5, max: 18 });
  assert.deepEqual(applyMax({ life: 5, max: 20 }, 25), { life: 5, max: 20 });
});

test('applyMax throws on non-finite input', () => {
  assert.throws(() => applyMax({ life: 5, max: 20 }, NaN), TypeError);
  assert.throws(() => applyMax({ life: NaN, max: 20 }, 10), TypeError);
});

// --- the invariant holds across every entrance, over a deterministic sweep -------

test('the invariant holds for every side this module can produce', () => {
  for (const seed of [-3, 0, 1, 2, 5, 20, 21, 999]) {
    let side = initSide(seed);
    assertInvariant(side, `initSide(${seed})`);
    for (const dir of [1, 1, 1, -1, -1, -1, -1, -1, -1, 1, -1, -1]) {
      side = applyStep(side, dir).side;
      assertInvariant(side, `after applyStep(${dir})`);
    }
    for (const m of [0, 1, 5, 25, 20, -4]) {
      side = applyMax(side, m);
      assertInvariant(side, `after applyMax(${m})`);
    }
  }
  for (const max of [-5, 0, 1, 10, 20, 21, 999]) {
    for (const life of [-1, 0, 5, 20, 999]) {
      assertInvariant(restoreSide({ life, max }), `restoreSide(${life},${max})`);
    }
  }
});
