// Small shared utilities that are framework-agnostic (usable from both React
// components and the store layer).

/** Allow only http(s) URLs through to an <a href> / storage. Anything else
 *  (javascript:, data:, vbscript:, blank, malformed) collapses to undefined so
 *  a crafted link - including one delivered via profile import - can never
 *  execute in the WebView. */
export function safeHref(u) {
  const s = String(u ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : undefined;
}
