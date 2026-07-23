// Picker interaction state, extracted so it can be tested without rendering.
//
// The bug this exists to prevent: `foil` was reset only inside the confirm path, so Cancel, the
// backdrop and hardware back all left it set. Choose Foil, cancel, open a different card, tap a
// set - and that want was silently stored as foil. Every exit has to land on the same reset,
// which is far easier to guarantee in a reducer than across three handlers.
import { DEFAULT_WANT_FOIL } from '../store/wantIntent.js';

export const initialWantPicker = { foil: DEFAULT_WANT_FOIL, cardId: null };

export function wantPickerReducer(state, action) {
  switch (action.type) {
    // A newly opened card starts from the finish the caller was already on (the sheet's active
    // Standard/Foil toggle), falling back to the default when none is supplied. Carrying the
    // PREVIOUS card's finish over would be a bug - that choice was about another card - so the seed
    // is taken only on the transition to a new card, never re-applied on a same-card re-open.
    case 'open':
      return action.cardId === state.cardId
        ? state
        : { foil: action.foil == null ? DEFAULT_WANT_FOIL : !!action.foil, cardId: action.cardId };
    case 'setFoil':
      return { ...state, foil: !!action.foil };
    // ONE exit. Cancel, backdrop and back all dispatch this, so none of them can forget.
    case 'close':
      return { foil: DEFAULT_WANT_FOIL, cardId: null };
    default:
      return state;
  }
}
