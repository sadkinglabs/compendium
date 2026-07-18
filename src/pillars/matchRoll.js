// The turn-order roll-off's decision core - pure, DOM/timer/haptic-free, so contest fairness
// and the phase guards are provable without a running component. Run: npm run test:ui
//
// SCOPE: this owns the DECISIONS, not the ceremony. The odometer tumble, the timers, the
// haptics, the aria wiring, and the birth/colour coupling stay in LifeCounter - they are
// presentation with no invariant a test would protect. What lives here has one:
//   - rollOutcome     : the d20 contest is fair - two DISTINCT rolls, winner is strictly higher.
//   - initialRollPhase: a RESUMED match never re-enters the ceremony (turn order already set).
//   - isRollLocked    : the ceremony-owns-the-screen guard that gates Death's Door suppression.
//   - canStartRoll    : only an armed offer may start a roll (no double-roll).
//
// These three phase predicates are exactly three DECISIONS, not the whole phase vocabulary:
// LifeCounter keeps its own phase literals in rollCls, the pill JSX, finishRollOff, and its
// timer transitions. This module is deliberately not a reducer and owns no timers.

/** @typedef {'armed'|'windup'|'rolling'|'result'|null} RollPhase */
/** @typedef {'player'|'opponent'} Side */

export const ROLL_DIE = 20;   // turn order is a d20 roll-off

/**
 * The turn-order contest. Two d20 rolls, re-rolled until DISTINCT (a tie has no winner), and
 * the winner is the side that rolled strictly higher. Pure given `rng`; inject a deterministic
 * rng in tests. Provable invariant: pRoll !== eRoll, both in [1, ROLL_DIE], and the winner's
 * roll === max(pRoll, eRoll).
 *
 * PRECONDITION: `rng` returns values in [0, 1) and must EVENTUALLY yield a roll distinct from
 * pRoll. A permanently constant rng (e.g. `() => 0`) makes every roll equal and the tie re-roll
 * loops forever - that is by design: a fair contest has no valid tied outcome, and a production
 * retry cap would change behavior (a capped tie would have to invent a winner). Math.random
 * satisfies the precondition with probability 1.
 * @param {() => number} rng  0 <= rng() < 1, eventually distinct from pRoll; defaults to Math.random
 * @returns {{ pRoll: number, eRoll: number, winner: Side }}
 */
export function rollOutcome(rng = Math.random) {
  const d20 = () => 1 + Math.floor(rng() * ROLL_DIE);
  const pRoll = d20();
  let eRoll = d20();
  while (eRoll === pRoll) eRoll = d20();
  return { pRoll, eRoll, winner: pRoll > eRoll ? 'player' : 'opponent' };
}

/**
 * The phase a match OPENS in. A fresh match arms the offer; a resumed match already rolled for
 * turn order, so it opens with no ceremony (null). This is the resume-skip invariant, named
 * once instead of a scattered `resume ? null : 'armed'`.
 * @param {boolean} isResume
 * @returns {RollPhase}
 */
export function initialRollPhase(isResume) {
  return isResume ? null : 'armed';
}

/**
 * True while the ceremony owns the screen (windup -> rolling -> result): ONE uninterrupted
 * interval, so Death's Door suppression cannot dip between phases. 'armed' is NOT locked - the
 * offer coexists with live life tracking, and null (no ceremony) is never locked.
 * @param {RollPhase} phase
 * @returns {boolean}
 */
export function isRollLocked(phase) {
  return phase === 'windup' || phase === 'rolling' || phase === 'result';
}

/**
 * The one legal entry to a roll: only an armed offer may start. Guards against starting a
 * second roll mid-ceremony (or after it has already resolved).
 * @param {RollPhase} phase
 * @returns {boolean}
 */
export function canStartRoll(phase) {
  return phase === 'armed';
}
