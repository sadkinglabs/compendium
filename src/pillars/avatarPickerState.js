// Selection state for the avatar picker (src/pillars/AvatarPicker.jsx), kept pure
// and separate from the component so the tap semantics are testable without a DOM.
// Run the fixtures: npm run test:ui
//
// Why this exists: the picker's tap rules ARE the mirror-match feature, and they
// were previously an if-chain over three independent useStates plus a hidden
// `unwinding` history flag. That flag made two identical-looking states behave
// differently (same screen, same gesture, opposite result), and its correctness
// depended on every writer of you/opp remembering to reset it - which pickDeck's
// unlink path did not.
//
// The model instead:
//   - Selection is ONE atomic value, so no writer can desynchronise part of it.
//   - The armed slot is *visible* - a lit, pulsing socket - never history. See
//     armedRole().
//
// DESIGN AUTHORITY (project owner's decision; recorded here because the diff alone
// makes it look like an oversight). Review of the earlier model required "a selected
// YOU card must deselect from YOU with one ordinary tap". This code does not do that,
// on purpose. The owner's reasoning, and why it holds:
//
//   "Arm YOU with glow... As soon as YOU picks an avatar, Arm OPP with the glow.
//    I think that makes it all clear... After picking, show 'Tap to deselect' under
//    the picked avatar."
//
// Auto-arming forces the choice: if OPPONENT is lit the instant YOU fills, then a
// tap on the card in YOU must fill OPPONENT, because the light says it will. Making
// that same tap deselect instead would make the glow a lie - the one property this
// design cannot trade. So deselection moves onto the slots, which carry the words.
// The review's *reason* for that requirement was two identical-looking states
// behaving differently under one gesture. That is gone: the armed slot is derived,
// always visible, and always honoured, so no tap depends on invisible state.
// One-tap deselect still exists - on the slot, and now labelled.
//
// Avatars are compared by card_id; `you`/`opponent` hold whole avatar objects
// ({ card_id, name, image_slug }) because the view needs name + art.

export const initialSelection = { you: null, opponent: null, targetedRole: null, deck: null };

const isCard = (slot, card) => !!slot && !!card && slot.card_id === card.card_id;

/** Which roles this card currently occupies. */
export function rolesOf(state, card) {
  return { you: isCard(state.you, card), opponent: isCard(state.opponent, card) };
}

/**
 * The armed slot: where the next card tap lands, and the only thing the glow ever
 * promises. It auto-advances - YOU while empty, then OPPONENT - so the common path
 * needs no aiming at all, and `targetedRole` exists only to override that order
 * (choosing the opponent first).
 *
 * Derived, never stored. That is the whole safety argument: the light and the tap
 * read this one function, so they cannot disagree, and there is no flag for a future
 * writer to forget to reset - which is exactly how the previous model broke.
 *
 * Null once both are full: the slots are then the only way to change the matchup,
 * which is what their "Tap to deselect" caption says.
 */
export function armedRole(state) {
  if (state.targetedRole) return state.targetedRole;
  if (!state.you) return 'you';
  if (!state.opponent) return 'opponent';
  return null;
}

export function selectionReducer(state, action) {
  switch (action.type) {
    // A tap on a card in the grid. It always fills the armed slot - no exceptions,
    // including when the card already holds the other role, which is how one avatar
    // reaches both sides. One rule, and the glow shows where it lands before the tap.
    // Deselection deliberately does NOT live here: a card tap that sometimes filled
    // and sometimes removed would make the glow a lie. It lives on the slots, which
    // say so.
    case 'tapAvatar': {
      const armed = armedRole(state);
      if (!armed) return state;   // both full - the slots are the only way on from here
      return { ...state, [armed]: action.card, targetedRole: null };
    }

    // A tap on one of the YOU / OPPONENT matchup slots.
    case 'tapSlot': {
      const role = action.role;
      // Populated: clear precisely that role. It then re-arms on its own, because
      // the emptiest slot is always the next target.
      if (state[role]) return { ...state, [role]: null, targetedRole: null };
      // Empty: aim here explicitly, overriding the YOU-then-OPPONENT order so the
      // opponent can be chosen first. Tapping it again releases the override.
      return { ...state, targetedRole: state.targetedRole === role ? null : role };
    }

    // A tap on a deck chip in the PILOT A DECK rail.
    case 'pickDeck': {
      const d = action.deck;
      // Same deck again unlinks it. The avatar it filled stays - unlinking is
      // about the deck's W-L ledger, not about undoing your pick.
      if (state.deck?.id === d.id) return { ...state, deck: null };
      const next = { ...state, deck: { id: d.id, name: d.name } };
      // A deck's own avatar fills YOU (still editable). A deck without one links
      // the ledger and leaves the pick alone.
      if (d.avatar) {
        next.you = { card_id: d.avatar.card_id, name: d.avatar.name, image_slug: d.avatar.image_slug };
        // Only a YOU target is spent - the deck just filled it. An opponent target
        // is still owed and still visibly pulsing, so dropping it would be a lie.
        if (state.targetedRole === 'you') next.targetedRole = null;
      }
      return next;
    }

    default:
      return state;
  }
}

/** Both roles chosen - the Continue button's gate. */
export const isReady = (state) => !!state.you && !!state.opponent;
/** The same avatar on both sides. */
export const isMirror = (state) => isCard(state.you, state.opponent);
