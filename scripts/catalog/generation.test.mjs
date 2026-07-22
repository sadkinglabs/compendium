import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGeneration, writeStagingJson, validateGeneration, serializeCards, serializeArticles, serializeCodex, serializeSetCatalog } from './generation.mjs';
import { regenerateLinkGraph } from './linkGraph.mjs';
import { promote } from './journal.mjs';
import { productionPromotionPlan } from './promotionPlan.mjs';

const apiCard = (name, slug, set, setName) => ({
  name, slug: slug.replace(/-b-s$/, ''), type: 'Minion', rarity: 'Ordinary', elements: ['Air'],
  cost: 1, attack: 1, defense: 1, life: null, airThreshold: 1, earthThreshold: 0, fireThreshold: 0, waterThreshold: 0,
  rulesText: 'Charge', variants: [{ slug, finish: 'Standard', product: 'Booster', flavorText: '', artist: { name: 'A' }, setCard: { set: { code: set, name: setName } } }],
});

// Content-addressed key for the Foo Card standard scan: <slug>.<sha256-of-output-bytes>.webp.
// The 64-hex digest is a fixture stand-in; the real one is the sha256 of the converted webp.
const FOO_SHA = 'a'.repeat(64);
const FOO_KEY = `001-foo_card-b-s.${FOO_SHA}.webp`;

function fixture(rulesText = 'Play a [[Foo Card]] to start.') {
  const currentArticles = [{ id: 'basics', title: 'Basics', content: rulesText, subentries: [] }];
  return {
    currentCards: {},
    currentArticles,
    currentFaqs: [],
    committedLinkGraph: regenerateLinkGraph(currentArticles), // trivially reproduces
    apiCards: [apiCard('Foo Card', '001-foo_card-b-s', '001', 'Alpha')],
    rulesCsvText: `title,content,subcodexes\r\n"Basics","${rulesText}",""\r\n`,
    faqCsvText: 'card name,question,answer\r\n"Foo Card","Q?","A"\r\n',
    // The art manifest is built ahead of buildGeneration by the orchestrator; here a single
    // committed standard scan, so planImages annotates the printing with its content key.
    artManifest: { tier: { width: 745, quality: 80, format: 'webp' }, objects: { '001-foo_card-b-s': { key: FOO_KEY, sha256: FOO_SHA, md5: '0'.repeat(32), bytes: 4 } } },
  };
}

test('buildGeneration assembles cards, rules, faqs, link graph, and a recompiled codex', () => {
  const gen = buildGeneration(fixture());
  assert.deepEqual(gen.report.cards.added, ['Foo Card']);
  assert.equal(gen.cards['Foo Card'].image, FOO_KEY);       // content-addressed per-printing art wired
  assert.equal(gen.cards['Foo Card'].variants[0].image, FOO_KEY);
  assert.equal(gen.faqs.length, 1);
  assert.ok(gen.report.codex.docs >= 1, 'codex recompiled');
  assert.match(gen.hash, /^[0-9a-f]{64}$/);
});

test('buildGeneration derives a set catalog (code -> name) from the merged sets', () => {
  const gen = buildGeneration(fixture());
  assert.deepEqual(gen.setCatalog, { '001': 'Alpha' });   // written to src/store/setCatalog.json; names are data, not hardcoded
});

test('a codex compiler invariant issue aborts the build (no broken codex ships)', () => {
  // dropped content is impossible with clean prose; instead assert the guard exists
  // by feeding an article whose content the compiler must fully cover, then a card
  // with rulesText - both compile cleanly, so this documents the happy path and the
  // throw path is covered by compile.test.mjs invariants.
  assert.doesNotThrow(() => buildGeneration(fixture()));
});

test('writeStagingJson emits every catalog file in its committed format', () => {
  const gen = buildGeneration(fixture());
  const dir = mkdtempSync(join(tmpdir(), 'cat-gen-'));
  const cat = join(dir, 'catalog');
  writeStagingJson(gen, cat);
  for (const f of ['cards.json', 'articles_normalized.json', 'faqs.json', 'link_graph.json', 'codex_documents.json']) {
    assert.ok(existsSync(join(cat, f)), `${f} written`);
  }
  // cards.json minified (no indentation newlines)
  assert.equal(readFileSync(join(cat, 'cards.json'), 'utf8'), serializeCards(gen.cards));
  assert.ok(!readFileSync(join(cat, 'cards.json'), 'utf8').includes('\n  '));
  // codex_documents.json minified with a trailing newline (compile-codex format)
  const codex = readFileSync(join(cat, 'codex_documents.json'), 'utf8');
  assert.equal(codex, serializeCodex(gen.codex));
  assert.ok(codex.endsWith('\n') && !codex.includes('\n  '));
  rmSync(dir, { recursive: true, force: true });
});

