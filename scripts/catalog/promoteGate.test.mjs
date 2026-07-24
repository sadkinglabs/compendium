// Publish-before-promote orchestration - exact ordering + fail-closed counterfactuals. Run: npm run test:catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { publishThenPromote, recoverWithAudit, repointManifest } from './promoteGate.mjs';
import { runUpload } from './uploadRunner.mjs';

// A SCHEMA-VALID manifest entry (same shape assertManifest + runUpload demand) - so the repair path is
// exercised through the real validator, not a toy fixture.
const md5hex = (b) => createHash('md5').update(b).digest('hex');
const SHA = (s) => createHash('sha256').update(s).digest('hex');
const TIER = { width: 745, quality: 80, format: 'webp', recipeId: 'webp:w745:q80:v1' };
const entry = (slug, tag = slug) => {
  const sha = SHA(tag);
  return { key: `${slug}.${sha}.webp`, sha256: sha, md5: md5hex(tag), bytes: Buffer.from(tag).length, srcSha256: SHA(`src-${tag}`), recipeId: TIER.recipeId, encoder: { sharp: '0.32.6', vips: '8.14.5' } };
};
const validManifest = (objs) => ({ tier: TIER, objects: objs });

// A fake R2 client (real semantics: conditional PUT -> 412 when the key exists). Stateful across the
// runUpload rounds of one publishThenPromote, so a repair's second round sees the freshly PUT object.
function fakeClient({ store = [] } = {}) {
  const bucket = new Map(store);
  const ops = [];
  return {
    bucket, ops,
    putRequest: async (key, body, { md5, ifNoneMatch } = {}) => {
      ops.push({ op: 'put', key });
      if (ifNoneMatch === '*' && bucket.has(key)) return { status: 412, ok: false, etag: '' };
      bucket.set(key, { size: body.length, etag: `"${md5}"` });
      return { status: 200, ok: true, etag: md5 };
    },
    headObject: async (key) => { ops.push({ op: 'head', key }); return bucket.get(key) || null; },
    list: async () => { ops.push({ op: 'list' }); return new Map([...bucket].map(([k, o]) => [k, { size: o.size, etag: o.etag }])); },
  };
}
const stagedFor = (bytesBySlug) => (slug) => Buffer.from(bytesBySlug[slug]);

const MF = (objs) => ({ tier: {}, objects: objs });
const baseManifest = MF({ 'a-s': { key: 'a-s.hash.webp', bytes: 1, sha256: 'x', md5: 'y' } });
const green = { ok: true, counts: { created: 0, reused: 1, repaired: 0, failed: 0 }, repoints: [], remaining: 0, audit: { ok: true, problems: [] } };

// A scripted upload seam that records call order and returns the next queued result.
const scriptedUpload = (results, trace) => async ({ manifest }) => { trace.push(['upload', Object.keys(manifest.objects).length]); return results.shift(); };
const spyPromote = (trace) => ({ manifest, gen }) => { trace.push(['promote', gen]); };

test('SUCCESS: a green whole-manifest audit promotes exactly once, AFTER the upload', async () => {
  const trace = [];
  const out = await publishThenPromote({
    manifest: baseManifest, gen: 'g0',
    uploadOnce: scriptedUpload([green], trace),
    repoint: () => { throw new Error('no repoint expected'); },
    regen: () => { throw new Error('no regen expected'); },
    promote: spyPromote(trace),
  });
  assert.deepEqual(trace, [['upload', 1], ['promote', 'g0']], 'upload strictly before the single promote');
  assert.equal(out.res, green);
});

test('CONFLICT: a refused conflict fails BEFORE promotion (no promote)', async () => {
  const trace = [];
  await assert.rejects(() => publishThenPromote({
    manifest: baseManifest, gen: 'g0',
    uploadOnce: scriptedUpload([{ ok: false, refusedConflicts: [{}, {}] }], trace),
    repoint: () => {}, regen: () => {}, promote: spyPromote(trace),
  }), /conflicting remote object/);
  assert.deepEqual(trace, [['upload', 1]], 'promote never ran');
});

test('UPLOAD FAILURE: any failed upload => no promote', async () => {
  const trace = [];
  await assert.rejects(() => publishThenPromote({
    manifest: baseManifest, gen: 'g0',
    uploadOnce: scriptedUpload([{ ok: false, counts: { failed: 3 } }], trace),
    repoint: () => {}, regen: () => {}, promote: spyPromote(trace),
  }), /upload\(s\) failed/);
  assert.deepEqual(trace, [['upload', 1]]);
});

test('PARTIAL: a --limit batch with objects remaining cannot promote', async () => {
  const trace = [];
  await assert.rejects(() => publishThenPromote({
    manifest: baseManifest, gen: 'g0',
    uploadOnce: scriptedUpload([{ ok: true, counts: { failed: 0 }, remaining: 5, auditDeferred: 'limit' }], trace),
    repoint: () => {}, regen: () => {}, promote: spyPromote(trace),
  }), /still pending/);
  assert.deepEqual(trace, [['upload', 1]]);
});

