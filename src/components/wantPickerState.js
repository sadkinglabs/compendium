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
    // A newly opened card starts from the default. Carrying the previous card's finish over
    // would be a different flavour of the same bug: the choice was made about another card.
    case 'open':
      return action.cardId === state.cardId ? state : { foil: DEFAULT_WANT_FOIL, cardId: action.cardId };
    case 'setFoil':
      return { ...state, foil: !!action.foil };
    // ONE exit. Cancel, backdrop and back all dispatch this, so none of them can forget.
    case 'close':
      return { foil: DEFAULT_WANT_FOIL, cardId: null };
    default:
      return state;
  }
}
