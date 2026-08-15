// The Advanced Counter Band - "Cartouche" (docs/proposals/advanced-counter-band.md).
// Two mirrored strips anchored to the counter divider: per player one mana pill +
// four element thresholds. The strips are an OVERLAY hung off the 2px divider, so
// the life numerals cannot move or resize between Basic and Advanced by
// construction. Nothing in the band scrolls; every animation is transform/opacity.
//
// Interaction (rules live in bandState.js, pure + tested):
//   - horizontal drag on a figure = exactly one step (trigger 20px, haptic AT the
//     crossing, ghost until release, recross cancels; mirrored for the rotated
//     opponent row so right/left mean right/left from their seat);
//   - tap (<=10px travel) opens the inline - / + steppers, which dock OUTSIDE the
//     strip toward the tapped player's own side (owner ruling D-b3) - no modal,
//     no dim; hold-to-repeat 380ms then 130ms; dismiss on tap elsewhere;
//   - floor 0: a refused decrement shakes the figure (no haptic, no pulse).
// Values are table state only (D-b4): no match-log writes ever originate here.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dragDir, isTap, repeatDelay } from './bandState.js';
import { ElementPip } from '../components/ElementPip.jsx';
import { haptic } from '../native.js';
import { activeProfileId } from '../store/profileRepository.js';

// One-time coach line (owner ask: make the gestures discoverable): shown under the
// player strip the FIRST time the band ever appears for this profile, retired
// forever on the first successful interaction or after 8s. Teach once, never nag -
// the counter's own philosophy ("the glow is enough"); TalkBack users get the full
// instruction in every figure's aria-label regardless.
const coachKey = () => `cx-band-coached:${activeProfileId()}`;
const needsCoach = () => { try { return localStorage.getItem(coachKey()) !== '1'; } catch { return false; } };
const markCoached = () => { try { localStorage.setItem(coachKey(), '1'); } catch { /* ignore */ } };

const ELEMENTS = ['air', 'earth', 'fire', 'water'];
// Owner ruling D-b2: the app-wide element tokens, identical hues in every pillar.
const EL_COLOR = { air: 'var(--el-air)', earth: 'var(--el-earth)', fire: 'var(--el-fire)', water: 'var(--el-water)' };

// Ceremony beats (approved timings): strips unroll after the divider flash, the
// ten figures stamp after the unroll, staggered left-to-right, opponent row +80ms.
const UNROLL_MS = 620, STAMP_BASE_MS = 620, STAMP_STAGGER_MS = 60, OPP_EXTRA_MS = 80;

