// The Collection nav cache must never hand one profile's state to another.
//
// The bug: `listOpen` holds a whole list row (id, name, kind) in a module singleton. Open
// profile A's list, switch to B, return to Collection, and A's list was restored under B -
// name and entries rendered, and Export could hand them over. Writes had always refused a
// foreign list id; reads had not.
// Run: npm run test:ui
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetCollectionSessionFor, collectionSession, __resetCollectionSessionForTests, FRESH_SESSION,
} from './collectionSession.js';

test('the same profile keeps its place', () => {
  __resetCollectionSessionForTests();
  const s = resetCollectionSessionFor('A');
  s.view = 'lists';
  s.listOpen = { id: 'list-a', name: "A's binder", kind: 'custom' };
  const again = resetCollectionSessionFor('A');
  assert.equal(again.view, 'lists');
  assert.equal(again.listOpen.id, 'list-a', 'returning to the same profile must not lose your place');
});

test('SWITCHING PROFILE drops the open list', () => {
  // The disclosure path, exactly.
  __resetCollectionSessionForTests();
  const a = resetCollectionSessionFor('A');
  a.listOpen = { id: 'list-a', name: "A's binder", kind: 'custom' };
  const b = resetCollectionSessionFor('B');
  assert.equal(b.listOpen, null, "profile B must not inherit A's open list");
  assert.equal(b.profileId, 'B');
});

test('the whole cache resets, not just the fields that look sensitive', () => {
  // Clearing only `listOpen` is how this bug survives a refactor: the next person to add a
  // profile-owned field has to remember, and will not.
  __resetCollectionSessionForTests();
  const a = resetCollectionSessionFor('A');
  Object.assign(a, {
    view: 'cards', setDrill: '002', q: 'dragon', groupBy: 'rarity',
    sheetCard: { card_id: 'x' }, sheetSet: '002', types: ['Minion'], rarities: ['Elite'], els: ['fire'],
  });
  const b = resetCollectionSessionFor('B');
  for (const [k, v] of Object.entries(FRESH_SESSION)) {
    if (k === 'profileId') continue;
    assert.deepEqual(b[k], v, `${k} survived a profile switch`);
  }
});

test('switching away and back does NOT restore the old state', () => {
  __resetCollectionSessionForTests();
  const a = resetCollectionSessionFor('A');
  a.listOpen = { id: 'list-a' };
  resetCollectionSessionFor('B');
  const backToA = resetCollectionSessionFor('A');
  assert.equal(backToA.listOpen, null, 'the cache is not a per-profile store, it is a single slot');
});

test('collectionSession() returns the reconciled object, not a stale copy', () => {
  __resetCollectionSessionForTests();
  resetCollectionSessionFor('A');
  collectionSession().view = 'lists';
  assert.equal(collectionSession().view, 'lists');
  resetCollectionSessionFor('B');
  assert.equal(collectionSession().view, 'overview', 'the live accessor must see the reset');
});

test('a null/undefined profile id is still a distinct owner', () => {
  __resetCollectionSessionForTests();
  const none = resetCollectionSessionFor(null);
  none.listOpen = { id: 'x' };
  assert.equal(resetCollectionSessionFor('A').listOpen, null);
});
