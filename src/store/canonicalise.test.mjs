// v10 -> v11 canonicalisation. These are the assertions the migration is allowed to be
// judged by: every one of them is about the user's data still meaning what they meant by it.
//
// The conservation tests matter most. A migration that loses a card is not a bug the user
// reports as "a bug" - they report it as "the app deleted my collection", and they are right.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planCard, planLedger, isLegacyKey, UNCATEGORISED as V11_UNCATEGORISED,
  UNCATEGORISED_FOIL as V11_UNCATEGORISED_FOIL,
} from './canonicalise.js';

const row = (o) => ({
  profile_id: 'p1', card_id: 'c1', variant_slug: '', qty_owned: 0, qty_wanted: 0,
  notes: '', created_at: '2026-01-01', updated_at: '2026-01-01', ...o,
});
const keyed = (rows) => Object.fromEntries(rows.map((r) => [r.variant_slug, r]));
const plan = (rows, sets) => planCard(rows, sets).rows;
const totals = (rows) => rows.reduce(
  (a, r) => ({ owned: a.owned + (r.qty_owned || 0), wanted: a.wanted + (r.qty_wanted || 0) }),
  { owned: 0, wanted: 0 },
);

/* ---------------- what counts as legacy ---------------- */

test('the empty string and the legacy foil row are the only keys rewritten', () => {
  assert.equal(isLegacyKey(''), true);
  assert.equal(isLegacyKey('foil'), true);
  assert.equal(isLegacyKey(null), true, 'a null slug reads as the empty bucket');
  assert.equal(isLegacyKey('001'), false);
  assert.equal(isLegacyKey('001:f'), false);
  assert.equal(isLegacyKey(V11_UNCATEGORISED), false, 'already v11 - not rewritten again');
});

/* ---------------- owned copies: a pure relabel ---------------- */

test('owned copies keep an unknown set, and keep their finish', () => {
  const out = keyed(plan([
    row({ variant_slug: '', qty_owned: 3 }),
    row({ variant_slug: 'foil', qty_owned: 2 }),
  ], ['001']));
  assert.equal(out[V11_UNCATEGORISED].qty_owned, 3);
  assert.equal(out[V11_UNCATEGORISED_FOIL].qty_owned, 2);
  assert.ok(!out['001'], 'a single set does NOT file owned copies - their set is genuinely unknown');
});

test('already-categorised rows are left completely alone', () => {
  const before = [row({ variant_slug: '001', qty_owned: 4 }), row({ variant_slug: '002:f', qty_owned: 1 })];
  const out = keyed(plan(before, ['001', '002']));
  assert.equal(out['001'].qty_owned, 4);
  assert.equal(out['002:f'].qty_owned, 1);
  assert.equal(Object.keys(out).length, 2);
});

/* ---------------- wants: the ruled behaviour ---------------- */

test('a want on a SINGLE-set card is filed to that set, non-foil', () => {
  const out = keyed(plan([row({ qty_wanted: 1 })], ['004']));
  assert.equal(out['004'].qty_wanted, 1);
  assert.ok(!out['004:f'], 'never foil - the owner ruled legacy wants are non-foil');
});

test('a want on a REPRINTED card is parked, not guessed', () => {
  // The whole reason v11 exists: guessing produced "ALPHA" for a card whose copies were Beta.
  const out = keyed(plan([row({ qty_wanted: 1 })], ['001', '002']));
  assert.equal(out[V11_UNCATEGORISED].qty_wanted, 1);
  assert.ok(!out['001'] && !out['002']);
});

test('a want on a card the catalog does not know is parked', () => {
  // A catalog gap is not a user decision, so it must not be resolved on the user's behalf.
  for (const sets of [[], null, undefined]) {
    const out = keyed(plan([row({ qty_wanted: 2 })], sets));
    assert.equal(out[V11_UNCATEGORISED].qty_wanted, 2, `sets=${JSON.stringify(sets)}`);
  }
});

