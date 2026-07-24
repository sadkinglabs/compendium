// Pure tests for the alphabet-rail model. Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAIL_ORDER, letterOf, railModel, firstPresent, lastPresent, stepLetter, activeLetterFor,
} from './alphabetIndex.js';

const card = (id, name) => ({ card_id: id, name });
const row = (id, name, set = 'ALP') => ({ card: card(id, name), set });
// The grid's name-asc collation (collectionFilter.js rowComparator): locale 'en', base sensitivity.
const byGrid = (a, b) => String(a).localeCompare(String(b), 'en', { sensitivity: 'base' });

test('letterOf: folds diacritics, buckets digits/symbols/empty to #, is case-insensitive', () => {
  assert.equal(letterOf('Abundance'), 'A');
  assert.equal(letterOf('abundance'), 'A');
  assert.equal(letterOf('Älvalinne Dryads'), 'A');   // NFD fold -> A (matches locale base collation)
  assert.equal(letterOf('Étude'), 'E');
  assert.equal(letterOf('13 Treasures of Britain'), '#');
  assert.equal(letterOf("'Twas"), '#');
  assert.equal(letterOf('  Zephyr'), 'Z');
  assert.equal(letterOf(''), '#');
  assert.equal(letterOf('   '), '#');
  assert.equal(letterOf(null), '#');
  assert.equal(letterOf(undefined), '#');
});

test('railModel: present set, first-index in render order, # bucketing, indexable on clean A-Z', () => {
  const rows = [row('a', 'Abundance'), row('b', 'Ancestor'), row('c', 'Bake'), row('d', 'Cadence')];
  const m = railModel(rows);
  assert.equal(m.order, RAIL_ORDER);
  assert.deepEqual([...m.present].sort(), ['A', 'B', 'C']);
  assert.equal(m.firstIndex.get('A'), 0);
  assert.equal(m.firstIndex.get('B'), 2);
  assert.equal(m.firstIndex.get('C'), 3);
  assert.equal(m.indexable, true);
});

test('railModel: a name that buckets to # but sorts among the As makes it NON-indexable (fail closed)', () => {
  // 'Aardvark', 'Æmber'(->#), 'Alpha' - the locale would sort these A, ~A, A but the ASCII bucket ranks
  // are A(1), #(0), A(1): the rank drops, so indexable must be false and the caller ducks.
  const rows = [row('a', 'Aardvark'), row('x', 'Æmber'), row('z', 'Alpha')];
  const m = railModel(rows);
  assert.equal(letterOf('Æmber'), '#', 'ligature does not decompose -> #');
  assert.equal(m.indexable, false);
});

test('railModel: leading # bucket (digit name) at rank 0 stays indexable', () => {
  const rows = [row('t', '13 Treasures'), row('a', 'Abundance'), row('z', 'Zephyr')];
  const m = railModel(rows);
  assert.equal(m.firstIndex.get('#'), 0);
  assert.equal(m.indexable, true);
});

test('railModel: empty result is indexable with an empty present set and a stable key', () => {
  const m = railModel([]);
  assert.equal(m.present.size, 0);
  assert.equal(m.indexable, true);
  assert.equal(m.modelKey, railModel([]).modelKey);
});

test('modelKey: equal for an equivalent re-allocation, different on membership OR order change', () => {
  const base = [row('a', 'Abundance'), row('b', 'Bake'), row('c', 'Cadence')];
  const same = [row('a', 'Abundance'), row('b', 'Bake'), row('c', 'Cadence')];   // fresh objects, same ids/order
  assert.equal(railModel(base).modelKey, railModel(same).modelKey, 'equivalent re-alloc -> same key (no cancel)');
  const dropped = [row('a', 'Abundance'), row('c', 'Cadence')];                  // membership change
  assert.notEqual(railModel(base).modelKey, railModel(dropped).modelKey, 'membership change -> different key');
  const reordered = [row('b', 'Bake'), row('a', 'Abundance'), row('c', 'Cadence')];  // order change, same set
  assert.notEqual(railModel(base).modelKey, railModel(reordered).modelKey, 'order change -> different key');
  // A different set on the same card is a different collector item -> different key.
  const otherSet = [row('a', 'Abundance', 'BET'), row('b', 'Bake'), row('c', 'Cadence')];
  assert.notEqual(railModel(base).modelKey, railModel(otherSet).modelKey);
});

test('firstPresent / lastPresent / stepLetter skip absent (inert) slots', () => {
  const present = new Set(['A', 'C', 'M']);
  assert.equal(firstPresent(present), 'A');
  assert.equal(lastPresent(present), 'M');
  assert.equal(stepLetter(present, 'A', 1), 'C', 'skips B');
  assert.equal(stepLetter(present, 'C', -1), 'A');
  assert.equal(stepLetter(present, 'M', 1), 'M', 'no present letter past M -> stays (edge)');
  assert.equal(stepLetter(present, 'A', -1), 'A', 'no present before A -> stays');
  assert.equal(firstPresent(new Set()), null);
});

test('activeLetterFor: the LAST anchor to cross the header boundary, first-present as top fallback', () => {
  const present = new Set(['A', 'B', 'C']);
  const anchors = [{ letter: 'A', top: -40 }, { letter: 'B', top: 120 }, { letter: 'C', top: 380 }];
  const T = 80;                                        // header threshold
  // Before any anchor crosses (all tops > threshold) -> top-of-list fallback.
  assert.equal(activeLetterFor([{ letter: 'A', top: 200 }, { letter: 'B', top: 500 }], T, present), 'A');
  // Midway through A: A crossed (-40 <= 80), B has not (120 > 80) -> stays 'A', never jumps early to 'B'.
  assert.equal(activeLetterFor(anchors, T, present), 'A');
  // Exactly at the next boundary: B.top === threshold -> B is now active.
  assert.equal(activeLetterFor([{ letter: 'A', top: -300 }, { letter: 'B', top: 80 }, { letter: 'C', top: 400 }], T, present), 'B');
  // Bottom of the list: every anchor has crossed -> the last one.
  assert.equal(activeLetterFor([{ letter: 'A', top: -900 }, { letter: 'B', top: -500 }, { letter: 'C', top: -100 }], T, present), 'C');
});

test('real-catalog corpus contract: the shipped catalogue is indexable under name-asc', () => {
  const url = new URL('../../public/catalog/cards.json', import.meta.url);
  const cards = Object.values(JSON.parse(readFileSync(url, 'utf8')));
  // Reproduce the grid's arranged order: sort names by the same collation, one row per card.
  const rows = cards
    .map((c, i) => ({ card: { card_id: `c${i}`, name: c.name }, set: 'ALP' }))
    .sort((a, b) => byGrid(a.card.name, b.card.name));
  const m = railModel(rows);
  assert.equal(m.indexable, true, 'the real catalogue must not trip the fail-closed guard');
  assert.ok(m.present.has('A') && m.present.has('Z'), 'A..Z represented');
  // '13 Treasures of Britain' sorts first and buckets to '#'.
  assert.equal(m.firstIndex.get('#'), 0);
});
