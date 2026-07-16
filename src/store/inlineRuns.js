// Split canon[s,e] into flat runs at inline-link boundaries. Each run is a slice
// [start,end) carrying its covering link (or null); a run is therefore either plain
// text or a single link span, never a nested decoration. Pure and dependency-free
// so the projection the renderer performs (ui.jsx InlineText) is unit-testable.
// Run: npm run test:query
export function linkRuns(canon, s, e, links = []) {
  const clip = (x) => Math.max(s, Math.min(e, x));
  // Links overlapping [s,e], clipped to the window.
  const L = links
    .filter((l) => l.end > s && l.start < e)
    .map((l) => ({ ...l, start: clip(l.start), end: clip(l.end) }));
  const bounds = new Set([s, e]);
  for (const l of L) { bounds.add(l.start); bounds.add(l.end); }
  const pts = [...bounds].sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (b <= a) continue;
    runs.push({ start: a, end: b, link: L.find((l) => l.start <= a && l.end >= b) || null });
  }
  return runs;
}
