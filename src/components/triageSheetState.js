// Triage sheet bookkeeping, extracted so it can be tested without rendering.
//
// The sheet is handed a pile it does not own: the parent reads it and re-reads it after a
// change. Between filing a line and that re-read arriving, the line is still in the prop - so
// the sheet keeps its own record of what it has already filed and subtracts it. Without that
// subtraction a filed line stays tappable and a second tap files a quantity that is no longer
// there.
import { OWNED_FOIL, WANTED } from '../store/triage.js';

/** Identity of one decision. Card plus kind, because owned and wanted are filed separately. */
export const lineKey = (cardId, kind) => `${cardId}::${kind}`;

/** The pile minus what this session has already filed. Entries left with no lines disappear. */
export function visiblePile(pile, filed) {
  const out = [];
  for (const entry of pile || []) {
    const lines = (entry.lines || []).filter((l) => !filed?.has(lineKey(entry.card_id, l.kind)));
    if (lines.length) out.push({ ...entry, lines });
  }
  return out;
}

/**
 * The decisions a bulk resolve would make, each carrying the entry and line it came from.
 *
 * `autoResolvable` in triage.js answers the same question, but flattens the line away - and
 * `fileLinePlan` needs the entry and the line object itself, because a line's provenance is what
 * tells filing which rows to drain. So this derives the same single-set rule in the shape the
 * write path actually takes.
 */
export function bulkDecisions(pile) {
  return (pile || [])
    .filter((e) => e.sets?.length === 1)
    .flatMap((e) => (e.lines || []).map((line) => ({ entry: e, line, set: e.sets[0] })));
}

/**
 * What a line is, in words. The finish is stated because it is already settled - triage asks
 * about the set and nothing else, so showing the finish is a report, never an offer.
 */
export function lineDescription(line) {
  if (line?.kind === WANTED) return 'Wanted · Non-foil';
  return line?.kind === OWNED_FOIL ? 'Owned · Foil' : 'Owned · Non-foil';
}

/**
 * An honest sentence for a batch of results.
 *
 * `confirmed` is the only success signal the repository gives, so an unconfirmed write is
 * counted apart from a filed one and never folded into the success number. Reporting "filed 6"
 * when two of them could not be verified is exactly the claim the result contract forbids.
 */
export function applySummary({ filed, unconfirmed, failed, total }) {
  const parts = [`Filed ${filed} of ${total}`];
  if (unconfirmed) parts.push(`${unconfirmed} unconfirmed`);
  if (failed) parts.push(`${failed} failed`);
  return `${parts.join(' - ')}.`;
}
