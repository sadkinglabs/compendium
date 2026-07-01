// Stable id + timestamp helpers. crypto.randomUUID is available in the
// Capacitor WebView and modern browsers.
export const uuid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

export const nowIso = () => new Date().toISOString();

export const slugify = (s) =>
  String(s).trim().replace(/\s+/g, '_').replace(/\//g, '-');
