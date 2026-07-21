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
  ['a|001', { owned: 2, foil: 0 }],  // a owned NON-FOIL in Alpha
  ['b|001', { owned: 0, foil: 1 }],  // b foil-ONLY in Alpha -> must NOT count (non-foil only)
  ['a|', { owned: 5, foil: 0 }],     // Unspecified bucket -> must NOT count anywhere
]);

const byCode = (rows) => Object.fromEntries(rows.map((r) => [r.code, r]));

test('foil-only does NOT count toward completion; tokens excluded from the denominator', () => {
  const rows = byCode(buildSetCompletion(CARDS, OWNED, SET_CATALOG));
  // a and b list Alpha; the token 'Foot Soldier' also lists Alpha but is excluded.
  assert.equal(rows['001'].totalCollectible, 2, 'token must not inflate the denominator');
  // a is owned non-foil -> counts; b is foil-only -> does NOT count.
  assert.equal(rows['001'].ownedUnique, 1, 'foil-only ownership must not count');
  assert.equal(rows['001'].pct, 0.5);
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
  assert.equal(rows['001'].ownedUnique, 1);
});

test('foilUnique is reported per set but never feeds completion', () => {
  const rows = byCode(buildSetCompletion(CARDS, OWNED, SET_CATALOG));
  // b is foil-only in Alpha: counted as a foil, but not as owned.
  assert.equal(rows['001'].foilUnique, 1, 'foil-only card is reported as a foil');
  assert.equal(rows['001'].ownedUnique, 1, 'and still excluded from completion');
  assert.equal(rows['002'].foilUnique, 0);
});

test('a card owned BOTH non-foil and foil counts exactly once', () => {
  const owned = new Map([['a|001', { owned: 1, foil: 3 }]]);
  const rows = byCode(buildSetCompletion(CARDS, owned, SET_CATALOG));
  assert.equal(rows['001'].ownedUnique, 1, 'non-foil presence counts once, foil ignored');
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

test("the '' Unspecified bucket in setCatalog (SET_LABEL) is never a set plate", () => {
  const withUnspec = { ...SET_CATALOG, '': 'Unspecified' };
  const rows = buildSetCompletion(CARDS, OWNED, withUnspec);
  assert.equal(rows.some((r) => r.code === ''), false, "'' must not appear as a set");
});

test('empty inputs do not throw and yield the seeded catalog sets at 0', () => {
  const rows = byCode(buildSetCompletion([], new Map(), SET_CATALOG));
  assert.equal(rows['001'].totalCollectible, 0);
  assert.equal(rows['001'].pct, 0);
  assert.equal(Object.keys(rows).length, 4); // the 4 seeded sets
});
