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
 * The rail's top offset from the scroll root's top, derived from MEASURED boundaries (all values in
 * the same viewport-px space):
 *   - `stickyBottom`: the bottom edge of this surface's sticky chrome (the set-drill header), or
 *     null / non-finite when the surface has none - non-sticky header content scrolls away, so the
 *     floor is then the scroll root itself.
 *   - `contentTop`: the measured top of the first grid tile - the rail's alignment target ("start
 *     where the cards are"). When the list is scrolled the tile sits above the floor and the floor
 *     wins: the rail never starts above the sticky chrome or outside the scrollport.
 * Returns an offset >= 0, shaped to feed railBounds as `headerHeight` (top = scrollRootTop + offset).
 */
export function railTopOffset({ scrollRootTop = 0, stickyBottom = null, contentTop = null } = {}) {
  const sticky = Number.isFinite(stickyBottom) ? Math.max(0, stickyBottom - scrollRootTop) : 0;
  const content = Number.isFinite(contentTop) ? contentTop - scrollRootTop : -Infinity;
  return Math.max(sticky, content, 0);
}

/**
 * The effective CSS zoom between real viewport px (getBoundingClientRect) and the layout px a zoomed
 * subtree consumes (`.cx-app { zoom: var(--ui-scale) }`): rect width / layout (offset) width. Fixed
 * insets computed from viewport measurements MUST be divided by this before being written as style
 * inside the zoomed subtree, and rect-derived scroll deltas likewise before feeding scrollTop.
 * Degenerate inputs (zero, negative, non-finite) return 1 - never NaN, never a blown-up inset.
 */
export function effectiveZoom(rectWidth, layoutWidth) {
  if (!Number.isFinite(rectWidth) || !Number.isFinite(layoutWidth) || rectWidth <= 0 || layoutWidth <= 0) return 1;
  return rectWidth / layoutWidth;
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
