// Progressive (prefix) rendering for the large ALL grid: render the first `initial` items, grow by
// `step` as a bottom sentinel nears the viewport. Caps how many DOM tiles exist so first paint is
// bounded regardless of catalogue size (the tiles' images are `loading="lazy"`; content-visibility
// skips off-screen paint). Takes the TOTAL count - the caller slices the arranged order itself.
//
// Reset is SIGNATURE-based, never row-identity based: a quick-add / subscribeCollection broadcast
// re-derives fresh rows with the same signature and must NOT snap the user back to the top.
//
// The sentinel is held via a CALLBACK ref, and the observer effect depends on that actual node, so a
// sentinel that unmounts (list complete) then remounts (a same-count sort/group change) reinstalls the
// observer. The scroll root is resolved from `sentinel.closest('.cx-scroll')` - NOT
// document.querySelector, whose first match is Collection's horizontal header scroller (not an
// ancestor of the grid), which would silently deliver no intersections. When no observer or root is
// available, `showMore` is the explicit manual fallback so the catalogue is never unreachable.
import { useState, useEffect, useRef, useCallback } from 'react';
import { resolveScrollRoot } from '../store/collectionAllModel.js';

export function useProgressiveRender(total, signature, { initial = 100, step = 100 } = {}) {
  const [count, setCount] = useState(initial);
  const [sentinel, setSentinel] = useState(null);   // callback-ref target NODE (re-runs the effect on remount)
  const rafRef = useRef(0);

  useEffect(() => { setCount(initial); }, [signature, initial]);   // reset ONLY on a real signature change

  useEffect(() => {
    if (!sentinel) return undefined;
    const root = resolveScrollRoot(sentinel);
    if (typeof IntersectionObserver === 'undefined' || !root) return undefined;   // -> manual showMore fallback
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => setCount((c) => Math.min(total, c + step)));
      }
    }, { root, rootMargin: '600px 0px' });
    io.observe(sentinel);
    return () => { cancelAnimationFrame(rafRef.current); io.disconnect(); };
  }, [sentinel, total, step]);

  // Phase-2 hook: ensure at least N items are rendered before scrolling the rail to a far letter.
  const ensureRendered = useCallback((n) => setCount((c) => Math.max(c, Math.min(total, n))), [total]);
  const showMore = useCallback(() => setCount((c) => Math.min(total, c + step)), [total, step]);   // manual fallback
  return { count: Math.min(count, total), sentinelRef: setSentinel, hasMore: count < total, showMore, ensureRendered };
}
