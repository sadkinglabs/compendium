import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const required = [
  'AGENTS.md',
  'ENGINEERING_CONSTITUTION.md',
  'BUILD.md',
  'DESIGN_SYSTEM.md',
  'COMPENDIUM_ARCHITECTURE.md',
  'COMPENDIUM_DATA_MODEL.md',
  'COMPENDIUM_FEATURE_MATRIX.md',
];
const forbidden = [
  ['deleted visual mockup', /Compendium\.dc\.html/i],
  ['deleted handoff document', /COMPENDIUM_MIGRATION_HANDOFF\.md/i],
  ['former application name', /\b(?:Lexicum|Arcanum|Vitarum)\b/i],
  ['obsolete four-pillar description', /\b(?:four pillars|4-pillar)\b/i],
];
const pillars = ['Home', 'Codex', 'Collection', 'Decks', 'Play'];

// Pure and testable: check the docs under `root` and return { failures, schemaVersion }.
// Injecting `root` lets scripts/check-docs.test.mjs exercise the present/missing cases
// against a fixture directory (deterministic and cross-platform — no chmod).
export async function checkDocs(root = process.cwd()) {
  const failures = [];
  const sourceTruth = required.filter((name) => name.startsWith('COMPENDIUM_'));

  async function text(file) {
    try {
      return await readFile(path.join(root, file), 'utf8');
    } catch (error) {
      failures.push(`${file}: required file cannot be read (${error.code || error.message})`);
      return '';
    }
  }

  for (const file of required) await text(file);

  for (const file of sourceTruth) {
    const body = await text(file);
    for (const [label, pattern] of forbidden) {
      const match = body.match(pattern);
      if (match) failures.push(`${file}: contains ${label}: ${JSON.stringify(match[0])}`);
    }
  }

  for (const file of ['COMPENDIUM_ARCHITECTURE.md', 'COMPENDIUM_FEATURE_MATRIX.md']) {
    const body = await text(file);
    const missing = pillars.filter((pillar) => !new RegExp(`\\b${pillar}\\b`).test(body));
    if (missing.length) failures.push(`${file}: missing pillar names: ${missing.join(', ')}`);
  }

  const schema = await text('src/store/schema.js');
  const model = await text('COMPENDIUM_DATA_MODEL.md');
  const schemaVersion = schema.match(/export const SCHEMA_VERSION\s*=\s*(\d+)/)?.[1];
  const documentedVersion = model.match(/\*\*Schema version:\*\*\s*(\d+)/)?.[1];
  if (!schemaVersion) failures.push('src/store/schema.js: cannot find SCHEMA_VERSION');
  if (!documentedVersion) failures.push('COMPENDIUM_DATA_MODEL.md: cannot find documented schema version');
  if (schemaVersion && documentedVersion && schemaVersion !== documentedVersion) {
    failures.push(`schema version mismatch: schema.js=${schemaVersion}, data model=${documentedVersion}`);
  }

  async function markdownFiles(dir = root) {
    const found = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && ['.git', 'node_modules', 'dist', 'android', '.claude', '.venv'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...await markdownFiles(full));
      else if (entry.isFile() && entry.name.endsWith('.md')) found.push(full);
    }
    return found;
  }

  for (const file of await markdownFiles()) {
    const body = await readFile(file, 'utf8');
    const links = body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g);
    for (const match of links) {
      const raw = match[1].trim().replace(/^<|>$/g, '');
      if (!raw || /^(?:https?:|mailto:|#)/i.test(raw)) continue;
      const targetText = raw.split('#')[0];
      if (!targetText) continue;
      let target;
      try { target = path.resolve(path.dirname(file), decodeURIComponent(targetText)); }
      catch { failures.push(`${path.relative(root, file)}: invalid local link ${raw}`); continue; }
      try { if (!(await stat(target)).isFile()) failures.push(`${path.relative(root, file)}: local link is not a file: ${raw}`); }
      catch { failures.push(`${path.relative(root, file)}: broken local link: ${raw}`); }
    }
  }

  return { failures, schemaVersion };
}

// CLI entry — behaviour identical to before (runs against the repo root, exits 1 on any failure).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { failures, schemaVersion } = await checkDocs(process.cwd());
  if (failures.length) {
    console.error('Documentation checks failed:');
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log(`Documentation checks passed (${required.length} required files, schema v${schemaVersion}, five pillars).`);
}
