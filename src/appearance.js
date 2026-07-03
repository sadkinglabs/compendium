// Applies the per-profile accessibility settings to the app root. Called once
// on boot and again whenever a setting changes, so font size / contrast /
// motion take effect immediately and survive reloads.
export const FONT_MIN = 0.85, FONT_MAX = 1.4, FONT_STEP = 0.05;

export function clampFontScale(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(FONT_MIN, Math.min(FONT_MAX, n));
}

export function applyAppearance(s) {
  // UI scale — zoom the whole app container proportionally (text + layout).
  // Everything is authored in px, so this is the honest "make it bigger" lever.
  const scale = clampFontScale(s?.font_scale);
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  document.body.classList.toggle('hc', !!s?.high_contrast);
  // Reduced motion is ON if the user asked for it OR the OS prefers it.
  const osReduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.classList.toggle('reduce-motion', !!s?.reduced_motion || osReduce);
}
