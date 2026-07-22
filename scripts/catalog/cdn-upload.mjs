// Upload the converted card-art webp to Cloudflare R2 (S3-compatible, SigV4 via aws4fetch).
//
// Credentials come from `.env.r2` (gitignored) - never args, never the repo. Objects are written
// with a long immutable cache header because a slug names one exact scan (card+set+finish); the art
// for a slug never changes, so browsers, the edge, and the device cache can all hold it forever.
//
//   node scripts/catalog/cdn-upload.mjs --check     # one healthcheck object, verify PUT + public GET
//   node scripts/catalog/cdn-upload.mjs [--limit N] # upload the webp in CATALOG_DROP/cdn-art
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';

const ART_DIR = 'CATALOG_DROP/cdn-art';
const CONTENT_TYPE = 'image/webp';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const CONCURRENCY = 12;

function loadEnv(file = '.env.r2') {
  if (!existsSync(file)) { console.error(`Missing ${file}`); process.exit(1); }
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };

async function main() {
  const env = loadEnv();
  const endpoint = (env.R2_ENDPOINT || '').replace(/\/+$/, '');
  const bucket = env.R2_BUCKET;
  const publicBase = (env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  for (const [k, v] of [['R2_ENDPOINT', endpoint], ['R2_BUCKET', bucket], ['R2_ACCESS_KEY_ID', env.R2_ACCESS_KEY_ID], ['R2_SECRET_ACCESS_KEY', env.R2_SECRET_ACCESS_KEY]]) {
    if (!v) { console.error(`.env.r2 missing ${k}`); process.exit(1); }
  }
  const aws = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, region: 'auto', service: 's3' });

  const put = async (key, body, type = CONTENT_TYPE) => {
    const res = await aws.fetch(`${endpoint}/${bucket}/${key}`, {
      method: 'PUT', body, headers: { 'Content-Type': type, 'Cache-Control': CACHE_CONTROL },
    });
    if (!res.ok) throw new Error(`PUT ${key} -> ${res.status} ${res.statusText} ${(await res.text()).slice(0, 200)}`);
  };

  if (process.argv.includes('--check')) {
    const key = '_healthcheck.txt';
    await put(key, `ok ${Date().toString()}`, 'text/plain');
    console.log(`PUT ${key} OK (upload credentials work)`);
    if (publicBase) {
      const r = await fetch(`${publicBase}/${key}`);
      console.log(`GET ${publicBase}/${key} -> ${r.status} ${r.ok ? '(public read works)' : '(public read FAILED - enable public access / check the r2.dev URL)'}`);
    } else {
      console.log('No R2_PUBLIC_BASE_URL set - skipped the public-read check.');
    }
    return;
  }

  if (!existsSync(ART_DIR)) { console.error(`No ${ART_DIR} - run cdn-convert.mjs first`); process.exit(1); }
  const LIMIT = arg('--limit') ? parseInt(arg('--limit'), 10) : Infinity;
  let files = (await readdir(ART_DIR)).filter((f) => f.endsWith('.webp'));
  if (LIMIT !== Infinity) files = files.slice(0, LIMIT);
  console.log(`uploading ${files.length} webp to ${bucket} ...`);

  const started = Date.now();
  let done = 0, failed = 0, cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const f = files[cursor++];
      try { await put(f, await readFile(path.join(ART_DIR, f))); }
      catch (e) { failed++; console.error(`  ${e.message}`); }
      done++;
      if (done % 200 === 0 || done === files.length) {
        const secs = (Date.now() - started) / 1000, rate = done / Math.max(secs, 0.001);
        console.log(`  ${done}/${files.length} (${rate.toFixed(1)}/s, eta ${Math.round((files.length - done) / Math.max(rate, 0.001))}s)`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  console.log(`uploaded ${done - failed}/${files.length} in ${((Date.now() - started) / 1000).toFixed(1)}s · failures: ${failed}`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
