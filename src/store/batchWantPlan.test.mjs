// The pure whole-paste wishlist draft planner (src/store/batchWantPlan.js).
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowTarget, rowOptions, planWantDraft, applySetForAll } from './batchWantPlan.js';

const ALPHA_BOTH = { code: '001', name: 'Alpha', nonFoil: true, foil: true };
const BETA_NF = { code: '002', name: 'Beta', nonFoil: true, foil: false };
const PROMO_FOIL = { code: '999', name: 'Promo', nonFoil: false, foil: true };

// A choice row (set undetermined) and a fixed row (set known, finish still governed by the batch).
const choiceRow = (over = {}) => ({
  key: over.key || 'k', cardId: over.cardId || 'a', name: over.name || 'Card', qty: over.qty ?? 1, parts: over.parts || [over.qty ?? 1],
  sets: over.sets || [ALPHA_BOTH, BETA_NF], anyFoil: over.anyFoil ?? true, fixedSet: null, lockedFinish: over.lockedFinish ?? null, reason: over.reason ?? null,
});
const fixedRow = (over = {}) => ({ ...choiceRow(over), fixedSet: over.fixedSet || '002' });
const draftOf = ({ fixed = [], needsChoice = [] }) => ({ fixed, needsChoice, unknown: [], flagged: [] });

/* ---------------- rowTarget / rowOptions ---------------- */

test('no lock -> the batch finish; a valid [Foil] lock forces foil; an impossible lock demands a choice', () => {
  assert.deepEqual(rowTarget(choiceRow(), 'nonFoil'), { finish: 'nonFoil' });
  assert.deepEqual(rowTarget(choiceRow(), 'foil'), { finish: 'foil' });
  assert.deepEqual(rowTarget(choiceRow({ lockedFinish: 'foil', anyFoil: true }), 'nonFoil'), { finish: 'foil', forcedByLock: true });
  const imp = choiceRow({ lockedFinish: 'foil', anyFoil: false });
  assert.deepEqual(rowTarget(imp, 'nonFoil'), { finish: null, needLockChoice: true });
  assert.deepEqual(rowTarget(imp, 'nonFoil', 'skip'), { finish: null, skip: true });
});

test('non-foil target offers non-foil sets plus foil-only forced; foil target offers only foil sets', () => {
  const r = choiceRow({ sets: [BETA_NF, PROMO_FOIL] });
  assert.deepEqual(rowOptions(r, 'nonFoil'), [{ code: '002', name: 'Beta', foil: false }, { code: '999', name: 'Promo', foil: true, forced: true }]);
  assert.deepEqual(rowOptions(r, 'foil'), [{ code: '999', name: 'Promo', foil: true }]);
});

/* ---------------- Major 1: batch finish governs FIXED rows too ---------------- */

test('a fixed row follows the batch finish (not a resolve-time finish)', () => {
  const r = fixedRow({ fixedSet: '001', sets: [ALPHA_BOTH] });
  const nf = planWantDraft(draftOf({ fixed: [r] }), { batchFinish: 'nonFoil' });
  assert.deepEqual(nf.commitItems, [{ cardId: 'a', set: '001', foil: false, qty: 1 }]);
  const foil = planWantDraft(draftOf({ fixed: [r] }), { batchFinish: 'foil' });
  assert.deepEqual(foil.commitItems, [{ cardId: 'a', set: '001', foil: true, qty: 1 }], 'Foil-for-all changes the fixed row');
});

test('a Foil batch SKIPS a fixed row whose set has no foil - visible, never filed non-foil', () => {
  const r = fixedRow({ fixedSet: '002', sets: [BETA_NF], anyFoil: false });
  const v = planWantDraft(draftOf({ fixed: [r] }), { batchFinish: 'foil' });
  assert.equal(v.fixedRows[0].status, 'skipNoFoil');
  assert.deepEqual(v.commitItems, []);
  assert.equal(v.skipCount, 1);
});

test('a foil-only fixed set files forced foil under a non-foil batch', () => {
  const r = fixedRow({ fixedSet: '999', sets: [PROMO_FOIL] });
  const v = planWantDraft(draftOf({ fixed: [r] }), { batchFinish: 'nonFoil' });
  assert.equal(v.fixedRows[0].forcedFoil, true);
  assert.deepEqual(v.commitItems, [{ cardId: 'a', set: '999', foil: true, qty: 1 }]);
});

test('an explicit [Foil] lock on a fixed row stays foil regardless of the batch', () => {
  const r = fixedRow({ fixedSet: '001', sets: [ALPHA_BOTH], lockedFinish: 'foil' });
  const v = planWantDraft(draftOf({ fixed: [r] }), { batchFinish: 'nonFoil' });
  assert.deepEqual(v.commitItems, [{ cardId: 'a', set: '001', foil: true, qty: 1 }]);
});

test('finishGoverns is true when any recognized line is not explicitly locked, even all-fixed', () => {
  assert.equal(planWantDraft(draftOf({ fixed: [fixedRow()] }), {}).finishGoverns, true);
  assert.equal(planWantDraft(draftOf({ fixed: [fixedRow({ lockedFinish: 'foil' })] }), {}).finishGoverns, false, 'only locked lines -> no batch finish to show');
});

/* ---------------- choice rows ---------------- */

