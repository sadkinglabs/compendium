import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { compileFaqs, faqId } from './faqs.mjs';
import { discover } from './discover.mjs';
import { cardSlug } from './slug.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const FIX = 'card name,question,answer\r\n' +
  '"Abundance","Q1?","A1"\r\n' +
  '"","Q2?","A2"\r\n' +      // blank name inherits Abundance
  '"Bruin","Q3?","A3"\r\n';

test('blank card name inherits the previous card; ids are deterministic content hashes', () => {
  const valid = new Set(['abundance', 'bruin']);
  const { faqs, report } = compileFaqs(FIX, valid);
  assert.equal(faqs.length, 3);
  assert.deepEqual(faqs[0].cards, ['abundance']);
  assert.deepEqual(faqs[1].cards, ['abundance']);   // inherited
  assert.deepEqual(faqs[2].cards, ['bruin']);
  assert.equal(faqs[0].source, 'curiosa.io');
  assert.equal(faqs[1].id, faqId('Abundance', 'Q2?', 'A2'));
  assert.equal(report.unresolved.length, 0);
});

test('unresolved card names are reported', () => {
  const { report } = compileFaqs(FIX, new Set(['abundance']));
  assert.ok(report.issues.some((i) => /do not resolve/.test(i)));
  assert.deepEqual(report.unresolved, ['Bruin']);
});

test('an identical duplicate Q&A collides on id and is reported, not double-emitted', () => {
  const dup = 'card name,question,answer\r\n"Bruin","Q?","A"\r\n"Bruin","Q?","A"\r\n';
  const { faqs, report } = compileFaqs(dup, new Set(['bruin']));
  assert.equal(faqs.length, 1);
  assert.ok(report.issues.some((i) => /duplicate id/.test(i)));
});

test('real drop FAQ CSV: every card name resolves against the current catalog + no id collisions', () => {
  const drop = discover(join(ROOT, 'CATALOG_DROP'));
  assert.ok(drop.faqCsv, 'FAQ CSV present in the drop');
  const currentCards = JSON.parse(readFileSync(join(ROOT, 'public', 'catalog', 'cards.json'), 'utf8'));
  // current + the five known-new API cards resolve the whole drop today
  const valid = new Set(Object.keys(currentCards).map(cardSlug));
  for (const n of ['Court of Equity', 'Foot Soldier', 'Mobbed Court', 'Mock Court', 'Overflowing Court']) valid.add(cardSlug(n));
  const { faqs, report } = compileFaqs(readFileSync(drop.faqCsv, 'utf8'), valid);
  assert.deepEqual(report.unresolved, [], `unresolved: ${report.unresolved.join(', ')}`);
  assert.ok(faqs.length > 700, `expected >700 faqs, got ${faqs.length}`);
});
