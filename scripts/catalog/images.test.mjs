// planImages (scripts/catalog/images.mjs) - content-addressed, per-finish (rev 4+).
// The contract FLIP from the old foil-collapse: a variant with its own manifest entry gets its OWN
// key; foils are no longer duplicates. A variant with no entry borrows a sibling finish; a printing
// with no entry is image=null. Run: npm run test:catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planImages } from './images.mjs';

const card = (name, slugs) => ({ [name]: { name, variants: slugs.map((s) => ({ slug: s, set: s.slice(0, 3), finish: /-f$/.test(s) ? 'Foil' : /-rf$/.test(s) ? 'Rainbow' : 'Standard' })) } });
const manifest = (slugToKey) => ({ objects: Object.fromEntries(Object.entries(slugToKey).map(([s, k]) => [s, { key: k }])) });
const vbyfin = (out, name, finish) => out[name].variants.find((v) => v.finish === finish);

test('per-finish: standard and foil each get their OWN content key (no collapse)', () => {
  const cards = card('City of Glass', ['006-city_of_glass-b-s', '006-city_of_glass-b-f']);
  const mf = manifest({ '006-city_of_glass-b-s': '006-city_of_glass-b-s.aaa.webp', '006-city_of_glass-b-f': '006-city_of_glass-b-f.bbb.webp' });
  const { cards: out, report } = planImages(cards, mf);
  assert.equal(vbyfin(out, 'City of Glass', 'Standard').image, '006-city_of_glass-b-s.aaa.webp');
  assert.equal(vbyfin(out, 'City of Glass', 'Foil').image, '006-city_of_glass-b-f.bbb.webp', 'foil is DISTINCT, not the standard');
  assert.equal(report.perFinish, 2);
  assert.equal(report.sharedSibling, 0);
});

test('a finish with no scan borrows the standard sibling of the same printing', () => {
  const cards = card('City of Glass', ['006-city_of_glass-b-s', '006-city_of_glass-b-f']);
  const mf = manifest({ '006-city_of_glass-b-s': '006-city_of_glass-b-s.aaa.webp' });   // foil absent
  const { cards: out, report } = planImages(cards, mf);
  assert.equal(vbyfin(out, 'City of Glass', 'Foil').image, '006-city_of_glass-b-s.aaa.webp', 'foil borrows the standard');
  assert.equal(report.perFinish, 1);
  assert.equal(report.sharedSibling, 1);
});

test('a foil-only printing keeps its foil scan as its art and the card default', () => {
  const cards = card('Promo', ['999-druid-scg-f']);
  const mf = manifest({ '999-druid-scg-f': '999-druid-scg-f.ccc.webp' });
  const { cards: out } = planImages(cards, mf);
  assert.equal(out['Promo'].variants[0].image, '999-druid-scg-f.ccc.webp');
  assert.equal(out['Promo'].image, '999-druid-scg-f.ccc.webp');
});

test('a printing with no scan is image=null and reported', () => {
  const cards = card('Nope', ['001-nope_card-b-s']);
  const { cards: out, report } = planImages(cards, manifest({}));
  assert.equal(out['Nope'].variants[0].image, null);
  assert.equal(out['Nope'].image, null);
  assert.deepEqual(report.noScan, ['Nope::001-nope_card-b']);
});

test('card default image is the lowest set rank, standard-preferred', () => {
  const cards = card('Multi', ['001-multi-b-s', '002-multi-b-s']);   // Alpha + Beta standard
  const mf = manifest({ '001-multi-b-s': 'alpha.aa.webp', '002-multi-b-s': 'beta.bb.webp' });
  const { cards: out } = planImages(cards, mf);
  assert.equal(out['Multi'].image, 'alpha.aa.webp', 'default follows lowest set rank');
});

test('a null/absent manifest yields image=null everywhere (dry-run before conversion)', () => {
  const cards = card('X', ['001-x-b-s', '001-x-b-f']);
  const { cards: out } = planImages(cards, null);
  for (const v of out['X'].variants) assert.equal(v.image, null);
  assert.equal(out['X'].image, null);
});
