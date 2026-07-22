// The upload/canary ORCHESTRATION, extracted out of the CLI so it is importable and driven by tests
// with an injected R2 client + staged-byte reader. This is where the plan is EXECUTED (only put rows,
// plus conflict rows when repairing) - never touching valid skips - and where the atomic claim /
// repair / audit sequence lives. Because the client is injected, a test proves the real request order
// (conditional PUT, 412 -> HEAD, retry on 412 -> 404) and that a dry run mutates nothing.
import { planUpload, repairKey, auditPublish, claimOutcome, stripQuotes } from './cdnUpload.mjs';
import { assertManifest } from './artManifest.mjs';

/** Build the atomic claim from an R2 client: conditional create, then classify a 412 by HEAD. */
export function makeClaim(client) {
  return async (key, body, entry) => {
    const c = await client.putRequest(key, body, { md5: entry.md5, ifNoneMatch: '*' });
    if (c.status !== 412) return claimOutcome(true, null, entry);   // created (2xx)
    return claimOutcome(false, await client.headObject(key), entry); // reused | conflict | retry
  };
}

async function claimWithRetry(claim, key, body, entry) {
  let outcome = 'retry';
  for (let tries = 0; outcome === 'retry'; tries++) {
    if (tries > 5) throw new Error(`${key}: stuck on the create-then-delete race`);
    outcome = await claim(key, body, entry);
  }
  return outcome;
}

/** True when `limit` is a usable positive-integer cap; Infinity means "no limit". */
export function validLimit(limit) {
  return limit === Infinity || (Number.isInteger(limit) && limit > 0);
}

/**
 * Upload the objects a plan says are PENDING, then (on full coverage) audit the whole manifest.
 * @param manifest        the prospective art manifest
 * @param client          createR2Client(...) - injected so tests assert the real request sequence
 * @param readStaged      (slug, entry) -> Buffer  (reads + byte/digest-verifies; called ONLY for pending rows)
 * @param repairConflicts allocate repair keys for conflicts instead of refusing
 * @param dryRun          plan only - NOTHING is PUT or HEADed
 * @param limit           cap on PENDING writes (not manifest order); Infinity for all
 */
