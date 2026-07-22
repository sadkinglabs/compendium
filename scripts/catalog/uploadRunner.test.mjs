// The upload/canary orchestration (scripts/catalog/uploadRunner.mjs) driven by a FAKE R2 client that
// models real R2 semantics (conditional PUT -> 412 when the key exists) plus injectable per-key scripts
// for race scenarios. These prove the actual request SEQUENCE and the plan-execution contract, not just
// the pure classifier: only pending rows touch staging, a dry run mutates nothing, limits advance, and
// the convergent canary catches a bucket with overwrite protection off. Run: npm run test:catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runUpload, runCheck } from './uploadRunner.mjs';

const md5hex = (b) => createHash('md5').update(b).digest('hex');
const SHA = (s) => createHash('sha256').update(s).digest('hex');

const entry = (slug, tag = slug) => {
  const sha = SHA(tag);
  return { key: `${slug}.${sha}.webp`, sha256: sha, md5: md5hex(tag), bytes: Buffer.from(tag).length, srcSha256: SHA(`src-${tag}`), recipeId: 'webp:w745:q80:v1', encoder: { sharp: '0.32.6', vips: '8.14.5' } };
};
const manifest = (entries) => ({ tier: { width: 745, quality: 80, format: 'webp', recipeId: 'webp:w745:q80:v1' }, objects: entries });

// A fake R2 client. `store` is the visible bucket; `phantom` holds objects present for PUT/HEAD but
// hidden from list() (the "created between LIST and PUT" race); `script` forces per-key put/head
// results in order, then falls back to store semantics.
function fakeClient({ store = [], phantom = [], script = {}, conditionalEnforced = true } = {}) {
  const bucket = new Map(store.map(([k, o]) => [k, o]));
  const ghosts = new Map(phantom.map(([k, o]) => [k, o]));
  const scr = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, { puts: [...(v.puts || [])], heads: [...(v.heads || [])] }]));
  const ops = [];
  return {
    bucket, ops,
    putRequest: async (key, body, { md5, ifNoneMatch } = {}) => {
      ops.push({ op: 'put', key, ifNoneMatch: ifNoneMatch || null });
      if (scr[key]?.puts.length) { const s = scr[key].puts.shift(); if (s === 200) { bucket.set(key, { size: body.length, etag: `"${md5}"` }); return { status: 200, ok: true, etag: md5 }; } return { status: s, ok: false, etag: '' }; }
      if (ifNoneMatch === '*' && conditionalEnforced && (bucket.has(key) || ghosts.has(key))) return { status: 412, ok: false, etag: '' };
      bucket.set(key, { size: body.length, etag: `"${md5}"` });
      return { status: 200, ok: true, etag: md5 };
    },
    headObject: async (key) => {
      ops.push({ op: 'head', key });
      if (scr[key]?.heads.length) return scr[key].heads.shift();
      return bucket.get(key) || ghosts.get(key) || null;
    },
    list: async () => { ops.push({ op: 'list' }); return new Map([...bucket].map(([k, o]) => [k, { size: o.size, etag: o.etag }])); },
    publicGet: async () => ({ ok: true, headers: { get: (h) => ({ 'content-type': 'text/plain', 'cache-control': 'immutable-cc' }[h.toLowerCase()] ?? null) }, text: async () => 'compendium r2 healthcheck v1' }),
  };
}
const stagedFor = (readable) => (slug, e) => { if (!readable.has(slug)) throw new Error(`no staging for ${slug}`); return Buffer.from(readable.get(slug)); };

test('runUpload executes ONLY put rows: a valid remote skip is never read from staging nor re-PUT', async () => {
  const e0 = entry('missing'), e1 = entry('valid');
  const client = fakeClient({ store: [[e1.key, { size: e1.bytes, etag: `"${e1.md5}"` }]] });
  // staging exists ONLY for the missing slug; if the runner touched the skip it would throw.
  const res = await runUpload({ manifest: manifest({ missing: e0, valid: e1 }), client, readStaged: stagedFor(new Map([['missing', 'missing']])) });
  assert.equal(res.counts.created, 1);
  assert.ok(client.bucket.has(e0.key), 'the missing object was uploaded');
  assert.equal(client.ops.filter((o) => o.op === 'put' && o.key === e1.key).length, 0, 'the valid skip was never PUT');
});

test('a put row is created via a CONDITIONAL PUT (If-None-Match:*)', async () => {
  const e0 = entry('a');
  const client = fakeClient();
  await runUpload({ manifest: manifest({ a: e0 }), client, readStaged: stagedFor(new Map([['a', 'a']])) });
  const put = client.ops.find((o) => o.op === 'put' && o.key === e0.key);
  assert.equal(put.ifNoneMatch, '*', 'every create is conditional - the overwrite guard is on the wire');
});

test('a race conflict on a put row (absent in listing, conflicting at claim) refuses without --repair-conflicts', async () => {
  const e0 = entry('a');
  const client = fakeClient({ phantom: [[e0.key, { size: 999, etag: '"deadbeef"' }]] });   // present for PUT/HEAD, hidden from list
  const res = await runUpload({ manifest: manifest({ a: e0 }), client, readStaged: stagedFor(new Map([['a', 'a']])) });
  assert.equal(res.ok, false);
  assert.equal(res.counts.failed, 1);
  // the sequence was conditional PUT (412) then an authoritative HEAD - never an overwrite:
  const seq = client.ops.filter((o) => o.key === e0.key).map((o) => o.op);
  assert.deepEqual(seq, ['put', 'head']);
});