/* ---------------- the split: one v10 row becomes two ---------------- */

test('a row holding BOTH owned copies and a want splits, and loses neither', () => {
  // This is the case that makes "just drop the empty-string rows" destructive: the wishlist
  // shares a row with ownership, so deleting the row deletes the want.
  const out = keyed(plan([row({ qty_owned: 2, qty_wanted: 1 })], ['004']));
  assert.equal(out[V11_UNCATEGORISED].qty_owned, 2, 'copies stay uncategorised');
  assert.equal(out[V11_UNCATEGORISED].qty_wanted, 0);
  assert.equal(out['004'].qty_wanted, 1, 'the want is filed to the sole set');
  assert.equal(out['004'].qty_owned, 0);
});

test('a want carried on a legacy FOIL row is preserved, not deleted', () => {
  // I previously asserted the opposite, reasoning that the app only ever wrote wants to the ''
  // row. That is true of the app and irrelevant to the data: nothing in the schema enforces it,
  // and imported or hand-edited ledgers can carry a want anywhere. The old behaviour silently
  // destroyed wishlist data on exactly the inputs we control least.
  const before = [row({ variant_slug: 'foil', qty_owned: 1, qty_wanted: 5 })];
  const out = keyed(plan(before, ['004']));
  assert.equal(out[V11_UNCATEGORISED_FOIL].qty_owned, 1, 'foil ownership keeps its finish');
  assert.equal(out['004'].qty_wanted, 5, 'the want survives, filed to the sole set');
  assert.deepEqual(totals(plan(before, ['004'])), totals(before), 'both totals conserved');
});

test('a want on a foil row is filed NON-foil, per the owner ruling', () => {
  // The row it sat on described its ownership finish, never the finish of the want.
  const out = keyed(plan([row({ variant_slug: 'foil', qty_wanted: 2 })], ['004']));
  assert.equal(out['004'].qty_wanted, 2);
  assert.ok(!out['004:f'], 'a foil want is never inferred');
});

test('a want on a foil row with a reprinted card is parked, still non-foil', () => {
  const out = keyed(plan([row({ variant_slug: 'foil', qty_wanted: 3 })], ['001', '002']));
  assert.equal(out[V11_UNCATEGORISED].qty_wanted, 3);
});

/* ---------------- identity ---------------- */

test('a split never emits two rows sharing one id', () => {
  // The source row physically exists once. Returning its id twice would violate the
  // owned_cards PRIMARY KEY and leave the adapter guessing which copy is authoritative.
  const { rows, releasedIds } = planCard([
    row({ id: 'row-1', variant_slug: '', qty_owned: 2, qty_wanted: 1 }),
  ], ['004']);
  assert.equal(rows.length, 2, 'the split produced two logical rows');
  const ids = rows.map((r) => r.id).filter((v) => v != null);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
  assert.ok(rows.every((r) => r.needsId === true && r.id === null), 'both are NEW rows');
  assert.deepEqual(releasedIds, ['row-1'], 'the source row is released for deletion');
});

test('a row already sitting at its destination key retains its id', () => {
  const { rows, releasedIds } = planCard([
    row({ id: 'keep', variant_slug: '004', qty_owned: 1 }),
    row({ id: 'legacy', variant_slug: '', qty_wanted: 2 }),
  ], ['004']);
  const out = keyed(rows);
  assert.equal(out['004'].id, 'keep', 'the row that already lived here keeps its identity');
  assert.equal(out['004'].needsId, false);
  assert.deepEqual(releasedIds, ['legacy'], 'only the consumed legacy row is released');
});

test('ids are unique across the WHOLE planned ledger, not just per card', () => {
  const { rows } = planLedger([
    row({ id: 'a', profile_id: 'p1', card_id: 'c1', variant_slug: '', qty_owned: 1, qty_wanted: 1 }),
    row({ id: 'b', profile_id: 'p1', card_id: 'c2', variant_slug: 'foil', qty_owned: 1, qty_wanted: 1 }),
    row({ id: 'c', profile_id: 'p2', card_id: 'c1', variant_slug: '004', qty_owned: 1 }),
  ], () => ['004']);
  const ids = rows.map((r) => r.id).filter((v) => v != null);
  assert.equal(new Set(ids).size, ids.length, 'no id appears twice anywhere in the plan');
});

