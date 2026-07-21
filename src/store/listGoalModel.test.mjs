// Fixtures for the list goal/progress math (src/store/listGoalModel.js).
// Run: npm run test:query   (node --test)
//
// Locks the completion model ListDetail used to compute inline: per-card have is capped at the
// target, done counts fully-met cards, missing is never negative, percent rounds, and complete
// requires a non-empty list fully owned. This drives every wishlist/list bar and the COMPLETE chip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalTotals, goalRowState, listRowsNeedLedgerRefresh, canApplyExternalRows } from './listGoalModel.js';

const m = (obj) => new Map(Object.entries(obj));

// --- goalTotals -----------------------------------------------------------------

test('a partially-owned list reports capped have, done, and rounded percent', () => {
  // want a:2 b:3 c:1 (req 6); own a:2 (met) b:1 c:0  -> have 2+1+0 = 3
  const t = goalTotals(m({ a: 2, b: 3, c: 1 }), m({ a: 2, b: 1, c: 0 }));
  assert.deepEqual(t, { req: 6, have: 3, names: 3, done: 1, missing: 3, percent: 50, complete: false });
});

test('over-owning a card never inflates have or drives missing negative', () => {
  // want a:1; own a:5 -> have capped at 1, missing 0, complete
  const t = goalTotals(m({ a: 1 }), m({ a: 5 }));
  assert.deepEqual(t, { req: 1, have: 1, names: 1, done: 1, missing: 0, percent: 100, complete: true });
});

test('targets <= 0 are ignored (a removed goal does not count)', () => {
  const t = goalTotals(m({ a: 2, b: 0 }), m({ a: 2, b: 9 }));
  assert.equal(t.names, 1);   // only a
  assert.equal(t.req, 2);
  assert.equal(t.complete, true);
});

test('an empty list is not complete and is 0%', () => {
  assert.deepEqual(goalTotals(new Map(), new Map()),
    { req: 0, have: 0, names: 0, done: 0, missing: 0, percent: 0, complete: false });
});

test('an unowned list is 0% with full missing', () => {
  const t = goalTotals(m({ a: 2, b: 2 }), new Map());
  assert.deepEqual(t, { req: 4, have: 0, names: 2, done: 0, missing: 4, percent: 0, complete: false });
});

test('percent rounds to the nearest whole (1 of 3 -> 33%)', () => {
  const t = goalTotals(m({ a: 3 }), m({ a: 1 }));
  assert.equal(t.percent, 33);
});

// --- goalRowState ---------------------------------------------------------------

test('a wanted row is met only when target>0 and owned>=target', () => {
  assert.deepEqual(goalRowState({ owned: 2, target: 2, isWanted: true }), { goalMet: true, ownedAny: true });
  assert.deepEqual(goalRowState({ owned: 1, target: 2, isWanted: true }), { goalMet: false, ownedAny: true });
  assert.deepEqual(goalRowState({ owned: 0, target: 2, isWanted: true }), { goalMet: false, ownedAny: false });
});

test('a custom (non-wanted) list never reports goalMet', () => {
  assert.deepEqual(goalRowState({ owned: 9, target: 1, isWanted: false }), { goalMet: false, ownedAny: true });
});

test('target 0 is never met even when owned', () => {
  assert.equal(goalRowState({ owned: 3, target: 0, isWanted: true }).goalMet, false);
});

// Regression: the card sheet's wishlist heart, toggled while the Wishlist list is open,
// must refresh the list's ROWS - the wishlist IS the ledger. (A full React interaction test
// needs a harness this repo does not have; this locks the decision rule the subscription uses.)
test('listRowsNeedLedgerRefresh: wishlist refreshes on a ledger write when idle', () => {
  assert.equal(listRowsNeedLedgerRefresh({ isWishlist: true, pendingGoalWrites: 0 }), true);
});
test('listRowsNeedLedgerRefresh: never tramples a local edit in flight', () => {
  assert.equal(listRowsNeedLedgerRefresh({ isWishlist: true, pendingGoalWrites: 1 }), false);
});
test('listRowsNeedLedgerRefresh: regular lists are unaffected by ledger writes', () => {
  assert.equal(listRowsNeedLedgerRefresh({ isWishlist: false, pendingGoalWrites: 0 }), false);
});

// Regression for the slow-read race: an external wishlist refresh must not overwrite a local
// edit that began while its read was in flight. Tests the INTERLEAVING, not just the
// pre-read predicate.
test('canApplyExternalRows: applies when nothing changed during the read', () => {
  assert.equal(canApplyExternalRows({ cancelled: false, pendingGoalWrites: 0, genAtStart: 4, genNow: 4 }), true);
});
test('canApplyExternalRows: a local edit STARTED during the read wins', () => {
  // external refresh begins at gen 4; user edits (gen -> 5) before the read resolves
  assert.equal(canApplyExternalRows({ cancelled: false, pendingGoalWrites: 0, genAtStart: 4, genNow: 5 }), false);
});
test('canApplyExternalRows: a local write still in flight wins', () => {
  assert.equal(canApplyExternalRows({ cancelled: false, pendingGoalWrites: 1, genAtStart: 4, genNow: 4 }), false);
});
test('canApplyExternalRows: never applies after the list closed', () => {
  assert.equal(canApplyExternalRows({ cancelled: true, pendingGoalWrites: 0, genAtStart: 4, genNow: 4 }), false);
});
