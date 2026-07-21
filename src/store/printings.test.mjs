// Printing identity. The cases that matter are the ones where the empty-string sentinel is
// indistinguishable from "absent" unless you are careful - that falsiness has caused real
// bugs here, and naming the value does not remove it.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNCATEGORISED, ANY_PRINTING, LEGACY_FOIL_PRINTING, UNCATEGORISED_LABEL,
  isUncategorised, isFoilPrinting, normalizePrinting, setCodeOf, soleSetName,
} from './printings.js';

test('the uncategorised bucket is recognised', () => {
  assert.equal(isUncategorised(UNCATEGORISED), true);
  assert.equal(isUncategorised(''), true);
});

test('a real set code is NOT uncategorised', () => {
  assert.equal(isUncategorised('001'), false);
  assert.equal(isUncategorised('001:f'), false);
});

test('null and undefined read as uncategorised - the one place falsiness is intended', () => {
  assert.equal(isUncategorised(null), true);
  assert.equal(isUncategorised(undefined), true);
});

test('the sentinel is STILL falsy, and that is the trap this module documents', () => {
  // Named, not fixed. `if (slug)` remains wrong for a card you genuinely own, which is why
  // callers must use isUncategorised() rather than testing the value.
  assert.equal(Boolean(UNCATEGORISED), false);
  assert.ok(UNCATEGORISED != null, 'but it is NOT null - `!= null` is the safe check');
});

test('foil printings are recognised, including the legacy card-level row', () => {
  assert.equal(isFoilPrinting('001:f'), true);
  assert.equal(isFoilPrinting('foil'), true, 'the legacy card-level foil row');
  assert.equal(isFoilPrinting('001'), false);
  assert.equal(isFoilPrinting(''), false, 'uncategorised is not foil');
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

test("a set code is never the literal 'uncategorised'", () => {
  // Guards the v11 option: if a real printing could be spelled 'uncategorised', that value
  // would be unusable as the sentinel later.
  assert.equal(isUncategorised('uncategorised'), false);
});

/* ---------------- what each sentinel MEANS (Phase B) ---------------- */

test('ANY_PRINTING and UNCATEGORISED are equal today, and that is the hazard', () => {
  // Same character, two unrelated meanings, in different tables:
  //   owned_cards      -> UNCATEGORISED: the set is not established YET; triage resolves it.
  //   deck/list entries -> ANY_PRINTING: any collector item satisfies this; nothing to resolve.
  // They are kept as separate constants precisely BECAUSE this assertion passes - equality is
  // a fact about today's storage, not a licence to use one where the other is meant.
  assert.equal(ANY_PRINTING, UNCATEGORISED, 'both are the empty string in v10 storage');
});

test('the legacy card-level foil row is named, and is not the uncategorised bucket', () => {
  // Pre-v11, foil copies with no set recorded live on a 'foil' row rather than ''. The
  // migration reads it; nothing else should spell it as a literal.
  assert.equal(LEGACY_FOIL_PRINTING, 'foil');
  assert.equal(isFoilPrinting(LEGACY_FOIL_PRINTING), true);
  assert.equal(isUncategorised(LEGACY_FOIL_PRINTING), false, 'a foil row is not the "" bucket');
});

test('the uncategorised label is a value the filter matches, not just display text', () => {
  // SET_LABEL[''] and the collectionGroups set filter both use this string. They were two
  // separate literals; changing the wording in one silently broke filtering in the other.
  assert.equal(UNCATEGORISED_LABEL, 'Uncategorised');
  assert.ok(!/^\d+$/.test(UNCATEGORISED_LABEL), 'must never collide with a numeric set code');
});

/* ---------------- the list-row set pill ---------------- */

test('a single-printing card shows its set', () => {
  assert.equal(soleSetName(JSON.stringify([{ code: '004', name: 'Arthurian Legends' }])), 'Arthurian Legends');
});

test('a REPRINT shows nothing rather than guessing', () => {
  // The real case: Albespine Pikemen is Alpha+Beta, and the wishlist rendered "ALPHA" purely
  // because Alpha sorts first - while the copies actually owned were Beta.
  const albespine = JSON.stringify([{ code: '001', name: 'Alpha' }, { code: '002', name: 'Beta' }]);
  assert.equal(soleSetName(albespine), null);
});

test('no printings, malformed or missing data all show nothing', () => {
  assert.equal(soleSetName('[]'), null);
  assert.equal(soleSetName('{not json'), null);
  assert.equal(soleSetName(undefined), null);
  assert.equal(soleSetName(null), null);
});
