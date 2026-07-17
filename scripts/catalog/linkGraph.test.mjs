import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { regenerateLinkGraph, assertReproducesCommitted } from './linkGraph.mjs';

const CATALOG = fileURLToPath(new URL('../../public/catalog/', import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(CATALOG, f), 'utf8'));

test('byte-reproduces the committed link_graph.json from committed articles (the hard gate)', () => {
  const articles = read('articles_normalized.json');
  const committed = read('link_graph.json');
  const regen = regenerateLinkGraph(articles);
  assert.equal(JSON.stringify(regen), JSON.stringify(committed));
  const count = assertReproducesCommitted(articles, committed);
  assert.equal(count, committed.length);
});

test('cards pass emits [[..]] in order, duplicates kept, whitespace normalised', () => {
  const arts = [{ id: 'a', title: 'A', content: 'see [[Foo Bar]] and [[Baz]] then [[Foo Bar]] and [[Multi\nLine]]', subentries: [] }];
  const e = regenerateLinkGraph(arts);
  assert.deepEqual(e, [
    { source: 'a', target_type: 'card', target: 'Foo Bar' },
    { source: 'a', target_type: 'card', target: 'Baz' },
    { source: 'a', target_type: 'card', target: 'Foo Bar' },
    { source: 'a', target_type: 'card', target: 'Multi Line' },
  ]);
});

test('rule refs resolve to subentry (first) then article, else unresolved', () => {
  const arts = [
    { id: 'parent', title: 'Parent', content: 'x', subentries: [{ id: 'parent__lbl', label: 'The Label', content: '' }] },
    { id: 'other', title: 'Other Title', content: 'ref ((The Label)) and ((Other Title)) and ((Nope))', subentries: [] },
  ];
  const e = regenerateLinkGraph(arts).filter((x) => x.source === 'other');
  assert.deepEqual(e, [
    { source: 'other', target_type: 'subentry', target: 'parent__lbl', target_title: 'The Label' },
    { source: 'other', target_type: 'article', target: 'other', target_title: 'Other Title' },
    { source: 'other', target_type: 'unresolved_article', target: 'Nope' },
  ]);
});

test('rule regex [^)]* drops a runaway ))X(( that runs into a single close paren', () => {
  // Mirrors the real `fly` article: ))Avatar(( ... (single parens) ... ))Avatar((
  const arts = [{ id: 'fly', title: 'Fly', content: "a ))Avatar(( of Air's ability (and not sites) more ))Avatar(( tail", subentries: [] }];
  const e = regenerateLinkGraph(arts);
  // the (( after the first Avatar runs to a ')' before any '))', so no rule edge
  assert.equal(e.filter((x) => x.target_type !== 'card').length, 0);
});