test('every planned row declares its identity state explicitly', () => {
  // The adapter must never have to infer whether to UPDATE or INSERT.
  const { rows } = planLedger([row({ id: 'x', variant_slug: '', qty_owned: 1, qty_wanted: 1 })], () => ['004']);
  for (const r of rows) {
    assert.equal(typeof r.needsId, 'boolean');
    assert.equal(r.needsId, r.id === null, 'needsId and a null id always agree');
  }
});

/* ---------------- order independence ---------------- */

test('reversing the input rows produces the same logical plan', () => {
  // Database query order is not a semantic input.
  const rows = [
    row({ id: 'r1', variant_slug: '', qty_owned: 2, qty_wanted: 1 }),
    row({ id: 'r2', variant_slug: '004', qty_owned: 1, notes: 'signed' }),
    row({ id: 'r3', variant_slug: 'foil', qty_owned: 3 }),
  ];
  const shape = (p) => p.rows
    .map((r) => [r.variant_slug, r.qty_owned, r.qty_wanted, r.notes, r.id, r.needsId])
    .sort((a, b) => String(a).localeCompare(String(b)));

  const forward = planCard(rows, ['004']);
  const reversed = planCard(rows.slice().reverse(), ['004']);
  assert.deepEqual(shape(reversed), shape(forward));
  assert.deepEqual(reversed.releasedIds.slice().sort(), forward.releasedIds.slice().sort());
});

test('ledger-level conservation holds for wants on EVERY legacy key', () => {
  const before = [
    row({ card_id: 'c1', variant_slug: '', qty_owned: 1, qty_wanted: 2 }),
    row({ card_id: 'c2', variant_slug: 'foil', qty_owned: 3, qty_wanted: 4 }),
    row({ card_id: 'c3', variant_slug: '001', qty_owned: 1, qty_wanted: 5 }),
  ];
  const { rows } = planLedger(before, () => ['001', '002']);
  assert.deepEqual(totals(rows), totals(before), 'no want is lost on any key');
});

/* ---------------- collision ---------------- */

test('merging onto an existing destination row sums rather than overwriting', () => {
  const out = keyed(plan([
    row({ variant_slug: '004', qty_owned: 1, qty_wanted: 1, created_at: '2026-03-01', updated_at: '2026-03-01' }),
    row({ variant_slug: '', qty_wanted: 2, created_at: '2026-01-01', updated_at: '2026-06-01' }),
  ], ['004']));
  assert.equal(out['004'].qty_owned, 1);
  assert.equal(out['004'].qty_wanted, 3, 'existing 1 + migrated 2 - neither side wins silently');
  assert.equal(out['004'].created_at, '2026-01-01', 'earliest creation is kept');
  assert.equal(out['004'].updated_at, '2026-06-01', 'latest update is kept');
});

test('distinct notes are concatenated, and a re-merge does not duplicate them', () => {
  const out = keyed(plan([
    row({ variant_slug: '004', qty_owned: 1, notes: 'signed' }),
    row({ variant_slug: '', qty_wanted: 1, notes: 'want the misprint' }),
  ], ['004']));
  assert.ok(out['004'].notes.includes('signed'));
  assert.ok(out['004'].notes.includes('want the misprint'), 'a typed note is never discarded');

  const same = keyed(plan([
    row({ variant_slug: '004', qty_owned: 1, notes: 'signed' }),
    row({ variant_slug: '', qty_wanted: 1, notes: 'signed' }),
  ], ['004']));
  assert.equal(same['004'].notes, 'signed', 'identical notes collapse rather than repeating');
});

/* ---------------- tombstones ---------------- */

