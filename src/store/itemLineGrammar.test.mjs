// The collector-item line grammar (src/store/itemLineGrammar.js) - format + parse, one module.
//
// Increment 4 pins the well-formed grammar and the format<->parse round-trip. The exhaustive
// malformed-input enumeration (the resolver's job) is exercised in increment 5 alongside the
// wishlist resolver; the defined behaviour for the common malformed cases is still asserted here so
// the module's contract is anchored where it lives.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnnotations, parseItemLine, formatItemLine, FOIL_TOKEN, MAX_ANNOTATION_LEN } from './itemLineGrammar.js';

/* ---------------- parseAnnotations ---------------- */

test('a bare name has no annotations', () => {
  assert.deepEqual(parseAnnotations('Wild Boars'), { name: 'Wild Boars', setToken: null, foil: false, problems: [] });
});

test('a set annotation is peeled off the name', () => {
  assert.deepEqual(parseAnnotations('Albespine Pikemen [Beta]'),
    { name: 'Albespine Pikemen', setToken: 'Beta', foil: false, problems: [] });
});

test('[Foil] sets foil and is case-insensitive', () => {
  assert.deepEqual(parseAnnotations('Winter River [foil]'), { name: 'Winter River', setToken: null, foil: true, problems: [] });
  assert.deepEqual(parseAnnotations('Winter River [FOIL]'), { name: 'Winter River', setToken: null, foil: true, problems: [] });
});

test('set and finish annotations parse in either order', () => {
  const a = parseAnnotations('Druid [Promotional] [Foil]');
  const b = parseAnnotations('Druid [Foil] [Promotional]');
  assert.deepEqual(a, { name: 'Druid', setToken: 'Promotional', foil: true, problems: [] });
  assert.deepEqual(b, { name: 'Druid', setToken: 'Promotional', foil: true, problems: [] });
});

test('a numeric set code is a valid set token', () => {
  assert.deepEqual(parseAnnotations('Sorcerer [999] [Foil]'), { name: 'Sorcerer', setToken: '999', foil: true, problems: [] });
});

test('empty brackets are part of the name, not an annotation (no crash)', () => {
  assert.deepEqual(parseAnnotations('Weird [] Name'), { name: 'Weird [] Name', setToken: null, foil: false, problems: [] });
});

test('an unmatched open bracket stays in the name', () => {
  assert.deepEqual(parseAnnotations('Card [Beta'), { name: 'Card [Beta', setToken: null, foil: false, problems: [] });
});

test('a duplicate [Foil] is flagged, not silently ignored', () => {
  const r = parseAnnotations('Card [Foil] [Foil]');
  assert.equal(r.foil, true);
  assert.deepEqual(r.problems, ['duplicate finish']);
});

test('two set annotations are flagged', () => {
  const r = parseAnnotations('Card [Alpha] [Beta]');
  assert.deepEqual(r.problems, ['two sets named']);
});

test('an over-long annotation is flagged, not treated as a set', () => {
  const long = 'x'.repeat(MAX_ANNOTATION_LEN + 1);
  const r = parseAnnotations(`Card [${long}]`);
  assert.equal(r.setToken, null, 'not accepted as a set name');
  assert.deepEqual(r.problems, ['annotation too long']);
});

test('parseAnnotations tolerates null/undefined', () => {
  assert.deepEqual(parseAnnotations(null), { name: '', setToken: null, foil: false, problems: [] });
});

/* ---------------- parseItemLine ---------------- */

test('a full line parses qty, name, and annotations', () => {
  assert.deepEqual(parseItemLine('2 Albespine Pikemen [Beta] [Foil]'),
    { qty: 2, name: 'Albespine Pikemen', setToken: 'Beta', foil: true, problems: [] });
});

test('a missing quantity defaults to 1', () => {
  assert.deepEqual(parseItemLine('Wild Boars'), { qty: 1, name: 'Wild Boars', setToken: null, foil: false, problems: [] });
});

test('a list bullet and x multiplier are accepted', () => {
  assert.deepEqual(parseItemLine('- 3x Wild Boars'), { qty: 3, name: 'Wild Boars', setToken: null, foil: false, problems: [] });
});

test('a quantity out of range is flagged, never clamped', () => {
  assert.deepEqual(parseItemLine('0 Wild Boars').problems, ['quantity out of range']);
  assert.deepEqual(parseItemLine('1000 Wild Boars').problems, ['quantity out of range']);
  assert.equal(parseItemLine('1000 Wild Boars').qty, 1000, 'returned as typed, not clamped');
});

/* ---------------- formatItemLine + round trip ---------------- */

test('format emits set then finish', () => {
  assert.equal(formatItemLine({ qty: 2, name: 'Druid', set: 'Promotional', foil: true }), '2 Druid [Promotional] [Foil]');
  assert.equal(formatItemLine({ qty: 3, name: 'Albespine Pikemen', set: 'Beta', foil: false }), '3 Albespine Pikemen [Beta]');
});

test('a bare (uncategorised) item formats without annotations', () => {
  assert.equal(formatItemLine({ qty: 4, name: 'Wild Boars', set: '', foil: false }), '4 Wild Boars');
});

test('format uses the canonical finish token', () => {
  assert.ok(formatItemLine({ qty: 1, name: 'x', set: '', foil: true }).includes(`[${FOIL_TOKEN}]`));
});

test('ROUND TRIP: format then parse reproduces (qty, name, set label, foil)', () => {
  for (const item of [
    { qty: 2, name: 'Druid', set: 'Promotional', foil: true },
    { qty: 3, name: 'Albespine Pikemen', set: 'Beta', foil: false },
    { qty: 1, name: 'Winter River', set: 'Alpha', foil: true },
    { qty: 4, name: 'Wild Boars', set: '', foil: false },
  ]) {
    const parsed = parseItemLine(formatItemLine(item));
    assert.equal(parsed.qty, item.qty, item.name);
    assert.equal(parsed.name, item.name, item.name);
    assert.equal(parsed.setToken, item.set || null, item.name);
    assert.equal(parsed.foil, item.foil, item.name);
    assert.deepEqual(parsed.problems, [], `${item.name} round-trips clean`);
  }
});
