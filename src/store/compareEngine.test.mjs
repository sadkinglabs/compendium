// Fixtures for the Collection comparison engine (src/store/compareEngine.js).
// Run: npm run test:query   (node --test, same glob as cardQuery).
// Pins the load-bearing invariants: min(owned,required) math, the decks-never-
// reserve property, unresolved-blocks-buildable, and the missing-list formatter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, compareRequirements, missingLines, formatMissingText } from './compareEngine.js';

const owned = (obj) => new Map(Object.entries(obj));

test('aggregate sums duplicate card_ids and drops nulls', () => {
  const m = aggregate([{ card_id: 'a', qty: 2 }, { card_id: 'a', qty: 1 }, { card_id: null, qty: 5 }, { card_id: 'b', qty: 3 }]);
  assert.equal(m.get('a'), 3);
  assert.equal(m.get('b'), 3);
  assert.equal(m.has(null), false);
});

test('fully owned deck is complete/buildable', () => {
  const r = compareRequirements([{ card_id: 'a', qty: 4 }, { card_id: 'b', qty: 2 }], owned({ a: 4, b: 3 }));
  assert.equal(r.complete, true);
  assert.equal(r.totalMissing, 0);
  assert.equal(r.percent, 100);
});

test('partial ownership reports per-card shortfall, missing-first order', () => {
  const r = compareRequirements([{ card_id: 'a', qty: 4 }, { card_id: 'b', qty: 2 }], owned({ a: 1, b: 2 }));
  assert.equal(r.complete, false);
  assert.equal(r.totalRequired, 6);
  assert.equal(r.totalHave, 3);          // min(1,4)=1 + min(2,2)=2
  assert.equal(r.totalMissing, 3);
  assert.equal(r.lines[0].card_id, 'a'); // biggest shortfall first
  assert.deepEqual(missingLines(r).map((l) => l.card_id), ['a']);
});

test('owning MORE than required never over-credits (have capped at required)', () => {
  const r = compareRequirements([{ card_id: 'a', qty: 2 }], owned({ a: 10 }));
  assert.equal(r.lines[0].have, 2);
  assert.equal(r.lines[0].owned, 10);
  assert.equal(r.totalMissing, 0);
});

test('DECKS NEVER RESERVE: two decks both needing 4 of an owned-4 card are BOTH buildable', () => {
  const collection = owned({ bolt: 4 });
  const deckA = compareRequirements([{ card_id: 'bolt', qty: 4 }], collection);
  const deckB = compareRequirements([{ card_id: 'bolt', qty: 4 }], collection);
  assert.equal(deckA.complete, true);
  assert.equal(deckB.complete, true);    // no subtraction, no ordering effect
  assert.equal(collection.get('bolt'), 4); // the owned map is never mutated
});

test('unresolved (unknown) cards block "buildable" even when everything known is owned', () => {
  const r = compareRequirements([{ card_id: 'a', qty: 2 }], owned({ a: 2 }), 1);
  assert.equal(r.totalMissing, 0);
  assert.equal(r.unresolved, 1);
  assert.equal(r.complete, false);       // 1 unidentified card -> not confidently buildable
});

test('empty requirement is vacuously complete (100%)', () => {
  const r = compareRequirements([], owned({}));
  assert.equal(r.percent, 100);
  assert.equal(r.complete, true);
  assert.equal(r.totalCards, 0);
});

test('accepts a pre-aggregated Map as required', () => {
  const r = compareRequirements(new Map([['a', 3]]), owned({ a: 1 }));
  assert.equal(r.totalMissing, 2);
});

test('formatMissingText: qty x name, name-sorted, with header', () => {
  const r = compareRequirements([{ card_id: 'z', qty: 3 }, { card_id: 'a', qty: 2 }], owned({ z: 1, a: 0 }));
  const names = new Map([['z', 'Zephyr'], ['a', 'Amulet']]);
  const txt = formatMissingText(r, names, 'Missing for Deck X');
  assert.equal(txt, 'Missing for Deck X (2 cards)\n2x Amulet\n2x Zephyr');
});
