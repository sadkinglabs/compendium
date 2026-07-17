import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planImages } from './images.mjs';

const card = (name, slugs) => ({ [name]: { name, variants: slugs.map((s) => ({ slug: s, set: s.slice(0, 3), finish: /-(f)$/.test(s) ? 'Foil' : /-(rf)$/.test(s) ? 'Rainbow' : 'Standard' })) } });

test('prefers the standard scan; a printing shares one webp across finishes', () => {
  const cards = card('City of Glass', ['006-city_of_glass-b-s', '006-city_of_glass-b-f']);
  const { cards: out, report } = planImages(cards, ['006-city_of_glass-b-s.png', '006-city_of_glass-b-f.png']);
  assert.equal(report.converted, 1);
  assert.equal(report.droppedFoilDupes, 1);   // the -f is a duplicate of the -s printing
  for (const v of out['City of Glass'].variants) assert.equal(v.image, '006-city_of_glass-b.webp');
});

test('a foil-only printing keeps its foil scan as its art', () => {
  const cards = card('Promo', ['999-city_of_glass-scg-f']);
  const { cards: out, report } = planImages(cards, ['999-city_of_glass-scg-f.png']);
  assert.equal(report.converted, 1);
  assert.equal(report.keptFoilOnly, 1);
  assert.equal(out['Promo'].variants[0].image, '999-city_of_glass-scg.webp');
});

test('reverse-face scans are never bundled', () => {
  const cards = card('Druid', ['004-druid-bt-s']);
  const { report } = planImages(cards, ['004-druid-bt-s.png', '004-druid-bt-s-r.png']);
  assert.equal(report.skippedReverse, 1);
  assert.equal(report.converted, 1);
});

test('a printing with no scan gets image=null and is reported', () => {
  const cards = card('Winter River', ['001-winter_river-bt-f']);
  const { cards: out, report } = planImages(cards, []); // no scans at all
  assert.equal(out['Winter River'].variants[0].image, null);
  assert.equal(report.noScan.length, 1);
});

test('drop scans matching no printing are reported as unmatched', () => {
  const cards = card('Known', ['001-known-b-s']);
  const { report } = planImages(cards, ['001-known-b-s.png', '999-ghost-b-s.png']);
  assert.deepEqual(report.unmatchedScans, ['999-ghost-b-s']);
});

test('card default image is the lowest-set standard printing', () => {
  const cards = card('Multi', ['999-multi-op-s', '001-multi-b-s']);
  const { cards: out } = planImages(cards, ['999-multi-op-s.png', '001-multi-b-s.png']);
  assert.equal(out['Multi'].image, '001-multi-b.webp');
});
