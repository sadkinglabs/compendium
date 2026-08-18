// Characterization of Collection's routing, written BEFORE the file is split so the split
// cannot quietly change which surface shows. These assert current shipped behaviour, not a
// new design - if one of them starts failing during the extraction, the extraction is wrong.
// Run: npm run test:ui
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionSurface, COLLECTION_SURFACES } from './collectionRoute.js';

test('the three chips pick their own surface', () => {
  assert.equal(collectionSurface({ view: 'overview' }), 'overview');
  assert.equal(collectionSurface({ view: 'cards' }), 'setsHome');
  assert.equal(collectionSurface({ view: 'lists' }), 'listsIndex');
});

test('a set code drills, but only inside My Collection', () => {
  assert.equal(collectionSurface({ view: 'cards', setDrill: '002' }), 'setDrill');
  assert.equal(collectionSurface({ view: 'cards', setDrill: null }), 'setsHome');
});

test('an open list shows its detail, but only inside Lists', () => {
  assert.equal(collectionSurface({ view: 'lists', listOpen: { id: 'L1' } }), 'listDetail');
  assert.equal(collectionSurface({ view: 'lists', listOpen: null }), 'listsIndex');
});

test('a STALE drill code cannot resurrect the drill from another view', () => {
  // The nav cache survives an unmount (Codex hand-off, scanner), so these combinations are
  // real states, not hypotheticals.
  assert.equal(collectionSurface({ view: 'lists', setDrill: '002' }), 'listsIndex');
  assert.equal(collectionSurface({ view: 'overview', setDrill: '002' }), 'overview');
});

test('a STALE open list cannot resurrect list detail from another view', () => {
  assert.equal(collectionSurface({ view: 'cards', listOpen: { id: 'L1' } }), 'setsHome');
  assert.equal(collectionSurface({ view: 'overview', listOpen: { id: 'L1' } }), 'overview');
});

test('view wins over both when they disagree', () => {
  assert.equal(collectionSurface({ view: 'cards', setDrill: '002', listOpen: { id: 'L1' } }), 'setDrill');
  assert.equal(collectionSurface({ view: 'lists', setDrill: '002', listOpen: { id: 'L1' } }), 'listDetail');
});

test('an unknown or missing view falls back to Overview, never to nothing', () => {
  assert.equal(collectionSurface({}), 'overview');
  assert.equal(collectionSurface(), 'overview');
  assert.equal(collectionSurface({ view: 'binder' }), 'overview', 'a stale view from an older build');
});

test('the empty-string set code is a REAL drill (Unspecified), not an absent one', () => {
  // '' is the Unspecified printing bucket. `setDrill != null` is deliberate: a truthiness
  // check here would make that set unreachable.
  assert.equal(collectionSurface({ view: 'cards', setDrill: '' }), 'setDrill');
});

test('every returned surface is a declared one', () => {
  const cases = [
    {}, { view: 'cards' }, { view: 'cards', setDrill: '1' },
    { view: 'lists' }, { view: 'lists', listOpen: {} }, { view: 'nonsense' },
  ];
  for (const c of cases) assert.ok(COLLECTION_SURFACES.includes(collectionSurface(c)), JSON.stringify(c));
});

/* ---------------- storage (increment 3) ---------------- */

test('storage is a SECTION of My Collection - there is no storage index surface', () => {
  // Owner ruling: "INSIDE My Collection - top section would be sets, and below you'd have Storage",
  // agreed in preference to a fourth chip, and "it keeps the chip row at three". So the list of
  // places renders on setsHome; only opening one is a surface.
  assert.equal(collectionSurface({ view: 'cards' }), 'setsHome');
  assert.equal(collectionSurface({ view: 'cards', placeOpen: { id: 'c1' } }), 'storageDetail');
  assert.equal(collectionSurface({ view: 'storage' }), 'overview', 'no such view; unknown lands somewhere real');
});

test('a set drill outranks an open place', () => {
  assert.equal(collectionSurface({ view: 'cards', placeOpen: { id: 'c1' }, setDrill: '001' }), 'setDrill');
});

test('a stale placeOpen cannot resurrect the place drill from another view', () => {
  const stale = { placeOpen: { id: 'c1' } };
  assert.equal(collectionSurface({ view: 'lists', ...stale }), 'listsIndex');
  assert.equal(collectionSurface({ view: 'overview', ...stale }), 'overview');
});
