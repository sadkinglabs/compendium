import React, { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardFallbackArt } from '../store/cardArt.js';
import { useArtSource } from './ArtImage.jsx';
import { registerBackConsumer } from '../back.js';
import { setImmersive } from '../native.js';
import { viewerTransition, initialViewerState } from './cardArtViewerPhase.js';

// Full-screen card display. Tapping the art in a card sheet POPS the card out of the sheet onto its
// own stage, where dragging a finger tilts it in 3D over a cast shadow and a foil printing catches a
// holographic sheen. One explicit visual phase (cardArtViewerPhase.js) drives the whole entrance and
// exit - preparing → entering → open → exiting → closed - so nothing can reopen the viewer mid-exit.
//
// Entrance/exit (one step, no stagger): every value below is derived from `phase` in a single render
// - root fade, card transform, caption and controls all change together. FLIP continuity is kept when
// an origin frame is known; otherwise a centred .94 → 1 scale. The enter is soft and slightly long,
// the exit crisp and quick, and it begins the instant the X is pressed. Reduced motion opens and
// closes immediately.
//
// Motion (both finishes): a SINGLE requestAnimationFrame spring loop lerps six values toward
// pointer-driven targets (k=0.3 tracking) and, on release, eases (k=0.14) into a slow lissajous idle
// drift. The idle drift runs ONLY at phase 'open', held neutral during the entrance/exit so the inner
// card never starts a second movement over the outer entrance.
//
// Input (Codex's architecture): pointer capture lives on the fixed, untransformed ROOT - hit-testing
// against the rotating tilt element was unreliable on Android WebView. The flat cardRef rectangle is
// only a geometric admission boundary; the whole 3D subtree is pointerEvents:none. The close button
// captures its OWN pointer and stops propagation, so it is immune to the card-drag logic and the X
// never starts a drag.
//
// Foil (foil printings only): Layer 1 color-dodge rainbow ignites on the artwork's highlights and
// slides OPPOSITE the pointer; Layer 2 overlay glare hotspot follows the pointer (both finishes).
// Intensity --o x 0.6. isolation:isolate keeps the blend modes off the page. Zero-image safe: no
// <img> ⇒ no foil/glare over the deterministic fallback.

