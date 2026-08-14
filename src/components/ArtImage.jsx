// The two consumption forms of the art boundary: the `useArtSource` hook (for bespoke markup) and the
// `ArtImage` component (for the common framed thumbnail). Both are ZERO-LOGIC shells over the tested
// pure functions in artSource.js - they capture the impure input (the memoized peek) at the dispatch
// site and call reduce/visibleCandidate in React's documented effect order.
// All the "which candidate paints this frame" rules live in artSource.js (unit-tested, DOM-free); all
// the caching/downloading/validating lives in artCache (unit-tested core). This is the LIVE art path at
// every render site (card art is CDN-served + on-device cached). See art-cdn-rev2-architecture.md B4.
import { useReducer, useEffect, useCallback, useState } from 'react';
import { reduce, initial, visibleCandidate, paintState } from '../store/artSource.js';
import { artCache } from '../store/artCacheInstance.js';

/**
 * Resolve a card-art source for a content-addressed key through the shared cache.
 * @param {string|null} key  the content key (card.image_slug after the Phase-2 repoint)
 * @returns {{ src: string|null, gen: number, onError: () => void }}
 *   src null => render nothing over the fallback (never an empty <img>); gen keys the <img> so a
 *   quarantine re-resolve of a byte-identical uri still remounts; onError drives the candidate chain.
 */
export function useArtSource(key) {
  const [st, dispatch] = useReducer(reduce, key, (k) => initial(k, artCache.peek(k)));

  useEffect(() => {
    dispatch({ type: 'KEY', key, peeked: artCache.peek(key) });
  }, [key]);

  useEffect(() => {   // one resolution attempt per (key, phase, gen)
    if (st.phase === 'resolving') {
      artCache.resolve(st.key).then((cand) => dispatch({ type: 'RESOLVED', key: st.key, cand }));
    } else if (st.phase === 'quarantining') {
      artCache.quarantine(st.key).then((cand) => dispatch({ type: 'RESOLVED', key: st.key, cand }));
    }
  }, [st.key, st.phase, st.gen]);

  const cand = visibleCandidate(st, key);   // pure; null on a key mismatch (no stale paint)
  const onError = useCallback(
    () => dispatch({ type: 'IMG_ERROR', key }),   // a remote miss goes straight to the deterministic fallback (Phase 5: no bundled legacy)
    [key],
  );
  const isRemote = cand?.kind === 'remote';
  return { src: cand?.src ?? null, gen: st.gen, isRemote, onError };
}

/**
 * The BARE form: just the resolved <img>, no frame - a drop-in for the inline avatar/hero thumbnails
 * that render a plain <img> and hide it on error. Renders NOTHING when there is no art (zero-image, or
 * the candidate chain reached its terminal fallback), matching the old onError-hide behavior. Safe
 * inside .map() (it is a component, so the hook is called once per instance). `artKey` is the
 * content-addressed key (a printing/card `image_slug` after the Phase-2 repoint).
 */
