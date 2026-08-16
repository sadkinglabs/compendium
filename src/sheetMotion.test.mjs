// Fixtures for the bottom-sheet motion engine (src/components/sheetMotion.js).
// Run: npm run test:app   (node --test)
//
// The engine owns the app's highest-risk interaction (every sheet's open, drag,
// dismissal and close) and writes to the DOM directly, so it is tested here against
// a deterministic fake DOM + fake clock rather than left to device passes. The cases
// are the ones Codex required in docs/bottom-sheet-device-review-1.md section 6,
// which are exactly the defects the first device pass found.
//
// Fakes are installed on globalThis BEFORE importing the module under test, because
// the engine reads window/document/performance/rAF lazily (at call time), never at
// import time. The clock is manual: `pump()` advances time and runs queued frames,
// so spring settling is reproducible frame-for-frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- fake environment -------------------------------------------------------
let now = 1000;
let frames = [];
let timers = [];

function makeEl(height = 400) {
  const listeners = new Map();
  return {
    style: {},
    offsetHeight: height,
    scrollTop: 0,
    _children: [],
    contains(node) { return node === this || this._children.includes(node); },
    addEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).concat(fn)); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); },
    _count(type) { return (listeners.get(type) || []).length; },
    _emit(type) { for (const fn of listeners.get(type) || []) fn({ type }); },
  };
}

const winListeners = new Map();
const fakeWindow = {
  addEventListener(type, fn) { winListeners.set(type, (winListeners.get(type) || []).concat(fn)); },
  removeEventListener(type, fn) { winListeners.set(type, (winListeners.get(type) || []).filter((f) => f !== fn)); },
  _count(type) { return (winListeners.get(type) || []).length; },
  _emit(type, ev) { for (const fn of [...(winListeners.get(type) || [])]) fn(ev); },
};

globalThis.window = fakeWindow;
globalThis.document = { body: { classList: { contains: () => reduceMotion } } };
globalThis.performance = { now: () => now };
globalThis.requestAnimationFrame = (fn) => { const id = frames.length + 1; frames.push({ id, fn }); return id; };
globalThis.cancelAnimationFrame = (id) => { frames = frames.filter((f) => f.id !== id); };
globalThis.setTimeout = (fn, ms) => { const t = { fn, at: now + (ms || 0) }; timers.push(t); return t; };
globalThis.clearTimeout = (t) => { timers = timers.filter((x) => x !== t); };

let reduceMotion = false;

const { createSheetMotion } = await import('./components/sheetMotion.js');

/** Advance the clock and run queued frames, one generation per step. */
function pump(ms = 16, steps = 1) {
  for (let i = 0; i < steps; i++) {
    now += ms;
    const gen = frames;
    frames = [];
    for (const f of gen) f.fn(now);
  }
}
/** Run to settle (bounded so a stuck engine fails the test rather than hanging). */
function settle(max = 400) {
  let n = 0;
  while (frames.length && n++ < max) pump(16);
  return n;
}
function resetEnv() {
  now = 1000; frames = []; timers = []; reduceMotion = false;
  winListeners.clear();
}

