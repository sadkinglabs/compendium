// The Collection A-Z alphabet rail: a vertical index on the logical inline edge. The rail is a plain,
// static track of small Cinzel letters; the READOUT is a big letter pill that floats beside the thumb
// while you scrub. Present letters are real <button>s for keyboard/AT, but ALL pointer input lands on the
// continuous capture strip (the buttons are pointer-inert), so the letter always comes from POSITION.
//
// LATCH model: during a drag we do ZERO grid work (no jump/scroll/re-render) - we only move the floating
// pill imperatively and remember the letter under the finger. The single grow+scroll fires once, on
// RELEASE, and the release letter is resolved SYNCHRONOUSLY from pointerup.clientY (never a value left by
// an animation frame) so a tap that releases before any rAF still jumps exactly once. A pointercancel
// aborts with no jump; a release over an absent slot is a no-op with no haptic confirm. The whole
// sequence lives in the pure, tested `makeRailGesture` controller - this component is the DOM shell.
//
// Lifecycle / leaks: the scroll root is resolved through a CALLBACK REF into state, so mounting, ducking
// (indexable/present -> false renders null), and a real root replacement each rebind or tear down the
// tracking effects. When the rail becomes invisible we also abort any live gesture, CANCEL the pending
// jump, and clear stale bounds. Gesture window-listeners live in a per-gesture cleanup ref; the unmount
// dispose aborts the gesture. Nothing rides on callback identities (those churn on parent re-render).
//
// Geometry: measurements are REAL viewport px but this nav renders inside `.cx-app { zoom: --ui-scale }`,
// where fixed insets and scrollTop are LAYOUT px - so every measured inset/delta is divided once by the
// measured effectiveZoom. Interactive behaviour (WebView pointer streams, scroll fidelity, exact
// geometry) is DEVICE-GATED; only the pure helpers it drives are unit-tested.
import { useReducer, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { RAIL_ORDER, firstPresent, lastPresent, stepLetter, activeLetterFor } from '../store/alphabetIndex.js';
import { indexAtY, railBounds, railTopOffset, effectiveZoom } from '../store/railGeometry.js';
import { resolveScrollRoot } from '../store/collectionAllModel.js';
import { haptic } from '../native.js';
import { initialRailState, railReducer, shouldCommit, makeRailGesture } from './alphabetRailState.js';

const LOOKAHEAD = 60;     // render a little past the target so the landing has context
const PRIMARY_MOUSE = 0;  // left button
const RAIL_WIDTH = 44;    // capture strip width - a real thumb target; letters hug the screen edge inside it
const LETTER = 12;        // static rail letter size (px) - the rail is a plain track; the pill is the readout
const PILL_LETTER = 30;   // the big Cinzel letter shown in the floating pill beside the thumb
const PILL_SIZE = 58;     // pill diameter (px)
const PILL_GAP = 18;      // pill sits this far INSIDE the strip, so it clears the thumb driving the scroll
// The reachable bottom stack to clear: the dock itself plus ANY FAB wrap in its FAB slot.
const OBSTRUCTIONS = '.cx-dock, .cx-dock-fab .fab-wrap';

export default function AlphabetRail({ model, count, ensureRendered, signature, headerHeight = 48, side = 'right', selecting = false }) {
  const [state, dispatch] = useReducer(railReducer, initialRailState);
  const [active, setActive] = useState(null);           // scroll-derived highlight (last crossed anchor)
  const [focusedLetter, setFocusedLetter] = useState(null);   // keyboard roving focus (independent of `active`)
  const [bounds, setBounds] = useState(null);
  const [scrubbing, setScrubbing] = useState(false);    // a drag is live -> the floating letter pill is shown
  const [rootEl, setRootEl] = useState(null);           // resolved scroll root (via callback ref -> rebinds on root change)
  const stripRef = useRef(null);
  const pillRef = useRef(null);
  const buttonRefs = useRef(new Map());                 // present-letter buttons, for roving focus()
  const reqRef = useRef(0);
  const rafRef = useRef(0);                             // pill-position rAF
  const pendingYRef = useRef(null);
  const zoomRef = useRef(1);
  const teardownRef = useRef(null);                     // live gesture's window-listener + capture cleanup
  const scrubLetterRef = useRef(null);
  const modelRef = useRef(model);
  const pickRef = useRef(null);

  const { order, present, firstIndex, indexable, modelKey } = model;
  const visible = indexable && present.size > 0;        // fail closed: not-indexable or empty -> duck
  useLayoutEffect(() => { modelRef.current = model; });

  // The nav's callback ref resolves the scroll root into STATE. Mount -> bind; duck (null render) or a
  // root replacement -> the effects keyed on rootEl tear down the old root and bind the new one.
  const navRef = useCallback((node) => { setRootEl(node ? resolveScrollRoot(node) : null); }, []);

  // ---- Jump coordinator (drives the DOM scroll; the reducer owns sequencing) -----------------------
  const pick = useCallback((letter) => {
    if (!present.has(letter)) return;                          // absent slot -> no-op (never a jump)
    const idx = firstIndex.get(letter);
    if (idx == null) return;
    const requestId = (reqRef.current += 1);
    dispatch({ type: 'PICK', requestId, signature, modelKey, letter, idx });
    ensureRendered(idx + 1 + LOOKAHEAD);                       // grow the prefix so the target row exists
  }, [present, firstIndex, signature, modelKey, ensureRendered]);
  useLayoutEffect(() => { pickRef.current = pick; });

  useLayoutEffect(() => {
    dispatch({ type: 'OBSERVE', count, signature, modelKey });
  }, [state.pending, count, signature, modelKey]);

  // Commit: once ready, scroll the letter's first anchor under the header. Rect deltas are real px,
  // scrollTop is layout px - normalise by the measured zoom. Fail closed (no announcement) if missing.
  useLayoutEffect(() => {
    if (!shouldCommit(state) || !rootEl) return;
    const { requestId, letter } = state.pending;
    const anchor = rootEl.querySelector(`[data-letter="${letter}"]`);
    if (!anchor) { dispatch({ type: 'COMMIT_MISS', requestId }); return; }
    const rootRect = rootEl.getBoundingClientRect();
    const zoom = effectiveZoom(rootRect.width, rootEl.offsetWidth);
    const delta = (anchor.getBoundingClientRect().top - rootRect.top) / zoom - headerHeight;
    rootEl.scrollTop += delta;
    dispatch({ type: 'COMMIT_OK', requestId });
  }, [state.ready, state.pending && state.pending.requestId, rootEl]);

  // ---- Active-letter tracking: one passive listener on the resolved root, rAF-throttled. Bound to
  // rootEl + visible, so a duck or a root replacement tears it down. ----------------------------------
  useEffect(() => {
    if (!rootEl || !visible) return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const rootRect = rootEl.getBoundingClientRect();
      const zoom = effectiveZoom(rootRect.width, rootEl.offsetWidth);
      const anchors = [];
      for (const l of RAIL_ORDER) {
        const el = rootEl.querySelector(`[data-letter="${l}"]`);
        if (el) anchors.push({ letter: l, top: (el.getBoundingClientRect().top - rootRect.top) / zoom });
      }
      setActive(activeLetterFor(anchors, headerHeight, present));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    rootEl.addEventListener('scroll', onScroll, { passive: true });
    return () => { rootEl.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [rootEl, visible, present, modelKey, headerHeight]);

  // ---- Live bounds: top from the sticky chrome / first tile (railTopOffset), bottom from the dock/FAB
  // obstruction (one measured boundary). Re-measured on scroll (the ALL header rides below the toggle
  // then pins), resize/keyboard, and once after the stacked FAB's .4s rise. Bound to rootEl + visible. --
  useEffect(() => {
    if (!rootEl || !visible || typeof window === 'undefined') return undefined;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const vh = window.innerHeight;
      const rootRect = rootEl.getBoundingClientRect();
      const zoom = effectiveZoom(rootRect.width, rootEl.offsetWidth);
      const sticky = rootEl.querySelector('[data-rail-sticky]');
      const firstTile = rootEl.querySelector('[data-letter]');
      const offset = railTopOffset({
        scrollRootTop: rootRect.top,
        stickyBottom: sticky ? sticky.getBoundingClientRect().bottom : null,
        contentTop: firstTile ? firstTile.getBoundingClientRect().top : null,
      });
      let obstructionTop = Infinity;
      for (const el of document.querySelectorAll(OBSTRUCTIONS)) {
        const t = el.getBoundingClientRect().top;
        if (t > 0 && t < obstructionTop) obstructionTop = t;
      }
      const b = railBounds({ viewportHeight: vh, scrollRootTop: rootRect.top, headerHeight: offset, obstructionTop });
      const nt = b.top / zoom;
      const nb = b.bottom / zoom;
      setBounds((prev) => (prev && Math.abs(prev.top - nt) < 0.5 && Math.abs(prev.bottom - nb) < 0.5 ? prev : { top: nt, bottom: nb }));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(compute); };
    raf = requestAnimationFrame(compute);
    const late = setTimeout(compute, 480);
    rootEl.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(late);
      rootEl.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', schedule);
    };
  }, [rootEl, visible, headerHeight, selecting]);

  // ---- Gesture (latch): the pure controller resolves letters synchronously; these callbacks are the
  // DOM side (pill position/haptic) and are created ONCE, reading refs so they never go stale. ---------
  const positionPill = useCallback(() => {
    rafRef.current = 0;
    const y = pendingYRef.current;
    const strip = stripRef.current;
    const pill = pillRef.current;
    if (y == null || !strip || !pill) return;
    const rect = strip.getBoundingClientRect();
    const clampedY = Math.max(rect.top, Math.min(rect.bottom, y));
    pill.style.top = `${clampedY / (zoomRef.current || 1)}px`;
  }, []);
  const gestureRef = useRef(null);
  if (!gestureRef.current) {
    gestureRef.current = makeRailGesture({
      resolveLetter: (y) => {
        const strip = stripRef.current;
        if (!strip) return null;
        const rect = strip.getBoundingClientRect();
        const ord = modelRef.current.order;
        return ord[indexAtY(y, rect.top, rect.height, ord.length)] || null;
      },
      isPresent: (l) => modelRef.current.present.has(l),
      onScrub: (letter, y, changed) => {
        pendingYRef.current = y;
        if (!rafRef.current) rafRef.current = requestAnimationFrame(positionPill);
        if (changed) {
          scrubLetterRef.current = letter;
          const on = modelRef.current.present.has(letter);
          const pill = pillRef.current;
          if (pill) {
            pill.style.opacity = on ? '1' : '.5';
            if (pill.firstChild) { pill.firstChild.textContent = letter || ''; pill.firstChild.style.color = on ? 'var(--gold-num)' : 'var(--ink-faint)'; }
          }
          haptic('light');
        }
      },
      onJump: (letter) => { haptic('medium'); pickRef.current(letter); },
      onEnd: () => {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
        pendingYRef.current = null;
        if (teardownRef.current) teardownRef.current();
        setScrubbing(false);
      },
    });
  }
  const gesture = gestureRef.current;

  const onPointerDown = (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== PRIMARY_MOUSE)) return;
    if (teardownRef.current || gesture.isActive()) return;     // one gesture at a time
    const id = e.pointerId;
    const strip = e.currentTarget;
    const rr = rootEl && rootEl.getBoundingClientRect();
    zoomRef.current = rr ? effectiveZoom(rr.width, rootEl.offsetWidth) : 1;
    try { strip.setPointerCapture(id); } catch { /* capture is a bonus - window listeners carry the drag */ }
    const onMove = (ev) => { if (ev.pointerId === id) gesture.move(id, ev.clientY); };
    const onUp = (ev) => { if (ev.pointerId === id) gesture.up(id, ev.clientY); };       // release -> synchronous jump
    const onCancel = (ev) => { if (ev.pointerId === id) gesture.cancel(id); };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onCancel, { passive: true });
    teardownRef.current = () => {
      teardownRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      try { if (strip.hasPointerCapture && strip.hasPointerCapture(id)) strip.releasePointerCapture(id); } catch { /* noop */ }
    };
    e.preventDefault();
    scrubLetterRef.current = null;
    setScrubbing(true);
    gesture.down(id, e.clientY);                                // latches the first letter + positions the pill
  };

  // Duck / root-change teardown: when the rail becomes invisible, abort any live gesture, cancel the
  // pending jump, and clear stale bounds. The tracking effects unbind via their rootEl/visible deps.
  useEffect(() => {
    if (visible) return;
    gesture.abort();
    dispatch({ type: 'CANCEL' });
    setBounds(null);
  }, [visible, gesture]);

  // Unmount dispose: abort the gesture (removes window listeners + capture) and cancel the pill rAF.
  useEffect(() => () => {
    gesture.abort();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, [gesture]);

  // Keyboard: ARROW/HOME/END only (Enter/Space are left to the focused button's native onClick, so an
  // activation is exactly one pick). Navigation moves DOM FOCUS to the destination button, then jumps -
  // movement derives from the FOCUSED letter, never the scroll-derived `active`.
  const onKeyDown = (e) => {
    const cur = focusedLetter || firstPresent(present);
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = stepLetter(present, cur, 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = stepLetter(present, cur, -1);
    else if (e.key === 'Home') next = firstPresent(present);
    else if (e.key === 'End') next = lastPresent(present);
    else return;
    e.preventDefault();
    if (!next) return;
    setFocusedLetter(next);
    const node = buttonRefs.current.get(next);
    if (node) node.focus();                                     // move focus BEFORE the jump
    pick(next);
  };

  if (!visible) return null;   // fail closed / nothing to navigate -> duck (effects unbind via deps above)

  const b = bounds || { top: headerHeight, bottom: 140 };       // safe fallback until the first measure
  const tabLetter = focusedLetter && present.has(focusedLetter) ? focusedLetter : firstPresent(present);
  const edge = side === 'left' ? { insetInlineStart: 0 } : { insetInlineEnd: 0 };
  return (
    <nav ref={navRef} aria-label="Alphabetical index" onKeyDown={onKeyDown}
      style={{ position: 'fixed', top: b.top, bottom: b.bottom, ...edge, zIndex: 45,
        display: 'flex', width: RAIL_WIDTH, pointerEvents: 'none', opacity: bounds ? 1 : 0 }}>
      <div ref={stripRef} onPointerDown={onPointerDown}
        style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: side === 'left' ? 'flex-start' : 'flex-end', justifyContent: 'space-between',
          padding: side === 'left' ? '4px 0 4px 10px' : '4px 10px 4px 0',
          touchAction: 'none', pointerEvents: 'auto', cursor: 'pointer' }}>
        {order.map((l) => {
          const on = present.has(l);
          return (
            <button key={l} type="button" className="cx-rail-letter"
              ref={(n) => { if (n) buttonRefs.current.set(l, n); else buttonRefs.current.delete(l); }}
              disabled={!on} aria-hidden={!on} tabIndex={on && l === tabLetter ? 0 : -1}
              aria-current={active === l ? 'true' : undefined}
              onClick={on ? () => { setFocusedLetter(l); pick(l); } : undefined}
              style={{ all: 'unset', fontFamily: 'var(--f-display)', fontWeight: active === l ? 800 : 600,
                fontSize: LETTER, lineHeight: 1, letterSpacing: '.03em',
                color: on ? (active === l ? 'var(--gold-num)' : 'var(--ink-muted)') : 'var(--ink-faint)',
                opacity: on ? 1 : 0.28, pointerEvents: 'none' }}>
              {l}
            </button>
          );
        })}
      </div>
      {scrubbing && (
        <div ref={pillRef} aria-hidden="true"
          style={{ position: 'fixed', top: 0, [side === 'left' ? 'left' : 'right']: RAIL_WIDTH + PILL_GAP,
            transform: 'translateY(-50%)', width: PILL_SIZE, height: PILL_SIZE, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, pointerEvents: 'none',
            background: 'rgba(14,11,7,.94)', border: '1px solid rgba(203,167,95,.55)', boxShadow: '0 8px 22px rgba(0,0,0,.55)' }}>
          <span style={{ font: `800 ${PILL_LETTER}px/1 var(--f-display)`, color: 'var(--gold-num)' }} />
        </div>
      )}
      <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {state.committedLetter ? `Jumped to ${state.committedLetter}` : ''}
      </span>
    </nav>
  );
}
