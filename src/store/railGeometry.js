// Pure geometry for the alphabet rail's vertical bounds. DOM-free so the collision contract is a unit
// test, not a device eyeball. The rail is a fixed overlay on the logical inline edge; it must start
// below the sticky header and END above the tallest reachable bottom obstruction.
//
// ONE authoritative, MEASURED obstruction boundary (Codex's preferred path): the caller measures the
// live top of the reachable dock / action-bar / FAB stack (`.cx-dock` already positions itself for
// closed / keyboard-open / safe-area via its own CSS, and the stacked add-FAB rises above it), and this
// helper converts that rectangle into rail insets. Because the boundary is a single measured value,
// safe area is counted exactly once and can never be double-added - the class of bug rev 2 had.

/**
 * @param viewportHeight  window.innerHeight (or visualViewport height) in px.
 * @param scrollRootTop   the scroll container's top in viewport px (its getBoundingClientRect().top).
 * @param headerHeight    this surface's sticky-header height (ALL toolbar vs the taller set-drill title
 *                        band) - passed explicitly, never assumed; a per-surface constant, device-tunable.
 * @param obstructionTop  the measured top (viewport px) of the tallest reachable bottom obstruction
 *                        (min over .cx-dock and any stacked FAB). Encodes closed/keyboard/safe-area.
 * @param railGap         breathing room between the rail terminus and the obstruction.
 * @returns { top, bottom } fixed insets: `top` from the viewport top, `bottom` from the viewport bottom.
 *          Position with `top: {top}px; bottom: {bottom}px` on the chosen inline edge.
 */
export function railBounds({ viewportHeight = 0, scrollRootTop = 0, headerHeight = 0, obstructionTop, railGap = 8 }) {
  const top = scrollRootTop + headerHeight;
  const hasObstruction = Number.isFinite(obstructionTop);
  const bottom = hasObstruction ? Math.max(railGap, viewportHeight - obstructionTop + railGap) : railGap;
  return { top, bottom };
}

/**
 * Which slot index a pointer at `y` maps to over a continuous capture strip of `count` slots spanning
 * [top, top+height]. This is the Niagara hit model: the letter under the finger comes from POSITION,
 * not a per-label button, so precision never depends on a label being >= 44px. Clamped to
 * [0, count-1]; the caller maps the index to `order` and no-ops if that slot is absent (inert).
 */
export function indexAtY(y, top, height, count) {
  if (count <= 0 || !(height > 0)) return 0;
  const i = Math.floor(((y - top) / height) * count);
  return Math.max(0, Math.min(count - 1, i));
}
