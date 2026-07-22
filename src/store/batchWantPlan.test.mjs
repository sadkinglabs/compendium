// The pure whole-paste wishlist draft planner (src/store/batchWantPlan.js).
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowTarget, rowOptions, planWantDraft, applySetForAll } from './batchWantPlan.js';

// A needsChoice row. sets carry per-set finish availability.
const row = (over = {}) => ({
  key: over.key || 'k', cardId: over.cardId || 'a', name: over.name || 'Card', qty: over.qty ?? 1, parts: over.parts || [over.qty ?? 1],
  sets: over.sets || [{ code: '001', name: 'Alpha', nonFoil: true, foil: true }, { code: '002', name: 'Beta', nonFoil: true, foil: false }],
  anyFoil: over.anyFoil ?? true, lockedFinish: over.lockedFinish ?? null, reason: over.reason ?? null,
});

/* ---------------- rowTarget ---------------- */

test('no lock -> the batch finish', () => {
  assert.deepEqual(rowTarget(row(), 'nonFoil'), { finish: 'nonFoil' });
  assert.deepEqual(rowTarget(row(), 'foil'), { finish: 'foil' });
});

test('a valid [Foil] lock forces foil regardless of the batch finish', () => {
  assert.deepEqual(rowTarget(row({ lockedFinish: 'foil', anyFoil: true }), 'nonFoil'), { finish: 'foil', forcedByLock: true });
});

test('an impossible [Foil] lock demands a per-row choice; override resolves it', () => {
  const r = row({ lockedFinish: 'foil', anyFoil: false });
  assert.deepEqual(rowTarget(r, 'nonFoil'), { finish: null, needLockChoice: true });
  assert.deepEqual(rowTarget(r, 'nonFoil', 'nonFoil'), { finish: 'nonFoil', wasImpossibleLock: true });
  assert.deepEqual(rowTarget(r, 'nonFoil', 'skip'), { finish: null, skip: true });
});

/* ---------------- rowOptions ---------------- */

test('foil target offers only foil-supporting sets', () => {
  assert.deepEqual(rowOptions(row(), 'foil'), [{ code: '001', name: 'Alpha', foil: true }]);
});

test('non-foil target offers non-foil sets, plus foil-only sets that file forced foil', () => {
  const r = row({ sets: [{ code: '001', name: 'Alpha', nonFoil: true, foil: false }, { code: '999', name: 'Promo', nonFoil: false, foil: true }] });
  assert.deepEqual(rowOptions(r, 'nonFoil'), [
    { code: '001', name: 'Alpha', foil: false },
    { code: '999', name: 'Promo', foil: true, forced: true },
  ]);
});

/* ---------------- planWantDraft ---------------- */

const draftOf = (needsChoice = [], resolved = []) => ({ resolved, needsChoice, unknown: [], flagged: [] });

test('an unchosen row BLOCKS confirm and offers no commit', () => {
  const v = planWantDraft(draftOf([row()]), { batchFinish: 'nonFoil', choices: {} });
  assert.equal(v.rows[0].status, 'unchosen');
  assert.equal(v.ready, false);
  assert.equal(v.ctaLabel, 'Choose a set for 1 more');
  assert.deepEqual(v.commitItems, []);
});

test('a chosen row commits its exact (set, foil)', () => {
  const v = planWantDraft(draftOf([row()]), { batchFinish: 'nonFoil', choices: { k: '002' } });
  assert.equal(v.rows[0].status, 'chosen');
  assert.equal(v.ready, true);
  assert.deepEqual(v.commitItems, [{ cardId: 'a', set: '002', foil: false, qty: 1 }]);
  assert.equal(v.ctaLabel, 'Add 1 printing');
});

test('a foil-only chosen set files forced foil under a non-foil batch (intent upgraded, shown)', () => {
  const r = row({ sets: [{ code: '999', name: 'Promo', nonFoil: false, foil: true }] });
  const v = planWantDraft(draftOf([r]), { batchFinish: 'nonFoil', choices: { k: '999' } });
  assert.equal(v.rows[0].forcedFoil, true);
  assert.deepEqual(v.commitItems, [{ cardId: 'a', set: '999', foil: true, qty: 1 }]);
});

