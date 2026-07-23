import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posterScale, memoryBudgetPx, maxCanvasDim, deviceMemoryGb } from './posterScale.js';

const W = 990, H = 1300;                 // the representative poster
const AMPLE = memoryBudgetPx(8);         // >=8GB budget
const LOW = memoryBudgetPx(2);           // lower / unknown budget
const FLAGSHIP_DIM = 16384, BUDGET_DIM = 4096;

// --- The two limits, and which one binds ---------------------------------------------------------

test('ample RAM + a flagship texture cap lifts the poster to 4x (crisper text)', () => {
  assert.equal(posterScale(FLAGSHIP_DIM, AMPLE, W, H), 4);
});

test('MEMORY, not dimension, holds a flagship-dimension device to 3x when RAM is not ample', () => {
  // The exact hole Codex found: a 16384 texture cap must NOT authorise a 5x (129MB) canvas. With the
  // low/unknown-memory budget the scale is pinned to the device-proven 3x even though the dimension
  // would allow far more.
  assert.equal(posterScale(FLAGSHIP_DIM, LOW, W, H), 3);
});

test('a budget device (4096 texture cap) stays at a safe 3x even with an ample memory budget', () => {
  assert.equal(posterScale(BUDGET_DIM, AMPLE, W, H), 3);   // dimension binds here
});

test('the scale never exceeds EITHER the texture cap or the pixel budget', () => {
  for (const dim of [4096, 8192, 16384]) {
    for (const budget of [LOW, AMPLE, 40_000_000]) {
      for (const h of [900, 1300, 1800, 3000]) {
        const s = posterScale(dim, budget, W, h);
        assert.ok(Math.max(W, h) * s <= dim, `dim ${dim} h ${h} scale ${s} exceeds the texture cap`);
        assert.ok(W * h * s * s <= budget, `budget ${budget} h ${h} scale ${s} exceeds the pixel budget`);
      }
    }
  }
});

test('a very tall deck downshifts rather than overflowing either limit', () => {
  assert.equal(posterScale(8192, AMPLE, W, 3000), 2);
  assert.equal(posterScale(4096, AMPLE, W, 3000), 1);   // even 2x would blank (6000>4096) -> 1x
});

test('the max is an explicit hard ceiling (never 5x, whatever the device reports)', () => {
  assert.equal(posterScale(32768, 999_000_000, W, H), 4);       // both limits huge -> capped at max=4
  assert.equal(posterScale(32768, 999_000_000, W, H, { max: 3 }), 3);
});

test('missing / implausible inputs floor at 1, never 0 or NaN (no blank)', () => {
  for (const dim of [0, undefined, null, NaN, -1]) {
    for (const budget of [0, undefined, null, NaN, -1]) {
      const s = posterScale(dim, budget, W, H);
      assert.ok(Number.isInteger(s) && s >= 1, `dim ${dim} budget ${budget} -> ${s}`);
    }
  }
});

// --- memoryBudgetPx: only ample RAM earns the bigger budget ---------------------------------------

test('memoryBudgetPx grants the larger budget only at >=8GB', () => {
  assert.equal(memoryBudgetPx(8), 22_000_000);
  for (const gb of [4, 2, 1, 0.5, 0, undefined, null, NaN, -1]) {
    assert.equal(memoryBudgetPx(gb), 12_000_000, `gb ${gb} must fall to the safe baseline`);
  }
});

test('the ample budget resolves to 4x and the baseline to 3x for the representative poster', () => {
  assert.equal(posterScale(FLAGSHIP_DIM, memoryBudgetPx(8), W, H), 4);
  assert.equal(posterScale(FLAGSHIP_DIM, memoryBudgetPx(4), W, H), 3);
  assert.equal(posterScale(FLAGSHIP_DIM, memoryBudgetPx(undefined), W, H), 3);
});

// --- shims ---------------------------------------------------------------------------------------

test('maxCanvasDim falls back to 4096 with no document / no WebGL, caps at 16384', () => {
  assert.equal(maxCanvasDim(null), 4096);
  assert.equal(maxCanvasDim({ createElement: () => ({ getContext: () => null }) }), 4096);
  const fakeDoc = (max) => ({ createElement: () => ({ getContext: () => ({ MAX_TEXTURE_SIZE: 0x0d33, getParameter: () => max }) }) });
  assert.equal(maxCanvasDim(fakeDoc(8192)), 8192);
  assert.equal(maxCanvasDim(fakeDoc(32768)), 16384);
  assert.equal(maxCanvasDim(fakeDoc(1024)), 4096);
});

test('deviceMemoryGb reads navigator.deviceMemory, 0 when absent', () => {
  assert.equal(deviceMemoryGb({ deviceMemory: 8 }), 8);
  assert.equal(deviceMemoryGb({ deviceMemory: 4 }), 4);
  assert.equal(deviceMemoryGb({}), 0);
  assert.equal(deviceMemoryGb(null), 0);
});
