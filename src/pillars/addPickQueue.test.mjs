// The pending-printing queue and batch-add copy. The behaviours Codex named, made executable.
// Run: npm run test:ui
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueuePick, dequeuePick, headPick, soleExistingItem, batchAddSummary,
  ADD_APPLIED, ADD_CHOICE_REQUIRED, ADD_REFUSED,
} from './addPickQueue.js';

/* ---------------- the reviewed quantity survives disambiguation ---------------- */

test('a queued pick keeps its original delta, so a reviewed quantity is not lost', () => {
  // Paste 4 Albespine Pikemen, choose Beta - all four must be added, not one. The queue carries
  // the delta the picker replays; hardcoding 1 on replay is the bug this guards.
  const q = enqueuePick([], { card: { card_id: 'c1' }, codes: ['001', '002'], delta: 4 });
  assert.equal(headPick(q).delta, 4);
});

/* ---------------- several reprints are asked FIFO ---------------- */

test('two ambiguous reprints are asked in order', () => {
  let q = enqueuePick([], { card: { card_id: 'a' }, codes: ['001', '002'], delta: 1 });
  q = enqueuePick(q, { card: { card_id: 'b' }, codes: ['001', '002'], delta: 1 });
  assert.equal(headPick(q).card.card_id, 'a', 'first asked first');
  assert.equal(headPick(dequeuePick(q)).card.card_id, 'b', 'then the second');
});

test('skipping the first preserves the second', () => {
  let q = enqueuePick([], { card: { card_id: 'a' }, codes: [], delta: 1 });
  q = enqueuePick(q, { card: { card_id: 'b' }, codes: [], delta: 1 });
  const after = dequeuePick(q);   // skip a
  assert.equal(after.length, 1);
  assert.equal(headPick(after).card.card_id, 'b', 'b did not go with a');
});

test('an empty queue has no head', () => {
  assert.equal(headPick([]), null);
  assert.equal(headPick(dequeuePick([])), null);
});

/* ---------------- no premature "Added" ---------------- */

test('copy never says Added about cards still awaiting a choice', () => {
  const only = batchAddSummary([ADD_CHOICE_REQUIRED, ADD_CHOICE_REQUIRED]);
  assert.equal(only, 'Choose printings for 2 cards');
  assert.ok(!/added/i.test(only), 'no past tense while choices remain');
});

test('all-applied says exactly what was added', () => {
  assert.equal(batchAddSummary([ADD_APPLIED, ADD_APPLIED, ADD_APPLIED]), 'Added 3 cards');
  assert.equal(batchAddSummary([ADD_APPLIED]), 'Added 1 card');
});

test('a mixed batch separates what was done from what is pending', () => {
  const msg = batchAddSummary([ADD_APPLIED, ADD_APPLIED, ADD_APPLIED, ADD_CHOICE_REQUIRED, ADD_CHOICE_REQUIRED]);
  assert.equal(msg, 'Added 3, choose printings for 2 more');
});

test('refused cards are not counted as added - they warned for themselves', () => {
  assert.equal(batchAddSummary([ADD_REFUSED, ADD_REFUSED]), null, 'nothing untruthful is said');
  assert.equal(batchAddSummary([ADD_APPLIED, ADD_REFUSED]), 'Added 1 card', 'only the real add is claimed');
});

test('one applied and one choice reads naturally in the singular', () => {
  assert.equal(batchAddSummary([ADD_APPLIED, ADD_CHOICE_REQUIRED]), 'Added 1, choose printing for 1 more');
});

/* ---------------- reuse is by identity, not by delta ---------------- */

test('a card with exactly one existing want is reused, for either sign of delta', () => {
  const keys = ['c1|001', 'c2|002', 'c2|001'];
  assert.equal(soleExistingItem(keys, 'c1'), 'c1|001', 'the single item is the target');
  assert.equal(soleExistingItem(keys, 'c2'), null, 'two items is ambiguous - do not guess');
  assert.equal(soleExistingItem(keys, 'c3'), null, 'none is not reuse');
});

test('reuse does not depend on the delta - the property that makes + and - symmetric', () => {
  // soleExistingItem takes no delta at all, which is the point: pressing + or - on a card the
  // user already wants one printing of resolves to the same row.
  assert.equal(soleExistingItem.length, 2, 'signature is (itemKeys, cardId) - no delta');
});
