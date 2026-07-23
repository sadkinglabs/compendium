// Pure tests for the Collection ownership-derived refine axes: finish scope, playset buckets, the
// combined ownership predicate, and the within-group sort. Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effOwned, matchesPlayset, rowMatchesOwn, ownActive, rowComparator } from './collectionFilter.js';

// A capped Ordinary card (playset = 4) and an unlimited ("any number of") card.
const ORD = { card_id: 'o', name: 'Ordinary One', rarity: 'Ordinary' };
const UNLIM = { card_id: 'u', name: 'Unbound', rarity: 'Ordinary', rules_text: 'You may have any number of Unbound in your deck.' };
const AVATAR = { card_id: 'av', name: 'Avatar', rarity: null };
const row = (card, owned, foil, added = '') => ({ card, set: '001', owned, foil, added });

/* ---------------- effOwned (finish scope) ---------------- */

test('effOwned: unscoped counts BOTH finishes; a finish narrows to it', () => {
  const r = row(ORD, 2, 3);
  assert.equal(effOwned(r, []), 5, 'no finish -> standard + foil');
  assert.equal(effOwned(r, ['standard']), 2);
  assert.equal(effOwned(r, ['foil']), 3);
  assert.equal(effOwned(r, ['standard', 'foil']), 5, 'both selected = all');
});

/* ---------------- playset buckets ---------------- */

test('matchesPlayset: complete (>=limit), over (>limit), partial (0<t<limit)', () => {
  assert.equal(matchesPlayset(row(ORD, 4, 0), ['complete']), true, '4 of 4 is complete');
  assert.equal(matchesPlayset(row(ORD, 5, 0), ['complete']), true, '5 still completes (>= limit)');
  assert.equal(matchesPlayset(row(ORD, 5, 0), ['over']), true, '5 > 4 is over');
  assert.equal(matchesPlayset(row(ORD, 4, 0), ['over']), false, 'exactly 4 is not over');
  assert.equal(matchesPlayset(row(ORD, 2, 0), ['partial']), true, '0 < 2 < 4');
  assert.equal(matchesPlayset(row(ORD, 0, 0), ['partial']), false, 'owning nothing is not partial (it is Missing)');
  assert.equal(matchesPlayset(row(ORD, 2, 0), ['complete', 'over']), false, 'any-of: 2 matches neither');
});

test('matchesPlayset: an UNCAPPED card (unlimited / no rarity) never matches a playset filter', () => {
  assert.equal(matchesPlayset(row(UNLIM, 99, 0), ['complete', 'partial', 'over']), false);
  assert.equal(matchesPlayset(row(AVATAR, 1, 0), ['complete']), false);
});

test('matchesPlayset: the finish scope reframes the count', () => {
  const r = row(ORD, 1, 4);   // 1 standard, 4 foil
  assert.equal(matchesPlayset(r, ['complete'], ['foil']), true, 'foils complete the playset');
  assert.equal(matchesPlayset(r, ['partial'], ['standard']), true, '1 standard is a partial playset');
  assert.equal(matchesPlayset(r, ['complete'], ['standard']), false, '1 standard does not complete');
});

test('an empty playset selection matches everything', () => {
  assert.equal(matchesPlayset(row(ORD, 0, 0), []), true);
});

/* ---------------- combined ownership predicate ---------------- */

test('rowMatchesOwn: Owned = own ANY copy; Missing = own none (in scope)', () => {
  assert.equal(rowMatchesOwn(row(ORD, 0, 1), false, { states: ['owned'] }), true, 'a foil-only card IS owned now');
  assert.equal(rowMatchesOwn(row(ORD, 0, 0), false, { states: ['owned'] }), false);
  assert.equal(rowMatchesOwn(row(ORD, 0, 0), false, { states: ['missing'] }), true);
  assert.equal(rowMatchesOwn(row(ORD, 0, 1), false, { states: ['missing'] }), false, 'owning a foil is not Missing');
});

test('rowMatchesOwn: Finish scopes Owned/Missing - Standard+Missing finds a foil-only card', () => {
  const r = row(ORD, 0, 1);   // foil only
  assert.equal(rowMatchesOwn(r, false, { states: ['missing'], finishes: ['standard'] }), true, 'missing in standard');
  assert.equal(rowMatchesOwn(r, false, { states: ['owned'], finishes: ['foil'] }), true, 'owned in foil');
});

