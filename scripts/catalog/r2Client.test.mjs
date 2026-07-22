// The R2 HTTP adapter (scripts/catalog/r2Client.mjs), driven by a FAKE signed fetch so the exact bytes
// on the wire are asserted - the conditional-PUT header, Content-MD5, HEAD-after-412, and the paginated
// listing with its truncation guard - without a network. Run: npm run test:catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createR2Client } from './r2Client.mjs';

const resp = (status, { headers = {}, body = '' } = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  text: async () => body,
});
const client = (signedFetch, over = {}) => createR2Client({ signedFetch, plainFetch: async () => resp(200), endpoint: 'https://ep', bucket: 'b', cacheControl: 'immutable-cc', ...over });

test('putRequest conditional create sends PUT + If-None-Match:* + Content-MD5 (base64 of hex) to the right URL', async () => {
  const calls = [];
  const c = client(async (url, opts) => { calls.push({ url, opts }); return resp(200, { headers: { etag: '"abc123"' } }); });
  const r = await c.putRequest('001-x-b-s.webp', Buffer.from('x'), { md5: '6a294358579240936bf4d66151e6e720', ifNoneMatch: '*' });
  assert.deepEqual(r, { status: 200, ok: true, etag: 'abc123' });
  const { url, opts } = calls[0];
  assert.equal(opts.method, 'PUT');
  assert.equal(opts.headers['If-None-Match'], '*', 'the create MUST be conditional');
  assert.equal(opts.headers['Content-MD5'], 'ailDWFeSQJNr9NZhUebnIA==', 'base64 of the hex md5, never hex-as-md5');
  assert.equal(opts.headers['Cache-Control'], 'immutable-cc');
  assert.equal(url, 'https://ep/b/001-x-b-s.webp');
});

test('putRequest treats 412 as an expected outcome (no throw); a plain PUT omits If-None-Match', async () => {
  const calls = [];
  const c = client(async (url, opts) => { calls.push(opts); return resp(412); });
  const r = await c.putRequest('k', Buffer.from('x'), { md5: '6a294358579240936bf4d66151e6e720' });
  assert.equal(r.status, 412);
  assert.equal(r.ok, false);
  assert.equal('If-None-Match' in calls[0].headers, false, 'an unconditional PUT carries no If-None-Match');
});

test('putRequest throws on a non-2xx non-412 status', async () => {
  const c = client(async () => resp(500, { body: 'boom' }));
  await assert.rejects(() => c.putRequest('k', Buffer.from('x')), /500/);
});

test('headObject returns size+etag, and null on 404', async () => {
  const ok = client(async (url, opts) => { assert.equal(opts.method, 'HEAD'); return resp(200, { headers: { 'content-length': '42', etag: '"e"' } }); });
  assert.deepEqual(await ok.headObject('k'), { size: 42, etag: '"e"' });
  const gone = client(async () => resp(404));
  assert.equal(await gone.headObject('k'), null);
});

test('list paginates, DECODES the continuation token, and fails closed on truncation without a token', async () => {
  const page1 = '<ListBucketResult><Contents><Key>a.webp</Key><Size>10</Size><ETag>"m1"</ETag></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;2</NextContinuationToken></ListBucketResult>';
  const page2 = '<ListBucketResult><Contents><Key>b.webp</Key><Size>20</Size><ETag>"m2"</ETag></Contents><IsTruncated>false</IsTruncated></ListBucketResult>';
  const seen = [];
  const c = client(async (url) => { seen.push(url); return resp(200, { body: url.includes('continuation-token') ? page2 : page1 }); });
  const map = await c.list();
  assert.equal(map.size, 2);
  assert.deepEqual(map.get('a.webp'), { size: 10, etag: '"m1"' });
  assert.deepEqual(map.get('b.webp'), { size: 20, etag: '"m2"' });
  assert.match(seen[1], /continuation-token=tok%262/, 'the &-decoded token is re-encoded once by URLSearchParams');

  const truncated = client(async () => resp(200, { body: '<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>' }));
  await assert.rejects(() => truncated.list(), /truncated page without a continuation token/);
});