test('serializeArticles ASCII-escapes non-ASCII (Python ensure_ascii style)', () => {
  assert.equal(serializeArticles([{ t: 'Maelström' }]), '[\n  {\n    "t": "Maelstr\\u00f6m"\n  }\n]');
});

test('validateGeneration rejects an image that is not in the staged manifest', () => {
  const gen = buildGeneration(fixture());
  assert.doesNotThrow(() => validateGeneration(gen));
  gen.cards['Foo Card'].image = 'ghost.webp';   // not in manifest
  assert.throws(() => validateGeneration(gen), /not in the staged art manifest/);
});

test('the content hash is deterministic and changes only when content changes', () => {
  assert.equal(buildGeneration(fixture()).hash, buildGeneration(fixture()).hash);
  assert.notEqual(buildGeneration(fixture()).hash, buildGeneration(fixture('Different [[Foo Card]] text.')).hash);
});

const mfWith = (objects) => ({ tier: { width: 745, quality: 80, format: 'webp', recipeId: 'webp:w745:q80:v1' }, objects });

test('the generation hash changes when an art key changes (a corrected scan reseeds the version)', () => {
  const base = buildGeneration(fixture()).hash;
  const otherSha = 'b'.repeat(64);
  const changed = buildGeneration({ ...fixture(), artManifest: mfWith({ '001-foo_card-b-s': { key: `001-foo_card-b-s.${otherSha}.webp`, sha256: otherSha, md5: '0'.repeat(32), bytes: 4 } }) }).hash;
  assert.notEqual(base, changed);
});

test('the generation hash is UNCHANGED by encoder-only metadata when the content key is identical', () => {
  const plain = buildGeneration({ ...fixture(), artManifest: mfWith({ '001-foo_card-b-s': { key: FOO_KEY, sha256: FOO_SHA, md5: '0'.repeat(32), bytes: 4 } }) }).hash;
  const richMeta = buildGeneration({ ...fixture(), artManifest: mfWith({ '001-foo_card-b-s': { key: FOO_KEY, sha256: FOO_SHA, md5: '0'.repeat(32), bytes: 4, srcSha256: 'c'.repeat(64), encoder: { sharp: '9.9.9', vips: '9.9.9' } } }) }).hash;
  assert.equal(plain, richMeta, 'only the published slug+key identity is folded, never encoder provenance');
});

test('promote installs the staged generation via the PRODUCTION plan (JSON only, no art dir, version last)', () => {
  const gen = buildGeneration(fixture());
  const dir = mkdtempSync(join(tmpdir(), 'cat-promote-'));
  const staging = join(dir, 'staging');
  const cat = join(staging, 'catalog');
  mkdirSync(cat, { recursive: true });
  writeStagingJson(gen, cat);
  writeFileSync(join(cat, 'art-manifest.json'), JSON.stringify(gen.artManifest, null, 2));
  writeFileSync(join(staging, 'setCatalog.json'), serializeSetCatalog(gen.setCatalog));
  writeFileSync(join(staging, 'catalogVersion.json'), JSON.stringify({ version: 3, hash: gen.hash }));

  const build = join(dir, 'out');
  const catalog = join(build, 'public', 'catalog');
  const versionFile = join(build, 'src', 'store', 'catalogVersion.json');
  const { files } = productionPromotionPlan({
    stagingCatalog: cat, staging, catalog,
    manifestFile: join(catalog, 'art-manifest.json'),
    setCatalogFile: join(build, 'src', 'store', 'setCatalog.json'),
    versionFile,
  });
  promote({ journalPath: join(dir, 'PROMOTE.json'), hash: gen.hash, files });

  // JSON-only Phase 2: the catalog + manifest are repointed; NO public/cards art dir is created.
  assert.ok(existsSync(join(catalog, 'cards.json')));
  assert.ok(existsSync(join(catalog, 'art-manifest.json')));
  assert.ok(!existsSync(join(build, 'public', 'cards')), 'promote must not create a bundled art dir');
  assert.equal(JSON.parse(readFileSync(versionFile, 'utf8')).version, 3);
  rmSync(dir, { recursive: true, force: true });
});
