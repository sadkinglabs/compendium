// Stage 0 fixtures - lock in the bug fixes and the anchoring contract so future
// parser changes cannot silently regress them. Run: npm run test:codex
// These import the engine directly (the same boundary the local CMS will use).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalizeArticle, canonicalizeCard } from './canonicalize.mjs';
import { segment } from './segment.mjs';
import { buildLexicon, linkifyKeywords } from './keywords.mjs';
import { compileArticle, compileCorpus } from './compile.mjs';

const texts = (canon, blocks) => blocks.map((b) => canon.slice(b.span[0], b.span[1]));

test('canonicalize article: reflow, em dash, and TYPED links ([[card]] / ((rule)) / ))rule(( mistake)', () => {
  const { canon, links } = canonicalizeArticle('mana \ncost of [[Bury]] — see ((zero)) and ))fly((.');
  assert.ok(!canon.includes('\n'), 'hard wrap reflowed');
  assert.ok(canon.includes('mana cost'), 'wrap joined');
  assert.ok(canon.includes(' - '), 'em dash normalized');
  assert.ok(!/[[\]()]/.test(canon), 'all link brackets stripped');
  assert.deepEqual(links.map((l) => [l.name, l.target]), [['Bury', 'card'], ['zero', 'rule'], ['fly', 'rule']]);
  assert.equal(links.find((l) => l.name === 'fly').mistake, true, 'reversed-paren flagged');
  assert.ok(!links.find((l) => l.name === 'zero').mistake, 'proper ((rule)) not flagged');
  for (const l of links) assert.equal(canon.slice(l.start, l.end), l.name, 'link span slices to its name');
});

test('canonicalize card: preserves semantic line breaks', () => {
  const { canon } = canonicalizeCard('Spellcaster\r\nGenesis → Draw a spell.');
  assert.equal(canon, 'Spellcaster\nGenesis → Draw a spell.');
});

test('segment: a prose number is NOT a list and the digit survives (the "power" bug)', () => {
  const { canon } = canonicalizeArticle('Bosk Troll has a power of 3. When it strikes, it inflicts 3 damage.');
  const blocks = segment(canon);
  assert.ok(!blocks.some((b) => b.type === 'ol' || b.type === 'ul'), 'no false list');
  assert.ok(texts(canon, blocks).join(' ').includes('power of 3.'), 'digit not deleted');
});

test('segment: a spaced hyphen is NOT a bullet (the "adjacent" bug)', () => {
  const { canon } = canonicalizeArticle('The middle square has 5 adjacent squares - itself and four others.');
  assert.ok(!segment(canon).some((b) => b.type === 'ul'), 'no false bullets');
});

test('segment: a genuine sequential numbered list becomes an ol with markers stripped', () => {
  const { canon } = canonicalizeArticle('In order: 1) Cast the spell. 2) Resolve triggers. 3) Pass priority.');
  const ol = segment(canon).find((b) => b.type === 'ol');
  assert.ok(ol, 'ol detected');
  assert.equal(ol.items.length, 3);
  const items = ol.items.map((it) => canon.slice(it.span[0], it.span[1]));
  assert.ok(items[0].startsWith('Cast the spell'), 'marker stripped from item');
  assert.ok(!items.some((t) => /^\d+[.)]/.test(t)), 'no residual markers');
});

test('segment: (N) parentheticals never form a list', () => {
  const { canon } = canonicalizeArticle('The middle square (layer 2) and the corner (layer 3) behave differently here.');
  assert.ok(!segment(canon).some((b) => b.type === 'ol'), 'parenthetical numbers rejected');
});

test('segment: explicit "Warning:" prefix becomes a warning callout', () => {
  const { canon } = canonicalizeArticle('This part is normal. Warning: this interaction is complicated!');
  assert.ok(segment(canon).some((b) => b.type === 'warning'), 'callout typed');
});

test('keywords: multi-word anywhere, single-word only at line start, stop-list skipped', () => {
  const lex = buildLexicon(['Air Site', 'Genesis', 'Draw', 'Airborne']);
  assert.ok(!lex.single.has('Draw'), 'common word stop-listed');
  const canon = 'Airborne\nGenesis → Draw a card at an Air Site.';
  const links = linkifyKeywords(canon, lex);
  const names = links.map((l) => l.name);
  assert.ok(links.every((l) => l.target === 'rule'), 'card keyword links target rules');
  assert.ok(names.includes('Airborne'), 'single word at line start');
  assert.ok(names.includes('Genesis'), 'single word after newline');
  assert.ok(names.includes('Air Site'), 'multi word anywhere');
  assert.ok(!names.includes('Draw'), 'stop-listed word not linked');
  for (const l of linkifyKeywords(canon, lex)) assert.equal(canon.slice(l.start, l.end), l.name);
});

test('compileArticle: ids assigned + unique, lead on first paragraph, spans round-trip', () => {
  const [doc] = compileArticle({ id: 'x', title: 'X', content: 'First para here. It has a second sentence. And a third one now.\n\nSecond paragraph begins here.', subentries: [] });
  assert.equal(doc.docId, 'x');
  assert.ok(doc.blocks[0].lead, 'drop-cap lead on first paragraph');
  assert.ok(doc.blocks.every((b) => b.id?.startsWith('b')), 'content-hash ids');
  const ids = doc.blocks.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, 'ids unique within doc');
  for (const b of doc.blocks) assert.equal(doc.canon.slice(b.span[0], b.span[1]).length, b.span[1] - b.span[0]);
});

test('corpus: the real catalog compiles with ZERO invariant issues', async () => {
  const base = new URL('../../public/catalog/', import.meta.url);
  const articles = JSON.parse(await readFile(new URL('articles_normalized.json', base), 'utf8'));
  const cards = Object.values(JSON.parse(await readFile(new URL('cards.json', base), 'utf8')));
  const { report } = compileCorpus({ articles, cards });
  assert.deepEqual(report.issues, [], 'no dropped content, overlaps, or duplicate docs');
  assert.ok(report.docs > 1300 && report.blocks > 2000);
});
