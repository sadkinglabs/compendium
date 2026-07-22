// The R2 upload/audit PLANNER - pure, network-free, and unit-tested. It classifies every manifest
// object against a remote listing (put / skip / conflicting), repairs a conflict WITHOUT ever
// overwriting an object, and audits that every key a promote will reference is really published with
// the right bytes. The CLI adapter (cdn-upload.mjs) supplies the network primitives - listing,
// putObject, remoteLookup - so all of the load-bearing logic here is testable with plain maps.
//
// INTEGRITY EVIDENCE. A single-part R2 PUT returns an ETag equal to the body's MD5 (hex), so the
// audit compares the listing's ETag to the manifest's hex `md5`. If the Phase-0 canary shows that
// premise does NOT hold for this bucket, the adapter instead fetches each key with a signed HEAD and
// passes the object's `x-amz-meta-sha256` as `etag` with `integrity: 'sha256'` - same classification,
// different evidence field. Either way this module compares `stripQuotes(remote.etag)` to
// `entry[integrity]`, both lowercase hex.
import { assertManifest, incidentKey } from './artManifest.mjs';

// R2/S3 wrap the ETag in quotes; the manifest stores bare lowercase hex. Normalise both ends before
// comparing. A weak-ETag `W/"..."` never applies to a single-part PUT, but strip it defensively.
export const stripQuotes = (etag) => String(etag ?? '').replace(/^W\//, '').replace(/^"+|"+$/g, '').toLowerCase();

// A remote entry matches an intended object iff BOTH the byte size and the integrity digest agree.
// Size alone is not sufficient (Codex rev-3 Major 3: a right-size wrong-bytes object must NOT skip).
const matches = (remote, bytes, digest) =>
  !!remote && remote.size === bytes && stripQuotes(remote.etag) === digest;

/**
 * Classify each manifest object against the remote listing.
 * @param manifest  { tier, objects } - the built art manifest (validated here, fail-closed)
 * @param remote    Map<key, { size, etag }> from ListObjectsV2 (or signed-HEAD evidence)
 * @param integrity manifest field to compare the remote etag against ('md5' default, 'sha256' in the
 *                  canary-failed branch)
 * @returns { put: entry[], skip: entry[], conflicts: [{ entry, remote }] }
 */
export function planUpload(manifest, remote, { integrity = 'md5' } = {}) {
  assertManifest(manifest, 'planUpload input');
  const plan = { put: [], skip: [], conflicts: [] };
  for (const entry of Object.values(manifest.objects)) {
    const r = remote.get(entry.key);
    if (!r) plan.put.push(entry);                                   // missing -> upload
    else if (matches(r, entry.bytes, entry[integrity])) plan.skip.push(entry); // valid -> skip
    else plan.conflicts.push({ entry, remote: r });                 // conflicting -> repair or refuse
  }
  return plan;
}

// A runaway guard: repair should converge in one or two incidents; a loop that never terminates means
// putObject is silently no-opping, which must fail loudly, not spin forever.
const MAX_INCIDENTS = 10000;

/**
 * Allocate a repair key for a conflicting object WITHOUT overwriting anything (rev 6). Walks
 * repair-1, repair-2, ... : the first ABSENT slot is PUT and returned; a slot that already holds the
 * exact correct bytes is REUSED (idempotent recovery from an interrupted run); a slot that is present
 * but wrong is never touched - the loop advances. Because no existing object is ever overwritten,
 * correcting a conflict ALWAYS yields a new URL, so no poisoned device/edge cache can survive.
 * @returns the repair key the catalog should repoint `v.image` to.
 */
export async function repairKey({ slug, sha256, bytes, expectedIntegrity, correctBytes, remoteLookup, putObject }) {
  for (let n = 1; n <= MAX_INCIDENTS; n++) {
    const candidate = incidentKey(slug, sha256, n);
    const r = await remoteLookup(candidate);
    if (!r) { await putObject(candidate, correctBytes); return candidate; }  // absent -> claim it
    if (matches(r, bytes, expectedIntegrity)) return candidate;              // already correct -> reuse
    // present-but-conflicting: never overwrite, advance to the next incident slot.
  }
  throw new Error(`repairKey(${slug}): did not converge within ${MAX_INCIDENTS} incidents (putObject is not persisting?)`);
}

/**
 * Audit that every key a promote will reference is really published with the right bytes. Every needed
 * key must be a manifest object key AND present remotely with matching size + integrity digest. Any
 * miss returns ok:false with a reason per problem; the caller refuses the promote. One listing, not
 * one HEAD per key.
 * @param neededKeys iterable of the distinct `v.image` keys the staged catalog references
 */
export function auditPublish(neededKeys, manifest, remote, { integrity = 'md5' } = {}) {
  assertManifest(manifest, 'auditPublish input');
  const byKey = new Map(Object.values(manifest.objects).map((e) => [e.key, e]));
  const problems = [];
  for (const key of neededKeys) {
    const entry = byKey.get(key);
    if (!entry) { problems.push(`${key}: not a manifest object key (nothing to publish it from)`); continue; }
    const r = remote.get(key);
    if (!r) { problems.push(`${key}: absent from the remote listing`); continue; }
    if (r.size !== entry.bytes) { problems.push(`${key}: remote size ${r.size} != expected ${entry.bytes}`); continue; }
    if (stripQuotes(r.etag) !== entry[integrity]) {
      problems.push(`${key}: remote etag ${stripQuotes(r.etag)} != expected ${integrity} ${entry[integrity]}`);
    }
  }
  return { ok: problems.length === 0, problems };
}
