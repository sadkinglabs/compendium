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
// Owned: 2x Alpha of a; 3x Unspecified of b; 1x Alpha FOIL of c (zero non-foil).
// `c` is the important one: "owned" means NON-FOIL, matching set completion, so a foil-only
// card counts as NOT owned. Those two definitions used to disagree, and the gap hid a real
// card from a real collection - see the note in collectionGroups.js.
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
  assert.deepEqual(idsIn(g, '001'), ['a']);   // Alpha printings only; c is foil-only, so not owned
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

test('Unspecified with no lens narrowing still yields the set-less pile', () => {
  // Edit mode is retired; the pure fn must still behave under an explicit Unspecified filter
  // (show the set-less pile, real rows gated by the per-printing set filter) rather than empty.
  const g = run({ sets: ['Unspecified'], viewMode: 'all' });
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('no set filter: real owned rows + the Unspecified pile (baseline)', () => {
  const g = run({ sets: [], viewMode: 'owned' });
  assert.deepEqual(codes(g).sort(), ['', '001']);
  assert.deepEqual(idsIn(g, '001'), ['a']);   // c is foil-only
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('regression: an EMPTY pool (the old bug) yields no groups - proves the caller must not empty it', () => {
  assert.deepEqual(groupCollection({ ...base, pool: [], sets: ['Unspecified'], viewMode: 'owned' }), []);
});

/* ---------------- owned means non-foil ---------------- */

test('a FOIL-ONLY card counts as NOT owned', () => {
  // The bug this pins: a Beta collection showed 401/402 yet "Not owned" returned zero
  // results, so the one card missing in non-foil was unfindable. Completion counted
  // non-foil; the filter counted foil too.
  const g = run({ sets: [], viewMode: 'unowned' });
  assert.ok(idsIn(g, '001').includes('c'), 'the foil-only card must be findable under Not owned');
});

test('a foil-only card is absent from the Owned lens', () => {
  const g = run({ sets: [], viewMode: 'owned' });
  assert.ok(!idsIn(g, '001').includes('c'));
});

test('the ownership CHIPS use the same definition as the viewMode lens', () => {
  // Both routes go through `matches`; if they ever diverge the drill header and the filter
  // would disagree again, which is exactly the failure mode being fixed.
  const chips = run({ sets: [], viewMode: 'all', ownScope: ['unowned'], ownActive: true });
  assert.ok(idsIn(chips, '001').includes('c'));
  const ownedChips = run({ sets: [], viewMode: 'all', ownScope: ['owned'], ownActive: true });
  assert.ok(!idsIn(ownedChips, '001').includes('c'));
});

test('a card owned in BOTH foil and non-foil is owned', () => {
  const ow = new Map([['a|001', { owned: 1, foil: 2 }]]);
  const g = groupCollection({ ...base, owBySet: ow, sets: [], viewMode: 'owned' });
  assert.ok(idsIn(g, '001').includes('a'));
});
