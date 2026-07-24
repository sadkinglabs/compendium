import { UNCATEGORISED_LABEL } from './printings.js';
// Pure tests for the Collection grouping. Ownership is driven by the `own` predicate
// (collectionFilter); "Owned" = own ANY copy; a Finish scope reframes it AND gates catalog
// availability; Wishlisted matches the EXACT collector item (card + set + finish). See
// collectionFilter.test.mjs for the predicate itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupCollection, poolSetFilter } from './collectionGroups.js';

const SET_LABEL = { '001': 'Alpha', '002': 'Beta', '999': 'Promotional', '': UNCATEGORISED_LABEL };
const setRank = (c) => (c === '' ? 999 : parseInt(c, 10) || 998);
const V = (pairs) => JSON.stringify(pairs.map(([set, finish]) => ({ set, finish })));

// a = Alpha+Beta (both finishes each); b = Beta-only, owned uncategorised; c = "Winter River" -
// Alpha FOIL-ONLY; d = Alpha, both finishes exist but user owns only foil.
const POOL = [
  { card_id: 'a', name: 'Aaa', _sets: [{ code: '001', name: 'Alpha' }, { code: '002', name: 'Beta' }], variants: V([['001', 'Standard'], ['001', 'Foil'], ['002', 'Standard'], ['002', 'Foil']]) },
  { card_id: 'b', name: 'Bbb', _sets: [{ code: '002', name: 'Beta' }], variants: V([['002', 'Standard']]) },
  { card_id: 'c', name: 'Ccc', _sets: [{ code: '001', name: 'Alpha' }], variants: V([['001', 'Foil']]) },   // foil-only
  { card_id: 'd', name: 'Ddd', _sets: [{ code: '001', name: 'Alpha' }], variants: V([['001', 'Standard'], ['001', 'Foil']]) },
];
// Owned: 2x Alpha std of a; 3x Uncategorised of b; 1x Alpha foil of c; 1x Alpha foil of d.
const OW = new Map([['a|001', { owned: 2, foil: 0 }], ['b|', { owned: 3, foil: 0 }], ['c|001', { owned: 0, foil: 1 }], ['d|001', { owned: 0, foil: 1 }]]);
const base = { pool: POOL, owBySet: OW, wishSet: new Set(), setLabel: SET_LABEL, setRank };
const run = (o) => groupCollection({ ...base, ...o });
const codes = (groups) => groups.map((g) => g.code);
const idsIn = (groups, code) => (groups.find((g) => g.code === code)?.rows || []).map((r) => r.card.card_id).sort();

test('poolSetFilter keeps Uncategorised out of the catalog query (and drops set narrowing when it is selected)', () => {
  assert.deepEqual(poolSetFilter([UNCATEGORISED_LABEL]), []);
  assert.deepEqual(poolSetFilter(['Alpha', UNCATEGORISED_LABEL]), []);
  assert.deepEqual(poolSetFilter(['Alpha']), ['Alpha']);
  assert.deepEqual(poolSetFilter([]), []);
});

