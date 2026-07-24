// Publish-before-promote orchestration - exact ordering + fail-closed counterfactuals. Run: npm run test:catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishThenPromote, recoverWithAudit, repointManifest } from './promoteGate.mjs';

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

test('REPAIR: repoints are folded back + regenerated + RE-AUDITED before the single promote', async () => {
  const trace = [];
  const results = [
    { ok: true, counts: { failed: 0 }, remaining: 0, repoints: [['a-s.hash.webp', 'a-s.repair-1.webp']], auditDeferred: 'repoints' },
    green,   // the re-audit after folding is green
  ];
  let regenerated = false;
  const out = await publishThenPromote({
    manifest: baseManifest, gen: 'g0',
    uploadOnce: scriptedUpload(results, trace),
    repoint: (m, rp) => repointManifest(m, rp),
    regen: (m) => { regenerated = true; return { manifest: m, gen: 'g1' }; },   // rebuilt gen after repoint
    promote: spyPromote(trace),
  });
  assert.ok(regenerated, 'the catalog was regenerated from the repointed manifest');
  assert.equal(out.manifest.objects['a-s'].key, 'a-s.repair-1.webp', 'the manifest key was repointed');
  assert.deepEqual(trace, [['upload', 1], ['upload', 1], ['promote', 'g1']], 'upload, re-audit, then ONE promote of the regenerated gen');
});

test('REPAIR non-convergence: repoints forever => throws after the bound, never promotes', async () => {
  const trace = [];
  const forever = () => ({ ok: true, counts: { failed: 0 }, remaining: 0, repoints: [['a-s.hash.webp', 'a-s.repair-1.webp']], auditDeferred: 'repoints' });
  await assert.rejects(() => publishThenPromote({
    manifest: baseManifest, gen: 'g0', maxRounds: 3,
    uploadOnce: async ({ manifest }) => { trace.push('upload'); return forever(manifest); },
    repoint: (m, rp) => repointManifest(m, rp),
    regen: (m) => ({ manifest: m, gen: 'g' }),
    promote: () => trace.push('promote'),
  }), /did not converge/);
  assert.ok(!trace.includes('promote'), 'never promoted');
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

test('repointManifest: pure remap of the affected keys only', () => {
  const m = MF({ 'a-s': { key: 'K1', bytes: 1 }, 'b-s': { key: 'K2', bytes: 2 } });
  const out = repointManifest(m, [['K1', 'K1-repair-1']]);
  assert.equal(out.objects['a-s'].key, 'K1-repair-1');
  assert.equal(out.objects['b-s'].key, 'K2', 'untouched');
  assert.equal(m.objects['a-s'].key, 'K1', 'input not mutated');
});
