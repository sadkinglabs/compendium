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
// STORAGE IS A SECTION OF My Collection - not a fourth view, and not a mode either. The owner's
// ruling: "INSIDE My Collection - top section would be sets, and below you'd have Storage", agreed
// explicitly in preference to a fourth chip, and "it keeps the chip row at three". So there is no
// `view: 'storage'` and no storage-index surface: the places render BELOW the sets grid on
// setsHome, and only OPENING one is a surface of its own. Recorded here because this file is where
// the shape is enforced, and it was got wrong once.
//
// Both matter because the nav cache survives an unmount (a Codex hand-off, the scanner), so
// stale values genuinely do sit in state while another view is active.
//
// Keep this dumb: it decides WHICH surface, never what the surface is given. Anything that
// needs data belongs in the component.
export const COLLECTION_SURFACES = ['overview', 'setDrill', 'setsHome', 'listDetail', 'listsIndex', 'storageDetail'];

/**
 * @param {{ view?: string, setDrill?: string|null, listOpen?: object|null, placeOpen?: object|null }} state
 * @returns {'overview'|'setDrill'|'setsHome'|'listDetail'|'listsIndex'|'storageDetail'}
 */
export function collectionSurface({ view, setDrill, listOpen, placeOpen } = {}) {
  if (view === 'cards') {
    // A set drill outranks an open place: both are deeper layers of My Collection, and a stale
    // place must not pull the user out of a set they opened.
    if (setDrill != null) return 'setDrill';
    if (placeOpen) return 'storageDetail';
    return 'setsHome';
  }
  if (view === 'lists') return listOpen ? 'listDetail' : 'listsIndex';
  // Overview is the fallback, not just the 'overview' case: an unrecognised view (a stale
  // cache from an older build, say) must land somewhere real rather than render nothing.
  return 'overview';
}
