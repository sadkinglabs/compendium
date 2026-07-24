// The R2 upload CLI - a THIN wire from credentials to the tested runner. It owns nothing but env
// loading, argument parsing, and disk reads; every request shape lives in r2Client.mjs and every
// orchestration decision in uploadRunner.mjs, both importable and unit-tested. `buildClient` is
// exported so a production-wiring test can prove the CLI constructs a client that really sends
// If-None-Match: * (no bypass), and `main` only auto-runs when invoked as the CLI.
//
// Credentials come from `.env.r2` (gitignored) - never args, never the repo.
//
//   node scripts/catalog/cdn-upload.mjs --check                       # fail-closed convergent canary
//   node scripts/catalog/cdn-upload.mjs --dry-run                     # plan only (put / valid / conflicting)
//   node scripts/catalog/cdn-upload.mjs [--manifest P] [--stage D]    # upload PENDING objects, then audit
//   node scripts/catalog/cdn-upload.mjs --repair-conflicts            # PUT repair keys for conflicts, print repoints
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { AwsClient } from 'aws4fetch';
import { createR2Client } from './r2Client.mjs';
import { runUpload, runCheck } from './uploadRunner.mjs';
import { assertManifest } from './artManifest.mjs';

const DEFAULT_MANIFEST = '.catalog-build/art-manifest.json';   // the PROSPECTIVE manifest from update:catalog
const DEFAULT_STAGE = 'CATALOG_DROP/cdn-art';                  // durable <slug>.webp staging
const CONTENT_TYPE = 'image/webp';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const CONCURRENCY = 12;

export function loadEnv(file = '.env.r2') {
  if (!existsSync(file)) throw new Error(`Missing ${file}`);
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

/**
 * Construct the SAME R2 client the CLI uses, over a caller-supplied signed/plain fetch. Exported so a
 * test can drive it with a fake fetch and assert the CLI's client really issues conditional PUTs.
 */
export function buildClient({ env, signedFetch, plainFetch }) {
  const endpoint = (env.R2_ENDPOINT || '').replace(/\/+$/, '');
  const bucket = env.R2_BUCKET;
  return createR2Client({ signedFetch, plainFetch, endpoint, bucket, cacheControl: CACHE_CONTROL, contentType: CONTENT_TYPE });
}

const arg = (argv, name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

// Read a staged scan by slug and VERIFY byte count + sha256 + md5 against the manifest immediately
// before it can be PUT - a corrupted or stale staging file can never be published as the object.
// Exported so update-catalog wires the SAME verified reader into its publish-before-promote step.
export function makeReadStaged(stageDir) {
  return (slug, entry) => {
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
}

// Strict positive-integer parse: parseInt('1.5', 10) would silently accept it as 1.
export function parseLimit(raw) {
  if (raw == null) return Infinity;
  if (!/^[1-9]\d*$/.test(String(raw))) throw new Error(`--limit must be a positive integer (got ${raw})`);
  return parseInt(raw, 10);
}

/**
 * The full CLI COMPOSITION over injected seams - the one place args, the client, manifest/staging
 * reads, and runUpload/runCheck are wired together. main() supplies the real network + disk seams; a
 * test supplies fakes and asserts an upload actually flows through runUpload and the conditional-PUT
 * client. Swapping runUpload for a bypass, or dropping the conditional header, makes that test fail.
 */
export async function runCli({ argv, env, signedFetch, plainFetch, readManifest, makeReadStaged: makeStaged, hashMd5, log = () => {} }) {
  if (!(env.R2_ENDPOINT || '').replace(/\/+$/, '')) throw new Error('.env.r2 missing R2_ENDPOINT');
  if (!env.R2_BUCKET) throw new Error('.env.r2 missing R2_BUCKET');
  const publicBase = (env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const client = buildClient({ env, signedFetch, plainFetch });

  if (argv.includes('--check')) {
    await runCheck({ client, publicBase, cacheControl: CACHE_CONTROL, hashMd5, log });
    return;
  }

  const manifestPath = arg(argv, '--manifest') || DEFAULT_MANIFEST;
  const stageDir = arg(argv, '--stage') || DEFAULT_STAGE;
  const manifest = readManifest(manifestPath);
  assertManifest(manifest, 'cdn-upload manifest');
  const limit = parseLimit(arg(argv, '--limit'));

  const res = await runUpload({
    manifest, client, readStaged: makeStaged(stageDir),
    repairConflicts: argv.includes('--repair-conflicts'), dryRun: argv.includes('--dry-run'),
    limit, concurrency: CONCURRENCY, log,
  });

  if (res.refusedConflicts) {
    for (const { entry, remote } of res.refusedConflicts.slice(0, 20)) log(`  CONFLICT ${entry.key}: expected ${entry.bytes}B/${entry.md5}, found ${remote.size}B`);
    throw new Error(`${res.refusedConflicts.length} conflicting object(s). Rerun with --repair-conflicts (never overwrites).`);
  }
  if (res.dryRun) { log('dry run: nothing uploaded.'); return; }
  log(`published: ${res.counts.created} created, ${res.counts.reused} reused, ${res.counts.repaired} repaired · failures: ${res.counts.failed}`);
  if (res.counts.failed) throw new Error('some uploads failed');
  if (res.remaining > 0) { log(`${res.remaining} object(s) still pending (--limit); re-run to continue. Whole-manifest audit deferred to the final run.`); return; }
  if (res.auditDeferred === 'repoints') {
    for (const [from, to] of res.repoints) log(`  repoint ${from} -> ${to}`);
    log('Repoint these in cards.json via the promote, then re-run to audit (Phase 2).');
    return;
  }
  if (!res.audit.ok) {
    for (const p of res.audit.problems.slice(0, 20)) log(`  AUDIT ${p}`);
    throw new Error(`audit failed: ${res.audit.problems.length} problem(s).`);
  }
  log('audit OK: every manifest object is published with matching size and ETag.');
}

// main() supplies ONLY the real dependencies; all composition lives in runCli (above).
export async function main(argv = process.argv.slice(2)) {
  const env = loadEnv();
  for (const k of ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    if (!env[k]) throw new Error(`.env.r2 missing ${k}`);
  }
  const aws = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, region: 'auto', service: 's3' });
  await runCli({
    argv, env,
    signedFetch: (url, opts) => aws.fetch(url, opts),
    plainFetch: (url) => fetch(url),
    readManifest: (p) => { if (!existsSync(p)) throw new Error(`No ${p} - run the catalog update to build the prospective manifest first`); return JSON.parse(readFileSync(p, 'utf8')); },
    makeReadStaged,
    hashMd5: (b) => createHash('md5').update(b).digest('hex'),
    log: console.log,
  });
}

// Auto-run only when invoked directly as the CLI (so the module stays importable by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
