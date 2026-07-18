// Pure goal/progress math for the wishlist and custom lists - the completion model that drives
// every progress bar and the `complete` flag, lifted out of ListDetail so it is provable without
// a DOM. Run: npm run test:query
//
// The PERSISTED progress (listProgress in ownedRepository) stays in the repo; this owns the
// CLIENT-SIDE optimistic recompute that updates the bar the instant a goal changes, before the
// reconcile drain lands.

/**
 * Reduce the optimistic goal map and the live owned map into a list's progress totals.
 * Entries with target <= 0 are ignored (a removed goal). `have` is capped per card at its target,
 * so over-owning one card never inflates the bar or pushes `missing` negative.
 * @param {Map<string, number>} qty     card_id -> wanted target
 * @param {Map<string, number>} ownQty  card_id -> live owned count (read-only)
 * @returns {{ req:number, have:number, names:number, done:number, missing:number, percent:number, complete:boolean }}
 */
export function goalTotals(qty, ownQty) {
  let req = 0, have = 0, names = 0, done = 0;
  for (const [id, t] of qty) {
    if (t <= 0) continue;
    names++; req += t;
    const h = Math.min(ownQty.get(id) || 0, t);
    have += h; if (h >= t) done++;
  }
  return {
    req, have, names, done,
    missing: req - have,
    percent: req ? Math.round((have / req) * 100) : 0,
    complete: req > 0 && have >= req,
  };
}

/**
 * One card row's goal state. Only 'wanted' lists (isWanted) show completion; custom lists track
 * copies without a goal, so `goalMet` is always false for them.
 * @param {{ owned:number, target:number, isWanted:boolean }} row
 * @returns {{ goalMet:boolean, ownedAny:boolean }}
 */
export function goalRowState({ owned, target, isWanted }) {
  return { goalMet: isWanted && target > 0 && owned >= target, ownedAny: owned >= 1 };
}
