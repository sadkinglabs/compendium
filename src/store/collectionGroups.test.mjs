import { UNCATEGORISED_LABEL } from './printings.js';
// Pure tests for the Collection grouping + the uncategorised set-filter data flow that
// Codex found broken (the pseudo-set reached the catalog pool query and emptied it). Ownership is
// now driven by the `own` predicate (collectionFilter); "Owned" means own ANY copy, and a Finish
// scope reframes it - see collectionFilter.test.mjs for the predicate itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupCollection, poolSetFilter } from './collectionGroups.js';

const SET_LABEL = { '001': 'Alpha', '002': 'Beta', '999': 'Promotional', '': UNCATEGORISED_LABEL };
const setRank = (c) => (c === '' ? 999 : parseInt(c, 10) || 998);

// a = Alpha+Beta, b = Beta only, c = Alpha only.
const POOL = [
  { card_id: 'a', name: 'Aaa', _sets: [{ code: '001', name: 'Alpha' }, { code: '002', name: 'Beta' }] },
  { card_id: 'b', name: 'Bbb', _sets: [{ code: '002', name: 'Beta' }] },
  { card_id: 'c', name: 'Ccc', _sets: [{ code: '001', name: 'Alpha' }] },
];
// Owned: 2x Alpha of a; 3x Uncategorised of b; 1x Alpha FOIL of c (zero non-foil).
const OW = new Map([['a|001', { owned: 2, foil: 0 }], ['b|', { owned: 3, foil: 0 }], ['c|001', { owned: 0, foil: 1 }]]);
const WISH = new Set();
const base = { pool: POOL, owBySet: OW, wishSet: WISH, setLabel: SET_LABEL, setRank };
const run = (o) => groupCollection({ ...base, ...o });
const codes = (groups) => groups.map((g) => g.code);
const idsIn = (groups, code) => (groups.find((g) => g.code === code)?.rows || []).map((r) => r.card.card_id);

test('poolSetFilter keeps Uncategorised out of the catalog query (and drops set narrowing when it is selected)', () => {
  assert.deepEqual(poolSetFilter([UNCATEGORISED_LABEL]), []);
  assert.deepEqual(poolSetFilter(['Alpha', UNCATEGORISED_LABEL]), []);   // full pool so set-less cards are present
  assert.deepEqual(poolSetFilter(['Alpha']), ['Alpha']);
  assert.deepEqual(poolSetFilter([]), []);
});

test('no filter: every printing is grouped by set (including the foil-only c)', () => {
  const g = run({});
  assert.deepEqual(codes(g).sort(), ['', '001', '002']);
  assert.deepEqual(idsIn(g, '001').sort(), ['a', 'c']);
  assert.deepEqual(idsIn(g, '').sort(), ['b']);
});

test('Owned chip: own any copy (the foil-only c IS owned now)', () => {
  const g = run({ sets: [], own: { states: ['owned'] } });
  assert.deepEqual(idsIn(g, '001').sort(), ['a', 'c'], 'both the non-foil a and the foil-only c');
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('Missing chip: own no copy in scope', () => {
  // In the Alpha group, a is owned (2 non-foil), c is owned (1 foil) -> neither is Missing.
  const g = run({ sets: [], own: { states: ['missing'] } });
  assert.deepEqual(idsIn(g, '001'), [], 'nothing Alpha is fully unowned');
});

test('Finish=Standard + Missing surfaces the foil-only card (missing in non-foil)', () => {
  const g = run({ sets: [], own: { states: ['missing'], finishes: ['standard'] } });
  assert.ok(idsIn(g, '001').includes('c'), 'c has no standard copy -> Missing in standard');
  assert.ok(!idsIn(g, '001').includes('a'), 'a has a standard copy');
});

test('Uncategorised alone: only the set-less pile shows', () => {
  const g = run({ sets: [UNCATEGORISED_LABEL], own: { states: ['owned'] } });
  assert.deepEqual(codes(g), ['']);
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('Uncategorised + a real set: that set plus the set-less pile', () => {
  const g = run({ sets: ['Alpha', UNCATEGORISED_LABEL], own: { states: ['owned'] } });
  assert.deepEqual(codes(g).sort(), ['', '001']);
  assert.deepEqual(idsIn(g, '001').sort(), ['a', 'c']);
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('the uncategorised pile is judged by the SAME predicate (Finish=Standard hides a foil-only pile)', () => {
  const pool = [{ card_id: 'z', name: 'Zed', _sets: [{ code: '001', name: 'Alpha' }] }];
  const ow = new Map([['z|', { owned: 0, foil: 1 }]]);   // foil-only, uncategorised
  const b2 = { pool, owBySet: ow, wishSet: new Set(), setLabel: SET_LABEL, setRank, sets: [] };
  assert.deepEqual(idsIn(groupCollection({ ...b2, own: { states: ['owned'], finishes: ['foil'] } }), ''), ['z'], 'owned in foil');
  assert.deepEqual(idsIn(groupCollection({ ...b2, own: { states: ['owned'], finishes: ['standard'] } }), ''), [], 'not owned in standard');
});

test('regression: an EMPTY pool (the old bug) yields no groups - proves the caller must not empty it', () => {
  assert.deepEqual(groupCollection({ ...base, pool: [], sets: [UNCATEGORISED_LABEL], own: { states: ['owned'] } }), []);
});

test('an inactive filter (no axes) returns every printing', () => {
  const g = run({ own: {} });
  assert.deepEqual(idsIn(g, '001').sort(), ['a', 'c']);
});

test('rows carry the added timestamp through for the sort', () => {
  const ow = new Map([['a|001', { owned: 2, foil: 0, added: '2026-05-01' }]]);
  const g = groupCollection({ ...base, owBySet: ow, sets: ['Alpha'] });
  const rowA = g.find((x) => x.code === '001').rows.find((r) => r.card.card_id === 'a');
  assert.equal(rowA.added, '2026-05-01');
});
