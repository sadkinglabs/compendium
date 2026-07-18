// Fixtures for the turn-order roll-off decision core (src/pillars/matchRoll.js).
// Run: npm run test:ui   (node --test)
//
// Two jobs: (1) prove the contest is FAIR - two distinct d20 rolls, winner is strictly higher -
// which is the invariant this module exists to guarantee and which nothing tested before; and
// (2) pin the three phase decisions (entry/resume-skip, lock, start).
//
// The injected rng PRECONDITION is load-bearing here: rollOutcome re-rolls a tie until distinct,
// so a constant rng would loop forever (by design - a fair contest has no valid tie, and a retry
// cap would change behavior). Every fixture therefore ends on a value distinct from pRoll.
//
// NOT covered here (honest, mirroring matchLife.test.mjs): the odometer tumble animation, timers,
// haptics, and aria are DOM/compositor behavior with no harness in this repo. Verified on device;
// see the proposal's verification plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollOutcome, initialRollPhase, isRollLocked, canStartRoll, ROLL_DIE } from './matchRoll.js';

/** A deterministic rng that returns the scripted values in order, and counts its calls. */
function scripted(values) {
  let i = 0;
  const fn = () => {
    if (i >= values.length) throw new Error(`scripted rng exhausted after ${values.length} calls`);
    return values[i++];
  };
  fn.calls = () => i;
  return fn;
}

/** A small seeded LCG in [0,1) - reproducible, no Math.random, for the property sweep. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// --- rollOutcome: the fairness invariant ----------------------------------------

test('winner is the side that rolled strictly higher (player)', () => {
  // p = 1 + floor(0.60*20) = 13 ; e = 1 + floor(0.10*20) = 3
  const rng = scripted([0.60, 0.10]);
  assert.deepEqual(rollOutcome(rng), { pRoll: 13, eRoll: 3, winner: 'player' });
  assert.equal(rng.calls(), 2);
});

test('winner is the side that rolled strictly higher (opponent)', () => {
  // p = 1 + floor(0.10*20) = 3 ; e = 1 + floor(0.60*20) = 13
  const rng = scripted([0.10, 0.60]);
  assert.deepEqual(rollOutcome(rng), { pRoll: 3, eRoll: 13, winner: 'opponent' });
});

test('tie is re-rolled - TWO consecutive ties falsify a while->if regression', () => {
  // p=10, e=10 (tie), e=10 (tie again), e=11 (distinct). A one-tie fixture would pass under a
  // broken `if`; two consecutive ties require the `while` loop.
  const rng = scripted([0.45, 0.45, 0.45, 0.50]);
  assert.deepEqual(rollOutcome(rng), { pRoll: 10, eRoll: 11, winner: 'opponent' });
  assert.equal(rng.calls(), 4);
});

test('lower bound: rng()->0 maps to roll 1 (rolls kept distinct so it terminates)', () => {
  // p = 1 + floor(0*20) = 1 ; e = 1 + floor(0.1*20) = 3
  const rng = scripted([0, 0.1]);
  assert.deepEqual(rollOutcome(rng), { pRoll: 1, eRoll: 3, winner: 'opponent' });
});

test('upper bound: rng()->(1-eps) maps to roll 20', () => {
  // p = 1 + floor(0.999999999*20) = 20 ; e = 1 + floor(0*20) = 1
  const rng = scripted([1 - 1e-9, 0]);
  assert.deepEqual(rollOutcome(rng), { pRoll: 20, eRoll: 1, winner: 'player' });
});

test('invariant holds across a seeded sweep: distinct, in [1,20], winner == max', () => {
  const rng = lcg(0xC0FFEE);
  for (let n = 0; n < 5000; n++) {
    const { pRoll, eRoll, winner } = rollOutcome(rng);
    assert.notEqual(pRoll, eRoll, 'rolls must be distinct');
    assert.ok(pRoll >= 1 && pRoll <= ROLL_DIE, `pRoll in range: ${pRoll}`);
    assert.ok(eRoll >= 1 && eRoll <= ROLL_DIE, `eRoll in range: ${eRoll}`);
    assert.ok(winner === 'player' || winner === 'opponent', `winner valid: ${winner}`);
    const winnerRoll = winner === 'player' ? pRoll : eRoll;
    assert.equal(winnerRoll, Math.max(pRoll, eRoll), 'winner rolled the higher value');
  }
});

test('default rng (Math.random) returns a valid, fair-shaped outcome', () => {
  for (let n = 0; n < 200; n++) {
    const { pRoll, eRoll, winner } = rollOutcome();
    assert.notEqual(pRoll, eRoll);
    assert.ok(pRoll >= 1 && pRoll <= ROLL_DIE && eRoll >= 1 && eRoll <= ROLL_DIE);
    const winnerRoll = winner === 'player' ? pRoll : eRoll;
    assert.equal(winnerRoll, Math.max(pRoll, eRoll));
  }
});

// --- initialRollPhase: the resume-skip invariant --------------------------------

test('a fresh match opens armed; a resumed match opens with no ceremony', () => {
  assert.equal(initialRollPhase(false), 'armed');
  assert.equal(initialRollPhase(true), null);
});

// --- isRollLocked: the ceremony-owns-the-screen guard ---------------------------

test('isRollLocked is true only through windup/rolling/result', () => {
  assert.equal(isRollLocked('windup'), true);
  assert.equal(isRollLocked('rolling'), true);
  assert.equal(isRollLocked('result'), true);
  assert.equal(isRollLocked('armed'), false);
  assert.equal(isRollLocked(null), false);
});

// --- canStartRoll: only an armed offer may start --------------------------------

test('canStartRoll is true only when armed', () => {
  assert.equal(canStartRoll('armed'), true);
  assert.equal(canStartRoll('windup'), false);
  assert.equal(canStartRoll('rolling'), false);
  assert.equal(canStartRoll('result'), false);
  assert.equal(canStartRoll(null), false);
});
