// The R2 network adapter for the pure upload/audit engine (cdnUpload.mjs). This file is the ONLY
// place that talks to R2 - SigV4 via aws4fetch, ListObjectsV2, conditional PUT, HEAD - so every
// classification and repair decision stays in the unit-tested engine. It is manifest-driven: the
// source of truth for WHAT to publish is the PROSPECTIVE manifest the catalog update writes to
// .catalog-build/art-manifest.json; the bytes come from the durable CATALOG_DROP/cdn-art staging
// (one <slug>.webp per scan, atomically written by the update).
//
// NEVER OVERWRITE (Codex Phase-1 Blocker). Every create is a CONDITIONAL PUT with If-None-Match: * -
// R2 refuses (412) if the key already exists - so a stale/incomplete listing or a racing run can
// never cause this tool to clobber an immutable object. A 412 is decided by an authoritative HEAD:
// matching bytes -> reuse, different bytes -> the canonical upload becomes a conflict and repair
// advances to the next repair-<n>. The plan listing is advisory only; the atomic claim is the truth.
//
// Credentials come from `.env.r2` (gitignored) - never args, never the repo. Objects carry a long
// immutable cache header: a content key names one exact set of bytes forever.
//
//   node scripts/catalog/cdn-upload.mjs --check                       # fail-closed ETag==MD5 + public canary
//   node scripts/catalog/cdn-upload.mjs --dry-run                     # plan only (put / valid / conflicting)
//   node scripts/catalog/cdn-upload.mjs [--manifest P] [--stage D]    # upload missing objects, then audit
//   node scripts/catalog/cdn-upload.mjs --repair-conflicts            # PUT repair keys for conflicts, print repoints
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { planUpload, repairKey, auditPublish, claimOutcome, stripQuotes } from './cdnUpload.mjs';
import { assertManifest, contentMd5 } from './artManifest.mjs';

