// The R2 network adapter for the pure upload/audit engine (cdnUpload.mjs). This file is the ONLY
// place that talks to R2 - SigV4 via aws4fetch, ListObjectsV2, PUT - so every classification and
// repair decision stays in the unit-tested engine. It is manifest-driven: the source of truth for
// WHAT to publish is public/catalog/art-manifest.json (content keys), and the bytes come from the
// gitignored CATALOG_DROP/cdn-art staging (each file named by its content key).
//
// Credentials come from `.env.r2` (gitignored) - never args, never the repo. Objects carry a long
// immutable cache header: a content key names one exact set of bytes forever, so browsers, the edge,
// and the device cache can all hold it indefinitely; corrected art is a new key, never an overwrite.
//
//   node scripts/catalog/cdn-upload.mjs --check              # ETag==MD5 canary + public-read check
//   node scripts/catalog/cdn-upload.mjs --dry-run            # plan only (put / valid / conflicting)
//   node scripts/catalog/cdn-upload.mjs [--limit N]          # upload missing objects, then audit
//   node scripts/catalog/cdn-upload.mjs --repair-conflicts   # PUT repair keys for conflicts, print repoints
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';
import { planUpload, repairKey, auditPublish, stripQuotes } from './cdnUpload.mjs';
import { assertManifest, contentMd5 } from './artManifest.mjs';

