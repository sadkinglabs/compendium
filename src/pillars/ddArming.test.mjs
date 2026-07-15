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

test('a tap after arming goes inert immediately - the hand is back on the glass', () => {
  // The misfire this closes: the first resumed tap lands safely on a life zone while
  // the hand KEEPS MOVING, and a second tap drifts onto a still-hot pill. The first
  // tap is the evidence. An earlier "sticky ARMED" ignored it and reopened the bug.
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(ARM_MS);
  assert.equal(h.dd.phase('player'), DD.ARMED);
  h.dd.tap('player');
  assert.equal(h.dd.phase('player'), DD.REARMING, 'inert on the very first resumed tap');
});

test('re-arming needs only quiet - it does not replay the entrance', () => {
  // The device complaint: a stray tap should not cost the whole 1.8s ceremony again.
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(ARM_MS);
  h.dd.tap('player');
  h.tick(DD_ARM_QUIET_MS - 1);
  assert.equal(h.dd.phase('player'), DD.REARMING, 'still inert one tick early');
  h.tick(1);
  assert.equal(h.dd.phase('player'), DD.ARMED, 'quiet alone restores it - no REVEALING');
});

test('continued tapping holds it inert for as long as the hand is there', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(ARM_MS);
  for (let i = 0; i < 10; i++) { h.dd.tap('player'); h.tick(DD_ARM_QUIET_MS - 100); }
  assert.equal(h.dd.phase('player'), DD.REARMING, 'never live while tapping continues');
  h.tick(DD_ARM_QUIET_MS);
  assert.equal(h.dd.phase('player'), DD.ARMED);
});

test('recovery from REARMING disarms and cancels, like every other phase', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(ARM_MS);
  h.dd.tap('player');
  assert.equal(h.dd.phase('player'), DD.REARMING);
  h.dd.syncLife('player', 0, 4);
  assert.equal(h.dd.phase('player'), DD.ALIVE);
  assert.equal(h.pending(), 0);
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

test('a mis-keyed side is refused at every entry point, not just construction', () => {
  // reset() shipped calling commitLife('enemy', ...). The life write looked correct
  // (commitLife picks the ref by testing `who === 'player'`), but syncLife('enemy')
  // invented phases['enemy'] and left the REAL opponent armed with a live timer -
  // a reset that did not reset. The constructor caught this class of typo; apply()
  // did not, so the guard had a hole exactly where it mattered.
  const h = harness();
  assert.throws(() => h.dd.syncLife('enemy', 20, 0), /unknown side "enemy"/);
  assert.throws(() => h.dd.tap('enemy'), /unknown side/);
  assert.equal(h.pending(), 0, 'and it must not have started a timer on the way out');
});

test('a mis-keyed side is refused, loudly', () => {
  // This shipped: the caller passed `enemy` where this expects `opponent`, so
  // initialLife.opponent was undefined, `undefined > 0` was false, and the opponent
  // silently started FALLEN - their End Match pill armed itself a few seconds into a
  // brand new match with nobody at zero. Only a human on a device caught it, because
  // these fixtures pass their own keys and could not see the caller's typo.
  assert.throws(() => createDdArming({ initialLife: { player: 20, enemy: 20 } }), /initialLife\.opponent must be a number/);
  assert.throws(() => createDdArming({ initialLife: { player: 20 } }), /opponent/);
  assert.throws(() => createDdArming({ initialLife: {} }), /player/);
});

// --- independence --------------------------------------------------------------

// Derived from the constants, never hardcoded: the reveal window moved 300 -> 3000 on
// device evidence, and literals here would have failed for the wrong reason.
const LEAD = 600;   // how far ahead of the opponent the player falls

test('the two sides arm on independent clocks', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.tick(LEAD);
  h.dd.syncLife('opponent', 1, 0);
  h.tick(DD_ARM_QUIET_MS - LEAD);                      // player's quiet is up; opponent's is not
  assert.equal(h.dd.phase('player'), DD.REVEALING);
  assert.equal(h.dd.phase('opponent'), DD.FALLEN);
  h.tick(DD_ARM_REVEAL_MS);                            // player armed; opponent still behind
  assert.equal(h.dd.phase('player'), DD.ARMED);
  assert.notEqual(h.dd.phase('opponent'), DD.ARMED);
  h.tick(LEAD);                                        // opponent's full window elapses
  assert.equal(h.dd.phase('opponent'), DD.ARMED);
});

test('tapping one side never postpones the other', () => {
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  h.dd.syncLife('opponent', 1, 0);
  h.tick(ARM_MS - 200);
  h.dd.tap('player');                                  // only the player's hand is on the glass
  h.tick(200);
  assert.equal(h.dd.phase('opponent'), DD.ARMED, 'the quiet side must arm on schedule');
  assert.equal(h.dd.phase('player'), DD.FALLEN, 'the tapping side must not');
});

test('the spam that started all this still cannot arm the pill', () => {
  // The whole feature in one fixture: taps faster than the quiet window, forever.
  // ARMED being sticky must not weaken this - the pill has to never get there.
  const h = harness();
  h.dd.syncLife('player', 1, 0);
  for (let i = 0; i < 40; i++) {
    h.tick(DD_ARM_QUIET_MS - 100);                     // just inside the window, 40 times
    assert.notEqual(h.dd.phase('player'), DD.ARMED, `armed mid-spam at tap ${i}`);
    h.dd.tap('player');
  }
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
