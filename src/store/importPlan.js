// Pure planning for text-import to the collection - the single/multi/Unspecified printing
// routing and the confirm-item assembly, lifted out of the ImportTextSheet component so the
// "which printing does this card land in" decision is provable without a DOM or the DB.
// Run: npm run test:query
//
// The RESOLVER (previewCollectionText) and the WRITE (importCollectionResolved) stay in the
// repo; this module owns only the pure shaping between them. It models the COLLECTION printing
// import specifically (cards carry a `sets` list); the list bulk-add sheet has a different shape
// ({adds, unresolved}, no printing choice) and keeps its own local tally.

// A line files automatically (no review) when previewCollectionText DETERMINED its printing -
// `resolved` is a { setCode, foil } object - OR, for a hand-built/legacy item that predates
// annotation resolution, when the card is printed in exactly one set. A line preview explicitly
// could not determine carries `resolved: null` (a single-set [Foil] whose set has no foil, say)
// and falls to review despite having one set.
const autoFiles = (i) => !!i.resolved || (i.resolved === undefined && i.sets.length === 1);

// The COLLECTOR-ITEM identity a review row is keyed by. previewCollectionText sets it; a hand-built
// item falls back to a derived key so choices, React keys, and a11y labels never collide two
// printings of one card onto the same card_id (which showed both as Alpha and shared one set choice).
export const itemKey = (i) => i.key || `${i.card_id}|${(i.setToken || '')}|${i.foil ? 1 : 0}`;

/**
 * Partition previewCollectionText output into the review model:
 *   - single : lines whose printing is determined - filed automatically (annotation-resolved, or
 *              a single-set card). Each carries its own { setCode, foil }.
 *   - multi  : lines that need a set choice (0/2+ sets, or an annotation that did not resolve).
 *              They still carry the intended `foil` so an uncategorised item can land foil.
 *   - unresolved : names that matched no card - skipped.
 *   - flagged : lines with a grammar problem - surfaced, never written.
 * choiceDefaults seeds every multi item's choice to '' (Unspecified), keyed by collector-item
 * identity so two unresolved printings of one card get independent choices.
 * @returns {{ single, multi, unresolved, flagged, choiceDefaults }}
 */
export function planCollectionImport({ items, unresolved, flagged }) {
  const single = items.filter(autoFiles);
  const multi = items.filter((i) => !autoFiles(i));
  const choiceDefaults = /** @type {Record<string, string>} */ ({});
  for (const i of multi) choiceDefaults[itemKey(i)] = '';      // '' = Unspecified
  return { single, multi, unresolved: unresolved || [], flagged: flagged || [], choiceDefaults };
}

/**
 * Assemble importCollectionResolved's write items from the reviewed plan + the user's set choices.
 * A determined line files its resolved (setCode, foil); a legacy single-set line files its sole set
 * non-foil; a multi line files the chosen set (or '' = Uncategorised) at its intended finish.
 *
 * Each item is EXPANDED back into its per-line `parts` so the durable writer receives the same
 * contributions the user typed and does the merging itself - `999 x + 999 x` reaches the writer as
 * two 999 items that merge to 1998, never one 1998 item it would reject. `foil` must be a real
 * boolean; a malformed internal value throws here rather than being coerced past the writer.
 * @returns {Array<{card_id:string, qty:number, setCode:string, foil:boolean}>}
 */
export function buildImportItems({ single, multi }, choice = {}) {
  const boolFoil = (f) => {
    if (typeof f !== 'boolean') throw new Error('buildImportItems: foil must be a boolean');
    return f;
  };
  const out = [];
  const emit = (cardId, setCode, foil, parts) => {
    for (const qty of parts) out.push({ card_id: cardId, qty, setCode, foil });
  };
  for (const i of single) {
    const setCode = i.resolved ? i.resolved.setCode : i.sets[0].code;
    emit(i.card_id, setCode, boolFoil(i.resolved ? i.resolved.foil : false), i.parts || [i.qty]);
  }
  for (const i of multi) {
    emit(i.card_id, choice[itemKey(i)] || '', boolFoil(i.foil), i.parts || [i.qty]);
  }
  return out;
}

/**
 * Review tallies for the sheet header/CTA. totalCopies sums single+multi only (unresolved and
 * flagged are skipped, so neither contributes copies). nCards is the DISTINCT card count, so two
 * printings of one card read as one card, matching what the writer reports.
 * @returns {{ nSingle, nMulti, nBad, nFlagged, nItems, nCards, totalCopies }}
 */
export function importTallies({ single, multi, unresolved, flagged }) {
  const writable = [...single, ...multi];
  return {
    nSingle: single.length,
    nMulti: multi.length,
    nBad: (unresolved || []).length,
    nFlagged: (flagged || []).length,
    nItems: writable.length,
    nCards: new Set(writable.map((i) => i.card_id)).size,
    totalCopies: writable.reduce((s, i) => s + i.qty, 0),
  };
}
