#!/usr/bin/env node
// The one command a non-engineer runs to update the catalog from CATALOG_DROP.
//   npm run update:catalog                fetch, build, validate; convert + durably stage the CDN art
//                                         and write the prospective content-addressed manifest
//   npm run update:catalog -- --dry-run   build + validate + report; refreshes gitignored staging only
//   npm run update:catalog -- --recover   finish an interrupted promotion from staging (steady-state)
//
// ART-CDN MIGRATION (Phase 2, ACTIVE): a run converts every scan and atomically stages it to the
// gitignored CATALOG_DROP/cdn-art/<slug>.webp, writes the prospective manifest, and - when the
// content hash changed - PROMOTES a JSON-only generation: cards.json is repointed to content-
// addressed art keys, the full manifest ships, setCatalog + the version token are installed. The art
// itself lives on the CDN (published by the additive cdn-upload.mjs step), so there is NO art dir to
// promote; card art is fully CDN-served (Phase 5 removed the bundled fallback). The exact file
// plan is scripts/catalog/promotionPlan.mjs, shared with the tests. This file orchestrates the
// engines in scripts/catalog/*; each engine is unit-tested.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { discover } from './catalog/discover.mjs';
import { fetchAllCards } from './catalog/curiosa.mjs';
import { buildArtManifest, TIER } from './catalog/artManifest.mjs';
import { buildGeneration, validateGeneration, writeStagingJson, serializeVersion, serializeSetCatalog } from './catalog/generation.mjs';
import { formatReport } from './catalog/report.mjs';
import { isPending, recover, promote } from './catalog/journal.mjs';
import { productionPromotionPlan } from './catalog/promotionPlan.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DROP = join(ROOT, 'CATALOG_DROP');
const CATALOG = join(ROOT, 'public', 'catalog');
// The content-addressed art manifest, FULL (key + digests + srcSha256/recipeId/encoder).
// One file serves two readers: the pipeline's skip oracle (needs srcSha256/recipeId) and the app's
// artCache at runtime (reads only key/legacyKey/bytes, ignores the rest). Shipped to public/catalog so
// it bundles with the app. (Absent on the first activation run.)
const MANIFEST_FILE = join(CATALOG, 'art-manifest.json');
const STAGE_DIR = join(ROOT, 'CATALOG_DROP', 'cdn-art');    // durable content-tier webp staging (gitignored), one <slug>.webp per scan
const VERSION_FILE = join(ROOT, 'src', 'store', 'catalogVersion.json');
const SET_CATALOG_FILE = join(ROOT, 'src', 'store', 'setCatalog.json');
const BUILD_DIR = join(ROOT, '.catalog-build');
const BUILD_MANIFEST = join(BUILD_DIR, 'art-manifest.json'); // the prospective manifest the uploader consumes
const STAGING = join(BUILD_DIR, 'staging');
const JOURNAL = join(BUILD_DIR, 'PROMOTE.json');
const readJson = (f) => JSON.parse(readFileSync(join(CATALOG, f), 'utf8'));

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const doRecover = args.includes('--recover');

  if (doRecover) {
    const res = recover(JOURNAL);
    console.log(res.recovered ? `Recovered: promotion finished from staging (${res.phases} phase(s)).` : `Nothing to recover (${res.reason}).`);
    return;
  }
  if (isPending(JOURNAL)) {
    console.error('A previous catalog promotion was interrupted. Finish it with `npm run update:catalog -- --recover`, OR restore the previous catalog with `git checkout -- public/catalog src/store/catalogVersion.json src/store/setCatalog.json` AND delete the .catalog-build directory to clear the journal (both, or the build stays blocked).');
    process.exit(1);
  }

  console.log('Discovering the drop…');
  const drop = discover(DROP);
  console.log(`  rules CSV: ${drop.rulesCsv ? '✓' : '(absent, keeping current)'}`);
  console.log(`  FAQ CSV:   ${drop.faqCsv ? '✓' : '(absent, keeping current)'}`);
  console.log(`  images:    ${drop.pngNames.length} PNG`);

  const currentCards = readJson('cards.json');
  const currentArticles = readJson('articles_normalized.json');
  const currentFaqs = readJson('faqs.json');
  const committedLinkGraph = readJson('link_graph.json');

  console.log('Fetching cards from Curiosa…');
  const apiCards = await fetchAllCards({ onProgress: (n, p) => process.stdout.write(`\r  ${n} cards (page ${p})…`) });
  process.stdout.write('\n');

  // Content-addressed art manifest: convert + digest every finish-suffixed drop scan
  // (avatar-back reverse faces excluded) BEFORE the pure generation. Each object key is
  // `<slug>.<sha256-of-webp-bytes>.webp`, so a changed scan yields a new key and reseeds.
  // The manifest is the single source planImages reads; conversion is in-memory (Buffers),
  // so a dry run still writes nothing. The skip predicate (srcSha256 + recipeId) makes a
  // re-run with an unchanged drop cheap once a committed manifest exists.
  console.log('Building the art manifest (convert + digest)…');
  const sharp = (await import('sharp')).default;
  const encoder = { sharp: sharp.versions?.sharp ?? null, vips: sharp.versions?.vips ?? null };
  const isReverseFace = (slug) => /-(s|f)-r$/.test(slug);   // -s-r / -f-r avatar backs are never published
  const dropSlugs = new Map();
  for (const p of drop.pngPaths) {
    const slug = p.replace(/^.*[\\/]/, '').replace(/\.png$/i, '');
    if (!isReverseFace(slug)) dropSlugs.set(slug, p);
  }
  const TMP_DIR = join(STAGE_DIR, '.tmp');   // attempt-unique temps live here, never beside the published webp
  mkdirSync(STAGE_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
  let tmpSeq = 0;
  const committedManifest = existsSync(MANIFEST_FILE) ? JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) : null;
  const artDeps = {
    hashFile: async (path) => createHash('sha256').update(readFileSync(path)).digest('hex'),
    // Fresh conversion writes THROUGH an attempt-unique temp created EXCLUSIVELY (wx) under cdn-art/.tmp,
    // validates the webp decodes, then atomically replaces the durable staging file cdn-art/<slug>.webp.
    // The pid+seq name makes two concurrent update runs never share a temp, and the temp is removed in
    // `finally` on any failure - so an interrupted convert never leaves a half-written or orphaned file.
    // Also returns the buffer so the engine can digest it.
    convertFresh: async (pngPath, slug) => {
      const buf = await sharp(pngPath).resize({ width: TIER.width, withoutEnlargement: true }).webp({ quality: TIER.quality }).toBuffer();
      const meta = await sharp(buf).metadata();
      if (meta.format !== TIER.format || !meta.width) throw new Error(`convert produced an invalid ${TIER.format} for ${slug}`);
      const tmp = join(TMP_DIR, `${slug}.${process.pid}.${tmpSeq++}.tmp`);
      try {
        writeFileSync(tmp, buf, { flag: 'wx' });            // exclusive create + full-buffer write
        renameSync(tmp, join(STAGE_DIR, `${slug}.webp`));   // atomic publish of the verified bytes
      } finally {
        if (existsSync(tmp)) { try { rmSync(tmp); } catch { /* best-effort temp cleanup */ } }
      }
      return buf;
    },
    hashBytes: async (buf) => ({ sha256: createHash('sha256').update(buf).digest('hex'), md5: createHash('md5').update(buf).digest('hex') }),
    bundledExists: () => false,   // Phase 5: the bundle is gone -> legacyKey is stripped from every entry
    encoder,
  };
  const { manifest: artManifest, report: artReport } = await buildArtManifest(committedManifest, dropSlugs, artDeps, {});
  console.log(`  manifest: ${artReport.fresh} converted, ${artReport.kept} kept, ${artReport.carried} carried (${artReport.total} objects).`);

  // The PROSPECTIVE manifest the uploader consumes. Written to the gitignored build dir, never to
  // public/catalog - Phase 1 does not repoint the committed catalog.
  mkdirSync(BUILD_DIR, { recursive: true });
  writeFileSync(BUILD_MANIFEST, JSON.stringify(artManifest, null, 2) + '\n');

  const gen = buildGeneration({
    currentCards, currentArticles, currentFaqs, committedLinkGraph, apiCards,
    rulesCsvText: drop.rulesCsv ? readFileSync(drop.rulesCsv, 'utf8') : null,
    faqCsvText: drop.faqCsv ? readFileSync(drop.faqCsv, 'utf8') : null,
    artManifest,
  });

  // One combined image report: manifest conversion (fresh/kept/carried), per-finish assignment
  // (from planImages), reverse-face exclusions, and drop scans that match no catalog printing.
  const referenced = new Set();
  for (const c of Object.values(gen.cards)) for (const v of (c.variants || [])) if (artManifest.objects[v.slug]) referenced.add(v.slug);
  const images = {
    total: artReport.total, fresh: artReport.fresh, kept: artReport.kept, carried: artReport.carried,
    perFinish: gen.report.images.perFinish, sharedSibling: gen.report.images.sharedSibling, noScan: gen.report.images.noScan,
    reverseExcluded: drop.pngNames.length - dropSlugs.size,
    unmatchedScans: Object.keys(artManifest.objects).filter((s) => !referenced.has(s)),
  };
  const staging = { stageDir: relative(ROOT, STAGE_DIR), manifestPath: relative(ROOT, BUILD_MANIFEST), count: artReport.total };
  const report = { ...gen.report, images, staging, ok: gen.warnings.length === 0, warnings: gen.warnings };
  console.log(formatReport(report, { dryRun }));

  // The advertised "build + validate" preflight must run the SAME guards the real
  // promote does (no warnings; every card/variant image present; elements/subTypes
  // are strings; no non-avatar life) - the checks added after the two device-found
  // regressions. So validate BEFORE the dry-run returns, not only on a real run.
  validateGeneration(gen);

  if (dryRun) return;

  // ---- Phase 2 activation: repoint the committed catalog to content-addressed art keys and ship the
  // manifest. JSON ONLY - the art itself lives on the CDN (uploaded + audited by cdn-upload), so there
  // is NO art dir to promote; card art is fully CDN-served (Phase 5 removed the bundled fallback).
  // The version token is written LAST, so an interrupted promote is recovered, never a
  // half-repointed catalog. ----
  const committedVersion = JSON.parse(readFileSync(VERSION_FILE, 'utf8'));
  if (gen.hash === committedVersion.hash) {
    console.log('\nNo changes: the catalog content hash is unchanged. Nothing written.');
    return;
  }
  const nextVersion = { version: committedVersion.version + 1, hash: gen.hash };

  console.log('\nBuilding the staging generation…');
  rmSync(STAGING, { recursive: true, force: true });
  const stagingCatalog = join(STAGING, 'catalog');
  mkdirSync(stagingCatalog, { recursive: true });
  writeStagingJson(gen, stagingCatalog);   // cards.json (content keys) + articles/faqs/link_graph/codex
  writeFileSync(join(stagingCatalog, 'art-manifest.json'), JSON.stringify(artManifest, null, 2) + '\n');   // FULL manifest (app + next-run oracle)
  writeFileSync(join(STAGING, 'catalogVersion.json'), serializeVersion(nextVersion));
  writeFileSync(join(STAGING, 'setCatalog.json'), serializeSetCatalog(gen.setCatalog));

  const { files } = productionPromotionPlan({
    stagingCatalog, staging: STAGING, catalog: CATALOG,
    manifestFile: MANIFEST_FILE, setCatalogFile: SET_CATALOG_FILE, versionFile: VERSION_FILE,
  });
  promote({ journalPath: JOURNAL, hash: gen.hash, files });   // JSON only - no artDir (art is on the CDN)

  console.log(`\nPromoted catalog v${committedVersion.version} -> v${nextVersion.version}: repointed ${artReport.total} printings to content-addressed art keys; card art is served fully from the CDN (no bundled fallback).`);
  console.log('Review `git diff`, add a changelog entry, and bump the build on install (see BUILD.md).');
  console.log('RESULT: OK');
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  if (e.firstDiff != null) {
    console.error('  first diff at', e.firstDiff);
    console.error('  regen    :', JSON.stringify(e.regen));
    console.error('  committed:', JSON.stringify(e.committed));
  }
  process.exit(1);
});
