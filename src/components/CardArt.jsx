// Card art: the deterministic fallback is always painted; the bundled image
// layers on top and removes itself if missing/broken. No layout shift, no broken
// <img>, fully legible with zero photography (architecture §5).
import React, { useState } from 'react';
import { cardImageUrl, cardFallbackArt } from '../store/cardArt.js';

// imgStyle overrides the image transform/position - used by CardRow thumbnails
// to zoom into the illustration (crop the text box out) and to rotate Site art
// 90° (stored portrait, displayed landscape). Default (undefined) = plain cover.
export default function CardArt({ card, radius = 8, aspect = '5/7', children, imgStyle }) {
  const [broken, setBroken] = useState(false);
  const url = cardImageUrl(card);
  return (
    <div style={{ position: 'relative', aspectRatio: aspect, borderRadius: radius, overflow: 'hidden', background: cardFallbackArt(card), border: '1px solid var(--hair-18, rgba(220,184,111,.18))' }}>
      {url && !broken && (
        <img
          src={url} alt={card?.name || ''} loading="lazy" onError={() => setBroken(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...imgStyle }}
        />
      )}
      {children}
    </div>
  );
}
