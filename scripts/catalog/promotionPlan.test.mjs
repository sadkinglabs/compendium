import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { productionPromotionPlan, CATALOG_JSON } from './promotionPlan.mjs';
import { promote, recover, isPending } from './journal.mjs';

const paths = () => ({
  stagingCatalog: '/s/catalog',
  staging: '/s',
  catalog: '/pub/catalog',
  manifestFile: '/pub/catalog/art-manifest.json',
  setCatalogFile: '/src/store/setCatalog.json',
  versionFile: '/src/store/catalogVersion.json',
});

// --- Pure shape: the contract Codex requires, asserted without touching disk --------------------

test('the plan promotes cards, manifest and setCatalog, and has NO retired artDir', () => {
  const plan = productionPromotionPlan(paths());
  assert.equal(plan.artDir, undefined, 'Phase 2 promotes JSON only - no art directory');
  const tos = plan.files.map((f) => basename(f.to));
  assert.ok(tos.includes('cards.json'));
  assert.ok(tos.includes('art-manifest.json'));
  assert.ok(tos.includes('setCatalog.json'));
});

test('catalogVersion.json is ALWAYS the last file promoted (the reseed trigger)', () => {
  const plan = productionPromotionPlan(paths());
  const last = plan.files[plan.files.length - 1];
  assert.equal(basename(last.to), 'catalogVersion.json');
  // ...and it appears exactly once, so nothing can promote after it.
  assert.equal(plan.files.filter((f) => basename(f.to) === 'catalogVersion.json').length, 1);
});

test('every staged catalog JSON lands in the committed catalog dir', () => {
  const plan = productionPromotionPlan(paths());
  for (const name of CATALOG_JSON) {
    const entry = plan.files.find((f) => f.to === join('/pub/catalog', name));
    assert.ok(entry, `${name} promoted to public/catalog`);
    assert.equal(entry.from, join('/s/catalog', name));
  }
});

// --- FS round-trip: interrupt BEFORE the version token, then recover ----------------------------

function stageAll(dir) {
  const stagingCatalog = join(dir, 'staging', 'catalog');
  const staging = join(dir, 'staging');
  mkdirSync(stagingCatalog, { recursive: true });
  for (const name of CATALOG_JSON) writeFileSync(join(stagingCatalog, name), `NEW:${name}`);
  writeFileSync(join(stagingCatalog, 'art-manifest.json'), 'NEW:manifest');
  writeFileSync(join(staging, 'setCatalog.json'), 'NEW:setCatalog');
  writeFileSync(join(staging, 'catalogVersion.json'), JSON.stringify({ version: 7, hash: 'newhash' }));
  return { stagingCatalog, staging };
}

test('an interrupt before the version token leaves the OLD version, and recover() completes it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'promo-plan-'));
  const { stagingCatalog, staging } = stageAll(dir);
  const out = join(dir, 'out');
  const catalog = join(out, 'public', 'catalog');
  const versionFile = join(out, 'src', 'store', 'catalogVersion.json');
  mkdirSync(join(out, 'src', 'store'), { recursive: true });
  writeFileSync(versionFile, JSON.stringify({ version: 6, hash: 'oldhash' }));   // committed version in force

  const { files } = productionPromotionPlan({
    stagingCatalog, staging, catalog,
    manifestFile: join(catalog, 'art-manifest.json'),
    setCatalogFile: join(out, 'src', 'store', 'setCatalog.json'),
    versionFile,
  });
  const journalPath = join(dir, 'PROMOTE.json');

  // Fail on the LAST phase - the version token - so the catalog is repointed but the version is not.
  assert.throws(() => promote({ journalPath, hash: 'newhash', files }, { failAfter: files.length - 1 }));
  assert.equal(JSON.parse(readFileSync(versionFile, 'utf8')).version, 6, 'old version still in force');
  assert.ok(existsSync(join(catalog, 'cards.json')), 'earlier phases DID apply (half-promoted)');
  assert.ok(isPending(journalPath), 'a pending promotion is recorded');

  const res = recover(journalPath);
  assert.ok(res.recovered);
  assert.equal(JSON.parse(readFileSync(versionFile, 'utf8')).version, 7, 'recover installs the new version last');
  assert.ok(!isPending(journalPath), 'journal cleared after recovery');
  rmSync(dir, { recursive: true, force: true });
});
