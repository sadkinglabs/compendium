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

/**
 * Partition previewCollectionText output into the review model:
 *   - single : lines whose printing is determined - filed automatically (annotation-resolved, or
 *              a single-set card). Each carries its own { setCode, foil }.
 *   - multi  : lines that need a set choice (0/2+ sets, or an annotation that did not resolve).
 *              They still carry the intended `foil` so an uncategorised item can land foil.
 *   - unresolved : names that matched no card - skipped.
 * choiceDefaults seeds every multi card's choice to '' (Unspecified).
 * @returns {{ single: any[], multi: any[], unresolved: string[], choiceDefaults: Record<string,string> }}
 */
export function planCollectionImport({ items, unresolved }) {
  const single = items.filter(autoFiles);
  const multi = items.filter((i) => !autoFiles(i));
  const choiceDefaults = /** @type {Record<string, string>} */ ({});
  for (const i of multi) choiceDefaults[i.card_id] = '';      // '' = Unspecified
  return { single, multi, unresolved: unresolved || [], choiceDefaults };
}

/**
 * Assemble importCollectionResolved's write items from the reviewed plan + the user's set choices.
 * A determined line files its resolved (setCode, foil); a legacy single-set line files its sole
 * set non-foil; a multi line files the chosen set (or '' = Uncategorised) at its intended finish.
 * Every item carries an explicit boolean `foil` - the hardened writer rejects a non-boolean.
 * @returns {Array<{card_id:string, qty:number, setCode:string, foil:boolean}>}
 */
export function buildImportItems({ single, multi }, choice = {}) {
  return [
    ...single.map((i) => (i.resolved
      ? { card_id: i.card_id, qty: i.qty, setCode: i.resolved.setCode, foil: !!i.resolved.foil }
      : { card_id: i.card_id, qty: i.qty, setCode: i.sets[0].code, foil: false })),
    ...multi.map((i) => ({ card_id: i.card_id, qty: i.qty, setCode: choice[i.card_id] || '', foil: !!i.foil })),
  ];
}

/**
 * Review tallies for the sheet header/CTA. totalCopies sums single+multi only (unresolved is
 * skipped, so it never contributes copies).
 * @param {{ single: any[], multi: any[], unresolved?: any[] }} plan
 * @returns {{ nSingle:number, nMulti:number, nBad:number, totalCopies:number }}
 */
export function importTallies({ single, multi, unresolved }) {
  return {
    nSingle: single.length,
    nMulti: multi.length,
    nBad: (unresolved || []).length,
    totalCopies: [...single, ...multi].reduce((s, i) => s + i.qty, 0),
  };
}
