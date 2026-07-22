// The content-addressed art manifest - the single source of truth for which bytes each variant
// slug publishes. Async pure core over injected primitives (hashFile / convertFresh / hashBytes /
// bundledExists) so the skip predicate, the fresh-convert contract, and normalizeTransitional are
// unit-testable without sharp, crypto, or the disk. The injected ops are AWAITED, so the production
// adapter can back convertFresh with sharp's real async API; conversion runs with bounded
// concurrency (never 3,090 serial).
//
// KEY (rev 6): `<slug>.<full-sha256-of-output-bytes>.webp`, or a repair incident key
// `<slug>.<sha256>.repair-<n>.webp` (n >= 1). Full 64-hex digest (not a prefix): a one-entry-per-slug
// manifest can't collision-check a prefix and rollback needs historical digests.
//
// SKIP PREDICATE (rev 4): the manifest entry - `srcSha256` AND `recipeId` - is the ONLY skip oracle.
// A staging file carries ZERO evidentiary weight: on a predicate miss, conversion ALWAYS runs
// `convertFresh`, so a changed source can never reuse an old staging webp (the rev-4 stale-bytes
// blocker). Existence-based skipping is gone.
//
// DIGEST ENCODINGS (rev 6, per Codex): `sha256` and `md5` are stored as lowercase HEX. R2's ETag for
// a single-part PUT is the hex MD5, so the audit compares hex to hex. The PUT `Content-MD5` header is
// base64 of the raw digest - derive it explicitly with `contentMd5(md5Hex)`, never send hex as MD5.
import { printingBase } from './curiosa.mjs';

/** The one conversion recipe. A change here forces reconversion of every entry (recipeId mismatch). */
export const TIER = Object.freeze({ width: 745, quality: 80, format: 'webp' });
export const RECIPE_ID = 'webp:w745:q80:v1';

/** The `Content-MD5` PUT header value (base64) from a lowercase-hex MD5 - the only sanctioned bridge
 *  between the manifest's hex md5 and the header R2 documents. */
export const contentMd5 = (md5Hex) => Buffer.from(md5Hex, 'hex').toString('base64');

// Fields that describe the transition off bundled art. Recomputed for EVERY entry on every build
// (rev 4 minor), so Phase 5 - an empty bundled dir - mechanically strips them with no manual sweep.
const TRANSITIONAL = ['legacyKey'];

/** The content-addressed object key for a slug + output digest. */
export const artKey = (slug, sha256) => `${slug}.${sha256}.webp`;

/** The incident (repair) key for the n-th conflict-repair of a slug+digest (n >= 1). Kept here so
 *  key construction has ONE home: the uploader's repair loop and assertManifest's KEY_RE agree by
 *  construction, never by two independently-maintained string templates. */
export const incidentKey = (slug, sha256, n) => `${slug}.${sha256}.repair-${n}.webp`;

/** The bundled printing-base filename for a slug's legacy fallback, or undefined when not bundled. */
function legacyKeyFor(slug, bundledExists) {
  const name = `${printingBase(slug)}.webp`;
  return bundledExists(name) ? name : undefined;
}

/** Recompute transition-only fields for one entry against the current bundled tree. */
export function normalizeTransitional(slug, entry, bundledExists) {
  const out = { ...entry };
  for (const f of TRANSITIONAL) delete out[f];
  const legacy = legacyKeyFor(slug, bundledExists);
  if (legacy) out.legacyKey = legacy;
  return out;
}

// Run an async fn over items with at most `n` in flight - so the production convertFresh (sharp) is
// parallel and bounded, never serial across 3,090 images.
async function mapPool(items, n, fn) {
  const iter = items[Symbol.iterator]();
  const width = Math.max(1, Math.min(n, items.length || 1));
  await Promise.all(Array.from({ length: width }, async () => {
    for (let r = iter.next(); !r.done; r = iter.next()) await fn(r.value);
  }));
}

/**
 * Build the next art manifest. ASYNC - the injected fs/conversion/hash ops are awaited.
 *
 * @param committed   prior manifest `{ tier, objects }` (or null on first run)
 * @param dropSlugs   Map<slug, pngPath> - finish-suffixed slugs in the drop (reverse faces excluded)
 * @param deps        { hashFile(path)->srcSha256(hex), convertFresh(pngPath, slug)->Buffer,
 *                      hashBytes(buf)->{sha256(hex), md5(hex)}, bundledExists(name)->bool,
 *                      encoder->{sharp,vips}, concurrency? }
 *                      convertFresh receives the slug so the adapter can durably stage the bytes.
 * @param flags       { reconvert }
 * @returns { manifest: { tier, objects }, report }
 */
