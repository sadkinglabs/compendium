import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardFallbackArt } from '../store/cardArt.js';
import { useArtSource } from './ArtImage.jsx';
import { registerBackConsumer } from '../back.js';
import { setImmersive } from '../native.js';

// Full-screen card display. Tapping the art in a card sheet POPS the card out of the sheet onto its
// own stage, where dragging a finger tilts it in 3D over a cast shadow and a foil printing catches a
// holographic sheen. Closing animates it back into the sheet's frame.
//
// Motion (both finishes): a SINGLE requestAnimationFrame spring loop lerps six values from their
// targets and writes them as CSS variables. Pointer down/move sets targets and tracks tightly
// (k=0.3); on release the loop eases (k=0.05) into a slow lissajous IDLE DRIFT, so the card is always
// gently alive and glides back toward centre without any CSS keyframes or transitions. The gyroscope
// parallax this view used to have was dropped - it read janky, and finger tracking is the interaction.
//
// Foil (foil printings only): Layer 1 is a color-dodge rainbow sheet that only ignites where the
// artwork is bright (highlights, metallics, lightning) - the crush comes from brightness(.26+hyp*.26)
// contrast(3) saturate(1.45), and it slides OPPOSITE the pointer (--px/--py = 100-mx/my) so the
// counter-motion reads as refraction. Layer 2 is an overlay glare hotspot that follows the pointer -
// the lacquer - and applies to BOTH finishes. Global foil intensity is --o x 0.55.
//
// Platform notes (DESIGN_SYSTEM.md §6):
//  - Two transform layers, deliberately separated: the OUTER layer runs the pop (translate + scale
//    between the sheet's frame and the stage), the INNER layer runs the tilt + foil. Composing both on
//    one element made the pop fight the tilt mid-flight.
//  - The scrim animates opacity only; neither element scrolls, so the transform-plus-scroller WebView
//    rule is not in play. `isolation: isolate` on the tilt layer keeps the blend modes off the page.
//  - Zero-image safe: with art suppressed there is no <img>, so the foil/glare layers do not render
//    (they must never ignite over the deterministic gradient); the fallback fills the stage.
//  - Reduced motion: no tilt, no drift, no glare; a foil card shows a STATIC low-key sheen so it still
//    reads as special. The name's glimmer is neutralised globally by body.reduce-motion.
//  - Immersive: the Android status bar is hidden on entry and restored on exit.