test('an unchosen choice row BLOCKS confirm; a chosen one commits its (set, foil)', () => {
  const blocked = planWantDraft(draftOf({ needsChoice: [choiceRow()] }), { batchFinish: 'nonFoil', choices: {} });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.ctaLabel, 'Choose a set for 1 more');
  const chosen = planWantDraft(draftOf({ needsChoice: [choiceRow()] }), { batchFinish: 'nonFoil', choices: { k: '002' } });
  assert.equal(chosen.ready, true);
  assert.deepEqual(chosen.commitItems, [{ cardId: 'a', set: '002', foil: false, qty: 1 }]);
});

test('an impossible lock blocks until overridden; skip excludes, non-foil resolves', () => {
  const r = fixedRow({ lockedFinish: 'foil', anyFoil: false, sets: [BETA_NF], fixedSet: '002' });
  assert.equal(planWantDraft(draftOf({ fixed: [r] }), { batchFinish: 'nonFoil' }).rows[0].status, 'lockImpossible');
  const skipped = planWantDraft(draftOf({ fixed: [r] }), { batchFinish: 'nonFoil', overrides: { k: 'skip' } });
  assert.equal(skipped.skipCount, 1);
  const nf = planWantDraft(draftOf({ fixed: [r] }), { batchFinish: 'nonFoil', overrides: { k: 'nonFoil' } });
  assert.deepEqual(nf.commitItems, [{ cardId: 'a', set: '002', foil: false, qty: 1 }]);
});

/* ---------------- Major 3: canonical convergence ---------------- */

test('a fixed row and a chosen row that converge are ONE printing, quantities summed', () => {
  const fx = fixedRow({ key: 'k1', fixedSet: '002', sets: [ALPHA_BOTH, BETA_NF], qty: 1, parts: [1] });
  const ch = choiceRow({ key: 'k2', sets: [ALPHA_BOTH, BETA_NF], qty: 3, parts: [3] });
  const v = planWantDraft(draftOf({ fixed: [fx], needsChoice: [ch] }), { batchFinish: 'nonFoil', choices: { k2: '002' } });
  assert.equal(v.addCount, 1, 'one printing, not two');
  assert.deepEqual(v.commitItems.sort((a, b) => a.qty - b.qty), [
    { cardId: 'a', set: '002', foil: false, qty: 1 },
    { cardId: 'a', set: '002', foil: false, qty: 3 },
  ]);
  assert.equal(v.copies, 4);
  assert.match(v.ctaLabel, /Add 1 printing/);
});

test('two choice rows converging to one printing merge; foil vs non-foil stay two', () => {
  const a = choiceRow({ key: 'k1', qty: 1, parts: [1] });
  const b = choiceRow({ key: 'k2', qty: 2, parts: [2] });
  const same = planWantDraft(draftOf({ needsChoice: [a, b] }), { batchFinish: 'nonFoil', choices: { k1: '002', k2: '002' } });
  assert.equal(same.addCount, 1);
  const split = planWantDraft(draftOf({ needsChoice: [a, b] }), { batchFinish: 'nonFoil', choices: { k1: '001', k2: '001' } });   // Alpha both finishes
  // both non-foil here -> still one; but a foil lock on one splits them:
  assert.equal(split.addCount, 1);
  const c = choiceRow({ key: 'k3', qty: 1, parts: [1], lockedFinish: 'foil' });
  const two = planWantDraft(draftOf({ needsChoice: [a, c] }), { batchFinish: 'nonFoil', choices: { k1: '001', k3: '001' } });
  assert.equal(two.addCount, 2, 'Alpha non-foil and Alpha foil are distinct printings');
});

test('resolved parts expand so 999 + 999 reaches the writer as two contributions', () => {
  const r = fixedRow({ fixedSet: '002', sets: [BETA_NF], qty: 1998, parts: [999, 999] });
  const v = planWantDraft(draftOf({ fixed: [r] }), { batchFinish: 'nonFoil' });
  assert.deepEqual(v.commitItems, [
    { cardId: 'a', set: '002', foil: false, qty: 999 },
    { cardId: 'a', set: '002', foil: false, qty: 999 },
  ]);
  assert.equal(v.addCount, 1);
  assert.equal(v.copies, 1998);
});

/* ---------------- SET FOR ALL ---------------- */

test('SET FOR ALL chooses a set only where a choice row has it and it supports the finish', () => {
  const hasBeta = choiceRow({ key: 'k1', sets: [ALPHA_BOTH, BETA_NF] });
  const noBeta = choiceRow({ key: 'k2', sets: [ALPHA_BOTH] });
  const draft = draftOf({ needsChoice: [hasBeta, noBeta] });
  assert.deepEqual(applySetForAll(draft, { batchFinish: 'nonFoil', choices: {} }, '002'), { k1: '002' });
});

test('setForAll reports pressed state when every eligible choice row resolves to that set', () => {
  const a = choiceRow({ key: 'k1', sets: [ALPHA_BOTH, BETA_NF] });
  const b = choiceRow({ key: 'k2', sets: [ALPHA_BOTH, BETA_NF] });
  const draft = draftOf({ needsChoice: [a, b] });
  const none = planWantDraft(draft, { batchFinish: 'nonFoil', choices: { k1: '002' } });
  assert.equal(none.setForAll.find((s) => s.code === '002').pressed, false, 'not all rows on Beta yet');
  const all = planWantDraft(draft, { batchFinish: 'nonFoil', choices: { k1: '002', k2: '002' } });
  assert.equal(all.setForAll.find((s) => s.code === '002').pressed, true);
});