test('a 0/0 row is dropped, not carried forward', () => {
  assert.deepEqual(plan([row({ qty_owned: 0, qty_wanted: 0 })], ['004']), []);
});

test('a row that empties through merging is still dropped', () => {
  const out = plan([row({ variant_slug: '', qty_owned: 0, qty_wanted: 0, notes: 'stale' })], ['001', '002']);
  assert.deepEqual(out, [], 'notes alone do not justify keeping an empty ledger row');
});

/* ---------------- conservation, the assertion that matters ---------------- */

test('quantities are conserved per card across a messy ledger', () => {
  const before = [
    row({ variant_slug: '', qty_owned: 3, qty_wanted: 2 }),
    row({ variant_slug: 'foil', qty_owned: 1 }),
    row({ variant_slug: '001', qty_owned: 4, qty_wanted: 1 }),
  ];
  const after = plan(before, ['001', '002']);
  assert.deepEqual(totals(after), totals(before), 'nothing is created and nothing is lost');
});

test('no empty-string row survives anywhere', () => {
  const { rows } = planLedger([
    row({ variant_slug: '', qty_owned: 1 }),
    row({ card_id: 'c2', variant_slug: '', qty_wanted: 1 }),
    row({ card_id: 'c3', variant_slug: 'foil', qty_owned: 1 }),
  ], () => ['001', '002']);
  assert.equal(rows.filter((r) => r.variant_slug === '' || r.variant_slug === 'foil').length, 0);
});

/* ---------------- profiles ---------------- */

test('profiles are planned independently and never merge into each other', () => {
  const { rows } = planLedger([
    row({ profile_id: 'p1', qty_owned: 2 }),
    row({ profile_id: 'p2', qty_owned: 5 }),
  ], () => ['004']);
  const p1 = rows.filter((r) => r.profile_id === 'p1');
  const p2 = rows.filter((r) => r.profile_id === 'p2');
  assert.equal(p1.length, 1);
  assert.equal(p1[0].qty_owned, 2);
  assert.equal(p2[0].qty_owned, 5, "one profile's copies never land in another's ledger");
});

/* ---------------- idempotency ---------------- */

test('re-running over the result changes nothing, and reports nothing touched', () => {
  // The property that makes a crashed migration safe to retry, marker or no marker.
  const before = [
    row({ variant_slug: '', qty_owned: 3, qty_wanted: 2 }),
    row({ variant_slug: 'foil', qty_owned: 1 }),
    row({ variant_slug: '001', qty_owned: 4 }),
  ];
  const first = planLedger(before, () => ['001']);
  assert.ok(first.touched > 0, 'the first pass has work to do');

  const second = planLedger(first.rows, () => ['001']);
  assert.equal(second.touched, 0, 'the second pass is a no-op');
  assert.deepEqual(
    second.rows.map((r) => [r.variant_slug, r.qty_owned, r.qty_wanted]).sort(),
    first.rows.map((r) => [r.variant_slug, r.qty_owned, r.qty_wanted]).sort(),
  );
});

test('an already-v11 ledger is reported untouched', () => {
  const v11 = [row({ variant_slug: V11_UNCATEGORISED, qty_owned: 1 }), row({ variant_slug: '001', qty_owned: 2 })];
  assert.equal(planLedger(v11, () => ['001']).touched, 0);
});

/* ---------------- the catalog moved underneath us ---------------- */

test('a card that GAINED a set since the want was written is parked, not re-filed', () => {
  // The catalog is not frozen. A card that was Alpha-only when the heart was tapped may be a
  // reprint by the time this runs, and the honest answer is then "ask the user".
  const out = keyed(plan([row({ qty_wanted: 1 })], ['001', '002']));
  assert.equal(out[V11_UNCATEGORISED].qty_wanted, 1);
});

test('a card that LOST sets down to one is filed to the survivor', () => {
  const out = keyed(plan([row({ qty_wanted: 1 })], ['002']));
  assert.equal(out['002'].qty_wanted, 1);
});
