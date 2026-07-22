// Card art: the deterministic fallback is always painted; the resolved image layers on top and removes
// itself if missing/broken. No layout shift, no broken <img>, fully legible with zero photography
// (architecture §5). Phase 2: the image now resolves through the shared art boundary (useArtSource) -
// CDN + on-device cache + the local -> remote -> bundled-legacy -> fallback candidate chain - keyed on
// the content-addressed `card.image_slug`. Every CardArt consumer is migrated by this one change.
import React from 'react';
import { useArtSource } from './ArtImage.jsx';
import { cardFallbackArt } from '../store/cardArt.js';

// imgStyle overrides the image transform/position - used by CardRow thumbnails
// to zoom into the illustration (crop the text box out) and to rotate Site art
// 90° (stored portrait, displayed landscape). Default (undefined) = plain cover.
export default function CardArt({ card, radius = 8, aspect = '5/7', children, imgStyle }) {
  const { src, gen, onError } = useArtSource(card?.image_slug || null);
  return (
    <div style={{ position: 'relative', aspectRatio: aspect, borderRadius: radius, overflow: 'hidden', background: cardFallbackArt(card), border: '1px solid var(--hair-18, rgba(220,184,111,.18))' }}>
      {src && (
        <img
          key={gen} src={src} alt={card?.name || ''} loading="lazy" onError={onError}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...imgStyle }}
        />
      )}
      {children}
    </div>
  );
}