const ENTER_MS = 300, EXIT_MS = 180;
const ENTER_EASE = 'cubic-bezier(.16,1,.3,1)';
const EXIT_EASE = 'cubic-bezier(.4,0,1,1)';
const IDENTITY = 'translate3d(0,0,0) scale(1)';   // interpolable identity, never transform:none
const TILT = 12.4;           // max rotation at full deflection (gentler than the original 15)
const HYP_MAX = 0.75;        // cap the foil's deflection peak - hyp (not TILT) drives brightness, so
                             // this is what keeps a hard tilt from looking burnt, independent of TILT.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function CardArtViewer({ card, foil = false, origin, onClose }) {
  const reduce = typeof document !== 'undefined' && document.body.classList.contains('reduce-motion');
  const [state, dispatch] = useReducer(viewerTransition, reduce, initialViewerState);
  const phase = state.phase;
  const [flipT, setFlipT] = useState(null);      // FLIP origin transform, or null (no origin ⇒ scale fallback)
  const [closePressed, setClosePressed] = useState(false);

  const cardRef = useRef(null);      // pop layer (flat, untransformed at rest) - admission + mapping rect
  const tiltRef = useRef(null);      // tilt + foil layer (the CSS-var target)
  const shadowRef = useRef(null);
  const rootRef = useRef(null);
  const closeBtnRef = useRef(null);
  const restoreRef = useRef(null);
  const active = useRef(false);      // a pointer drag is tracking
  const dragId = useRef(null);       // the captured pointer id for the active drag, or null
  const closeRequested = useRef(false);   // close is one-way; guard a double onClose under reduced motion
  const closePointerId = useRef(null);    // the pointer that began on the X, so only it can close
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Release the captured pointer AND clear drag state at ONE boundary, so hardware Back/Escape during a
  // drag never leaves the root holding the pointer. Both requestClose and ordinary drag completion use it.
  const stopDrag = () => {
    const id = dragId.current;
    dragId.current = null;
    active.current = false;
    if (id != null) {
      try { if (rootRef.current?.hasPointerCapture?.(id)) rootRef.current.releasePointerCapture(id); } catch { /* noop */ }
    }
  };

  // Hide the status bar for the duration - this is a full-bleed, immersive moment.
  useEffect(() => { setImmersive(true); return () => { setImmersive(false); }; }, []);

  // A real modal boundary: take focus, hold it, give it back.
  useEffect(() => {
    restoreRef.current = document.activeElement;
    closeBtnRef.current?.focus();
    const me = rootRef.current;
    const outside = [...document.body.children].filter((el) => el !== me);
    outside.forEach((el) => { el.setAttribute('aria-hidden', 'true'); el.setAttribute('inert', ''); });
    return () => {
      outside.forEach((el) => { el.removeAttribute('aria-hidden'); el.removeAttribute('inert'); });
      try { restoreRef.current?.focus?.(); } catch { /* origin may be gone */ }
    };
  }, []);

  // Contain Tab within the viewer.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const root = rootRef.current; if (!root) return;
      const f = [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.hasAttribute('disabled'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // ---- Phase plumbing ------------------------------------------------------------------------------

  // FLIP: measure the stage, express it as the sheet frame we came from. Only when an origin exists;
  // no origin leaves flipT null and the entrance/exit fall back to a centred scale.
  useLayoutEffect(() => {
    if (reduce || !origin) return;
    const el = cardRef.current; if (!el) return;
    const f = el.getBoundingClientRect();
    // Scale from the UNTRANSFORMED layout width - during `preparing` the card renders at scale(.94),
    // and getBoundingClientRect() includes that, which would inflate the origin scale ~6.4%. The rect
    // CENTRE is still correct because the transform origin is centred.
    const layoutWidth = el.offsetWidth;
    if (!layoutWidth || !origin.w) return;
    const s = origin.w / layoutWidth;
    const dx = (origin.x + origin.w / 2) - (f.left + f.width / 2);
    const dy = (origin.y + origin.h / 2) - (f.top + f.height / 2);
    setFlipT(`translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(4)})`);
  }, [origin, reduce]);

  // Begin the entrance on the frame AFTER `preparing` has painted at its start transform, so the
  // browser has a start position to animate FROM.
  useEffect(() => {
    if (reduce || phase !== 'preparing') return undefined;
    const id = requestAnimationFrame(() => dispatch({ type: 'PREPARED', transform: flipT }));
    return () => cancelAnimationFrame(id);
  }, [phase, flipT, reduce]);

  // The entrance/exit transition finishing advances the phase. transitionend is filtered to the card's
  // own transform; a short fallback timer covers a dropped event. Both are idempotent via the reducer.
  const onCardTransitionEnd = (e) => {
    if (e.target !== cardRef.current || e.propertyName !== 'transform') return;
    if (phase === 'entering') dispatch({ type: 'ENTERED' });
    else if (phase === 'exiting') dispatch({ type: 'EXITED' });
  };
  useEffect(() => {
    if (phase === 'entering') { const id = setTimeout(() => dispatch({ type: 'ENTERED' }), ENTER_MS + 90); return () => clearTimeout(id); }
    if (phase === 'exiting') { const id = setTimeout(() => dispatch({ type: 'EXITED' }), EXIT_MS + 90); return () => clearTimeout(id); }
    return undefined;
  }, [phase]);

  // Unmount once the exit has fully played.
  useEffect(() => { if (phase === 'closed') onCloseRef.current(); }, [phase]);

  // The one way out. Terminates any in-flight drag, then heads to exiting (or straight out under
  // reduced motion). Idempotent - the reducer ignores a repeat CLOSE.
  const requestClose = () => {
    if (closeRequested.current) return;   // one-way; stops a reduced-motion pointer-up + click double onClose
    closeRequested.current = true;
    stopDrag();                           // clear state AND release any held capture
    if (reduce) { onCloseRef.current(); return; }
    dispatch({ type: 'CLOSE' });
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => registerBackConsumer(() => { requestCloseRef.current(); return true; }), []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ---- Motion loop ---------------------------------------------------------------------------------

  const vals = useRef({
    rx: { c: 0, t: 0 }, ry: { c: 0, t: 0 }, mx: { c: 50, t: 50 },
    my: { c: 50, t: 50 }, o: { c: 0, t: 0 }, hyp: { c: 0, t: 0 },
  });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (reduce) return undefined;   // static sheen instead - see the reduced-motion effect below
    let running = true;
    const seed = 1.7;
    const loop = () => {
      if (!running) return;
      const v = vals.current;
      if (phaseRef.current !== 'open') {
        // Held neutral through the entrance/exit so the inner card does not move under the outer pop.
        v.rx.t = 0; v.ry.t = 0; v.mx.t = 50; v.my.t = 50; v.o.t = 0; v.hyp.t = 0;
      } else if (!active.current) {
        // Idle lissajous drift - a gentle breath at rest, different x/y frequencies wander not circle.
        const now = performance.now() / 1000;
        v.rx.t = Math.sin(now * 0.65 + seed) * 3;
        v.ry.t = Math.cos(now * 0.5 + seed) * 4;
        v.mx.t = 50 + Math.cos(now * 0.5 + seed) * 16;
        v.my.t = 50 + Math.sin(now * 0.65 + seed) * 16;
        v.o.t = 0.8;
        v.hyp.t = 0.4 + 0.12 * Math.sin(now * 0.6 + seed);
      }
      const k = active.current ? 0.3 : 0.14;
      for (const key of ['rx', 'ry', 'mx', 'my', 'o', 'hyp']) { const p = v[key]; p.c += (p.t - p.c) * k; }
      const el = tiltRef.current;
      if (el) {
        el.style.setProperty('--rx', `${v.rx.c.toFixed(2)}deg`);
        el.style.setProperty('--ry', `${v.ry.c.toFixed(2)}deg`);
        el.style.setProperty('--mx', `${v.mx.c.toFixed(2)}%`);
        el.style.setProperty('--my', `${v.my.c.toFixed(2)}%`);
        el.style.setProperty('--px', `${(100 - v.mx.c).toFixed(2)}%`);   // foil sheet moves OPPOSITE
        el.style.setProperty('--py', `${(100 - v.my.c).toFixed(2)}%`);
        el.style.setProperty('--o', (v.o.c * 0.6).toFixed(3));           // global foil intensity
        el.style.setProperty('--hyp', v.hyp.c.toFixed(3));
      }
      const sh = shadowRef.current;
      if (sh) sh.style.transform = `translate(${(-v.ry.c / TILT * 14).toFixed(1)}px, ${(v.rx.c / TILT * 6).toFixed(1)}px)`;
      requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(id); };
  }, [reduce]);

  // ---- Drag input (on the untransformed root) ------------------------------------------------------

  const updatePointer = (e) => {
    const r = cardRef.current?.getBoundingClientRect();
    if (!r?.width || !r?.height) return;
    const px = clamp((e.clientX - r.left) / r.width * 100, 0, 100);
    const py = clamp((e.clientY - r.top) / r.height * 100, 0, 100);
    const v = vals.current;
    active.current = true;
    v.ry.t = (px - 50) / 50 * TILT;
    v.rx.t = -(py - 50) / 50 * TILT;
    v.mx.t = px; v.my.t = py; v.o.t = 1;
    v.hyp.t = Math.min(1, Math.hypot(px - 50, py - 50) / 50) * HYP_MAX;
  };
  const onStageDown = (e) => {
    if (reduce || phase !== 'open' || !e.isPrimary) return;
    if (closeBtnRef.current?.contains(e.target)) return;       // the X owns its own taps
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const r = cardRef.current?.getBoundingClientRect();
    if (!r) return;
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) return;                                        // taps off the card pass through
    e.preventDefault();
    dragId.current = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not all pointers are capturable */ }
    updatePointer(e);
  };
  const onStageMove = (e) => { if (dragId.current === e.pointerId) updatePointer(e); };
  const finishDrag = (e) => {
    if (dragId.current !== e.pointerId) return;
    stopDrag();
  };

  // ---- Close button (captures its own pointer, immune to the drag logic) ---------------------------

  const closePointerDown = (e) => {
    e.stopPropagation();
    if (!e.isPrimary) return;
    closePointerId.current = e.pointerId;   // remember which pointer began on the X
    setClosePressed(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const closePointerUp = (e) => {
    e.stopPropagation();
    if (closePointerId.current !== e.pointerId) return;   // only the pointer that began on the X closes
    closePointerId.current = null;
    setClosePressed(false);
    requestClose();
  };
  const closePointerCancel = (e) => {
    e.stopPropagation();
    if (closePointerId.current === e.pointerId) closePointerId.current = null;
    setClosePressed(false);
  };

  // ---- Render --------------------------------------------------------------------------------------

  const { src, gen, onError } = useArtSource(card?.image_slug || null);
  const site = !!card?.is_site;
  const artist = card?._artist || null;
  // Effects gate on the DECODED candidate identity {src, gen}, NOT URL availability: a URL can be
  // present while the image is still loading, corrupt, or advancing through failed candidates, with the
  // deterministic gradient still showing underneath - foil/glare must never ignite over the fallback.
  // Matching gen too returns to fallback-only on a quarantine re-resolve to the same URI.
  const [decoded, setDecoded] = useState({ src: null, gen: -1 });
  const showFx = !!src && decoded.src === src && decoded.gen === gen;

  // Reduced motion: no loop, so seed a STATIC low-key foil sheen on the ref. Non-foil rests plain.
  useEffect(() => {
    if (!reduce || !foil || !showFx) return;
    const el = tiltRef.current; if (!el) return;
    const set = (k, val) => el.style.setProperty(k, val);
    set('--o', '0.3'); set('--hyp', '0.32'); set('--px', '46%'); set('--py', '54%'); set('--mx', '50%'); set('--my', '50%');
  }, [reduce, foil, showFx]);

  // Everything below is derived from `phase` in ONE render - no stagger.
  const shown = phase === 'entering' || phase === 'open';
  const dur = phase === 'exiting' ? EXIT_MS : ENTER_MS;
  const ease = phase === 'exiting' ? EXIT_EASE : ENTER_EASE;
  const fade = phase === 'preparing' ? 'none' : `opacity ${dur}ms ${ease}`;
  const cardTransition = phase === 'preparing' ? 'none' : `transform ${dur}ms ${ease}, opacity ${dur}ms ${ease}`;
  const cardTransform = shown ? IDENTITY : (phase === 'exiting' ? (flipT || 'scale(.96)') : (flipT || 'scale(.94)'));
  const cardOpacity = shown ? 1 : (phase === 'exiting' ? 0.55 : 0.65);
  const rootOpacity = shown ? 1 : 0;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog" aria-modal="true" aria-label={`${card?.name || 'Card'} artwork`}
      onPointerDown={onStageDown} onPointerMove={onStageMove}
      onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
      style={{
        position: 'fixed', inset: 0, zIndex: 900, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 26, padding: 20,
        background: 'rgba(6,4,3,.94)', opacity: rootOpacity, transition: fade,
        perspective: 1100, WebkitTapHighlightColor: 'transparent', touchAction: 'none',
      }}
    >
      {/* pop layer - the entrance/exit envelope + FLIP. Flat and pointer-inert so the drag capture on
          the root never depends on this transforming element. */}
      <div ref={cardRef} onTransitionEnd={onCardTransitionEnd}
        style={{
          position: 'relative', width: 'min(88vw, 420px)', aspectRatio: site ? '531 / 380' : '5 / 7',
          transform: cardTransform, opacity: cardOpacity, transition: cardTransition,
          transformStyle: 'preserve-3d', pointerEvents: 'none',
        }}>
        {/* cast shadow - driven by the loop (shadowRef); slides opposite the tilt. */}
        <span ref={shadowRef} aria-hidden="true" style={{
          position: 'absolute', left: '6%', right: '6%', bottom: -26, height: 42, borderRadius: '50%',
          background: 'radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,.75), transparent 72%)', filter: 'blur(14px)',
        }} />
        {/* tilt + foil layer - the CSS-var target */}
        <div ref={tiltRef}
          style={{
            position: 'absolute', inset: 0, borderRadius: 14, overflow: 'hidden', isolation: 'isolate',
            background: cardFallbackArt(card), border: '1px solid rgba(203,167,95,.45)',
            boxShadow: '0 34px 60px -18px rgba(0,0,0,.9), 0 6px 18px rgba(0,0,0,.6)',
            transform: 'rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))',
          }}>
          {src && (
            <img key={gen} src={src} alt={card?.name || ''} draggable="false"
              onLoad={() => setDecoded({ src, gen })}
              onError={(e) => { setDecoded({ src: null, gen: -1 }); onError(e); }}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                ...(site ? { width: 'calc(100% * 380 / 531)', height: 'calc(100% * 531 / 380)', top: '50%', left: '50%', inset: 'auto', transform: 'translate(-50%,-50%) rotate(90deg)' } : {}),
              }} />
          )}

          {/* LAYER 1 - foil sheet (foil printings only): highlight-biased rainbow via color-dodge. */}
          {foil && showFx && (
            <span aria-hidden="true" style={{
              position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none',
              mixBlendMode: 'color-dodge', opacity: 'var(--o, 0)',
              background: 'repeating-linear-gradient(115deg, #ff8a8a 0%, #ffd08a 8%, #8aff9e 16%, #8ad9ff 24%, #b18aff 32%, #ff8ae2 40%, #ff8a8a 48%)',
              backgroundSize: '250% 250%', backgroundPosition: 'var(--px, 50%) var(--py, 50%)',
              filter: 'brightness(calc(.26 + var(--hyp, 0) * .26)) contrast(3) saturate(1.45)',
            }} />
          )}
          {/* LAYER 2 - glare (both finishes): a bright hotspot following the pointer. Skipped under
              reduced motion (static). */}
          {showFx && !reduce && (
            <span aria-hidden="true" style={{
              position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none',
              mixBlendMode: 'overlay', opacity: 'var(--o, 0)',
              background: 'radial-gradient(farthest-corner circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,.6) 5%, rgba(255,255,255,.15) 32%, rgba(0,0,0,.5) 92%)',
            }} />
          )}
        </div>
      </div>

      <div style={{ textAlign: 'center', maxWidth: '82vw', opacity: rootOpacity, transition: fade }}>
        <div className="cx-glimmer" style={{ font: "600 16px/1.3 var(--f-display)", letterSpacing: '.14em', textTransform: 'uppercase' }}>
          {card?.name}
        </div>
        {artist && (
          <div style={{ font: "italic 400 12.5px/1.4 var(--f-read)", color: 'var(--ink-muted)', marginTop: 7 }}>
            Art by {artist}
          </div>
        )}
      </div>

      {/* The X captures its OWN pointer and stops propagation, so it is immune to the card-drag logic
          and gives an immediate down-state. Hardware back / Escape route through the same requestClose. */}
      <button ref={closeBtnRef} type="button"
        onPointerDown={closePointerDown} onPointerUp={closePointerUp}
        onPointerCancel={closePointerCancel} onLostPointerCapture={closePointerCancel}
        onClick={requestClose} aria-label="Close artwork"
        style={{
          position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 14px)', right: 16, zIndex: 2,
          width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',   // >=44px touch floor
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none',
          transform: closePressed ? 'scale(.88)' : 'scale(1)',
          background: closePressed ? 'rgba(55,38,18,.92)' : 'rgba(20,15,10,.7)',
          border: '1px solid var(--hair-30)', color: 'var(--gold-leaf)',
          opacity: rootOpacity,
          transition: 'transform 80ms ease-out, background 80ms ease-out, opacity 180ms ease',
        }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>,
    document.body,
  );
}
