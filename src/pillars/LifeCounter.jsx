// Life counter - implements the visual and motion design of Play pillar's counter screen, plus
// its full-screen end-match modal and centered secondary modals (Dice / Max Life
// / Match Log). Supports RESUME: a match can be minimized (leave to check a Codex
// rule) and returned to, preserving life totals, log and banked elapsed time.
// Numerals + roll-off + bump are driven IMPERATIVELY (refs + classList) so React
// never overwrites the animation mid-flight.
import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import '../theme/counter.css';
import { recentOpponents, setSetting } from '../store/playRepository.js';
import { buildMatchShare } from '../store/matchShare.js';
import QRCode from '../components/QRCode.jsx';
import { haptic, setKeepAwake, setImmersive, shareLink } from '../native.js';
import { registerBackConsumer } from '../back.js';
import { cardFallbackArt } from '../store/cardArt.js';
import { useArtSource } from '../components/ArtImage.jsx';
import { createDdArming, DD } from './ddArming.js';
import { initSide, restoreSide, applyStep, applyMax, LIFE_CAP, MIN_MAX } from './matchLife.js';
import { rollOutcome, initialRollPhase, isRollLocked, canStartRoll } from './matchRoll.js';
import { resolveCounterBackFallback } from '../navBack.js';
import { buildMatchSnapshot, readMatchSnapshot } from '../store/matchSnapshot.js';

const LOG_GAP_MS = 1200;
const ROLL_DISMISS_TAPS = 5;   // life taps after which the armed roll offer retires itself
// Colour arrives in TWO taps, not five. It used to track the dismiss count, which read
// backwards: the realm came alive as you spent life. Two taps is enough to say "I am
// tracking, not rolling", so the realm wakes almost at once and the roll offer takes
// its own time to bow out. They are separate intentions and now have separate counts.
const BIRTH_TAPS = 2;
const WINDUP_MS = 420;         // the throw: lights down, numerals pull in, then release
const HOLD_MS = 4000;          // the verdict hold - two humans decide who goes first
const BIRTH_REST_MS = 450;     // the ash's resting transition; also Death's Door's recovery rush
const BIRTH_WAVE_MS = 900;     // waving the ceremony off: the Toll's fall duration, inverted

