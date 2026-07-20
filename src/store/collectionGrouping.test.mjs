import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCards, letterIndex, letterOf, GROUP_MODES } from './collectionGrouping.js';
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

test('the rail returns all 27 buckets regardless of content', () => {
  // Fixed height matters: letters must not reflow as filters change.
  const idx = letterIndex([card('Ancient Dragon')]);
  assert.equal(idx.length, 27, '# plus A-Z');
  assert.equal(idx[0].letter, '#');
});

test('empty letters report count 0 and index -1', () => {
  const idx = letterIndex([card('Ancient Dragon')]);
  const b = idx.find((l) => l.letter === 'B');
  assert.equal(b.count, 0);
  assert.equal(b.index, -1);
});

test('the rail index points at the first card of each letter in sorted order', () => {
  const idx = letterIndex([card('Zephyr'), card('Basilisk'), card('Ancient Dragon'), card('Avatar')]);
  assert.equal(idx.find((l) => l.letter === 'A').index, 0);
  assert.equal(idx.find((l) => l.letter === 'A').count, 2);
  assert.equal(idx.find((l) => l.letter === 'B').index, 2);
  assert.equal(idx.find((l) => l.letter === 'Z').index, 3);
});

test('non-alphabetic names bucket under # rather than disappearing', () => {
  assert.equal(letterOf('7th Sword'), '#');
  assert.equal(letterOf('"Quoted"'), '#');
  assert.equal(letterOf(''), '#');
  const idx = letterIndex([card('7th Sword'), card('Ancient Dragon')]);
  assert.equal(idx.find((l) => l.letter === '#').count, 1);
});

test('rail counts total to the number of cards, so it cannot disagree with the grid', () => {
  const cards = [card('Ancient Dragon'), card('Avatar'), card('7th Sword'), card('Zephyr')];
  const total = letterIndex(cards).reduce((n, l) => n + l.count, 0);
  assert.equal(total, cards.length);
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

test('the rail index accepts the same accessor', () => {
  const rows = [{ card: card('Zephyr') }, { card: card('Ancient Dragon') }];
  const idx = letterIndex(rows, (r) => r.card);
  assert.equal(idx.find((l) => l.letter === 'A').index, 0);
  assert.equal(idx.find((l) => l.letter === 'Z').index, 1);
});

test('grouping is case-insensitive when ordering names', () => {
  const g = groupCards([card('zephyr'), card('Ancient Dragon')], 'none');
  assert.deepEqual(g[0].cards.map((c) => c.name), ['Ancient Dragon', 'zephyr']);
});
