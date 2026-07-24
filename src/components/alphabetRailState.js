// The alphabet-rail JUMP COORDINATOR as a pure reducer, so the load-bearing sequencing - wait for the
// growth paint, supersede a stale pick, cancel on a filter/membership change, commit exactly once, and
// announce only a committed destination - is a unit test, not a device round-trip. The React shell
// (AlphabetRail.jsx) owns the DOM side effects (ensureRendered, querySelector, scrollTop) and dispatches
// events into this reducer; `committedLetter` is the ONLY thing that drives the live-region announcement.
//
// Flow:  PICK -> (shell calls ensureRendered) -> OBSERVE(count,signature,modelKey) sets `ready` when the
//        target row is rendered and the pick is still valid -> shell scrolls -> COMMIT_OK / COMMIT_MISS.
//
// Cancellation is keyed on the DETERMINISTIC modelKey (stable id sequence), never object identity: an
// equivalent re-allocation keeps the same modelKey and does not cancel a live jump, while a real
// membership/order change (or a signature change) does.

export const initialRailState = { pending: null, ready: false, committedLetter: null };

export function railReducer(state, event) {
  switch (event.type) {
    case 'PICK': {
      // A newer pick supersedes an older one; the stale requestId can never commit.
      const { requestId, signature, modelKey, letter, idx } = event;
      return { ...state, pending: { requestId, signature, modelKey, letter, idx }, ready: false };
    }
    case 'OBSERVE': {
      // Re-run whenever pending/count/signature/modelKey change. Cancels a pick whose world moved;
      // otherwise flags readiness once the growth paint includes the 0-based target index.
      if (!state.pending) return state;
      if (state.pending.signature !== event.signature || state.pending.modelKey !== event.modelKey) {
        return { ...state, pending: null, ready: false };   // filter/sort/group/membership/duck cancelled it
      }
      const ready = event.count > state.pending.idx;         // idx is 0-based; count must exceed it
      return ready === state.ready ? state : { ...state, ready };
    }
    case 'COMMIT_OK': {
      // The shell found the anchor and scrolled. Announce this destination; clear the pick.
      if (!state.pending || !state.ready || state.pending.requestId !== event.requestId) return state;
      return { pending: null, ready: false, committedLetter: state.pending.letter };
    }
    case 'COMMIT_MISS': {
      // Anchor missing (fail closed): drop the pick with NO announcement and NO committed change.
      if (!state.pending || state.pending.requestId !== event.requestId) return state;
      return { ...state, pending: null, ready: false };
    }
    case 'CANCEL':
      return { ...state, pending: null, ready: false };      // explicit teardown/duck/unmount
    default:
      return state;
  }
}

/** Whether the shell should now attempt the scroll for the current pick. */
export const shouldCommit = (state) => !!(state.pending && state.ready);
