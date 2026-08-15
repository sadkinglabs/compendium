// Card art: the deterministic fallback is always painted; the resolved image layers on top and removes
// itself if missing/broken. No layout shift, no broken <img>, fully legible with zero photography
// (architecture §5). Phase 2: the image now resolves through the shared art boundary (useArtSource) -
// CDN + on-device cache + the local -> remote -> bundled-legacy -> fallback candidate chain - keyed on
// the content-addressed `card.image_slug`. Every CardArt consumer is migrated by this one change.
import React, { useState } from 'react';
import { useArtSource } from './ArtImage.jsx';
import { cardFallbackArt } from '../store/cardArt.js';
import { artCache } from '../store/artCacheInstance.js';
import { paintState } from '../store/artSource.js';

// imgStyle overrides the image transform/position - used by CardRow thumbnails
// to zoom into the illustration (crop the text box out) and to rotate Site art
// 90° (stored portrait, displayed landscape). Default (undefined) = plain cover.
export default function CardArt({ card, radius = 8, aspect = '5/7', children, imgStyle }) {
  const key = card?.image_slug || null;
  const { src, gen, isRemote, onError } = useArtSource(key);
  // Loaded identity is {src, gen}: a quarantine re-resolve remounts the same uri under a new gen,
  // and matching on src alone would count the fresh <img> as already decoded (stale frame, no
  // shimmer). Both must match to fade in.
  const [loaded, setLoaded] = useState({ src: null, gen: -1 });
  // A key that already painted this session skips the shimmer and the fade on remount - the pillar
  // switch that unmounted this component did not un-decode the image. artCache owns the registry
  // (quarantine/clear evict from it, so a genuine re-download shimmers again); the DECISION is
  // paintState, pure and tested. Read at render time on purpose: a quarantine mid-session must flip
  // the very next frame back to the shimmering path.
  const { shown, shimmer, transition } = paintState({
    src, gen, loadedSrc: loaded.src, loadedGen: loaded.gen,
    painted: !!key && artCache.hasPainted(key),
    local: !!src && !isRemote,   // an on-device cached file is AVAILABLE - no shimmer, no fade (owner ruling)
  });
  return (
    <div style={{ position: 'relative', aspectRatio: aspect, borderRadius: radius, overflow: 'hidden', background: cardFallbackArt(card), border: '1px solid var(--hair-18, rgba(220,184,111,.18))' }}>
      {shimmer && <div className="cx-art-shimmer" aria-hidden="true" />}
      {src && (
        <img
          key={gen} src={src} alt={card?.name || ''} loading="lazy"
          onLoad={() => { setLoaded({ src, gen }); artCache.markPainted(key); }} onError={onError}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: shown ? 1 : 0, transition, ...imgStyle }}
        />
      )}
      {children}
    </div>
  );
}
