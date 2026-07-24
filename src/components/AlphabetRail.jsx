// The Collection A-Z alphabet rail: a Niagara-style vertical index on the logical inline edge. Drag or
// tap a letter to jump; labels bulge around the touch point. Present letters are real <button>s for
// keyboard/AT, but ALL pointer input lands on the continuous capture strip (the buttons are
// pointer-inert), so the letter always comes from POSITION - and on touch the implicit pointer capture
// lands on the strip itself, never on a tiny child. ALL the decisions live in tested pure helpers -
// `railModel` (which letters, indexability, stable modelKey), `bulge`/`indexAtY` (the wave + hit math),
// `railTopOffset`/`railBounds`/`effectiveZoom` (the measured geometry), `activeLetterFor` (scroll
// highlight), and the `railReducer` jump coordinator. This component is the thin DOM shell.
//
// Gesture model: pointerdown on the strip installs WINDOW-level pointermove/up/cancel listeners keyed
// to that pointerId, so the drag survives a failed/stolen pointer capture and a finger that wanders off
// the 36px strip. setPointerCapture is still requested as a bonus (keeps the stream targeted), but
// nothing depends on it. Teardown lives in a per-gesture cleanup ref + an unmount-only dispose effect -
// NEVER keyed on callback identities, which churn on parent re-renders and used to release the capture
// mid-drag. One rAF drives the wave with direct transform writes (no per-frame React re-render);
// body.reduce-motion suppresses the wave but never the jump.
//
// Geometry: every measurement (rects, viewport) is in REAL viewport px, but this nav renders inside the
// zoomed .cx-app subtree (`zoom: var(--ui-scale)`), where fixed insets and scrollTop are consumed in
// LAYOUT px - so every measured inset/delta is divided by the measured effectiveZoom exactly once.
//
// Interactive behaviour (WebView pointer streams, scroll fidelity, exact geometry) is DEVICE-GATED and
// unverified in the repo gates - only the pure helpers it drives are unit-tested.
import { useReducer, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { RAIL_ORDER, bulge, firstPresent, lastPresent, stepLetter, activeLetterFor } from '../store/alphabetIndex.js';
import { indexAtY, railBounds, railTopOffset, effectiveZoom } from '../store/railGeometry.js';
import { resolveScrollRoot } from '../store/collectionAllModel.js';
import { initialRailState, railReducer, shouldCommit } from './alphabetRailState.js';

const RADIUS = 88;        // wave falloff radius (px) around the touch point - wide so many letters swell
const MAX_SCALE = 3.4;    // centre label scale at the touch point - a big, dramatic bulge
const SHIFT = 30;         // max inward push (px) of the centre label - the wave fans OUT from under the finger
const LOOKAHEAD = 60;     // render a little past the target so the landing has context
const PRIMARY_MOUSE = 0;  // left button
const RAIL_WIDTH = 44;    // capture strip width - a real thumb target; letters hug the screen edge inside it
const LETTER = 12;        // base letter size (px); the ACTIVE letter is drawn much larger at rest
const ACTIVE_LETTER = 22; // the letter we are "up to" reads big even without a drag
const SETTLE = 'transform .18s ease';                       // release ease - letters glide home, not snap
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
  const labelRefs = useRef([]);          // per-letter DOM nodes, for direct transform writes (no re-render)
  const stripRef = useRef(null);         // the continuous capture strip
  const reqRef = useRef(0);              // monotonic pick requestId
  const rafRef = useRef(0);              // wave rAF handle
  const pendingYRef = useRef(null);      // latest pointer Y awaiting a wave frame
  const teardownRef = useRef(null);      // live gesture's cleanup (window listeners + capture release)
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
      setBounds({ top: b.top / zoom, bottom: b.bottom / zoom });
    };
    let raf = requestAnimationFrame(compute);   // measure after paint (dock/keyboard settled)
    const late = setTimeout(compute, 480);      // after fabRiseIn (.4s) - the stacked FAB's true rest position
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute); };
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(late);
      window.removeEventListener('resize', onResize);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize);
    };
  }, [headerHeight, selecting]);

  // ---- Gesture: strip-only pointer target; window-level move/up; event-driven rAF wave --------------
  const applyWave = useCallback((y) => {
    const strip = stripRef.current;
    if (!strip) return;
    const rect = strip.getBoundingClientRect();
    const reduce = typeof document !== 'undefined' && document.body.classList.contains('reduce-motion');
    const dir = side === 'left' ? 1 : -1;                      // bulge pushes INWARD, away from the edge
    for (let i = 0; i < order.length; i += 1) {
      const el = labelRefs.current[i];
      if (!el) continue;
      const centre = rect.top + (i + 0.5) * (rect.height / order.length);
      const scale = reduce ? 1 : bulge(y - centre, RADIUS, MAX_SCALE);
      if (el.style.transition) el.style.transition = '';       // per-frame writes must not tween
      el.style.transform = scale === 1 ? ''
        : `translateX(${(dir * SHIFT * (scale - 1) / (MAX_SCALE - 1)).toFixed(1)}px) scale(${scale.toFixed(3)})`;
    }
  }, [order.length, side]);

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

  // Latest-frame ref: rAF and the per-gesture listeners always run the CURRENT frame closure, while
  // schedule/endGesture stay identity-stable for the whole component lifetime (no teardown churn).
  const frameRef = useRef(frame);
  useLayoutEffect(() => { frameRef.current = frame; });
  const runFrame = useCallback(() => { frameRef.current(); }, []);

  const schedule = useCallback((y) => {
    pendingYRef.current = y;
    if (!rafRef.current) rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const endGesture = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      if (pendingYRef.current != null) frameRef.current();     // flush: the release point still picks
    }
    pendingYRef.current = null;
    if (teardownRef.current) teardownRef.current();            // window listeners + capture release
    for (const l of labelRefs.current) {
      if (l && l.style.transform) { l.style.transition = SETTLE; l.style.transform = ''; }   // glide home
    }
  }, []);

  const onPointerDown = (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== PRIMARY_MOUSE)) return;
    if (teardownRef.current) return;                           // one gesture at a time
    const id = e.pointerId;
    const strip = e.currentTarget;
    try { strip.setPointerCapture(id); } catch { /* capture is a bonus - window listeners carry the drag */ }
    const onMove = (ev) => { if (ev.pointerId === id) schedule(ev.clientY); };
    const onEnd = (ev) => { if (ev.pointerId === id) endGesture(); };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onEnd, { passive: true });
    window.addEventListener('pointercancel', onEnd, { passive: true });
    teardownRef.current = () => {
      teardownRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      try { if (strip.hasPointerCapture && strip.hasPointerCapture(id)) strip.releasePointerCapture(id); } catch { /* noop */ }
    };
    e.preventDefault();
    lastPickRef.current = null;                // a fresh gesture may re-pick the same letter
    schedule(e.clientY);                       // a bare tap (no move) still schedules a pick immediately
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
            <button key={l} ref={(n) => { labelRefs.current[i] = n; }} type="button"
              disabled={!on} aria-hidden={!on} tabIndex={on && (active === l || (!active && l === firstPresent(present))) ? 0 : -1}
              aria-current={active === l ? 'true' : undefined}
              onClick={on ? () => { setActive(l); pick(l); } : undefined}
              style={{ all: 'unset', fontFamily: 'var(--f-display)', fontWeight: active === l ? 800 : 600,
                fontSize: active === l ? ACTIVE_LETTER : LETTER, lineHeight: 1, letterSpacing: '.03em',
                color: on ? (active === l ? 'var(--gold-num)' : 'var(--ink-muted)') : 'var(--ink-faint)',
                textShadow: active === l ? '0 0 14px rgba(203,167,95,.45)' : 'none',
                opacity: on ? 1 : 0.28, transformOrigin: side === 'left' ? 'left center' : 'right center',
                pointerEvents: 'none', willChange: 'transform' }}>
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
