// Progressive (prefix) rendering for the large ALL grid: render the first `initial` rows, then grow
// by `step` as a bottom sentinel nears the viewport. The list is NOT virtualised - this just caps how
// many DOM tiles exist, so first paint is bounded regardless of catalogue size (content-visibility
// still skips off-screen paint for the rendered ones).
//
// CRITICAL: the prefix resets to `initial` ONLY when the SIGNATURE changes (scope/query/filter/sort/
// group) - never when the derived row OBJECTS change identity. A quick-add or a subscribeCollection
// broadcast re-derives fresh rows with the same signature and must NOT snap the user back to the top.
import { useState, useEffect, useRef, useCallback } from 'react';

export function useProgressiveRender(rows, signature, { initial = 100, step = 100, rootSelector = '.cx-scroll' } = {}) {
  const [count, setCount] = useState(initial);
  const sentinelRef = useRef(null);
  const total = rows.length;

  // Signature-based reset (the load-bearing rule).
  useEffect(() => { setCount(initial); }, [signature, initial]);

  // Grow when the sentinel nears the scroll viewport. One grow per frame (rAF), capped at total.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return undefined;
    const root = typeof document !== 'undefined' ? document.querySelector(rootSelector) : null;
    let raf = 0;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => setCount((c) => Math.min(total, c + step)));
      }
    }, { root, rootMargin: '600px 0px' });
    io.observe(el);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, [total, step, rootSelector]);

  // Phase-2 hook: ensure at least N rows are rendered before scrolling the rail to a far letter.
  const ensureRendered = useCallback((n) => setCount((c) => Math.max(c, Math.min(total, n))), [total]);

  const visible = count >= total ? rows : rows.slice(0, count);
  return { visible, sentinelRef, hasMore: count < total, shownCount: Math.min(count, total), ensureRendered };
}
