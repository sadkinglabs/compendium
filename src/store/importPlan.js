// Pure planning for text-import to the collection - the single/multi/Unspecified printing
// routing and the confirm-item assembly, lifted out of the ImportTextSheet component so the
// "which printing does this card land in" decision is provable without a DOM or the DB.
// Run: npm run test:query
//
// The RESOLVER (previewCollectionText) and the WRITE (importCollectionResolved) stay in the
// repo; this module owns only the pure shaping between them. It models the COLLECTION printing
// import specifically (cards carry a `sets` list); the list bulk-add sheet has a different shape
// ({adds, unresolved}, no printing choice) and keeps its own local tally.

/**
 * Partition previewCollectionText output into the review model:
 *   - single : cards printed in exactly one set - filed automatically to that set.
 *   - multi  : cards printed in 0 or 2+ sets - need a set choice (default Unspecified).
 *   - unresolved : names that matched no card - skipped.
 * choiceDefaults seeds every multi card's choice to '' (Unspecified).
 * @param {{ items: Array<{card_id:string, qty:number, sets:Array<{code:string,name:string}>}>, unresolved?: string[] }} preview
 * @returns {{ single: any[], multi: any[], unresolved: string[], choiceDefaults: Record<string,string> }}
 */
export function planCollectionImport({ items, unresolved }) {
  const single = items.filter((i) => i.sets.length === 1);
  const multi = items.filter((i) => i.sets.length !== 1);   // 0 or 2+ sets need a choice
  const choiceDefaults = /** @type {Record<string, string>} */ ({});
  for (const i of multi) choiceDefaults[i.card_id] = '';      // '' = Unspecified
  return { single, multi, unresolved: unresolved || [], choiceDefaults };
}

/**
 * Assemble importCollectionResolved's write items from the reviewed plan + the user's set
 * choices: single files to its sole set; multi files to the chosen set (or '' = Unspecified).
 * @param {{ single: any[], multi: any[] }} plan
 * @param {Record<string,string>} choice  card_id -> setCode ('' = Unspecified)
 * @returns {Array<{card_id:string, qty:number, setCode:string}>}
 */
export function buildImportItems({ single, multi }, choice = {}) {
  return [
    ...single.map((i) => ({ card_id: i.card_id, qty: i.qty, setCode: i.sets[0].code })),
    ...multi.map((i) => ({ card_id: i.card_id, qty: i.qty, setCode: choice[i.card_id] || '' })),
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
