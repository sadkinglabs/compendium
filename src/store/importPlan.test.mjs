// Fixtures for the collection text-import planner (src/store/importPlan.js).
// Run: npm run test:query   (node --test)
//
// Locks the printing-routing decision the ImportTextSheet used to make inline: single-set cards
// file automatically; 0-or-2+-set cards need a choice defaulting to Unspecified (''); unresolved
// names are skipped and never contribute copies. This is user-facing collection correctness
// ("which printing does this card land in") that had no test before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCollectionImport, buildImportItems, importTallies } from './importPlan.js';

const oneSet = { card_id: 'a', name: 'Wild Boars', qty: 4, sets: [{ code: 'bet', name: 'Beta' }] };
const twoSet = { card_id: 'b', name: 'Abundance', qty: 2, sets: [{ code: 'alp', name: 'Alpha' }, { code: 'bet', name: 'Beta' }] };
const zeroSet = { card_id: 'c', name: 'Odd Card', qty: 1, sets: [] };

// --- planCollectionImport: partition + choice defaults --------------------------

test('single-set cards go to single; 2+-set and 0-set cards go to multi', () => {
  const p = planCollectionImport({ items: [oneSet, twoSet, zeroSet], unresolved: ['Ghost'] });
  assert.deepEqual(p.single.map((i) => i.card_id), ['a']);
  assert.deepEqual(p.multi.map((i) => i.card_id), ['b', 'c']);   // 2-set and 0-set both need a choice
  assert.deepEqual(p.unresolved, ['Ghost']);
});

test('choiceDefaults seeds every multi card to Unspecified ("")', () => {
  const p = planCollectionImport({ items: [oneSet, twoSet, zeroSet], unresolved: [] });
  assert.deepEqual(p.choiceDefaults, { b: '', c: '' });   // single card 'a' is NOT in defaults
});

test('missing unresolved defaults to an empty array', () => {
  const p = planCollectionImport({ items: [oneSet] });
  assert.deepEqual(p.unresolved, []);
});

test('empty items produce empty buckets and defaults', () => {
  const p = planCollectionImport({ items: [], unresolved: [] });
  assert.deepEqual(p, { single: [], multi: [], unresolved: [], choiceDefaults: {} });
});

// --- buildImportItems: write-item assembly --------------------------------------

test('single files to its sole set; multi files to the chosen set - every item carries foil', () => {
  const p = planCollectionImport({ items: [oneSet, twoSet], unresolved: [] });
  const items = buildImportItems(p, { b: 'alp' });
  assert.deepEqual(items, [
    { card_id: 'a', qty: 4, setCode: 'bet', foil: false },
    { card_id: 'b', qty: 2, setCode: 'alp', foil: false },
  ]);
});

test('a multi card with no/Unspecified choice files to "" (Unspecified)', () => {
  const p = planCollectionImport({ items: [twoSet, zeroSet], unresolved: [] });
  // b: explicit '' (Unspecified), c: choice omitted entirely -> also ''
  const items = buildImportItems(p, { b: '' });
  assert.deepEqual(items, [
    { card_id: 'b', qty: 2, setCode: '', foil: false },
    { card_id: 'c', qty: 1, setCode: '', foil: false },
  ]);
});

test('buildImportItems tolerates an omitted choice map', () => {
  const p = planCollectionImport({ items: [twoSet], unresolved: [] });
  assert.deepEqual(buildImportItems(p), [{ card_id: 'b', qty: 2, setCode: '', foil: false }]);
});

// --- annotation-resolved routing (v11 add-flow) ---------------------------------

// A line previewCollectionText DETERMINED carries `resolved: { setCode, foil }` and files directly
// - even a multi-set card, because the annotation named the printing. A line it could not
// determine carries `resolved: null` and falls to review even if the card has one set.
const resolvedFoil = { card_id: 'd', name: 'Druid', qty: 2, sets: [{ code: '999', name: 'Promotional' }, { code: '001', name: 'Alpha' }], foil: true, resolved: { setCode: '999', foil: true } };
const unresolvedFoil = { card_id: 'e', name: 'Winter River', qty: 1, sets: [{ code: '001', name: 'Alpha' }], foil: true, resolved: null };

test('an annotation-resolved multi-set line files directly, not to review', () => {
  const p = planCollectionImport({ items: [resolvedFoil, twoSet], unresolved: [] });
  assert.deepEqual(p.single.map((i) => i.card_id), ['d'], 'resolved multi-set card auto-files');
  assert.deepEqual(p.multi.map((i) => i.card_id), ['b'], 'the unannotated 2-set card still needs a choice');
});

test('resolved lines file their exact setCode + foil; foil is a real boolean', () => {
  const p = planCollectionImport({ items: [resolvedFoil], unresolved: [] });
  assert.deepEqual(buildImportItems(p), [{ card_id: 'd', qty: 2, setCode: '999', foil: true }]);
});

test('a single-set line preview could NOT determine (resolved:null) falls to review and keeps its foil intent', () => {
  const p = planCollectionImport({ items: [unresolvedFoil], unresolved: [] });
  assert.deepEqual(p.single.map((i) => i.card_id), [], 'resolved:null is not auto-filed despite one set');
  assert.deepEqual(p.multi.map((i) => i.card_id), ['e']);
  // Left Unspecified -> uncategorised, but the foil intent survives to the writer.
  assert.deepEqual(buildImportItems(p, {}), [{ card_id: 'e', qty: 1, setCode: '', foil: true }]);
});

// --- importTallies --------------------------------------------------------------

test('tallies count each bucket; totalCopies sums single+multi only (never unresolved)', () => {
  const p = planCollectionImport({ items: [oneSet, twoSet, zeroSet], unresolved: ['Ghost', 'Wraith'] });
  assert.deepEqual(importTallies(p), { nSingle: 1, nMulti: 2, nBad: 2, totalCopies: 4 + 2 + 1 });
});

test('tallies tolerate a missing unresolved array', () => {
  const p = { single: [oneSet], multi: [] };
  assert.deepEqual(importTallies(p), { nSingle: 1, nMulti: 0, nBad: 0, totalCopies: 4 });
});
