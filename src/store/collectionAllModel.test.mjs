// Pure tests for the Collection grid model helpers (scope->pool args, groups->rows, render signature,
// progressive ARRANGEMENT, scroll-root resolution). Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  poolArgs, rowsForScope, renderSignature, arrangeSections, visibleSections, resolveScrollRoot, effectiveCount,
  filedKeysOf, withFiled,
} from './collectionAllModel.js';

const cardOf = (r) => r.card;
const byName = (a, b) => String(a.card.name).localeCompare(String(b.card.name));
// element/rarity carried so grouped arrangements exercise real bucketing.
const card = (id, name, element, rarity) => ({ card_id: id, name, elements: JSON.stringify(element ? [element] : []), rarity });
const row = (c, set) => ({ card: c, set, owned: 0, foil: 0 });

const AIR_A = card('a', 'Abundance', 'Air', 'Ordinary');
const FIRE_B = card('b', 'Bake', 'Fire', 'Elite');
const AIR_C = card('c', 'Cadence', 'Air', 'Unique');
const WATER_D = card('d', 'Deluge', 'Water', 'Exceptional');

test('poolArgs: a set scope pins the printed set NAME; ALL passes no set filter', () => {
  const filters = { q: 'x', els: ['Air'], types: ['Minion'], rarities: ['Elite'], multi: true, artist: 'Nakata' };
  assert.deepEqual(poolArgs({ kind: 'set', name: 'Alpha', code: '001' }, filters).sets, ['Alpha']);
  assert.equal(poolArgs({ kind: 'all' }, filters).sets, undefined);
  // all other axes pass straight through unchanged
  const a = poolArgs({ kind: 'all' }, filters);
  assert.equal(a.q, 'x'); assert.deepEqual(a.els, ['Air']); assert.deepEqual(a.types, ['Minion']);
  assert.deepEqual(a.rarities, ['Elite']); assert.equal(a.multi, true); assert.equal(a.artist, 'Nakata');
});

test('rowsForScope: set scope returns its one groups by CODE; a missing code is empty, not a throw', () => {
  const groups = [{ code: '001', rows: [row(AIR_A, '001')] }, { code: '002', rows: [row(FIRE_B, '002')] }];
  assert.deepEqual(rowsForScope(groups, { kind: 'set', code: '002' }), [row(FIRE_B, '002')]);
  assert.deepEqual(rowsForScope(groups, { kind: 'set', code: 'ZZZ' }), []);
});

test('rowsForScope: ALL flattens every group, including the recovered Uncategorised pile', () => {
  const groups = [
    { code: '001', rows: [row(AIR_A, '001')] },
    { code: '002', rows: [row(FIRE_B, '002'), row(AIR_C, '002')] },
    { code: 'UNCAT', rows: [row(WATER_D, '999')] },
  ];
  const rows = rowsForScope(groups, { kind: 'all' });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.card.card_id), ['a', 'b', 'c', 'd']);
});

/* ---------------- the filed mark on a tile ---------------- */

test('filedKeysOf: either finish counts, and a drained entry is not filed', () => {
  const keys = filedKeysOf(new Map([
    ['a|001', { owned: 2, foil: 0 }],
    ['b|002', { owned: 0, foil: 1 }],      // foil-only is filed
    ['c|003', { owned: 0, foil: 0 }],      // an allocation that has been emptied
  ]));
  assert.deepEqual([...keys].sort(), ['a|001', 'b|002']);
  assert.equal(filedKeysOf(new Map()).size, 0);
  assert.equal(filedKeysOf(null).size, 0, 'a read that has not landed yet marks nothing');
});

test('withFiled: stamps only the named rows, and leaves the others by reference', () => {
  const rows = [row(AIR_A, '001'), row(FIRE_B, '002')];
  const out = withFiled(rows, new Set(['a|001']));
  assert.equal(out[0].filed, true);
  assert.equal(out[0].card, AIR_A, 'the card is carried through, not rebuilt');
  assert.equal(out[1].filed, undefined);
  assert.equal(out[1], rows[1], 'an unfiled row keeps its identity so the tile memo short-circuits');
  assert.equal(rows[0].filed, undefined, 'the input row is copied, never mutated');
});

test('withFiled: an empty key set is the identity, so the common case costs nothing', () => {
  const rows = [row(AIR_A, '001')];
  assert.equal(withFiled(rows, new Set()), rows);
  assert.equal(withFiled(rows, null), rows);
});

test('withFiled: the key is card AND set - the same card in another set is not filed', () => {
  const out = withFiled([row(AIR_A, '001'), row(AIR_A, '002')], new Set(['a|002']));
  assert.equal(out[0].filed, undefined);
  assert.equal(out[1].filed, true);
});

