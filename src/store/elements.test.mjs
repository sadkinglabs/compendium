// Element bucketing, and specifically the shape-tolerance that a device crash forced.
//
// `cards.elements` is a JSON STRING in the database. Deck entries arrive parsed, catalog-cache
// rows carry `_els`, raw pool rows carry the string. elemKey assumed an array and called
// .filter on it, so grouping the Collection set drill by element threw and blanked the screen.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elemKey, readElements, EL_ORDER } from './elements.js';

test('a parsed array works (deck entries)', () => {
  assert.equal(elemKey({ elements: ['Fire'] }), 'Fire');
});

test('a JSON STRING works (raw catalog / pool rows) - the crash', () => {
  // Regression: this threw "elements.filter is not a function" on device.
  assert.equal(elemKey({ elements: '["Fire"]' }), 'Fire');
  assert.equal(elemKey({ elements: '["Fire","Water"]' }), 'Multi');
});

test('the catalog cache pre-parsed field wins when present', () => {
  assert.equal(elemKey({ _els: ['Water'], elements: '["Fire"]' }), 'Water');
});

test('no elements buckets to Neutral', () => {
  assert.equal(elemKey({ elements: [] }), 'Neutral');
  assert.equal(elemKey({ elements: '[]' }), 'Neutral');
  assert.equal(elemKey({}), 'Neutral');
  assert.equal(elemKey({ elements: null }), 'Neutral');
});

test('more than one element buckets to Multi', () => {
  assert.equal(elemKey({ elements: ['Air', 'Earth'] }), 'Multi');
});

test('the literal "none" is not an element', () => {
  assert.equal(elemKey({ elements: ['none'] }), 'Neutral');
  assert.equal(elemKey({ elements: '["None","Fire"]' }), 'Fire');
});

test('malformed JSON degrades to Neutral rather than throwing', () => {
  // A card that cannot be bucketed must not take the whole grid down with it.
  assert.doesNotThrow(() => elemKey({ elements: '{not json' }));
  assert.equal(elemKey({ elements: '{not json' }), 'Neutral');
  assert.equal(elemKey({ elements: '"a string"' }), 'Neutral');
  assert.equal(elemKey({ elements: 42 }), 'Neutral');
});

test('readElements never returns a non-array', () => {
  for (const input of [undefined, null, 42, '{bad', '"str"', {}, { elements: 7 }]) {
    assert.ok(Array.isArray(readElements(input && input.elements !== undefined ? input : { elements: input })));
  }
});

test('every bucket elemKey can produce is present in EL_ORDER', () => {
  // Otherwise a bucket would sort into the "unknown" tail and render after the real sections.
  const produced = new Set([
    elemKey({ elements: ['Air'] }), elemKey({ elements: ['Earth'] }),
    elemKey({ elements: ['Fire'] }), elemKey({ elements: ['Water'] }),
    elemKey({ elements: ['Air', 'Fire'] }), elemKey({ elements: [] }),
  ]);
  for (const k of produced) assert.ok(EL_ORDER.includes(k), `${k} missing from EL_ORDER`);
});
