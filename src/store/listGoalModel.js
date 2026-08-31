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
 * The shortfall per card, in the shape `addMissingToWishlist` consumes: `[{ card_id, missing }]`.
 * Same capping rule as goalTotals, so an over-owned card is simply absent rather than emitting a
 * negative or zero line. Entries with target <= 0 are ignored (a removed goal), and a card the
 * owned map has never heard of counts as owned 0. The target guard and the cap mirror goalTotals
 * for readability; here the `missing <= 0` filter already subsumes both, so no fixture can tell
 * them apart. Do not read their presence as tested behavior.
 * @param {Map<string, number>} qty     card_id -> wanted target
 * @param {Map<string, number>} ownQty  card_id -> live owned count (read-only)
 * @returns {{ card_id:string, missing:number }[]}
 */
export function missingGoalLines(qty, ownQty) {
  const lines = [];
  for (const [id, t] of qty) {
    if (t <= 0) continue;
    const missing = t - Math.min(ownQty.get(id) || 0, t);
    if (missing <= 0) continue;
    lines.push({ card_id: id, missing });
  }
  return lines;
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

// Whether a ledger broadcast (subscribeCollection) must re-read a list's ROWS, not just its
// owned counts. The virtual Wishlist IS the qty_wanted ledger, so an external toggle - e.g.
// the card sheet's heart opened over the open Wishlist - changes its membership. Regular
// lists live in card_list_entries and are untouched by ledger writes. Skipped while local
// goal writes are in flight, so a refresh can't trample an optimistic edit (the goal drain
// reconciles those itself).
export function listRowsNeedLedgerRefresh({ isWishlist, pendingGoalWrites = 0 }) {
  return !!isWishlist && pendingGoalWrites === 0;
}

// Whether an external ledger snapshot may be applied AFTER its async read resolves. Checking
// only before the read is not enough: a local edit can begin while the read is in flight, and
// the older snapshot would then overwrite the newer optimistic state - the same stale-snapshot
// race collectionGoalDrain guards for local writes. So re-check on arrival: still mounted, no
// local goal write in flight, and no local edit since we started (generation unchanged).
export function canApplyExternalRows({ cancelled, pendingGoalWrites = 0, genAtStart, genNow }) {
  return !cancelled && pendingGoalWrites === 0 && genAtStart === genNow;
}
