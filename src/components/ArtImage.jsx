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
export function ArtImg({ artKey, alt = '', ...imgProps }) {
  const { src, gen, onError } = useArtSource(artKey || null);
  // ATOMIC PAINT (owner report 2026-08-14: the My Deck hero painted progressively -
  // the "broken image" effect - as large JPEGs decoded on screen). The img stays
  // invisible until the load event, then appears whole. The paint-once cache keeps
  // re-entries instant: a key that has painted this session shows immediately, so
  // this cannot resurrect the warm-entry blink the art-first-paint work removed.
  const [loadedId, setLoadedId] = useState(null);          // `${gen}|${src}` once fully loaded
  if (!src) return null;
  const show = (!!artKey && artCache.hasPainted(artKey)) || loadedId === `${gen}|${src}`;
  // imgProps (className/style/loading/aria-hidden/...) pass through; src + onError are the boundary's,
  // placed last so a stray caller prop can never override the candidate-chain error handling.
  return (
    <img key={gen} alt={alt} {...imgProps}
      style={{ ...(imgProps.style || null), ...(show ? null : { opacity: 0 }) }}
      src={src}
      onLoad={() => { setLoadedId(`${gen}|${src}`); if (artKey) artCache.markPainted(artKey); }}
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
