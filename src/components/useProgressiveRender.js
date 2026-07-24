// Progressive (prefix) rendering for the large ALL grid: render the first `initial` items, grow by
// `step` as a bottom sentinel nears the viewport. Caps how many DOM tiles exist so first paint is
// bounded regardless of catalogue size (the tiles' images are `loading="lazy"`; content-visibility
// skips off-screen paint). Takes the TOTAL count - the caller slices the arranged order itself.
//
// Reset is SIGNATURE-based, never row-identity based: a quick-add / subscribeCollection broadcast
// re-derives fresh rows with the same signature and must NOT snap the user back to the top. Crucially
// the reset is SYNCHRONOUS: progress is stored as `{ signature, count }` and the rendered count is
// DERIVED (effectiveCount), so the very first render under a new signature already yields `initial`.
// A post-render effect that reset count would still reconcile the old large prefix once - the exact
// expensive render this architecture exists to avoid.
//
// The sentinel is held via a CALLBACK ref, and the observer effect depends on that actual node, so a
// sentinel that unmounts (list complete) then remounts (a same-count sort/group change) reinstalls the
// observer. The scroll root is resolved from `sentinel.closest('.cx-scroll')` - NOT
// document.querySelector, whose first match is Collection's horizontal header scroller (not an
// ancestor of the grid), which would silently deliver no intersections. When no observer or root is
// available, `showMore` is the explicit manual fallback so the catalogue is never unreachable.
import { useState, useEffect, useRef, useCallback } from 'react';
import { resolveScrollRoot, effectiveCount } from '../store/collectionAllModel.js';

export function useProgressiveRender(total, signature, { initial = 100, step = 100 } = {}) {
  const [progress, setProgress] = useState(() => ({ signature, count: initial }));
  const [sentinel, setSentinel] = useState(null);   // callback-ref target NODE (re-runs the effect on remount)
  const rafRef = useRef(0);

  const count = effectiveCount(progress, signature, initial, total);   // derived SYNCHRONOUSLY (no reset-effect)

  // Commit the reset so stored progress tracks the live signature (bail out when already aligned so a
  // ledger broadcast never re-renders). The rendered `count` is already `initial` before this runs.
  useEffect(() => {
    setProgress((p) => (p.signature === signature ? p : { signature, count: initial }));
  }, [signature, initial]);

  // Grow ADOPTS the current signature first, then advances from the effective base - so a growth that
  // races a signature change grows from `initial`, never from the stale large count.
  const grow = useCallback((by) => setProgress((p) => {
    const base = p.signature === signature ? p.count : initial;
    return { signature, count: Math.min(total, base + by) };
  }), [signature, initial, total]);

  useEffect(() => {
    if (!sentinel) return undefined;
    const root = resolveScrollRoot(sentinel);
    if (typeof IntersectionObserver === 'undefined' || !root) return undefined;   // -> manual showMore fallback
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => grow(step));
      }
    }, { root, rootMargin: '600px 0px' });
    io.observe(sentinel);
    return () => { cancelAnimationFrame(rafRef.current); io.disconnect(); };
  }, [sentinel, grow, step]);

  // Phase-2 hook: ensure at least N items are rendered before scrolling the rail to a far letter.
  const ensureRendered = useCallback((n) => setProgress((p) => {
    const base = p.signature === signature ? p.count : initial;
    return { signature, count: Math.max(base, Math.min(total, n)) };
  }), [signature, initial, total]);
  const showMore = useCallback(() => grow(step), [grow, step]);   // manual fallback
  return { count, sentinelRef: setSentinel, hasMore: count < total, showMore, ensureRendered };
}
