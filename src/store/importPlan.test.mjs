// Fixtures for the collection text-import planner (src/store/importPlan.js).
// Run: npm run test:query   (node --test)
//
// Locks the printing-routing decision the ImportTextSheet used to make inline: single-set cards
// file automatically; 0-or-2+-set cards need a choice defaulting to Unspecified (''); unresolved
// names are skipped and never contribute copies. This is user-facing collection correctness
// ("which printing does this card land in") that had no test before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCollectionImport, buildImportItems, importTallies, itemKey } from './importPlan.js';

// Fixtures carry the collector-item `key` and per-line `parts` that previewCollectionText now sets.
const oneSet = { card_id: 'a', name: 'Wild Boars', key: 'wild boars||0', qty: 4, parts: [4], foil: false, sets: [{ code: 'bet', name: 'Beta' }] };
const twoSet = { card_id: 'b', name: 'Abundance', key: 'abundance||0', qty: 2, parts: [2], foil: false, sets: [{ code: 'alp', name: 'Alpha' }, { code: 'bet', name: 'Beta' }] };
const zeroSet = { card_id: 'c', name: 'Odd Card', key: 'odd card||0', qty: 1, parts: [1], foil: false, sets: [] };

// --- planCollectionImport: partition + choice defaults --------------------------

test('single-set cards go to single; 2+-set and 0-set cards go to multi', () => {
  const p = planCollectionImport({ items: [oneSet, twoSet, zeroSet], unresolved: ['Ghost'] });
  assert.deepEqual(p.single.map((i) => i.card_id), ['a']);
  assert.deepEqual(p.multi.map((i) => i.card_id), ['b', 'c']);   // 2-set and 0-set both need a choice
  assert.deepEqual(p.unresolved, ['Ghost']);
});

test('choiceDefaults seeds every multi item to Unspecified (""), keyed by collector-item identity', () => {
  const p = planCollectionImport({ items: [oneSet, twoSet, zeroSet], unresolved: [] });
  assert.deepEqual(p.choiceDefaults, { 'abundance||0': '', 'odd card||0': '' });   // single 'a' is NOT in defaults
});

test('two unresolved printings of ONE card get independent choices (no card_id collision)', () => {
  const betaFoil = { card_id: 'z', name: 'Card', key: 'card|Beta|1', qty: 1, parts: [1], foil: true, sets: [], resolved: null };
  const betaPlain = { card_id: 'z', name: 'Card', key: 'card|Beta|0', qty: 1, parts: [1], foil: false, sets: [], resolved: null };
  const p = planCollectionImport({ items: [betaFoil, betaPlain], unresolved: [] });
  assert.deepEqual(Object.keys(p.choiceDefaults).sort(), ['card|Beta|0', 'card|Beta|1'], 'two distinct choices, not one shared by card_id');
});

test('missing unresolved/flagged default to empty arrays', () => {
  const p = planCollectionImport({ items: [oneSet] });
  assert.deepEqual(p.unresolved, []);
  assert.deepEqual(p.flagged, []);
});

test('empty items produce empty buckets and defaults', () => {
  const p = planCollectionImport({ items: [], unresolved: [], flagged: [] });
  assert.deepEqual(p, { single: [], multi: [], unresolved: [], flagged: [], choiceDefaults: {} });
});

test('flagged lines are threaded through untouched', () => {
  const flagged = [{ raw: '0 Wild Boars', name: 'Wild Boars', qty: 0, problems: ['quantity out of range'] }];
  const p = planCollectionImport({ items: [oneSet], unresolved: [], flagged });
  assert.deepEqual(p.flagged, flagged);
});

// --- buildImportItems: write-item assembly --------------------------------------

test('single files to its sole set; multi files to the chosen set - every item carries foil', () => {
  const p = planCollectionImport({ items: [oneSet, twoSet], unresolved: [] });
  const items = buildImportItems(p, { [itemKey(twoSet)]: 'alp' });
  assert.deepEqual(items, [
    { card_id: 'a', qty: 4, setCode: 'bet', foil: false },
    { card_id: 'b', qty: 2, setCode: 'alp', foil: false },
  ]);
});