test('a conflict WITH --repair-conflicts allocates a repair key (never overwrites the original)', async () => {
  const e0 = entry('a');
  const client = fakeClient({ store: [[e0.key, { size: 999, etag: '"deadbeef"' }]] });   // listed, conflicting bytes
  const res = await runUpload({ manifest: manifest({ a: e0 }), client, readStaged: stagedFor(new Map([['a', 'a']])), repairConflicts: true });
  assert.equal(res.counts.repaired, 1);
  assert.equal(res.repoints[0][0], e0.key);
  assert.match(res.repoints[0][1], /\.repair-1\.webp$/);
  assert.ok(client.bucket.has(res.repoints[0][1]), 'the repair key was created');
  assert.deepEqual(client.bucket.get(e0.key), { size: 999, etag: '"deadbeef"' }, 'the conflicting original is untouched');
  assert.equal(client.ops.some((o) => o.op === 'put' && o.key === e0.key), false, 'the conflicting original key was never PUT');
});

test('--limit + --repair-conflicts with conflicts is REFUSED before any staging read or PUT (no orphaned repair)', async () => {
  const e0 = entry('a'), e1 = entry('b');
  const client = fakeClient({ store: [[e0.key, { size: 9, etag: '"x"' }], [e1.key, { size: 9, etag: '"y"' }]] });   // two conflicts
  let readCalls = 0;
  const readStaged = () => { readCalls++; return Buffer.from('x'); };
  await assert.rejects(
    () => runUpload({ manifest: manifest({ a: e0, b: e1 }), client, readStaged, repairConflicts: true, limit: 1 }),
    /--limit cannot be combined with --repair-conflicts/,
  );
  assert.equal(readCalls, 0, 'staging was never read');
  assert.deepEqual(client.ops.map((o) => o.op), ['list'], 'only the plan listing happened - no PUT, no HEAD');
  assert.equal(client.bucket.size, 2, 'no repair object was created; the originals are untouched');
});

test('an object that disappears after LIST (412 -> 404) retries the SAME key and creates it', async () => {
  const e0 = entry('a');
  // first PUT 412, first HEAD null (vanished) -> retry -> second PUT falls through to a real create.
  const client = fakeClient({ script: { [e0.key]: { puts: [412], heads: [null] } } });
  const res = await runUpload({ manifest: manifest({ a: e0 }), client, readStaged: stagedFor(new Map([['a', 'a']])) });
  assert.equal(res.counts.created, 1);
  assert.deepEqual(client.ops.filter((o) => o.key === e0.key).map((o) => o.op), ['put', 'head', 'put'], 'conditional retry after the vanish');
});

test('a dry run issues ZERO mutations (only the listing)', async () => {
  const e0 = entry('a');
  const client = fakeClient();
  const res = await runUpload({ manifest: manifest({ a: e0 }), client, readStaged: () => { throw new Error('dry run must not read staging'); }, dryRun: true });
  assert.equal(res.dryRun, true);
  assert.deepEqual(client.ops.map((o) => o.op), ['list'], 'no put, no head - nothing mutated');
});

test('--limit caps PENDING work and repeated limited runs ADVANCE to new objects', async () => {
  const es = { a: entry('a'), b: entry('b'), c: entry('c') };
  const staging = new Map([['a', 'a'], ['b', 'b'], ['c', 'c']]);
  const client = fakeClient();   // persists between runs
  const r1 = await runUpload({ manifest: manifest(es), client, readStaged: stagedFor(staging), limit: 1 });
  assert.equal(r1.counts.created, 1);
  assert.equal(r1.remaining, 2);
  const afterFirst = new Set(client.bucket.keys());
  const r2 = await runUpload({ manifest: manifest(es), client, readStaged: stagedFor(staging), limit: 1 });
  assert.equal(r2.counts.created, 1);
  const afterSecond = new Set(client.bucket.keys());
  assert.equal(afterSecond.size, 2, 'a DIFFERENT object was uploaded on the second run, not the same prefix');
  assert.notDeepEqual([...afterFirst], [...afterSecond]);
});

test('--limit must be a positive integer', async () => {
  const client = fakeClient();
  await assert.rejects(() => runUpload({ manifest: manifest({ a: entry('a') }), client, readStaged: () => Buffer.from('a'), limit: 0 }), /positive integer/);
});

test('a full run audits the ENTIRE manifest and passes when every object is published', async () => {
  const es = { a: entry('a'), b: entry('b') };
  const client = fakeClient();
  const res = await runUpload({ manifest: manifest(es), client, readStaged: stagedFor(new Map([['a', 'a'], ['b', 'b']])) });
  assert.equal(res.counts.created, 2);
  assert.equal(res.remaining, 0);
  assert.equal(res.audit.ok, true);
});

test('runCheck: the convergent canary passes when overwrite protection is enforced', async () => {
  const client = fakeClient();
  const res = await runCheck({ client, publicBase: 'https://cdn', cacheControl: 'immutable-cc', hashMd5: md5hex });
  assert.equal(res.ok, true);
});

test('runCheck: a bucket that does NOT enforce If-None-Match fails the canary (overwrite protection off)', async () => {
  const client = fakeClient({ conditionalEnforced: false });   // conditional PUT wrongly succeeds
  await assert.rejects(() => runCheck({ client, publicBase: 'https://cdn', cacheControl: 'immutable-cc', hashMd5: md5hex }), /If-None-Match is NOT enforced/);
});
