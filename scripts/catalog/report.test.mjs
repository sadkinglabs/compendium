// formatReport (scripts/catalog/report.mjs) vs a REAL buildGeneration report. The dry run broke in
// the field because report.mjs still read the old image-report shape (converted/droppedFoilDupes)
// while planImages now returns perFinish/sharedSibling/noScan. This test wires an actual
// buildGeneration report through formatReport so the two shapes can never silently drift again.
// Run: npm run test:catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneration } from './generation.mjs';
import { regenerateLinkGraph } from './linkGraph.mjs';
import { formatReport } from './report.mjs';

const FOO_SHA = 'a'.repeat(64);
const FOO_KEY = `001-foo_card-b-s.${FOO_SHA}.webp`;
const apiCard = {
  name: 'Foo Card', slug: '001-foo_card', type: 'Minion', rarity: 'Ordinary', elements: ['Air'],
  cost: 1, attack: 1, defense: 1, life: null, airThreshold: 1, earthThreshold: 0, fireThreshold: 0, waterThreshold: 0,
  rulesText: 'Charge', variants: [{ slug: '001-foo_card-b-s', finish: 'Standard', product: 'Booster', flavorText: '', artist: { name: 'A' }, setCard: { set: { code: '001', name: 'Alpha' } } }],
};
const articles = [{ id: 'basics', title: 'Basics', content: 'Play a [[Foo Card]].', subentries: [] }];

// Assemble the report exactly as update-catalog.mjs does: a real generation + the combined images block.
function realReport() {
  const artManifest = {
    tier: { width: 745, quality: 80, format: 'webp', recipeId: 'webp:w745:q80:v1' },
    objects: { '001-foo_card-b-s': { key: FOO_KEY, sha256: FOO_SHA, md5: '0'.repeat(32), bytes: 4 } },
  };
  const gen = buildGeneration({
    currentCards: {}, currentArticles: articles, currentFaqs: [], committedLinkGraph: regenerateLinkGraph(articles),
    apiCards: [apiCard], rulesCsvText: 'title,content,subcodexes\r\n"Basics","Play a [[Foo Card]].",""\r\n',
    faqCsvText: 'card name,question,answer\r\n"Foo Card","Q?","A"\r\n', artManifest,
  });
  const referenced = new Set();
  for (const c of Object.values(gen.cards)) for (const v of (c.variants || [])) if (artManifest.objects[v.slug]) referenced.add(v.slug);
  const images = {
    total: 1, fresh: 1, kept: 0, carried: 0,
    perFinish: gen.report.images.perFinish, sharedSibling: gen.report.images.sharedSibling, noScan: gen.report.images.noScan,
    reverseExcluded: 0, unmatchedScans: Object.keys(artManifest.objects).filter((s) => !referenced.has(s)),
  };
  return { ...gen.report, images, staging: { stageDir: 'CATALOG_DROP/cdn-art', manifestPath: '.catalog-build/art-manifest.json', count: 1 }, ok: true, warnings: [] };
}

test('formatReport renders a real buildGeneration report (the shapes must agree)', () => {
  const out = formatReport(realReport(), { dryRun: false, dormant: true });
  assert.match(out, /Images:\s+1 art objects\s+\(1 converted, 0 kept, 0 carried\)/);
  assert.match(out, /1 per-finish/);
  assert.match(out, /Staged:\s+1 content-tier webp/);
  assert.match(out, /RESULT: OK \(dormant\)/);
});

test('formatReport never prints "undefined" (the old retired-field drift signature)', () => {
  for (const opts of [{}, { dryRun: true }, { dormant: true }]) {
    assert.doesNotMatch(formatReport(realReport(), opts), /undefined/);
  }
});
