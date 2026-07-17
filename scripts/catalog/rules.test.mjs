import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { compileRules } from './rules.mjs';
import { discover } from './discover.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readCat = (f) => JSON.parse(readFileSync(join(ROOT, 'public', 'catalog', f), 'utf8'));

const FIXTURE = 'title,content,subcodexes\r\n' +
  '"Alpha","Body of alpha.",""\r\n' +
  '"","","Do Something:  the sub body here"\r\n' +
  '"Beta","Body of beta.",""\r\n';

test('titled rows are articles; blank-title rows append a sub-entry split on the first colon', () => {
  const { articles } = compileRules(FIXTURE, []);
  assert.equal(articles.length, 2);
  assert.equal(articles[0].title, 'Alpha');
  assert.deepEqual(articles[0].subentries, [{ id: 'alpha__do-something', label: 'Do Something', content: 'the sub body here' }]);
  assert.equal(articles[1].subentries.length, 0);
});

test('existing titles/labels reuse their committed ids; new ones get fresh slugs', () => {
  const current = [{ id: 'legacy-id-kept', title: 'Alpha', content: 'old', subentries: [{ id: 'legacy-id-kept__old-sub', label: 'Do Something', content: 'x' }] }];
  const { articles, report } = compileRules(FIXTURE, current);
  assert.equal(articles[0].id, 'legacy-id-kept');                 // reused, not re-slugged
  assert.equal(articles[0].subentries[0].id, 'legacy-id-kept__old-sub');
  assert.deepEqual(report.newArticles, ['Beta']);
  assert.equal(report.removedArticles.length, 0);
});

test('a reworded sub-entry LABEL reports the old sub id as removed (never silently dropped)', () => {
  // Deterministic fixture for the logic the 16/07 drop exercised once: when a
  // sub-entry is reworded, its label no longer matches, so the old id cannot be
  // reused - it must be REPORTED as removed (so marginalia orphaning is visible),
  // and the new wording gets a fresh id. (Article title unchanged -> id kept.)
  const current = [{
    id: 'oversized-units', title: 'Oversized Units', content: 'x',
    subentries: [{ id: 'oversized-units__old-label', label: 'Old Label', content: 'old body' }],
  }];
  const csv = 'title,content,subcodexes\r\n"Oversized Units","x","New Label:  new body"\r\n';
  const { articles, report } = compileRules(csv, current);
  assert.equal(articles[0].id, 'oversized-units');                 // title unchanged -> reused
  assert.deepEqual(report.removedArticles, []);
  assert.deepEqual(report.removedSubs, ['oversized-units__old-label']);
});

test('real drop CSV over the current catalog is stable: issues-free and no id vanishes', () => {
  // Once a drop is applied to the catalog, re-applying the SAME drop must be a
  // clean no-op (the rename is already in articles_normalized.json). This tracks
  // reality rather than a one-time delta. Skips gracefully if the (gitignored)
  // drop folder is absent, e.g. on a fresh CI clone.
  const drop = discover(join(ROOT, 'CATALOG_DROP'));
  if (!drop.rulesCsv) return;
  const current = readCat('articles_normalized.json');
  const { report } = compileRules(readFileSync(drop.rulesCsv, 'utf8'), current);
  assert.equal(report.issues.length, 0, `issues: ${report.issues.join('; ')}`);
  assert.deepEqual(report.removedArticles, [], 'no current article id vanishes');
  assert.deepEqual(report.removedSubs, [], 'rename already applied; re-applying removes nothing');
});