export async function buildArtManifest(committed, dropSlugs, deps, flags = {}) {
  if (committed != null) assertManifest(committed, 'committed input');   // fail-closed on a bad prior
  const { hashFile, convertFresh, hashBytes, bundledExists, encoder, concurrency = 8 } = deps;
  const prior = (committed && committed.objects) || {};
  const entries = new Map();
  const report = { fresh: 0, kept: 0, carried: 0, total: 0 };

  await mapPool([...dropSlugs], concurrency, async ([slug, pngPath]) => {
    const srcSha256 = await hashFile(pngPath);
    const p = prior[slug];
    if (p && p.srcSha256 === srcSha256 && p.recipeId === RECIPE_ID && !flags.reconvert) {
      entries.set(slug, normalizeTransitional(slug, p, bundledExists));   // unchanged source + recipe
      report.kept++;
      return;
    }
    const bytes = await convertFresh(pngPath, slug);                     // ALWAYS fresh on a miss (durably staged)
    const { sha256, md5 } = await hashBytes(bytes);
    entries.set(slug, normalizeTransitional(slug, {
      key: artKey(slug, sha256), sha256, md5, bytes: bytes.length, srcSha256,
      recipeId: RECIPE_ID, encoder: { ...encoder },
    }, bundledExists));
    report.fresh++;
  });

  // Slugs with a committed entry but NO source PNG this drop (incremental drop): carry them.
  for (const [slug, entry] of Object.entries(prior)) {
    if (dropSlugs.has(slug) || entries.has(slug)) continue;
    entries.set(slug, normalizeTransitional(slug, entry, bundledExists));
    report.carried++;
  }

  report.total = entries.size;
  const objects = {};
  for (const slug of [...entries.keys()].sort()) objects[slug] = entries.get(slug);
  const manifest = { tier: { ...TIER, recipeId: RECIPE_ID }, objects };
  assertManifest(manifest, 'built manifest');                            // fail-closed on our output
  return { manifest, report };
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
// A key is `<slug>.<64hex>.webp` or `<slug>.<64hex>.repair-<n>.webp` with n >= 1 (never repair-0).
const KEY_RE = /^(.+)\.([0-9a-f]{64})(\.repair-[1-9]\d*)?\.webp$/;
const isStr = (v) => typeof v === 'string' && v.length > 0;
// The incident number a key names: 0 for the canonical `<slug>.<sha>.webp`, n for `.repair-<n>`.
const incidentNumOf = (m) => (m[3] ? parseInt(m[3].replace('.repair-', ''), 10) : 0);

/** Fail closed on any malformed manifest: tier, field types + digest FORMATS (sha256/srcSha256 64-hex,
 *  md5 32-hex), encoder provenance, key<->digest agreement, and the incident-key contract (only
 *  repair-[1-9]..., and an incident key MUST carry an incidentOf that is a real same-slug/same-digest
 *  PREDECESSOR - a lower incident number, not merely a non-empty string). Used on the committed input
 *  AND the built output. */
export function assertManifest(manifest, where = 'manifest') {
  if (!manifest || typeof manifest !== 'object' || !manifest.objects || typeof manifest.objects !== 'object') {
    throw new Error(`artManifest(${where}): missing objects map`);
  }
  const t = manifest.tier;
  if (!t || typeof t !== 'object') throw new Error(`artManifest(${where}): missing tier`);
  if (!Number.isInteger(t.width) || t.width <= 0) throw new Error(`artManifest(${where}): tier.width must be a positive integer`);
  if (!Number.isInteger(t.quality) || t.quality <= 0 || t.quality > 100) throw new Error(`artManifest(${where}): tier.quality must be 1..100`);
  if (!isStr(t.format)) throw new Error(`artManifest(${where}): tier.format must be a string`);
  if (!isStr(t.recipeId)) throw new Error(`artManifest(${where}): tier.recipeId must be a string`);
  for (const [slug, e] of Object.entries(manifest.objects)) {
    const at = `${where} ${slug}`;
    if (!e || typeof e !== 'object') throw new Error(`artManifest(${at}): entry not an object`);
    if (!isStr(e.key)) throw new Error(`artManifest(${at}): missing key`);
    if (!HEX64.test(e.sha256 || '')) throw new Error(`artManifest(${at}): sha256 must be 64 lowercase hex`);
    if (!HEX32.test(e.md5 || '')) throw new Error(`artManifest(${at}): md5 must be 32 lowercase hex (not base64)`);
    if (!Number.isInteger(e.bytes) || e.bytes <= 0) throw new Error(`artManifest(${at}): bytes must be a positive integer`);
    if (!HEX64.test(e.srcSha256 || '')) throw new Error(`artManifest(${at}): srcSha256 must be 64 lowercase hex`);
    if (!isStr(e.recipeId)) throw new Error(`artManifest(${at}): missing recipeId`);
    if (!e.encoder || typeof e.encoder !== 'object') throw new Error(`artManifest(${at}): missing encoder provenance`);
    if (!isStr(e.encoder.sharp) || !isStr(e.encoder.vips)) throw new Error(`artManifest(${at}): encoder.sharp and encoder.vips must be strings`);
    if ('legacyKey' in e && !isStr(e.legacyKey)) throw new Error(`artManifest(${at}): legacyKey must be a string`);
    const m = String(e.key).match(KEY_RE);
    if (!m) throw new Error(`artManifest(${at}): malformed key ${e.key}`);
    if (m[1] !== slug) throw new Error(`artManifest(${at}): key slug ${m[1]} != entry slug ${slug}`);
    if (m[2] !== e.sha256) throw new Error(`artManifest(${at}): key digest != sha256`);
    const isIncident = incidentNumOf(m) > 0;
    if (isIncident) {
      // incidentOf must be a REAL predecessor: a valid key, same slug + same digest, lower incident.
      const mi = isStr(e.incidentOf) ? String(e.incidentOf).match(KEY_RE) : null;
      if (!mi) throw new Error(`artManifest(${at}): incident key requires a valid incidentOf key`);
      if (mi[1] !== slug || mi[2] !== e.sha256) throw new Error(`artManifest(${at}): incidentOf must name the same slug and digest`);
      if (incidentNumOf(mi) >= incidentNumOf(m)) throw new Error(`artManifest(${at}): incidentOf must be an earlier incident (a predecessor)`);
    } else if ('incidentOf' in e) {
      throw new Error(`artManifest(${at}): non-incident key must not carry incidentOf`);
    }
  }
}

/** @deprecated name kept for callers; use assertManifest. */
export const assertManifestShape = assertManifest;
