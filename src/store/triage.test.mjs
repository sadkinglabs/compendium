// The To Be Categorised pile. What the user is asked, and what they are NOT asked.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  triagePile, pendingCount, autoResolvable, fileLinePlan, OWNED_NONFOIL, OWNED_FOIL, WANTED,
} from './triage.js';
import { UNCATEGORISED, UNCATEGORISED_FOIL, LEGACY_UNCATEGORISED, LEGACY_FOIL } from './printings.js';

const row = (o) => ({ card_id: 'c1', variant_slug: UNCATEGORISED, qty_owned: 0, qty_wanted: 0, ...o });
const sets = (map) => (id) => map[id] || [];

/* ---------------- what lands in the pile ---------------- */

test('only uncategorised rows appear', () => {
  const pile = triagePile([
    row({ variant_slug: UNCATEGORISED, qty_owned: 2 }),
    row({ card_id: 'c2', variant_slug: '001', qty_owned: 5 }),
    row({ card_id: 'c3', variant_slug: '002:f', qty_owned: 1 }),
  ], sets({ c1: ['001', '002'] }));
  assert.deepEqual(pile.map((e) => e.card_id), ['c1'], 'categorised rows are already resolved');
});

test('legacy rows are in the pile too, so a mixed ledger is fully triageable', () => {
  const pile = triagePile([
    row({ card_id: 'c1', variant_slug: LEGACY_UNCATEGORISED, qty_owned: 1 }),
    row({ card_id: 'c2', variant_slug: LEGACY_FOIL, qty_owned: 1 }),
  ], sets({ c1: ['001', '002'], c2: ['001', '002'] }));
  assert.deepEqual(pile.map((e) => e.card_id), ['c1', 'c2']);
});

test('a 0/0 row asks nothing', () => {
  assert.deepEqual(triagePile([row({ qty_owned: 0, qty_wanted: 0 })], sets({ c1: ['001'] })), []);
});

/* ---------------- owned and wanted are separate questions ---------------- */

test('owned copies and a want on the SAME card are two independent lines', () => {
  // Owning an Alpha copy while wanting the Beta one is ordinary. Collapsing these into one
  // question would force a collector to answer wrongly about one of them.
  const pile = triagePile([row({ qty_owned: 2, qty_wanted: 1 })], sets({ c1: ['001', '002'] }));
  assert.deepEqual(pile[0].lines.map((l) => l.kind), [OWNED_NONFOIL, WANTED]);
  assert.equal(pile[0].lines[0].qty, 2);
  assert.equal(pile[0].lines[1].qty, 1);
});

test('foil and non-foil copies are separate lines, and keep their finish', () => {
  const pile = triagePile([
    row({ variant_slug: UNCATEGORISED, qty_owned: 3 }),
    row({ variant_slug: UNCATEGORISED_FOIL, qty_owned: 1 }),
  ], sets({ c1: ['001', '002'] }));
  assert.deepEqual(pile[0].lines.map((l) => [l.kind, l.qty, l.foil]), [
    [OWNED_NONFOIL, 3, false],
    [OWNED_FOIL, 1, true],
  ]);
});

test('finish is never asked - it already survived migration', () => {
  // Only the SET was lost. Re-asking would invite the user to contradict their own ledger.
  const pile = triagePile([row({ variant_slug: UNCATEGORISED_FOIL, qty_owned: 2 })], sets({ c1: ['001', '002'] }));
  assert.equal(pile[0].lines[0].foil, true, 'the line states the finish rather than asking for it');
});

test('a want is one non-foil line even when it survived on a foil row', () => {
  // §7.4: legacy wants are non-foil. Migration never creates a foil want and no writer may.
  const pile = triagePile([row({ variant_slug: UNCATEGORISED_FOIL, qty_wanted: 4 })], sets({ c1: ['001', '002'] }));
  const wanted = pile[0].lines.filter((l) => l.kind === WANTED);
  assert.equal(wanted.length, 1);
  assert.equal(wanted[0].foil, false);
});

/* ---------------- quantities merge across both schemas ---------------- */

test('legacy and canonical rows for the same item merge into one line', () => {
  const pile = triagePile([
    row({ variant_slug: LEGACY_UNCATEGORISED, qty_owned: 2 }),
    row({ variant_slug: UNCATEGORISED, qty_owned: 3 }),
  ], sets({ c1: ['001', '002'] }));
  assert.equal(pile[0].lines.length, 1, 'one question, not two');
  assert.equal(pile[0].lines[0].qty, 5);
});

