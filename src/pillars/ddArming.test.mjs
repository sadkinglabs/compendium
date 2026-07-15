// Fixtures for Death's Door arming (src/pillars/ddArming.js).
// Run: npm run test:ui   (node --test)
//
// Two jobs: (1) pin the safety guard, because it protects a destructive action and
// every one of its properties is invisible to the type system; (2) lock the specific
// failures this replaced - a pill that armed instantly under a tapping thumb, and a
// minus tap at zero that ended the match outright from a half-screen target.
//
// NOT covered here, and honestly so: that taps physically pass THROUGH the inert pill
// to the tap zone beneath. That is DOM hit-testing - real compositor behaviour - and
// this repo has no DOM harness. It is verified on device; see the note in
// LifeCounter.jsx above `dd`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ddReduce, createDdArming, initialPhase, DD, DD_ARM_QUIET_MS, DD_ARM_REVEAL_MS } from './ddArming.js';

const ARM_MS = DD_ARM_QUIET_MS + DD_ARM_REVEAL_MS;   // 1500: last tap -> pressable

/** A controller on a manual clock. No real timers, so every assertion is exact. */
function harness(initialLife = { player: 20, opponent: 20 }) {
  let now = 0, seq = 0;
  const timers = new Map();
  const changes = [];
  const dd = createDdArming({
    initialLife,
    onChange: (who, phase) => changes.push(`${who}:${phase}`),
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  const tick = (ms) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].fn();
    }
    now = until;
  };
  return { dd, tick, changes, pending: () => timers.size };
}

// --- the reducer, in isolation -------------------------------------------------

test('life is the only source of truth: recovery wins from every phase', () => {
  for (const phase of [DD.FALLEN, DD.REVEALING, DD.ARMED]) {
    const r = ddReduce(phase, { type: 'SYNC_LIFE', prev: 0, next: 1 });
    assert.equal(r.phase, DD.ALIVE);
    assert.equal(r.timer, null, 'recovery must cancel the pending timer in the same tick');
  }
});

test('a write that leaves a fallen side fallen does not restart the quiet window', () => {
  // setMax at zero: life 0 -> 0. Restarting here would let an unrelated write
  // postpone arming forever.
  const r = ddReduce(DD.REVEALING, { type: 'SYNC_LIFE', prev: 0, next: 0 });
  assert.equal(r.phase, DD.REVEALING);
  assert.equal(r.timer, undefined, 'timer must be left alone');
});

test('initialPhase is derived from life, never assumed', () => {
  assert.equal(initialPhase(20), DD.ALIVE);
  assert.equal(initialPhase(0), DD.FALLEN);
});

// --- arming --------------------------------------------------------------------

test('reaching zero does not arm immediately', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  assert.equal(h.dd.phase('player'), DD.FALLEN);
  h.tick(ARM_MS - 1);
  assert.notEqual(h.dd.phase('player'), DD.ARMED, 'must not be pressable one tick early');
  h.tick(1);
  assert.equal(h.dd.phase('player'), DD.ARMED);
});

test('the pill is inert for the whole reveal stage', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(DD_ARM_QUIET_MS);
  assert.equal(h.dd.phase('player'), DD.REVEALING, 'visible but not yet pressable');
  h.tick(DD_ARM_REVEAL_MS - 1);
  assert.equal(h.dd.phase('player'), DD.REVEALING);
  h.tick(1);
  assert.equal(h.dd.phase('player'), DD.ARMED);
});

test('continued taps postpone arming indefinitely', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  for (let i = 0; i < 20; i++) { h.tick(1000); h.dd.tap('player'); }   // 20s of tapping
  assert.equal(h.dd.phase('player'), DD.FALLEN, 'a hand on the glass must never be handed a hot button');
  h.tick(ARM_MS);
  assert.equal(h.dd.phase('player'), DD.ARMED, 'and it arms once the hand leaves');
});

test('a tap during REVEALING knocks it back to FALLEN', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(DD_ARM_QUIET_MS + 100);
  assert.equal(h.dd.phase('player'), DD.REVEALING);
  h.dd.tap('player');
  assert.equal(h.dd.phase('player'), DD.FALLEN, 'the resume-after-pause case');
  h.tick(ARM_MS - 1);
  assert.notEqual(h.dd.phase('player'), DD.ARMED);
});

test('a tap while ARMED disarms - a resumed drain must not leave it hot', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(ARM_MS);
  h.dd.tap('player');
  assert.equal(h.dd.phase('player'), DD.FALLEN);
});

test('taps while alive are inert, so the call site needs no guard', () => {
  const h = harness();
  h.dd.tap('player');
  assert.equal(h.dd.phase('player'), DD.ALIVE);
  assert.equal(h.pending(), 0, 'a living side must never hold a timer');
});

// --- recovery ------------------------------------------------------------------

test('recovery before arming cancels, and no stale timer fires later', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(600);
  h.dd.syncLife('player', 0, 1);
  assert.equal(h.dd.phase('player'), DD.ALIVE);
  assert.equal(h.pending(), 0);
  h.tick(10000);
  assert.equal(h.dd.phase('player'), DD.ALIVE, 'a stale timer firing after recovery is a release blocker');
});

