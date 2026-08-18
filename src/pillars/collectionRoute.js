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
//   - `placeOpen` only means anything while `view === 'storage'`, and it is listed for the same
//     reason as the other two: it is a third drill state in the same surviving cache, so it goes
//     stale in exactly the same way.
//
// Both matter because the nav cache survives an unmount (a Codex hand-off, the scanner), so
// stale values genuinely do sit in state while another view is active.
//
// Keep this dumb: it decides WHICH surface, never what the surface is given. Anything that
// needs data belongs in the component.
export const COLLECTION_SURFACES = ['overview', 'setDrill', 'setsHome', 'listDetail', 'listsIndex', 'storageDetail', 'storageIndex'];

/**
 * @param {{ view?: string, setDrill?: string|null, listOpen?: object|null, placeOpen?: object|null }} state
 * @returns {'overview'|'setDrill'|'setsHome'|'listDetail'|'listsIndex'|'storageDetail'|'storageIndex'}
 */
export function collectionSurface({ view, setDrill, listOpen, placeOpen } = {}) {
  if (view === 'cards') return setDrill != null ? 'setDrill' : 'setsHome';
  if (view === 'lists') return listOpen ? 'listDetail' : 'listsIndex';
  if (view === 'storage') return placeOpen ? 'storageDetail' : 'storageIndex';
  // Overview is the fallback, not just the 'overview' case: an unrecognised view (a stale
  // cache from an older build, say) must land somewhere real rather than render nothing.
  return 'overview';
}