// SEAM-FREE REVEAL. Frame-by-frame device capture (builds 232-233, rec2/rec3)
// pinned the Library "streak" and the My Deck "broken image" to the img's OWN
// compositor layer: a bright 2-3px vertical line at screen x~1010 = img left
// edge (~495; the card hero is 64% wide = 813px) + 512, Chromium's raster tile
// width - a texture-edge bleed where a not-yet-uploaded tile meets an uploaded
// one on the img's first visible frame. It was never the pillar entrance (the
// seam survived a build with fade-only entrances), and instant reveals cannot
// fix it: hiding at opacity 0 skips raster entirely, and pre-rastering at 2%
// opacity was defeated by tile priorities - the flip still outran the upload
// (rec3 f049: full-brightness seam one frame before the art).
//
// The cure stops RACING the tile pipeline and rides it instead: reveal through
// a short compositor-driven opacity TRANSITION. Tiles that land staggered do so
// during the low-alpha ramp where a seam is arithmetically invisible (155 * 7%
// ~ 11/255 on frame one); by the time alpha is high, every tile is up. This is
// exactly why the framed CardArt path - which has always faded - never seamed.
// The paint-once cache keeps the contract: a key that has painted this session
// renders instantly with no fade (warm re-entries stay blink-free).
const FADE = 'opacity .16s linear';
// VISIBILITY FOLLOWS THIS ELEMENT'S OWN LIFECYCLE, never the key's history.
// rec6 f016 caught the My Deck "broken image": the hero's first src transiently
// ERRORS (the Cap-8 lesson again - the candidate chain recovers one frame
// later), and the paint-once fast path made the failing img visible from mount,
// so the browser's broken-image glyph painted for a frame. hasPainted now
// decides only HOW a loaded img appears (instantly vs the seam-masking fade);
// an img that has not fired load for its CURRENT src is never visible, so an
// error state has nothing to paint and the chain swaps src invisibly.
export function ArtImg({ artKey, alt = '', ...imgProps }) {
  const { src, gen, onError } = useArtSource(artKey || null);
  const [phase, setPhase] = useState({ id: null, at: 'wait' });
  const id = `${gen}|${src}`;
  if (!src) return null;
  const at = phase.id === id ? phase.at : 'wait';
  const onLoad = () => {
    if (artKey && artCache.hasPainted(artKey)) { setPhase({ id, at: 'settled' }); return; }   // warm: instant, no fade
    // Cold: fade on the compositor (masks raster-tile arrival - see above), then
    // drop the inline styles once it is safely over.
    setPhase({ id, at: 'show' });
    if (artKey) artCache.markPainted(artKey);
    setTimeout(() => setPhase((p) => (p.id === id && p.at === 'show' ? { id, at: 'settled' } : p)), 300);
  };
  const reveal = at === 'settled' ? null
    : at === 'show' ? { opacity: 1, transition: FADE }
    : { opacity: 0, transition: 'none' };
  // imgProps (className/style/loading/aria-hidden/...) pass through; src + onError are the boundary's,
  // placed last so a stray caller prop can never override the candidate-chain error handling.
  return (
    <img key={gen} alt={alt} {...imgProps}
      style={{ ...(imgProps.style || null), ...reveal }}
      src={src}
      onLoad={at === 'settled' ? undefined : onLoad}
      onError={onError} />
  );
}

/**
 * The common framed card-art thumbnail: a container that always paints `fallback` (the deterministic
 * gradient) with the resolved art layered on top, self-removing on error via the candidate chain. Card
 * art is never drawn into a canvas here, so no crossOrigin is needed.
 */
export function ArtImage({ artKey, alt = '', fallback, className, style, imgClassName, imgStyle, loading = 'lazy' }) {
  const { src, gen, onError } = useArtSource(artKey);
  // Track the loaded IDENTITY as {src, gen}, not src alone: a quarantine re-resolve can remount the
  // SAME uri under a new gen, and matching on src alone would treat the fresh <img> as already
  // decoded - suppressing the shimmer and flashing the stale frame. Both must match to fade in.
  const [loaded, setLoaded] = useState({ src: null, gen: -1 });
  // Same no-refade rule as CardArt (the LIVE framed component - this one currently has no call
  // sites, and is kept in step so adopting it later does not resurrect the replaying fade).
  const { shown, shimmer, transition } = paintState({
    src, gen, loadedSrc: loaded.src, loadedGen: loaded.gen,
    painted: !!artKey && artCache.hasPainted(artKey),
  });
  return (
    <div className={className} style={{ position: 'relative', ...style, backgroundImage: fallback, backgroundSize: 'cover', backgroundPosition: 'center' }}>
      {shimmer && <div className="cx-art-shimmer" aria-hidden="true" />}
      {src && (
        <img
          key={gen}                 /* remount on a quarantine re-resolve even if the uri is unchanged */
          src={src}
          alt={alt}
          loading={loading}
          className={imgClassName}
          onLoad={() => { setLoaded({ src, gen }); artCache.markPainted(artKey); }}
          onError={onError}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: shown ? 1 : 0, transition, ...imgStyle }}
        />
      )}
    </div>
  );
}