test('AUDIT MISMATCH: a non-green whole-manifest audit => no promote / no journal', async () => {
  const trace = [];
  await assert.rejects(() => publishThenPromote({
    manifest: baseManifest, gen: 'g0',
    uploadOnce: scriptedUpload([{ ok: false, counts: { failed: 0 }, remaining: 0, audit: { ok: false, problems: ['a', 'b'] } }], trace),
    repoint: () => {}, regen: () => {}, promote: spyPromote(trace),
  }), /audit failed \(2 problem/);
  assert.deepEqual(trace, [['upload', 1]]);
});

test('REPAIR through REAL runUpload: a conflict repairs to repair-1 (incidentOf=base), re-audits green, promotes once', async () => {
  const e0 = entry('a');                                   // valid base entry
  // The base key exists on R2 with the WRONG bytes -> a conflict the repair path must resolve.
  const client = fakeClient({ store: [[e0.key, { size: 999, etag: '"deadbeef"' }]] });
  const staged = stagedFor({ a: 'a' });                    // correct staged bytes for slug 'a'
  const trace = [];
  const out = await publishThenPromote({
    manifest: validManifest({ a: e0 }), gen: 'g0',
    // the REAL runUpload + real assertManifest: a repointed manifest missing incidentOf fails HERE.
    uploadOnce: ({ manifest: m }) => runUpload({ manifest: m, client, readStaged: staged, repairConflicts: true }),
    repoint: repointManifest,
    regen: (m) => { trace.push('regen'); return { manifest: m, gen: 'g1' }; },
    promote: ({ manifest: m, gen: g }) => trace.push(['promote', g, m.objects.a.incidentOf]),
  });
  assert.match(out.manifest.objects.a.key, /\.repair-1\.webp$/, 'repointed to the repair-1 incident key');
  assert.equal(out.manifest.objects.a.incidentOf, e0.key, 'incidentOf names the base predecessor');
  assert.deepEqual(trace, ['regen', ['promote', 'g1', e0.key]], 'regenerate after the fold, then ONE promote of the repointed+regenerated catalog');
  assert.ok(client.bucket.has(out.manifest.objects.a.key), 'the repair object was actually published');
});

test('REPAIR non-convergence: an audit that never greens => throws after the bound, never promotes', async () => {
  const e0 = entry('a');
  let rounds = 0;
  // Every round reports a repoint that does not match (the manifest stays valid but never audits green).
  const never = { ok: true, counts: { failed: 0 }, remaining: 0, repoints: [['no-such-key', 'no-such-key.repair-1.webp']], auditDeferred: 'repoints' };
  const promoted = [];
  await assert.rejects(() => publishThenPromote({
    manifest: validManifest({ a: e0 }), gen: 'g0', maxRounds: 3,
    uploadOnce: async () => { rounds += 1; return never; },
    repoint: repointManifest,   // a no-op here (key absent), but keeps the manifest schema-valid
    regen: (m) => ({ manifest: m, gen: 'g' }),
    promote: () => promoted.push(1),
  }), /did not converge/);
  assert.equal(promoted.length, 0, 'never promoted');
  assert.ok(rounds >= 3, 'the loop ran to the bound');
});

test('repointManifest preserves the predecessor CHAIN: repair-1 -> repair-2 sets incidentOf=repair-1', () => {
  const e0 = entry('a');
  const k1 = `a.${e0.sha256}.repair-1.webp`;
  const k2 = `a.${e0.sha256}.repair-2.webp`;
  const afterFirst = repointManifest(validManifest({ a: e0 }), [[e0.key, k1]]);
  assert.equal(afterFirst.objects.a.incidentOf, e0.key, 'repair-1 -> base');
  const afterSecond = repointManifest(afterFirst, [[k1, k2]]);
  assert.equal(afterSecond.objects.a.key, k2);
  assert.equal(afterSecond.objects.a.incidentOf, k1, 'repair-2 -> repair-1 (not straight to base)');
});

test('recoverWithAudit: a green re-audit recovers; a failed audit leaves the journal pending', async () => {
  let recovered = false;
  const rec = await recoverWithAudit({ stagedManifest: baseManifest, auditOnce: async () => ({ ok: true }), recover: () => { recovered = true; return { recovered: true }; } });
  assert.ok(recovered && rec.recovered);

  recovered = false;
  await assert.rejects(() => recoverWithAudit({
    stagedManifest: baseManifest, auditOnce: async () => ({ ok: false, problems: ['x'] }), recover: () => { recovered = true; },
  }), /remote audit failed/);
  assert.ok(!recovered, 'recover() never ran when the audit was not green');
});

test('repointManifest: remaps the affected key AND records incidentOf; untouched entries + input unchanged', () => {
  const m = MF({ 'a-s': { key: 'K1', bytes: 1 }, 'b-s': { key: 'K2', bytes: 2 } });
  const out = repointManifest(m, [['K1', 'K1-repair-1']]);
  assert.equal(out.objects['a-s'].key, 'K1-repair-1');
  assert.equal(out.objects['a-s'].incidentOf, 'K1', 'the replaced key is recorded as the predecessor');
  assert.equal(out.objects['b-s'].key, 'K2', 'untouched');
  assert.ok(!('incidentOf' in out.objects['b-s']), 'a non-repointed entry gains no incidentOf');
  assert.equal(m.objects['a-s'].key, 'K1', 'input not mutated');
});
