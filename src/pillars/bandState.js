// Advanced Counter Band state - pure and DOM-free (the UI-state extraction
// pattern; matchLife.js is the template). Owns the ten figures (two sides x
// [mana, air, earth, fire, water]) and the GESTURE ARITHMETIC: drag direction
// with opponent mirroring, the tap/drag classification, the hold-repeat
// cadence, and the hard floor. The component translates pointer events into
// these calls; every rule that matters is provable here without a screen.
// Run: npm run test:ui
//
// Owner rulings (docs/proposals/advanced-counter-band.md §5): values are table
// state only - they never write match-log entries or history. Floor 0, no cap.

export const FIGURES = ['mana', 'air', 'earth', 'fire', 'water'];
export const DRAG_TRIGGER_PX = 20;   // horizontal travel that arms one step
export const TAP_MAX_PX = 10;        // at or under this total travel, a release is a tap
export const REPEAT_FIRST_MS = 380;  // hold-to-repeat: first repeat
export const REPEAT_INTERVAL_MS = 130; // then this interval

const emptySide = () => ({ mana: 0, air: 0, earth: 0, fire: 0, water: 0 });

export function initialBand() {
  return { p: emptySide(), e: emptySide() };
}

// Snapshot restore: any non-finite, negative, or missing value becomes 0 -
// an old snapshot (no band fields) resumes as all zeros, never NaN.
const clampVal = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
export function restoreBand(raw) {
  const side = (s) => ({
    mana: clampVal(s?.mana), air: clampVal(s?.air), earth: clampVal(s?.earth),
    fire: clampVal(s?.fire), water: clampVal(s?.water),
  });
  return { p: side(raw?.p), e: side(raw?.e) };
}

/** One committed step. Floor 0 (a refused decrement reports changed:false so the
 *  UI can shake instead of pulse); NO upper cap by spec. Returns a new band. */
export function stepFigure(band, side, fig, dir) {
  const cur = band[side][fig];
  const next = Math.max(0, cur + (dir < 0 ? -1 : 1));
  if (next === cur) return { band, changed: false };
  return { band: { ...band, [side]: { ...band[side], [fig]: next } }, changed: true };
}

/** Drag direction from SCREEN-space horizontal travel. `mirrored` is the
 *  180-degree-rotated opponent row: right/left must mean right/left from THEIR
 *  seat, so screen dx inverts. Inside the trigger both ways = 0 (no ghost),
 *  which is also how dragging back across the trigger cancels. */
export function dragDir(dxScreen, mirrored) {
  const dx = mirrored ? -dxScreen : dxScreen;
  if (dx >= DRAG_TRIGGER_PX) return +1;
  if (dx <= -DRAG_TRIGGER_PX) return -1;
  return 0;
}

/** A release classifies as a tap only if TOTAL travel never exceeded TAP_MAX_PX. */
export function isTap(maxTravelPx) {
  return maxTravelPx <= TAP_MAX_PX;
}

/** Hold-to-repeat cadence: tick 0 waits the long beat, every later tick the short one. */
export function repeatDelay(tickIndex) {
  return tickIndex === 0 ? REPEAT_FIRST_MS : REPEAT_INTERVAL_MS;
}
