// What a "want" gesture should do - decided as pure data, before any sheet opens.
//
// The rule from the proposal is that a NEW want always identifies both its set and its finish.
// Migration may create an unresolved one; a writer may not. So every entry point has to answer
// the same question first: do we already know which collector item the user means?
//
// FINISH IS NEVER ASKED. §7.4 gives it an explicit product default - non-foil. A set is
// completed in non-foil, so that is the copy a bare "I want this" refers to. Offering a foil
// choice on every heart would tax the common case to serve the rare one; wanting a foil
// specifically is a deliberate act, made in the picker.
//
// SET IS ASKED ONLY WHEN IT IS GENUINELY UNKNOWABLE. Guessing it is the original defect: the
// wishlist rendered ALPHA for a card whose copies were Beta, purely because Alpha sorted first.
import { UNCATEGORISED_BUCKET, UNCATEGORISED, UNCATEGORISED_FOIL } from './printings.js';

/** The product default finish for a want. Non-foil, per §7.4. */
export const DEFAULT_WANT_FOIL = false;

/**
 * Decide what a want gesture resolves to.
 *
 * @param setCodes the card's set codes, from the catalog
 * @param context  { set } - the set the surface is already scoped to, if any. The card sheet
 *                 has one selected; a search row or Codex entry does not.
 * @returns { kind: 'item', item: { set, foil } }        write it, no questions
 *          { kind: 'ask', options: string[] }          open the picker
 *          { kind: 'unknown' }                          the catalog has no sets for this card
 */
export function wantTarget(setCodes, { set } = {}) {
  // Deduplicated: a catalog entry that lists a set twice must not make a single-set card look
  // like a reprint, which would ask a question with only one possible answer.
  const sets = [...new Set((Array.isArray(setCodes) ? setCodes : []).filter(Boolean))];

  // A scoped surface is trusted ONLY when the card is actually printed in that set.
  //
  // Context arrives from navigation, and navigation goes stale: a set drill left open while the
  // catalog updates, a card opened from one set's grid and swiped to another. An unchecked
  // context would write a collector item that does not exist - '999' for an Alpha/Beta card -
  // which no reader can ever bucket and no triage can resolve.
  //
  // The uncategorised keys are rejected for a different reason: they are not sets at all, and
  // honouring one would create exactly the unresolved want §2.1 forbids new writers from making.
  const scoped = set && set !== UNCATEGORISED_BUCKET && set !== UNCATEGORISED && set !== UNCATEGORISED_FOIL;
  if (scoped && sets.includes(set)) return { kind: 'item', item: { set, foil: DEFAULT_WANT_FOIL } };

  // One set means there is nothing to disambiguate. This is not a guess: a card printed in a
  // single set can only be wanted from that set.
  if (sets.length === 1) return { kind: 'item', item: { set: sets[0], foil: DEFAULT_WANT_FOIL } };

  // A card the catalog does not place in any set. Nothing to offer and nothing to infer.
  if (sets.length === 0) return { kind: 'unknown' };

  // A reprint. The user knows which one they need; we do not.
  return { kind: 'ask', options: sets };
}

/** True when this gesture will open the picker rather than write immediately. */
export function needsPicker(setCodes, context) {
  return wantTarget(setCodes, context).kind === 'ask';
}

/**
 * The options a picker should show, in the order it should show them.
 *
 * Ranked by the caller's set ordering so the picker matches every other set control in the app;
 * an unranked set sorts last rather than first, so a new set the app does not know about cannot
 * silently become the default choice.
 */
export function pickerOptions(setCodes, setRank = () => 0, setLabel = {}) {
  return (Array.isArray(setCodes) ? setCodes : [])
    .filter(Boolean)
    .map((code) => ({ code, name: setLabel[code] || code }))
    .sort((a, b) => (setRank(a.code) ?? 99) - (setRank(b.code) ?? 99));
}
