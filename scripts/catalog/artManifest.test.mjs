// The content-addressed art manifest engine (scripts/catalog/artManifest.mjs).
// Real hashing (node:crypto), faked/ASYNC conversion so the skip predicate and the fresh-convert
// contract are provable without sharp or disk. Run: npm run test:catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildArtManifest, normalizeTransitional, assertManifest, contentMd5, RECIPE_ID, TIER, artKey,
} from './artManifest.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');   // 64 hex
const md5 = (s) => createHash('md5').update(s).digest('hex');      // 32 hex

// Fake deps. hashFile/convertFresh/hashBytes are ASYNC (return promises), matching sharp's real API.
// convertFresh returns bytes derived from a per-path token, so a changed source yields new bytes
// (and a new digest/key). Every convert is recorded.
function deps({ srcHashes = {}, contents = {}, bundled = new Set(), slow = false } = {}) {
  const converted = [];
  const tick = (v) => (slow ? new Promise((r) => setTimeout(() => r(v), 0)) : Promise.resolve(v));
  return {
    converted,
    hashFile: (p) => tick(srcHashes[p] ?? sha(p)),   // srcSha256 is a real 64-hex digest (validator enforces it)
    convertFresh: (p) => { converted.push(p); return tick(Buffer.from(contents[p] ?? `webp-bytes-for-${p}`)); },
    hashBytes: (buf) => tick({ sha256: sha(buf), md5: md5(buf) }),   // HEX md5 (rev 6)
    bundledExists: (name) => bundled.has(name),
    encoder: { sharp: '0.32.6', vips: '8.14.5' },
  };
}
const slugs = (obj) => new Map(Object.entries(obj));
const T = { ...TIER, recipeId: RECIPE_ID };
const mf = (objects) => ({ tier: T, objects });
// A complete, valid entry for assertManifest tests (hex srcSha256, encoder provenance).
const entry = (slug, over = {}) => {
  const s = sha(slug);
  return { key: artKey(slug, s), sha256: s, md5: md5(slug), bytes: 100, srcSha256: sha(`src-${slug}`), recipeId: RECIPE_ID, encoder: { sharp: '0.32.6', vips: '8.14.5' }, ...over };
};

test('a fresh slug converts and gets a content-addressed key; tier carries recipeId', async () => {
  const d = deps();
  const { manifest, report } = await buildArtManifest(null, slugs({ '001-abundance-b-s': 'p1.png' }), d);
  const e = manifest.objects['001-abundance-b-s'];
  assert.equal(d.converted.length, 1);
  assert.match(e.key, /^001-abundance-b-s\.[0-9a-f]{64}\.webp$/);
  assert.match(e.md5, /^[0-9a-f]{32}$/, 'md5 is hex, not base64');
  assert.equal(e.recipeId, RECIPE_ID);
  assert.ok(e.bytes > 0);
  assert.deepEqual(manifest.tier, { ...TIER, recipeId: RECIPE_ID }, 'tier includes recipeId');
  assert.equal(report.fresh, 1);
});

test('works with genuinely ASYNC (promise-returning) deps', async () => {
  const d = deps({ slow: true });   // hashFile/convertFresh/hashBytes resolve on a macrotask
  const { manifest } = await buildArtManifest(null, slugs({ a: 'a.png', b: 'b.png' }), d);
  assert.equal(Object.keys(manifest.objects).length, 2);
  assert.equal(d.converted.length, 2);
});

test('md5 is stored as lowercase hex; contentMd5 derives the base64 PUT header', async () => {
  const h = md5('webp');
  assert.equal(h, '6a294358579240936bf4d66151e6e720', 'Codex known-answer (hex)');
  assert.equal(contentMd5(h), 'ailDWFeSQJNr9NZhUebnIA==', 'base64 PUT header, never hex-as-MD5');
  const d = deps({ contents: { 'p.png': 'webp' } });
  const { manifest } = await buildArtManifest(null, slugs({ s: 'p.png' }), d);
  assert.equal(manifest.objects.s.md5, h, 'the engine stores hex md5');
});

test('an unchanged source + recipe is KEPT without converting', async () => {
  const first = (await buildArtManifest(null, slugs({ s: 'p.png' }), deps())).manifest;
  const d = deps();
  const { report } = await buildArtManifest(first, slugs({ s: 'p.png' }), d);
  assert.equal(d.converted.length, 0);
  assert.equal(report.kept, 1);
});

