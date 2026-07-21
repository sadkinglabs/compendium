import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectionKey, parseSelectionKey, snapshot, toggle, isSelected,
  addAll, clear, hiddenCount, missingRows, ownedRows,
} from './bulkSelection.js';

const row = (cardId, set) => ({ cardId, set });
const ledger = (obj) => (cardId, set) => obj[`${cardId}|${set}`] || 0;

test('a selection snapshot does not follow the rows it came from', () => {
  // The core guarantee. If selection were derived, mutating the source would change what is
  // about to be written.
  const rows = [row('a', '001'), row('b', '001')];
  const sel = snapshot(rows);
  rows.length = 0;
  assert.equal(sel.size, 2);
});

test('changing the filter does not add or remove selected rows', () => {
  const sel = snapshot([row('a', '001'), row('b', '001'), row('c', '001')]);
  const nowVisible = [row('a', '001')];              // user narrowed the filter
  assert.equal(sel.size, 3, 'selection is unchanged');
  assert.equal(hiddenCount(sel, nowVisible), 2, 'and the surface must say so');
});

test('hiddenCount is zero when everything selected is on screen', () => {
  const rows = [row('a', '001'), row('b', '001')];
  assert.equal(hiddenCount(snapshot(rows), rows), 0);
});

test('keys carry the printing, so one card in two sets is two rows', () => {
  const sel = snapshot([row('a', '001'), row('a', '002')]);
  assert.equal(sel.size, 2);
  assert.ok(isSelected(sel, 'a', '001'));
  assert.ok(isSelected(sel, 'a', '002'));
});

test("the Unspecified printing is a real, selectable row", () => {
  const sel = snapshot([row('a', '')]);
  assert.ok(isSelected(sel, 'a', ''));
  assert.equal(selectionKey('a', ''), 'a|');
  assert.deepEqual(parseSelectionKey('a|'), { cardId: 'a', set: '' });
});

test('a set code containing a separator round-trips', () => {
  // parseSelectionKey splits on the FIRST separator, so set codes are never truncated.
  assert.deepEqual(parseSelectionKey(selectionKey('a', '001:f')), { cardId: 'a', set: '001:f' });
});

test('toggle is symmetric and does not mutate the input', () => {
  const sel = snapshot([row('a', '001')]);
  const off = toggle(sel, 'a', '001');
  assert.equal(off.size, 0);
  assert.equal(sel.size, 1, 'original untouched');
  assert.ok(isSelected(toggle(off, 'a', '001'), 'a', '001'));
});

test('select-all adds to a hand-picked selection rather than replacing it', () => {
  const sel = snapshot([row('z', '001')]);
  const next = addAll(sel, [row('a', '001'), row('b', '001')]);
  assert.equal(next.size, 3);
  assert.ok(isSelected(next, 'z', '001'), 'the hand-picked row survived');
});

test('select-all is idempotent', () => {
  const rows = [row('a', '001'), row('b', '001')];
  assert.equal(addAll(addAll(clear(), rows), rows).size, 2);
});

test('missing and owned helpers split on quantity', () => {
  const rows = [row('a', '001'), row('b', '001'), row('c', '001')];
  const q = ledger({ 'a|001': 0, 'b|001': 2, 'c|001': 0 });
  assert.deepEqual(missingRows(rows, q).map((r) => r.cardId), ['a', 'c']);
  assert.deepEqual(ownedRows(rows, q).map((r) => r.cardId), ['b']);
});

test('snapshot accepts raw db row shape as well as view shape', () => {
  const sel = snapshot([{ card_id: 'a', variant_slug: '001' }]);
  assert.ok(isSelected(sel, 'a', '001'));
});