/* ---------------- resolvability ---------------- */

test('a card the catalog does not know is listed but marked unresolvable', () => {
  // It must still be visible - hiding it would leave copies the user can never account for -
  // but there is nothing to offer, so the surface cannot pretend otherwise.
  const pile = triagePile([row({ qty_owned: 1 })], sets({}));
  assert.equal(pile[0].resolvable, false);
  assert.deepEqual(pile[0].sets, []);
});

test('the pile is ordered stably, never by query order', () => {
  const a = triagePile([row({ card_id: 'z', qty_owned: 1 }), row({ card_id: 'a', qty_owned: 1 })], sets({}));
  const b = triagePile([row({ card_id: 'a', qty_owned: 1 }), row({ card_id: 'z', qty_owned: 1 })], sets({}));
  assert.deepEqual(a.map((e) => e.card_id), b.map((e) => e.card_id));
});

test('pendingCount counts decisions, not cards', () => {
  const pile = triagePile([
    row({ card_id: 'c1', qty_owned: 1, qty_wanted: 1 }),
    row({ card_id: 'c2', variant_slug: UNCATEGORISED_FOIL, qty_owned: 1 }),
  ], sets({ c1: ['001', '002'], c2: ['001', '002'] }));
  assert.equal(pendingCount(pile), 3, 'two lines on c1, one on c2');
});

/* ---------------- the one inference triage may make ---------------- */

test('single-set cards are offered for auto-resolution', () => {
  const pile = triagePile([row({ qty_owned: 2, qty_wanted: 1 })], sets({ c1: ['004'] }));
  assert.deepEqual(autoResolvable(pile), [
    { card_id: 'c1', set: '004', kind: OWNED_NONFOIL, qty: 2, foil: false },
    { card_id: 'c1', set: '004', kind: WANTED, qty: 1, foil: false },
  ]);
});

test('reprints are NEVER auto-resolvable', () => {
  const pile = triagePile([row({ qty_owned: 2 })], sets({ c1: ['001', '002'] }));
  assert.deepEqual(autoResolvable(pile), []);
});

/* ---------------- filing ---------------- */

test('filing a line names both halves of the move, with an explicit quantity', () => {
  // A move that reads a total and writes it elsewhere is how copies get duplicated. The plan
  // carries the amount so the caller cannot re-derive it wrongly.
  const pile = triagePile([row({ qty_owned: 3 })], sets({ c1: ['001', '002'] }));
  const plan = fileLinePlan(pile[0], pile[0].lines[0], '002');
  assert.equal(plan.card_id, 'c1');
  assert.equal(plan.qty, 3);
  assert.equal(plan.field, 'owned');
  assert.deepEqual(plan.to, { set: '002', foil: false });
  assert.equal(plan.from.slug, UNCATEGORISED);
  assert.equal(plan.legacySlug, LEGACY_UNCATEGORISED, 'a mixed ledger must be drained on both keys');
});

test('filing a FOIL line targets the foil destination and the foil legacy twin', () => {
  const pile = triagePile([row({ variant_slug: UNCATEGORISED_FOIL, qty_owned: 1 })], sets({ c1: ['001', '002'] }));
  const plan = fileLinePlan(pile[0], pile[0].lines[0], '001');
  assert.deepEqual(plan.to, { set: '001', foil: true });
  assert.equal(plan.from.slug, UNCATEGORISED_FOIL);
  assert.equal(plan.legacySlug, LEGACY_FOIL);
});

test('filing a WANT is a wanted move, not an owned one', () => {
  const pile = triagePile([row({ qty_wanted: 2 })], sets({ c1: ['001', '002'] }));
  const plan = fileLinePlan(pile[0], pile[0].lines[0], '002');
  assert.equal(plan.field, 'wanted');
  assert.equal(plan.to.foil, false, 'wants are non-foil');
});

test('filing without a destination is refused rather than silently dropped', () => {
  const pile = triagePile([row({ qty_owned: 1 })], sets({ c1: ['001', '002'] }));
  assert.throws(() => fileLinePlan(pile[0], pile[0].lines[0], ''), /destination set/);
});
