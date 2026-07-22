// The content-addressed art manifest engine (scripts/catalog/artManifest.mjs).
// Real hashing (node:crypto), faked conversion/source-hash/bundle so the skip predicate and the
// fresh-convert contract are provable without sharp or disk. Run: npm run test:catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildArtManifest, normalizeTransitional, assertManifestShape, RECIPE_ID, artKey } from './artManifest.mjs';

// Fake deps. convertFresh returns bytes derived from a per-path "content" token, so a changed source
// yields different output bytes (and thus a different digest/key). Every convert is recorded.
function deps({ srcHashes = {}, contents = {}, bundled = new Set() } = {}) {
  const converted = [];
  return {
    converted,
    hashFile: (p) => srcHashes[p] ?? `srch-${p}`,
    convertFresh: (p) => { converted.push(p); return Buffer.from(contents[p] ?? `webp-bytes-for-${p}`); },
    hashBytes: (buf) => ({ sha256: createHash('sha256').update(buf).digest('hex'), md5: createHash('md5').update(buf).digest('base64') }),
    bundledExists: (name) => bundled.has(name),
    encoder: { sharp: '0.32.6', vips: '8.14.5' },
  };
}
const slugs = (obj) => new Map(Object.entries(obj));

test('a fresh slug converts and gets a content-addressed key', () => {
  const d = deps();
  const { manifest, report } = buildArtManifest(null, slugs({ '001-abundance-b-s': 'p1.png' }), d);
  const e = manifest.objects['001-abundance-b-s'];
  assert.equal(d.converted.length, 1, 'converted once');
  assert.match(e.key, /^001-abundance-b-s\.[0-9a-f]{64}\.webp$/);
  assert.equal(e.recipeId, RECIPE_ID);
  assert.equal(e.srcSha256, 'srch-p1.png');
  assert.ok(e.md5 && e.bytes > 0);
  assert.deepEqual(e.encoder, { sharp: '0.32.6', vips: '8.14.5' });
  assert.equal(report.fresh, 1);
});

test('an unchanged source + recipe is KEPT without converting', () => {
  const first = buildArtManifest(null, slugs({ s: 'p.png' }), deps()).manifest;
  const d = deps();
  const { report } = buildArtManifest(first, slugs({ s: 'p.png' }), d);
  assert.equal(d.converted.length, 0, 'no reconversion on a predicate match');
  assert.equal(report.kept, 1);
});

test('BLOCKER: a CHANGED source always converts fresh and moves the key (never existence-skips)', () => {
  const first = buildArtManifest(null, slugs({ s: 'p.png' }), deps({ srcHashes: { 'p.png': 'A' }, contents: { 'p.png': 'old-bytes' } })).manifest;
  const oldKey = first.objects.s.key;
  // Same slug + same staging path, but the SOURCE changed (new srcHash + new content).
  const d = deps({ srcHashes: { 'p.png': 'B' }, contents: { 'p.png': 'corrected-bytes' } });
  const { manifest } = buildArtManifest(first, slugs({ s: 'p.png' }), d);
  assert.equal(d.converted.length, 1, 'a changed source MUST run the production converter');
  assert.notEqual(manifest.objects.s.key, oldKey, 'the output key moved');
  assert.equal(manifest.objects.s.srcSha256, 'B');
});

test('a RECIPE change reconverts even when the source is unchanged', () => {
  const first = buildArtManifest(null, slugs({ s: 'p.png' }), deps()).manifest;
  first.objects.s.recipeId = 'webp:w380:q78:v0';   // a prior entry made by a different recipe
  const d = deps();
  buildArtManifest(first, slugs({ s: 'p.png' }), d);
  assert.equal(d.converted.length, 1, 'recipe mismatch forces reconversion');
});

test('--reconvert forces a fresh convert on a full predicate match', () => {
  const first = buildArtManifest(null, slugs({ s: 'p.png' }), deps()).manifest;
  const d = deps();
  buildArtManifest(first, slugs({ s: 'p.png' }), d, { reconvert: true });
  assert.equal(d.converted.length, 1);
});

test('an incremental drop carries a committed entry with no source PNG present', () => {
  const first = buildArtManifest(null, slugs({ a: 'a.png', b: 'b.png' }), deps()).manifest;
  const d = deps();
  const { manifest, report } = buildArtManifest(first, slugs({ a: 'a.png' }), d);   // b absent this drop
  assert.equal(d.converted.length, 0, 'a unchanged, b carried - nothing converts');
  assert.equal(manifest.objects.b.key, first.objects.b.key, 'b keeps its key');
  assert.equal(report.carried, 1);
});

test('normalizeTransitional / Phase 5: legacyKey present when bundled, stripped when not', () => {
  const bundled = new Set(['001-abundance-b.webp']);
  const withBundle = buildArtManifest(null, slugs({ '001-abundance-b-s': 'p.png' }), deps({ bundled })).manifest;
  assert.equal(withBundle.objects['001-abundance-b-s'].legacyKey, '001-abundance-b.webp', 'legacyKey while bundled');
  // Phase 5: rebuild with an EMPTY bundled dir - every retained entry loses legacyKey.
  const phase5 = buildArtManifest(withBundle, slugs({ '001-abundance-b-s': 'p.png' }), deps({ bundled: new Set() })).manifest;
  assert.ok(!('legacyKey' in phase5.objects['001-abundance-b-s']), 'legacyKey stripped with no bundled dir');
});

test('normalizeTransitional strips transitional fields from a stale entry directly', () => {
  const e = { key: 'x', sha256: 'y', legacyKey: 'old.webp' };
  assert.ok(!('legacyKey' in normalizeTransitional('s', e, () => false)));
});

test('assertManifestShape accepts valid + repair keys, rejects a digest mismatch', () => {
  const good = createHash('sha256').update('x').digest('hex');
  assert.doesNotThrow(() => assertManifestShape({ objects: { s: { key: artKey('s', good), sha256: good } } }));
  assert.doesNotThrow(() => assertManifestShape({ objects: { s: { key: `s.${good}.repair-1.webp`, sha256: good } } }));
  assert.throws(() => assertManifestShape({ objects: { s: { key: 's.deadbeef.webp', sha256: good } } }), /malformed key/);
  const other = createHash('sha256').update('z').digest('hex');
  assert.throws(() => assertManifestShape({ objects: { s: { key: artKey('s', other), sha256: good } } }), /key digest/);
});

test('objects are sorted by slug for a stable, diffable manifest', () => {
  const { manifest } = buildArtManifest(null, slugs({ z: 'z.png', a: 'a.png', m: 'm.png' }), deps());
  assert.deepEqual(Object.keys(manifest.objects), ['a', 'm', 'z']);
});
