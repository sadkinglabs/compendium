// The pending-printing queue and the batch-add summary, as pure data.
//
// Adding a reprint the user has no existing want for cannot resolve on its own - the collector
// item is genuinely unknown until they pick. Those adds wait in a FIFO here while the picker
// asks about each in turn.
//
// TWO THINGS THIS EXISTS TO STOP.
//   1. A dropped quantity. The queue entry keeps the ORIGINAL delta. Replaying a deferred pick
//      with a hardcoded 1 turned a reviewed "add 4" into "add 1" silently.
//   2. A lie in the copy. The batch summary counts what was APPLIED separately from what is
//      still WAITING, so "Added 3 cards" is never said about cards the user has not yet
//      resolved and may still skip.

/** What one add resolved to. addStep returns one of these. */
export const ADD_APPLIED = 'applied';           // written (optimistically)
export const ADD_CHOICE_REQUIRED = 'choice-required';   // queued for the picker
export const ADD_REFUSED = 'refused';           // catalog knows no printing; nothing done

export const enqueuePick = (queue, entry) => [...queue, entry];
export const dequeuePick = (queue) => queue.slice(1);
export const headPick = (queue) => (queue.length ? queue[0] : null);

/**
 * The single existing want-row key for a card, or null.
 *
 * When a card has exactly one want already, an add - of either sign - steps THAT item rather
 * than asking again about a decision the user has already made. Deliberately independent of the
 * delta: reuse is about identity, not direction.
 *
 * @param itemKeys keys of the current goal map, shaped `${card_id}|${slug}`
 */
export function soleExistingItem(itemKeys, cardId) {
  const prefix = `${cardId}|`;
  const mine = [...itemKeys].filter((k) => String(k).startsWith(prefix));
  return mine.length === 1 ? mine[0] : null;
}

/**
 * Honest copy for a finished batch of adds.
 *
 * `Added N` counts only what actually applied. Cards still waiting for a printing choice are
 * reported as choices, never as additions - the whole point, since they can still be skipped.
 * Refused cards said their own per-card warning already and are not re-counted here.
 *
 * An UNKNOWN status - `undefined` from a missing return, say - is counted as neither applied
 * nor a choice. A missing return is a bug, and laundering it into "Added" is the fail-open
 * failure mode this whole branch kept getting burned by; the honest move is to not claim it.
 *
 * @returns a message, or null when there is nothing truthful to say
 */
export function batchAddSummary(results) {
  const applied = results.filter((r) => r === ADD_APPLIED).length;
  const choices = results.filter((r) => r === ADD_CHOICE_REQUIRED).length;
  const cards = (n) => `${n} card${n === 1 ? '' : 's'}`;
  const printings = (n) => `printing${n === 1 ? '' : 's'}`;

  if (!applied && !choices) return null;
  if (!choices) return `Added ${cards(applied)}`;
  if (!applied) return `Choose ${printings(choices)} for ${cards(choices)}`;
  return `Added ${applied}, choose ${printings(choices)} for ${choices} more`;
}
