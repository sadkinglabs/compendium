// Death's Door arming - when the centred "End Match" control becomes pressable.
// Pure transition table + a thin timer-owning wrapper, kept out of the component so
// the whole thing is provable with fake timers. Run: npm run test:ui
//
// THE BUG THIS EXISTS TO KILL
// `.dd-pill` used to become interactive the instant life hit 0, dead-centre - the
// exact spot being tapped. The tap that *causes* zero cannot be retargeted (the
// button did not exist when that event dispatched); the failure is that the NEXT
// rapid tap finds a newly-interactive target in the same place. There was a second,
// larger path too: a minus tap at zero called triggerEnd() directly from a tap zone
// covering half the screen. Both are gone - ending a match is now always explicit.
//
// THE MODEL
// Life is the SOLE source of truth for whether a side is at Death's Door. This
// controller owns interaction phase ONLY, and learns about life exclusively through
// syncLife(). It never remembers "alive" - ask the life.
//
//   ALIVE --syncLife(->0)--> FALLEN --quiet--> REVEALING --reveal--> ARMED
//     ^                        ^  ^_______tap_______|________tap________|
//     |________________syncLife(->positive), any state, cancels timers___|
//
// WHY TWO STAGES
// FALLEN->REVEALING proves the hand has left the glass. REVEALING->ARMED covers the
// case quiet alone cannot: a player who pauses, then resumes draining, must not land
// their first resumed tap on a hot button. During REVEALING the pill is visible but
// `pointer-events: none`, so taps pass THROUGH it to the tap zone beneath and knock
// the machine back to FALLEN. That pass-through is load-bearing: a merely `disabled`
// button still occupies the hit-test slot, swallows the tap, and lets the quiet timer
// expire under a live finger - the original bug, wearing a different hat.
//
// WHAT IS NOT THE GUARD
// Not animation timing. Not an absolute timeout (one would eventually arm the pill
// under an active finger - the same defect). Only verified quiet arms. The always-
// available exit is the player FAB's End Match item, which lives outside both tap
// zones.

export const DD_ARM_QUIET_MS = 1200;   // verified-quiet window. Deliberately NOT LOG_GAP_MS:
                                       // log coalescing and destructive-action arming are
                                       // separate product knobs that merely start equal.
// The materialised-but-inert stage, tuned on device rather than by theory. 300ms was
// the safety minimum and read as a control popping in; 3000ms read as dread but left
// the button sitting fully-formed and silently refusing taps for over a second.
// 1800 is the honest number: it is the pill's 1.6s rise plus a beat, so the control
// becomes pressable at almost exactly the moment it finishes arriving. Nothing is
// ever both settled and dead. It is not decoration - a tap anywhere in this window
// still passes through to the tap zone and resets the whole sequence.
export const DD_ARM_REVEAL_MS = 1800;

export const DD = {
  ALIVE: 'alive',
  FALLEN: 'fallen',
  REVEALING: 'revealing',
  ARMED: 'armed',
  // The hand came back after the pill had already armed. It stays visibly settled -
  // no disappearing act, no replayed 1.8s entrance - but it goes inert instantly and
  // needs only a quiet interval to become pressable again.
  //
  // This replaced a "sticky ARMED" that ignored taps outright. That was wrong, and
  // the argument for it was incomplete: the first resumed tap can land safely on a
  // life zone while the HAND KEEPS MOVING, and a second tap drifts onto a pill that
  // is still hot. The first tap is the evidence; ignoring it abandons the invariant.
  // REARMING keeps the device-feedback win (the pill does not vanish and crawl back)
  // without reopening the misfire.
  REARMING: 'rearming',
  SUPPRESSED: 'suppressed',   // an overlay owns the screen; no timers, no armed residue
};

// A timer instruction, kept separate from phase so the reducer stays pure:
//   'quiet' | 'reveal' -> (re)start that timer   ·   null -> cancel   ·   undefined -> leave alone
const KEEP = undefined;

/**
 * The whole transition table. Pure: (phase, event) -> { phase, timer }.
 * `event` is { type, prev?, next?, on?, life? }.
 */