test('BLOCKER: a CHANGED source always converts fresh and moves the key (never existence-skips)', async () => {
  const first = (await buildArtManifest(null, slugs({ s: 'p.png' }), deps({ srcHashes: { 'p.png': sha('A') }, contents: { 'p.png': 'old' } }))).manifest;
  const oldKey = first.objects.s.key;
  const d = deps({ srcHashes: { 'p.png': sha('B') }, contents: { 'p.png': 'corrected' } });
  const { manifest } = await buildArtManifest(first, slugs({ s: 'p.png' }), d);
  assert.equal(d.converted.length, 1, 'a changed source MUST run the production converter');
  assert.notEqual(manifest.objects.s.key, oldKey);
  assert.equal(manifest.objects.s.srcSha256, sha('B'));
});

test('a RECIPE change reconverts even when the source is unchanged', async () => {
  const first = (await buildArtManifest(null, slugs({ s: 'p.png' }), deps())).manifest;
  first.objects.s.recipeId = 'webp:w380:q78:v0';
  const d = deps();
  await buildArtManifest(first, slugs({ s: 'p.png' }), d);
  assert.equal(d.converted.length, 1);
});

test('--reconvert forces a fresh convert on a full predicate match', async () => {
  const first = (await buildArtManifest(null, slugs({ s: 'p.png' }), deps())).manifest;
  const d = deps();
  await buildArtManifest(first, slugs({ s: 'p.png' }), d, { reconvert: true });
  assert.equal(d.converted.length, 1);
});

test('an incremental drop carries a committed entry with no source PNG present', async () => {
  const first = (await buildArtManifest(null, slugs({ a: 'a.png', b: 'b.png' }), deps())).manifest;
  const d = deps();
  const { manifest, report } = await buildArtManifest(first, slugs({ a: 'a.png' }), d);
  assert.equal(d.converted.length, 0);
  assert.equal(manifest.objects.b.key, first.objects.b.key);
  assert.equal(report.carried, 1);
});

test('normalizeTransitional / Phase 5: legacyKey present when bundled, stripped when not', async () => {
  const bundled = new Set(['001-abundance-b.webp']);
  const withBundle = (await buildArtManifest(null, slugs({ '001-abundance-b-s': 'p.png' }), deps({ bundled }))).manifest;
  assert.equal(withBundle.objects['001-abundance-b-s'].legacyKey, '001-abundance-b.webp');
  const phase5 = (await buildArtManifest(withBundle, slugs({ '001-abundance-b-s': 'p.png' }), deps({ bundled: new Set() }))).manifest;
  assert.ok(!('legacyKey' in phase5.objects['001-abundance-b-s']), 'stripped with no bundled dir');
});

test('a malformed COMMITTED manifest is rejected before the skip predicate is trusted', async () => {
  const bad = { tier: T, objects: { s: { key: 's.zz.webp', sha256: 'zz', md5: 'yy', bytes: 1, srcSha256: sha('x'), recipeId: RECIPE_ID, encoder: { sharp: 'x', vips: 'y' } } } };
  await assert.rejects(() => buildArtManifest(bad, slugs({ s: 'p.png' }), deps()), /sha256 must be 64/);
});

test('assertManifest: full-field validation, incident-key contract, no repair-0', () => {
  const s = sha('s');
  assert.doesNotThrow(() => assertManifest(mf({ s: entry('s') })));
  // a missing/invalid tier is rejected:
  assert.throws(() => assertManifest({ objects: { s: entry('s') } }), /missing tier/);
  // md5 as base64 is rejected (the exact Codex bug):
  assert.throws(() => assertManifest(mf({ s: entry('s', { md5: 'ailDWFeSQJNr9NZhUebnIA==' }) })), /md5 must be 32/);
  // srcSha256 must be 64-hex, not an opaque token:
  assert.throws(() => assertManifest(mf({ s: entry('s', { srcSha256: 'x' }) })), /srcSha256 must be 64/);
  // encoder provenance is required and typed:
  assert.throws(() => assertManifest(mf({ s: entry('s', { encoder: undefined }) })), /missing encoder/);
  assert.throws(() => assertManifest(mf({ s: entry('s', { encoder: { sharp: '0.32.6' } }) })), /encoder\.sharp and encoder\.vips/);
  // key digest must equal sha256:
  assert.throws(() => assertManifest(mf({ s: entry('s', { key: artKey('s', sha('other')) }) })), /key digest/);
  // a repair (incident) key REQUIRES a valid predecessor incidentOf:
  assert.throws(() => assertManifest(mf({ s: { ...entry('s'), key: `s.${s}.repair-1.webp` } })), /valid incidentOf/);
  assert.doesNotThrow(() => assertManifest(mf({ s: { ...entry('s'), key: `s.${s}.repair-1.webp`, incidentOf: `s.${s}.webp` } })));
  // incidentOf naming a DIFFERENT digest is rejected (not a real predecessor):
  assert.throws(() => assertManifest(mf({ s: { ...entry('s'), key: `s.${s}.repair-1.webp`, incidentOf: `s.${sha('other')}.webp` } })), /same slug and digest/);
  // incidentOf must be an EARLIER incident (repair-2 -> repair-1 ok; repair-1 -> repair-2 rejected):
  assert.doesNotThrow(() => assertManifest(mf({ s: { ...entry('s'), key: `s.${s}.repair-2.webp`, incidentOf: `s.${s}.repair-1.webp` } })));
  assert.throws(() => assertManifest(mf({ s: { ...entry('s'), key: `s.${s}.repair-1.webp`, incidentOf: `s.${s}.repair-2.webp` } })), /earlier incident/);
  // repair-0 is not a valid incident number:
  assert.throws(() => assertManifest(mf({ s: { ...entry('s'), key: `s.${s}.repair-0.webp`, incidentOf: `s.${s}.webp` } })), /malformed key/);
  // a non-incident key must not carry incidentOf:
  assert.throws(() => assertManifest(mf({ s: entry('s', { incidentOf: `s.${s}.webp` }) })), /must not carry incidentOf/);
});

