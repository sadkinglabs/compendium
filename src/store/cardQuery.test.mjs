// Grammar fixtures for the unified card query (src/store/cardQuery.js).
// Run: npm run test:query   (node --test)
//
// Two jobs: (1) pin every documented token so a future parser edit can't drift
// the grammar out from under both search bars at once; (2) lock the Stage-1
// behaviour changes - the revived e:/has:/is: paths and the e:<non-element>
// guard - so they can't silently regress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, parseCardQuery, cardMatchesQuery } from './cardQuery.js';

// Card rows arrive from SQLite with JSON-string columns; mirror that shape.
const card = (o) => ({
  name: '', type: '', sub_types: '[]', rules_text: '', elements: '[]',
  thresholds: '{}', sets: '[]', variants: '[]', rarity: '',
  cost: null, attack: null, defence: null, life: null, ...o,
});
const matches = (q, c) => cardMatchesQuery(c, parseQuery(q));

test('bare words are the needle, no clauses/scopes', () => {
  const p = parseQuery('airborne knight');
  assert.equal(p.name, 'airborne knight');
  assert.equal(p.clauses.length, 0);
  assert.deepEqual(p.scopes, { has: [], is: [] });
});

test('parseCardQuery is parseQuery (back-compat alias)', () => {
  assert.equal(parseCardQuery, parseQuery);
  assert.deepEqual(parseCardQuery('t:minion').scopes, { has: [], is: [] });
});

test('e: short-form finally works as an element filter (the drift fix)', () => {
  const p = parseQuery('e:fire');
  assert.equal(p.clauses.length, 1);
  assert.equal(p.name, '');
  assert.ok(matches('e:fire', card({ elements: '["fire"]' })));
  assert.ok(!matches('e:fire', card({ elements: '["water"]' })));
  assert.ok(matches('e:fire', card({ thresholds: '{"fire":2}' })));   // threshold-only counts
});

test('el:/e: letter-OR across elements', () => {
  assert.ok(matches('el:ae', card({ elements: '["earth"]' })));   // a|e -> air or earth
  assert.ok(matches('e:af', card({ elements: '["fire"]' })));
  assert.ok(!matches('e:aw', card({ elements: '["fire"]' })));
  assert.ok(matches('element:water', card({ elements: '["water"]' })));   // full name
});

test('e:<non-element> falls through to free text, not a silent Air filter', () => {
  const p = parseQuery('e:dragon');   // d,r,g,o,n are not element letters
  assert.equal(p.clauses.length, 0);
  assert.equal(p.name, 'e:dragon');
  const p2 = parseQuery('el:earthx');
  assert.equal(p2.clauses.length, 0);
  assert.equal(p2.name, 'el:earthx');
});

test('has:/is: are captured as scopes, never the needle or a clause', () => {
  const p = parseQuery('has:faq is:saved airborne');
  assert.deepEqual(p.scopes.has, ['faq']);
  assert.deepEqual(p.scopes.is, ['saved']);
  assert.equal(p.name, 'airborne');
  assert.equal(p.clauses.length, 0);
});

test('has:faq alone leaves an EMPTY needle (fixes name-poisoning)', () => {
  const p = parseQuery('has:faq');
  assert.equal(p.name, '');                 // old parser put "has:faq" here -> empty results
  assert.deepEqual(p.scopes.has, ['faq']);
  assert.equal(p.clauses.length, 0);
});

test('scope tokens only bind on the colon operator', () => {
  // is>saved is nonsense; it must not vanish into scopes - it stays free text.
  const p = parseQuery('is>saved');
  assert.deepEqual(p.scopes.is, []);
  assert.equal(p.name, 'is>saved');
});

test('type / subtype / rules / keyword clauses', () => {
  assert.ok(matches('t:minion', card({ type: 'Minion' })));
  assert.ok(matches('t:mortal', card({ type: 'Minion', sub_types: '["Mortal","Knight"]' })));
  assert.ok(matches('r:"airborne, genesis"', card({ rules_text: 'Genesis - gains airborne.' })));
  assert.ok(!matches('r:"airborne, genesis"', card({ rules_text: 'Has airborne.' })));   // needs both
  assert.ok(matches('kw:charge', card({ rules_text: 'Charge.' })));
  assert.ok(!matches('kw:charge', card({ rules_text: 'Discharge the aura.' })));   // whole word
});

