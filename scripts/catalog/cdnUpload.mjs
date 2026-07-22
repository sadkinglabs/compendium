// The R2 upload/audit PLANNER - pure, network-free, and unit-tested. It classifies every manifest
// object against a remote listing (put / skip / conflicting), repairs a conflict WITHOUT ever
// overwriting an object (via an ATOMIC claim seam), and audits that every key a promote will
// reference is really published with the right bytes. The CLI adapter (cdn-upload.mjs) supplies the
// network primitives - listing, the conditional create, HEAD - so all of the load-bearing logic here
// is testable with plain maps.
//
// INTEGRITY EVIDENCE. A single-part R2 PUT returns an ETag equal to the body's MD5 (hex), so the
// audit compares the listing's ETag to the manifest's hex `md5` (the default `integrity: 'md5'`). The
// `integrity` parameter also accepts 'sha256' so that, SHOULD the Phase-0 canary ever show ETag != MD5
// for this bucket, the adapter can switch to signed-HEAD evidence (`x-amz-meta-sha256`) without a
// logic change here. The current adapter uses the md5/ETag path only; it does not silently fall back.
// Either way this module compares `stripQuotes(remote.etag)` to `entry[integrity]`, both lowercase hex.
import { assertManifest, incidentKey } from './artManifest.mjs';

// R2/S3 wrap the ETag in quotes; the manifest stores bare lowercase hex. Normalise both ends before
// comparing. A weak-ETag `W/"..."` never applies to a single-part PUT, but strip it defensively.
export const stripQuotes = (etag) => String(etag ?? '').replace(/^W\//, '').replace(/^"+|"+$/g, '').toLowerCase();

// A remote entry matches an intended object iff BOTH the byte size and the integrity digest agree.
// Size alone is not sufficient (Codex rev-3 Major 3: a right-size wrong-bytes object must NOT skip).
export const remoteMatches = (remote, bytes, digest) =>
  !!remote && remote.size === bytes && stripQuotes(remote.etag) === digest;
const matches = remoteMatches;

/**
 * Classify the result of an atomic create-only claim. `create` is the response of a conditional
 * PUT (If-None-Match: *); `head` is an authoritative HEAD taken ONLY when the create was refused
 * (412). Never trusts a prior listing - the create either wins the race (created) or the HEAD decides
 * whether the existing bytes are already ours (reused) or someone else's (conflict). A vanished object
 * (create refused, HEAD 404) is a lost race the caller must re-attempt, signalled as 'retry'.
 * @param created  boolean - did the conditional PUT create the object?
 * @param head     { size, etag } | null - the HEAD taken on a 412 (null if the object vanished)
 */
export function claimOutcome(created, head, entry, { integrity = 'md5' } = {}) {
  if (created) return 'created';
  if (!head) return 'retry';                                  // created-then-deleted race: re-attempt
  return matches(head, entry.bytes, entry[integrity]) ? 'reused' : 'conflict';
}

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
// claimObject keeps reporting conflict/retry forever, which must fail loudly, not spin.
const MAX_INCIDENTS = 10000;

/**
 * Allocate a repair key for a conflicting object WITHOUT overwriting anything (rev 6), where creation
 * is ATOMIC. `claimObject(candidate)` performs a conditional create (If-None-Match: *) and returns
 * one of 'created' | 'reused' | 'conflict' | 'retry' - it NEVER trusts a prior listing, so a stale or
 * incomplete listing, or another run creating the key between plan and PUT, cannot cause an overwrite
 * (Codex Phase-1 Blocker). Walks repair-1, repair-2, ...: 'created'/'reused' returns that key;
 * 'conflict' advances (never overwrites); 'retry' re-attempts the SAME slot (a created-then-deleted
 * race). Because no existing object is ever overwritten, correcting a conflict ALWAYS yields a new
 * URL, so no poisoned device/edge cache can survive.
 * @param claimObject async (key) -> 'created' | 'reused' | 'conflict' | 'retry'
 * @returns { key, outcome } - the repair key the catalog should repoint `v.image` to.
 */
export async function repairKey({ slug, sha256, claimObject }) {
  let attempts = 0;
  for (let n = 1; n <= MAX_INCIDENTS; ) {
    if (++attempts > MAX_INCIDENTS * 2) throw new Error(`repairKey(${slug}): too many claim attempts (a claimObject stuck on 'retry'?)`);
    const candidate = incidentKey(slug, sha256, n);
    const outcome = await claimObject(candidate);
    if (outcome === 'created' || outcome === 'reused') return { key: candidate, outcome };
    if (outcome === 'retry') continue;                       // same slot vanished mid-race: re-attempt n
    if (outcome !== 'conflict') throw new Error(`repairKey(${slug}): unknown claim outcome ${outcome}`);
    n++;                                                     // present-but-conflicting: advance the slot
  }
  throw new Error(`repairKey(${slug}): did not converge within ${MAX_INCIDENTS} incidents`);
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
