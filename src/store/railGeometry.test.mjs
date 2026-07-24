// Pure tests for the alphabet-rail bounds. Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { railBounds, indexAtY } from './railGeometry.js';

const VP = 900;   // viewport height

test('bottom clears the MEASURED obstruction; a single boundary cannot double-count safe area', () => {
  // dock/FAB obstruction top measured at y=760 (its own CSS already placed it above the safe area).
  const b = railBounds({ viewportHeight: VP, scrollRootTop: 0, headerHeight: 56, obstructionTop: 760, railGap: 8 });
  assert.equal(b.top, 56);
  assert.equal(b.bottom, VP - 760 + 8);   // 148 - exactly the gap below the obstruction, safe area included once
});

test('keyboard-open pushes the obstruction up, so the rail shortens (bottom grows) - no re-added safe area', () => {
  const closed = railBounds({ viewportHeight: VP, obstructionTop: 760 });
  const open = railBounds({ viewportHeight: VP, obstructionTop: 420 });   // keyboard raised the dock
  assert.ok(open.bottom > closed.bottom, 'rail ends higher when the dock rides above the keyboard');
  assert.equal(open.bottom, VP - 420 + 8);
});

test('a taller selection/FAB stack measures a smaller obstructionTop -> larger bottom inset', () => {
  const plain = railBounds({ viewportHeight: VP, obstructionTop: 760 });
  const stacked = railBounds({ viewportHeight: VP, obstructionTop: 700 });   // action bar / stacked FAB rises 60px
  assert.equal(stacked.bottom - plain.bottom, 60);
});

test('top is scrollRootTop + this surface header (drill header taller than ALL toolbar)', () => {
  const all = railBounds({ viewportHeight: VP, scrollRootTop: 10, headerHeight: 44, obstructionTop: 760 });
  const drill = railBounds({ viewportHeight: VP, scrollRootTop: 10, headerHeight: 88, obstructionTop: 760 });
  assert.equal(all.top, 54);
  assert.equal(drill.top, 98);
});

test('missing / non-finite obstruction falls back to a minimal gap, never NaN', () => {
  const b = railBounds({ viewportHeight: VP, headerHeight: 44 });
  assert.equal(b.bottom, 8);
  assert.ok(Number.isFinite(b.top) && Number.isFinite(b.bottom));
});

test('an obstruction below the viewport bottom clamps to the gap (never negative)', () => {
  const b = railBounds({ viewportHeight: VP, obstructionTop: 980, railGap: 8 });
  assert.equal(b.bottom, 8);
});

test('indexAtY maps position -> slot over the strip, clamped to [0, count-1]', () => {
  // 27 slots over [100, 640] (height 540, 20px each).
  assert.equal(indexAtY(100, 100, 540, 27), 0, 'top edge -> first');
  assert.equal(indexAtY(639, 100, 540, 27), 26, 'bottom edge -> last');
  assert.equal(indexAtY(50, 100, 540, 27), 0, 'above the strip clamps to 0');
  assert.equal(indexAtY(9999, 100, 540, 27), 26, 'below the strip clamps to last');
  assert.equal(indexAtY(110, 100, 540, 27), 0, 'first 20px band -> slot 0');
  assert.equal(indexAtY(130, 100, 540, 27), 1, 'second band -> slot 1');
  assert.equal(indexAtY(300, 100, 0, 27), 0, 'zero height -> 0, no divide-by-zero');
  assert.equal(indexAtY(300, 100, 540, 0), 0, 'no slots -> 0');
});
