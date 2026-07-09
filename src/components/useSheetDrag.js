import { useRef, useState, useCallback } from 'react';

// A drag-to-close ends with a touch that emits ONE synthetic click on release. Once
// the sheet unmounts, that click lands on whatever nav/content is underneath and
// eats the user's next tap. Swallow it (capture phase, one-shot, short-lived).
function swallowNextClick() {
  if (typeof window === 'undefined') return;
  const block = (e) => { e.stopPropagation(); e.preventDefault(); done(); };
  const done = () => { window.removeEventListener('click', block, true); clearTimeout(t); };
  const t = setTimeout(done, 400);
  window.addEventListener('click', block, true);
}

// Drag-to-dismiss for bottom sheets. Attach `handleProps` to the grab zone (handle
// + header - NOT the scrollable body), and spread `style` onto the panel. Downward
// motion only; releasing past `threshold` calls onClose, otherwise it springs back.
//
// Move/up are tracked on `window` for the duration of the drag rather than via
// setPointerCapture: capturing the pointer to the grab element meant that when the
// sheet UNMOUNTED on close, the browser was left with a dangling capture that
// swallowed the very next tap anywhere. Window listeners have no such side effect.
export function useSheetDrag(onClose, { threshold = 92 } = {}) {
  const [dy, setDy] = useState(0);
  const st = useRef({ active: false, startY: 0 });

  const onPointerDown = useCallback((e) => {
    if (e.button != null && e.button > 0) return;   // primary button / touch only
    st.current = { active: true, startY: e.clientY };
    const move = (ev) => {
      if (!st.current.active) return;
      const d = ev.clientY - st.current.startY;
      setDy(d > 0 ? d : 0);              // downward only
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!st.current.active) return;
      st.current.active = false;
      const d = ev.clientY - st.current.startY;
      setDy(0);                          // reset (closes flush to null, or springs back)
      if (d > threshold) { swallowNextClick(); onClose?.(); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [onClose, threshold]);

  const handleProps = { onPointerDown, style: { touchAction: 'none', cursor: 'grab' } };
  const style = {
    transform: dy ? `translateY(${dy}px)` : undefined,
    transition: st.current.active ? 'none'
      : 'transform .26s cubic-bezier(.34,1.2,.64,1), bottom .2s ease',
  };
  return { handleProps, style };
}