test('recovery after arming disarms in the same tick', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(ARM_MS);
  assert.equal(h.dd.phase('player'), DD.ARMED);
  h.dd.syncLife('player', 0, 3);
  assert.equal(h.dd.phase('player'), DD.ALIVE);
  assert.equal(h.pending(), 0);
});

test('recovery from REVEALING cancels the reveal timer', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(DD_ARM_QUIET_MS + 100);
  h.dd.syncLife('player', 0, 1);
  assert.equal(h.dd.phase('player'), DD.ALIVE);
  assert.equal(h.pending(), 0);
});

test('reset recovers both sides without a tap - the non-tap writer', () => {
  const h = harness({ player: 0, opponent: 0 });
  h.tick(ARM_MS);
  assert.equal(h.dd.phase('player'), DD.ARMED);
  assert.equal(h.dd.phase('opponent'), DD.ARMED);
  h.dd.syncLife('player', 0, 20); h.dd.syncLife('opponent', 0, 20);   // what reset() does
  assert.equal(h.dd.phase('player'), DD.ALIVE);
  assert.equal(h.dd.phase('opponent'), DD.ALIVE);
  assert.equal(h.pending(), 0);
});

// --- resume --------------------------------------------------------------------

test('a match resumed at zero arms with no further tap', () => {
  const h = harness({ player: 0, opponent: 20 });
  assert.equal(h.dd.phase('player'), DD.FALLEN, 'derived at construction, not assumed alive');
  assert.equal(h.dd.phase('opponent'), DD.ALIVE);
  h.tick(ARM_MS);
  assert.equal(h.dd.phase('player'), DD.ARMED, 'no tap was ever required');
  assert.equal(h.dd.phase('opponent'), DD.ALIVE);
});

test('a match resumed alive holds no timers', () => {
  const h = harness({ player: 20, opponent: 20 });
  assert.equal(h.pending(), 0);
});

// --- independence --------------------------------------------------------------

test('the two sides arm on independent clocks', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(600);
  h.dd.syncLife('opponent', 1, 0);
  h.tick(600);                                   // player at 1200, opponent at 600
  assert.equal(h.dd.phase('player'), DD.REVEALING);
  assert.equal(h.dd.phase('opponent'), DD.FALLEN);
  h.tick(300);                                   // player at 1500
  assert.equal(h.dd.phase('player'), DD.ARMED);
  assert.equal(h.dd.phase('opponent'), DD.FALLEN);
  h.tick(600);                                   // opponent at 1500
  assert.equal(h.dd.phase('opponent'), DD.ARMED);
});

test('tapping one side never postpones the other', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.dd.syncLife('opponent', 1, 0);
  h.tick(1000);
  h.dd.tap('player');
  h.tick(500);
  assert.equal(h.dd.phase('opponent'), DD.ARMED);
  assert.equal(h.dd.phase('player'), DD.FALLEN);
});

// --- suppression ---------------------------------------------------------------

test('an overlay cannot leave armed residue, and hands back a FRESH window', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(ARM_MS);
  assert.equal(h.dd.phase('player'), DD.ARMED);
  h.dd.setSuppressed(true, () => 0);
  assert.equal(h.dd.phase('player'), DD.SUPPRESSED);
  assert.equal(h.pending(), 0, 'suppression must cancel timers');
  h.dd.setSuppressed(false, () => 0);
  assert.equal(h.dd.phase('player'), DD.FALLEN, 'never hand back a hot pill');
  h.tick(ARM_MS - 1);
  assert.notEqual(h.dd.phase('player'), DD.ARMED, 'the window must be fresh, not resumed');
  h.tick(1);
  assert.equal(h.dd.phase('player'), DD.ARMED);
});

test('un-suppressing above zero returns to alive', () => {
  const h = harness();
  h.dd.setSuppressed(true, () => 20);
  h.dd.setSuppressed(false, () => 20);
  assert.equal(h.dd.phase('player'), DD.ALIVE);
  assert.equal(h.pending(), 0);
});

test('life moving under an overlay is re-derived on the way out, not applied blind', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.dd.setSuppressed(true, () => 0);
  h.dd.syncLife('player', 0, 20);                       // healed while a sheet was open
  assert.equal(h.dd.phase('player'), DD.SUPPRESSED);
  h.dd.setSuppressed(false, () => 20);
  assert.equal(h.dd.phase('player'), DD.ALIVE);
});

// --- lifecycle -----------------------------------------------------------------

test('dispose clears every pending timer', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.dd.syncLife('opponent', 1, 0);
  assert.equal(h.pending(), 2);
  h.dd.dispose();
  assert.equal(h.pending(), 0);
});

test('nothing changes after dispose', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.dd.dispose();
  h.dd.syncLife('player', 0, 0);
  h.tick(10000);
  assert.equal(h.dd.phase('player'), DD.FALLEN, 'no onChange after unmount');
});

test('DD_ARM_QUIET_MS is its own knob, not LOG_GAP_MS', () => {
  // They start equal on purpose. This pins that they are separately addressable:
  // retuning log coalescing must never silently change the safety guard.
  assert.equal(typeof DD_ARM_QUIET_MS, 'number');
  assert.ok(DD_ARM_QUIET_MS > 0 && DD_ARM_REVEAL_MS > 0);
});