test('mapPool bounds conversion concurrency to the configured width', async () => {
  let inFlight = 0, maxInFlight = 0;
  const d = {
    hashFile: (p) => Promise.resolve(sha(p)),
    convertFresh: async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 0)); inFlight--; return Buffer.from('x'); },
    hashBytes: (buf) => Promise.resolve({ sha256: sha(buf), md5: md5(buf) }),
    bundledExists: () => false, encoder: { sharp: '0.32.6', vips: '8.14.5' }, concurrency: 3,
  };
  await buildArtManifest(null, slugs({ a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f' }), d);
  assert.ok(maxInFlight >= 2 && maxInFlight <= 3, `expected 2..3 concurrent, saw ${maxInFlight}`);
});

test('a worker failure rejects the build only AFTER started workers settle - no new conversion begins', async () => {
  const started = [];
  const d = {
    hashFile: (p) => Promise.resolve(sha(p)),
    // 'b' rejects on a microtask; the others resolve on a macrotask, so 'b' fails BEFORE any sibling
    // finishes and the pool must not start 'c'/'d'/'e'/'f'.
    convertFresh: (p, slug) => { started.push(slug); return slug === 'b' ? Promise.reject(new Error('convert boom')) : new Promise((r) => setTimeout(() => r(Buffer.from(`x-${slug}`)), 0)); },
    hashBytes: (buf) => Promise.resolve({ sha256: sha(buf), md5: md5(buf) }),
    bundledExists: () => false, encoder: { sharp: '0.32.6', vips: '8.14.5' }, concurrency: 2,
  };
  await assert.rejects(() => buildArtManifest(null, slugs({ a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f' }), d), /convert boom/);
  for (const later of ['c', 'd', 'e', 'f']) assert.ok(!started.includes(later), `no conversion started for ${later} after the failure`);
});

test('the pool AWAITS a started sibling to settlement before rejecting (counterfactual: fail-fast would leave it running)', async () => {
  let active = 0, siblingSettled = false;
  const d = {
    hashFile: (p) => Promise.resolve(sha(p)),
    // 'b' rejects on a microtask; 'a' is a SLOW macrotask that flips siblingSettled only on completion.
    // With allSettled the pool rejects AFTER 'a' finishes (settled=true, active=0). Reverting to
    // fail-fast Promise.all would surface the rejection while 'a' is still running (settled=false).
    convertFresh: (p, slug) => {
      if (slug === 'b') return Promise.reject(new Error('convert boom'));
      active++;
      return new Promise((res) => setTimeout(() => { siblingSettled = true; active--; res(Buffer.from('x')); }, 20));
    },
    hashBytes: (buf) => Promise.resolve({ sha256: sha(buf), md5: md5(buf) }),
    bundledExists: () => false, encoder: { sharp: '0.32.6', vips: '8.14.5' }, concurrency: 2,
  };
  await assert.rejects(() => buildArtManifest(null, slugs({ a: 'a.png', b: 'b.png' }), d), /convert boom/);
  assert.equal(active, 0, 'no worker was still running when the rejection surfaced');
  assert.equal(siblingSettled, true, 'the started sibling FINISHED before the pool rejected');
});

test('objects are sorted by slug for a stable, diffable manifest', async () => {
  const { manifest } = await buildArtManifest(null, slugs({ z: 'z.png', a: 'a.png', m: 'm.png' }), deps());
  assert.deepEqual(Object.keys(manifest.objects), ['a', 'm', 'z']);
});
