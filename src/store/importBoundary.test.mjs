// The profile-import boundary.
//
// The six named cases from the proposal, plus the ones that matter most: a rejection must leave
// NOTHING behind. Asserting that an error was thrown is easy and nearly worthless - the
// requirement is that the user does not end up with an orphaned half-profile they have to find
// and delete themselves.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBundle, normaliseBundle, prepareBundle, hasLegacyRows,
  ImportRejected, MAX_SUPPORTED_SCHEMA, ASSUMED_SCHEMA,
} from './importBoundary.js';
import { LEGACY_UNCATEGORISED, LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL, isLegacyPrinting } from './printings.js';

const owned = (o) => ({
  id: 'r1', profile_id: 'source-device', card_id: 'c1', variant_slug: LEGACY_UNCATEGORISED,
  qty_owned: 0, qty_wanted: 0, notes: '', created_at: '2026-01-01', updated_at: '2026-01-01', ...o,
});
const bundleOf = (o = {}) => ({ app: 'compendium', schemaVersion: 10, owned_cards: [], ...o });
const sets = (map) => (cardId) => map[cardId] || [];
const totals = (rows) => rows.reduce(
  (a, r) => ({ owned: a.owned + (r.qty_owned || 0), wanted: a.wanted + (r.qty_wanted || 0) }),
  { owned: 0, wanted: 0 },
);

/* ---------------- 1. a v10 bundle is converted ---------------- */

test('1. a v10 bundle imports with canonical keys, and no legacy key survives', () => {
  const b = bundleOf({
    owned_cards: [
      owned({ id: 'a', variant_slug: LEGACY_UNCATEGORISED, qty_owned: 2 }),
      owned({ id: 'b', card_id: 'c2', variant_slug: LEGACY_FOIL, qty_owned: 1 }),
      owned({ id: 'c', card_id: 'c3', variant_slug: LEGACY_UNCATEGORISED, qty_wanted: 3 }),
    ],
  });
  const { bundle } = prepareBundle(b, sets({ c1: ['001', '002'], c2: ['001'], c3: ['004'] }));
  assert.equal(bundle.owned_cards.some((r) => isLegacyPrinting(r.variant_slug)), false);
  assert.equal(bundle.schemaVersion, MAX_SUPPORTED_SCHEMA, 'the bundle is restamped');

  const byKey = Object.fromEntries(bundle.owned_cards.map((r) => [`${r.card_id}|${r.variant_slug}`, r]));
  assert.equal(byKey[`c1|${UNCATEGORISED}`].qty_owned, 2);
  assert.equal(byKey[`c2|${UNCATEGORISED_FOIL}`].qty_owned, 1, 'foil ownership keeps its finish');
  assert.equal(byKey['c3|004'].qty_wanted, 3, 'a single-set want is filed');
});

/* ---------------- 2. a v11 bundle passes through untouched ---------------- */

test('2. an already-canonical v11 bundle is returned byte-identical', () => {
  const b = bundleOf({
    schemaVersion: 11,
    owned_cards: [owned({ variant_slug: UNCATEGORISED, qty_owned: 1 }), owned({ variant_slug: '001', qty_owned: 2 })],
  });
  const before = JSON.stringify(b);
  const { bundle } = prepareBundle(b, sets({}));
  assert.equal(bundle, b, 'the very same object - normalisation is a genuine no-op');
  assert.equal(JSON.stringify(bundle), before, 'and nothing about it changed');
});

/* ---------------- 3. a missing stamp means v10 ---------------- */

test('3. a bundle with NO schemaVersion is treated as v10, not rejected', () => {
  // Exports predate the stamp. Rejecting them would strand the oldest backups, which are
  // exactly the ones most likely to need converting.
  const b = { app: 'compendium', owned_cards: [owned({ qty_owned: 1 })] };
  assert.equal(validateBundle(b), ASSUMED_SCHEMA);
  const { bundle } = prepareBundle(b, sets({ c1: ['001', '002'] }));
  assert.equal(bundle.owned_cards[0].variant_slug, UNCATEGORISED);
});

/* ---------------- 4. a future bundle is refused ---------------- */

test('4. a bundle from a NEWER build is rejected, and nothing is created', () => {
  const b = bundleOf({ schemaVersion: 12, owned_cards: [owned({ qty_owned: 1 })] });
  assert.throws(() => prepareBundle(b, sets({})), (e) => {
    assert.ok(e instanceof ImportRejected);
    assert.equal(e.code, 'future');
    assert.match(e.message, /newer version/i, 'the message tells the user what to do');
    return true;
  });
  // The boundary is pure: there is no database call to make, so "nothing was created" is
  // structural rather than a thing to remember. That is the point of it running first.
});

