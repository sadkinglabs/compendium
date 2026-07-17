#!/usr/bin/env node
// The one command a non-engineer runs to update the catalog from CATALOG_DROP.
//   npm run update:catalog                real run (fetch, build, validate, promote)
//   npm run update:catalog -- --dry-run   build + validate + report; write NOTHING
//   npm run update:catalog -- --recover   finish an interrupted promotion from staging
//
// Every stage builds into a staging tree; nothing under public/ or src/ is touched
// until the whole generation validates and the journaled promote runs. This file
// orchestrates the engines in scripts/catalog/*; each engine is unit-tested.
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { discover } from './catalog/discover.mjs';
import { fetchAllCards } from './catalog/curiosa.mjs';
import { buildGeneration, writeStagingJson, validateGeneration, serializeVersion, serializeSetCatalog } from './catalog/generation.mjs';
import { convertOne } from './catalog/images.mjs';
import { formatReport } from './catalog/report.mjs';
import { isPending, recover, promote } from './catalog/journal.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DROP = join(ROOT, 'CATALOG_DROP');
const CATALOG = join(ROOT, 'public', 'catalog');
const CARDS_DIR = join(ROOT, 'public', 'cards');
const VERSION_FILE = join(ROOT, 'src', 'store', 'catalogVersion.json');
const SET_CATALOG_FILE = join(ROOT, 'src', 'store', 'setCatalog.json');
const BUILD_DIR = join(ROOT, '.catalog-build');
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

  const gen = buildGeneration({
    currentCards, currentArticles, currentFaqs, committedLinkGraph, apiCards,
    rulesCsvText: drop.rulesCsv ? readFileSync(drop.rulesCsv, 'utf8') : null,
    faqCsvText: drop.faqCsv ? readFileSync(drop.faqCsv, 'utf8') : null,
    dropPngNames: drop.pngNames,
  });

  const report = { ...gen.report, ok: gen.warnings.length === 0, warnings: gen.warnings };
  console.log(formatReport(report, { dryRun }));

  // The advertised "build + validate" preflight must run the SAME guards the real
  // promote does (no warnings; every card/variant image present; elements/subTypes
  // are strings; no non-avatar life) - the checks added after the two device-found
  // regressions. So validate BEFORE the dry-run returns, not only on a real run.
  validateGeneration(gen);

  if (dryRun) return;

  // ---- Real promotion (staging -> journaled promote) ----
  const committedVersion = JSON.parse(readFileSync(VERSION_FILE, 'utf8'));
  if (gen.hash === committedVersion.hash) {
    console.log('\nNo changes: the catalog is already current (content hash unchanged). Nothing written.');
    return;
  }
  const nextVersion = { version: committedVersion.version + 1, hash: gen.hash };

  console.log('\nBuilding the staging generation…');
  rmSync(STAGING, { recursive: true, force: true });
  const stagingCatalog = join(STAGING, 'catalog');
  const stagingCards = join(STAGING, 'cards');
  mkdirSync(stagingCards, { recursive: true });
  writeStagingJson(gen, stagingCatalog);
  writeFileSync(join(STAGING, 'catalogVersion.json'), serializeVersion(nextVersion));
  writeFileSync(join(STAGING, 'setCatalog.json'), serializeSetCatalog(gen.setCatalog));

  // Convert every planned scan to WebP (this is where sharp runs).
  const pathByName = new Map(drop.pngPaths.map((p) => [p.replace(/^.*[\\/]/, ''), p]));
  const webps = gen.imagePlan.manifest;
  let n = 0;
  for (const webp of webps) {
    const srcName = gen.imagePlan.sources[webp];
    const srcPath = pathByName.get(srcName);
    if (!srcPath) throw new Error(`source scan ${srcName} for ${webp} not found in the drop`);
    await convertOne(srcPath, join(stagingCards, webp));
    if (++n % 200 === 0) process.stdout.write(`\r  converted ${n}/${webps.length} images…`);
  }
  process.stdout.write(`\r  converted ${webps.length}/${webps.length} images.\n`);

  // Promote under the journal: art dir FIRST (wholesale replace, dropping the old
  // alp-* files), then the catalog JSON, then the version token LAST.
  promote({
    journalPath: JOURNAL,
    hash: gen.hash,
    artDir: { from: stagingCards, to: CARDS_DIR },
    files: [
      { from: join(stagingCatalog, 'cards.json'), to: join(CATALOG, 'cards.json') },
      { from: join(stagingCatalog, 'articles_normalized.json'), to: join(CATALOG, 'articles_normalized.json') },
      { from: join(stagingCatalog, 'faqs.json'), to: join(CATALOG, 'faqs.json') },
      { from: join(stagingCatalog, 'link_graph.json'), to: join(CATALOG, 'link_graph.json') },
      { from: join(stagingCatalog, 'codex_documents.json'), to: join(CATALOG, 'codex_documents.json') },
      { from: join(STAGING, 'setCatalog.json'), to: SET_CATALOG_FILE },   // set names (data-derived), before the token
      { from: join(STAGING, 'catalogVersion.json'), to: VERSION_FILE },   // reseed trigger LAST
    ],
  });

  console.log(`\nPromoted catalog v${committedVersion.version} -> v${nextVersion.version} (${webps.length} images).`);
  console.log('Review `git diff`, add a changelog entry, bump the build on install (see BUILD.md).');
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