// Content-key-named webp staged by the catalog update's conversion step. The atomic activation
// (Phase 2) persists buildArtManifest's converted bytes here under each object's content key; until
// then this adapter's --check canary and --dry-run plan work standalone, but a real upload needs the
// staging populated. (The retired cdn-convert.mjs named outputs by source filename, not content key.)
const STAGE_DIR = 'CATALOG_DROP/cdn-art';
const MANIFEST_FILE = 'public/catalog/art-manifest.json';
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
const decodeXml = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function main() {
  const env = loadEnv();
  const endpoint = (env.R2_ENDPOINT || '').replace(/\/+$/, '');
  const bucket = env.R2_BUCKET;
  const publicBase = (env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  for (const [k, v] of [['R2_ENDPOINT', endpoint], ['R2_BUCKET', bucket], ['R2_ACCESS_KEY_ID', env.R2_ACCESS_KEY_ID], ['R2_SECRET_ACCESS_KEY', env.R2_SECRET_ACCESS_KEY]]) {
    if (!v) { console.error(`.env.r2 missing ${k}`); process.exit(1); }
  }
  const aws = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, region: 'auto', service: 's3' });

  // PUT with Content-MD5 (R2 refuses a body whose MD5 does not match), returning the response ETag.
  const put = async (key, body, { md5, type = CONTENT_TYPE } = {}) => {
    const headers = { 'Content-Type': type, 'Cache-Control': CACHE_CONTROL };
    if (md5) headers['Content-MD5'] = contentMd5(md5);
    const res = await aws.fetch(`${endpoint}/${bucket}/${encodeURI(key)}`, { method: 'PUT', body, headers });
    if (!res.ok) throw new Error(`PUT ${key} -> ${res.status} ${res.statusText} ${(await res.text()).slice(0, 200)}`);
    return stripQuotes(res.headers.get('etag'));
  };

  // ListObjectsV2 -> Map<key, { size, etag }>, paginated. The listing's ETag is the audit's integrity
  // evidence (single-part PUT => ETag == body MD5); the canary verifies that premise for this bucket.
  const listRemote = async () => {
    const map = new Map();
    let token = null;
    do {
      const url = new URL(`${endpoint}/${bucket}`);
      url.searchParams.set('list-type', '2');
      url.searchParams.set('max-keys', '1000');
      if (token) url.searchParams.set('continuation-token', token);
      const res = await aws.fetch(url.toString(), { method: 'GET' });
      if (!res.ok) throw new Error(`LIST -> ${res.status} ${res.statusText} ${(await res.text()).slice(0, 200)}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const block = m[1];
        const key = (block.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1];
        const size = parseInt((block.match(/<Size>(\d+)<\/Size>/) || [])[1], 10);
        const etag = (block.match(/<ETag>([\s\S]*?)<\/ETag>/) || [])[1];
        if (key) map.set(decodeXml(key), { size, etag });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1] || null
        : null;
    } while (token);
    return map;
  };

  // ---- --check: the Phase-0 canary (ETag == MD5) + public-read ----
  if (process.argv.includes('--check')) {
    const key = '_healthcheck.txt';
    const body = Buffer.from(`ok ${new Date(0).toISOString()}`);   // fixed content -> deterministic MD5
    const md5 = createHash('md5').update(body).digest('hex');
    const putEtag = await put(key, body, { md5, type: 'text/plain' });
    console.log(`PUT ${key} OK (upload credentials work); response ETag ${putEtag === md5 ? '== MD5 (canary holds)' : `!= MD5 (${putEtag} vs ${md5}) - canary FAILS, audit must use signed-HEAD sha256`}`);
    const remote = await listRemote();
    const listed = remote.get(key);
    if (listed) console.log(`LIST ETag ${stripQuotes(listed.etag) === md5 ? '== MD5 (listing integrity evidence holds)' : `!= MD5 (${stripQuotes(listed.etag)}) - canary FAILS`}`);
    if (publicBase) {
      const r = await fetch(`${publicBase}/${key}`);
      console.log(`GET ${publicBase}/${key} -> ${r.status} ${r.ok ? '(public read works)' : '(public read FAILED - enable public access / check the domain)'}`);
    } else {
      console.log('No R2_PUBLIC_BASE_URL set - skipped the public-read check.');
    }
    return;
  }

  // ---- Manifest-driven plan / upload / audit ----
  if (!existsSync(MANIFEST_FILE)) { console.error(`No ${MANIFEST_FILE} - run the catalog update to build the art manifest first`); process.exit(1); }
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
  assertManifest(manifest, 'cdn-upload manifest');

  const dryRun = process.argv.includes('--dry-run');
  const repairConflicts = process.argv.includes('--repair-conflicts');
  const limit = arg('--limit') ? parseInt(arg('--limit'), 10) : Infinity;

  console.log('listing the bucket…');
  const remote = await listRemote();
  const plan = planUpload(manifest, remote);
  console.log(`plan: ${plan.put.length} to upload, ${plan.skip.length} already valid, ${plan.conflicts.length} conflicting (of ${Object.keys(manifest.objects).length} objects)`);

  if (plan.conflicts.length && !repairConflicts) {
    for (const { entry, remote: r } of plan.conflicts.slice(0, 20)) {
      console.error(`  CONFLICT ${entry.key}: expected ${entry.bytes}B/${entry.md5}, found ${r.size}B/${stripQuotes(r.etag)}`);
    }
    console.error(`\n${plan.conflicts.length} conflicting object(s). Rerun with --repair-conflicts to allocate new repair keys (never overwrites).`);
    process.exit(1);
  }

  const stageBytes = async (entry) => {
    const p = path.join(STAGE_DIR, entry.key);
    if (!existsSync(p)) throw new Error(`staged bytes for ${entry.key} not found under ${STAGE_DIR} (run the catalog update to populate it)`);
    return readFile(p);
  };

  if (dryRun) { console.log('dry run: nothing uploaded.'); return; }

  // Upload the missing objects, bounded concurrency, each with its Content-MD5.
  const todo = plan.put.slice(0, limit === Infinity ? plan.put.length : limit);
  const started = Date.now();
  let done = 0, failed = 0, cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const entry = todo[cursor++];
      try { await put(entry.key, await stageBytes(entry), { md5: entry.md5 }); }
      catch (e) { failed++; console.error(`  ${e.message}`); }
      if (++done % 200 === 0 || done === todo.length) {
        const secs = (Date.now() - started) / 1000, rate = done / Math.max(secs, 0.001);
        console.log(`  ${done}/${todo.length} (${rate.toFixed(1)}/s, eta ${Math.round((todo.length - done) / Math.max(rate, 0.001))}s)`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  console.log(`uploaded ${done - failed}/${todo.length} · failures: ${failed}`);
  if (failed) process.exit(1);

  // Repair conflicts (never overwrites): PUT a repair key per conflict and print the repoint the
  // promote must apply to cards.json, then STOP. The manifest still names the conflicted originals
  // until the promote repoints v.image to the repair keys, so a manifest-key audit cannot pass yet -
  // that consistency is the promote's job (Phase 2), not this standalone tool's.
  if (repairConflicts && plan.conflicts.length) {
    const repoints = [];
    for (const { entry } of plan.conflicts) {
      const key = await repairKey({
        slug: entry.key.split('.')[0], sha256: entry.sha256, bytes: entry.bytes, expectedIntegrity: entry.md5,
        correctBytes: await stageBytes(entry),
        remoteLookup: async (k) => remote.get(k),
        putObject: async (k, b) => { await put(k, b, { md5: entry.md5 }); },
      });
      repoints.push([entry.key, key]);
      console.log(`  REPAIR ${entry.key} -> ${key}`);
    }
    console.log(`\n${repoints.length} repair key(s) uploaded. Repoint these in cards.json via the promote, then re-run to audit.`);
    return;
  }

  // Audit (clean path only): re-list and prove every manifest key is published with the right size +
  // ETag. Reached only when there were no conflicts, so the manifest and the remote agree by key.
  console.log('auditing…');
  const after = await listRemote();
  const audit = auditPublish(Object.values(manifest.objects).map((e) => e.key), manifest, after);
  if (!audit.ok) {
    for (const p of audit.problems.slice(0, 20)) console.error(`  AUDIT ${p}`);
    console.error(`\naudit failed: ${audit.problems.length} problem(s).`);
    process.exit(1);
  }
  console.log('audit OK: every manifest object is published with matching size and ETag.');
}

main().catch((e) => { console.error(e); process.exit(1); });
