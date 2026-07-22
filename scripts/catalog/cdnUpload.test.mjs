// The upload/audit planner (scripts/catalog/cdnUpload.mjs). Every classification is mutation-checked:
// a test asserts not just the happy path but that flipping ONE field (size OR etag) flips the outcome,
// so a planner that ignored either field would fail. Run: npm run test:catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planUpload, repairKey, auditPublish, stripQuotes } from './cdnUpload.mjs';
import { incidentKey } from './artManifest.mjs';

const SHA = { a: 'a'.repeat(64), b: 'b'.repeat(64), c: 'c'.repeat(64) };
const MD5 = { a: '1'.repeat(32), b: '2'.repeat(32), c: '3'.repeat(32) };

// A valid manifest entry (assertManifest requires key<->sha256 agreement, hex digests, positive bytes,
// srcSha256 + recipeId). The key is content-addressed: <slug>.<sha256>.webp.
const entry = (slug, sha, md5, bytes) => ({
  key: `${slug}.${sha}.webp`, sha256: sha, md5, bytes, srcSha256: `src-${sha}`, recipeId: 'webp:w745:q80:v1',
});
const manifest = (...entries) => ({
  tier: { width: 745, quality: 80, format: 'webp', recipeId: 'webp:w745:q80:v1' },
  // key by the entry's real slug (the key segment before the digest) so assertManifest's
  // slug<->key agreement check is satisfied; test slugs contain no dots.
  objects: Object.fromEntries(entries.map((e) => [e.key.split('.')[0], e])),
});
const remote = (pairs) => new Map(pairs.map(([key, size, etag]) => [key, { size, etag }]));

test('stripQuotes normalises quoted, weak, and mixed-case ETags to bare lowercase hex', () => {
  assert.equal(stripQuotes('"ABCDEF"'), 'abcdef');
  assert.equal(stripQuotes('W/"abc"'), 'abc');
  assert.equal(stripQuotes('abc'), 'abc');
  assert.equal(stripQuotes(undefined), '');
});

test('planUpload: missing -> put, valid -> skip, conflicting -> conflicts', () => {
  const e0 = entry('alpha', SHA.a, MD5.a, 100);  // missing remotely
  const e1 = entry('beta', SHA.b, MD5.b, 200);   // present, correct
  const e2 = entry('gamma', SHA.c, MD5.c, 300);  // present, wrong bytes
  const plan = planUpload(manifest(e0, e1, e2), remote([
    [e1.key, 200, `"${MD5.b}"`],
    [e2.key, 300, `"${'9'.repeat(32)}"`],   // right size, WRONG etag
  ]));
  assert.deepEqual(plan.put.map((e) => e.key), [e0.key]);
  assert.deepEqual(plan.skip.map((e) => e.key), [e1.key]);
  assert.deepEqual(plan.conflicts.map((c) => c.entry.key), [e2.key]);
});

test('planUpload skip requires BOTH size and etag (mutation: flip either -> conflict, never skip)', () => {
  const e = entry('alpha', SHA.a, MD5.a, 100);
  // right etag, WRONG size
  const wrongSize = planUpload(manifest(e), remote([[e.key, 101, `"${MD5.a}"`]]));
  assert.equal(wrongSize.skip.length, 0);
  assert.equal(wrongSize.conflicts.length, 1);
  // right size, WRONG etag
  const wrongEtag = planUpload(manifest(e), remote([[e.key, 100, `"${MD5.b}"`]]));
  assert.equal(wrongEtag.skip.length, 0);
  assert.equal(wrongEtag.conflicts.length, 1);
  // both right -> skip (proves the above conflicts are caused by the flip, not a broken matcher)
  const both = planUpload(manifest(e), remote([[e.key, 100, `"${MD5.a}"`]]));
  assert.equal(both.skip.length, 1);
  assert.equal(both.conflicts.length, 0);
});

test('repairKey: an absent slot is PUT under repair-1 and returned (never overwrites)', async () => {
  const puts = [];
  const key = await repairKey({
    slug: 'alpha', sha256: SHA.a, bytes: 100, expectedIntegrity: MD5.a, correctBytes: Buffer.alloc(100),
    remoteLookup: async () => undefined,
    putObject: async (k, b) => puts.push([k, b.length]),
  });
  assert.equal(key, incidentKey('alpha', SHA.a, 1));
  assert.deepEqual(puts, [[incidentKey('alpha', SHA.a, 1), 100]]);
});

