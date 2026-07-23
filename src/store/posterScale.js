// How many device pixels per logical pixel the deck poster is rasterised at. Higher = crisper text
// when the shared PNG is magnified; too high blanks the canvas on a device whose max texture size the
// raster would exceed (a GPU-backed 2D canvas larger than MAX_TEXTURE_SIZE renders empty - the same
// blank-canvas failure class the poster already bit us with once).
//
// So the scale is chosen from the device's ACTUAL limit, not a guess: the largest whole multiplier
// that keeps BOTH canvas dimensions within the cap, capped at `max` and floored at 1. A flagship
// reporting 16384 gets a crisp 5x; a budget 4096 device stays at a safe 3x for a normal poster; a
// pathologically tall deck or a tiny cap downshifts rather than blanking - the cap is a HARD limit
// that always wins, because a raster past it renders empty. This is the pure, testable core; the GPU
// query is a thin shim.
export function posterScale(capDim, w, h, { max = 5 } = {}) {
  const longest = Math.max(w || 0, h || 0, 1);
  const fit = Math.floor((capDim || 0) / longest);
  if (!Number.isFinite(fit) || fit < 1) return 1;   // never blank: 1x is the safety floor
  return Math.min(max, fit);
}

// The device's safe maximum canvas dimension, read from the GL max texture size (the real ceiling a
// GPU-backed canvas can hold). Falls back to 4096 - the conservative floor every WebGL-era GPU
// supports - whenever WebGL is unavailable or the value looks implausible, so a poster never blanks.
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