test('a multi item with no/Unspecified choice files to "" (Unspecified)', () => {
  const p = planCollectionImport({ items: [twoSet, zeroSet], unresolved: [] });
  const items = buildImportItems(p, { [itemKey(twoSet)]: '' });   // c: choice omitted entirely -> also ''
  assert.deepEqual(items, [
    { card_id: 'b', qty: 2, setCode: '', foil: false },
    { card_id: 'c', qty: 1, setCode: '', foil: false },
  ]);
});

test('buildImportItems tolerates an omitted choice map', () => {
  const p = planCollectionImport({ items: [twoSet], unresolved: [] });
  assert.deepEqual(buildImportItems(p), [{ card_id: 'b', qty: 2, setCode: '', foil: false }]);
});

test('parts EXPAND to one write item each, so the writer merges 999 + 999 to 1998 (not a rejected 1998 item)', () => {
  const twoLines = { card_id: 'x', name: 'Card', key: 'card|Beta|0', qty: 1998, parts: [999, 999], sets: [{ code: 'bet', name: 'Beta' }], resolved: { setCode: 'bet', foil: false } };
  const p = planCollectionImport({ items: [twoLines], unresolved: [] });
  assert.deepEqual(buildImportItems(p), [
    { card_id: 'x', qty: 999, setCode: 'bet', foil: false },
    { card_id: 'x', qty: 999, setCode: 'bet', foil: false },
  ], 'each contribution reaches the writer at its per-line bound');
});

test('buildImportItems REJECTS a non-boolean foil (no coercion past the writer)', () => {
  const bad = { card_id: 'y', name: 'C', key: 'c||0', qty: 1, parts: [1], sets: [{ code: 'bet', name: 'Beta' }], resolved: { setCode: 'bet', foil: 'false' } };
  assert.throws(() => buildImportItems(planCollectionImport({ items: [bad], unresolved: [] })), /foil must be a boolean/);
  const badMulti = { card_id: 'y', name: 'C', key: 'c||9', qty: 1, parts: [1], sets: [], foil: 'true', resolved: null };
  assert.throws(() => buildImportItems(planCollectionImport({ items: [badMulti], unresolved: [] })), /foil must be a boolean/);
});

// --- annotation-resolved routing (v11 add-flow) ---------------------------------

// A line previewCollectionText DETERMINED carries `resolved: { setCode, foil }` and files directly
// - even a multi-set card, because the annotation named the printing. A line it could not
// determine carries `resolved: null` and falls to review even if the card has one set.
const resolvedFoil = { card_id: 'd', name: 'Druid', key: 'druid|999|1', qty: 2, parts: [2], sets: [{ code: '999', name: 'Promotional' }, { code: '001', name: 'Alpha' }], foil: true, resolved: { setCode: '999', foil: true } };
const unresolvedFoil = { card_id: 'e', name: 'Winter River', key: 'winter river||1', qty: 1, parts: [1], sets: [{ code: '001', name: 'Alpha' }], foil: true, resolved: null };

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

test('tallies count each bucket; totalCopies sums single+multi; nCards is DISTINCT cards', () => {
  const p = planCollectionImport({ items: [oneSet, twoSet, zeroSet], unresolved: ['Ghost', 'Wraith'], flagged: [{ raw: '0 X', problems: ['quantity out of range'] }] });
  assert.deepEqual(importTallies(p), { nSingle: 1, nMulti: 2, nBad: 2, nFlagged: 1, nItems: 3, nCards: 3, totalCopies: 4 + 2 + 1 });
});

test('two printings of one card count as one card, three collector items', () => {
  const beta = { card_id: 'z', name: 'Card', key: 'card|Beta|0', qty: 2, parts: [2], sets: [{ code: 'bet', name: 'Beta' }], resolved: { setCode: 'bet', foil: false } };
  const betaFoil = { card_id: 'z', name: 'Card', key: 'card|Beta|1', qty: 1, parts: [1], sets: [{ code: 'bet', name: 'Beta' }], resolved: { setCode: 'bet', foil: true } };
  const t = importTallies(planCollectionImport({ items: [beta, betaFoil, oneSet], unresolved: [] }));
  assert.equal(t.nItems, 3, 'three collector items');
  assert.equal(t.nCards, 2, 'but only two distinct cards');
});

test('tallies tolerate missing arrays', () => {
  const p = { single: [oneSet], multi: [] };
  assert.deepEqual(importTallies(p), { nSingle: 1, nMulti: 0, nBad: 0, nFlagged: 0, nItems: 1, nCards: 1, totalCopies: 4 });
});
