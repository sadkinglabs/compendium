// Production-wiring proof for the CLI (scripts/catalog/cdn-upload.mjs). Importing the module does NOT
// run main() (the auto-run is guarded to direct invocation), so a test can construct the SAME client
// the CLI builds and confirm it really issues a conditional create - closing the "the pure test is
// green but production dropped the header" gap. Run: npm run test:catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClient } from './cdn-upload.mjs';

const resp = (status, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (h) => headers[h.toLowerCase()] ?? null }, text: async () => '' });

test('the CLI builds a client that sends If-None-Match:* + Content-MD5 to the configured bucket URL', async () => {
  const calls = [];
  const client = buildClient({
    env: { R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/', R2_BUCKET: 'compendium-art' },
    signedFetch: async (url, opts) => { calls.push({ url, opts }); return resp(200, { etag: '"abc"' }); },
    plainFetch: async () => resp(200),
  });
  await client.putRequest('001-x-b-s.deadbeef.webp', Buffer.from('x'), { md5: '6a294358579240936bf4d66151e6e720', ifNoneMatch: '*' });
  const { url, opts } = calls[0];
  assert.equal(opts.method, 'PUT');
  assert.equal(opts.headers['If-None-Match'], '*', 'the CLI-built client MUST send the conditional header (no bypass)');
  assert.equal(opts.headers['Content-MD5'], 'ailDWFeSQJNr9NZhUebnIA==');
  assert.equal(url, 'https://acct.r2.cloudflarestorage.com/compendium-art/001-x-b-s.deadbeef.webp', 'trailing slash trimmed, path-style key');
});
