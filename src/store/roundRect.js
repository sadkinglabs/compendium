// A rounded-rectangle sub-path on a 2D canvas context, extracted from deckPoster.js so it is
// unit-testable WITHOUT a real canvas or the native share chain deckPoster pulls in.
//
// Why this exists as its own tested unit: the corners are drawn with `ctx.arcTo(x1, y1, x2, y2,
// radius)` - FIVE arguments. A find/replace once corrupted these calls to `x.cx-decksTo(...)` (a
// method that does not exist), which threw `... is not defined` the moment a poster was exported.
// No build or type check caught it because the canvas API is untyped and the call is only reached
// at runtime. A recording-context test now pins BOTH the method name and its five-argument shape,
// and a source guard (scripts/check-source-guards) rejects the `ident.cx-` corruption pattern.
//
// arcTo (not quadraticCurveTo) is correct here: each corner is a true circular arc of `radius`
// tangent to two rectangle edges - the five-arg tangent-arc primitive. quadraticCurveTo takes four
// args and a single control point, which would distort the corners and drop the radius entirely.
export function roundRectPath(ctx, px, py, pw, ph, r) {
  r = Math.min(r, pw / 2, ph / 2);
  ctx.beginPath();
  ctx.moveTo(px + r, py);
  ctx.arcTo(px + pw, py, px + pw, py + ph, r);   // top-right
  ctx.arcTo(px + pw, py + ph, px, py + ph, r);   // bottom-right
  ctx.arcTo(px, py + ph, px, py, r);             // bottom-left
  ctx.arcTo(px, py, px + pw, py, r);             // top-left
  ctx.closePath();
}