const POP_MS = 340;
const TILT = 15;      // degrees at full deflection
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function CardArtViewer({ card, foil = false, origin, onClose }) {
  const reduce = typeof document !== 'undefined' && document.body.classList.contains('reduce-motion');
  const [flipT, setFlipT] = useState(null);   // transform that maps the stage back onto the sheet frame
  const [armed, setArmed] = useState(false);  // transitions enabled (skipped on the first frame)
  const [open, setOpen] = useState(false);
  const cardRef = useRef(null);      // pop layer
  const tiltRef = useRef(null);      // tilt + foil layer (the CSS-var target)
  const shadowRef = useRef(null);
  const rootRef = useRef(null);
  const closeBtnRef = useRef(null);
  const restoreRef = useRef(null);
  const closing = useRef(false);

  // Hide the status bar for the duration - this is a full-bleed, immersive moment.
  useEffect(() => { setImmersive(true); return () => { setImmersive(false); }; }, []);

  // A real modal boundary: take focus, hold it, give it back. Without this a keyboard or
  // switch-control user keeps tabbing through the sheet behind the viewer.
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

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    if (reduce || !flipT) { onClose(); return; }
    setOpen(false);                       // animate back into the sheet's frame
    setTimeout(onClose, POP_MS);
  };

  // Hardware back / Escape close the viewer BEFORE the sheet underneath it.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => registerBackConsumer(() => { closeRef.current(); return true; }), []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // FLIP: measure the stage, then express it as the sheet frame we came from.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !origin || reduce) { setOpen(true); setArmed(true); return; }
    const f = el.getBoundingClientRect();
    if (!f.width || !origin.w) { setOpen(true); setArmed(true); return; }
    const s = origin.w / f.width;
    const dx = (origin.x + origin.w / 2) - (f.left + f.width / 2);
    const dy = (origin.y + origin.h / 2) - (f.top + f.height / 2);
    setFlipT(`translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(4)})`);
  }, [origin, reduce]);

  // Release on the next frame so the browser has painted the start position first.
  useEffect(() => {
    if (!flipT || open) return;
    const r = requestAnimationFrame(() => { setArmed(true); setOpen(true); });
    return () => cancelAnimationFrame(r);
  }, [flipT, open]);

  // THE MOTION LOOP. One rAF for the single card on stage: spring each value toward its target and
  // write the CSS variables. Values are refs, never state, so this never triggers a React render.
  const vals = useRef({
    rx: { c: 0, t: 0 }, ry: { c: 0, t: 0 }, mx: { c: 50, t: 50 },
    my: { c: 50, t: 50 }, o: { c: 0, t: 0 }, hyp: { c: 0, t: 0 },
  });
  const active = useRef(false);
  useEffect(() => {
    if (reduce) return undefined;   // static sheen instead - see the reduced-motion effect below
    let running = true;
    const seed = 1.7;
    const loop = () => {
      if (!running) return;
      const v = vals.current;
      if (!active.current) {
        // Idle lissajous drift - different x/y frequencies (.5 vs .65) wander instead of circling.
        const now = performance.now() / 1000;
        v.rx.t = Math.sin(now * 0.65 + seed) * 6;
        v.ry.t = Math.cos(now * 0.5 + seed) * 8;
        v.mx.t = 50 + Math.cos(now * 0.5 + seed) * 30;
        v.my.t = 50 + Math.sin(now * 0.65 + seed) * 30;
        v.o.t = 0.8;
        v.hyp.t = 0.45 + 0.25 * Math.sin(now * 0.6 + seed);
      }
      const k = active.current ? 0.3 : 0.05;   // tight while tracking, soft glide on release
      for (const key of ['rx', 'ry', 'mx', 'my', 'o', 'hyp']) {
        const p = v[key];
        p.c += (p.t - p.c) * k;
      }
      const el = tiltRef.current;
      if (el) {
        el.style.setProperty('--rx', `${v.rx.c.toFixed(2)}deg`);
        el.style.setProperty('--ry', `${v.ry.c.toFixed(2)}deg`);
        el.style.setProperty('--mx', `${v.mx.c.toFixed(2)}%`);
        el.style.setProperty('--my', `${v.my.c.toFixed(2)}%`);
        el.style.setProperty('--px', `${(100 - v.mx.c).toFixed(2)}%`);   // foil sheet moves OPPOSITE
        el.style.setProperty('--py', `${(100 - v.my.c).toFixed(2)}%`);
        el.style.setProperty('--o', (v.o.c * 0.55).toFixed(3));          // global foil intensity
        el.style.setProperty('--hyp', v.hyp.c.toFixed(3));
      }
      const sh = shadowRef.current;
      if (sh) sh.style.transform = `translate(${(-v.ry.c / TILT * 14).toFixed(1)}px, ${(v.rx.c / TILT * 6).toFixed(1)}px)`;
      requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(id); };
  }, [reduce]);

  // Pointer (touch + mouse). Position → tilt + light targets; the loop springs toward them.
  const onPointer = (e) => {
    if (reduce) return;
    const el = tiltRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = clamp((e.clientX - r.left) / r.width * 100, 0, 100);
    const py = clamp((e.clientY - r.top) / r.height * 100, 0, 100);
    const v = vals.current;
    active.current = true;
    v.ry.t = (px - 50) / 50 * TILT;
    v.rx.t = -(py - 50) / 50 * TILT;
    v.mx.t = px; v.my.t = py; v.o.t = 1;
    v.hyp.t = Math.min(1, Math.hypot(px - 50, py - 50) / 50);
  };
  const release = () => { active.current = false; };   // loop eases back into the idle drift

  const { src, gen, onError } = useArtSource(card?.image_slug || null);
  const site = !!card?.is_site;
  const artist = card?._artist || null;
  const popT = open ? 'none' : (flipT || 'scale(.94)');
  const showFx = !!src;   // no foil/glare over the deterministic fallback (zero-image safe)

  // Reduced motion: no loop runs, so seed a STATIC low-key foil sheen through the same variables
  // (set on the ref to avoid custom-property keys in the JSX style). Non-foil rests with nothing extra.
  useEffect(() => {
    if (!reduce || !foil || !showFx) return;
    const el = tiltRef.current; if (!el) return;
    const set = (k, val) => el.style.setProperty(k, val);
    set('--o', '0.28'); set('--hyp', '0.32'); set('--px', '46%'); set('--py', '54%'); set('--mx', '50%'); set('--my', '50%');
  }, [reduce, foil, showFx]);

  return createPortal(
    <div
      ref={rootRef}
      role="dialog" aria-modal="true" aria-label={`${card?.name || 'Card'} artwork`}
      style={{
        position: 'fixed', inset: 0, zIndex: 900, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 26, padding: 20,
        background: 'rgba(6,4,3,.94)', opacity: open ? 1 : 0, transition: `opacity ${POP_MS}ms ease`,
        perspective: 1100, WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* pop layer */}
      <div ref={cardRef}
        style={{
          position: 'relative', width: 'min(88vw, 420px)', aspectRatio: site ? '531 / 380' : '5 / 7',
          transform: popT, transition: armed ? `transform ${POP_MS}ms cubic-bezier(.2,.9,.3,1)` : 'none',
          transformStyle: 'preserve-3d',
        }}>
        {/* cast shadow - sits BEHIND and below, and slides opposite the tilt so the card reads as
            lifted off the backdrop rather than pasted to it. Driven by the loop (shadowRef). */}
        <span ref={shadowRef} aria-hidden="true" style={{
          position: 'absolute', left: '6%', right: '6%', bottom: -26, height: 42, borderRadius: '50%',
          background: 'radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,.75), transparent 72%)',
          filter: 'blur(14px)',
        }} />
        {/* tilt + foil layer - the CSS-var target */}
        <div ref={tiltRef} onPointerMove={onPointer} onPointerDown={onPointer}
          onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
          style={{
            position: 'absolute', inset: 0, borderRadius: 14, overflow: 'hidden', isolation: 'isolate',
            background: cardFallbackArt(card), border: '1px solid rgba(203,167,95,.45)',
            boxShadow: '0 34px 60px -18px rgba(0,0,0,.9), 0 6px 18px rgba(0,0,0,.6)',
            transform: 'rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))',
            touchAction: 'none', WebkitTapHighlightColor: 'transparent',
          }}>
          {/* Self-removing on error, matching CardArt. The deterministic fallback is already painted
              on this layer's background; without this a 404 renders a broken image ON TOP of it. */}
          {src && (
            <img key={gen} src={src} alt={card?.name || ''} draggable="false" onError={onError}
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
              backgroundSize: '250% 250%',
              backgroundPosition: 'var(--px, 50%) var(--py, 50%)',
              filter: 'brightness(calc(.26 + var(--hyp, 0) * .26)) contrast(3) saturate(1.45)',
            }} />
          )}

          {/* LAYER 2 - glare pass (both finishes): a bright hotspot that follows the pointer, fading to
              a dark far-corner vignette. Static under reduced motion, so it is skipped there. */}
          {showFx && !reduce && (
            <span aria-hidden="true" style={{
              position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none',
              mixBlendMode: 'overlay', opacity: 'var(--o, 0)',
              background: 'radial-gradient(farthest-corner circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,.6) 5%, rgba(255,255,255,.15) 32%, rgba(0,0,0,.5) 92%)',
            }} />
          )}
        </div>
      </div>

      <div style={{ textAlign: 'center', maxWidth: '82vw', opacity: open ? 1 : 0, transition: `opacity ${POP_MS}ms ease` }}>
        <div className="cx-glimmer" style={{
          font: "600 16px/1.3 var(--f-display)", letterSpacing: '.14em', textTransform: 'uppercase',
        }}>
          {card?.name}
        </div>
        {artist && (
          <div style={{ font: "italic 400 12.5px/1.4 var(--f-read)", color: 'var(--ink-muted)', marginTop: 7 }}>
            Art by {artist}
          </div>
        )}
      </div>

      {/* The X is the only on-screen way out - the backdrop is inert so you can tilt and study the
          card without dismissing it by accident. Hardware back still works. */}
      <button ref={closeBtnRef} type="button" onClick={close} aria-label="Close artwork"
        style={{
          position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 14px)', right: 16, zIndex: 2,
          width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',   // >=44px touch floor
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(20,15,10,.7)', border: '1px solid var(--hair-30)', color: 'var(--gold-leaf)',
          opacity: open ? 1 : 0, transition: `opacity ${POP_MS}ms ease`,
        }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>,
    document.body,
  );
}