test('a Foil batch SKIPS a row with no foil printing - excluded, counted, never filed non-foil', () => {
  const r = row({ sets: [{ code: '002', name: 'Beta', nonFoil: true, foil: false }], anyFoil: false });
  const v = planWantDraft(draftOf([r]), { batchFinish: 'foil', choices: {} });
  assert.equal(v.rows[0].status, 'skipNoFoil');
  assert.equal(v.skipCount, 1);
  assert.deepEqual(v.commitItems, [], 'not filed as non-foil');
  assert.equal(v.ready, false, 'nothing to add and nothing else');
});

test('an impossible lock blocks until overridden; skip excludes, non-foil resolves', () => {
  const r = row({ lockedFinish: 'foil', anyFoil: false, sets: [{ code: '002', name: 'Beta', nonFoil: true, foil: false }] });
  assert.equal(planWantDraft(draftOf([r]), { batchFinish: 'nonFoil', choices: {} }).rows[0].status, 'lockImpossible');
  const skipped = planWantDraft(draftOf([r]), { batchFinish: 'nonFoil', choices: {}, overrides: { k: 'skip' } });
  assert.equal(skipped.rows[0].status, 'lockSkip');
  assert.equal(skipped.skipCount, 1);
  const nf = planWantDraft(draftOf([r]), { batchFinish: 'nonFoil', choices: { k: '002' }, overrides: { k: 'nonFoil' } });
  assert.equal(nf.rows[0].status, 'chosen');
  assert.deepEqual(nf.commitItems, [{ cardId: 'a', set: '002', foil: false, qty: 1 }]);
});

test('resolved entries always commit; parts expand to per-line contributions', () => {
  const v = planWantDraft(draftOf([], [{ cardId: 'z', setCode: '002', foil: true, qty: 1998, parts: [999, 999] }]), {});
  assert.deepEqual(v.commitItems, [
    { cardId: 'z', set: '002', foil: true, qty: 999 },
    { cardId: 'z', set: '002', foil: true, qty: 999 },
  ]);
  assert.equal(v.addCount, 1, 'one collector item...');
  assert.equal(v.copies, 1998, '...two contributions');
});

test('CTA counts printings and skips; blocking wins the label', () => {
  const ok = row({ key: 'k1', qty: 2, parts: [2] });
  const skip = row({ key: 'k2', anyFoil: false, sets: [{ code: '002', name: 'Beta', nonFoil: true, foil: false }] });
  const v = planWantDraft(draftOf([ok, skip]), { batchFinish: 'foil', choices: { k1: '001' } });
  assert.equal(v.skipCount, 1);
  assert.equal(v.ctaLabel, 'Add 1 printing · skipping 1');
});

/* ---------------- applySetForAll ---------------- */

test('SET FOR ALL chooses the set only where the card has it AND it supports the finish', () => {
  const hasBetaNF = row({ key: 'k1', sets: [{ code: '001', name: 'Alpha', nonFoil: true, foil: true }, { code: '002', name: 'Beta', nonFoil: true, foil: false }] });
  const betaFoilOnlyMissing = row({ key: 'k2', sets: [{ code: '001', name: 'Alpha', nonFoil: true, foil: true }] });   // no Beta at all
  const draft = draftOf([hasBetaNF, betaFoilOnlyMissing]);
  const choices = applySetForAll(draft, { batchFinish: 'nonFoil', choices: {} }, '002');
  assert.deepEqual(choices, { k1: '002' }, 'k2 has no Beta, so it keeps no choice');
});

test('SET FOR ALL under a Foil batch skips a row whose set is non-foil only', () => {
  const betaNFonly = row({ key: 'k1', anyFoil: true, sets: [{ code: '001', name: 'Alpha', nonFoil: true, foil: true }, { code: '002', name: 'Beta', nonFoil: true, foil: false }] });
  const choices = applySetForAll(draft(betaNFonly), { batchFinish: 'foil', choices: {} }, '002');
  assert.deepEqual(choices, {}, 'Beta has no foil, so Foil-for-all cannot assign it');
  function draft(r) { return draftOf([r]); }
});