function fmtDur(secs) {
  secs = Math.max(0, Math.round(secs || 0));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
// Digital clock face for the match strip - "12:05" / "1:23:45" (Play _tickClock).
function fmtClock(secs) {
  secs = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export default function LifeCounter({ settings, mode, players = /** @type {{ you?: object, opp?: object }} */ ({}), deck = null, resume = null, onMinimize, onPersist, onRecord, onExit, onNewMatch, registerApi }) {
  const start = settings.default_max_life || 20; // clamped to <=20 by initSide - matchLife owns the cap
  const quick = mode === 'quick';

  // The resume snapshot, read through the single-sourced contract (memoized per `resume`,
  // since only the first-render initializers below consume it). Every initializer seeds from
  // `r`, so build and restore stay in lockstep. Life/max are still clamped by restoreSide
  // (matchLife owns the range rule); matchSnapshot only owns the field shape.
  const r = useMemo(() => (resume ? readMatchSnapshot(resume) : null), [resume]);
  const pRef = useRef(r ? restoreSide(r.p) : initSide(start));
  const eRef = useRef(r ? restoreSide(r.e) : initSide(start));
  const [, force] = useState(0);            // re-render for dd-pill / status badge / max
  const [deltas, setDeltas] = useState([]);
  const [rollPhase, setRollPhase] = useState(initialRollPhase(!!resume));   // 'armed'|'windup'|'rolling'|'result'|null - matchRoll owns the resume-skip rule
  const [resultLeft, setResultLeft] = useState(4);   // seconds left on "Match begins in"
  const [rollWin, setRollWin] = useState(null);      // 'player' | 'opponent' | null
  const [openSeq, setOpenSeq] = useState(0);         // bumped at the unlock; remounts the curtain

  // ── birth: colour as life arriving ──
  // ONE axis for the whole screen: monochrome = life has not arrived · colour = life
  // is here · Death's Door takes it away again. Nobody is dying in the opening ash,
  // because nobody is alive yet. The ash layer the Toll RAISES is the one birth
  // LOWERS - same layer, opposite direction, no extra texture.
  //
  // `birth` is React STATE, not an imperative style write. It has to be: the ceremony
  // sets rollPhase/rollWin/resultLeft and therefore guarantees re-renders, and React
  // owns this element's style prop - it would restore its own value over any
  // element.style mutation, mid-fill.
  //
  // Seeded from `resume` in the initialiser, so a resumed match is COLOURED IN ITS
  // FIRST PAINTED FRAME. Not an effect: an effect runs after paint, which is one
  // frame of ash on every resume.
  const [birth, setBirthValue] = useState(() => (resume ? 1 : 0));
  const [birthMs, setBirthMs] = useState(BIRTH_REST_MS);
  const [birthEase, setBirthEase] = useState('ease');
  // The ONE writer. Monotonic BY CONSTRUCTION (Math.max), not by convention: colour
  // must never retreat, because a realm losing colour is Death's Door's sentence and
  // this must never accidentally speak it. Fidget-then-roll therefore fills from
  // wherever you left it, over the same 4s - a subtler birth, which is the honest
  // trade rather than contradicting the language.
  const setBirth = (value, ms, ease = 'ease') => {
    setBirthMs(ms); setBirthEase(ease);
    setBirthValue((cur) => Math.max(cur, value));
  };
  // The single exception, and it is not a drain: a fresh match is UNMADE, not killed.
  // Instant (0ms) is what makes that read as unmaking rather than dying.
  const unbirth = () => { setBirthMs(0); setBirthValue(0); };
  // --birth-ms times the ash, and the ash is ALSO what a Death's Door recovery fades.
  // The two can never overlap (birth only runs at match start, with life at 20), but a
  // duration parked by the ceremony would make a LATER recovery tween over four
  // seconds. So the resting value is restored once each fill has landed.
  // Keyed on the duration itself rather than a timer per path: no future skip path can
  // forget it, unmount cleans it up, and a throttled/late restore is harmless because
  // birth has already arrived. Death's Door's FALL is fully decoupled - it carries its
  // own --dd-fall-ms and never reads this.
  useEffect(() => {
    if (birthMs === BIRTH_REST_MS) return;
    const t = setTimeout(() => setBirthMs(BIRTH_REST_MS), birthMs + 60);
    return () => clearTimeout(t);
  }, [birthMs]);
  const [fabP, setFabP] = useState(false);
  const [fabE, setFabE] = useState(false);
  const [sheet, setSheet] = useState(null);              // 'log'|'dice'|'maxP'|'maxE'|'tweaks'
  // Tweaks - Play pillar's counter-local comforts (keep awake / hide status bar /
  // film grain). Persisted per profile, applied live to the running match.
  const [tw, setTw] = useState({ keep_awake: !!settings.keep_awake, immersive: !!settings.immersive, film_grain: settings.film_grain !== 0 });
  const [dice, setDice] = useState({ type: settings.die_type || 6, value: null });
  const [oppName, setOppName] = useState(r?.oppName ?? '');
  const [recent, setRecent] = useState([]);
  const [log, setLog] = useState(r?.log ?? []);
  const [endInfo, setEndInfo] = useState(null);          // { winner, pLife, eLife, durationSec, recorded }
  const [confirm, setConfirm] = useState(null);          // { label, action } - in-world discard confirm
  const [clockOn, setClockOn] = useState(r?.clockOn ?? false);   // match clock; persists across minimize/resume

  const pNumRef = useRef(null), eNumRef = useRef(null);
  const startedAt = useRef(Date.now());
  const elapsedBase = useRef(r?.elapsedSec ?? 0);   // banked elapsed from prior segments
  const lastLog = useRef(null);
  const deltaId = useRef(0);
  const lifeTaps = useRef(0);   // successful life taps since the roll offer armed
  // Side keys are `player` | `opponent` EVERYWHERE in this component's logic - the same
  // vocabulary change() passes and ddArming.js enforces. `enemy` survives only as a
  // visual name (.enemy-half, #enemy-bg), never as a key. These were keyed `enemy`
  // while showDelta() wrote them as `opponent`: JS invented the key, so the cleanup
  // below cleared a null and the opponent's release timer leaked on every unmount.
  const activeDelta = useRef({ player: null, opponent: null });   // {id,sign} of the live (still-counting) delta bubble per side
  const deltaTimers = useRef({ player: null, opponent: null });   // per-side "you've stopped tapping" release timers
  const timers = useRef([]);
  const recordingRef = useRef(false);   // in-flight guard for Record (blocks double-tap)
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // Once recorded, a match stays recorded across minimize/resume so it can't be
  // saved twice (double W/L). Seeded from the resumed snapshot.
  const recordedRef = useRef(r?.recorded ?? false);
  const elapsedSec = () => Math.round(elapsedBase.current + (Date.now() - startedAt.current) / 1000);
  function buildSnapshot() {
    return buildMatchSnapshot({
      mode, settings, you: players.you, opp: players.opp, deck,
      p: pRef.current, e: eRef.current,
      log, elapsedSec: elapsedSec(), oppName, recorded: recordedRef.current, clockOn,
    });
  }
  const snapRef = useRef();
  snapRef.current = buildSnapshot;
  function minimize() { onMinimize?.(snapRef.current()); }
  // Refs mirror the modal layers so the (mount-time) hardware-back handler can
  // read current state. Hardware back must peel the topmost layer - NOT jump
  // straight to minimize, which would hide an open (possibly already-recorded)
  // end screen and let it be resumed + recorded a second time.
  const endRef = useRef(null); endRef.current = endInfo;
  const sheetRef = useRef(null); sheetRef.current = sheet;
  const fabRef = useRef(false); fabRef.current = fabP || fabE;
  const confirmRef = useRef(null); confirmRef.current = confirm;
  function closeTopmost() {
    // The counter's internal back precedence (confirm > end > sheet > fab, else minimize) is
    // single-sourced + tested in navBack.js so it can't drift untested; the ACTIONS stay here.
    switch (resolveCounterBackFallback({ confirm: confirmRef.current, end: endRef.current, sheet: sheetRef.current, fab: fabRef.current })) {
      case 'confirm': return setConfirm(null);
      case 'end': return setEndInfo(null);
      case 'sheet': return setSheet(null);
      case 'fab': return void (setFabP(false), setFabE(false));
      default: return minimize();
    }
  }

  // ── Death's Door arming ──
  // Owns ONLY when the centred End Match control becomes pressable. Life stays the
  // sole source of truth: this learns about it through commitLife -> dd.syncLife and
  // never remembers "alive". See ddArming.js for why, and for the two defects it
  // replaced.
  //
  // ONE PROPERTY IS NOT UNIT-TESTED, deliberately: that a tap during REVEALING passes
  // THROUGH the visible-but-inert pill to the .tap-zone beneath. That is DOM
  // hit-testing - real compositor behaviour - and there is no DOM harness here. It is
  // load-bearing (a merely `disabled` button would swallow the tap and let the quiet
  // timer expire under a live finger, which IS the original bug), so it is verified on
  // device. `.dd-pill.dd-armed` is the only rule in the app that sets pointer-events:
  // auto; if that ever stops being true, this guard is gone.
  const [ddPhase, setDdPhase] = useState({ player: DD.ALIVE, opponent: DD.ALIVE });
  const ddRef = useRef(null);
  if (ddRef.current === null) {
    ddRef.current = createDdArming({
      // Derived from restored life, never assumed: a match resumed with a side already
      // at Death's Door enters FALLEN at mount and arms with no further tap.
      initialLife: { player: pRef.current.life, opponent: eRef.current.life },
      onChange: (who, phase) => setDdPhase((p) => ({ ...p, [who]: phase })),
    });
    // Mirror the derived phases into React's first render.
    if (ddRef.current.phase('player') !== DD.ALIVE || ddRef.current.phase('opponent') !== DD.ALIVE) {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      Object.assign(ddPhase, { player: ddRef.current.phase('player'), opponent: ddRef.current.phase('opponent') });
    }
  }
  const dd = /** @type {import('./ddArming.js').DdApi | null} */ (ddRef.current);   // recover the type useRef erases (no @types/react)
  // Bumped each time a side falls, so the shock ring remounts and replays per fall
  // rather than only on first mount.
  const [fallSeq, setFallSeq] = useState({ player: 0, opponent: 0 });
  const bumpFallSeq = (who) => setFallSeq((s) => ({ ...s, [who]: s[who] + 1 }));

  // ── numeral rendering (imperative, mirrors renderLife) ──
  function setNum(el, life) {
    if (!el) return;
    const isDd = life <= 0;
    el.textContent = isDd ? 'DD' : String(life);
    el.classList.toggle('dd', isDd);
    el.classList.toggle('dd-pulse', isDd);
    // The live region must say the state, not the literal glyphs "DD". Cleared on
    // recovery in the same synchronous call, so the fallen description never lingers.
    if (isDd) el.setAttribute('aria-label', "At Death's Door"); else el.removeAttribute('aria-label');
  }
  // THE one life writer. Every mutation of a side's {life,max} goes through here, so
  // "no writer bypasses Death's Door sync" is structural rather than a promise -
  // ordinary taps, setMax, reset, and (via initialLife above) a resumed snapshot.
  // syncLife runs synchronously right after the ref write and before any logging,
  // animation or re-render, so recovery can never race a pending timer.
  function commitLife(who, nextLife, nextMax) {
    const ref = who === 'player' ? pRef : eRef;
    const prev = ref.current.life;
    ref.current = { life: nextLife, max: nextMax };
    setNum(who === 'player' ? pNumRef.current : eNumRef.current, nextLife);
    dd.syncLife(who, prev, nextLife);
  }
  function renderLife() { setNum(pNumRef.current, pRef.current.life); setNum(eNumRef.current, eRef.current.life); }

  useEffect(() => {
    renderLife();
    recentOpponents().then(setRecent);
    if (settings.keep_awake) setKeepAwake(true);
    if (settings.immersive) setImmersive(true);
    if (!settings.film_grain) document.body.classList.add('grain-off');
    if (!resume) armRollOff();                 // resumed matches already rolled for turn order
    registerApi?.({ minimize: () => onMinimize?.(snapRef.current()), closeTopmost });
    // The Web Wake Lock auto-releases when the app is backgrounded and does NOT
    // re-acquire on return - and the OS restores the status bar. Re-assert both
    // when the match returns to the foreground (the resume flow makes this common).
    // Durably capture the live match the instant the app is backgrounded or torn down,
    // so an OS kill from the background no longer loses an in-progress game. saveOngoing
    // (via onPersist) is a synchronous localStorage write, so it completes inside the
    // hidden/pagehide window with no async flush. Save-only: the match stays open on
    // screen; App reconciles the snapshot at boot after a real process death.
    const persist = () => onPersist?.(snapRef.current());
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (settings.keep_awake) setKeepAwake(true);
        if (settings.immersive) setImmersive(true);
      } else {
        persist();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', persist);
    return () => { clearTimers(); clearTimeout(deltaTimers.current.player); clearTimeout(deltaTimers.current.opponent); dd.dispose(); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', persist); document.body.classList.remove('roll-active', 'grain-off'); setKeepAwake(false); setImmersive(false); registerApi?.(null); };
    // eslint-disable-next-line
  }, []);

  // Two different things, deliberately not the same set.
  //
  // overlayOpen HIDES the pill while anything owns the screen - purely visual, and it
  // includes the FABs.
  //
  // centredOverlay RESETS the guard, and only a CENTRED overlay does: its dismissing
  // tap lands right where the pill sits, so handing back an armed pill underneath it
  // would be the original bug in a party hat. The Max Life modal at zero is the sharp
  // case. A FAB menu is a corner control - its dismiss tap cannot physically reach the
  // centre - so it hides the pill without costing the user the whole wait again. That
  // distinction is the fix for "opening any FAB re-triggers the reveal".
  //
  // useLayoutEffect, not useEffect: the flush must land BEFORE paint, so no frame
  // exists in which an armed pill coexists with an open overlay.
  // ONE uninterrupted suppression interval. All three ceremony phases map to true, so
  // centredOverlay cannot dip between windup -> rolling -> result and momentarily
  // hand back a live pill. It goes false exactly once, at finishRollOff, where life is
  // 20 on both sides and the un-suppress is a no-op anyway.
  const rollLocked = isRollLocked(rollPhase);
  const overlayOpen = rollLocked || endInfo != null || sheet != null || confirm != null || fabP || fabE;
  const centredOverlay = rollLocked || endInfo != null || sheet != null || confirm != null;
  useLayoutEffect(() => {
    dd.setSuppressed(centredOverlay, (who) => (who === 'player' ? pRef : eRef).current.life);
    // eslint-disable-next-line
  }, [centredOverlay]);

  // Tweaks toggle - persists to the profile's settings AND applies immediately.
  function setTweak(key, on) {
    setTw((t) => ({ ...t, [key]: on }));
    setSetting(key, on ? 1 : 0).catch(() => {});
    if (key === 'keep_awake') setKeepAwake(on);
    if (key === 'immersive') setImmersive(on);
    if (key === 'film_grain') document.body.classList.toggle('grain-off', !on);
    haptic('light');
  }

  // The roll-off is OPTIONAL and never blocks *starting* the match (the armed
  // pill just floats as an offer - armed = fully interactive: tap life, open
  // menus, leave). But once you commit to rolling, the counter stays locked
  // through the spin AND the 4s result countdown: the life numerals are borrowed
  // to tumble the dice, and a stray tap the instant the winner lands is confusing
  // - it drops the reveal and edits life before you've read it. So block taps /
  // FABs for the whole 'rolling' + 'result' window; they free up when it finishes.
  useEffect(() => { document.body.classList.toggle('roll-active', rollLocked); }, [rollLocked]);

  // Match clock - re-render once a second while it's showing (elapsedSec() reads
  // live). Stops once the match is decided; CSS hides it during the roll-off.
  useEffect(() => {
    if (!clockOn || endInfo) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [clockOn, endInfo]);

  // ── life change (changeLife) ──
  function appendLog(who, delta, toLife) {
    const now = Date.now();
    setLog((prev) => {
      const last = prev[prev.length - 1];
      if (last && lastLog.current && last.who === who && Math.sign(last.delta) === Math.sign(delta) && now - lastLog.current <= LOG_GAP_MS) {
        lastLog.current = now; return [...prev.slice(0, -1), { ...last, delta: last.delta + delta, toLife }];
      }
      lastLog.current = now; return [...prev, { t: new Date().toISOString(), who, kind: 'life', delta, toLife }];
    });
  }
  // Release the live bubble for a side: mark it floating (CSS .released) and bin
  // it once the rise animation is done.
  function releaseDelta(who) {
    const active = activeDelta.current[who];
    if (!active) return;
    activeDelta.current[who] = null;
    clearTimeout(deltaTimers.current[who]);
    setDeltas((list) => list.map((x) => (x.id === active.id ? { ...x, released: true } : x)));
    timers.current.push(setTimeout(() => setDeltas((list) => list.filter((x) => x.id !== active.id)), 850));
  }
  // The floating badge coalesces exactly like the match log: successive taps on
  // the same side in the same direction fold into one bubble that counts up in
  // place (+1, +2, +3...). When you stop tapping (LOG_GAP_MS of quiet) that
  // running total floats away. A direction flip retires the old bubble first.
  function showDelta(who, delta) {
    const sign = Math.sign(delta);
    const active = activeDelta.current[who];
    if (active && active.sign === sign) {
      setDeltas((list) => list.map((x) => (x.id === active.id ? { ...x, delta: x.delta + delta } : x)));
    } else {
      if (active) releaseDelta(who);
      const id = ++deltaId.current;
      activeDelta.current[who] = { id, sign };
      setDeltas((list) => [...list, { id, who, delta, released: false }]);
    }
    clearTimeout(deltaTimers.current[who]);
    deltaTimers.current[who] = setTimeout(() => releaseDelta(who), LOG_GAP_MS);
  }
  function bump(who, delta) {
    const el = who === 'player' ? pNumRef.current : eNumRef.current;
    if (!el) return;
    el.classList.remove('bump-up', 'bump-down');
    void el.offsetWidth;
    el.classList.add(delta > 0 ? 'bump-up' : 'bump-down');
  }
  // Imperative one-shots on the numeral, same pattern as bump(): drop the class,
  // force a reflow so the animation can restart, re-add.
  function numAnim(who, cls) {
    const el = who === 'player' ? pNumRef.current : eNumRef.current;
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  const refuseAtFloor = (who) => numAnim(who, 'dd-refuse');   // the door holds
  function change(who, delta) {
    // EVERY tap in a life zone postpones arming - plus, minus, capped at 20, refused
    // at 0, or one that only dismisses a FAB menu. No conditions: dd.tap is inert
    // while alive. This is the safety invariant, and it is why it is the first act.
    //
    // It runs BEFORE the FAB-dismiss return on purpose. An earlier version returned
    // first, on the reasoning that a FAB is a corner control whose dismissal cannot
    // reach the centre. That was simply false: this handler is on the LIFE ZONE, so
    // the dismissing tap can be dead centre, right where the pill sits - and the pill
    // is only hidden while the menu is open, so it would come back still hot under a
    // finger that is already tapping. Now that tap makes the side inert like any
    // other, and REARMING means it costs a quiet interval rather than the whole
    // ceremony.
    dd.tap(who);
    if (fabP || fabE) { setFabP(false); setFabE(false); haptic('light'); return; }

    const cur = who === 'player' ? pRef.current : eRef.current;
    const step = applyStep(cur, delta);   // pure life arithmetic (dir is -1|+1) - see matchLife.js
    // The door holds. This used to call triggerEnd() outright - a second, larger
    // misfire path than the pill, since the minus zone is half the screen. Death's
    // Door is a live game state in Sorcery, not a loss: ending a match is now always
    // an explicit act, never a side effect of tapping.
    if (step.refused) { refuseAtFloor(who); haptic('medium'); return; }
    if (!step.changed) return;   // capped at max: no-op, but dd.tap() already counted it
    const next = step.side.life;
    commitLife(who, next, step.side.max);  // <- syncLife fires in here: falls, and recovers
    appendLog(who, delta, next);
    showDelta(who, delta);
    // The fall gets the slam, not the ordinary bump - and a heavy haptic. bumpFallSeq
    // remounts the shock ring so it replays on every fall, not just the first.
    if (next <= 0) { numAnim(who, 'dd-slam'); bumpFallSeq(who); haptic('heavy'); }
    else { bump(who, delta); haptic('light'); }
    force((n) => n + 1);
    // Two counts, two intentions - deliberately NOT the same number (see BIRTH_TAPS).
    // Colour is life breathed in by touch, so it completes fast: whole at the SECOND
    // tap. The offer bows out on its own schedule, at the FIFTH, once the player has
    // clearly settled into tracking - late enough that it can never sit in the way of
    // a fast tap, and never so eager that a stray tap costs someone the ceremony.
    // So the realm is fully alive for three taps while the roll is still on offer.
    // That is correct: colour says life has arrived, not that the ceremony is spent.
    if (rollPhase === 'armed') {
      const n = ++lifeTaps.current;
      setBirth(Math.min(1, n / BIRTH_TAPS), 420, 'cubic-bezier(.2,.8,.3,1)');
      if (n >= ROLL_DISMISS_TAPS) fadeOutRoll();
    }
  }
  // Max is floored at 1 by MaxLifeModal, so this can never drive a living side to
  // zero (Math.min(life, >=1) >= 1). It routes through commitLife anyway: no writer
  // gets to bypass Death's Door sync, and it CAN fire while a side is already at 0 -
  // where syncLife(0 -> 0) correctly leaves the quiet window alone.
  function setMax(who, max) {
    const cur = who === 'player' ? pRef.current : eRef.current;
    const m = applyMax(cur, max);   // life follows max down, max clamped to [1,20] - see matchLife.js
    commitLife(who, m.life, m.max);
    setSheet(null); force((n) => n + 1);
  }
  function reset() {
    // The non-tap recovery path: 0 -> 20 on both sides. Routing through commitLife
    // means it disarms Death's Door and cancels timers for free, with no special case.
    const seed = initSide(start);   // one seed helper for every fresh side - see matchLife.js
    commitLife('player', seed.life, seed.max); commitLife('opponent', seed.life, seed.max);
    setLog([]); lastLog.current = null; setEndInfo(null);
    setDeltas([]); activeDelta.current = { player: null, opponent: null };
    clearTimeout(deltaTimers.current.player); clearTimeout(deltaTimers.current.opponent);
    elapsedBase.current = 0; startedAt.current = Date.now();
    recordedRef.current = false;   // a fresh game (Go Again / Reset) can be recorded anew
    renderLife(); setSheet(null); setFabP(false); setFabE(false);
    armRollOff(); force((n) => n + 1);
  }

  // ── turn-order roll-off (constants) ──
  function _clearRoll() { clearTimers(); setRollWin(null); }
  // A fresh match is unborn again - the realm unmade, not killed.
  function armRollOff() { _clearRoll(); lifeTaps.current = 0; unbirth(); setRollPhase('armed'); }

  function startRollOff() {
    if (!canStartRoll(rollPhase)) return;
    _clearRoll(); setRollPhase('windup');
    haptic('medium');   // the one committing act on this screen was silent
    timers.current.push(setTimeout(_tumble, WINDUP_MS));
  }
  function _tumble() {
    setRollPhase('rolling');
    const pEl = pNumRef.current, eEl = eNumRef.current;
    // The numerals are borrowed as dice. 12-15 announcements out of a polite live
    // region is a screen-reader firehose; say the verdict once instead.
    pEl?.setAttribute('aria-live', 'off'); eEl?.setAttribute('aria-live', 'off');
    // The contest (fair d20 roll-off, winner is the strictly-higher roll) lives in matchRoll;
    // the tumble below just animates the numerals up to the decided faces.
    const { pRoll: pVal, eRoll: eVal, winner } = rollOutcome();
    const d20 = () => 1 + Math.floor(Math.random() * 20);   // intermediate tumble faces only (presentation, not the outcome)
    const total = 10 + Math.floor(Math.random() * 6);   // curve untouched: its deceleration is what makes the last faces readable
    let step = 0;
    // Each face rolls up into place from below, odometer-style. The travel and the
    // animation both scale with the tick's own length, so a fast throw smears into
    // continuous motion and a slow one lands softly enough to read - the deceleration
    // curve does the work, and the roll just makes it visible.
    // The tiny random skew is the only irregularity: identical travel every tick reads
    // as a machine, and dice are not machines.
    const roll = (el, delay) => {
      if (!el) return;
      const t = Math.min(1, delay / 400);                       // 0 = frantic, 1 = settling
      el.style.setProperty('--tk', `${(0.30 + t * 0.34 + Math.random() * 0.06).toFixed(3)}em`);
      el.style.setProperty('--tkms', `${Math.round(Math.min(delay * 0.85, 260))}ms`);
      el.classList.remove('roll-tick'); void el.offsetWidth; el.classList.add('roll-tick');
    };
    // THE LEAD: whichever face is currently higher takes gold, so the lead visibly
    // jumps the divider and changes hands in the readable final ticks.
    // Colour carries state, transform carries the event - they never share a
    // property, so the class and the per-tick animation cannot fight over transform.
    const lead = (pf, ef) => {
      pEl?.classList.toggle('roll-lead', pf > ef);
      eEl?.classList.toggle('roll-lead', ef > pf);
    };
    const tick = () => {
      if (step >= total) {
        if (pEl) pEl.textContent = pVal; if (eEl) eEl.textContent = eVal;
        lead(pVal, eVal);
        pEl?.classList.remove('roll-tick'); eEl?.classList.remove('roll-tick');
        numAnim('player', 'roll-land'); numAnim('opponent', 'roll-land');
        haptic('heavy');   // was 'medium', which the tumble's own ticks already spend
        timers.current.push(setTimeout(() => _rollDone(winner), 360));   // the coin in the air
        return;
      }
      const pf = d20(), ef = d20();
      if (pEl) pEl.textContent = pf; if (eEl) eEl.textContent = ef;
      lead(pf, ef);
      step++;
      // The shipped curve, untouched: its deceleration is what makes the final faces
      // readable, which is what makes the lead-change visible. The roll is measured
      // against it rather than fighting it.
      const delay = 45 + Math.pow(step / total, 2.7) * 520;
      roll(pEl, delay); roll(eEl, delay);
      if (delay > 170) haptic('light');
      timers.current.push(setTimeout(tick, delay));
    };
    tick();
  }
  function _rollDone(winner) {
    setRollWin(winner); setRollPhase('result'); setResultLeft(4);
    // Birth rides the hold: from wherever the player's taps already left it, to alive,
    // across exactly the four seconds the countdown names. The wait is not dead air -
    // the fill IS the countdown, made physical.
    setBirth(1, HOLD_MS, 'cubic-bezier(.4,0,.3,1)');
    const wEl = (winner === 'player' ? pNumRef : eNumRef).current;
    wEl?.setAttribute('aria-live', 'polite');
    wEl?.setAttribute('aria-label', winner === 'player'
      ? 'You won the roll. You choose who plays first. The match begins in four seconds.'
      : 'Your opponent won the roll. They choose who plays first. The match begins in four seconds.');
    for (let i = 1; i <= 3; i++) timers.current.push(setTimeout(() => setResultLeft(4 - i), i * 1000));
    timers.current.push(setTimeout(finishRollOff, HOLD_MS));
  }
  // The unlock. Everything lands together: the ceremony ends, the real totals return,
  // and DD un-suppresses in one transition - the match begins for both players in the
  // same frame.
  function finishRollOff() {
    setRollPhase(null);   // rollWin deliberately survives - see rollWords()
    pNumRef.current?.classList.remove('roll-lead'); eNumRef.current?.classList.remove('roll-lead');
    pNumRef.current?.setAttribute('aria-live', 'polite'); eNumRef.current?.setAttribute('aria-live', 'polite');
    renderLife();   // real totals over the tumbled faces; setNum clears the roll aria-label
    numAnim('player', 'roll-restore'); numAnim('opponent', 'roll-restore');
    setOpenSeq((n) => n + 1);
    haptic('light');
    clearTimers();
  }
  // Retire the armed offer with a soft upward fade - whether waved off by the X
  // or auto-retired once the player is clearly just tracking life. Falls back to
  // an instant clear if the node has already gone.
  function fadeOutRoll() {
    const pill = typeof document !== 'undefined' && document.getElementById('roll-pill');
    if (!pill) { _clearRoll(); setRollPhase(null); renderLife(); return; }
    pill.classList.add('roll-exit');
    timers.current.push(setTimeout(() => {
      pill.classList.remove('roll-exit'); _clearRoll(); setRollPhase(null); renderLife();
    }, 340));
  }
  // Waving the roll away without rolling - it's an offer, not a gate. Colour still
  // arrives: declining the pageantry must never leave you on a grey table. 900ms is
  // the Toll's fall duration inverted - the toll drains a realm over 900, this floods
  // it back over 900.
  function dismissRollOff() { haptic('light'); setBirth(1, BIRTH_WAVE_MS, 'cubic-bezier(.2,.8,.3,1)'); fadeOutRoll(); }

  // ── end match → full-screen decision modal (Play) ──
  function triggerEnd(winner) {
    const p = pRef.current, e = eRef.current;
    const w = winner || (p.life <= 0 ? 'opponent' : e.life <= 0 ? 'player' : p.life === e.life ? 'draw' : p.life > e.life ? 'player' : 'opponent');
    setFabP(false); setFabE(false); setSheet(null);
    setEndInfo({ winner: w, pLife: p.life, eLife: e.life, durationSec: elapsedSec(), recorded: recordedRef.current });
  }
  async function recordFromEnd() {
    if (recordedRef.current || recordingRef.current) return;   // already saved / in-flight - no double record
    recordingRef.current = true;
    const r = endInfo;
    const result = {
      mode, winner: r.winner, playerFinalLife: r.pLife, opponentFinalLife: r.eLife,
      durationSec: r.durationSec, log,
      playerAvatar: players.you?.name || null, opponentAvatar: players.opp?.name || null,
      opponentName: oppName.trim() || null, deckId: deck?.id || null,
    };
    try { await onRecord?.(result); recordedRef.current = true; setEndInfo((x) => ({ ...x, recorded: true })); haptic('medium'); }
    finally { recordingRef.current = false; }
  }
  const needConfirm = () => !quick && endInfo && !endInfo.recorded;
  // In-world confirm (Play centered modal) instead of a native dialog -
  // gated behind needConfirm so a recorded match skips straight through.
  function guarded(label, action) {
    if (needConfirm()) setConfirm({ label, action });
    else action();
  }
  function newFromEnd() {
    if (quick) { reset(); return; }                                  // Go Again = fresh quick match
    guarded('New match without recording? This match won’t be saved.', () => onNewMatch?.(mode));
  }
  function resetFromEnd() {
    guarded('Reset without recording? This match won’t be saved.', () => reset());
  }
  function exitFromEnd() {
    guarded('Exit without recording the match?', () => onExit?.());
  }

  // Through the shared art boundary, not by hand. This file used to build `${BASE}cards/${slug}`
  // itself, which bypassed the resolver and therefore localStorage['cx-no-images'] entirely - the
  // counter was the one screen the zero-image gate could not reach. useArtSource honours zero-image
  // (src null), resolves through the CDN + cache, and drives the candidate chain on error; the SVG
  // sigil / fallback gradient carries the half when there is no art.
  const you = useArtSource(players.you?.image_slug || null);
  const opp = useArtSource(players.opp?.image_slug || null);
  const pImg = you.src;
  const eImg = opp.src;
  const pFall = players.you ? cardFallbackArt(players.you) : null;
  const eFall = players.opp ? cardFallbackArt(players.opp) : null;
  const p = pRef.current, e = eRef.current;

  // Half art, in one place for both sides. Three layers, and which ones mount depends
  // only on whether real art resolved:
  //   art      -> <img> + its DD twin (same URL: one decode, two textures)
  //   no art   -> an inline SVG sigil + its DD twin. Markup, not a fetched asset, so
  //               it cannot 404 and it survives cx-no-images - which is exactly why
  //               this screen stays legible under the zero-image gate.
  // A real <button>, not a div: `disabled` is announced natively and cannot be
  // activated by a screen reader, where aria-disabled on a div can. `disabled` and
  // pointer-events are bound to the SAME predicate - both are required, and for
  // different reasons. disabled stops activation; pointer-events: none stops the
  // element occupying the hit-test slot, which is what lets a tap during REVEALING
  // reach the .tap-zone beneath and postpone arming. A disabled-but-hit-testable
  // button would swallow that tap and let the guard expire under a live finger.
  //
  // Phase is re-derived here from overlayOpen as well, so even a controller bug
  // cannot paint an armed pill while a menu is open.
  const ddPill = (who) => {
    const phase = overlayOpen ? DD.SUPPRESSED : ddPhase[who];
    // REARMING wears .dd-armed's LOOK (it stays settled - that is the whole point)
    // but is disabled and non-hit-testable below, so it is inert while it looks live.
    // That is a deliberate, narrow exception to "appearance follows state": the
    // alternative is the pill vanishing and crawling back for a stray tap, which is
    // what the device feedback rejected. The window is one quiet interval.
    const cls = phase === DD.REVEALING ? ' dd-reveal'
      : phase === DD.ARMED ? ' dd-armed'
      : phase === DD.REARMING ? ' dd-armed dd-rearming' : '';
    return (
      <button type="button" className={`dd-pill${cls}`} disabled={phase !== DD.ARMED}
        onClick={() => triggerEnd(null)}
        aria-label={who === 'player' ? 'End match - you are at Death’s Door' : 'End match - opponent at Death’s Door'}>
        <span className="dd-pill-body">{DDSvg}End Match</span>
      </button>
    );
  };
  // Which side of the verdict a half is on. One class drives the whole side.
  const rollCls = (who) => {
    if (rollPhase === 'windup') return ' roll-windup';
    if (rollPhase !== 'rolling' && rollPhase !== 'result') return '';
    if (rollWin == null) return ' roll-tumble';
    return rollWin === who ? ' roll-win' : ' roll-lose';
  };
  // The verdict, inside the half so it rotates with it - each player reads their own
  // the right way up, from their own seat. That is why there is no centred pill.
  //
  // rollWin is NOT cleared at the unlock, only when a new roll arms. If it were, this
  // ternary would flip to "They choose" on the winner's half for the length of the
  // fade-out - the text visibly changing as it leaves. Keeping it costs nothing:
  // rollPhase is null by then, so rollCls() returns '' and none of the verdict styling
  // applies anyway.
  // Absolutely positioned as a block, sharing the Death's Door eyebrow's slot: a roll
  // happens at 20 life and Death's Door at 0, so the two can never be on screen
  // together. Taking it out of the flow is not tidiness - while it was a flowing
  // sibling, ~40px of INVISIBLE verdict text sat between the DD eyebrow and the End
  // Match pill and shoved the pill out to the screen edge, where the opponent's was
  // clipping off the top.
  const rollWords = (who) => (
    <div className="roll-words">
      <div className="roll-eyebrow" aria-hidden="true">{rollWin === who ? 'You choose' : 'They choose'}</div>
      {/* Dim, small, and it earns its place: under reduced motion the fill is
          instantaneous, and this is the only thing left saying the wait is finite and
          short. One design for both modes rather than a special case. */}
      <div className="roll-sub" aria-hidden="true">Match begins in {resultLeft}</div>
    </div>
  );
  const halfArt = (img, id, gen, onError) => (
    <>
      {img && <img key={gen} className="half-bg" id={id} src={img} alt="" onError={onError} />}
      {img && <div className="half-gradient" />}
      {/* The ash layer. With art it is a grayscale twin of the same <img>; artless it
          is a flat achromatic wash that crossfades OVER whatever colours the half -
          Quick Match's gold/violet identity, or a card's element gradient. Either way
          the colour visibly leaves. No mark, no glyph: the tracker sits on a table
          between two players and should recede into it, so iconography would be
          exactly the wrong instinct here. */}
      {img
        ? <img key={gen} className="half-bg half-bg-dd" src={img} alt="" aria-hidden="true" onError={onError} />
        : <div className="half-bg half-bg-dd half-bg-ash" aria-hidden="true" />}
      <div className="half-birth-rim" aria-hidden="true" />
    </>
  );

  return (
    <div id="counter-screen" className={`cx-life-tracker${quick ? ' quick' : ''}`}
         style={{ '--birth': birth, '--birth-ms': `${birthMs}ms`, '--birth-ease': birthEase }}>
      {/* Enemy half (rotated 180° for across-table reading) */}
      <div className={`counter-half enemy-half${e.life <= 0 ? ' dd' : ''}${rollCls('opponent')}`} id="enemy-half"
           style={!eImg && eFall ? { background: eFall } : undefined}>
        {halfArt(eImg, 'enemy-bg', opp.gen, opp.onError)}
        <div className="half-dd-veil" />
        <div className="half-roll-veil" />
        <div className="half-roll-light" />
        <div className="half-grain" />
        <div className="life-display">
          {/* The numeral is the ONLY thing that flows, so it sits dead centre of the
              half and STAYS there. Everything else hangs off its bottom edge,
              absolutely - otherwise the column re-centres whenever a row appears or
              collapses (roll-active hiding the pill did exactly that, and the number
              visibly dropped for the roll and rose again after). */}
          <div className="life-num-wrap">
            <div className="life-number" id="enemy-life-num" ref={eNumRef} role="status" aria-live="polite" />
            <div className="life-below">
              <div className="dd-eyebrow" aria-hidden="true">At Death&rsquo;s Door</div>
              {rollWords('opponent')}
              {ddPill('opponent')}
            </div>
          </div>
          {/* Both rings centre on the HALF, so they live here and not in .life-below -
              that box is absolutely positioned, and they would have centred on IT. */}
          {e.life <= 0 && <div key={fallSeq.opponent} className="dd-shock" aria-hidden="true" />}
          {rollWin === 'opponent' && <div className="roll-burst" aria-hidden="true" />}
        </div>
        {e.max < 20 && <div className="status-badges"><div className="status-badge maxlife">{HeartSvg}{e.max}</div></div>}
        <div className="tap-zone tap-plus" onClick={() => change('opponent', +1)} role="button" aria-label="Increase opponent's life" />
        <div className="tap-zone tap-minus" onClick={() => change('opponent', -1)} role="button" aria-label="Decrease opponent's life" />
        <div className={`opponent-fab-wrap${fabE ? ' open' : ''}`} id="opponent-fab">
          <div className="fab-menu">
            <button onClick={() => { setFabE(false); setSheet('diceE'); }}>{DiceSvg}Roll a Die</button>
            <button onClick={() => { setFabE(false); setSheet('maxE'); }}>{HeartSvg}Change Max Life</button>
          </div>
          <button className="fab" onClick={(ev) => { ev.stopPropagation(); setFabE((v) => !v); }} aria-label="Opponent options">{DotsSvg}</button>
        </div>
      </div>

      <div className="counter-divider" />

      {/* Player half */}
      <div className={`counter-half player-half${p.life <= 0 ? ' dd' : ''}${rollCls('player')}`} id="player-half"
           style={!pImg && pFall ? { background: pFall } : undefined}>
        {halfArt(pImg, 'player-bg', you.gen, you.onError)}
        <div className="half-dd-veil" />
        <div className="half-roll-veil" />
        <div className="half-roll-light" />
        <div className="half-grain" />
        <div className="life-display">
          {/* The numeral is the ONLY thing that flows, so it sits dead centre of the
              half and STAYS there. Everything else hangs off its bottom edge,
              absolutely - otherwise the column re-centres whenever a row appears or
              collapses (roll-active hiding the pill did exactly that, and the number
              visibly dropped for the roll and rose again after). */}
          <div className="life-num-wrap">
            <div className="life-number" id="player-life-num" ref={pNumRef} role="status" aria-live="polite" />
            <div className="life-below">
              <div className="dd-eyebrow" aria-hidden="true">At Death&rsquo;s Door</div>
              {rollWords('player')}
              {ddPill('player')}
            </div>
          </div>
          {/* Both rings centre on the HALF, so they live here and not in .life-below -
              that box is absolutely positioned, and they would have centred on IT. */}
          {p.life <= 0 && <div key={fallSeq.player} className="dd-shock" aria-hidden="true" />}
          {rollWin === 'player' && <div className="roll-burst" aria-hidden="true" />}
        </div>
        {p.max < 20 && <div className="status-badges"><div className="status-badge maxlife">{HeartSvg}{p.max}</div></div>}
        <div className="tap-zone tap-plus" onClick={() => change('player', +1)} role="button" aria-label="Increase your life" />
        <div className="tap-zone tap-minus" onClick={() => change('player', -1)} role="button" aria-label="Decrease your life" />
      </div>

      {/* floating deltas rendered INTO the correct half (so the enemy rotation applies) */}
      {deltas.map((d) => {
        const host = document.getElementById(d.who === 'player' ? 'player-half' : 'enemy-half');
        // The badge swells as the streak grows - +8% per point over the first,
        // capped at 1.6x so a huge swing stays readable, not screen-filling.
        const mag = Math.min(1 + (Math.abs(d.delta) - 1) * 0.08, 1.6);
        return host ? createPortal(
          <div key={d.id} className={`life-delta ${d.delta > 0 ? 'plus' : 'minus'}${d.released ? ' released' : ''}`} style={{ '--dmag': mag }}>
            <span key={d.delta} className="life-delta-num">{d.delta > 0 ? `+${d.delta}` : `${d.delta}`}</span>
          </div>,
          host, String(d.id),
        ) : null;
      })}

      {/* Player FAB (fixed, bottom-right) */}
      <div className={`fab-wrap${fabP ? ' open' : ''}`} id="counter-fab">
        <div className="fab-menu">
          {/* Go Home = minimise (match stays resumable) - the only exit for users
              without Android gesture/back navigation. */}
          <button onClick={() => { setFabP(false); minimize(); }}>{ExitSvg}Go Home</button>
          <button onClick={() => { setFabP(false); setSheet('tweaks'); }}>{TweaksSvg}Tweaks</button>
          <button onClick={() => { setClockOn((v) => !v); haptic('light'); }}>{ClockSvg}Show Clock<span className="fab-state">{clockOn ? 'on' : 'off'}</span></button>
          <button onClick={() => { setFabP(false); setSheet('maxP'); }}>{HeartSvg}Change Max Life</button>
          <button onClick={() => { setFabP(false); setSheet('dice'); }}>{DiceSvg}Roll a Die</button>
          <button onClick={() => { setFabP(false); setSheet('log'); }}>{LogSvg}Match Log</button>
          <button onClick={() => { setFabP(false); if (log.length) setConfirm({ label: 'Reset the match? Life totals and log will be cleared.', action: reset }); else reset(); }}>{ResetSvg}Reset Match</button>
          <button style={{ color: 'var(--crimson)' }} onClick={() => { setFabP(false); triggerEnd(null); }}>{FlagSvg}End Match</button>
        </div>
        <button className="fab" onClick={(ev) => { ev.stopPropagation(); setFabP((v) => !v); }} aria-label="Options">{DotsSvg}</button>
      </div>

      {/* Match clock - vertical strip on the left edge, readable by both players.
          CSS hides it during the roll-off (body.roll-active). */}
      {clockOn && <div id="match-clock">{fmtClock(elapsedSec())}</div>}

      {/* Hard lock: while the roll spins AND through the 4s result countdown, a
          full-screen catcher swallows every tap so the reveal is never dropped by
          an eager tap. The counter only goes live again once the countdown ends. */}
      {rollLocked && (
        <div className="roll-lock" aria-hidden="true"
          onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
          onPointerDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); }} />
      )}
      {/* The curtain: a gold seam sweeping outward from centre as the match opens.
          Outward, so it reads identically from either seat. */}
      {openSeq > 0 && <div key={openSeq} className="roll-open-gleam" aria-hidden="true" />}

      {/* Optional turn-order roll. An offer, never a gate: tap to roll, or wave it off
          with the X. The verdict is NOT shown here any more - it lives inside each
          half (see .roll-eyebrow), because a centred pill can only be read the right
          way up by one of the two people at the table. */}
      <div id="roll-pill" className={`${rollPhase === 'armed' ? 'show armed' : ''}${rollPhase === 'windup' ? ' show armed roll-cast' : ''}`}
        onClick={rollPhase === 'armed' ? startRollOff : undefined} role="button" aria-label="Roll for turn order">
        <div id="roll-pill-body">
          <span className="roll-pill-go">{RollHexSvg}<span className="rp-label">Roll for Turn</span></span>
        </div>
        {rollPhase === 'armed' && (
          <button className="roll-pill-dismiss" onClick={(ev) => { ev.stopPropagation(); dismissRollOff(); }} aria-label="Dismiss the turn roll">{CloseSvg}</button>
        )}
      </div>

      {/* secondary modals (Play centered .modal-box) */}
      <MatchLogModal open={sheet === 'log'} log={log} onClose={() => setSheet(null)} />
      <MaxLifeModal open={sheet === 'maxP'} who="player" value={p.max} onClose={() => setSheet(null)} onSet={(v) => setMax('player', v)} />
      <MaxLifeModal open={sheet === 'maxE'} who="opponent" rotated value={e.max} onClose={() => setSheet(null)} onSet={(v) => setMax('opponent', v)} />
      <DiceModal open={sheet === 'dice'} dice={dice} setDice={setDice} onClose={() => setSheet(null)} />
      {/* opponent-launched dice: rotated 180deg to face the opponent's half */}
      <DiceModal open={sheet === 'diceE'} rotated dice={dice} setDice={setDice} onClose={() => setSheet(null)} />
      <TweaksModal open={sheet === 'tweaks'} tw={tw} onToggle={setTweak} onClose={() => setSheet(null)} />
      {/* full-screen end-of-match decision modal */}
      {endInfo && (
        <EndModal info={endInfo} quick={quick} players={players} oppName={oppName} setOppName={setOppName} recent={recent}
          onRecord={recordFromEnd} onNew={newFromEnd} onReset={resetFromEnd} onExit={exitFromEnd} onClose={() => setEndInfo(null)} />
      )}

      {/* "Hold on" confirm - rendered AFTER the end modal AND on a higher layer
          (#confirm-overlay): it can be summoned FROM the end screen, so it must
          always paint above it, whatever the DOM order becomes. */}
      {confirm && (
        <VModal id="confirm-overlay" title="Hold on" onClose={() => setConfirm(null)}
          actions={<>
            <button className="modal-btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="modal-btn danger" onClick={() => { const a = confirm.action; setConfirm(null); a?.(); }}>Discard</button>
          </>}>
          <div style={{ padding: '18px 22px 4px', textAlign: 'center', font: "400 15px/1.5 var(--f-read)", color: 'var(--muted)' }}>{confirm.label}</div>
        </VModal>
      )}
    </div>
  );
}

/* ── Play centered modal shell ── */
/** children/actions are `any`: without @types/react a ReactNode has no nameable type here.
 * @param {{ id?: string, title?: string, subtitle?: string, onClose?: () => void, children?: any, actions?: any, rotated?: boolean }} props */
function VModal({ id, title, subtitle, onClose, children, actions, rotated }) {
  return (
    <div className="vc-modal-overlay" id={id} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal-box${rotated ? ' rotated' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">{CloseSvg}</button>
          <div className="modal-title">{title}</div>
          {subtitle && <div className="modal-subtitle">{subtitle}</div>}
        </div>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

// Tweaks - the counter's own comforts, back where Play kept them.
function TweaksModal({ open, tw, onToggle, onClose }) {
  if (!open) return null;
  const rows = [
    ['keep_awake', 'Keep screen on', 'The screen never sleeps mid-duel'],
    ['immersive', 'Hide status bar', 'Full-bleed match (on device)'],
    ['film_grain', 'Film grain', 'Painterly texture over the portraits'],
  ];
  return (
    <VModal title="Tweaks" subtitle="Comforts for the table" onClose={onClose}
      actions={<button className="modal-btn" onClick={onClose}>Done</button>}>
      <div className="tw-list">
        {rows.map(([k, label, hint]) => (
          <div key={k} className="tw-row" onClick={() => onToggle(k, !tw[k])} role="switch" aria-checked={!!tw[k]}>
            <div className="tw-copy">
              <div className="tw-label">{label}</div>
              <div className="tw-hint">{hint}</div>
            </div>
            <div className={`tw-switch${tw[k] ? ' on' : ''}`}><span className="tw-knob" /></div>
          </div>
        ))}
      </div>
    </VModal>
  );
}

function MatchLogModal({ open, log, onClose }) {
  if (!open) return null;
  const rows = [...log].reverse();
  return (
    <VModal title="Match Log" subtitle="A record of life given and taken" onClose={onClose}
      actions={<button className="modal-btn" onClick={onClose}>Close</button>}>
      <div className="log-divider"><span><svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true"><rect x="8" y="8" width="8" height="8" transform="rotate(45 12 12)" /></svg></span></div>
      <div className="log-list">
        {rows.length === 0 ? <div className="log-empty">No life changes yet.</div>
          : rows.map((r, i) => (
            <div key={i} className={`log-row ${r.who === 'player' ? 'you' : 'opp'}`}>
              <span className="log-time">{new Date(r.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              <span className="log-text"><span className="log-who">{r.who === 'player' ? 'You' : 'Opponent'}</span> {r.delta > 0 ? 'gained' : 'lost'} <span className={`log-amt ${r.delta > 0 ? 'gain' : 'loss'}`}>{Math.abs(r.delta)}</span></span>
              <span className="log-life">{HeartMiniSvg}{r.toLife}</span>
            </div>
          ))}
      </div>
    </VModal>
  );
}

/** @param {{ open?: boolean, who?: string, value?: number, onClose?: () => void, onSet?: (v: number) => void, rotated?: boolean }} props */
function MaxLifeModal({ open, who, value, onClose, onSet, rotated }) {
  const [v, setV] = useState(value);
  useEffect(() => { if (open) setV(value); }, [open, value]);
  if (!open) return null;
  return (
    <VModal title="Max Life" rotated={rotated} subtitle={who === 'player' ? 'Your life cap' : "Opponent's life cap"} onClose={onClose}
      actions={<button className="modal-btn primary" onClick={() => onSet(v)}>Set Max Life</button>}>
      <div className="maxlife-stepper">
        <button className="maxlife-btn" onClick={() => setV((x) => Math.max(MIN_MAX, x - 1))} aria-label="Decrease">−</button>
        <div className="maxlife-value">{v}</div>
        <button className="maxlife-btn" onClick={() => setV((x) => Math.min(LIFE_CAP, x + 1))} aria-label="Increase">+</button>
      </div>
      <div className="maxlife-hint">20 is the highest. Lower it when an effect stops you healing to full.</div>
    </VModal>
  );
}

/** @typedef {{ type: number, value: number | null }} DiceState
 * @param {{ open?: boolean, dice?: DiceState, setDice?: (update: DiceState | ((prev: DiceState) => DiceState)) => void, onClose?: () => void, rotated?: boolean }} props */
function DiceModal({ open, dice, setDice, onClose, rotated }) {
  const [landed, setLanded] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [display, setDisplay] = useState(null);   // the number tumbling mid-roll
  const iv = useRef(null);
  const stop = () => { if (iv.current) { clearInterval(iv.current); iv.current = null; } };
  useEffect(() => stop, []);                        // clear on unmount
  useEffect(() => { if (!open) { stop(); setRolling(false); } }, [open]);
  if (!open) return null;
  // Play pillar's rollDie, tightened: ~7-11 ticks at 60ms, cycling faces, then land.
  // Honour reduced motion by settling immediately.
  function roll() {
    if (rolling) return;
    stop();
    if (document.body.classList.contains('reduce-motion')) {
      const result = 1 + Math.floor(Math.random() * dice.type);
      setDice((x) => ({ ...x, value: result })); setDisplay(result);
      setLanded((n) => n + 1); haptic('heavy');
      return;
    }
    setRolling(true); setDice((x) => ({ ...x, value: null }));
    let ticks = 0;
    const total = 7 + Math.floor(Math.random() * 5);   // ~1s shorter than Play pillar's 18-25 ticks
    iv.current = setInterval(() => {
      setDisplay(Math.ceil(Math.random() * dice.type));
      if (++ticks >= total) {
        stop();
        const result = Math.ceil(Math.random() * dice.type);
        setDisplay(result); setDice((x) => ({ ...x, value: result }));
        setRolling(false); setLanded((n) => n + 1); haptic('heavy');
      }
    }, 60);
  }
  const shown = rolling ? (display ?? '–') : (dice.value ?? '–');
  const label = rolling ? `Rolling d${dice.type}…`
    : dice.value != null
      ? (dice.value === dice.type ? 'Maximum roll!' : dice.value === 1 ? 'Critical fail' : `on a d${dice.type}`)
      : 'Select a die and roll';
  return (
    <VModal title="Roll a Die" rotated={rotated} subtitle="Choose your die, then roll" onClose={onClose}
      actions={<button className="modal-btn primary" onClick={roll} disabled={rolling}>{rolling ? 'Rolling…' : 'Roll!'}</button>}>
      <div className="dice-type-row">
        {[4, 6, 8, 10, 12, 20].map((d) => (
          <button key={d} className={`die-btn${dice.type === d ? ' active' : ''}`} disabled={rolling} onClick={() => { setDice({ type: d, value: null }); setDisplay(null); }}>d{d}</button>
        ))}
      </div>
      <div className="dice-result-area">
        <div className={`dice-number${rolling ? ' rolling' : dice.value != null ? ' landed' : ''}`} key={rolling ? 'roll' : landed}>{shown}</div>
        <div className="dice-label">{label}</div>
      </div>
    </VModal>
  );
}

function EndModal({ info, quick, players, oppName, setOppName, recent, onRecord, onNew, onReset, onExit, onClose }) {
  const { winner, pLife, eLife, durationSec, recorded } = info;
  const you = useArtSource(players.you?.image_slug || null);
  const opp = useArtSource(players.opp?.image_slug || null);
  const [shareLink, setShareLink] = useState(null);
  const [sharing, setSharing] = useState(false);
  async function openShare() {
    if (sharing) return; setSharing(true);
    try {
      const { link } = await buildMatchShare({
        winner, pLife, eLife, durationSec, playedAt: new Date().toISOString(),
        youAvatarName: players.you?.name || null, oppAvatarName: players.opp?.name || null,
      });
      setShareLink(link);
    } finally { setSharing(false); }
  }
  const pWin = winner === 'player', eWin = winner === 'opponent', draw = winner === 'draw';
  const title = quick
    ? (pWin ? 'You Win' : eWin ? 'Opponent Wins' : 'Draw')
    : (pWin ? 'Victory!' : eWin ? 'Defeat' : 'Match Over');
  const winnerName = draw ? 'Draw' : quick
    ? (pWin ? 'You' : 'Opponent')
    : (pWin ? (players.you?.name || 'You') : (players.opp?.name || 'Opponent'));
  const dur = fmtDur(durationSec);
  const pBorder = pWin ? '#4db38a' : eWin ? '#e0786a' : 'rgba(255,255,255,.1)';
  const eBorder = eWin ? '#4db38a' : pWin ? '#e0786a' : 'rgba(255,255,255,.1)';
  const lifeText = (v, lost) => v > 0 ? String(v) : (lost ? '0' : 'DD');
  return (
    <div className={`vc-modal-overlay${quick ? ' quick' : ''}`} id="end-overlay">
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">{CloseSvg}</button>
          <div className="modal-title">{title}</div>
          <div className="end-result-label">Winner</div>
          <div className="end-winner">{winnerName}</div>
        </div>
        <div className="end-result">
          <div className="end-life-row">
            <div className="end-life-pill end-player" style={{ borderColor: pBorder }}>
              <div className="end-life-pill-art">{you.src && <img key={you.gen} src={you.src} alt="" onError={you.onError} />}</div>
              <div className="end-life-pill-info"><div className="end-life-label">{quick ? 'You' : (players.you?.name || 'You')}</div><div className={`end-life-val${pLife <= 0 ? ' dd' : ''}`}>{lifeText(pLife, eWin)}</div></div>
            </div>
            <div className="end-life-pill end-enemy" style={{ borderColor: eBorder }}>
              <div className="end-life-pill-art">{opp.src && <img key={opp.gen} src={opp.src} alt="" onError={opp.onError} />}</div>
              <div className="end-life-pill-info"><div className="end-life-label">{quick ? 'Opponent' : (players.opp?.name || 'Opponent')}</div><div className={`end-life-val${eLife <= 0 ? ' dd' : ''}`}>{lifeText(eLife, pWin)}</div></div>
            </div>
          </div>
          {dur && <div className="end-duration-row">{ClockSvg}<span>{dur}</span></div>}
        </div>
        {/* Hand this match to the opponent's device - a QR that mirrors the
            result to their side (no deck). Works fully offline. */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0 6px' }}>
          <button onClick={openShare} disabled={sharing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(var(--sk),.4)', color: 'rgb(var(--sk))', font: "700 12px/1 var(--f-ui)", letterSpacing: '.04em', cursor: 'pointer' }}>
            {ShareSvg}{sharing ? 'Preparing…' : 'Share to opponent'}
          </button>
        </div>
        {shareLink && <ShareQRModal link={shareLink} onClose={() => setShareLink(null)} />}
        {!quick && (
          <div className="end-opp-field">
            <div className="end-opp-label">Opponent (optional)</div>
            <input className="end-opp-input" value={oppName} onChange={(e) => setOppName(e.target.value)} placeholder="Their name…" disabled={recorded} />
            {!recorded && recent.length > 0 && (
              <div className="end-opp-recent">{recent.map((r) => <button key={r} className="end-opp-chip" onClick={() => setOppName(r)}>{r}</button>)}</div>
            )}
          </div>
        )}
        <div className="modal-actions">
          {!quick && <button className={`modal-btn${recorded ? ' recorded' : ' primary'}`} disabled={recorded} onClick={onRecord}>{recorded ? CheckSvg : CheckSvg}<span>{recorded ? 'Match Recorded' : 'Record Match'}</span></button>}
          <button className={`modal-btn${quick ? ' primary' : ''}`} onClick={onNew}>{PlusSvg}<span>{quick ? 'Go Again' : 'New Match'}</span></button>
          <button className="modal-btn" onClick={onReset}>{ResetSvg}<span>{recorded && !quick ? 'Go Again' : 'Reset Match'}</span></button>
          <button className="modal-btn" onClick={onExit}>{ExitSvg}<span>Exit Match</span></button>
        </div>
      </div>
    </div>
  );
}

// Share-result QR (over the end screen, z140). The opponent scans it to import
// the match mirrored to their side.
function ShareQRModal({ link, onClose }) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  // Hardware BACK closes just the QR modal, not the whole end screen behind it.
  useEffect(() => registerBackConsumer(() => { onClose(); return true; }), [onClose]);
  const flashCopied = () => { setCopied(true); clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 1600); };
  const copy = async () => { try { await navigator.clipboard.writeText(link); flashCopied(); haptic('light'); } catch { /* clipboard blocked */ } };
  // One-tap into WhatsApp/Messages/Discord via the OS share sheet; if the target
  // has no share sheet (older desktop web) it falls back to a copy.
  const share = async () => {
    haptic('light');
    const res = await shareLink({ title: 'Compendium match', text: `Save our match in Compendium:\n${link}`, dialogTitle: 'Share result' });
    if (res === 'copied') flashCopied();
  };
  return (
    <div className="vc-modal-overlay" id="share-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">{CloseSvg}</button>
          <div className="modal-title">Share Result</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 22px 18px', gap: 15 }}>
          <QRCode text={link} size={224} />
          <div style={{ font: "400 13px/1.55 var(--f-read)", color: 'var(--muted)', textAlign: 'center', maxWidth: 280 }}>
            Have your opponent scan this with their camera, or send them the link. They attribute their own deck.
          </div>
          <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 280 }}>
            <button className="modal-btn primary" onClick={share} style={{ flex: 2 }}>{ShareSvg}<span>Send link</span></button>
            <button className="modal-btn" onClick={copy} style={{ flex: 1 }}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── icons ── */
const s = { width: 17, height: 17, opacity: .8 };
const ShareSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }} aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="10.7" x2="15.4" y2="6.3" /><line x1="8.6" y1="13.3" x2="15.4" y2="17.7" /></svg>;
const DotsSvg = <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }} aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>;
const DiceSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><rect x="2" y="2" width="20" height="20" rx="4" /><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="8" cy="16" r="1.2" fill="currentColor" stroke="none" /><circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /></svg>;
const HeartSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" /></svg>;
const HeartMiniSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" /></svg>;
const DDSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.2C7.6 3.2 4.5 6.5 4.5 10.5c0 2.6 1.3 4.6 2.6 5.8.3.3.4.6.4 1v1.4c0 .8.6 1.5 1.5 1.5h1.1c.5 0 .9-.4.9-.9v-1c0-.3.2-.5.5-.5h.9c.3 0 .5.2.5.5v1c0 .5.4.9.9.9h1.1c.8 0 1.5-.7 1.5-1.5v-1.4c0-.4.1-.7.4-1 1.3-1.2 2.6-3.2 2.6-5.8 0-4-3.1-7.3-7.5-7.3z" /><ellipse cx="9" cy="10.6" rx="1.7" ry="2.1" fill="currentColor" stroke="none" /><ellipse cx="15" cy="10.6" rx="1.7" ry="2.1" fill="currentColor" stroke="none" /></svg>;

const LogSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>;
const ResetSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>;
const FlagSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>;
const TweaksSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={s}><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none" /><circle cx="15" cy="17" r="2.2" fill="currentColor" stroke="none" /></svg>;
const ClockSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 15" /></svg>;
const CheckSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>;
const PlusSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12l7-7 7 7" /></svg>;
const ExitSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>;
// Roll-pill glyphs: a hex die (turn roll) and a close X (dismiss the offer).
const RollHexSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" style={{ width: 16, height: 16 }} aria-hidden="true"><path d="M12 2.6 20.5 7v10L12 21.4 3.5 17V7z" /><path d="M12 2.6V21.4M3.5 7l8.5 5 8.5-5" /></svg>;
const CloseSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>;
