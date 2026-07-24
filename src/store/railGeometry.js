// Pure geometry for the alphabet rail's vertical bounds. DOM-free so the collision contract is a unit
// test, not a device eyeball. The rail is a fixed overlay on the logical inline edge; it must start
// below the sticky header and END above the tallest reachable bottom obstruction (the dock, its
// stacked add-FAB, and - while selecting - the docked action bar).
//
// ONE authoritative obstruction boundary, mirroring `.cx-dock` (tokens.css): the dock's bottom edge is
// `max(navBase, kb/uiScale + keyboardGap)`, where `navBase` ALREADY includes env(safe-area-inset-bottom)
// in its closed-nav branch and the keyboard branch does NOT re-add it. The rail therefore adds safe area
// exactly once (inside navBase) and never appends it after the max() - the double-count rev 2 had.

/**
 * @param scrollportTop     px from viewport top to the top of the scroll area (0 for the app body).
 * @param headerHeight      the sticky header's height on THIS surface (ALL: ~toolbar; set drill: taller
 *                          title band). Passed explicitly, never assumed - it differs per surface and
 *                          scales with --ui-scale.
 * @param navBase           the dock's closed-nav base, INCLUDING env(safe-area-inset-bottom) - the same
 *                          value `.cx-dock` uses (e.g. 62 + safeArea + 16). Safe area lives here, once.
 * @param activeStackHeight height of the reachable stack rising ABOVE the dock bottom edge (stacked
 *                          add-FAB; plus the selection action bar when selecting).
 * @param kb                keyboard inset px (var --kb); 0 when closed.
 * @param uiScale           --ui-scale (font scaling); the keyboard inset is divided by it, as in .cx-dock.
 * @param keyboardGap       gap above the keyboard (matches .cx-dock's +12).
 * @param railGap           breathing room between the rail's bottom terminus and the stack top.
 * @returns { top, bottom } logical insets: `top` from the scrollport top, `bottom` from the viewport
 *          bottom. Position the rail with `top: {top}px; bottom: {bottom}px` on the chosen inline edge.
 */
export function railBounds({
  scrollportTop = 0, headerHeight = 0, navBase = 0, activeStackHeight = 0,
  kb = 0, uiScale = 1, keyboardGap = 12, railGap = 8,
} = {}) {
  const scale = uiScale > 0 ? uiScale : 1;
  const dockBottom = Math.max(navBase, kb / scale + keyboardGap);   // one boundary, same semantics as .cx-dock
  const top = scrollportTop + headerHeight;
  const bottom = dockBottom + activeStackHeight + railGap;          // clear the tallest stack; NO trailing + safeArea
  return { top, bottom };
}