const DEFAULT_MANIFEST = '.catalog-build/art-manifest.json';   // the PROSPECTIVE manifest from update:catalog
const DEFAULT_STAGE = 'CATALOG_DROP/cdn-art';                  // durable <slug>.webp staging
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
  const objUrl = (key) => `${endpoint}/${bucket}/${encodeURI(key)}`;

  // One PUT primitive. `ifNoneMatch:'*'` makes it a create-only conditional PUT; Content-MD5 lets R2
  // reject a corrupted body. Returns { status, ok, etag }.
  const putRequest = async (key, body, { md5, type = CONTENT_TYPE, ifNoneMatch } = {}) => {
    const headers = { 'Content-Type': type, 'Cache-Control': CACHE_CONTROL };
    if (md5) headers['Content-MD5'] = contentMd5(md5);
    if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;
    const res = await aws.fetch(objUrl(key), { method: 'PUT', body, headers });
    if (!res.ok && res.status !== 412) throw new Error(`PUT ${key} -> ${res.status} ${res.statusText} ${(await res.text()).slice(0, 200)}`);
    return { status: res.status, ok: res.ok, etag: stripQuotes(res.headers.get('etag')) };
  };

  // Authoritative HEAD for the 412 branch -> { size, etag } | null (404).
  const headObject = async (key) => {
    const res = await aws.fetch(objUrl(key), { method: 'HEAD' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HEAD ${key} -> ${res.status} ${res.statusText}`);
    return { size: Number(res.headers.get('content-length')), etag: res.headers.get('etag') };
  };

  // Atomic claim: conditional create, then classify a 412 by HEAD. Returns the engine's outcome.
  const claimObject = async (key, body, entry) => {
    const c = await putRequest(key, body, { md5: entry.md5, ifNoneMatch: '*' });
    if (c.status !== 412) return claimOutcome(true, null, entry);   // created (2xx)
    return claimOutcome(false, await headObject(key), entry);       // reused | conflict | retry
  };

  // ListObjectsV2 -> Map<key, { size, etag }>, paginated. The continuation token is XML-decoded, and a
  // truncated page without a token fails closed (a silently short listing must never look complete).
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
      const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/.test(xml);
      const raw = (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1];
      if (truncated && !raw) throw new Error('LIST: truncated page without a continuation token (listing would be incomplete)');
      token = truncated ? decodeXml(raw) : null;
    } while (token);
    return map;
  };

  // ---- --check: the Phase-0 canary, FAIL-CLOSED (throws unless every condition holds) ----
  if (process.argv.includes('--check')) {
    const key = '_healthcheck.txt';
    const body = Buffer.from('compendium r2 healthcheck v1');   // fixed content -> deterministic MD5, cache-safe
    const md5 = createHash('md5').update(body).digest('hex');
    const put = await putRequest(key, body, { md5, type: 'text/plain' });   // unconditional: a re-run must refresh
    if (!put.ok) throw new Error(`canary: PUT failed (${put.status})`);
    if (put.etag !== md5) throw new Error(`canary: PUT ETag ${put.etag} != MD5 ${md5} (audit's ETag==MD5 premise does NOT hold - switch the audit to signed-HEAD sha256 before shipping)`);
    const listed = (await listRemote()).get(key);
    if (!listed) throw new Error('canary: object absent from the listing');
    if (listed.size !== body.length || stripQuotes(listed.etag) !== md5) throw new Error(`canary: listing size/ETag mismatch (${listed.size}/${stripQuotes(listed.etag)})`);
    if (!publicBase) throw new Error('canary: R2_PUBLIC_BASE_URL is not configured (cannot verify public read)');
    const r = await fetch(`${publicBase}/${key}`);
    if (!r.ok) throw new Error(`canary: public GET ${r.status} (enable public access / check the domain)`);
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('text/plain')) throw new Error(`canary: public content-type ${ct} != text/plain`);
    const cc = r.headers.get('cache-control') || '';
    if (cc !== CACHE_CONTROL) throw new Error(`canary: public cache-control ${cc} != ${CACHE_CONTROL}`);
    if ((await r.text()) !== body.toString()) throw new Error('canary: public body mismatch');
    console.log('canary OK: PUT ETag==MD5, listing matches, public GET works, content-type + immutable cache + body all verified.');
    return;
  }

  // ---- Manifest-driven plan / upload / audit ----
  const manifestPath = arg('--manifest') || DEFAULT_MANIFEST;
  const stageDir = arg('--stage') || DEFAULT_STAGE;
  if (!existsSync(manifestPath)) { console.error(`No ${manifestPath} - run the catalog update to build the prospective manifest first`); process.exit(1); }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assertManifest(manifest, 'cdn-upload manifest');

  const dryRun = process.argv.includes('--dry-run');
  const repairConflicts = process.argv.includes('--repair-conflicts');
  const limit = arg('--limit') ? parseInt(arg('--limit'), 10) : Infinity;

  // Read staged bytes for a slug and VERIFY byte count + sha256 + md5 against the manifest immediately
  // before PUT - so a corrupted or stale staging file can never be published as if it were the object.
  const stagedBytes = (slug, entry) => {
    const p = `${stageDir}/${slug}.webp`;
    if (!existsSync(p)) throw new Error(`staged bytes for ${slug} missing at ${p} (run the catalog update)`);
    const buf = readFileSync(p);
    if (buf.length !== entry.bytes) throw new Error(`${slug}: staged ${buf.length}B != manifest ${entry.bytes}B`);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    if (sha256 !== entry.sha256) throw new Error(`${slug}: staged sha256 ${sha256} != manifest ${entry.sha256}`);
    const md5 = createHash('md5').update(buf).digest('hex');
    if (md5 !== entry.md5) throw new Error(`${slug}: staged md5 ${md5} != manifest ${entry.md5}`);
    return buf;
  };

  console.log('listing the bucket…');
  const remote = await listRemote();
  const plan = planUpload(manifest, remote);
  console.log(`plan: ${plan.put.length} to upload, ${plan.skip.length} already valid, ${plan.conflicts.length} conflicting (of ${Object.keys(manifest.objects).length} objects)`);

  if (plan.conflicts.length && !repairConflicts && !dryRun) {
    for (const { entry, remote: r } of plan.conflicts.slice(0, 20)) {
      console.error(`  CONFLICT ${entry.key}: expected ${entry.bytes}B/${entry.md5}, found ${r.size}B/${stripQuotes(r.etag)}`);
    }
    console.error(`\n${plan.conflicts.length} conflicting object(s). Rerun with --repair-conflicts to allocate new repair keys (never overwrites).`);
    process.exit(1);
  }

  if (dryRun) { console.log('dry run: nothing uploaded.'); return; }

  // Publish every object with an ATOMIC create-only claim. The plan is advisory: even a `skip`/`put`
  // entry is claimed, so a race cannot overwrite. A canonical conflict advances to a repair key.
  const slugEntries = Object.entries(manifest.objects);
  const todo = limit === Infinity ? slugEntries : slugEntries.slice(0, limit);
  const repoints = [];
  let created = 0, reused = 0, repaired = 0, failed = 0, cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const i = cursor++;
      const [slug, entry] = todo[i];
      try {
        const body = stagedBytes(slug, entry);
        let outcome = 'retry', tries = 0;
        while (outcome === 'retry') { if (++tries > 5) throw new Error(`${entry.key}: stuck on the create-then-delete race`); outcome = await claimObject(entry.key, body, entry); }
        if (outcome === 'created') created++;
        else if (outcome === 'reused') reused++;
        else {   // conflict -> repair to a new incident key (never overwrites the canonical)
          if (!repairConflicts) throw new Error(`${entry.key}: conflict found on claim; rerun with --repair-conflicts`);
          const r = await repairKey({ slug, sha256: entry.sha256, claimObject: (k) => claimObject(k, body, entry) });
          repoints.push([entry.key, r.key]); repaired++;
          console.log(`  REPAIR ${entry.key} -> ${r.key}`);
        }
      } catch (e) { failed++; console.error(`  ${e.message}`); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  console.log(`published: ${created} created, ${reused} reused, ${repaired} repaired · failures: ${failed}`);
  if (failed) process.exit(1);

  if (repoints.length) {
    console.log(`\n${repoints.length} repair key(s) uploaded. Repoint these in cards.json via the promote, then re-run to audit.`);
    console.log('(The manifest still names the conflicted originals, so the manifest-key audit is deferred to that repoint - Phase 2.)');
    return;
  }

  // Audit (clean path): re-list and prove every manifest key is published with the right size + ETag.
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
