import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundRectPath } from './roundRect.js';

// A recording 2D-context fake: every method call is captured as [name, ...args]. A real canvas is
// not needed to prove the path is built from the correct, existing primitives - the exact defect
// that shipped (a nonexistent `cx-decksTo` method) is a call-shape problem, so we assert the shape.
function recordingCtx() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    arcTo: rec('arcTo'),
    quadraticCurveTo: rec('quadraticCurveTo'),
    closePath: rec('closePath'),
  };
}

test('roundRectPath draws a closed sub-path from four arcTo corners', () => {
  const ctx = recordingCtx();
  roundRectPath(ctx, 10, 20, 100, 60, 8);
  const names = ctx.calls.map((c) => c[0]);
  assert.deepEqual(names, ['beginPath', 'moveTo', 'arcTo', 'arcTo', 'arcTo', 'arcTo', 'closePath']);
});

test('every corner uses arcTo with FIVE args (x1,y1,x2,y2,radius) - never quadraticCurveTo', () => {
  const ctx = recordingCtx();
  roundRectPath(ctx, 0, 0, 100, 60, 12);
  const arcs = ctx.calls.filter((c) => c[0] === 'arcTo');
  assert.equal(arcs.length, 4);
  for (const a of arcs) assert.equal(a.length, 6, 'arcTo takes exactly five arguments');
  // quadraticCurveTo (Codex's suggested fix) takes four args and would distort the corners.
  assert.equal(ctx.calls.filter((c) => c[0] === 'quadraticCurveTo').length, 0);
});

test('radius is clamped to half the shorter side so corners never overlap', () => {
  const ctx = recordingCtx();
  roundRectPath(ctx, 0, 0, 40, 20, 999);   // r would exceed the box
  // moveTo starts at (px + clampedR, py); clampedR = min(999, 20, 10) = 10.
  const move = ctx.calls.find((c) => c[0] === 'moveTo');
  assert.deepEqual(move, ['moveTo', 10, 0]);
  // First arcTo's tangent point uses the clamped radius as its final arg.
  const firstArc = ctx.calls.find((c) => c[0] === 'arcTo');
  assert.equal(firstArc[firstArc.length - 1], 10);
});

test('the exact corners map the rectangle box (regression on the corrupted path)', () => {
  const ctx = recordingCtx();
  roundRectPath(ctx, 10, 20, 100, 60, 8);
  const arcs = ctx.calls.filter((c) => c[0] === 'arcTo').map((c) => c.slice(1));
  assert.deepEqual(arcs, [
    [110, 20, 110, 80, 8],   // top-right   (px+pw,py -> px+pw,py+ph)
    [110, 80, 10, 80, 8],    // bottom-right
    [10, 80, 10, 20, 8],     // bottom-left
    [10, 20, 110, 20, 8],    // top-left
  ]);
});