test('renderSignature: stable across fresh-but-equal inputs, ignores derived row objects', () => {
  const f = { q: '', states: [], finishes: [], playset: [], ownedCmp: { op: '>=', val: null }, types: [], rarities: [], els: [], multi: false, artist: '', sort: 'name-asc', groupBy: 'none' };
  const s1 = renderSignature('all', f);
  const s2 = renderSignature('all', { ...f });   // a re-derive with a new object, same values
  assert.equal(s1, s2, 'a ledger broadcast must not change the signature');
});

test('renderSignature: any result-reshaping change moves the signature', () => {
  const base = { q: '', states: [], finishes: [], playset: [], ownedCmp: { op: '>=', val: null }, types: [], rarities: [], els: [], multi: false, artist: '', sort: 'name-asc', groupBy: 'none' };
  const sig = renderSignature('all', base);
  assert.notEqual(sig, renderSignature('all', { ...base, sort: 'name-desc' }));
  assert.notEqual(sig, renderSignature('all', { ...base, groupBy: 'element' }));
  assert.notEqual(sig, renderSignature('all', { ...base, q: 'dragon' }));
  assert.notEqual(sig, renderSignature('all', { ...base, els: ['Air'] }));
  assert.notEqual(sig, renderSignature('set', base), 'scope kind is part of the signature');
});

// The progressive-prefix invariant: for every grouping mode, the rendered key sequence at count k
// must be an EXACT PREFIX of the sequence at count k+1 - growing only appends, never re-inserts.
const keySeq = (sections) => sections.flatMap((s) => s.cards.map((r) => r.card.card_id + '|' + r.set));
const rows4 = [row(AIR_A, '001'), row(FIRE_B, '001'), row(AIR_C, '001'), row(WATER_D, '001')];

for (const groupBy of ['none', 'element', 'rarity']) {
  test(`arrange/visibleSections: prefix invariant under groupBy=${groupBy}`, () => {
    const arranged = arrangeSections(rows4, groupBy, cardOf, byName);
    const full = keySeq(visibleSections(arranged, 99));
    assert.equal(full.length, 4);
    let prev = [];
    for (let k = 0; k <= 5; k += 1) {
      const seq = keySeq(visibleSections(arranged, k));
      assert.equal(seq.length, Math.min(k, 4));
      assert.deepEqual(seq, full.slice(0, Math.min(k, 4)), `count ${k} is a prefix of the full order`);
      // monotone growth: previous shorter prefix is contained
      assert.deepEqual(prev, full.slice(0, prev.length));
      prev = seq;
    }
  });
}

test('visibleSections: a section reports its FULL count, not the count currently shown', () => {
  // group by element: Air has {Abundance, Cadence} = 2. Render only the first Air tile.
  const arranged = arrangeSections(rows4, 'element', cardOf, byName);
  const first = visibleSections(arranged, 1);
  assert.equal(first.length, 1, 'only the first section is visible');
  assert.equal(first[0].label, 'Air');
  assert.equal(first[0].cards.length, 1, 'one tile rendered');
  assert.equal(first[0].fullCount, 2, 'header still shows the full Air count');
});

test('visibleSections: count is clamped to [0, total]', () => {
  const arranged = arrangeSections(rows4, 'none', cardOf, byName);
  assert.deepEqual(visibleSections(arranged, -3), []);
  assert.equal(keySeq(visibleSections(arranged, 999)).length, 4);
});

test('effectiveCount: a moved signature resets to initial on the SAME (first) render, not after an effect', () => {
  // The load-bearing case: 1500 rendered, signature changes -> the derived count is 100 immediately,
  // so React never reconciles the stale large prefix.
  assert.equal(effectiveCount({ signature: 'old', count: 1500 }, 'new', 100, 1500), 100);
  // A matching signature honours the grown count...
  assert.equal(effectiveCount({ signature: 'new', count: 500 }, 'new', 100, 1500), 500);
  // ...clamped to total, and never below zero.
  assert.equal(effectiveCount({ signature: 'new', count: 9999 }, 'new', 100, 1500), 1500);
  assert.equal(effectiveCount({ signature: 'new', count: -5 }, 'new', 100, 1500), 0);
  // Mutation-check: dropping the signature comparison (returning progress.count) would answer 1500
  // here instead of 100 - i.e. render the old prefix once. Guard that the compare is load-bearing.
  assert.notEqual(effectiveCount({ signature: 'old', count: 1500 }, 'new', 100, 1500), 1500);
});

test('resolveScrollRoot: uses the NODE closest, never a global first-match; non-nodes are null', () => {
  const target = { id: 'root' };
  // A decoy whose .closest would answer differently proves we call the passed node, not document.
  const decoy = { closest: () => ({ id: 'WRONG-header-scroller' }) };
  const node = { closest: (sel) => (sel === '.cx-scroll' ? target : null) };
  assert.equal(resolveScrollRoot(node), target);
  assert.notEqual(resolveScrollRoot(node), resolveScrollRoot(decoy));
  assert.equal(resolveScrollRoot(null), null);
  assert.equal(resolveScrollRoot({}), null, 'a node without .closest resolves to null, not a throw');
});
