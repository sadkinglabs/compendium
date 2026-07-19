// Deterministic tests for the pure set-completion model (Collection UX Phase 1).
// Covers the six cases the proposal requires: multi-set cards, foil-only ownership,
// the Unspecified bucket, zero-owned sets, empty sets, new set codes, token exclusion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSetCompletion } from './setCompletion.js';

// code -> name; 005 (Dragonlord) is present but has NO cards (empty-set case).
const SET_CATALOG = { '001': 'Alpha', '002': 'Beta', '005': 'Dragonlord', '006': 'Gothic' };

const card = (id, sets, name = id) => ({ card_id: id, name, _sets: sets });
const S = (name, code) => ({ name, code });

const CARDS = [
  card('a', [S('Alpha', '001'), S('Beta', '002')]),        // multi-set
  card('b', [S('Alpha', '001')]),                          // foil-only owned below
  card('c', [S('Gothic', '006')]),                         // 006 has a card, 0 owned
  card('n', [S('Frostfell', '007')]),                      // 007 NOT in setCatalog -> new code
  card('t', [S('Alpha', '001')], 'Foot Soldier'),          // token -> excluded
];

const OWNED = new Map([
  ['a|001', { owned: 2, foil: 0 }],  // a owned in Alpha
  ['b|001', { owned: 0, foil: 1 }],  // b foil-ONLY in Alpha -> still owned
  ['a|', { owned: 5, foil: 0 }],     // Unspecified bucket -> must NOT count anywhere
]);

const byCode = (rows) => Object.fromEntries(rows.map((r) => [r.code, r]));

test('multi-set + foil-only + token exclusion: Alpha denominator and owned are correct', () => {
  const rows = byCode(buildSetCompletion(CARDS, OWNED, SET_CATALOG));
  // a and b list Alpha; the token 'Foot Soldier' also lists Alpha but is excluded.
  assert.equal(rows['001'].totalCollectible, 2, 'token must not inflate the denominator');
  // a (regular) + b (foil-only) both count as owned.
  assert.equal(rows['001'].ownedUnique, 2, 'foil-only ownership counts');
  assert.equal(rows['001'].pct, 1);
});

test('multi-set card counts in each of its sets independently', () => {
  const rows = byCode(buildSetCompletion(CARDS, OWNED, SET_CATALOG));
  assert.equal(rows['002'].totalCollectible, 1, 'a is counted in Beta too');
  assert.equal(rows['002'].ownedUnique, 0, 'a is not owned in Beta');
  assert.equal(rows['002'].pct, 0);
});

test('Unspecified bucket ("a|") never inflates a real set', () => {
  const rows = byCode(buildSetCompletion(CARDS, OWNED, SET_CATALOG));
  // If "a|" leaked, Alpha owned would exceed its denominator.
  assert.ok(rows['001'].ownedUnique <= rows['001'].totalCollectible);
  assert.equal(rows['001'].ownedUnique, 2);
});

test('zero-owned set is retained (Gothic: 1 card, 0 owned)', () => {
  const rows = byCode(buildSetCompletion(CARDS, OWNED, SET_CATALOG));
  assert.ok(rows['006'], 'Gothic present');
  assert.equal(rows['006'].totalCollectible, 1);
  assert.equal(rows['006'].ownedUnique, 0);
  assert.equal(rows['006'].pct, 0);
});

test('empty set (in catalog, no cards) is retained at 0/0, pct 0', () => {
  const rows = byCode(buildSetCompletion(CARDS, OWNED, SET_CATALOG));
  assert.ok(rows['005'], 'Dragonlord present despite having no cards');
  assert.equal(rows['005'].totalCollectible, 0);
  assert.equal(rows['005'].pct, 0);
});

test('newly-introduced set code appears with the card-supplied name', () => {
  const rows = byCode(buildSetCompletion(CARDS, OWNED, SET_CATALOG));
  assert.ok(rows['007'], '007 not in setCatalog but a card lists it');
  assert.equal(rows['007'].name, 'Frostfell');
  assert.equal(rows['007'].totalCollectible, 1);
});

test('output is sorted by numeric set code', () => {
  const codes = buildSetCompletion(CARDS, OWNED, SET_CATALOG).map((r) => r.code);
  assert.deepEqual(codes, ['001', '002', '005', '006', '007']);
});

test('empty inputs do not throw and yield the seeded catalog sets at 0', () => {
  const rows = byCode(buildSetCompletion([], new Map(), SET_CATALOG));
  assert.equal(rows['001'].totalCollectible, 0);
  assert.equal(rows['001'].pct, 0);
  assert.equal(Object.keys(rows).length, 4); // the 4 seeded sets
});
