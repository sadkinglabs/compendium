// Compendium's holographic foil — the layer recipe for the card art viewer.
//
// The physics (see docs/foil/foil-proposal.md §3): on a real card the reflective layer sits
// BENEATH the ink, so heavy dark print masks it and light areas let it shine. `color-dodge`
// reproduces that for free — it computes base / (1 - blend), so a black base stays black
// whatever the holo layer holds, while bright areas bloom. The artwork's own luminance is the
// mask, which means no per-card asset and sane behaviour on art we have never seen.
//
// EVERY NUMBER HERE IS OURS TO FIND. They are collected in one object precisely so tuning on
// device is a one-line change. Nothing is inherited from anywhere; values that suit another
// game's card art do not transfer to Sorcery's darker, more painterly work.
export const FOIL = {
  angle: 24,          // deg — band direction
  period: 6.5,        // % of the card per colour stop; with 6 stops this is the band pitch
  bandAlpha: 0.5,     // per-stop alpha before contrast
  contrast: 1.9,      // separates the ramps into bands; the highest-leverage value in the stack
  saturate: 1.2,
  baseBright: 0.55,   // brightness at rest (card square-on)
  tiltBright: 0.45,   // added at full tilt — the foil comes alive as you turn it
  travel: 26,         // px the bands slide across full tilt
  glareBlend: 'overlay',  // must LIFT the hotspot and DEEPEN the surround; on-device choice
  glareDark: 0.5,     // how far below mid-grey the surround sits (the "deepen" half)
};

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/** The prismatic band layer. `t` is { x, y } tilt in degrees; `mag` is 0..1 deflection. */
export function foilBandsStyle(t, mag, reduce) {
  const stops = [
    'rgba(255,110,190,A)', 'rgba(255,190,90,A)', 'rgba(190,255,120,A)',
    'rgba(90,225,255,A)', 'rgba(150,140,255,A)', 'rgba(255,110,190,A)',
  ].map((c, i) => c.replace('A', String(FOIL.bandAlpha)) + ` ${(i + 1) * FOIL.period}%`).join(', ');
  const shift = reduce ? 0 : (t.y / 14) * FOIL.travel;
  const rise = reduce ? 0 : (t.x / 14) * FOIL.travel * 0.6;
  return {
    position: 'absolute', inset: '-25%', pointerEvents: 'none',
    backgroundImage: `repeating-linear-gradient(${FOIL.angle}deg, ${stops})`,
    mixBlendMode: 'color-dodge',
    filter: `contrast(${FOIL.contrast}) saturate(${FOIL.saturate}) brightness(${(FOIL.baseBright + (reduce ? 0.2 : mag * FOIL.tiltBright)).toFixed(3)})`,
    transform: `translate3d(${shift.toFixed(1)}px, ${rise.toFixed(1)}px, 0)`,
    transition: reduce ? 'none' : 'transform .1s linear, filter .1s linear',
  };
}

/** The specular glare. Lifts the hotspot and DEEPENS everything around it — that contrast is
 *  what reads as metal rather than a bright wash. `gx`/`gy` are 0..100 hotspot position. */
export function foilGlareStyle(gx, gy, reduce) {
  const x = reduce ? 50 : clamp01(gx / 100) * 100;
  const y = reduce ? 38 : clamp01(gy / 100) * 100;
  const dark = FOIL.glareDark;
  return {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: `radial-gradient(farthest-corner circle at ${x.toFixed(1)}% ${y.toFixed(1)}%,
      rgba(255,255,255,.95) 0%,
      rgba(255,255,255,.55) 9%,
      rgba(128,128,128,.35) 26%,
      rgba(0,0,0,${dark}) 62%,
      rgba(0,0,0,${(dark + 0.1).toFixed(2)}) 100%)`,
    mixBlendMode: FOIL.glareBlend,
    transition: reduce ? 'none' : 'background .1s linear',
  };
}
