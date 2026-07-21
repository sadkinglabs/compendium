import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardImageUrl, cardFallbackArt } from '../store/cardArt.js';
import { registerBackConsumer } from '../back.js';
import { setImmersive } from '../native.js';

// Full-screen card display. Tapping the art in a card sheet POPS the card out of the sheet
// onto its own stage, where tilting the phone parallaxes it in 3D over a cast shadow. Closing
// animates it back into the sheet's frame.
//
// Platform notes (DESIGN_SYSTEM.md §6):
//  - Two transform layers, deliberately separated: the OUTER layer runs the pop (translate +
//    scale between the sheet's frame and the stage), the INNER layer runs the tilt. Composing
//    both on one element made the pop fight the gyro mid-flight.
//  - The scrim animates opacity only; neither element scrolls, so the transform-plus-scroller
//    WebView rule is not in play. No blend modes, no backdrop-filter.
//  - Zero-image safe: with art suppressed the deterministic gradient fallback fills the stage.
//  - Reduced motion: no tilt, no pop (the card simply appears), and the name's glimmer is
//    neutralised globally by body.reduce-motion.
//  - Immersive: the Android status bar is hidden on entry and restored on exit.

const MAX_TILT = 14;      // degrees at full deflection
const TILT_RANGE = 26;    // degrees of device rotation mapped to full deflection
const POP_MS = 340;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function CardArtViewer({ card, origin, onClose }) {
  const reduce = typeof document !== 'undefined' && document.body.classList.contains('reduce-motion');
  const [tilt, setTilt] = useState({ x: 0, y: 0, gx: 50, gy: 50, active: false });
  const [broken, setBroken] = useState(false);   // a failed image must reveal the fallback, not cover it
  const [flipT, setFlipT] = useState(null);   // transform that maps the stage back onto the sheet frame
  const [armed, setArmed] = useState(false);  // transitions enabled (skipped on the first frame)
  const [open, setOpen] = useState(false);
  const cardRef = useRef(null);
  const rootRef = useRef(null);
  const closeBtnRef = useRef(null);
  const restoreRef = useRef(null);
  const gyroSeen = useRef(false);
  const closing = useRef(false);

  // Hide the status bar for the duration - this is a full-bleed, immersive moment.
  useEffect(() => { setImmersive(true); return () => { setImmersive(false); }; }, []);

  // A real modal boundary: take focus, hold it, give it back. Without this a keyboard or
  // switch-control user keeps tabbing through the sheet behind the viewer.
  useEffect(() => {
    restoreRef.current = document.activeElement;
    closeBtnRef.current?.focus();
    // Everything outside the portal is inert while we are up (aria-hidden covers assistive
    // tech even where `inert` is unsupported).
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

  // Hardware back / Escape close the viewer BEFORE the sheet underneath it. Held in a ref so
  // the consumer registers ONCE - `close` is re-created every render.
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

  // Gyro parallax. The first reading becomes neutral, so however you are holding the phone is
  // "flat" - otherwise the card starts skewed by your natural grip angle.
  useEffect(() => {
    if (reduce) return undefined;
    let base = null;
    const onOrient = (e) => {
      if (e.beta == null || e.gamma == null) return;
      gyroSeen.current = true;
      if (!base) base = { b: e.beta, g: e.gamma };
      const db = clamp(e.beta - base.b, -TILT_RANGE, TILT_RANGE) / TILT_RANGE;
      const dg = clamp(e.gamma - base.g, -TILT_RANGE, TILT_RANGE) / TILT_RANGE;
      setTilt({ x: -db * MAX_TILT, y: dg * MAX_TILT, gx: 50 + dg * 34, gy: 50 + db * 34, active: true });
    };
    window.addEventListener('deviceorientation', onOrient, true);
    return () => window.removeEventListener('deviceorientation', onOrient, true);
  }, [reduce]);

  // Pointer fallback for the browser preview / desktop - ignored once the gyro is talking.
  const track = (e) => {
    if (reduce || gyroSeen.current) return;
    const el = cardRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    setTilt({ x: -(py - 0.5) * 2 * MAX_TILT, y: (px - 0.5) * 2 * MAX_TILT, gx: px * 100, gy: py * 100, active: true });
  };

  const url = cardImageUrl(card);
  const site = !!card?.is_site;
  const artist = card?._artist || null;
  const popT = open ? 'none' : (flipT || 'scale(.94)');

  return createPortal(
    <div
      ref={rootRef}
      role="dialog" aria-modal="true" aria-label={`${card?.name || 'Card'} artwork`}
      style={{
        position: 'fixed', inset: 0, zIndex: 900, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 26, padding: 20,
        background: 'rgba(6,4,3,.94)', opacity: open ? 1 : 0, transition: `opacity ${POP_MS}ms ease`,
        perspective: 1200, WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* pop layer */}
      <div ref={cardRef} onPointerMove={track}
        style={{
          position: 'relative', width: 'min(88vw, 420px)', aspectRatio: site ? '531 / 380' : '5 / 7',
          transform: popT, transition: armed ? `transform ${POP_MS}ms cubic-bezier(.2,.9,.3,1)` : 'none',
          transformStyle: 'preserve-3d',
        }}>
        {/* cast shadow - sits BEHIND and below, and slides opposite the tilt so the card
            reads as lifted off the backdrop rather than pasted to it. */}
        <span aria-hidden="true" style={{
          position: 'absolute', left: '6%', right: '6%', bottom: -26, height: 42, borderRadius: '50%',
          background: 'radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,.75), transparent 72%)',
          filter: 'blur(14px)',
          transform: `translate(${(-tilt.y / MAX_TILT) * 14}px, ${(tilt.x / MAX_TILT) * 6}px)`,
          transition: tilt.active ? 'transform .1s linear' : 'transform .34s ease',
        }} />
        {/* tilt layer */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 14, overflow: 'hidden',
          background: cardFallbackArt(card), border: '1px solid rgba(203,167,95,.45)',
          boxShadow: '0 34px 60px -18px rgba(0,0,0,.9), 0 6px 18px rgba(0,0,0,.6)',
          transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
          transition: tilt.active ? 'transform .1s linear' : 'transform .34s cubic-bezier(.2,.9,.3,1)',
        }}>
          {/* Self-removing on error, matching CardArt. The deterministic fallback is already
              painted on the layer behind; without this a 404 or corrupt asset renders a broken
              image ON TOP of it, so real image failure looked different from zero-image mode
              even though both should degrade to the same engraved ground. */}
          {url && !broken && (
            <img src={url} alt={card?.name || ''} draggable="false" onError={() => setBroken(true)}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                ...(site ? { width: 'calc(100% * 380 / 531)', height: 'calc(100% * 531 / 380)', top: '50%', left: '50%', inset: 'auto', transform: 'translate(-50%,-50%) rotate(90deg)' } : {}),
              }} />
          )}
          {/* light catching the face as it turns */}
          <span aria-hidden="true" style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: `radial-gradient(40% 34% at ${tilt.gx}% ${tilt.gy}%, rgba(255,251,235,.28), rgba(255,251,235,.05) 46%, transparent 72%)`,
            opacity: tilt.active ? 1 : 0, transition: 'opacity .25s ease',
          }} />
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

      {/* The X is the only on-screen way out - the backdrop is inert so you can tilt and
          study the card without dismissing it by accident. Hardware back still works. */}
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
