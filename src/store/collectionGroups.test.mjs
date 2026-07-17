// Pure tests for the Collection grouping + the "Unspecified" set-filter data flow that
// Codex found broken (the pseudo-set reached the catalog pool query and emptied it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupCollection, poolSetFilter } from './collectionGroups.js';

const SET_LABEL = { '001': 'Alpha', '002': 'Beta', '999': 'Promotional', '': 'Unspecified' };
const setRank = (c) => (c === '' ? 999 : parseInt(c, 10) || 998);

// Full catalog pool (what the FIXED caller passes when 'Unspecified' is selected: not
// narrowed by set). a = Alpha+Beta, b = Beta only, c = Alpha only.
const POOL = [
  { card_id: 'a', _sets: [{ code: '001', name: 'Alpha' }, { code: '002', name: 'Beta' }] },
  { card_id: 'b', _sets: [{ code: '002', name: 'Beta' }] },
  { card_id: 'c', _sets: [{ code: '001', name: 'Alpha' }] },
];
// Owned: 2x Alpha of a; 3x Unspecified of b; 1x Alpha foil of c.
const OW = new Map([['a|001', { owned: 2, foil: 0 }], ['b|', { owned: 3, foil: 0 }], ['c|001', { owned: 0, foil: 1 }]]);
const WISH = new Set();
const base = { pool: POOL, owBySet: OW, wishSet: WISH, setLabel: SET_LABEL, setRank };
const run = (o) => groupCollection({ ...base, ...o });
const codes = (groups) => groups.map((g) => g.code);
const idsIn = (groups, code) => (groups.find((g) => g.code === code)?.rows || []).map((r) => r.card.card_id);

test('poolSetFilter keeps Unspecified out of the catalog query (and drops set narrowing when it is selected)', () => {
  assert.deepEqual(poolSetFilter(['Unspecified']), []);
  assert.deepEqual(poolSetFilter(['Alpha', 'Unspecified']), []);   // full pool so set-less cards are present
  assert.deepEqual(poolSetFilter(['Alpha']), ['Alpha']);
  assert.deepEqual(poolSetFilter([]), []);
});

test('Unspecified alone: only the set-less pile shows (was: empty)', () => {
  const g = run({ sets: ['Unspecified'], viewMode: 'owned' });
  assert.deepEqual(codes(g), ['']);
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('Unspecified + a real set: that set plus the set-less pile', () => {
  const g = run({ sets: ['Alpha', 'Unspecified'], viewMode: 'owned' });
  assert.deepEqual(codes(g).sort(), ['', '001']);
  assert.deepEqual(idsIn(g, '001').sort(), ['a', 'c']);   // Alpha printings only (a's Beta excluded)
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('Not-owned lens hides the (always-owned) Unspecified pile', () => {
  const g = run({ sets: ['Unspecified'], viewMode: 'unowned' });
  assert.deepEqual(g, []);
});

test('All lens with an owned scope shows the Unspecified pile', () => {
  const g = run({ sets: ['Unspecified'], viewMode: 'all', ownActive: true, ownScope: ['owned'] });
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('+Add (edit mode) never receives Unspecified from the caller, but is well-defined if it does', () => {
  // The component strips 'Unspecified' on entering +Add; the pure fn still behaves (shows
  // the set-less pile, real rows gated by the per-printing set filter) rather than emptying.
  const g = run({ sets: ['Unspecified'], editMode: true });
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('no set filter: real owned rows + the Unspecified pile (baseline)', () => {
  const g = run({ sets: [], viewMode: 'owned' });
  assert.deepEqual(codes(g).sort(), ['', '001']);
  assert.deepEqual(idsIn(g, '001').sort(), ['a', 'c']);
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('regression: an EMPTY pool (the old bug) yields no groups - proves the caller must not empty it', () => {
  assert.deepEqual(groupCollection({ ...base, pool: [], sets: ['Unspecified'], viewMode: 'owned' }), []);
});
