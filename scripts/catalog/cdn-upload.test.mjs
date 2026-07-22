// Production-wiring proof for the CLI (scripts/catalog/cdn-upload.mjs). Importing the module does NOT
// run main() (the auto-run is guarded to direct invocation), so a test can drive the CLI's real
// composition. Two layers: buildClient() constructs a conditional-PUT client, and runCli() - the seam
// main() uses - actually routes an upload through runUpload and THAT client. Replacing runUpload with a
// bypass, or dropping the conditional header, fails the composition test. Run: npm run test:catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildClient, runCli } from './cdn-upload.mjs';

const md5hex = (b) => createHash('md5').update(b).digest('hex');
const sha256hex = (b) => createHash('sha256').update(b).digest('hex');
const resp = (status, headers = {}, body = '') => ({ status, ok: status >= 200 && status < 300, headers: { get: (h) => headers[h.toLowerCase()] ?? null }, text: async () => body });

test('buildClient constructs a client that sends If-None-Match:* + Content-MD5 to the configured bucket URL', async () => {
  const calls = [];
  const client = buildClient({
    env: { R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/', R2_BUCKET: 'compendium-art' },
    signedFetch: async (url, opts) => { calls.push({ url, opts }); return resp(200, { etag: '"abc"' }); },
    plainFetch: async () => resp(200),
  });
  await client.putRequest('001-x-b-s.deadbeef.webp', Buffer.from('x'), { md5: '6a294358579240936bf4d66151e6e720', ifNoneMatch: '*' });
  const { url, opts } = calls[0];
  assert.equal(opts.method, 'PUT');
  assert.equal(opts.headers['If-None-Match'], '*', 'the client MUST send the conditional header');
  assert.equal(opts.headers['Content-MD5'], 'ailDWFeSQJNr9NZhUebnIA==');
  assert.equal(url, 'https://acct.r2.cloudflarestorage.com/compendium-art/001-x-b-s.deadbeef.webp', 'trailing slash trimmed, path-style key');
});

test('runCli COMPOSES: an upload flows through runUpload and the real conditional-PUT client (no bypass)', async () => {
  const bytes = Buffer.from('a');
  const e = { key: `001-a-b-s.${sha256hex(bytes)}.webp`, sha256: sha256hex(bytes), md5: md5hex(bytes), bytes: bytes.length, srcSha256: 'e'.repeat(64), recipeId: 'webp:w745:q80:v1', encoder: { sharp: '0.32.6', vips: '8.14.5' } };
  const manifest = { tier: { width: 745, quality: 80, format: 'webp', recipeId: 'webp:w745:q80:v1' }, objects: { '001-a-b-s': e } };
  const store = new Map();   // the object created by the PUT becomes visible to the audit listing
  const calls = [];
  const listXml = () => `<ListBucketResult>${[...store].map(([k, o]) => `<Contents><Key>${k}</Key><Size>${o.size}</Size><ETag>${o.etag}</ETag></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`;
  const signedFetch = async (url, opts) => {
    calls.push({ method: opts.method, headers: opts.headers || {} });
    if (opts.method === 'PUT') { store.set(url.split('/bkt/')[1], { size: bytes.length, etag: `"${e.md5}"` }); return resp(200, { etag: `"${e.md5}"` }); }
    if (opts.method === 'GET') return resp(200, {}, listXml());   // ListObjectsV2
    return resp(200, {});
  };
  await runCli({
    argv: [], env: { R2_ENDPOINT: 'https://ep', R2_BUCKET: 'bkt' },
    signedFetch, plainFetch: async () => resp(200),
    readManifest: () => manifest, makeReadStaged: () => () => bytes, hashMd5: md5hex, log: () => {},
  });
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put, 'runCli actually issued an upload (routed through runUpload)');
  assert.equal(put.headers['If-None-Match'], '*', 'the upload went through the conditional-PUT client - the whole seam is wired');
});
