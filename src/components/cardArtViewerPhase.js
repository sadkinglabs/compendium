// The full-art viewer's ONE explicit visual phase. Extracted as a pure reducer because the bug it
// replaces was a state-transition defect: the old boolean choreography (open/armed/flipT) let the
// entry effect read "open === false with a valid flipT" as "start entering", so closing (which set
// open=false) rescheduled an ENTER on the next frame - reopening the viewer mid-exit. A monotonic
// phase makes that impossible: no event interprets `exiting` as a reason to enter again.
//
//   preparing → entering → open → exiting → closed
//                       ↘ exiting            (CLOSE from preparing/entering/open all reach exiting)
//
// PREPARED: the start transform is measured (FLIP) and the entrance begins.
// ENTERED : the entrance transition finished.
// CLOSE   : the user asked to leave (X, back, Escape) - always heads to exiting, never re-enters.
// EXITED  : the exit transition finished; the component may unmount.

export const initialViewerState = (reduce = false) => ({
  // Reduced motion has no animation: it opens immediately and closes immediately, so it starts OPEN.
  phase: reduce ? 'open' : 'preparing',
  startTransform: null,
});

export function viewerTransition(state, event) {
  switch (event.type) {
    case 'PREPARED':
      return state.phase === 'preparing'
        ? { ...state, phase: 'entering', startTransform: event.transform ?? null }
        : state;

    case 'ENTERED':
      return state.phase === 'entering'
        ? { ...state, phase: 'open' }
        : state;

    case 'CLOSE':
      // Idempotent, and a one-way door: exiting/closed never re-enter.
      return state.phase === 'exiting' || state.phase === 'closed'
        ? state
        : { ...state, phase: 'exiting' };

    case 'EXITED':
      return state.phase === 'exiting'
        ? { ...state, phase: 'closed' }
        : state;

    default:
      return state;
  }
}