/* ---------------- 5. malformed bundles are refused ---------------- */

test('5. malformed bundles are rejected before anything is created', () => {
  const bad = [
    [null, 'malformed'],
    ['a string', 'malformed'],
    [[], 'malformed'],
    [{}, 'not-compendium'],
    [{ app: 'something-else' }, 'not-compendium'],
    [bundleOf({ schemaVersion: 'ten' }), 'malformed'],
    [bundleOf({ schemaVersion: 0 }), 'malformed'],
    [bundleOf({ owned_cards: 5 }), 'malformed'],
    [bundleOf({ owned_cards: [{ qty_owned: 1 }] }), 'malformed'],   // no card_id
    [bundleOf({ card_lists: 'nope' }), 'malformed'],
  ];
  for (const [input, code] of bad) {
    assert.throws(
      () => prepareBundle(input, sets({})),
      (e) => e instanceof ImportRejected && e.code === code,
      `expected ${code} for ${JSON.stringify(input)?.slice(0, 60)}`,
    );
  }
});

/* ---------------- 6. the round trip is stable ---------------- */

test('6. export -> import -> export is stable, and quantities are conserved', () => {
  const original = bundleOf({
    owned_cards: [
      owned({ id: 'a', variant_slug: LEGACY_UNCATEGORISED, qty_owned: 3, qty_wanted: 2 }),
      owned({ id: 'b', variant_slug: LEGACY_FOIL, qty_owned: 1 }),
      owned({ id: 'c', card_id: 'c2', variant_slug: '001', qty_owned: 4 }),
    ],
  });
  const once = prepareBundle(original, sets({ c1: ['004'], c2: ['001'] })).bundle;
  const twice = prepareBundle(once, sets({ c1: ['004'], c2: ['001'] })).bundle;

  assert.deepEqual(totals(once.owned_cards), totals(original.owned_cards), 'nothing gained or lost');
  assert.equal(twice, once, 'the second pass is a no-op - the shape has settled');
});

/* ---------------- shape beats the stamp ---------------- */

test('a bundle CLAIMING v11 while carrying legacy rows is normalised anyway', () => {
  // Same reasoning as the boot marker: the stamp is a hint, the rows are the truth. A
  // hand-edited or interrupted export must not smuggle v10 rows in behind a v11 label.
  const b = bundleOf({ schemaVersion: 11, owned_cards: [owned({ variant_slug: LEGACY_UNCATEGORISED, qty_owned: 1 })] });
  assert.equal(hasLegacyRows(b), true);
  const { bundle } = prepareBundle(b, sets({ c1: ['001', '002'] }));
  assert.equal(bundle.owned_cards[0].variant_slug, UNCATEGORISED);
});

/* ---------------- rows from another device ---------------- */

test("rows carrying the SOURCE device's profile id are not split apart", () => {
  // Bundle rows arrive stamped with whatever profile they were exported from - sometimes
  // several, if a bundle was assembled oddly. Grouping on that id would scatter one card's
  // rows across phantom profiles and defeat the merge rules.
  const b = bundleOf({
    owned_cards: [
      owned({ id: 'a', profile_id: 'phone', variant_slug: LEGACY_UNCATEGORISED, qty_owned: 1 }),
      owned({ id: 'b', profile_id: 'tablet', variant_slug: LEGACY_UNCATEGORISED, qty_owned: 2 }),
    ],
  });
  const { bundle } = prepareBundle(b, sets({ c1: ['001', '002'] }));
  assert.equal(bundle.owned_cards.length, 1, 'one card, one uncategorised row');
  assert.equal(bundle.owned_cards[0].qty_owned, 3, 'merged rather than duplicated');
});

test('planner bookkeeping does not leak into the bundle', () => {
  // needsId / id / profile_id are decisions for the importer, which re-keys every row anyway.
  const b = bundleOf({ owned_cards: [owned({ qty_owned: 1 })] });
  const { bundle } = prepareBundle(b, sets({ c1: ['001'] }));
  for (const r of bundle.owned_cards) {
    assert.equal('needsId' in r, false);
    assert.equal('id' in r, false, 'the importer assigns fresh ids');
    assert.equal('profile_id' in r, false, 'the importer assigns the destination profile');
    assert.ok(r.card_id && 'qty_owned' in r && 'variant_slug' in r);
  }
});

test('an empty or absent owned_cards is fine, not an error', () => {
  assert.doesNotThrow(() => prepareBundle(bundleOf({ owned_cards: [] }), sets({})));
  assert.doesNotThrow(() => prepareBundle({ app: 'compendium', schemaVersion: 10 }, sets({})));
});
