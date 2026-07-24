// Pure tests for the bulk-selection contract (snapshot semantics + payload guard). Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selKey, toggleSelected, selectAllRows, allRowsSelected, selectionSummary, hiddenSelectedCount, editCopiesEligible, newListCardIds, overBatch, MAX_BATCH_ITEMS,
} from './collectionSelection.js';

// card 'c1' Alpha(001) both finishes, Beta(002) standard-only; 'wr' Winter River Alpha foil-only.
const V = (pairs) => JSON.stringify(pairs.map(([set, finish]) => ({ set, finish })));
const C1 = { card_id: 'c1', name: 'C1', variants: V([['001', 'Standard'], ['001', 'Foil'], ['002', 'Standard']]) };
const WR = { card_id: 'wr', name: 'Winter River', variants: V([['001', 'Foil']]) };
const row = (card, set, owned = 0, foil = 0) => ({ card, set, owned, foil });
const rows = [row(C1, '001', 2, 0), row(C1, '002', 1, 0), row(WR, '001', 0, 1)];

test('toggle adds the captured printing, toggling again removes it', () => {
  let sel = new Map();
  sel = toggleSelected(sel, 'c1', '001', rows);
  assert.deepEqual([...sel.keys()], ['c1|001']);
  assert.deepEqual(sel.get('c1|001'), { card: C1, set: '001', owned: 2, foil: 0 });
  sel = toggleSelected(sel, 'c1', '001', rows);
  assert.equal(sel.size, 0);
});

test('two printings of one card are two independent selection entries', () => {
  let sel = new Map();
  sel = toggleSelected(sel, 'c1', '001', rows);
  sel = toggleSelected(sel, 'c1', '002', rows);
  assert.deepEqual([...sel.keys()].sort(), ['c1|001', 'c1|002']);
});

test('selectAll captures the FULL row set (the contract: not just a rendered prefix)', () => {
  const sel = selectAllRows(new Map(), rows);
  assert.equal(sel.size, 3);
  assert.deepEqual([...sel.keys()].sort(), ['c1|001', 'c1|002', 'wr|001']);
});

test('selectAll UNIONS into the existing snapshot - it never drops earlier hand-picks', () => {
  // Hand-pick under one filter, then Select-all a DISJOINT filtered result: both survive.
  let sel = toggleSelected(new Map(), 'wr', '001', rows);       // hand-picked wr|001
  sel = selectAllRows(sel, [rows[0], rows[1]]);                 // filter now shows only the two c1 printings
  assert.deepEqual([...sel.keys()].sort(), ['c1|001', 'c1|002', 'wr|001'], 'union, not replace');
});

test('selectAll is idempotent - re-selecting the same rows changes nothing', () => {
  const once = selectAllRows(new Map(), rows);
  const twice = selectAllRows(once, rows);
  assert.deepEqual([...twice.keys()].sort(), [...once.keys()].sort());
  assert.equal(twice.size, 3);
});

test('allRowsSelected is membership, not count-equality (a disjoint same-size result is NOT all)', () => {
  const sel = selectAllRows(new Map(), [rows[0], rows[1]]);     // c1|001, c1|002 selected
  assert.equal(allRowsSelected(sel, [rows[0], rows[1]]), true, 'exact set is all-selected');
  assert.equal(allRowsSelected(sel, [rows[2]]), false, 'wr|001 not selected');
  assert.equal(allRowsSelected(sel, rows), false, 'wr|001 present but unselected -> not all');
  // A disjoint result of the SAME size (2) must not read as all-selected off a count match.
  assert.equal(allRowsSelected(sel, [rows[2], rows[2]]), false);
  assert.equal(allRowsSelected(new Map(), rows), false, 'empty selection');
  assert.equal(allRowsSelected(sel, []), false, 'no rows is never "all"');
});

test('selectionSummary is the single contract both surfaces derive (count / allSelected / hidden)', () => {
  const sel = selectAllRows(new Map(), rows);          // all 3 picked
  assert.deepEqual(selectionSummary(sel, rows), { count: 3, allSelected: true, hidden: 0 });
  // A filter now shows only c1|001 (which IS selected): still 3 selected, every VISIBLE row is
  // selected so the pill reads Deselect-all, and 2 picks are now hidden -> the set drill must disclose
  // that hidden count exactly as ALL does (the two contracts cannot drift).
  assert.deepEqual(selectionSummary(sel, [rows[0]]), { count: 3, allSelected: true, hidden: 2 });
  // A partial selection whose visible row is UNpicked is not "all".
  const two = selectAllRows(new Map(), [rows[1], rows[2]]);
  assert.deepEqual(selectionSummary(two, rows), { count: 2, allSelected: false, hidden: 0 });
  assert.deepEqual(selectionSummary(new Map(), rows), { count: 0, allSelected: false, hidden: 0 });
});

test('hiddenSelectedCount reports selected items absent from the current filtered rows', () => {
  const sel = selectAllRows(new Map(), rows);      // 3 selected
  assert.equal(hiddenSelectedCount(sel, rows), 0, 'all visible');
  assert.equal(hiddenSelectedCount(sel, [rows[0]]), 2, 'filter now shows only c1|001 -> 2 hidden');
  assert.equal(hiddenSelectedCount(new Map(), rows), 0);
});

test('a snapshot is not mutated by a filter change - hidden items still count for an action', () => {
  // Select all 3, then the "visible rows" shrink to one. The snapshot keeps all 3.
  const sel = selectAllRows(new Map(), rows);
  const visibleAfterFilter = [rows[0]];
  assert.equal(sel.size, 3, 'selection unchanged by filtering');
  assert.equal(hiddenSelectedCount(sel, visibleAfterFilter), 2);
});

test('editCopiesEligible drops printings lacking the chosen finish (Winter River has no standard)', () => {
  const values = [...selectAllRows(new Map(), rows).values()];
  const std = editCopiesEligible(values, false);
  assert.deepEqual(std.items.map((i) => `${i.card.card_id}|${i.set}`).sort(), ['c1|001', 'c1|002'], 'wr skipped (foil-only)');
  assert.equal(std.skipped, 1);
  const foil = editCopiesEligible(values, true);
  assert.deepEqual(foil.items.map((i) => `${i.card.card_id}|${i.set}`).sort(), ['c1|001', 'wr|001'], 'c1|002 skipped (standard-only)');
  assert.equal(foil.skipped, 1);
});

test('newListCardIds dedups printings to card grain', () => {
  const values = [...selectAllRows(new Map(), rows).values()];   // c1|001, c1|002, wr|001
  assert.deepEqual(newListCardIds(values).sort(), ['c1', 'wr'], 'two c1 printings -> one entry');
});

test('overBatch: the guard fires strictly above MAX_BATCH_ITEMS, never at or below', () => {
  assert.equal(MAX_BATCH_ITEMS, 2000);
  assert.equal(overBatch(2000), false);
  assert.equal(overBatch(2001), true);
  // The guard is computed on the ACTUAL payload: e.g. a New-list of 2143 printings that dedups to
  // 1900 cards is allowed (checked on the deduped count), while 2143 edit-copies items is refused.
});