test('numeric operators and per-element thresholds', () => {
  assert.ok(matches('c<=3', card({ cost: 2 })));
  assert.ok(!matches('c<=3', card({ cost: 5 })));
  assert.ok(matches('c:2', card({ cost: 2 })));            // ':' == '='
  assert.ok(matches('attack>2', card({ attack: 3 })));
  assert.ok(matches('th>=2', card({ thresholds: '{"fire":3}' })));
  assert.ok(matches('at>1', card({ thresholds: '{"air":2}' })));
  assert.ok(!matches('at>1', card({ thresholds: '{"fire":2}' })));
});

test('numeric keys self-guard: non-numeric value falls to free text', () => {
  const p = parseQuery('cost:abc');
  assert.equal(p.clauses.length, 0);
  assert.equal(p.name, 'cost:abc');
});

test('quotes escape a key-shaped phrase (the : is literal)', () => {
  const p = parseQuery('"c<3"');
  assert.equal(p.clauses.length, 0);
  assert.equal(p.name, 'c<3');
});

test('set matches the code+name haystack', () => {
  assert.ok(matches('s:got', card({ sets: '[{"code":"got","name":"Gothic"}]' })));
  assert.ok(matches('set:gothic', card({ sets: '[{"code":"got","name":"Gothic"}]' })));
  assert.ok(!matches('s:got', card({ sets: '[{"code":"alp","name":"Alpha"}]' })));
});

/* ============ item-grain structured output (Codex Major 7) ============ */
import { matchesSetTerms } from './cardQuery.js';

test('parseQuery exposes setTerms and itemClauses without disturbing clauses', () => {
  const q = parseQuery('water set:beta t:mortal');
  assert.deepEqual(q.setTerms, ['beta'], 'raw set value captured');
  assert.equal(q.name, 'water', 'the needle is untouched');
  // clauses keeps ALL predicates (back-compat); itemClauses drops the set one.
  assert.equal(q.clauses.length, 2, 'set + type in clauses');
  assert.equal(q.itemClauses.length, 1, 'only the non-set predicate in itemClauses');
});

test('setTerms collects codes and names, and the s: alias', () => {
  assert.deepEqual(parseQuery('set:alpha').setTerms, ['alpha']);
  assert.deepEqual(parseQuery('s:002').setTerms, ['002']);
  assert.deepEqual(parseQuery('set:art').setTerms, ['art']);
});

test('a query with no set token has empty setTerms and matches every printing', () => {
  const q = parseQuery('e:water');
  assert.deepEqual(q.setTerms, []);
  assert.equal(matchesSetTerms('001 Alpha', q.setTerms), true, 'no set filter -> all rows pass');
});

test('matchesSetTerms: OR across separate set tokens', () => {
  const q = parseQuery('set:alpha set:beta');
  assert.deepEqual(q.setTerms, ['alpha', 'beta']);
  assert.equal(matchesSetTerms('001 Alpha', q.setTerms), true);
  assert.equal(matchesSetTerms('002 Beta', q.setTerms), true);
  assert.equal(matchesSetTerms('006 Gothic', q.setTerms), false);
});

test('matchesSetTerms: a code term matches the label', () => {
  assert.equal(matchesSetTerms('002 Beta', parseQuery('set:002').setTerms), true);
  assert.equal(matchesSetTerms('001 Alpha', parseQuery('set:002').setTerms), false);
});

test('matchesSetTerms: comma within one value ANDs on a single printing label', () => {
  // A printing is one set, so alpha,beta can never both appear in one label - correct: a
  // printing cannot be Alpha AND Beta.
  const terms = parseQuery('set:alpha,beta').setTerms;
  assert.equal(matchesSetTerms('001 Alpha', terms), false);
  assert.equal(matchesSetTerms('002 Beta', terms), false);
});

test('the existing set clause still works for card-grain consumers (back-compat)', () => {
  // clauses[] unchanged: a card in Beta still matches set:beta via cardMatchesQuery.
  const q = parseQuery('set:beta');
  const betaCard = { sets: JSON.stringify([{ code: '002', name: 'Beta' }]) };
  const alphaCard = { sets: JSON.stringify([{ code: '001', name: 'Alpha' }]) };
  assert.equal(cardMatchesQuery(betaCard, q), true);
  assert.equal(cardMatchesQuery(alphaCard, q), false);
});
