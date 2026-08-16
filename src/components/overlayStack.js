// Global overlay registry - the stacking + background-isolation contract for
// modal surfaces (docs/bottom-sheet-spec.md section 5). LEAF module: imports
// nothing from ui.jsx / GothicSheet (same rule as useFocusTrap.js).
//
// Two jobs:
// 1. Explicit z-order for stacked sheets (replaces the DOM-order accident the
//    audit flagged): each sheet gets z = 200 + 2 x its stack depth at open.
// 2. Background inert/aria-hidden (CardArtViewer's proven pattern, generalized):
//    while the TOPMOST overlay is a portaled sheet, everything else under
//    `.cx-app` is inert - including sheets lower in the stack. When the topmost
//    overlay is an in-tree modal (CenteredModal renders inside the app root, not
//    a portal), the app root must stay interactive, so only the sheets below it
//    are inert. This WebView's aria-modal handling is measured-unreliable
//    (OverflowMenu.jsx device notes), so aria-modal alone is not trusted.
//
// CardArtViewer keeps its own body-level inert management; it saves and restores
// prior attribute state, so the two compose (different elements).

const stack = [];                 // [{ kind: 'sheet'|'modal', el: Element|null }]
const saved = new Map();          // el -> { inert, ariaHidden }

function setInert(el, on) {
  if (on) {
    if (saved.has(el)) return;
    saved.set(el, { inert: el.inert, ariaHidden: el.getAttribute('aria-hidden') });
    try { el.inert = true; } catch { /* older WebView: aria-hidden still applies */ }
    el.setAttribute('aria-hidden', 'true');
  } else {
    const prev = saved.get(el);
    if (!prev) return;
    saved.delete(el);
    try { el.inert = !!prev.inert; } catch { /* noop */ }
    if (prev.ariaHidden == null) el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', prev.ariaHidden);
  }
}

function recompute() {
  if (typeof document === 'undefined') return;
  const appRoot = document.querySelector('.cx-app');
  if (!appRoot) return;
  const top = stack[stack.length - 1];
  const anySheet = stack.some((s) => s.kind === 'sheet');
  const bgInert = anySheet && top?.kind === 'sheet';
  for (const child of Array.from(appRoot.children)) {
    const entry = stack.find((s) => s.el === child);
    if (entry) setInert(child, entry !== top);
    else setInert(child, bgInert);
  }
  // An element that left the DOM (sheet unmounted) can never be restored; drop it.
  for (const el of Array.from(saved.keys())) {
    if (!el.isConnected) saved.delete(el);
  }
}

/**
 * Register an open overlay. Returns { z, release }.
 * `el` is the overlay's top-level element under `.cx-app` for sheets (used for
 * inert exemption); null for in-tree modals.
 */
export function pushOverlay(entry) {
  stack.push(entry);
  const z = 200 + 2 * (stack.filter((s) => s.kind === 'sheet').length - 1);
  recompute();
  return {
    z,
    release() {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      recompute();
    },
  };
}
