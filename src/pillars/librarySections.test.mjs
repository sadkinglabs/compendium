// Library sectioning and the section-local -> global order mapping.
//
// The cases that matter are the ones a device pass will not reliably catch: a header rendered over
// an empty section, a drag in the second section silently renumbering the first, and the boundary
// indices of a two-section list. `reorderDecks` refuses a partial set and refuses a plain deck above
// a favourite, so a mapping bug here would surface on device as a toast and a snap-back - late.
// Run: npm run test:ui
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { librarySections, reorderInSection } from './librarySections.js';

const deck = (id, starred) => ({ id, starred: starred ? 1 : 0 });
const ids = (list) => list.map((d) => d.id);
// Two favourites then three plain decks - the shape listDecks returns.
const MIXED = [deck('a', 1), deck('b', 1), deck('c'), deck('d'), deck('e')];

/* ---------------- librarySections ---------------- */

test('a mixed library splits into Favourites then My Decks', () => {
  const s = librarySections(MIXED);
  assert.deepEqual(s.map((x) => x.key), ['fav', 'rest']);
  assert.deepEqual(s.map((x) => x.label), ['FAVOURITES', 'MY DECKS']);
  assert.deepEqual(ids(s[0].rows), ['a', 'b']);
  assert.deepEqual(ids(s[1].rows), ['c', 'd', 'e']);
});

test('a section with no rows is not rendered at all - no empty header', () => {
  const none = librarySections([deck('c'), deck('d')]);
  assert.deepEqual(none.map((x) => x.key), ['rest']);
  const all = librarySections([deck('a', 1), deck('b', 1)]);
  assert.deepEqual(all.map((x) => x.key), ['fav']);
  assert.deepEqual(librarySections([]), []);
  assert.deepEqual(librarySections(null), []);
});

test('order within a section is preserved, and favourites lead even if the input is interleaved', () => {
  // Defensive: the query sorts starred DESC so this shape should not arrive, but the mapping must
  // never hand reorderDecks a plain deck above a favourite.
  const s = librarySections([deck('c'), deck('a', 1), deck('d'), deck('b', 1)]);
  assert.deepEqual(ids(s[0].rows), ['a', 'b']);
  assert.deepEqual(ids(s[1].rows), ['c', 'd']);
});

test('starred is read as truthiness, not as the literal 1', () => {
  const s = librarySections([{ id: 'a', starred: true }, { id: 'b' }, { id: 'c', starred: 0 }]);
  assert.deepEqual(ids(s[0].rows), ['a']);
  assert.deepEqual(ids(s[1].rows), ['b', 'c']);
});

/* ---------------- reorderInSection ---------------- */

test('reordering the second section leaves the first untouched', () => {
  // c d e -> e c d
  assert.deepEqual(ids(reorderInSection(MIXED, 'rest', 2, 0)), ['a', 'b', 'e', 'c', 'd']);
});

test('reordering the first section leaves the second untouched', () => {
  assert.deepEqual(ids(reorderInSection(MIXED, 'fav', 0, 1)), ['b', 'a', 'c', 'd', 'e']);
});

test('section indices are section-local - index 0 of My Decks is the third deck overall', () => {
  // The off-by-one this module exists for: 'rest' index 0 is 'c', not 'a'.
  assert.deepEqual(ids(reorderInSection(MIXED, 'rest', 0, 2)), ['a', 'b', 'd', 'e', 'c']);
});

test('every reachable move in My Decks is reproducible by the starred-first query', () => {
  const rest = ['c', 'd', 'e'];
  for (let from = 0; from < rest.length; from++) {
    for (let to = 0; to < rest.length; to++) {
      const out = reorderInSection(MIXED, 'rest', from, to);
      assert.deepEqual(ids(out).slice(0, 2), ['a', 'b'], `fav moved on ${from}->${to}`);
      assert.deepEqual([...ids(out)].sort(), ['a', 'b', 'c', 'd', 'e'], `set changed on ${from}->${to}`);
      assert.equal(out.filter((d) => d.starred).length, 2);
    }
  }
});

test('a no-op or out-of-range move returns the input by identity', () => {
  assert.equal(reorderInSection(MIXED, 'rest', 1, 1), MIXED);
  assert.equal(reorderInSection(MIXED, 'rest', 0, 3), MIXED);   // 3 is past the end of a 3-row section
  assert.equal(reorderInSection(MIXED, 'fav', 0, 2), MIXED);    // 2 is past the end of a 2-row section
  assert.equal(reorderInSection(MIXED, 'rest', -1, 0), MIXED);
  assert.equal(reorderInSection(MIXED, 'rest', 0.5, 1), MIXED);
});

test('an unknown or absent section changes nothing', () => {
  assert.equal(reorderInSection(MIXED, 'nope', 0, 1), MIXED);
  // No favourites at all: a 'fav' commit cannot arrive, and if it did it must not touch the list.
  const plain = [deck('c'), deck('d')];
  assert.equal(reorderInSection(plain, 'fav', 0, 1), plain);
});

test('an all-starred library reorders as one section', () => {
  const all = [deck('a', 1), deck('b', 1), deck('c', 1)];
  assert.deepEqual(ids(reorderInSection(all, 'fav', 2, 0)), ['c', 'a', 'b']);
  assert.equal(reorderInSection(all, 'rest', 0, 1), all);
});

test('an empty or missing list survives a stray commit', () => {
  assert.deepEqual(reorderInSection([], 'fav', 0, 1), []);
  assert.deepEqual(reorderInSection(null, 'rest', 0, 1), []);
});
