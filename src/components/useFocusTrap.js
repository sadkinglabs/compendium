// Modal focus trap, extracted to a LEAF module to break a circular import.
//
// It used to live in ui.jsx, which imports GothicSheet for its BottomSheet adapter, while
// GothicSheet imports the trap back from ui.jsx. That cycle sat latent for a long time: it
// only becomes fatal when the bundler's chunking happens to initialise the two in the order
// that leaves a binding in its temporal dead zone, and then the whole app renders nothing
// with "Cannot access 'X' before initialization". A Collection-side import that changed
// nothing about these two files was enough to flip it.
//
// So this file imports NOTHING from ui.jsx or GothicSheet, and must stay that way. ui.jsx
// re-exports the hook so existing callers are unaffected.
import React from 'react';

export function useFocusTrap(active) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!active || !ref.current) return;
    const panel = ref.current;
    const opener = /** @type {HTMLElement|null} */ (document.activeElement);
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const first = panel.querySelector(sel);
    // preventScroll: focusing must not scroll the panel's scroll body to the first
    // control (in the missing-cards sheet that's a button BELOW the list, which
    // opened the list scrolled past its top). Keeps focus, drops the implicit jump.
    if (first) setTimeout(() => first.focus?.({ preventScroll: true }), 0);
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const items = [...panel.querySelectorAll(sel)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const a = items[0], b = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
      else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
    };
    panel.addEventListener('keydown', onKey);
    return () => { panel.removeEventListener('keydown', onKey); try { opener?.focus?.(); } catch { /* gone */ } };
  }, [active]);
  return ref;
}
