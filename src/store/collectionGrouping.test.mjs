import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupCards, GROUP_MODES, LIST_GROUP_MODES, WANTED_GROUP_MODES, effectiveListGroup,
} from './collectionGrouping.js';
import { rarityRank, RARITY_ORDER } from './rarity.js';

const card = (name, extra = {}) => ({ name, rarity: 'Ordinary', elements: ['Fire'], ...extra });

test('rarity ranks by scarcity, not alphabetically', () => {
  const sorted = ['Unique', 'Elite', 'Ordinary', 'Exceptional'].sort((a, b) => rarityRank(a) - rarityRank(b));
  assert.deepEqual(sorted, RARITY_ORDER);
});

test('an unknown rarity sorts last, never first', () => {
  assert.ok(rarityRank('Mythic') > rarityRank('Unique'));
  assert.ok(rarityRank(undefined) > rarityRank('Unique'));
});

test('ungrouped mode returns one alphabetical section', () => {
  const g = groupCards([card('Zephyr'), card('Ancient Dragon')], 'none');
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].cards.map((c) => c.name), ['Ancient Dragon', 'Zephyr']);
});

test('grouping is not sorting: sections carry their own alphabetical order', () => {
  const g = groupCards([
    card('Zephyr', { rarity: 'Elite' }),
    card('Ancient Dragon', { rarity: 'Unique' }),
    card('Basilisk', { rarity: 'Elite' }),
  ], 'rarity');
  assert.deepEqual(g.map((s) => s.key), ['Elite', 'Unique'], 'sections in scarcity order');
  assert.deepEqual(g[0].cards.map((c) => c.name), ['Basilisk', 'Zephyr'], 'alphabetical within');
});

test('element grouping buckets multi and neutral cards', () => {
  const g = groupCards([
    card('Solo', { elements: ['Water'] }),
    card('Both', { elements: ['Fire', 'Water'] }),
    card('None', { elements: [] }),
  ], 'element');
  const keys = g.map((s) => s.key);
  assert.ok(keys.includes('Water'));
  assert.ok(keys.includes('Multi'));
  assert.ok(keys.includes('Neutral'));
});

test('empty sections are omitted', () => {
  const g = groupCards([card('A', { rarity: 'Elite' })], 'rarity');
  assert.deepEqual(g.map((s) => s.key), ['Elite']);
});

test('avatars get their own section rather than reading as bad data', () => {
  // Avatars genuinely carry no rarity in Sorcery - all 11 Beta avatars, for instance. Filing
  // them under "Unknown" made correct data look like a catalog fault.
  const g = groupCards([
    card('Sorcerer', { rarity: null, is_avatar: 1 }),
    card('Basilisk', { rarity: 'Elite' }),
  ], 'rarity');
  assert.deepEqual(g.map((s) => s.key), ['Elite', 'Avatar'], 'avatars sort after the real rarities');
});

test('the catalog JSON spelling of the avatar flag is accepted too', () => {
  const g = groupCards([card('Seer', { rarity: null, isAvatar: true })], 'rarity');
  assert.deepEqual(g.map((s) => s.key), ['Avatar']);
});

test('a non-avatar with no rarity is still Unknown, not silently an Avatar', () => {
  const g = groupCards([card('Mystery', { rarity: null })], 'rarity');
  assert.deepEqual(g.map((s) => s.key), ['Unknown']);
});

test('an unknown value still renders, after the known sections', () => {
  // Silently dropping a card because the catalog has an unexpected rarity would be worse
  // than showing an odd section header.
  const g = groupCards([card('A', { rarity: 'Elite' }), card('B', { rarity: 'Mythic' })], 'rarity');
  assert.deepEqual(g.map((s) => s.key), ['Elite', 'Mythic']);
});

test('every group mode returns an array so the caller has one code path', () => {
  for (const mode of GROUP_MODES) {
    assert.ok(Array.isArray(groupCards([card('A')], mode)), `${mode} returned an array`);
  }
});

test('an accessor lets the drill group its ownership rows without reshaping them', () => {
  // The set drill holds {card, set, owned, foil}; the grid needs those rows back, not bare
  // cards. Reshaping to satisfy the grouper would detach the result from what gets rendered.
  const row = (name, rarity) => ({ card: card(name, { rarity }), set: '001', owned: 2 });
  const rows = [row('Zephyr', 'Elite'), row('Ancient Dragon', 'Unique'), row('Basilisk', 'Elite')];
  const g = groupCards(rows, 'rarity', (r) => r.card);
  assert.deepEqual(g.map((s) => s.key), ['Elite', 'Unique']);
  assert.deepEqual(g[0].cards.map((r) => r.card.name), ['Basilisk', 'Zephyr']);
  assert.equal(g[0].cards[0].owned, 2, 'the row survived intact, not just its card');
});

test('grouping is case-insensitive when ordering names', () => {
  const g = groupCards([card('zephyr'), card('Ancient Dragon')], 'none');
  assert.deepEqual(g[0].cards.map((c) => c.name), ['Ancient Dragon', 'zephyr']);
});

// --- 'set' mode (List Arrange, 2026-08-15): caller-supplied vocabulary ---

test('set grouping buckets by the caller accessor and orders by the caller rank', () => {
  const rows = [
    { name: 'C', set: 'bet' }, { name: 'A', set: 'alp' }, { name: 'B', set: 'bet' },
  ];
  const rank = (k) => ({ alp: 1, bet: 2 }[k] ?? 99);
  const label = (k) => ({ alp: 'Alpha', bet: 'Beta' }[k] || k);
  const out = groupCards(rows, 'set', (x) => x, null, { setOf: (r) => r.set, setRank: rank, setLabel: label });
  assert.deepEqual(out.map((s) => s.label), ['Alpha', 'Beta']);
  assert.deepEqual(out[1].cards.map((c) => c.name), ['B', 'C'], 'alphabetical inside a set');
});

