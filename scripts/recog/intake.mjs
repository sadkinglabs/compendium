#!/usr/bin/env node
// Gate-0 governed intake for the card recogniser.
// Spec: docs/proposals/card-recogniser-gate0-plan.md (§2 contract, §3 governance).
//
// Offline, no model, no cards. Validates tester submissions against the intake contract, strips EXIF,
// hashes the normalised bytes, assigns an IMMUTABLE split (isolated by session+device), files the image
// into the private governed store, and appends to the committed manifest. Fails closed per image.
//
// Private images live in recog-data/ (gitignored). The committed authority is data/recog/manifest.json:
// metadata only, no image bytes, no raw PII (contributor is hashed).
//
//   node scripts/recog/intake.mjs        # ingest everything under recog-data/inbox/
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// --- intake contract constants (gate0-plan §2/§3) ---
export const FORMATS = new Set(['jpeg', 'png', 'webp']);
export const MIN_SHORT_PX = 800;
export const DECODE_PIXEL_LIMIT = 100_000_000; // decode ceiling - covers 50MP+ phone sensors; guards OOM
export const STORE_LONG_PX = 3000;             // normalise the stored long side (ample for recognition + OCR)
export const MAX_BYTES = 40 * 1024 * 1024;
export const MEDIA = new Set(['physical', 'screen']);
export const SEALED_PCT = 30;                  // % of physical sessions held sealed
const TAG_RE = /^(foil|nonfoil|sleeve:(none|matte|glossy)|angle:(flat|10-25deg|>25deg)|light:(normal|dim|glare)|blur:(y|n)|class:(spell|site)|edge:(left|right))$/;

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const short8 = (s) => sha(Buffer.from(String(s))).slice(0, 8);

// Deterministic, immutable split. A shoot (session+device) is atomic, so all its images share a split;
// only PHYSICAL is eligible for the sealed set (screens are dev-only, excluded from gating evidence).
export function splitFor(sessionId, device, medium) {
  if (medium !== 'physical') return 'dev';
  const bucket = parseInt(sha(Buffer.from(`${sessionId}|${device}`)).slice(0, 8), 16) % 100;
  return bucket < SEALED_PCT ? 'sealed' : 'calibration';
}

async function processImage(subDir, img, meta, seen, store) {
  const reasons = [];
  const src = join(subDir, img.file);
  if (!existsSync(src)) return { reject: [`missing file: ${img.file}`] };
  if (!img.card || typeof img.card !== 'string') reasons.push('missing card identity');
  if (!MEDIA.has(img.medium)) reasons.push(`bad medium: ${img.medium}`);
  for (const t of img.tags || []) if (!TAG_RE.test(t)) reasons.push(`bad tag: ${t}`);
  if (statSync(src).size > MAX_BYTES) reasons.push(`too large: ${statSync(src).size} bytes`);

  let normalized, info, meta2;
  try {
    meta2 = await sharp(src, { limitInputPixels: DECODE_PIXEL_LIMIT }).metadata();
    if (!FORMATS.has(meta2.format)) reasons.push(`bad format: ${meta2.format}`);
    if (Math.min(meta2.width, meta2.height) < MIN_SHORT_PX) reasons.push(`too small: ${meta2.width}x${meta2.height}`);
    // Re-encode WITHOUT metadata (sharp drops EXIF unless withMetadata() is called), bake orientation,
    // and cap the long side so 50MP phone shots normalise to a consistent working resolution.
    ({ data: normalized, info } = await sharp(src, { limitInputPixels: DECODE_PIXEL_LIMIT })
      .rotate()
      .resize(STORE_LONG_PX, STORE_LONG_PX, { fit: 'inside', withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true }));
  } catch (e) {
    reasons.push(`decode failed: ${e.message}`);
  }
  if (reasons.length) return { reject: reasons };

  const imageId = sha(normalized);
  if (seen.has(imageId)) return { skip: imageId };            // idempotent dedupe
  const ext = meta2.format === 'jpeg' ? 'jpg' : meta2.format;
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, `${imageId}.${ext}`), normalized);

  return {
    row: {
      imageId, sha256: imageId, width: info.width, height: info.height, bytes: normalized.length,
      medium: img.medium, tags: img.tags || [], card: img.card,
      sessionId: meta.sessionId, device: meta.device,
      contributorId: `c-${short8(meta.contributor)}`,       // hashed - no raw PII in the manifest
      consent: meta.consent, consentRef: `k-${short8(`${meta.sessionId}|${meta.contributor}|${meta.consent}`)}`,
      split: splitFor(meta.sessionId, meta.device, img.medium),
    },
  };
}

/** Ingest every submission folder under `inbox` into `store` + `manifestPath`. Paths are injected so
 *  the tool is testable. Returns a summary; writes the manifest (creating parents). Fail-closed. */
export async function runIntake({ inbox, store, manifestPath }) {
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { version: 1, rows: [] };
  const seen = new Set(manifest.rows.map((r) => r.imageId));
  const accepted = [], rejected = [], skipped = [];

  if (existsSync(inbox)) {
    for (const sub of readdirSync(inbox)) {
      const subDir = join(inbox, sub);
      if (!statSync(subDir).isDirectory()) continue;
      const metaPath = join(subDir, 'meta.json');
      if (!existsSync(metaPath)) { rejected.push([sub, 'no meta.json']); continue; }
      let meta;
      try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); }
      catch (e) { rejected.push([sub, `meta.json parse: ${e.message}`]); continue; }

      const bad = [];
      if (!meta.sessionId) bad.push('sessionId');
      if (!meta.device) bad.push('device');
      if (!meta.contributor) bad.push('contributor');
      if (meta.consent !== 'evaluate-and-train') bad.push('consent (must be "evaluate-and-train")');
      if (!Array.isArray(meta.images)) bad.push('images[]');
      if (bad.length) { rejected.push([sub, `meta missing/invalid: ${bad.join(', ')}`]); continue; }

      for (const img of meta.images) {
        const r = await processImage(subDir, img, meta, seen, store);
        if (r.reject) rejected.push([`${sub}/${img.file}`, r.reject.join('; ')]);
        else if (r.skip) skipped.push(r.skip);
        else { manifest.rows.push(r.row); seen.add(r.row.imageId); accepted.push(r.row); }
      }
    }
  }

  mkdirSync(resolve(manifestPath, '..'), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const counts = {};
  for (const r of manifest.rows) counts[r.split] = (counts[r.split] || 0) + 1;
  return { accepted: accepted.length, skipped: skipped.length, rejected, counts, total: manifest.rows.length };
}

// --- CLI (default repo paths) ---
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = resolve(process.cwd());
  runIntake({
    inbox: join(ROOT, 'recog-data', 'inbox'),
    store: join(ROOT, 'recog-data', 'store'),
    manifestPath: join(ROOT, 'data', 'recog', 'manifest.json'),
  }).then((r) => {
    console.log(`intake: ${r.accepted} accepted, ${r.skipped} deduped, ${r.rejected.length} rejected`);
    for (const [w, why] of r.rejected) console.log(`  REJECT ${w}: ${why}`);
    console.log(`manifest total ${r.total}:`, r.counts);
  }).catch((e) => { console.error(e); process.exit(1); });
}
