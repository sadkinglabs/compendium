// Printing identity. The cases that matter are the ones where the empty-string sentinel is
// indistinguishable from "absent" unless you are careful - that falsiness has caused real
// bugs here, and naming the value does not remove it.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNSPECIFIED_PRINTING, isUnspecified, isFoilPrinting, normalizePrinting, setCodeOf,
} from './printings.js';

test('the unspecified bucket is recognised', () => {
  assert.equal(isUnspecified(UNSPECIFIED_PRINTING), true);
  assert.equal(isUnspecified(''), true);
});

test('a real set code is NOT unspecified', () => {
  assert.equal(isUnspecified('001'), false);
  assert.equal(isUnspecified('001:f'), false);
});

test('null and undefined read as unspecified - the one place falsiness is intended', () => {
  assert.equal(isUnspecified(null), true);
  assert.equal(isUnspecified(undefined), true);
});

test('the sentinel is STILL falsy, and that is the trap this module documents', () => {
  // Named, not fixed. `if (slug)` remains wrong for a card you genuinely own, which is why
  // callers must use isUnspecified() rather than testing the value.
  assert.equal(Boolean(UNSPECIFIED_PRINTING), false);
  assert.ok(UNSPECIFIED_PRINTING != null, 'but it is NOT null - `!= null` is the safe check');
});

test('foil printings are recognised, including the legacy card-level row', () => {
  assert.equal(isFoilPrinting('001:f'), true);
  assert.equal(isFoilPrinting('foil'), true, 'the legacy card-level foil row');
  assert.equal(isFoilPrinting('001'), false);
  assert.equal(isFoilPrinting(''), false, 'unspecified is not foil');
});

test('setCodeOf strips the foil suffix', () => {
  assert.equal(setCodeOf('001:f'), '001');
  assert.equal(setCodeOf('001'), '001');
  assert.equal(setCodeOf(''), '');
  assert.equal(setCodeOf(null), '');
});

test('normalizePrinting always returns a string', () => {
  for (const v of [null, undefined, '', '001', 2]) {
    assert.equal(typeof normalizePrinting(v), 'string', String(v));
  }
});

test("a set code is never the literal 'unspecified'", () => {
  // Guards the v11 option: if a real printing could be spelled 'unspecified', that value
  // would be unusable as the sentinel later.
  assert.equal(isUnspecified('unspecified'), false);
});