export function ddReduce(phase, event) {
  switch (event.type) {
    // The ONLY way life reaches this controller. Every writer funnels through it.
    case 'SYNC_LIFE': {
      // An overlay owns the screen: life may move underneath, but phase must not.
      // Un-suppressing re-derives from life, so nothing is lost by ignoring it here.
      if (phase === DD.SUPPRESSED) return { phase, timer: KEEP };
      // Recovery. Unconditional, from any phase, and it cancels pending timers in the
      // same tick - which is what makes a stale timer after recovery impossible.
      if (event.next > 0) return { phase: DD.ALIVE, timer: null };
      // Fell. Only on the crossing, so a write that leaves a fallen side fallen
      // (e.g. setMax at zero) must not restart the quiet window.
      if (event.prev > 0) return { phase: DD.FALLEN, timer: 'quiet' };
      return { phase, timer: KEEP };   // already at/below zero: nothing changes
    }

    // A tap landed in that half's life-adjustment region - plus, minus, capped,
    // refused, it makes no difference. Any tap is evidence the hand is on the glass,
    // and the pill must not be pressable under it.
    //
    // Two answers, because the two situations are not the same:
    //   before it ever armed  -> FALLEN: restart the whole ceremony. Nothing is lost;
    //                            the pill was not there yet.
    //   after it armed        -> REARMING: go inert IMMEDIATELY, but stay visible.
    //                            The pill already earned its place, so hiding it and
    //                            replaying the 1.8s entrance punishes a stray tap far
    //                            out of proportion - that was the device complaint.
    //                            Only the quiet interval is required to become live
    //                            again.
    case 'TAP':
      if (phase === DD.ALIVE || phase === DD.SUPPRESSED) return { phase, timer: KEEP };
      if (phase === DD.ARMED || phase === DD.REARMING) return { phase: DD.REARMING, timer: 'quiet' };
      return { phase: DD.FALLEN, timer: 'quiet' };

    case 'QUIET_DONE':
      // Re-arming skips the entrance: the pill never left, so there is nothing to
      // reveal. Quiet alone restores it.
      if (phase === DD.REARMING) return { phase: DD.ARMED, timer: null };
      if (phase !== DD.FALLEN) return { phase, timer: KEEP };
      return { phase: DD.REVEALING, timer: 'reveal' };

    case 'REVEAL_DONE':
      if (phase !== DD.REVEALING) return { phase, timer: KEEP };
      return { phase: DD.ARMED, timer: null };

    case 'SET_SUPPRESSED':
      if (event.on) return { phase: DD.SUPPRESSED, timer: null };
      if (phase !== DD.SUPPRESSED) return { phase, timer: KEEP };
      // Coming back: re-derive from life. At zero this starts a FRESH quiet window
      // rather than restoring ARMED, so an overlay can never hand back a hot pill.
      return event.life > 0 ? { phase: DD.ALIVE, timer: null } : { phase: DD.FALLEN, timer: 'quiet' };

    default:
      return { phase, timer: KEEP };
  }
}

/** Phase a side should start in, derived from life - never assumed. */
export const initialPhase = (life) => (life > 0 ? DD.ALIVE : DD.FALLEN);

/** @typedef {'player' | 'opponent'} DdSide */
const SIDES = ['player', 'opponent'];   // matches change(who) at the call sites - NOT 'enemy'

/**
 * Owns one timer handle per side and applies ddReduce. Timers are injected so tests
 * can drive them; nothing else in the app may create a DD timer.
 *
 * `initialLife` is REQUIRED and derives the starting phase per side: a match resumed
 * with a side already at zero enters FALLEN at mount and arms without a further tap.
 * @param {{ initialLife: Record<DdSide, number>, onChange?: any, setTimeout?: any, clearTimeout?: any }} opts
 */
