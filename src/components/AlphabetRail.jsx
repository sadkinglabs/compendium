// The Collection A-Z alphabet rail: a vertical index on the logical inline edge. The rail is a plain,
// static track of small Cinzel letters; the READOUT is a big letter pill that floats beside the thumb
// while you scrub. Present letters are real <button>s for keyboard/AT, but ALL pointer input lands on
// the continuous capture strip (the buttons are pointer-inert), so the letter always comes from POSITION
// - and on touch the implicit pointer capture lands on the strip itself, never on a tiny child. ALL the
// decisions live in tested pure helpers - `railModel` (which letters, indexability, stable modelKey),
// `indexAtY` (finger -> letter), `railTopOffset`/`railBounds`/`effectiveZoom` (the measured geometry),
// `activeLetterFor` (scroll highlight), and the `railReducer` jump coordinator. This is the DOM shell.
//
// LATCH model (the key to smoothness): during a drag we do ZERO grid work - no jump, no scroll, no React
// re-render - we only move the floating pill imperatively (one element) and remember the letter under the
// finger. The single expensive grow+scroll fires once, on RELEASE. Live-scrubbing ~1,500 image tiles was
// the source of the jank; a pill preview is the standard fix. A pointercancel aborts with no jump.
//
// Gesture plumbing: pointerdown on the strip installs WINDOW-level pointermove/up/cancel listeners keyed
// to that pointerId, so the drag survives a failed/stolen pointer capture and a finger that wanders off
// the strip. setPointerCapture is requested as a bonus but nothing depends on it. Teardown lives in a
// per-gesture cleanup ref + an unmount-only dispose effect - NEVER keyed on callback identities, which
// churn on parent re-renders and used to release the capture mid-drag. One rAF positions the pill with
// direct DOM writes (no per-frame React re-render).
//
// Geometry: every measurement (rects, viewport) is in REAL viewport px, but this nav renders inside the
// zoomed .cx-app subtree (`zoom: var(--ui-scale)`), where fixed insets and scrollTop are consumed in
// LAYOUT px - so every measured inset/delta is divided by the measured effectiveZoom exactly once.
//
// Interactive behaviour (WebView pointer streams, scroll fidelity, exact geometry) is DEVICE-GATED and
// unverified in the repo gates - only the pure helpers it drives are unit-tested.
import { useReducer, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { RAIL_ORDER, firstPresent, lastPresent, stepLetter, activeLetterFor } from '../store/alphabetIndex.js';
import { indexAtY, railBounds, railTopOffset, effectiveZoom } from '../store/railGeometry.js';
import { resolveScrollRoot } from '../store/collectionAllModel.js';
import { haptic } from '../native.js';
import { initialRailState, railReducer, shouldCommit } from './alphabetRailState.js';

const LOOKAHEAD = 60;     // render a little past the target so the landing has context
const PRIMARY_MOUSE = 0;  // left button
const RAIL_WIDTH = 44;    // capture strip width - a real thumb target; letters hug the screen edge inside it
const LETTER = 12;        // static rail letter size (px) - the rail is a plain track; the pill is the readout
const PILL_LETTER = 30;   // the big Cinzel letter shown in the floating pill beside the thumb
const PILL_SIZE = 58;     // pill diameter (px)
const PILL_GAP = 18;      // pill sits this far INSIDE the strip, so it clears the thumb driving the scroll
// The reachable bottom stack to clear: the dock itself plus ANY FAB wrap in its FAB slot (the plain
// filter FAB shares the dock rect; the stacked add FAB rises above it and is the true obstruction).
const OBSTRUCTIONS = '.cx-dock, .cx-dock-fab .fab-wrap';

// `headerHeight` is the root-relative landing offset on THIS surface (a per-surface constant,
// device-tunable): a jump scrolls its anchor this far below the root top, and the active-letter
// threshold matches it. The rail's own top/bottom POSITION is measured live, never from this.
export default function AlphabetRail({ model, count, ensureRendered, signature, headerHeight = 48, side = 'right', selecting = false }) {
  const [state, dispatch] = useReducer(railReducer, initialRailState);
  const [active, setActive] = useState(null);
  const [bounds, setBounds] = useState(null);
  const rootRef = useRef(null);          // this rail's DOM node -> resolve the scroll root from it
  const stripRef = useRef(null);         // the continuous capture strip
  const reqRef = useRef(0);              // monotonic pick requestId
  const rafRef = useRef(0);              // wave rAF handle
  const pendingYRef = useRef(null);      // latest pointer Y awaiting a pill frame
  const teardownRef = useRef(null);      // live gesture's cleanup (window listeners + capture release)
  const [scrubbing, setScrubbing] = useState(false);   // a drag is live -> the floating letter pill is shown
  const pillRef = useRef(null);          // the pill DOM node - positioned + lettered imperatively (no re-render)
  const scrubLetterRef = useRef(null);   // the letter currently under the finger (the LATCHED jump target)
  const zoomRef = useRef(1);             // effectiveZoom captured at gesture start (fixed insets are layout px)

  const { order, present, firstIndex, indexable, modelKey } = model;
  const scrollRoot = () => resolveScrollRoot(rootRef.current);

  // ---- Jump coordinator (drives the DOM scroll; the reducer owns sequencing) -----------------------
  const pick = useCallback((letter) => {
    if (!present.has(letter)) return;                          // absent slot -> no-op (never a jump)
    const idx = firstIndex.get(letter);
    if (idx == null) return;
    const requestId = (reqRef.current += 1);
    dispatch({ type: 'PICK', requestId, signature, modelKey, letter, idx });
    ensureRendered(idx + 1 + LOOKAHEAD);                       // grow the prefix so the target row exists
  }, [present, firstIndex, signature, modelKey, ensureRendered]);

  // OBSERVE whenever the pick, the rendered count, or the world (signature/modelKey) changes.
  useLayoutEffect(() => {
    dispatch({ type: 'OBSERVE', count, signature, modelKey });
  }, [state.pending, count, signature, modelKey]);

  // Commit: once ready, find the letter's first anchor INSIDE the resolved root and scroll it under the
  // header. Rect deltas are real px, scrollTop is layout px - normalise by the measured zoom. Fail
  // closed (no announcement) if the anchor is missing.
  useLayoutEffect(() => {
    if (!shouldCommit(state)) return;
    const { requestId, letter } = state.pending;
    const root = scrollRoot();
    const anchor = root && root.querySelector(`[data-letter="${letter}"]`);
    if (!root || !anchor) { dispatch({ type: 'COMMIT_MISS', requestId }); return; }
    const rootRect = root.getBoundingClientRect();
    const zoom = effectiveZoom(rootRect.width, root.offsetWidth);
    const delta = (anchor.getBoundingClientRect().top - rootRect.top) / zoom - headerHeight;
    root.scrollTop += delta;                                    // land just below the landing offset
    dispatch({ type: 'COMMIT_OK', requestId });
  }, [state.ready, state.pending && state.pending.requestId]);

  // ---- Active-letter tracking: one passive listener on the resolved root, rAF-throttled. Removed only
  // by dispose (root change / unmount), NOT by a completed gesture. -----------------------------------
  useEffect(() => {
    const root = scrollRoot();
    if (!root) return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const rootRect = root.getBoundingClientRect();
      const zoom = effectiveZoom(rootRect.width, root.offsetWidth);
      const threshold = headerHeight;                          // the landing boundary, in root-relative layout px
      const anchors = [];
      for (const l of RAIL_ORDER) {
        const el = root.querySelector(`[data-letter="${l}"]`);
        if (el) anchors.push({ letter: l, top: (el.getBoundingClientRect().top - rootRect.top) / zoom });
      }
      setActive(activeLetterFor(anchors, threshold, present));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => { root.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [present, modelKey, headerHeight]);

  // Measure the fixed bounds LIVE: top from the sticky chrome ([data-rail-sticky]) and the first grid
  // tile ([data-letter]) - the rail starts where the cards are, floored at the sticky header/scrollport
  // (railTopOffset). Bottom from the dock/FAB obstruction (a single measured boundary, immune to
  // safe-area double-counting). Both real-px results are divided ONCE by the measured zoom because this
  // nav's fixed insets are consumed inside the zoomed .cx-app subtree. Recompute on viewport resize +
  // keyboard, and once more after the stacked FAB's .4s rise (its mid-flight transform skews the rect).
  useEffect(() => {
    const compute = () => {
      raf = 0;
      const root = scrollRoot();
      if (!root || typeof window === 'undefined') return;
      const vh = window.innerHeight;                           // fixed insets anchor to the LAYOUT viewport
      const rootRect = root.getBoundingClientRect();
      const zoom = effectiveZoom(rootRect.width, root.offsetWidth);
      const sticky = root.querySelector('[data-rail-sticky]');
      const firstTile = root.querySelector('[data-letter]');
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
      // Skip a same-value update so scrolling past the pinned point does not re-render the rail per frame.
      setBounds((prev) => (prev && Math.abs(prev.top - nt) < 0.5 && Math.abs(prev.bottom - nb) < 0.5 ? prev : { top: nt, bottom: nb }));
    };
    let raf = requestAnimationFrame(compute);   // measure after paint (dock/keyboard settled)
    const late = setTimeout(compute, 480);      // after fabRiseIn (.4s) - the stacked FAB's true rest position
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute); };
    // Re-measure on SCROLL (rAF-throttled): the ALL header rides below the Sets/All toggle until it
    // pins to the scrollport top, so the rail's top floor moves with it.
    const root0 = scrollRoot();
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    if (root0) root0.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      if (root0) root0.removeEventListener('scroll', onScroll);
      clearTimeout(late);
      window.removeEventListener('resize', onResize);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize);
    };
  }, [headerHeight, selecting]);

  // ---- Gesture: strip-only pointer target; window-level move/up. LATCH model - during the drag we do
  // ZERO grid work (no jump, no scroll, no re-render); we only move the floating letter pill imperatively
  // and remember the letter under the finger. The single jump fires on RELEASE. This is what makes it
  // smooth: the heavy grow+scroll can't compete with the drag. -----------------------------------------
  const frame = useCallback(() => {
    rafRef.current = 0;
    const y = pendingYRef.current;
    const strip = stripRef.current;
    if (y == null || !strip) return;
    const rect = strip.getBoundingClientRect();
    const letter = order[indexAtY(y, rect.top, rect.height, order.length)];
    const pill = pillRef.current;
    const changed = letter !== scrubLetterRef.current;
    if (pill) {
      const clampedY = Math.max(rect.top, Math.min(rect.bottom, y));
      pill.style.top = `${clampedY / (zoomRef.current || 1)}px`;   // follows the finger every frame (layout px)
    }
    if (changed) {
      scrubLetterRef.current = letter;
      const on = present.has(letter);
      if (pill) {
        pill.style.opacity = on ? '1' : '.5';                      // an absent letter (won't jump) reads muted
        if (pill.firstChild) {
          pill.firstChild.textContent = letter || '';
          pill.firstChild.style.color = on ? 'var(--gold-num)' : 'var(--ink-faint)';
        }
      }
      haptic('light');                                             // a tick per letter, like fast-scroll
    }
  }, [order, present]);

  // Latest-frame ref: rAF always runs the CURRENT frame closure, while schedule/end/commit stay
  // identity-stable for the whole component lifetime (no teardown churn releasing the gesture mid-drag).
  const frameRef = useRef(frame);
  useLayoutEffect(() => { frameRef.current = frame; });
  const runFrame = useCallback(() => { frameRef.current(); }, []);

  const schedule = useCallback((y) => {
    pendingYRef.current = y;
    if (!rafRef.current) rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const endGesture = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    pendingYRef.current = null;
    if (teardownRef.current) teardownRef.current();            // window listeners + capture release
    setScrubbing(false);                                       // hides the pill
  }, []);

  // Release = LATCH: jump to the letter that was under the finger, once. Absent slots are a silent no-op.
  const commit = useCallback(() => {
    const letter = scrubLetterRef.current;
    endGesture();
    if (letter && present.has(letter)) { haptic('medium'); pick(letter); }   // a firmer tick confirms the jump
  }, [endGesture, present, pick]);
  const commitRef = useRef(commit);
  useLayoutEffect(() => { commitRef.current = commit; });

  const onPointerDown = (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== PRIMARY_MOUSE)) return;
    if (teardownRef.current) return;                           // one gesture at a time
    const id = e.pointerId;
    const strip = e.currentTarget;
    const root = scrollRoot();
    const rr = root && root.getBoundingClientRect();
    zoomRef.current = rr ? effectiveZoom(rr.width, root.offsetWidth) : 1;
    try { strip.setPointerCapture(id); } catch { /* capture is a bonus - window listeners carry the drag */ }
    const onMove = (ev) => { if (ev.pointerId === id) schedule(ev.clientY); };
    const onUp = (ev) => { if (ev.pointerId === id) commitRef.current(); };     // release -> the one jump
    const onCancel = (ev) => { if (ev.pointerId === id) endGesture(); };        // aborted -> no jump
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
    setScrubbing(true);                        // show the pill; the first frame positions + letters it
    schedule(e.clientY);                       // a bare tap positions the pill and latches its letter too
  };

  // dispose: unmount tears the live gesture down (rAF + window listeners + capture). Deliberately
  // dependency-free - gesture teardown must never ride on render identities.
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    pendingYRef.current = null;
    if (teardownRef.current) teardownRef.current();
  }, []);

  const onKeyDown = (e) => {
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = stepLetter(present, active || firstPresent(present), 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = stepLetter(present, active || firstPresent(present), -1);
    else if (e.key === 'Home') next = firstPresent(present);
    else if (e.key === 'End') next = lastPresent(present);
    else if (e.key === 'Enter' || e.key === ' ') next = active;
    else return;
    e.preventDefault();
    if (next) { setActive(next); pick(next); }
  };

  if (!indexable || present.size === 0) return null;   // fail closed / nothing to navigate -> duck (unmounts, disposing)

  // Render at a safe fallback until the first measure lands (one frame) - the nav must mount so rootRef
  // populates and the bounds effect can resolve the scroll root and measure the live boundaries.
  const b = bounds || { top: headerHeight, bottom: 140 };
  const edge = side === 'left' ? { insetInlineStart: 0 } : { insetInlineEnd: 0 };
  return (
    <nav ref={rootRef} aria-label="Alphabetical index" onKeyDown={onKeyDown}
      style={{ position: 'fixed', top: b.top, bottom: b.bottom, ...edge, zIndex: 45,
        display: 'flex', width: RAIL_WIDTH, pointerEvents: 'none', opacity: bounds ? 1 : 0 }}>
      {/* continuous capture strip - the ONLY pointer target; the letter comes from POSITION, so the
          hit area is the full strip width while the labels stay small and tucked against the edge */}
      <div ref={stripRef} onPointerDown={onPointerDown}
        style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: side === 'left' ? 'flex-start' : 'flex-end', justifyContent: 'space-between',
          padding: side === 'left' ? '4px 0 4px 10px' : '4px 10px 4px 0',
          touchAction: 'none', pointerEvents: 'auto', cursor: 'pointer' }}>
        {order.map((l, i) => {
          const on = present.has(l);
          return (
            <button key={l} type="button"
              disabled={!on} aria-hidden={!on} tabIndex={on && (active === l || (!active && l === firstPresent(present))) ? 0 : -1}
              aria-current={active === l ? 'true' : undefined}
              onClick={on ? () => { setActive(l); pick(l); } : undefined}
              style={{ all: 'unset', fontFamily: 'var(--f-display)', fontWeight: active === l ? 800 : 600,
                fontSize: LETTER, lineHeight: 1, letterSpacing: '.03em',
                color: on ? (active === l ? 'var(--gold-num)' : 'var(--ink-muted)') : 'var(--ink-faint)',
                opacity: on ? 1 : 0.28, pointerEvents: 'none' }}>
              {l}
            </button>
          );
        })}
      </div>
      {/* Floating readout: while scrubbing, a big Cinzel letter rides beside the thumb (offset INWARD so
          the finger never covers it), positioned + lettered imperatively from the rAF frame. */}
      {scrubbing && (
        <div ref={pillRef} data-present="1" aria-hidden="true"
          style={{ position: 'fixed', top: 0, [side === 'left' ? 'left' : 'right']: RAIL_WIDTH + PILL_GAP,
            transform: 'translateY(-50%)', width: PILL_SIZE, height: PILL_SIZE, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, pointerEvents: 'none',
            background: 'rgba(14,11,7,.94)', border: '1px solid rgba(203,167,95,.55)', boxShadow: '0 8px 22px rgba(0,0,0,.55)' }}>
          <span style={{ font: `800 ${PILL_LETTER}px/1 var(--f-display)`, color: 'var(--gold-num)' }} />
        </div>
      )}
      {/* committed-destination announcement only (never intermediate drag crossings) */}
      <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {state.committedLetter ? `Jumped to ${state.committedLetter}` : ''}
      </span>
    </nav>
  );
}