test('rowMatchesOwn: wishlist is judged on the card, independent of copies', () => {
  assert.equal(rowMatchesOwn(row(ORD, 0, 0), true, { states: ['wishlist'] }), true);
  assert.equal(rowMatchesOwn(row(ORD, 0, 0), false, { states: ['wishlist'] }), false);
  assert.equal(rowMatchesOwn(row(ORD, 5, 0), true, { states: ['wishlist'] }), true, 'you can want a card you own');
});

test('rowMatchesOwn: a state group is any-of (OR within), groups are AND', () => {
  // Owned OR Wishlisted, AND a playset of partial.
  const own = { states: ['owned', 'wishlist'], playset: ['partial'] };
  assert.equal(rowMatchesOwn(row(ORD, 2, 0), false, own), true, 'owned + partial');
  assert.equal(rowMatchesOwn(row(ORD, 4, 0), false, own), false, 'owned but complete, not partial');
  assert.equal(rowMatchesOwn(row(ORD, 0, 0), true, own), false, 'wished but not partial (owns nothing)');
});

test('rowMatchesOwn: the Owned-amount comparator', () => {
  assert.equal(rowMatchesOwn(row(ORD, 3, 0), false, { qty: { op: '>=', val: 3 } }), true);
  assert.equal(rowMatchesOwn(row(ORD, 2, 0), false, { qty: { op: '>=', val: 3 } }), false);
  assert.equal(rowMatchesOwn(row(ORD, 2, 0), false, { qty: { op: '<=', val: 2 } }), true);
  assert.equal(rowMatchesOwn(row(ORD, 2, 0), false, { qty: { op: '=', val: 2 } }), true);
  assert.equal(rowMatchesOwn(row(ORD, 2, 3), false, { qty: { op: '=', val: 3 }, finishes: ['foil'] }), true, 'comparator honours the finish scope');
  assert.equal(rowMatchesOwn(row(ORD, 2, 0), false, { qty: { op: '=', val: null } }), true, 'null value is inactive');
});

test('ownActive: true only when some axis is set', () => {
  assert.equal(ownActive({}), false);
  assert.equal(ownActive({ states: [], playset: [], qty: { op: '>=', val: null }, finishes: [] }), false);
  assert.equal(ownActive({ states: ['owned'] }), true);
  assert.equal(ownActive({ finishes: ['foil'] }), true);
  assert.equal(ownActive({ qty: { op: '>=', val: 1 } }), true);
});

/* ---------------- sort ---------------- */

const cardOf = (r) => r.card;
const sorted = (rows, key) => [...rows].sort(rowComparator(key, cardOf)).map((r) => r.card.card_id);

test('rowComparator: name asc/desc', () => {
  const rows = [row({ card_id: 'b', name: 'Beta' }, 0, 0), row({ card_id: 'a', name: 'Alpha' }, 0, 0)];
  assert.deepEqual(sorted(rows, 'name-asc'), ['a', 'b']);
  assert.deepEqual(sorted(rows, 'name-desc'), ['b', 'a']);
});

test('rowComparator: recently added is NEWEST first, blanks last', () => {
  const rows = [
    row({ card_id: 'old', name: 'B' }, 1, 0, '2020-01-01'),
    row({ card_id: 'new', name: 'A' }, 1, 0, '2026-01-01'),
    row({ card_id: 'blank', name: 'C' }, 1, 0, ''),
  ];
  assert.deepEqual(sorted(rows, 'added'), ['new', 'old', 'blank']);
});

test('rowComparator: rarity ascends Ordinary -> Unique, unknown/avatar last, name breaks ties', () => {
  const rows = [
    row({ card_id: 'u', name: 'U', rarity: 'Unique' }, 0, 0),
    row({ card_id: 'o2', name: 'Z-ord', rarity: 'Ordinary' }, 0, 0),
    row({ card_id: 'o1', name: 'A-ord', rarity: 'Ordinary' }, 0, 0),
    row({ card_id: 'av', name: 'Avatar', rarity: null }, 0, 0),
  ];
  assert.deepEqual(sorted(rows, 'rarity-asc'), ['o1', 'o2', 'u', 'av']);
});

test('rowComparator default (name-asc) preserves the historical A-Z order', () => {
  const rows = [row({ card_id: 'b', name: 'Beta' }, 0, 0), row({ card_id: 'a', name: 'Alpha' }, 0, 0)];
  assert.deepEqual(sorted(rows), ['a', 'b']);
});
