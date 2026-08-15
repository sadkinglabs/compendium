// Advanced Counter Band - the rules that must hold regardless of rendering.
// Run: npm run test:ui
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIGURES, initialBand, restoreBand, stepFigure, dragDir, isTap, repeatDelay,
  DRAG_TRIGGER_PX, TAP_MAX_PX, REPEAT_FIRST_MS, REPEAT_INTERVAL_MS,
} from './bandState.js';

test('initial band: ten figures, all zero, sides independent objects', () => {
  const b = initialBand();
  for (const f of FIGURES) { assert.equal(b.p[f], 0); assert.equal(b.e[f], 0); }
  assert.notEqual(b.p, b.e, 'sides must not share an object');
});

test('HARD FLOOR: decrement at 0 changes nothing and says so (the UI shakes, never pulses)', () => {
  const b = initialBand();
  const r = stepFigure(b, 'p', 'mana', -1);
  assert.equal(r.changed, false);
  assert.equal(r.band.p.mana, 0);
  assert.equal(r.band, b, 'a refused step returns the same band (no phantom re-render)');
});

test('NO UPPER CAP: mana climbs into three digits', () => {
  let b = initialBand();
  for (let i = 0; i < 120; i += 1) b = stepFigure(b, 'e', 'mana', +1).band;
  assert.equal(b.e.mana, 120);
});

test('a step touches ONE figure on ONE side', () => {
  const b = stepFigure(initialBand(), 'p', 'fire', +1).band;
  assert.equal(b.p.fire, 1);
  assert.equal(b.p.water, 0);
  assert.equal(b.e.fire, 0, 'the opponent side is untouched');
});

test('drag direction: trigger distance arms exactly at the threshold, both ways', () => {
  assert.equal(dragDir(DRAG_TRIGGER_PX, false), +1);
  assert.equal(dragDir(-DRAG_TRIGGER_PX, false), -1);
  assert.equal(dragDir(DRAG_TRIGGER_PX - 1, false), 0, 'inside the trigger = no ghost');
  assert.equal(dragDir(-(DRAG_TRIGGER_PX - 1), false), 0, 'and dragging back across cancels');
});

test('MIRROR: the rotated opponent row inverts screen dx, so right means + from their seat', () => {
  assert.equal(dragDir(DRAG_TRIGGER_PX, true), -1, 'screen-right is opponent-left');
  assert.equal(dragDir(-DRAG_TRIGGER_PX, true), +1, 'screen-left is opponent-right');
});

test('tap vs drag: the boundary is total travel, spec 10px', () => {
  assert.equal(isTap(TAP_MAX_PX), true);
  assert.equal(isTap(TAP_MAX_PX + 1), false);
  assert.equal(isTap(0), true);
});

test('hold-to-repeat cadence: 380ms first, then 130ms', () => {
  assert.equal(repeatDelay(0), REPEAT_FIRST_MS);
  assert.equal(repeatDelay(1), REPEAT_INTERVAL_MS);
  assert.equal(repeatDelay(9), REPEAT_INTERVAL_MS);
});

test('restore clamps garbage: negatives, NaN, missing sides, floats all land on safe ints', () => {
  const b = restoreBand({ p: { mana: -3, air: NaN, earth: 2.9, fire: Infinity }, e: undefined });
  assert.equal(b.p.mana, 0);
  assert.equal(b.p.air, 0);
  assert.equal(b.p.earth, 2);
  assert.equal(b.p.fire, 0, 'Infinity is not a value a match can hold');
  assert.equal(b.p.water, 0, 'missing figure defaults');
  for (const f of FIGURES) assert.equal(b.e[f], 0, 'a missing side is all zeros');
});

test('restore round-trips a legitimate band unchanged', () => {
  const b = restoreBand({ p: { mana: 12, air: 1, earth: 0, fire: 3, water: 2 }, e: { mana: 4, air: 0, earth: 2, fire: 0, water: 1 } });
  assert.deepEqual(b.p, { mana: 12, air: 1, earth: 0, fire: 3, water: 2 });
  assert.deepEqual(b.e, { mana: 4, air: 0, earth: 2, fire: 0, water: 1 });
});