export default function CounterBand({ band, onStep, ceremonyKey }) {
  // The ceremony is a WINDOW, not a permanent class: band-enter and the inline
  // stamp delays must leave once the beat completes, or the higher-specificity
  // ceremony rule (and the lingering delay) would hijack every later commit
  // pulse on the same elements. 2s covers flash + unroll + the last stamp.
  const [entering, setEntering] = useState(ceremonyKey > 0);
  useEffect(() => {
    if (ceremonyKey > 0) {
      setEntering(true);
      const t = setTimeout(() => setEntering(false), 2000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [ceremonyKey]);
  const [coach, setCoach] = useState(needsCoach);
  useEffect(() => {
    if (!coach) return undefined;
    const t = setTimeout(() => { setCoach(false); markCoached(); }, 8000);
    return () => clearTimeout(t);
  }, [coach]);
  const coachDone = () => { if (coach) { setCoach(false); markCoached(); } };
  // Ghost per figure while a drag is armed: 'p|mana' -> +1 | -1
  const [ghosts, setGhosts] = useState({});
  // Open stepper target: { side, fig } | null
  const [stepper, setStepper] = useState(null);
  // Commit fx per figure: { seq, kind: 'pulse' | 'shake', dir }
  const [fx, setFx] = useState({});
  const gestures = useRef(new Map());   // pointerId -> { side, fig, startX, startY, maxTravel, ghost }
  const fxSeq = useRef(0);

  const key = (side, fig) => `${side}|${fig}`;

  const fire = (side, fig, dir) => {
    coachDone();
    const changed = onStep(side, fig, dir);
    fxSeq.current += 1;
    setFx((m) => ({ ...m, [key(side, fig)]: { seq: fxSeq.current, kind: changed ? 'pulse' : 'shake', dir } }));
    return changed;
  };

  // ---- drag / tap on a figure ----
  const onDown = (side, fig) => (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    gestures.current.set(e.pointerId, { side, fig, startX: e.clientX, startY: e.clientY, maxTravel: 0, ghost: 0 });
  };
  const onMove = (side, fig, mirrored) => (e) => {
    const g = gestures.current.get(e.pointerId);
    if (!g) return;
    const dx = e.clientX - g.startX;
    const travel = Math.max(Math.abs(dx), Math.abs(e.clientY - g.startY));
    g.maxTravel = Math.max(g.maxTravel, travel);
    const dir = dragDir(dx, mirrored);
    if (dir !== g.ghost) {
      if (dir !== 0) haptic('light');   // haptic AT the trigger crossing, not on release
      g.ghost = dir;
      setGhosts((m) => ({ ...m, [key(side, fig)]: dir }));
    }
  };
  const onUp = (side, fig) => (e) => {
    const g = gestures.current.get(e.pointerId);
    if (!g) return;
    gestures.current.delete(e.pointerId);
    setGhosts((m) => ({ ...m, [key(side, fig)]: 0 }));
    if (isTap(g.maxTravel)) {
      coachDone();
      setStepper((s) => (s && s.side === side && s.fig === fig ? null : { side, fig }));
      return;
    }
    setStepper(null);
    if (g.ghost !== 0) fire(side, fig, g.ghost);   // one gesture = exactly one step
  };
  const onCancel = (side, fig) => (e) => {
    gestures.current.delete(e.pointerId);
    setGhosts((m) => ({ ...m, [key(side, fig)]: 0 }));
  };

  // Steppers dismiss on any pointer-down outside the band - and that dismissing
  // tap is SWALLOWED (owner report: it fell through to the life tap-zones, so
  // closing the steppers cost a life point). Capture-phase preventDefault kills
  // the compatibility click; a one-shot click swallower is the belt to those
  // braces. Band interactions (figures, the steppers themselves) pass through
  // untouched so tapping another figure still switches the steppers to it.
  useEffect(() => {
    if (!stepper) return undefined;
    const onDoc = (e) => {
      if (e.target.closest?.('.band-wrap')) return;
      e.preventDefault();
      e.stopPropagation();
      const swallow = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, true), 400);
      setStepper(null);
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [stepper]);

  const figure = (side, fig, col) => {
    const mirrored = side === 'e';
    const k = key(side, fig);
    const ghost = ghosts[k] || 0;
    const eff = fx[k];
    const value = band[side][fig];
    const shown = ghost !== 0 ? Math.max(0, value + ghost) : value;
    const stampDelay = entering ? STAMP_BASE_MS + col * STAMP_STAGGER_MS + (mirrored ? OPP_EXTRA_MS : 0) : 0;
    return (
      <button key={k} type="button" className="band-fig" data-fig={k}
        aria-label={`${side === 'p' ? 'Your' : "Opponent's"} ${fig === 'mana' ? 'mana' : fig + ' threshold'}: ${value}. Drag sideways to change, tap for controls`}
        onPointerDown={onDown(side, fig)} onPointerMove={onMove(side, fig, mirrored)}
        onPointerUp={onUp(side, fig)} onPointerCancel={onCancel(side, fig)}>
        {ghost !== 0 && <span className="band-rail" aria-hidden="true" />}
        <span className={`band-fig-rot${mirrored ? ' rot' : ''}`}>
          <span key={eff ? eff.seq : 0}
            className={`band-fig-stamp${eff ? (eff.kind === 'pulse' ? ' pulse' : ' shake') : ''}`}
            style={entering ? { animationDelay: `${stampDelay}ms` } : undefined}>
            {fig === 'mana' ? (
              <span className={`band-mana${ghost ? (ghost > 0 ? ' ghost-up' : ' ghost-down') : ''}`}>{shown}</span>
            ) : (
              <>
                <ElementPip el={fig} color={EL_COLOR[fig]} size={18} />
                <span className={`band-thr${ghost ? (ghost > 0 ? ' ghost-up' : ' ghost-down') : ''}`}>{shown}</span>
              </>
            )}
            {eff?.kind === 'pulse' && <span className={`band-trail${eff.dir < 0 ? ' down' : ''}`} aria-hidden="true">{eff.dir > 0 ? '+1' : '−1'}</span>}
          </span>
        </span>
      </button>
    );
  };

  const strip = (side) => (
    <div className={`band-strip ${side === 'p' ? 'player' : 'opp'}`}>
      <div className="band-fill" />
      <div className="band-grid">
        {figure(side, 'mana', 0)}
        {ELEMENTS.map((el, i) => figure(side, el, i + 1))}
      </div>
    </div>
  );

  return (
    <div className={`band-wrap${entering ? ' band-enter' : ''}`} key={ceremonyKey}>
      {entering && <div className="band-flash" aria-hidden="true" />}
      {strip('e')}
      {strip('p')}
      {/* Steppers are SIBLINGS of the strips, positioned from the wrap: the strip's
          cartouche clip-path would clip anything docked outside its own box. */}
      {stepper && (
        <Steppers side={stepper.side} fig={stepper.fig} onStep={(dir) => fire(stepper.side, stepper.fig, dir)} />
      )}
      {coach && !stepper && (
        <div className="band-coach" aria-hidden="true">Drag sideways to adjust · Tap for − +</div>
      )}
    </div>
  );
}

// The inline - / + pair, docked OUTSIDE the strip toward the tapped player's own
// side (D-b3), centred on the tapped figure's measured bounds and edge-clamped to
// the strip. Hold-to-repeat per bandState cadence; each tick pulses + haptics.
function Steppers({ side, fig, onStep }) {
  const ref = useRef(null);
  const [left, setLeft] = useState(null);
  const repeat = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const wrap = el?.parentElement;   // the band-wrap (the steppers are strip SIBLINGS)
    const figEl = wrap?.querySelector(`[data-fig="${side}|${fig}"]`);
    if (!el || !figEl) return;
    const w = wrap.getBoundingClientRect();
    const f = figEl.getBoundingClientRect();
    const centre = f.left + f.width / 2 - w.left;
    const half = el.offsetWidth / 2;
    setLeft(Math.max(half + 4, Math.min(w.width - half - 4, centre)));
  }, [side, fig]);

  const stopRepeat = () => { clearTimeout(repeat.current); repeat.current = null; };
  const startRepeat = (dir) => (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    haptic('light');
    onStep(dir);
    let tick = 0;
    const loop = () => {
      repeat.current = setTimeout(() => { haptic('light'); onStep(dir); tick += 1; loop(); }, repeatDelay(tick));
    };
    loop();
  };
  useEffect(() => stopRepeat, []);

  return (
    <div ref={ref} className={`band-steppers ${side === 'p' ? 'player' : 'opp'}`}
      style={left != null ? { left, transform: side === 'e' ? 'translateX(-50%) rotate(180deg)' : 'translateX(-50%)' } : { visibility: 'hidden' }}>
      <button type="button" className="band-step-btn" aria-label="Decrease"
        onPointerDown={startRepeat(-1)} onPointerUp={stopRepeat} onPointerCancel={stopRepeat} onPointerLeave={stopRepeat}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <button type="button" className="band-step-btn" aria-label="Increase"
        onPointerDown={startRepeat(+1)} onPointerUp={stopRepeat} onPointerCancel={stopRepeat} onPointerLeave={stopRepeat}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
    </div>
  );
}
