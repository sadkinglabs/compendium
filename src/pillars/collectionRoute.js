// Which Collection surface is showing, as a pure decision.
//
// This is a CHARACTERIZATION of behaviour that already shipped, extracted before splitting
// Collection.jsx into per-surface files. It was a nested ternary inside the render, so the
// routing rules - including two that are easy to get wrong - existed only as a shape a
// refactor could quietly alter:
//
//   - `setDrill` only means anything while `view === 'cards'`. A drill code left in the cache
//     must NOT resurrect the drill when the user is looking at Lists.
//   - `listOpen` only means anything while `view === 'lists'`, for the same reason.
//   - `placeOpen` only means anything while `view === 'cards'`, for the same reason: it is a third
//     drill state in the same surviving cache, so it goes stale in exactly the same way.
//
// STORAGE IS A MODE OF My Collection - never a fourth chip. The owner's ruling put it INSIDE My
// Collection and kept the chip row at three; the 2026-08-18 amendment made it the THIRD SEGMENT of
// that view's own control, reordered to All / Sets / Storage, rather than a strip below the sets
// grid. So `cardsMode` picks between three peer surfaces and there is still no `view: 'storage'`.
//
// Recorded here because this file is where the shape is enforced, and it has now been got wrong
// twice - once as a fourth chip, once as an appendage to the sets grid whose last rows ended up
// under the bottom nav.
//
// Both matter because the nav cache survives an unmount (a Codex hand-off, the scanner), so
// stale values genuinely do sit in state while another view is active.
//
// Keep this dumb: it decides WHICH surface, never what the surface is given. Anything that
// needs data belongs in the component.
export const COLLECTION_SURFACES = ['overview', 'setDrill', 'setsHome', 'listDetail', 'listsIndex', 'storageIndex', 'storageDetail'];

/**
 * @param {{ view?: string, setDrill?: string|null, listOpen?: object|null, placeOpen?: object|null, cardsMode?: string }} state
 * @returns {'overview'|'setDrill'|'setsHome'|'listDetail'|'listsIndex'|'storageIndex'|'storageDetail'}
 */
export function collectionSurface({ view, setDrill, listOpen, placeOpen, cardsMode } = {}) {
  if (view === 'cards') {
    // A set drill outranks everything else in this view: it is a deeper layer, and a stale mode
    // must not pull the user out of a set they opened.
    if (setDrill != null) return 'setDrill';
    if (cardsMode === 'storage') return placeOpen ? 'storageDetail' : 'storageIndex';
    // 'all' and 'sets' are both the same surface - it owns that toggle itself.
    return 'setsHome';
  }
  if (view === 'lists') return listOpen ? 'listDetail' : 'listsIndex';
  // Overview is the fallback, not just the 'overview' case: an unrecognised view (a stale
  // cache from an older build, say) must land somewhere real rather than render nothing.
  return 'overview';
}
