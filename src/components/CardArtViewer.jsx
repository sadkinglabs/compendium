import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardImageUrl, cardFallbackArt } from '../store/cardArt.js';
import { registerBackConsumer } from '../back.js';

// Full-screen card display. Tapping the art in a card sheet raises the card onto its own
// stage: it scales up from the thumb, and drag/hover tilts it in 3D with a light sweep that
// tracks the pointer, so the art reads like a physical card you are holding.
//
// Platform notes (DESIGN_SYSTEM.md §6):
//  - The SCRIM animates opacity only; the CARD carries the transform. Neither element
//    scrolls, so the transform-plus-scroller WebView rule is not in play.
//  - No blend modes and no backdrop-filter - the tilt and sweep are plain transforms and a
//    gradient, which the WebView composites cheaply.
//  - Zero-image safe: with art suppressed the deterministic gradient fallback + the card name
//    fill the same stage, so the viewer still works.
//  - Reduced motion: `body.reduce-motion` neutralises the entrance animation globally; we
//    additionally skip the tilt so nothing moves under the finger.

const MAX_TILT = 12;   // degrees

export default function CardArtViewer({ card, onClose }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0, gx: 50, gy: 50, active: false });
  const [shown, setShown] = useState(false);
  const frameRef = useRef(null);
  const reduce = typeof document !== 'undefined' && document.body.classList.contains('reduce-motion');

  // Hardware back / Escape closes the viewer BEFORE the sheet underneath it.
  useEffect(() => registerBackConsumer(() => { onClose(); return true; }), [onClose]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Play the entrance on the next frame so the transition has a start value to animate from.
  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);

  const track = (clientX, clientY) => {
    if (reduce) return;
    const el = frameRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (clientX - r.left) / r.width;    // 0..1 across the card
    const py = (clientY - r.top) / r.height;
    setTilt({
      y: (px - 0.5) * 2 * MAX_TILT,             // rotateY follows horizontal travel
      x: -(py - 0.5) * 2 * MAX_TILT,            // rotateX inverts vertical travel
      gx: px * 100, gy: py * 100,
      active: true,
    });
  };
  const rest = () => setTilt({ x: 0, y: 0, gx: 50, gy: 50, active: false });

  const url = cardImageUrl(card);
  const site = !!card?.is_site;

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={`${card?.name || 'Card'} artwork`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 900, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24,
        background: 'rgba(6,4,3,.92)', opacity: shown ? 1 : 0, transition: 'opacity .18s ease',
        perspective: 1100, WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div
        ref={frameRef}
        onClick={(e) => e.stopPropagation()}
        onPointerMove={(e) => track(e.clientX, e.clientY)}
        onPointerLeave={rest}
        onPointerCancel={rest}
        onPointerUp={rest}
        style={{
          position: 'relative', width: 'min(78vw, 340px)', aspectRatio: site ? '531 / 380' : '5 / 7',
          borderRadius: 14, overflow: 'hidden', background: cardFallbackArt(card),
          border: '1px solid rgba(203,167,95,.45)',
          boxShadow: '0 30px 70px -20px rgba(0,0,0,.9)',
          transform: `${shown ? 'scale(1)' : 'scale(.86)'} rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
          transition: tilt.active ? 'transform .08s linear' : 'transform .34s cubic-bezier(.2,.9,.3,1)',
          touchAction: 'none', cursor: 'grab',
        }}
      >
        {url && (
          <img src={url} alt={card?.name || ''} draggable="false"
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block',
              ...(site ? { width: 'calc(100% * 380 / 531)', height: 'calc(100% * 531 / 380)', top: '50%', left: '50%', inset: 'auto', transform: 'translate(-50%,-50%) rotate(90deg)' } : {}),
            }} />
        )}
        {/* Light sweep - a soft highlight that follows the pointer across the face. */}
        <span aria-hidden="true" style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(38% 32% at ${tilt.gx}% ${tilt.gy}%, rgba(255,251,235,.30), rgba(255,251,235,.06) 45%, transparent 70%)`,
          opacity: tilt.active ? 1 : 0, transition: 'opacity .2s ease',
        }} />
      </div>

      <div style={{ textAlign: 'center', maxWidth: '82vw' }}>
        <div style={{ font: "600 15px/1.3 var(--f-display)", letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gold-num)' }}>{card?.name}</div>
        <div style={{ font: "400 12px/1.4 var(--f-ui)", color: 'var(--ink-muted)', marginTop: 6 }}>Tap anywhere to close</div>
      </div>
    </div>,
    document.body,
  );
}
