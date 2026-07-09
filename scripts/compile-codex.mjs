#!/usr/bin/env node
// CLI: compile the raw catalog into the structured Codex document model.
//   npm run compile:codex          - build public/catalog/codex_documents.json
//   npm run compile:codex -- --check  - fail if the committed output is stale
// Deterministic output, committed to the repo so structural diffs are reviewable.
// This is a BUILD tool - it never runs in the app or on device.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compileCorpus } from './codex/compile.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'public', 'catalog');
const OUT = join(CATALOG, 'codex_documents.json');

const readJson = async (f) => JSON.parse(await readFile(join(CATALOG, f), 'utf8'));

async function main() {
  const check = process.argv.includes('--check');
  const [articles, cardsObj, faqsObj] = await Promise.all([readJson('articles_normalized.json'), readJson('cards.json'), readJson('faqs.json')]);
  const cards = Array.isArray(cardsObj) ? cardsObj : Object.values(cardsObj);
  const faqs = Array.isArray(faqsObj) ? faqsObj : Object.values(faqsObj);

  const { report, ...output } = compileCorpus({ articles, cards, faqs });
  const json = JSON.stringify(output, null, 0) + '\n';

  console.log(`Codex compile: ${report.docs} docs, ${report.blocks} blocks, ${report.faqs} faqs`);
  console.log('  block types:', JSON.stringify(report.byType));
  console.log(`  links: ${report.cardLinks} card [[..]], ${report.ruleLinks} rule ((..))+keyword (incl. ${report.mistakes} recovered reversed-paren mistakes)`);
  console.log(`  buildHash: ${output.buildHash}`);
  if (report.issues.length) {
    console.error(`  ${report.issues.length} INVARIANT ISSUE(S):`);
    for (const i of report.issues.slice(0, 40)) console.error('   - ' + i);
    process.exitCode = 1;
    return;
  }
  console.log('  invariants: OK (no dropped content, no overlaps, no dup ids)');

  if (check) {
    let existing = '';
    try { existing = await readFile(OUT, 'utf8'); } catch { /* missing */ }
    if (existing !== json) {
      console.error('STALE: codex_documents.json differs from sources. Run `npm run compile:codex` and commit.');
      process.exitCode = 1;
    } else {
      console.log('  --check: committed output is up to date');
    }
    return;
  }

  await writeFile(OUT, json);
  console.log(`  wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
