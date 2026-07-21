import test from 'node:test';
import assert from 'node:assert/strict';
import { lineKey, visiblePile, bulkDecisions, lineDescription, applySummary } from './triageSheetState.js';
import { OWNED_NONFOIL, OWNED_FOIL, WANTED } from '../store/triage.js';

const entry = (card_id, sets, lines) => ({ card_id, sets, lines, resolvable: sets.length > 0 });
const line = (kind, qty, foil = false) => ({ kind, qty, foil, from: [''] });

test('owned and wanted on one card are separate decisions', () => {
  assert.notEqual(lineKey('c1', OWNED_NONFOIL), lineKey('c1', WANTED));
});

test('a filed line leaves the pile, its siblings stay', () => {
  const pile = [entry('c1', ['001', '002'], [line(OWNED_NONFOIL, 2), line(WANTED, 1)])];
  const seen = visiblePile(pile, new Set([lineKey('c1', OWNED_NONFOIL)]));
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].lines.map((l) => l.kind), [WANTED]);
});

test('an entry whose every line is filed disappears', () => {
  const pile = [entry('c1', ['001'], [line(OWNED_NONFOIL, 2)]), entry('c2', ['001'], [line(WANTED, 1)])];
  const seen = visiblePile(pile, new Set([lineKey('c1', OWNED_NONFOIL)]));
  assert.deepEqual(seen.map((e) => e.card_id), ['c2']);
});

test('bulk covers only single-set cards, and carries the line it came from', () => {
  const one = entry('c1', ['001'], [line(OWNED_NONFOIL, 2), line(WANTED, 1)]);
  const many = entry('c2', ['001', '002'], [line(OWNED_FOIL, 1, true)]);
  const decisions = bulkDecisions([one, many]);
  assert.deepEqual(decisions.map((d) => d.entry.card_id), ['c1', 'c1']);
  assert.equal(decisions[0].set, '001');
  assert.deepEqual(decisions[0].line.from, ['']);
});

test('a card with no sets is never a bulk decision', () => {
  assert.deepEqual(bulkDecisions([entry('c1', [], [line(OWNED_NONFOIL, 1)])]), []);
});

test('a line states its finish', () => {
  assert.equal(lineDescription(line(OWNED_NONFOIL, 2)), 'Owned · Non-foil');
  assert.equal(lineDescription(line(OWNED_FOIL, 2, true)), 'Owned · Foil');
  assert.equal(lineDescription(line(WANTED, 1)), 'Wanted · Non-foil');
});

test('a clean batch reports only what it filed', () => {
  assert.equal(applySummary({ filed: 4, unconfirmed: 0, failed: 0, total: 4 }), 'Filed 4 of 4.');
});

test('unconfirmed writes are never counted as filed', () => {
  assert.equal(
    applySummary({ filed: 2, unconfirmed: 1, failed: 1, total: 4 }),
    'Filed 2 of 4 - 1 unconfirmed - 1 failed.',
  );
});
