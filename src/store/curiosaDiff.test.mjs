// Curiosa re-sync diff - Increment 1 of docs/proposals/curiosa-resync.md.
// Run: npm run test:query
// Pure-function suite: aggregation, add/remove/change classification, duplicate
// collapsing on both sides, placeholder exclusion, avatar rules, ordering, and
// the empty diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateByZoneCard, computeCuriosaDiff, overLimitEntries } from './curiosaDiff.js';

const e = (zone, cardId, qty, name = cardId) => ({ zone, cardId, qty, name });

test('aggregate sums duplicate rows and drops placeholders and zero qty', () => {
  const m = aggregateByZoneCard([
    e('spellbook', 'a', 2), e('spellbook', 'a', 3),
    { zone: 'spellbook', cardId: null, qty: 4, name: null },   // placeholder-shaped: excluded
    e('atlas', 'b', 0),                                        // zero qty: excluded
    e('collection', 'c', 1),
  ]);
  assert.equal(m.size, 2);
  assert.equal(m.get('spellbook|a').qty, 5);
  assert.equal(m.get('collection|c').qty, 1);
});

test('classifies adds, removes, changes and counts unchanged', () => {
  const current = [e('spellbook', 'keep', 4), e('spellbook', 'shrink', 3), e('atlas', 'gone', 2)];
  const remote = [e('spellbook', 'keep', 4), e('spellbook', 'shrink', 1), e('collection', 'new', 2)];
  const d = computeCuriosaDiff(current, remote);
  assert.deepEqual(d.adds, [{ zone: 'collection', cardId: 'new', name: 'new', qty: 2 }]);
  assert.deepEqual(d.removes, [{ zone: 'atlas', cardId: 'gone', name: 'gone', qty: 2 }]);
  assert.deepEqual(d.changes, [{ zone: 'spellbook', cardId: 'shrink', name: 'shrink', from: 3, to: 1 }]);
  assert.equal(d.unchangedCount, 1);
  assert.equal(d.isEmpty, false);
});

test('same card in different zones is tracked per zone, not globally', () => {
  const current = [e('spellbook', 'x', 2)];
  const remote = [e('atlas', 'x', 2)];
  const d = computeCuriosaDiff(current, remote);
  assert.equal(d.adds.length, 1);
  assert.equal(d.adds[0].zone, 'atlas');
  assert.equal(d.removes.length, 1);
  assert.equal(d.removes[0].zone, 'spellbook');
});

test('duplicate local rows aggregate before comparison (no false change)', () => {
  const current = [e('spellbook', 'a', 2), e('spellbook', 'a', 2)];
  const remote = [e('spellbook', 'a', 4)];
  const d = computeCuriosaDiff(current, remote);
  assert.equal(d.isEmpty, true);
  assert.equal(d.unchangedCount, 1);
});

test('avatar: change detected, unresolved remote never clears local', () => {
  const with_ = computeCuriosaDiff([], [], 'old-av', { cardId: 'new-av', name: 'New Avatar' });
  assert.deepEqual(with_.avatar, { fromId: 'old-av', toId: 'new-av', toName: 'New Avatar' });
  assert.equal(with_.isEmpty, false);

  const same = computeCuriosaDiff([], [], 'av', { cardId: 'av', name: 'Same' });
  assert.equal(same.avatar, null);

  const unresolved = computeCuriosaDiff([], [], 'av', null);
  assert.equal(unresolved.avatar, null);
  assert.equal(unresolved.isEmpty, true);

  const noLocal = computeCuriosaDiff([], [], null, { cardId: 'av', name: 'First' });
  assert.deepEqual(noLocal.avatar, { fromId: null, toId: 'av', toName: 'First' });
});

test('name: effective rename detected; empty, absent, or equal toName never renames', () => {
  const renamed = computeCuriosaDiff([], [], null, null, { fromName: 'Fire', toName: 'Fire v2' });
  assert.deepEqual(renamed.name, { from: 'Fire', to: 'Fire v2' });
  assert.equal(renamed.isEmpty, false);

  assert.equal(computeCuriosaDiff([], [], null, null, { fromName: 'Fire', toName: 'Fire' }).name, null);
  assert.equal(computeCuriosaDiff([], [], null, null, { fromName: 'Fire', toName: '' }).name, null);
  assert.equal(computeCuriosaDiff([], [], null, null, { fromName: 'Fire', toName: null }).name, null);
  const noNames = computeCuriosaDiff([], []);
  assert.equal(noNames.name, null);
  assert.equal(noNames.isEmpty, true);
});

test('identical lists produce an empty diff', () => {
  const list = [e('spellbook', 'a', 4), e('atlas', 'b', 3)];
  const d = computeCuriosaDiff(list, list.map((x) => ({ ...x })));
  assert.equal(d.isEmpty, true);
  assert.equal(d.adds.length + d.removes.length + d.changes.length, 0);
  assert.equal(d.unchangedCount, 2);
});

test('overLimit: totals across zones vs limit, uncapped (99) passes, sorted by name', () => {
  const LIMITS = { haunt: 3, fate: 1, pond: 99, bolt: 4 };
  const entries = [
    e('spellbook', 'haunt', 4, 'Headless Haunt'),
    e('collection', 'haunt', 2, 'Headless Haunt'),   // 6 total across zones > 3
    e('spellbook', 'fate', 2, 'Atlantean Fate'),      // 2 > 1
    e('atlas', 'pond', 9, 'Pond'),                    // "any number of" - never flagged
    e('spellbook', 'bolt', 4, 'Lightning Bolt'),      // at the limit - legal
  ];
  const over = overLimitEntries(entries, (id) => LIMITS[id]);
  assert.deepEqual(over, [
    { cardId: 'fate', name: 'Atlantean Fate', qty: 2, limit: 1 },
    { cardId: 'haunt', name: 'Headless Haunt', qty: 6, limit: 3 },
  ]);
  assert.deepEqual(overLimitEntries([], () => 4), []);
  assert.deepEqual(overLimitEntries(entries, () => undefined), []);   // no limit known - never flagged
});

test('display ordering: zone (spellbook, atlas, collection) then name', () => {
  const remote = [e('collection', 'z1', 1, 'Zeta'), e('spellbook', 'b1', 1, 'Beta'), e('spellbook', 'a1', 1, 'Alpha'), e('atlas', 'p1', 1, 'Pond')];
  const d = computeCuriosaDiff([], remote);
  assert.deepEqual(d.adds.map((a) => a.name), ['Alpha', 'Beta', 'Pond', 'Zeta']);
});