export function createDdArming({ initialLife, onChange, setTimeout: setT = setTimeout, clearTimeout: clearT = clearTimeout }) {
  // Refuse a missing side outright. `undefined > 0` is false, so a mis-keyed
  // initialLife would silently read as FALLEN - the worst possible default: the
  // opponent's pill arms itself seconds into a fresh match, with no one at zero.
  // That shipped once (the caller passed `enemy` where this expects `opponent`) and
  // the unit tests could not see it, because they pass their own keys. Fail loudly.
  for (const who of SIDES) {
    if (typeof initialLife?.[who] !== 'number') {
      throw new Error(`ddArming: initialLife.${who} must be a number, got ${JSON.stringify(initialLife?.[who])}. Sides are ${SIDES.join(' | ')}.`);
    }
  }
  const phases = { player: initialPhase(initialLife.player), opponent: initialPhase(initialLife.opponent) };
  const handles = { player: null, opponent: null };
  let disposed = false;

  const cancel = (who) => { if (handles[who] != null) { clearT(handles[who]); handles[who] = null; } };

  // The ONE side assertion, used by every entry point - public and internal. A closed
  // set, deliberately: an earlier version tested `who in phases`, and `in` walks the
  // prototype chain, so `tap('toString')` was ACCEPTED and ddReduce then reduced over
  // a function. A guard that promises to refuse every unknown side must not have a
  // dozen inherited ones smuggled in behind it.
  //
  // Why any of this exists: without it an unknown side is INVENTED. phases['enemy']
  // springs into being, onChange fires with a key nothing renders, and - the dangerous
  // half - the real side keeps its phase and its pending timer. That shipped twice:
  // through initialLife at mount, and through syncLife in reset(), where
  // commitLife('enemy', ...) wrote the right ref (it tests `who === 'player'`) while
  // the controller call quietly went nowhere.
  const assertSide = (who) => {
    if (!SIDES.includes(who)) throw new Error(`ddArming: unknown side ${JSON.stringify(who)}. Sides are ${SIDES.join(' | ')}.`);
    return who;
  };

  function apply(who, event) {
    if (disposed) return;
    assertSide(who);
    const before = phases[who];
    const { phase, timer } = ddReduce(before, event);
    // Quiet and reveal are never pending together for a side: any instruction other
    // than KEEP clears the previous handle first.
    if (timer !== KEEP) {
      cancel(who);
      if (timer === 'quiet') handles[who] = setT(() => { handles[who] = null; apply(who, { type: 'QUIET_DONE' }); }, DD_ARM_QUIET_MS);
      else if (timer === 'reveal') handles[who] = setT(() => { handles[who] = null; apply(who, { type: 'REVEAL_DONE' }); }, DD_ARM_REVEAL_MS);
    }
    if (phase !== before) { phases[who] = phase; onChange?.(who, phase); }
  }

  // A side resumed at zero must arm on its own, with no further tap. Phase is already
  // derived above (so no onChange fires during construction); this only starts its
  // quiet window. prev=Infinity reads as "it has just crossed", which is the truth
  // from this controller's point of view - it has never seen this side alive.
  for (const who of SIDES) if (phases[who] === DD.FALLEN) apply(who, { type: 'SYNC_LIFE', prev: Infinity, next: initialLife[who] });

  return {
    // Every public entry point refuses an unknown side, not just the constructor -
    // a controller that guards its initialisation and then accepts the very typo it
    // guards against elsewhere is not a guard. syncLife/tap route through apply(),
    // which asserts; phase() is the one that does not, so it asserts here.
    phase: (who) => phases[assertSide(who)],
    /** The one entry point for life. prev/next let the reducer see the crossing. */
    syncLife: (who, prev, next) => apply(who, { type: 'SYNC_LIFE', prev, next }),
    /** Any tap in a life zone. No-op while ALIVE or SUPPRESSED, so callers need no guard. */
    tap: (who) => apply(who, { type: 'TAP' }),
    /** An overlay/menu owning the screen. Applies to both sides. */
    setSuppressed: (on, lifeOf) => { for (const who of SIDES) apply(who, { type: 'SET_SUPPRESSED', on, life: on ? 0 : lifeOf(who) }); },
    pending: () => SIDES.filter((w) => handles[w] != null).length,
    dispose: () => { for (const who of SIDES) cancel(who); disposed = true; },
  };
}