test('no filter: every printing is grouped by set', () => {
  const g = run({});
  assert.deepEqual(codes(g).sort(), ['', '001', '002']);
  assert.deepEqual(idsIn(g, '001'), ['a', 'c', 'd']);
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('Owned = own any copy; Missing = own none', () => {
  assert.deepEqual(idsIn(run({ sets: [], own: { states: ['owned'] } }), '001'), ['a', 'c', 'd']);
  assert.deepEqual(idsIn(run({ sets: [], own: { states: ['missing'] } }), '001'), [], 'all Alpha are owned in some finish');
});

/* ---------------- finish is a REAL filter (no impossible collector items) ---------------- */

test('Finish=Standard EXCLUDES a foil-only printing (no standard Winter River to be missing)', () => {
  // c is foil-only. Standard + Missing must NOT list it, and must list d (supports Standard, owns foil only).
  const g = run({ sets: [], own: { states: ['missing'], finishes: ['standard'] } });
  assert.deepEqual(idsIn(g, '001'), ['d'], 'c excluded (no standard printing); d missing in standard');
});

test('Finish=Foil scopes to foil printings; a foil-only owned card is not missing', () => {
  const g = run({ sets: [], own: { states: ['missing'], finishes: ['foil'] } });
  assert.deepEqual(idsIn(g, '001'), ['a'], 'a owns 0 foil -> missing; c/d own a foil -> not missing');
});

test('Finish=Foil alone filters OUT printings with no foil (a standard-only card)', () => {
  const pool = [{ card_id: 's', name: 'S', _sets: [{ code: '001', name: 'Alpha' }], variants: V([['001', 'Standard']]) }];
  const g = groupCollection({ ...base, pool, owBySet: new Map([['s|001', { owned: 1, foil: 0 }]]), sets: [], own: { finishes: ['foil'] } });
  assert.deepEqual(idsIn(g, '001'), [], 'no foil printing -> excluded even though owned');
});

/* ---------------- wishlist matches the EXACT collector item (Major 1) ---------------- */

test('Wishlisted matches only the wanted printing - an Alpha want never lights up the Beta drill', () => {
  const wishSet = new Set(['a|001']);   // Alpha NON-FOIL want of a
  assert.deepEqual(idsIn(groupCollection({ ...base, wishSet, sets: ['Alpha'], own: { states: ['wishlist'] } }), '001'), ['a'], 'Alpha shows');
  assert.deepEqual(idsIn(groupCollection({ ...base, wishSet, sets: ['Beta'], own: { states: ['wishlist'] } }), '002'), [], 'Beta does NOT');
});

test('Wishlisted honours the finish scope - a Standard want is not a Foil want', () => {
  const wishSet = new Set(['a|001']);   // Standard want
  assert.deepEqual(idsIn(groupCollection({ ...base, wishSet, sets: ['Alpha'], own: { states: ['wishlist'], finishes: ['standard'] } }), '001'), ['a'], 'Standard+Wishlisted matches');
  assert.deepEqual(idsIn(groupCollection({ ...base, wishSet, sets: ['Alpha'], own: { states: ['wishlist'], finishes: ['foil'] } }), '001'), [], 'Foil+Wishlisted does not');
});

test('with no finish scope, either finish wanted in the set lights the row', () => {
  const wishSet = new Set(['a|001:f']);   // Alpha FOIL want
  assert.deepEqual(idsIn(groupCollection({ ...base, wishSet, sets: ['Alpha'], own: { states: ['wishlist'] } }), '001'), ['a']);
});

/* ---------------- uncategorised recovery ---------------- */

test('Uncategorised finish availability = what it HOLDS (a foil-only pile has no Standard)', () => {
  const pool = [{ card_id: 'wr', name: 'Winter River', _sets: [{ code: '001', name: 'Alpha' }], variants: V([['001', 'Foil']]) }];
  const ow = new Map([['wr|', { owned: 0, foil: 1 }]]);   // foil-only, uncategorised
  const b2 = { pool, owBySet: ow, wishSet: new Set(), setLabel: SET_LABEL, setRank, sets: [] };
  assert.deepEqual(idsIn(groupCollection({ ...b2, own: { finishes: ['standard'] } }), ''), [], 'Finish=Standard hides it (no standard held)');
  assert.deepEqual(idsIn(groupCollection({ ...b2, own: { states: ['missing'], finishes: ['standard'] } }), ''), [], 'Standard+Missing hides it too');
  assert.deepEqual(idsIn(groupCollection({ ...b2, own: { states: ['owned'], finishes: ['foil'] } }), ''), ['wr'], 'Foil+Owned shows it');
});

test('Uncategorised alone: only the set-less pile shows', () => {
  const g = run({ sets: [UNCATEGORISED_LABEL], own: { states: ['owned'] } });
  assert.deepEqual(codes(g), ['']);
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('Uncategorised + a real set: that set plus the set-less pile', () => {
  const g = run({ sets: ['Alpha', UNCATEGORISED_LABEL], own: { states: ['owned'] } });
  assert.deepEqual(codes(g).sort(), ['', '001']);
  assert.deepEqual(idsIn(g, '001'), ['a', 'c', 'd']);
  assert.deepEqual(idsIn(g, ''), ['b']);
});

test('regression: an EMPTY pool yields no groups - proves the caller must not empty it', () => {
  assert.deepEqual(groupCollection({ ...base, pool: [], sets: [UNCATEGORISED_LABEL], own: { states: ['owned'] } }), []);
});

test('an inactive filter (no axes) returns every printing', () => {
  assert.deepEqual(idsIn(run({ own: {} }), '001'), ['a', 'c', 'd']);
});

test('rows carry the UPDATED timestamp through for the sort', () => {
  const ow = new Map([['a|001', { owned: 2, foil: 0, updated: '2026-05-01' }]]);
  const g = groupCollection({ ...base, owBySet: ow, sets: ['Alpha'] });
  const rowA = g.find((x) => x.code === '001').rows.find((r) => r.card.card_id === 'a');
  assert.equal(rowA.updated, '2026-05-01');
});
