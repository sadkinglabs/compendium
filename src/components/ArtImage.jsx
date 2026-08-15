// The two consumption forms of the art boundary: the `useArtSource` hook (for bespoke markup) and the
// `ArtImage` component (for the common framed thumbnail). Both are ZERO-LOGIC shells over the tested
// pure functions in artSource.js - they capture the impure input (the memoized peek) at the dispatch
// site and call reduce/visibleCandidate in React's documented effect order.
// All the "which candidate paints this frame" rules live in artSource.js (unit-tested, DOM-free); all
// the caching/downloading/validating lives in artCache (unit-tested core). This is the LIVE art path at
// every render site (card art is CDN-served + on-device cached). See art-cdn-rev2-architecture.md B4.
import { useReducer, useEffect, useCallback, useState } from 'react';
import { reduce, initial, visibleCandidate, paintState } from '../store/artSource.js';
import { initialReveal, revealReduce, revealPresentation, SETTLE_AFTER_MS } from '../store/artReveal.js';
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
// REVEAL CONTRACT (Codex-approved Option A, docs/proposals/decks-swap-artifacts.md;
// decisions live in the pure, tested artReveal.js):
//   - every new {src, gen} identity mounts HIDDEN, warm cache history included -
//     that history was granting pre-load visibility, which is how the failing
//     hero painted the broken-image glyph (rec6 f016) and how warm remounts
//     revealed their first raster instantly (the measured Library streak on the
//     within-pillar swap);
//   - only this element's own load starts the reveal, which is a compositor
//     opacity transition: 160ms cold, 90ms warm - warm shortens, never skips;
//   - the transition lives in CSS classes (tokens.css cx-art-reveal*) so the
//     reduced-motion rendering-integrity exception is plain CSS specificity;
//   - the settle timer is identity-checked in the reducer, so it can never
//     settle a replacement {src, gen}.
// Measurement vs inference: the fixed seam x (img left edge + 512) and the
// fade's measured effect (detector spike ~77k -> 0 on the cold path, build 234)
// are observations; "tiles finishing upload after their neighbour" is the
// consistent inference, not directly observed Chromium state.
export function ArtImg({ artKey, alt = '', ...imgProps }) {
  const { src, gen, onError } = useArtSource(artKey || null);
  const [reveal, dispatchReveal] = useReducer(revealReduce, initialReveal);
  const id = `${gen}|${src}`;
  if (!src) return null;
  const p = revealPresentation(reveal, id);
  const onLoad = () => {
    dispatchReveal({ type: 'LOADED', id, warm: !!artKey && artCache.hasPainted(artKey) });
    if (artKey) artCache.markPainted(artKey);
    setTimeout(() => dispatchReveal({ type: 'SETTLED', id }), SETTLE_AFTER_MS);
  };
  // imgProps (className/style/loading/aria-hidden/...) pass through; src + onError are the boundary's,
  // placed last so a stray caller prop can never override the candidate-chain error handling.
  return (
    <img key={gen} alt={alt} {...imgProps}
      className={[imgProps.className, p.className].filter(Boolean).join(' ') || undefined}
      style={{ ...(imgProps.style || null), ...p.style }}
      src={src}
      onLoad={p.revealed ? undefined : onLoad}
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
