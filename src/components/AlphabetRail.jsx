// The Collection A-Z alphabet rail: a Niagara-style vertical index on the logical inline edge. Drag or
// tap a letter to jump; labels bulge around the touch point. Present letters are real <button>s; absent
// letters are inert visual slots (no pointer, no keyboard, no jump). ALL the decisions live in tested
// pure helpers - `railModel` (which letters, indexability, stable modelKey), `bulge`/`indexAtY` (the
// wave + hit math), `activeLetterFor` (scroll highlight), and the `railReducer` jump coordinator. This
// component is the thin DOM shell: pointer capture, one rAF, one passive scroll listener, and STRICT
// teardown (endGesture on up/cancel/lostcapture/replacement; dispose on root-change/unmount).
//
// Interactive behaviour (WebView pointer capture, scroll fidelity, exact geometry) is DEVICE-GATED and
// unverified in the repo gates - only the pure helpers it drives are unit-tested.
import { useReducer, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { RAIL_ORDER, bulge, firstPresent, lastPresent, stepLetter, activeLetterFor } from '../store/alphabetIndex.js';
import { indexAtY, railBounds } from '../store/railGeometry.js';
import { resolveScrollRoot } from '../store/collectionAllModel.js';
import { initialRailState, railReducer, shouldCommit } from './alphabetRailState.js';

const RADIUS = 64;        // wave falloff radius (px) around the touch point
const MAX_SCALE = 1.9;    // centre label scale at the touch point
const LOOKAHEAD = 60;     // render a little past the target so the landing has context
const PRIMARY_MOUSE = 0;  // left button
const OBSTRUCTIONS = '.cx-dock, .fab-stacked';   // the reachable bottom stack to clear

// `headerHeight` is the root-relative sticky-header height on THIS surface (a per-surface constant,
// device-tunable). It is used both to land a jump below the header and as the active-letter threshold;
// the fixed `bounds` for positioning are measured from the live dock obstruction.
export default function AlphabetRail({ model, count, ensureRendered, signature, headerHeight = 48, side = 'right', selecting = false }) {
  const [state, dispatch] = useReducer(railReducer, initialRailState);
  const [active, setActive] = useState(null);
  const [bounds, setBounds] = useState(null);
  const rootRef = useRef(null);          // this rail's DOM node -> resolve the scroll root from it
  const labelRefs = useRef([]);          // per-letter DOM nodes, for direct transform writes (no re-render)
  const stripRef = useRef(null);         // the continuous capture strip
  const reqRef = useRef(0);              // monotonic pick requestId
  const rafRef = useRef(0);              // wave rAF handle
  const pendingYRef = useRef(null);      // latest pointer Y awaiting a wave frame
  const capturedRef = useRef(null);      // captured pointerId (or null)
  const lastPickRef = useRef(null);      // last letter emitted THIS gesture (dedupe; reset on each down)

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
  // header. Fail closed (no announcement) if the anchor is missing.
  useLayoutEffect(() => {
    if (!shouldCommit(state)) return;
    const { requestId, letter } = state.pending;
    const root = scrollRoot();
    const anchor = root && root.querySelector(`[data-letter="${letter}"]`);
    if (!root || !anchor) { dispatch({ type: 'COMMIT_MISS', requestId }); return; }
    const delta = anchor.getBoundingClientRect().top - root.getBoundingClientRect().top - headerHeight;
    root.scrollTop += delta;                                    // land just below the sticky header
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
      const rootTop = root.getBoundingClientRect().top;
      const threshold = headerHeight;                          // the header boundary, in root-relative px
      const anchors = [];
      for (const l of RAIL_ORDER) {
        const el = root.querySelector(`[data-letter="${l}"]`);
        if (el) anchors.push({ letter: l, top: el.getBoundingClientRect().top - rootTop });
      }
      setActive(activeLetterFor(anchors, threshold, present));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => { root.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [present, modelKey, headerHeight]);

  // Measure the fixed bounds from the LIVE dock/FAB obstruction (Codex's preferred path: a single
  // measured boundary, immune to safe-area double-counting). Recompute on viewport resize + keyboard.
  useEffect(() => {
    const compute = () => {
      const root = scrollRoot();
      const vv = typeof window !== 'undefined' ? window : null;
      if (!root || !vv) return;
      const vh = (vv.visualViewport && vv.visualViewport.height) || vv.innerHeight;
      let obstructionTop = Infinity;
      for (const el of document.querySelectorAll(OBSTRUCTIONS)) {
        const t = el.getBoundingClientRect().top;
        if (t > 0 && t < obstructionTop) obstructionTop = t;
      }
      setBounds(railBounds({ viewportHeight: vh, scrollRootTop: root.getBoundingClientRect().top, headerHeight, obstructionTop }));
    };
    let raf = requestAnimationFrame(compute);   // measure after paint (dock/keyboard settled)
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute); };
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize);
    };
  }, [headerHeight, selecting]);

  // ---- Gesture: continuous capture strip; position -> letter; event-driven rAF wave -----------------
  const applyWave = useCallback((y) => {
    const strip = stripRef.current;
    if (!strip) return;
    const rect = strip.getBoundingClientRect();
    const reduce = typeof document !== 'undefined' && document.body.classList.contains('reduce-motion');
    for (let i = 0; i < order.length; i += 1) {
      const el = labelRefs.current[i];
      if (!el) continue;
      const centre = rect.top + (i + 0.5) * (rect.height / order.length);
      const scale = reduce ? 1 : bulge(y - centre, RADIUS, MAX_SCALE);
      el.style.transform = scale === 1 ? '' : `scale(${scale.toFixed(3)})`;
    }
  }, [order.length]);

  const frame = useCallback(() => {
    rafRef.current = 0;
    const y = pendingYRef.current;
    if (y == null) return;
    applyWave(y);
    const strip = stripRef.current;
    if (strip) {
      const rect = strip.getBoundingClientRect();
      const letter = order[indexAtY(y, rect.top, rect.height, order.length)];
      if (letter && letter !== lastPickRef.current && present.has(letter)) {   // deduped; absent slots ignored
        lastPickRef.current = letter;
        pick(letter);
      }
    }
  }, [applyWave, order, present, pick]);

  const schedule = useCallback((y) => {
    pendingYRef.current = y;
    if (!rafRef.current) rafRef.current = requestAnimationFrame(frame);
  }, [frame]);

  const endGesture = useCallback(() => {
    if (rafRef.current) { const y = pendingYRef.current; if (y != null) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; frame(); } }
    pendingYRef.current = null;
    const el = stripRef.current;
    const id = capturedRef.current;
    if (el && id != null) { try { if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id); } catch { /* noop */ } }
    capturedRef.current = null;
    for (const l of labelRefs.current) if (l) l.style.transform = '';   // CSS settles them home
  }, [frame]);

  const onPointerDown = (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== PRIMARY_MOUSE)) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); capturedRef.current = e.pointerId; } catch { /* not capturable */ }
    e.preventDefault();
    lastPickRef.current = null;                // a fresh gesture may re-pick the same letter
    schedule(e.clientY);                       // a bare tap (no move) still schedules a pick immediately
  };
  const onPointerMove = (e) => { if (capturedRef.current === e.pointerId) schedule(e.clientY); };
  const onPointerUp = () => endGesture();
  const onLostCapture = () => endGesture();

  // dispose: unmount tears the gesture down (endGesture) - the scroll listener cleans up via its own
  // effect return. One place to reason about leaks.
  useEffect(() => endGesture, [endGesture]);

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
  // populates and the bounds effect can resolve the scroll root and measure the live obstruction.
  const b = bounds || { top: headerHeight, bottom: 140 };
  const edge = side === 'left' ? { insetInlineStart: 2 } : { insetInlineEnd: 2 };
  return (
    <nav ref={rootRef} aria-label="Alphabetical index" onKeyDown={onKeyDown}
      style={{ position: 'fixed', top: b.top, bottom: b.bottom, ...edge, zIndex: 45,
        display: 'flex', width: 26, pointerEvents: 'none', opacity: bounds ? 1 : 0 }}>
      {/* continuous capture strip - the letter comes from POSITION, so small labels stay reachable */}
      <div ref={stripRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onLostPointerCapture={onLostCapture}
        style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'space-between', padding: '4px 0', touchAction: 'none', pointerEvents: 'auto' }}>
        {order.map((l, i) => {
          const on = present.has(l);
          return (
            <button key={l} ref={(n) => { labelRefs.current[i] = n; }} type="button"
              disabled={!on} aria-hidden={!on} tabIndex={on && (active === l || (!active && l === firstPresent(present))) ? 0 : -1}
              aria-current={active === l ? 'true' : undefined}
              onClick={on ? () => { setActive(l); pick(l); } : undefined}
              style={{ all: 'unset', font: "700 9.5px/1 var(--f-mono)", letterSpacing: '.02em',
                color: on ? (active === l ? 'var(--gold-num)' : 'var(--ink-muted)') : 'var(--ink-faint)',
                opacity: on ? 1 : 0.28, transformOrigin: side === 'left' ? 'left center' : 'right center',
                cursor: on ? 'pointer' : 'default', pointerEvents: on ? 'auto' : 'none', willChange: 'transform' }}>
              {l}
            </button>
          );
        })}
      </div>
      {/* committed-destination announcement only (never intermediate drag crossings) */}
      <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {state.committedLetter ? `Jumped to ${state.committedLetter}` : ''}
      </span>
    </nav>
  );
}