test('set grouping: a missing set falls to the Unknown bucket, nothing vanishes', () => {
  const rows = [{ name: 'X', set: null }, { name: 'Y', set: 'alp' }];
  const out = groupCards(rows, 'set', (x) => x, null, { setOf: (r) => r.set, setRank: (k) => (k === 'Unknown' ? 99 : 1), setLabel: (k) => k });
  assert.equal(out.length, 2);
  assert.equal(out[1].key, 'Unknown');
  assert.equal(out.reduce((n, s) => n + s.cards.length, 0), rows.length);
});

test('set grouping respects a custom comparator inside sections', () => {
  const rows = [{ name: 'A', set: 's', n: 2 }, { name: 'B', set: 's', n: 1 }];
  const out = groupCards(rows, 'set', (x) => x, (a, b) => a.n - b.n, { setOf: (r) => r.set });
  assert.deepEqual(out[0].cards.map((c) => c.name), ['B', 'A']);
});

// --- 'progress' mode (wanted lists): caller-supplied goal state ---

// A wanted-list row as the list screen holds it: how many are wanted, how many are in hand.
// goalMet is the CALLER's verdict, so the fixtures carry the numbers and the tests pass the
// predicate - exactly how the list screen reads its live optimistic maps.
const wantRow = (name, owned, target) => ({ name, owned, target });
const metOf = (r) => r.target > 0 && r.owned >= r.target;

test('progress grouping puts Missing first and Complete second', () => {
  const out = groupCards([
    wantRow('Owned', 3, 3),
    wantRow('Needed', 0, 2),
  ], 'progress', (x) => x, null, { goalMetOf: metOf });
  assert.deepEqual(out.map((s) => s.key), ['missing', 'complete'], 'what is still needed leads');
  assert.deepEqual(out.map((s) => s.label), ['Missing', 'Complete']);
  assert.deepEqual(out[0].cards.map((c) => c.name), ['Needed']);
  assert.deepEqual(out[1].cards.map((c) => c.name), ['Owned']);
});

test('progress grouping: an all-owned list shows Complete alone, not an empty Missing header', () => {
  const out = groupCards([wantRow('A', 2, 2), wantRow('B', 5, 1)], 'progress', (x) => x, null, { goalMetOf: metOf });
  assert.deepEqual(out.map((s) => s.key), ['complete']);
  assert.deepEqual(out[0].cards.map((c) => c.name), ['A', 'B']);
});

test('progress grouping: a list with nothing owned shows Missing alone', () => {
  const out = groupCards([wantRow('A', 0, 2), wantRow('B', 1, 4)], 'progress', (x) => x, null, { goalMetOf: metOf });
  assert.deepEqual(out.map((s) => s.key), ['missing']);
  assert.deepEqual(out[0].cards.map((c) => c.name), ['A', 'B']);
});

test('progress grouping keeps the comparator order inside each section', () => {
  // A deliberately non-alphabetical comparator: sectioning must not quietly re-sort by name.
  const rows = [
    wantRow('Aardvark', 0, 3), wantRow('Zephyr', 0, 1),
    wantRow('Ancient', 2, 2), wantRow('Zealot', 1, 1),
  ];
  const byNameDesc = (a, b) => b.name.localeCompare(a.name);
  const out = groupCards(rows, 'progress', (x) => x, byNameDesc, { goalMetOf: metOf });
  assert.deepEqual(out[0].cards.map((c) => c.name), ['Zephyr', 'Aardvark'], 'Missing in comparator order');
  assert.deepEqual(out[1].cards.map((c) => c.name), ['Zealot', 'Ancient'], 'Complete in comparator order');
});

test('progress grouping: a partly owned row stays Missing', () => {
  // Own 2 of a wanted 4. The shopping list is not done with this card, so it must not drift
  // into Complete the moment the first copy lands.
  const out = groupCards([wantRow('Clairvoyant', 2, 4)], 'progress', (x) => x, null, { goalMetOf: metOf });
  assert.deepEqual(out.map((s) => s.key), ['missing']);
  assert.equal(out[0].cards[0].owned, 2, 'the row survived intact, not just its name');
});

test('progress is a LIST mode only, never offered to the grid', () => {
  assert.ok(!GROUP_MODES.includes('progress'), 'the grid has no goals to be short of');
  assert.ok(!LIST_GROUP_MODES.includes('progress'), 'custom lists and the Wishlist have none either');
  assert.deepEqual(WANTED_GROUP_MODES, ['progress', ...LIST_GROUP_MODES], 'wanted lists lead with it');
});

// --- effectiveListGroup: session-global arrange state, per-kind defaults ---

test('effectiveListGroup defaults Progress on wanted lists and None elsewhere', () => {
  assert.equal(effectiveListGroup(undefined, 'wanted'), 'progress');
  assert.equal(effectiveListGroup(undefined, 'custom'), 'none');
  assert.equal(effectiveListGroup(undefined, 'wishlist'), 'none');
});

test('effectiveListGroup honours a stored choice that the kind allows', () => {
  assert.equal(effectiveListGroup('set', 'wanted'), 'set');
  assert.equal(effectiveListGroup('progress', 'wanted'), 'progress');
});

test('effectiveListGroup resolves a foreign stored mode to the kind default', () => {
  // Arrange state is session-global: a wanted list's 'progress' arrives on the next list
  // opened. It resolves away there rather than being written back over the real choice.
  assert.equal(effectiveListGroup('progress', 'custom'), 'none');
  assert.equal(effectiveListGroup('progress', 'wishlist'), 'none');
  assert.equal(effectiveListGroup('bogus', 'wanted'), 'progress');
});
