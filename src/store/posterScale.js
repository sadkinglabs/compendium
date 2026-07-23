// How many device pixels per logical pixel the deck poster is rasterised at. Higher = crisper text
// when the shared PNG is magnified. Two independent limits bound it, because a canvas can fail two
// different ways:
//
//   1. DIMENSION - a GPU-backed 2D canvas larger than MAX_TEXTURE_SIZE renders EMPTY (the blank-canvas
//      failure class the poster already bit us with). maxCanvasDim() reads that ceiling.
//   2. MEMORY - MAX_TEXTURE_SIZE limits pixels-per-side, NOT bytes. A device can report a 16384
//      dimension yet lack the WebView heap for a large RGBA buffer plus the transient PNG-encode
//      copies (a 990x1300 poster at 5x is ~129 MB), which can OOM-kill the renderer on a lower-memory
//      device. So an explicit TOTAL-PIXEL budget, derived from the device's reported RAM, caps the
//      allocation - and by construction a device that does not report ample RAM never exceeds the
//      device-proven 3x baseline.
//
// The scale is the largest whole multiplier that satisfies BOTH limits, capped at `max` and floored
// at 1 so it never blanks. This is the pure, testable core; maxCanvasDim / deviceMemoryGb are thin
// shims. Layout is in logical pixels (x.scale maps them), so SCALE only sets the raster resolution.
export function posterScale(dimCap, budgetPx, w, h, { max = 4 } = {}) {
  const longest = Math.max(w || 0, h || 0, 1);
  const area = Math.max((w || 0) * (h || 0), 1);
  const byDim = Math.floor((dimCap || 0) / longest);              // side <= texture cap
  const byMem = Math.floor(Math.sqrt(Math.max(budgetPx || 0, 0) / area));   // area * scale^2 <= budget
  const s = Math.min(max, byDim, byMem);
  return Number.isFinite(s) && s >= 1 ? s : 1;   // never blank: 1x is the safety floor
}

// Total canvas pixels we are willing to allocate, from the device's REPORTED RAM (navigator.
// deviceMemory - coarse, one of 0.25/0.5/1/2/4/8, capped at 8 for privacy). A poster canvas costs
// ~4 bytes/px plus a similar transient during PNG encode, so the budget is deliberately conservative:
// only a device reporting ample RAM (>=8) earns the ~4x budget; everything unknown or lower stays at
// the device-proven ~3x baseline for the representative poster.
export function memoryBudgetPx(deviceMemoryGb) {
  const gb = typeof deviceMemoryGb === 'number' && deviceMemoryGb > 0 ? deviceMemoryGb : 0;
  return gb >= 8 ? 22_000_000 : 12_000_000;   // ~4x (>=8GB) vs ~3x (unknown / lower)
}

// The device's safe maximum canvas DIMENSION, read from the GL max texture size. Falls back to 4096 -
// the conservative floor every WebGL-era GPU supports - when WebGL is unavailable or the value looks
// implausible, so a poster never blanks.
export function maxCanvasDim(doc = typeof document !== 'undefined' ? document : null) {
  try {
    const cv = doc && doc.createElement('canvas');
    const gl = cv && (cv.getContext('webgl') || cv.getContext('experimental-webgl'));
    const m = gl && gl.getParameter(gl.MAX_TEXTURE_SIZE);
    return typeof m === 'number' && m >= 2048 ? Math.min(m, 16384) : 4096;
  } catch {
    return 4096;
  }
}

// navigator.deviceMemory (GB), or 0 when unavailable - so the budget falls to the safe baseline.
export function deviceMemoryGb(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const m = nav && nav.deviceMemory;
  return typeof m === 'number' && m > 0 ? m : 0;
}
