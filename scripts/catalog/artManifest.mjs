// The content-addressed art manifest - the single source of truth for which bytes each variant
// slug publishes. Pure core over injected primitives (hashFile / convertFresh / hashBytes /
// bundledExists) so the skip predicate, the fresh-convert contract, and normalizeTransitional are
// unit-testable without sharp, crypto, or the disk.
//
// KEY (rev 4/5): `<slug>.<full-sha256-of-output-bytes>.webp`. The full 64-hex digest (not a prefix)
// because a one-entry-per-slug manifest can't collision-check a prefix and rollback needs historical
// digests; the extra ~160 KB across the corpus is noise. An incident repair of a PUBLISHED key uses
// `<slug>.<sha256>.repair-<n>.webp` (still content-addressed; a NEW url) - see cdnUpload.
//
// SKIP PREDICATE (rev 4): the manifest entry - `srcSha256` AND `recipeId` - is the ONLY skip oracle.
// A staging file carries ZERO evidentiary weight: on a predicate miss, conversion ALWAYS runs
// `convertFresh` (unique temp -> validate -> atomic replace), so a changed source can never reuse an
// old staging webp (the rev-4 stale-bytes blocker). Existence-based skipping is gone.
import { printingBase } from './curiosa.mjs';

/** The one conversion recipe. A change here forces reconversion of every entry (recipeId mismatch). */
export const TIER = Object.freeze({ width: 745, quality: 80, format: 'webp' });
export const RECIPE_ID = 'webp:w745:q80:v1';

// Fields that describe the transition off bundled art. Recomputed for EVERY entry on every build
// (rev 4 minor), so Phase 5 - an empty bundled dir - mechanically strips them with no manual sweep.
const TRANSITIONAL = ['legacyKey'];

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

/** The content-addressed object key for a slug + output digest. */
export const artKey = (slug, sha256) => `${slug}.${sha256}.webp`;

/**
 * Build the next art manifest.
 *
 * @param committed   prior manifest `{ tier, objects }` (or null on first run)
 * @param dropSlugs   Map<slug, pngPath> - finish-suffixed slugs present in the drop (reverse faces
 *                    already excluded by the caller)
 * @param deps        {
 *   hashFile(path) -> srcSha256 (hex of the source PNG),
 *   convertFresh(pngPath) -> Buffer (the 745/q80 webp bytes; NEVER existence-skips),
 *   hashBytes(buf) -> { sha256, md5 } (hex, base64),
 *   bundledExists(name) -> bool (is public/cards/<name> present),
 *   encoder -> { sharp, vips } provenance,
 * }
 * @param flags       { reconvert }  - force reconversion even when the predicate matches
 * @returns { manifest: { tier, objects }, report }
 */
export function buildArtManifest(committed, dropSlugs, deps, flags = {}) {
  const { hashFile, convertFresh, hashBytes, bundledExists, encoder } = deps;
  const prior = (committed && committed.objects) || {};
  const next = {};
  const report = { fresh: 0, kept: 0, carried: 0, total: 0 };

  // 1. Every slug with a source PNG in this drop: keep on a predicate match, else convert fresh.
  for (const [slug, pngPath] of dropSlugs) {
    const srcSha256 = hashFile(pngPath);
    const p = prior[slug];
    if (p && p.srcSha256 === srcSha256 && p.recipeId === RECIPE_ID && !flags.reconvert) {
      next[slug] = normalizeTransitional(slug, p, bundledExists);   // unchanged source + recipe
      report.kept++;
      continue;
    }
    const bytes = convertFresh(pngPath);                            // ALWAYS fresh on a miss
    const { sha256, md5 } = hashBytes(bytes);
    next[slug] = normalizeTransitional(slug, {
      key: artKey(slug, sha256), sha256, md5, bytes: bytes.length, srcSha256,
      recipeId: RECIPE_ID, encoder: { ...encoder },
    }, bundledExists);
    report.fresh++;
  }

  // 2. Slugs with a committed entry but NO source PNG this drop (incremental drop): carry them,
  //    re-normalizing transitional fields. The object already exists remotely (proven by the audit).
  for (const [slug, entry] of Object.entries(prior)) {
    if (dropSlugs.has(slug) || next[slug]) continue;
    next[slug] = normalizeTransitional(slug, entry, bundledExists);
    report.carried++;
  }

  report.total = Object.keys(next).length;
  const objects = {};
  for (const slug of Object.keys(next).sort()) objects[slug] = next[slug];
  return { manifest: { tier: TIER, objects }, report };
}

/** Validate a manifest's shape: every key is `<slug>.<64hex>.webp` (or a `.repair-<n>` incident),
 *  and the digest in the key matches the entry's `sha256`. Catches hand-edits + bad incident keys. */
export function assertManifestShape(manifest) {
  const KEY_RE = /^(.+)\.([0-9a-f]{64})(?:\.repair-\d+)?\.webp$/;
  for (const [slug, e] of Object.entries(manifest.objects || {})) {
    const m = String(e.key).match(KEY_RE);
    if (!m) throw new Error(`artManifest: malformed key for ${slug}: ${e.key}`);
    if (m[1] !== slug) throw new Error(`artManifest: key slug ${m[1]} != entry slug ${slug}`);
    if (m[2] !== e.sha256) throw new Error(`artManifest: key digest != sha256 for ${slug}`);
  }
}
