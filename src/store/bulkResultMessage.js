// User-facing copy for a bulk command result.
//
// Deliberately adjacent to the result contract in bulkOwnedRepository.js rather than in a
// component, so the two cannot drift and so this is covered by the store suite. It is the one
// place allowed to put a bulk outcome into words.
//
// The rule it exists to enforce: PAST-TENSE SUCCESS MAY ONLY BE FORMED FROM A CONFIRMED
// RESULT. An earlier version of the domain module returned strings like "Added 1 to 42 cards"
// from a plan, which let a caller announce durable work before - or instead of - it landing.
// Here the unconfirmed branch returns first and has no access to counts, because the contract
// nulls them; there is no path from confirmed:false to a success sentence.
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const APPLIED = {
  add1: (n) => `Added 1 to ${plural(n, 'card', 'cards')}`,
  ensure1: (n) => `Marked ${plural(n, 'card', 'cards')} as owned`,
  remove1: (n) => `Removed 1 from ${plural(n, 'card', 'cards')}`,
};

/**
 * @param result  from applyBulkOwned
 * @param op      the operation that produced it
 * @returns { tone: 'success'|'warning'|'neutral', text, canUndo }
 */
export function bulkApplyMessage(result, op) {
  if (!result) return { tone: 'neutral', text: '', canUndo: false };
  if (!result.confirmed) {
    // No counts exist to report and none may be invented. The wording must not imply the
    // write failed either - it probably landed, we simply cannot prove what it did.
    return {
      tone: 'warning',
      text: `Saved ${plural(result.attempted, 'change', 'changes')}, but could not confirm them. Reopen the set to check.`,
      canUndo: false,
    };
  }
  if (!result.changed) {
    return {
      tone: 'neutral',
      text: result.unchanged ? 'Nothing to change - those cards were already up to date' : 'Nothing to change',
      canUndo: false,
    };
  }
  const base = (APPLIED[op] || APPLIED.add1)(result.changed);
  const tail = result.unchanged ? ` · ${result.unchanged} already up to date` : '';
  return { tone: 'success', text: base + tail, canUndo: Boolean(result.undo) };
}

/**
 * @param result  from undoBulkOwned
 * @returns { tone, text }
 */
export function bulkUndoMessage(result) {
  if (!result) return { tone: 'neutral', text: '' };
  if (!result.confirmed) {
    return {
      tone: 'warning',
      text: `Tried to undo ${plural(result.attempted, 'change', 'changes')}, but could not confirm the result.`,
    };
  }
  if (!result.applied) {
    return {
      tone: 'warning',
      text: result.conflicts
        ? 'Nothing was undone - those cards changed since'
        : 'Nothing to undo',
    };
  }
  // Conflicts are surfaced, never swallowed: the user asked to reverse N rows and some of
  // them were deliberately left alone to protect a later edit. Saying only "undone" would
  // misrepresent what the collection now holds.
  const base = `Undid ${plural(result.applied, 'change', 'changes')}`;
  return {
    tone: result.conflicts ? 'warning' : 'success',
    text: result.conflicts ? `${base} · ${result.conflicts} kept, changed since` : base,
  };
}
