import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCatalog, shapeFromApi, printingBase, isReservedBase, errataCount } from './curiosa.mjs';

const apiCard = (name, variants, extra = {}) => ({
  name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
  type: 'Minion', rarity: 'Ordinary', elements: ['Air'], cost: 3, attack: 1, defense: 1, life: null,
  airThreshold: 1, earthThreshold: 0, fireThreshold: 0, waterThreshold: 0, rulesText: 'Text', variants, ...extra,
});
const variant = (slug, set, setName, finish = 'Standard') => ({ slug, finish, product: 'Booster', flavorText: '', artist: { name: 'X' }, src: 'http://x', setCard: { set: { code: set, name: setName } } });

test('printingBase strips the finish token; isReservedBase guards legacy buckets', () => {
  assert.equal(printingBase('999-druid-op-rf'), '999-druid-op');
  assert.equal(printingBase('002-apprentice_wizard-b-s'), '002-apprentice_wizard-b');
  assert.ok(isReservedBase('999'));
  assert.ok(isReservedBase('001:f'));
  assert.ok(isReservedBase('foil'));
  assert.ok(isReservedBase(''));
  assert.ok(!isReservedBase('999-druid-op'));
});

test('shapeFromApi enriches variants and derives distinct sets in code order', () => {
  const { sets, variants } = shapeFromApi(apiCard('Foo', [variant('006-foo-b-s', '006', 'Gothic'), variant('001-foo-b-s', '001', 'Alpha')]));
  assert.deepEqual(sets, [{ code: '001', name: 'Alpha' }, { code: '006', name: 'Gothic' }]);
  assert.equal(variants[0].product, 'Booster');
  assert.equal(variants[0].artist, 'X');
});

test('elements: API {id,name} objects flatten to name strings on both the add and update paths', () => {
  // The live API returns elements as [{id,name}], but the runtime does
  // `element.toLowerCase()`, so the catalog must store plain name strings. This is
  // the shape contract that black-screened every card view when it regressed.
  const objEl = apiCard('Zephyr', [variant('001-zephyr-b-s', '001', 'Alpha')], { elements: [{ id: 'air', name: 'Air' }, { id: 'fire', name: 'Fire' }] });
  const added = mergeCatalog({}, [objEl], { minApiFraction: 0 }).cards['Zephyr'];
  assert.deepEqual(added.elements, ['Air', 'Fire']);
  added.elements.forEach((e) => assert.equal(typeof e, 'string'));
  const local = { Zephyr: { name: 'Zephyr', variants: [], sets: [], elements: ['Water'] } };
  const updated = mergeCatalog(local, [objEl], { minApiFraction: 0 }).cards['Zephyr'];
  assert.deepEqual(updated.elements, ['Air', 'Fire']);
});

test('life is an avatar-only stat: nulled on non-avatars, kept on avatars', () => {
  // The API returns life: 20 on every Gothic card; a minion/site must not show LIFE.
  const minion = apiCard('Aethermoeba', [variant('006-aethermoeba-b-s', '006', 'Gothic')], { type: 'Minion', life: 20 });
  const avatar = apiCard('Avatar of Fire', [variant('001-avatar_of_fire-b-s', '001', 'Alpha')], { type: 'Avatar', life: 20 });
  const { cards } = mergeCatalog({}, [minion, avatar], { minApiFraction: 0 });
  assert.equal(cards['Aethermoeba'].life, null);
  assert.equal(cards['Avatar of Fire'].life, 20);
  assert.equal(cards['Avatar of Fire'].isAvatar, true);
});

test('variants never carry the API src (external CDN url must not ship - offline-first §3)', () => {
  const { variants } = shapeFromApi(apiCard('Foo', [variant('001-foo-b-s', '001', 'Alpha')]));
  assert.ok(variants.length && !('src' in variants[0]), 'shaped variant has no src field');
});

test('merge updates existing, adds new, preserves local-only (token) cards', () => {
  const local = {
    'Apprentice Wizard': { name: 'Apprentice Wizard', rarity: 'Ordinary', variants: [], sets: [], subTypes: ['Mortal'], isAvatar: false, isSite: false, image: 'old.webp' },
    'Frog (Blue)': { name: 'Frog (Blue)', variants: [{ slug: '001-frog_blue-bt-s', set: '001' }], sets: [{ code: '001', name: 'Alpha' }] },
  };
  const api = [
    apiCard('Apprentice Wizard', [variant('001-apprentice_wizard-b-s', '001', 'Alpha')]),
    apiCard('Court of Equity', [variant('999-court_of_equity-d-s', '999', 'Promotional')], { type: 'Site' }),
  ];
  const { cards, report } = mergeCatalog(local, api, { minApiFraction: 0 });
  assert.deepEqual(report.updated, ['Apprentice Wizard']);
  assert.deepEqual(report.added, ['Court of Equity']);
  assert.deepEqual(report.localOnly, ['Frog (Blue)']);
  assert.ok(cards['Court of Equity'].isSite);
  assert.equal(cards['Apprentice Wizard'].subTypes[0], 'Mortal'); // preserved
});

test('local-only cards are always preserved (never dropped) by a merge', () => {
  const local = { 'Only Local': { name: 'Only Local', variants: [{ slug: '001-x-b-s', set: '001' }], sets: [] } };
  const { cards, report } = mergeCatalog(local, [apiCard('Other', [variant('001-other-b-s', '001', 'Alpha')])], { minApiFraction: 0 });
  assert.ok(cards['Only Local'], 'local-only card survives');
  assert.deepEqual(report.localOnly, ['Only Local']);
  assert.deepEqual(report.added, ['Other']);
});

test('gate: two catalog names colliding on one card_id is a hard failure', () => {
  // two local display names that slug to the same card_id (pre-existing bad data)
  const local = {
    'Foo Bar': { name: 'Foo Bar', variants: [{ slug: '001-foo_bar-b-s', set: '001' }], sets: [] },
    'Foo  Bar': { name: 'Foo  Bar', variants: [{ slug: '001-foo_bar-b-s', set: '001' }], sets: [] },
  };
  assert.throws(() => mergeCatalog(local, [], { minApiFraction: 0 }), /duplicate card_id/);
});

test('gate: rejects a malformed printing base', () => {
  const local = {};
  assert.throws(() => mergeCatalog(local, [apiCard('Bad', [{ slug: '999', finish: 'Standard', setCard: { set: { code: '999', name: 'Promotional' } } }])], { minApiFraction: 0 }),
    /malformed printing base/);
});

test('gate: rejects a set code with no name', () => {
  const local = {};
  assert.throws(() => mergeCatalog(local, [apiCard('NoName', [{ slug: '007-noname-b-s', finish: 'Standard', setCard: { set: { code: '007', name: null } } }])], { minApiFraction: 0 }),
    /no name in the API/);
});

test('gate: refuses an implausibly small API response', () => {
  const local = { A: { name: 'A', variants: [], sets: [] }, B: { name: 'B', variants: [], sets: [] }, C: { name: 'C', variants: [], sets: [] }, D: { name: 'D', variants: [], sets: [] } };
  assert.throws(() => mergeCatalog(local, [apiCard('A', [variant('001-a-b-s', '001', 'Alpha')])]), /refusing to gut/);
});

test('errataCount counts UPDATED rules text', () => {
  assert.equal(errataCount({ a: { rulesText: 'UPDATED: now does X' }, b: { rulesText: 'normal' } }), 1);
});
