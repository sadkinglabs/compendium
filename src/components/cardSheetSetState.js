// Which set the card sheet SHOWS, and which set the user actually CHOSE.
//
// These were one value, and conflating them reintroduced the defect v11 exists to remove. The
// sheet must always have a set so it has art and counts to render, so an effect picks one as
// soon as ownership loads. Writing that pick into the same state a segment tap writes to made
// every automatic default indistinguishable from a deliberate choice - and the heart then wrote
// Alpha for an Alpha/Beta card the user had never expressed an opinion about.
//
// Extracted so the distinction is testable without rendering. The previous test passed `null`
// by hand and therefore never exercised the state that actually passes Alpha.

/**
 * @param openedAt the `set` prop - the set the sheet was opened at. Explicit: the caller
 *                 navigated from a set-scoped surface, so the user has already said which.
 */
export const initialSetState = (openedAt = null) => ({
  display: openedAt ?? null,
  explicit: openedAt ?? null,
});

export function cardSheetSetReducer(state, action) {
  switch (action.type) {
    // A segment tap. The only in-sheet action that establishes intent.
    case 'select':
      return { display: action.set, explicit: action.set };

    // The smart default, applied once when ownership first loads. It fills DISPLAY only: it is
    // an inference from what the user happens to own, not a statement about what they want.
    case 'default':
      return state.display != null ? state : { display: action.set ?? null, explicit: state.explicit };

    default:
      return state;
  }
}

/** The set a want gesture may treat as context. Null means "ask". */
export const explicitSetOf = (state) => state.explicit ?? null;
/** The set the sheet renders art, counts and steppers for. */
export const displaySetOf = (state, fallback = '') => state.display ?? fallback;
