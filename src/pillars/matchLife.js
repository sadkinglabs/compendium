// The match's life/max model - pure arithmetic for a two-player life total, kept out of
// LifeCounter.jsx so the rules are provable without a DOM. Run: npm run test:ui
//
// THIS IS THE SAFETY BOUNDARY. Every life entrance - fresh (initSide), resume (restoreSide),
// tap (applyStep), max change (applyMax) - flows through here, and here is the ONE place the
// hard cap lives: 1 <= max <= 20 and 0 <= life <= max, enforced at EVERY entrance. A caller
// cannot construct an out-of-range life through this module, and cannot forget the cap,
// because there is no entrance that skips it.
//
// WHY IT EXISTS (the bug it closes): the <=20 cap used to be re-derived at four scattered
// sites in the component, and the RESUME path had none - a snapshot with max:999 (corrupt,
// legacy, or tampered) restored uncapped and taps climbed past 20. See metric #9 in
// docs/proposals/ui-state-optimisation-metrics.md and the proposal for the full history.
//
// CLOSED DOMAIN + FAIL LOUD (the ddArming.assertSide precedent, applied to values):
//   - applyStep takes a direction of exactly -1 | 1. Anything else throws - the UI only ever
//     sends +/-1, so a different value is a bug, and "never below zero" is TRUE precisely
//     because the domain is closed (an arbitrary negative delta can no longer be computed).
//   - every entrance rejects non-finite input (NaN / Infinity / non-number) BEFORE clamping,
//     because a bare Math.min/max would propagate NaN and silently defeat the boundary.
//
// A "side" is { life, max }. The component holds the value in a ref and routes every write
// through commitLife -> dd.syncLife, which stays the SOLE authority on Death's Door crossings
// (this module deliberately does not report fell/recovered - one source of truth).

/** @typedef {{ life: number, max: number }} Side */
/** @typedef {-1 | 1} Dir */

export const LIFE_CAP = 20;   // Sorcery: life never exceeds 20 (hard cap)
export const MIN_MAX  = 1;    // a max below 1 could strand a side dead on reset

/** Reject non-finite input at the boundary, loudly, before any arithmetic. */
function finite(n, label) {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new TypeError(`matchLife: ${label} must be a finite number, got ${JSON.stringify(n)}`);
  }
  return n;
}

const clampMax  = (m) => Math.min(LIFE_CAP, Math.max(MIN_MAX, m));
const clampLife = (l, max) => Math.min(max, Math.max(0, l));

/** Fresh-match seed. Enforces MIN_MAX..LIFE_CAP once, here - life starts at max. */
export function initSide(seedMax) {
  const max = clampMax(finite(seedMax, 'seedMax'));
  return { life: max, max };
}

/**
 * The RESUME entrance - reconstruct a side from a persisted snapshot's fields, normalized to
 * the same invariant every other entrance enforces: max -> [1,20], life -> [0, max]. This is
 * the entrance that was unguarded (the metric #9 bug); routing resume through it is what makes
 * "the one place" literally true. Non-finite fields throw (they should never arrive - the
 * ongoingMatch validator already discards non-finite snapshots - so a throw here is a
 * defensive assertion, not an expected path).
 */
export function restoreSide({ life, max } = {}) {
  const m = clampMax(finite(max, 'restore.max'));
  const l = clampLife(finite(life, 'restore.life'), m);
  return { life: l, max: m };
}

/**
 * One tap. CLOSED DOMAIN: `dir` must be -1 | 1; anything else throws.
 *   - refused : side.life <= 0 && dir < 0    (the "door holds") - side returned unchanged
 *   - else    : next = min(side.max, side.life + dir); changed = next !== side.life
 * The component maps the result to effects (refused -> refuseAtFloor + heavy haptic; not
 * changed -> nothing; changed -> commitLife + log + animation). Crossings stay with
 * commitLife -> dd.syncLife.
 * @param {Side} side
 * @param {Dir} dir
 * @returns {{ side: Side, changed: boolean, refused: boolean }}
 */
export function applyStep(side, dir) {
  if (dir !== 1 && dir !== -1) {
    throw new RangeError(`matchLife.applyStep: dir must be -1 | 1, got ${JSON.stringify(dir)}`);
  }
  finite(side?.life, 'side.life');
  finite(side?.max, 'side.max');
  if (side.life <= 0 && dir < 0) return { side, changed: false, refused: true };
  const next = Math.min(side.max, side.life + dir);
  return { side: { life: next, max: side.max }, changed: next !== side.life, refused: false };
}

/** Change the max; life follows down to fit. Max clamped to [1,20]. */
export function applyMax(side, nextMax) {
  finite(side?.life, 'side.life');
  const max = clampMax(finite(nextMax, 'nextMax'));
  return { life: Math.min(side.life, max), max };
}
