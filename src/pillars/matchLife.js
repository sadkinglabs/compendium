// The match's life/max model - pure arithmetic for a two-player life total, kept out of
// LifeCounter.jsx so the rules are provable without a DOM. Run: npm run test:ui
//
// STAGE A (this commit): a VERBATIM extraction. Every function reproduces exactly what
// LifeCounter.jsx did inline - no behavior change for any input the UI can produce. The
// <=20 hard cap is therefore still only as strong as each caller today (the fresh seed and
// the MaxLifeModal stepper clamp to 20 upstream; the RESUME path does not). Stage B closes
// that gap: it will bound max to [1,20] and life to [0,max] at EVERY entrance including
// resume, close the tap domain to -1|+1, and fail loud on non-finite input.
// See docs/proposals/ui-state-optimisation.md.
//
// A "side" is { life, max }. The component holds the value in a ref (pRef/eRef) and routes
// every write through commitLife; this module owns the rules those writes apply. Every life
// entrance - fresh, resume, tap, setMax, reset - goes through one of the functions here.

/** @typedef {{ life: number, max: number }} Side */

/**
 * Fresh-match seed.
 * STAGE A: passthrough - the caller passes `start`, already clamped to <=20 at the call
 * site (LifeCounter.jsx:47). Stage B moves that clamp in here so it cannot be forgotten.
 */
export function initSide(seedMax) {
  return { life: seedMax, max: seedMax };
}

/**
 * The RESUME entrance - reconstruct a side from a persisted snapshot's fields.
 * STAGE A: verbatim passthrough of `{ life, max }`, matching LifeCounter.jsx:50-51, which
 * seeds pRef/eRef straight from resume.pLife/pMax with no bound. This is the unguarded path
 * today (ongoingMatch.isValidSnapshot checks only Number.isFinite). Stage B clamps it here.
 */
export function restoreSide({ life, max }) {
  return { life, max };
}

/**
 * One tap of `delta`. Reproduces LifeCounter.jsx's `change` arithmetic verbatim:
 *   - refused : side.life <= 0 && delta < 0     (the "door holds", L372) - side unchanged
 *   - else    : next = Math.min(side.max, side.life + delta)   (L374)
 *               changed = next !== side.life                   (L375 capped no-op check)
 * The component maps the result to effects: refused -> refuseAtFloor + heavy haptic; not
 * changed -> nothing; changed -> commitLife + log + animation. Crossings (fell/recovered)
 * are deliberately NOT returned here - they stay owned by commitLife -> dd.syncLife, so
 * there is one source of truth for Death's Door.
 * STAGE A keeps the OPEN integer delta the UI passes (only -1/+1 today); Stage B closes the
 * domain to -1|+1 with a runtime guard, which is what makes "never below zero" true.
 * @param {Side} side
 * @returns {{ side: Side, changed: boolean, refused: boolean }}
 */
export function stepLife(side, delta) {
  if (side.life <= 0 && delta < 0) return { side, changed: false, refused: true };
  const next = Math.min(side.max, side.life + delta);
  return { side: { life: next, max: side.max }, changed: next !== side.life, refused: false };
}

/**
 * Change the max; life follows down to fit.
 * STAGE A: verbatim of setMax's `Math.min(cur.life, max), max` (LifeCounter.jsx:403) - note
 * it does NOT bound max to 20 here; the MaxLifeModal stepper does that upstream. Stage B
 * moves the [1,20] bound in.
 */
export function maxSide(side, nextMax) {
  return { life: Math.min(side.life, nextMax), max: nextMax };
}