export async function runUpload({ manifest, client, readStaged, repairConflicts = false, dryRun = false, limit = Infinity, concurrency = 12, log = () => {} }) {
  assertManifest(manifest, 'runUpload manifest');
  if (!validLimit(limit)) throw new Error(`runUpload: --limit must be a positive integer (got ${limit})`);
  const remote = await client.list();
  const plan = planUpload(manifest, remote);
  log(`plan: ${plan.put.length} to upload, ${plan.skip.length} already valid, ${plan.conflicts.length} conflicting (of ${Object.keys(manifest.objects).length} objects)`);

  // A finite --limit cannot coexist with conflict repair: a limited batch could create repair-1 for
  // one conflict but never surface (or record) its repoint, so every rerun re-selects the same conflict
  // and the second never converges - an orphaned repair object and a non-converging command. Refuse
  // BEFORE any staging read or PUT; repoints must be produced as one complete set (Codex).
  if (repairConflicts && Number.isFinite(limit) && plan.conflicts.length) {
    throw new Error('--limit cannot be combined with --repair-conflicts when there are conflicts; repair repoints must be produced as one complete set');
  }

  if (plan.conflicts.length && !repairConflicts && !dryRun) return { ok: false, refusedConflicts: plan.conflicts, plan };
  if (dryRun) return { ok: true, dryRun: true, plan };   // a dry run issues ZERO mutations

  const claim = makeClaim(client);
  // Pending = put rows (always) + conflict rows (only when repairing). The limit caps PENDING work, so
  // repeated limited runs advance instead of re-slicing the same manifest prefix forever.
  const pending = [
    ...plan.put.map((r) => ({ ...r, isConflict: false })),
    ...(repairConflicts ? plan.conflicts.map((r) => ({ ...r, isConflict: true })) : []),
  ];
  const todo = Number.isFinite(limit) ? pending.slice(0, limit) : pending;

  const repoints = [];
  const counts = { created: 0, reused: 0, repaired: 0, failed: 0 };
  let cursor = 0;
  const repair = async (row, body) => {
    const r = await repairKey({ slug: row.slug, sha256: row.entry.sha256, claimObject: (k) => claim(k, body, row.entry) });
    repoints.push([row.entry.key, r.key]); counts.repaired++;
    log(`  REPAIR ${row.entry.key} -> ${r.key}`);
  };
  const worker = async () => {
    while (cursor < todo.length) {
      const row = todo[cursor++];
      try {
        const body = readStaged(row.slug, row.entry);   // reads + verifies; ONLY for pending rows, never skips
        if (row.isConflict) { await repair(row, body); continue; }
        const outcome = await claimWithRetry(claim, row.entry.key, body, row.entry);
        if (outcome === 'created') counts.created++;
        else if (outcome === 'reused') counts.reused++;
        else if (repairConflicts) await repair(row, body);   // conflict on a put row
        else throw new Error(`${row.entry.key}: conflict found on claim; rerun with --repair-conflicts`);
      } catch (e) { counts.failed++; log(`  ${e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, todo.length || 1)) }, worker));

  const remaining = pending.length - todo.length;
  if (counts.failed) return { ok: false, counts, repoints, remaining };
  if (repoints.length) return { ok: true, counts, repoints, remaining, auditDeferred: 'repoints' };   // manifest not yet repointed
  if (remaining > 0) return { ok: true, counts, repoints, remaining, auditDeferred: 'limit' };         // partial batch; audit on the final run

  // Full coverage: audit the ENTIRE manifest (a limited run that happened to cover everything lands here too).
  const after = await client.list();
  const audit = auditPublish(Object.values(manifest.objects).map((e) => e.key), manifest, after);
  return { ok: audit.ok, counts, repoints, remaining, audit };
}

/**
 * The Phase-0 canary, fail-closed AND convergent: establish the healthcheck object, then attempt a
 * DIFFERENT body at the same key with If-None-Match: * - it MUST 412 and the original MUST survive,
 * proving R2 actually enforces overwrite protection (not just that our code sends the header).
 * @param hashMd5 (Buffer) -> hex md5
 */
export async function runCheck({ client, publicBase, cacheControl, hashMd5, log = () => {} }) {
  const key = '_healthcheck.txt';
  const body = Buffer.from('compendium r2 healthcheck v1');   // fixed content -> deterministic MD5, cache-safe
  const md5 = hashMd5(body);
  const put = await client.putRequest(key, body, { md5, type: 'text/plain' });   // unconditional: a re-run refreshes
  if (!put.ok) throw new Error(`canary: PUT failed (${put.status})`);
  if (put.etag !== md5) throw new Error(`canary: PUT ETag ${put.etag} != MD5 ${md5} (ETag==MD5 premise fails - switch the audit to signed-HEAD sha256 before shipping)`);

  const probe = Buffer.from('DIFFERENT BYTES - MUST NOT LAND');
  const cond = await client.putRequest(key, probe, { md5: hashMd5(probe), type: 'text/plain', ifNoneMatch: '*' });
  if (cond.status !== 412) throw new Error(`canary: conditional PUT returned ${cond.status}, not 412 - If-None-Match is NOT enforced, overwrite protection is OFF`);
  const head = await client.headObject(key);
  if (!head || head.size !== body.length || stripQuotes(head.etag) !== md5) throw new Error('canary: the original object did not survive the conditional probe');

  const listed = (await client.list()).get(key);
  if (!listed) throw new Error('canary: object absent from the listing');
  if (listed.size !== body.length || stripQuotes(listed.etag) !== md5) throw new Error(`canary: listing size/ETag mismatch (${listed.size}/${stripQuotes(listed.etag)})`);
  if (!publicBase) throw new Error('canary: R2_PUBLIC_BASE_URL not configured (cannot verify public read)');
  const r = await client.publicGet(`${publicBase}/${key}`);
  if (!r.ok) throw new Error(`canary: public GET ${r.status} (enable public access / check the domain)`);
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('text/plain')) throw new Error(`canary: public content-type ${ct} != text/plain`);
  const cc = r.headers.get('cache-control') || '';
  if (cc !== cacheControl) throw new Error(`canary: public cache-control ${cc} != ${cacheControl}`);
  if ((await r.text()) !== body.toString()) throw new Error('canary: public body mismatch');
  log('canary OK: PUT ETag==MD5, a conflicting conditional PUT 412s and the original survives, listing matches, public GET + content-type + immutable cache + body all verified.');
  return { ok: true };
}
