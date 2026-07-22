#!/usr/bin/env node
// The one command a non-engineer runs to update the catalog from CATALOG_DROP.
//   npm run update:catalog                real run (fetch, build, validate, promote)
//   npm run update:catalog -- --dry-run   build + validate + report; write NOTHING
//   npm run update:catalog -- --recover   finish an interrupted promotion from staging
//
// Every stage builds into a staging tree; nothing under public/ or src/ is touched
// until the whole generation validates and the journaled promote runs. This file
// orchestrates the engines in scripts/catalog/*; each engine is unit-tested.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { discover } from './catalog/discover.mjs';
import { fetchAllCards } from './catalog/curiosa.mjs';
import { buildArtManifest, TIER } from './catalog/artManifest.mjs';
import { buildGeneration, validateGeneration } from './catalog/generation.mjs';
import { formatReport } from './catalog/report.mjs';
import { isPending, recover } from './catalog/journal.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DROP = join(ROOT, 'CATALOG_DROP');
const CATALOG = join(ROOT, 'public', 'catalog');
const CARDS_DIR = join(ROOT, 'public', 'cards');
const MANIFEST_FILE = join(CATALOG, 'art-manifest.json');   // committed content-addressed art manifest (absent on first run)
const BUILD_DIR = join(ROOT, '.catalog-build');
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
    console.error('A previous catalog promotion was interrupted. Finish it with `npm run update:catalog -- --recover`, OR restore the previous catalog with `git checkout -- public/catalog public/cards src/store/catalogVersion.json src/store/setCatalog.json` AND delete the .catalog-build directory to clear the journal (both, or the build stays blocked).');
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
  const committedManifest = existsSync(MANIFEST_FILE) ? JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) : null;
  const artDeps = {
    hashFile: async (path) => createHash('sha256').update(readFileSync(path)).digest('hex'),
    convertFresh: async (pngPath) => sharp(pngPath).resize({ width: TIER.width, withoutEnlargement: true }).webp({ quality: TIER.quality }).toBuffer(),
    hashBytes: async (buf) => ({ sha256: createHash('sha256').update(buf).digest('hex'), md5: createHash('md5').update(buf).digest('hex') }),
    bundledExists: (name) => existsSync(join(CARDS_DIR, name)),
    encoder,
  };
  const { manifest: artManifest, report: artReport } = await buildArtManifest(committedManifest, dropSlugs, artDeps, {});
  console.log(`  manifest: ${artReport.fresh} converted, ${artReport.kept} kept, ${artReport.carried} carried (${artReport.total} objects).`);

  const gen = buildGeneration({
    currentCards, currentArticles, currentFaqs, committedLinkGraph, apiCards,
    rulesCsvText: drop.rulesCsv ? readFileSync(drop.rulesCsv, 'utf8') : null,
    faqCsvText: drop.faqCsv ? readFileSync(drop.faqCsv, 'utf8') : null,
    artManifest,
  });

  const report = { ...gen.report, ok: gen.warnings.length === 0, warnings: gen.warnings };
  console.log(formatReport(report, { dryRun }));

  // The advertised "build + validate" preflight must run the SAME guards the real
  // promote does (no warnings; every card/variant image present; elements/subTypes
  // are strings; no non-avatar life) - the checks added after the two device-found
  // regressions. So validate BEFORE the dry-run returns, not only on a real run.
  validateGeneration(gen);

  if (dryRun) return;

  // ---- Phase 1 (art-cdn), dormant ----
  // The manifest is built, content-hashed, and validated, but catalog promotion and the
  // CDN upload are wired in later phases. A real run writes NOTHING to public/ or src/ yet:
  // this is the deliberate Phase-1 stopping point, not a failure. Re-enabling promotion
  // happens with the uploader/audit engine and the atomic activation (see the proposal).
  console.log('\nPhase 1 (art-cdn): manifest built and validated. Catalog promotion and CDN');
  console.log('upload are disabled until the uploader engine lands - nothing was written.');
  console.log('RESULT: OK (dormant)');
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