test('repairKey: a present-and-correct repair slot is REUSED, with NO put (interrupted-run recovery)', async () => {
  const puts = [];
  const store = remote([[incidentKey('alpha', SHA.a, 1), 100, `"${MD5.a}"`]]);
  const key = await repairKey({
    slug: 'alpha', sha256: SHA.a, bytes: 100, expectedIntegrity: MD5.a, correctBytes: Buffer.alloc(100),
    remoteLookup: async (k) => store.get(k),
    putObject: async (k, b) => puts.push([k, b.length]),
  });
  assert.equal(key, incidentKey('alpha', SHA.a, 1));
  assert.equal(puts.length, 0, 'a correct repair-1 must be reused, never re-PUT');
});

test('repairKey: a present-but-WRONG slot is never overwritten; the loop advances to the next slot', async () => {
  const puts = [];
  const store = remote([[incidentKey('alpha', SHA.a, 1), 100, `"${MD5.b}"`]]);  // repair-1 exists but wrong bytes
  const key = await repairKey({
    slug: 'alpha', sha256: SHA.a, bytes: 100, expectedIntegrity: MD5.a, correctBytes: Buffer.alloc(100),
    remoteLookup: async (k) => store.get(k),
    putObject: async (k, b) => puts.push([k, b.length]),
  });
  assert.equal(key, incidentKey('alpha', SHA.a, 2), 'advanced past the poisoned repair-1');
  assert.deepEqual(puts, [[incidentKey('alpha', SHA.a, 2), 100]], 'repair-1 was NOT overwritten');
});

test('repairKey is retry-stable: rerun after a correct PUT reuses the same key with no new PUT', async () => {
  const puts = [];
  const store = new Map();
  const args = () => ({
    slug: 'alpha', sha256: SHA.a, bytes: 100, expectedIntegrity: MD5.a, correctBytes: Buffer.alloc(100),
    remoteLookup: async (k) => store.get(k),
    putObject: async (k, b) => { puts.push(k); store.set(k, { size: b.length, etag: `"${MD5.a}"` }); },
  });
  const first = await repairKey(args());
  const second = await repairKey(args());   // remote now holds the correct repair-1
  assert.equal(first, second);
  assert.deepEqual(puts, [incidentKey('alpha', SHA.a, 1)], 'the second run reuses repair-1, no second PUT');
});

test('auditPublish passes only when every needed key is published with the right size AND etag', () => {
  const e = entry('alpha', SHA.a, MD5.a, 100);
  const good = auditPublish([e.key], manifest(e), remote([[e.key, 100, `"${MD5.a}"`]]));
  assert.deepEqual(good, { ok: true, problems: [] });
});

test('auditPublish refuses a right-size WRONG-etag object (the load-bearing counterfactual)', () => {
  const e = entry('alpha', SHA.a, MD5.a, 100);
  const res = auditPublish([e.key], manifest(e), remote([[e.key, 100, `"${MD5.b}"`]]));
  assert.equal(res.ok, false);
  assert.match(res.problems[0], /etag .* != expected md5/);
});

test('auditPublish refuses an absent object and a key that is not a manifest object', () => {
  const e = entry('alpha', SHA.a, MD5.a, 100);
  const absent = auditPublish([e.key], manifest(e), remote([]));
  assert.equal(absent.ok, false);
  assert.match(absent.problems[0], /absent from the remote listing/);
  const ghost = auditPublish(['ghost.' + SHA.c + '.webp'], manifest(e), remote([]));
  assert.equal(ghost.ok, false);
  assert.match(ghost.problems[0], /not a manifest object key/);
});

test('integrity:sha256 branch compares the sha256 field (canary-failed signed-HEAD evidence)', () => {
  const e = entry('alpha', SHA.a, MD5.a, 100);   // remote etag carries the sha256, not the md5
  const ok = auditPublish([e.key], manifest(e), remote([[e.key, 100, SHA.a]]), { integrity: 'sha256' });
  assert.equal(ok.ok, true);
  const bad = auditPublish([e.key], manifest(e), remote([[e.key, 100, MD5.a]]), { integrity: 'sha256' });
  assert.equal(bad.ok, false, 'md5 in the sha256 slot must fail the sha256 audit');
});
