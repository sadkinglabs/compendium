// Global, decoupled UI feedback — toast + confirm — so any module (React
// component OR store) can request them without prop-drilling. The hosts
// (ToastHost / ConfirmHost) live in App and render on the black chassis.
// Falls back to native confirm() only if the host isn't mounted.

/** Fire-and-forget toast. opts: { tone: 'default'|'danger', ms } */
export function toast(message, opts = {}) {
  try { window.dispatchEvent(new CustomEvent('cx-toast', { detail: { message, ...opts } })); }
  catch { /* no window */ }
}

/** Ask the user to confirm a destructive action. Resolves true/false.
 *  opts: { title, body, confirmLabel, cancelLabel, danger } */
export function confirmAction(opts = {}) {
  return new Promise((resolve) => {
    let handled = false;
    const done = (v) => { if (!handled) { handled = true; resolve(v); } };
    try { window.dispatchEvent(new CustomEvent('cx-confirm', { detail: { opts, resolve: done } })); }
    catch { done(window.confirm(opts.body || opts.title || 'Are you sure?')); }
    // If no host is listening, the event does nothing and the promise would
    // hang — guard with a microtask fallback flag set by the host.
    queueMicrotask(() => { if (!window.__cxConfirmHostMounted && !handled) done(window.confirm(opts.body || opts.title || 'Are you sure?')); });
  });
}
