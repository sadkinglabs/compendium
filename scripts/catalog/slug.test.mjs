import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { cardSlug, articleSlug, subSlug } from './slug.mjs';

const CATALOG = fileURLToPath(new URL('../../public/catalog/', import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(CATALOG, f), 'utf8'));

test('cardSlug matches the runtime scheme', () => {
  assert.equal(cardSlug("Vivien the Enchantress"), 'vivien_the_enchantress');
  assert.equal(cardSlug("Philosopher's Stone"), 'philosophers_stone');
  assert.equal(cardSlug('City of Glass'), 'city_of_glass');
});

test('cardSlug is byte-identical to the extracted runtime module', async () => {
  const runtime = (await import('../../src/store/cardSlug.js')).cardSlug;
  for (const n of ['Foot Soldier', 'Mobbed Court', "Angel's Egg", 'The Colour Out of Space']) {
    assert.equal(cardSlug(n), runtime(n));
  }
});

test('articleSlug non-collapsing dashes; strips punctuation and trims dashes', () => {
  assert.equal(articleSlug('Ordering Ongoing Effects - The Layer System'), 'ordering-ongoing-effects---the-layer-system');
  assert.equal(articleSlug("When exactly is 'after'?"), 'when-exactly-is-after');
});

test('reproduces every committed article and sub-entry id', () => {
  const arts = read('articles_normalized.json');
  for (const a of arts) {
    assert.equal(articleSlug(a.title), a.id, `article ${JSON.stringify(a.title)}`);
    for (const s of a.subentries || []) {
      assert.equal(subSlug(a.id, s.label), s.id, `subentry ${JSON.stringify(s.label)}`);
    }
  }
});