function pd(y, { x = 0, id = 1, button = 0 } = {}) { return { clientY: y, clientX: x, pointerId: id, button }; }
const pos = (panel) => {
  const m = /translate3d\(0, ([-\d.]+)%/.exec(panel.style.transform || '');
  return m ? Number(m[1]) : null;
};

function harness({ height = 400, dismissible = true } = {}) {
  resetEnv();
  const panel = makeEl(height);
  const scrim = makeEl();
  const scroller = makeEl();
  panel._children = [scroller];
  const events = { settled: 0, closed: [] };
  const engine = createSheetMotion({
    panel, scrim, scroller,
    isDismissible: () => dismissible,
    onSettled: () => { events.settled++; },
    onClosed: (src) => { events.closed.push(src); },
  });
  return { engine, panel, scrim, scroller, events };
}
/** Open and settle, leaving the engine in the fully-open state. */
function opened(opts) {
  const h = harness(opts);
  h.engine.open();
  settle();
  return h;
}

// ---- the handoff contract (review finding 1b - the bounce-up defect) --------

test('body handoff preserves the gesture ORIGIN - the sheet catches up to the finger', () => {
  const { engine, panel } = opened();
  engine.pointerDown(pd(100), 'body');            // origin y=100, still tracking
  fakeWindow._emit('pointermove', pd(118));       // 18px > 10px slop -> takeover
  // The sheet must reflect the FULL 18px from the origin, not 0 (the old code
  // rebased at the takeover point and threw the first 10+px away).
  assert.ok(Math.abs(pos(panel) - (18 / 400) * 100) < 0.01, `expected ~4.5%, got ${pos(panel)}`);
});

test('body handoff preserves the VELOCITY history - a fast mid-body flick dismisses', () => {
  const { engine, events } = opened();
  engine.pointerDown(pd(100), 'body');
  pump(16); fakeWindow._emit('pointermove', pd(118));   // takeover
  pump(16); fakeWindow._emit('pointermove', pd(150));
  pump(16); fakeWindow._emit('pointerup', pd(170));     // 70px in 48ms ~= 1458 px/s
  settle();
  assert.deepEqual(events.closed, ['gesture']);
});

test('the flick threshold reads POINTER displacement from the origin, not post-takeover panel travel', () => {
  // A flick whose travel is mostly pre-takeover: 12px before ownership, 14px after.
  // Judged on origin displacement (26px >= 20px floor) it dismisses; judged on
  // post-takeover movement alone (14px) it would not - the old failure.
  const { engine, events } = opened();
  engine.pointerDown(pd(100), 'body');
  pump(8); fakeWindow._emit('pointermove', pd(112));
  pump(8); fakeWindow._emit('pointerup', pd(126));      // 26px in 16ms = 1625 px/s
  settle();
  assert.deepEqual(events.closed, ['gesture']);
});

test('a slow sub-threshold drag snaps back WITHOUT further downward travel', () => {
  const { engine, panel, events } = opened();
  engine.pointerDown(pd(100), 'body');
  pump(120); fakeWindow._emit('pointermove', pd(130));
  pump(120); fakeWindow._emit('pointermove', pd(150));   // 50px of 400 = 12.5% < 25%
  const atRelease = pos(panel);
  pump(120); fakeWindow._emit('pointerup', pd(150));
  // No frame may sit lower than the release position: a rejected close must not
  // seed downward velocity (that dip-then-rebound was the visible "bounce").
  let lowest = atRelease;
  for (let i = 0; i < 60 && frames.length; i++) { pump(16); lowest = Math.max(lowest, pos(panel)); }
  assert.ok(lowest <= atRelease + 0.001, `dipped to ${lowest} from ${atRelease}`);
  assert.deepEqual(events.closed, []);
  assert.ok(Math.abs(pos(panel)) < 0.001, 'settles back to fully open');
});

test('a mid-scroll gesture is never stolen: scrolled body drags do not move the sheet', () => {
  const { engine, panel, scroller } = opened();
  scroller.scrollTop = 120;                        // the user is mid-list
  engine.pointerDown(pd(100), 'body');
  fakeWindow._emit('pointermove', pd(160));
  assert.equal(pos(panel), 0, 'sheet stayed put; native scroll keeps the gesture');
  assert.equal(fakeWindow._count('pointermove'), 0, 'engine released the gesture for good');
});

test('chrome (handle/header) drags take ownership immediately and flick the same way', () => {
  const { engine, panel, events } = opened();
  engine.pointerDown(pd(100), 'chrome');
  pump(16); fakeWindow._emit('pointermove', pd(112));    // no slop wait: already dragging
  assert.ok(pos(panel) > 0, 'chrome drag moves on the first move event');
  pump(16); fakeWindow._emit('pointerup', pd(140));
  settle();
  assert.deepEqual(events.closed, ['gesture']);
});

// ---- the scrim contract (owner ruling 1a + review finding 2) ---------------

test('close is a pure slide: the scrim holds full through the visible travel, then lifts in the tail', () => {
  const { engine, panel, scrim, events } = opened();
  assert.equal(scrim.style.opacity, '1');
  engine.dismiss();
  let sawPanelTravel = false;
  for (let i = 0; i < 200 && Number(pos(panel)) < 90; i++) {
    pump(16);
    if (Number(pos(panel)) > 5) sawPanelTravel = true;
    // Through the whole visible slide the dim is untouched - close reads as the
    // sheet coming down, never as the sheet fading out (owner ruling 1a).
    if (Number(pos(panel)) < 90) assert.equal(scrim.style.opacity, '1', 'scrim must not fade during the visible slide');
  }
  assert.ok(sawPanelTravel, 'the panel actually slid');
  assert.deepEqual(events.closed, [], 'unmount is delayed until the fade completes');
  settle();
  assert.deepEqual(events.closed, ['gesture']);
  assert.equal(scrim.style.opacity, '0');
});

test('the screen comes back promptly: the dim is gone within ~300ms of an accepted dismissal', () => {
  // Device pass 2: the background stayed dimmed noticeably after the sheet had
  // gone. Cause: the close spring aimed at exactly 1.0 and approached it
  // asymptotically, so the settle test only passed ~430ms in - a quarter second
  // of dead time before the fade even started. The close now aims past the exit
  // and completes the moment the panel is off-screen.
  const { engine, scrim, events } = opened();
  const t0 = now;
  engine.dismiss();
  let elapsed = null;
  for (let i = 0; i < 200 && elapsed == null; i++) {
    pump(16);
    if (events.closed.length) elapsed = now - t0;
  }
  assert.ok(elapsed != null, 'the close completed');
  assert.ok(elapsed <= 320, `dim cleared in ${elapsed}ms, expected <= 320ms`);
  assert.equal(scrim.style.opacity, '0');
});

test('a flicked dismissal clears even faster than a programmatic one (release velocity carries)', () => {
  const prog = opened();
  const t0 = now;
  prog.engine.dismiss();
  let progMs = null;
  for (let i = 0; i < 200 && progMs == null; i++) { pump(16); if (prog.events.closed.length) progMs = now - t0; }

  const flick = opened();
  flick.engine.pointerDown(pd(100), 'chrome');
  pump(16); fakeWindow._emit('pointermove', pd(140));
  pump(16); fakeWindow._emit('pointerup', pd(190));      // 90px in 32ms
  const t1 = now;
  let flickMs = null;
  for (let i = 0; i < 200 && flickMs == null; i++) { pump(16); if (flick.events.closed.length) flickMs = now - t1; }
  assert.ok(flickMs <= progMs, `flick ${flickMs}ms should not be slower than programmatic ${progMs}ms`);
});

test('a gesture close freezes the scrim at its CURRENT opacity, never re-darkening', () => {
  const { engine, scrim } = opened();
  engine.pointerDown(pd(100), 'chrome');
  pump(16); fakeWindow._emit('pointermove', pd(200));    // dragged 25% down
  const duringDrag = Number(scrim.style.opacity);
  assert.ok(duringDrag < 1, 'drag is position-linked');
  pump(16); fakeWindow._emit('pointerup', pd(260));
  pump(16);
  assert.equal(Number(scrim.style.opacity), duringDrag, 'frozen at the released value, no jump to full');
});

test('the scrim catches a MOVING sheet but stays a plain tap target once open', () => {
  const { engine, panel } = harness();
  engine.open();
  pump(16); pump(16);                                    // mid-entrance
  const midOpen = pos(panel);
  assert.ok(midOpen > 0 && midOpen < 100, 'sheet is in flight');
  engine.pointerDown(pd(300), 'scrim');                  // catch it
  fakeWindow._emit('pointermove', pd(340));
  assert.ok(pos(panel) > midOpen, 'the caught sheet follows the finger downward');
  fakeWindow._emit('pointerup', pd(340));
  settle();

  const open2 = opened();
  const before = pos(open2.panel);
  open2.engine.pointerDown(pd(300), 'scrim');            // fully open: refused
  fakeWindow._emit('pointermove', pd(360));
  assert.equal(pos(open2.panel), before, 'no air-drag from the scrim when open');
});

test('an accepted close can be caught and redirected back open (interruptible)', () => {
  const { engine, panel, events } = opened();
  engine.dismiss();
  pump(16); pump(16);
  const mid = pos(panel);
  assert.ok(mid > 0 && mid < 100);
  engine.pointerDown(pd(300), 'scrim');                  // grab the closing sheet
  fakeWindow._emit('pointermove', pd(290));              // pull it back up
  fakeWindow._emit('pointerup', pd(290));
  settle();
  assert.deepEqual(events.closed, [], 'the redirected sheet never closed');
  assert.ok(Math.abs(pos(panel)) < 0.001, 'it settled open again');
});

test('a caller-initiated close is FINAL - it cannot be caught', () => {
  const { engine, events } = opened();
  engine.close();
  pump(16);
  engine.pointerDown(pd(300), 'scrim');
  fakeWindow._emit('pointermove', pd(280));
  settle();
  assert.deepEqual(events.closed, ['caller']);
});

test('a locked sheet (dismissible false) ignores drags and dismiss()', () => {
  const { engine, panel, events } = opened({ dismissible: false });
  engine.pointerDown(pd(100), 'chrome');
  fakeWindow._emit('pointermove', pd(300));
  assert.equal(pos(panel), 0, 'no drag on a locked sheet');
  engine.dismiss();
  settle();
  assert.deepEqual(events.closed, []);
});

// ---- reduced motion, lifecycle -------------------------------------------

test('reduced motion completes open and close within one frame, still reporting both events', () => {
  const { engine, panel, scrim, events } = harness();   // harness() resets the env, so arm AFTER it
  reduceMotion = true;
  engine.open();
  assert.equal(events.settled, 1, 'open settled immediately');
  assert.equal(pos(panel), 0);
  assert.equal(scrim.style.opacity, '1');
  engine.dismiss();
  assert.deepEqual(events.closed, ['gesture'], 'closed immediately - no fade to wait on');
  assert.equal(scrim.style.opacity, '0');
  assert.equal(frames.length, 0, 'no animation frames were scheduled');
  reduceMotion = false;
});

test('destroy() removes every listener and silences pending frames (no stale callbacks)', () => {
  const { engine, scroller, events } = opened();
  engine.pointerDown(pd(100), 'chrome');
  fakeWindow._emit('pointermove', pd(140));             // gesture live: window listeners attached
  assert.ok(fakeWindow._count('pointermove') > 0);
  assert.ok(scroller._count('scroll') > 0);
  engine.dismiss();
  pump(16);
  const settledBefore = events.settled;
  engine.destroy();
  assert.equal(fakeWindow._count('pointermove'), 0);
  assert.equal(fakeWindow._count('pointerup'), 0);
  assert.equal(fakeWindow._count('pointercancel'), 0);
  assert.equal(fakeWindow._count('touchmove'), 0);
  assert.equal(scroller._count('scroll'), 0);
  pump(16, 30);
  assert.deepEqual(events.closed, [], 'a destroyed engine never reports a close');
  assert.equal(events.settled, settledBefore, 'nor a settle');
});

test('the panel layer stays promoted: transform is written, never cleared', () => {
  const { engine, panel } = opened();
  // Settling at the top must WRITE a zero transform rather than clearing it -
  // clearing demoted the layer and glitched the WebView raster (finding 3).
  assert.match(panel.style.transform, /^translate3d\(0, 0(\.0+)?%, 0\)$/);
  engine.dismiss();
  pump(16);
  assert.ok(/translate3d/.test(panel.style.transform), 'still transformed while closing');
});

test('a scroll inside the body arms a cooldown that refuses an immediate drag takeover', () => {
  const { engine, panel, scroller } = opened();
  scroller._emit('scroll');                              // just scrolled (cooldown 100ms)
  engine.pointerDown(pd(100), 'body');
  fakeWindow._emit('pointermove', pd(160));              // within the cooldown
  assert.equal(pos(panel), 0, 'momentum scrolling must not hand the sheet the gesture');
});
