import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posterScale, maxCanvasDim } from './posterScale.js';

const W = 990;

test('a flagship cap (16384) lifts a normal poster to the max band (crisper text)', () => {
  assert.equal(posterScale(16384, W, 1300), 5);
});

test('a budget cap (4096) stays at a SAFE 3x - never blanks the canvas', () => {
  assert.equal(posterScale(4096, W, 1300), 3);
});

test('the scale never lets either dimension exceed the cap', () => {
  for (const cap of [4096, 8192, 16384]) {
    for (const h of [900, 1300, 1800, 3000]) {
      const s = posterScale(cap, W, h);
      assert.ok(Math.max(W, h) * s <= cap, `cap ${cap} h ${h} scale ${s} exceeds the cap`);
    }
  }
});

test('a very tall deck downshifts rather than overflowing the cap', () => {
  assert.equal(posterScale(8192, W, 3000), 2);   // floor(8192/3000)=2
  assert.equal(posterScale(4096, W, 3000), 1);   // even 2x would blank (6000>4096) -> 1x, never blank
});

test('a missing / implausible cap floors at 1, never NaN or 0 (no blank)', () => {
  for (const bad of [0, undefined, null, NaN, -1, 100]) {
    const s = posterScale(bad, W, 1300);
    assert.ok(Number.isInteger(s) && s >= 1, `bad cap ${bad} -> ${s}`);
  }
});

test('max is respected as the upper clamp', () => {
  assert.equal(posterScale(999999, W, 1300, { max: 4 }), 4);   // huge cap clamps to max
  assert.equal(posterScale(999999, W, 1300), 5);               // default max
});

test('maxCanvasDim falls back to 4096 with no document / no WebGL', () => {
  assert.equal(maxCanvasDim(null), 4096);
  assert.equal(maxCanvasDim({ createElement: () => ({ getContext: () => null }) }), 4096);
});

test('maxCanvasDim reads MAX_TEXTURE_SIZE and caps it at 16384', () => {
  const fakeDoc = (max) => ({ createElement: () => ({ getContext: () => ({ MAX_TEXTURE_SIZE: 0x0d33, getParameter: () => max }) }) });
  assert.equal(maxCanvasDim(fakeDoc(8192)), 8192);
  assert.equal(maxCanvasDim(fakeDoc(32768)), 16384);   // absurd values are capped
  assert.equal(maxCanvasDim(fakeDoc(1024)), 4096);      // implausibly small -> safe floor
});
