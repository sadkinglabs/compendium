// THE CONTRACT between everything that writes a `variant_slug` and everything that reads one.
//
// This file exists because that contract was broken silently. The canonicaliser declared its own
// copy of the v11 strings while printings.js still said '', so canonicalisation produced rows
// that no reader recognised: `isUncategorised('uncategorised')` was false, and converted copies
// would have vanished from the Collection. Every module involved passed its own tests.
//
// So these assertions deliberately cross module boundaries. A test that stays inside one module
// cannot catch a disagreement between two.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_UNCATEGORISED, LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL, UNCATEGORISED_BUCKET,
  isUncategorised, isLegacyPrinting, isFoilPrinting, parsePrinting, printingSlugs,
  canonicalPrinting, SQL_IS_FOIL, SQL_IS_LEGACY, SQL_IS_UNCATEGORISED,
} from './printings.js';
import { planCard } from './canonicalise.js';

const row = (o) => ({
  id: 'r1', profile_id: 'p1', card_id: 'c1', variant_slug: LEGACY_UNCATEGORISED,
  qty_owned: 0, qty_wanted: 0, notes: '', created_at: '2026-01-01', updated_at: '2026-01-01', ...o,
});

/* ---------------- one source of truth ---------------- */

test('the four keys are distinct, and no two of them collide', () => {
  const keys = [LEGACY_UNCATEGORISED, LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL];
  assert.equal(new Set(keys).size, 4, 'each key must be distinguishable from the others');
});

test('the canonicaliser emits the SAME strings printings.js declares', () => {
  // The drift check, stated directly. If canonicalise.js ever redeclares these values, this
  // fails - which is the only reason the original bug survived review.
  const { rows } = planCard([row({ variant_slug: LEGACY_UNCATEGORISED, qty_owned: 1 })], ['001', '002']);
  assert.equal(rows[0].variant_slug, UNCATEGORISED);

  const foil = planCard([row({ variant_slug: LEGACY_FOIL, qty_owned: 1 })], ['001', '002']);
  assert.equal(foil.rows[0].variant_slug, UNCATEGORISED_FOIL);
});

/* ---------------- planner output is readable ---------------- */

test('EVERY key the planner can emit is recognised by the readers', () => {
  // Exercises each destination the planner has: uncategorised non-foil, uncategorised foil,
  // and a real set. Whatever it produces must survive a round trip through the read primitives.
  const cases = [
    { rows: [row({ variant_slug: LEGACY_UNCATEGORISED, qty_owned: 1 })], sets: ['001', '002'] },
    { rows: [row({ variant_slug: LEGACY_FOIL, qty_owned: 1 })], sets: ['001', '002'] },
    { rows: [row({ variant_slug: LEGACY_UNCATEGORISED, qty_wanted: 1 })], sets: ['004'] },
    { rows: [row({ variant_slug: LEGACY_UNCATEGORISED, qty_owned: 2, qty_wanted: 1 })], sets: ['004'] },
  ];
  for (const c of cases) {
    for (const r of planCard(c.rows, c.sets).rows) {
      const slug = r.variant_slug;
      assert.equal(isLegacyPrinting(slug), false, `planner emitted a LEGACY key: ${slug}`);
      const parsed = parsePrinting(slug);
      assert.equal(typeof parsed.set, 'string', `unparseable: ${slug}`);
      assert.equal(typeof parsed.foil, 'boolean');
      // A planner key is either a real set or the uncategorised bucket. Nothing else exists.
      const known = parsed.set === UNCATEGORISED_BUCKET || /^\d+$/.test(parsed.set);
      assert.ok(known, `planner emitted an unbucketable key: ${slug} -> ${parsed.set}`);
    }
  }
});

test('a canonical uncategorised row buckets exactly where a legacy one did', () => {
  // The invariant that lets a MIXED ledger group correctly while the migration is half-adopted.
  assert.deepEqual(parsePrinting(UNCATEGORISED), parsePrinting(LEGACY_UNCATEGORISED));
  assert.deepEqual(parsePrinting(UNCATEGORISED_FOIL), parsePrinting(LEGACY_FOIL));
});

/* ---------------- finish agrees across both schemas ---------------- */

test('foil classification agrees between legacy and canonical forms', () => {
  assert.equal(isFoilPrinting(LEGACY_FOIL), true);
  assert.equal(isFoilPrinting(UNCATEGORISED_FOIL), true);
  assert.equal(isFoilPrinting(LEGACY_UNCATEGORISED), false);
  assert.equal(isFoilPrinting(UNCATEGORISED), false);
  assert.equal(parsePrinting(LEGACY_FOIL).foil, parsePrinting(UNCATEGORISED_FOIL).foil);
  assert.equal(parsePrinting(LEGACY_UNCATEGORISED).foil, parsePrinting(UNCATEGORISED).foil);
});

test('all four uncategorised forms answer yes to isUncategorised', () => {
  for (const k of [LEGACY_UNCATEGORISED, LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL]) {
    assert.equal(isUncategorised(k), true, `not recognised: ${JSON.stringify(k)}`);
  }
  assert.equal(isUncategorised('001'), false);
  assert.equal(isUncategorised('001:f'), false);
});

/* ---------------- exact-slug reads name both schemas ---------------- */

test('printingSlugs names BOTH schemas for the uncategorised bucket', () => {
  // A read that named only two slugs stopped matching the moment canonicalisation rewrote the
  // row it was looking for. The uncategorised bucket is the only place the schemas disagree.
  assert.deepEqual(printingSlugs(UNCATEGORISED_BUCKET, false).sort(), [LEGACY_UNCATEGORISED, UNCATEGORISED].sort());
  assert.deepEqual(printingSlugs(UNCATEGORISED_BUCKET, true).sort(), [LEGACY_FOIL, UNCATEGORISED_FOIL].sort());
  assert.deepEqual(printingSlugs('001', false), ['001']);
  assert.deepEqual(printingSlugs('001', true), ['001:f']);
});

/* ---------------- the SQL predicates say the same thing as the JS ---------------- */

test('SQL predicates agree with the JS predicates on every key', async () => {
  // Two languages, one meaning. These drifted apart once already; a shared declaration is only
  // half the fix, and this is the other half.
  const initSqlJs = (await import('sql.js')).default;
  const { readFileSync } = await import('node:fs');
  const SQL = await initSqlJs({ wasmBinary: readFileSync('node_modules/sql.js/dist/sql-wasm.wasm') });
  const db = new SQL.Database();
  db.run("CREATE TABLE t(variant_slug TEXT NOT NULL DEFAULT '');");

  const keys = [LEGACY_UNCATEGORISED, LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL, '001', '001:f'];
  for (const k of keys) db.run('INSERT INTO t(variant_slug) VALUES(?);', [k]);

  const matched = (frag) => {
    const res = db.exec(`SELECT variant_slug FROM t WHERE ${frag};`);
    return res.length ? res[0].values.map((v) => v[0]) : [];
  };

  assert.deepEqual(matched(SQL_IS_FOIL()).sort(), keys.filter(isFoilPrinting).sort(), 'SQL_IS_FOIL');
  assert.deepEqual(matched(SQL_IS_LEGACY()).sort(), keys.filter(isLegacyPrinting).sort(), 'SQL_IS_LEGACY');
  assert.deepEqual(matched(SQL_IS_UNCATEGORISED()).sort(), keys.filter(isUncategorised).sort(), 'SQL_IS_UNCATEGORISED');

  db.close();
});

/* ---------------- the write side ---------------- */

test('canonicalPrinting NEVER returns a legacy key, for any input', () => {
  // A v11 writer that returned a legacy key would quietly reintroduce the exact state the
  // migration exists to remove - and nothing downstream would complain, because legacy keys
  // are still perfectly readable.
  const inputs = [
    ['', false], ['', true], [null, false], [null, true], [undefined, false],
    [UNCATEGORISED_BUCKET, false], [UNCATEGORISED_BUCKET, true],
    ['001', false], ['001', true], ['999', true],
  ];
  for (const [set, foil] of inputs) {
    const slug = canonicalPrinting(set, foil);
    assert.equal(isLegacyPrinting(slug), false, `legacy key for (${JSON.stringify(set)}, ${foil})`);
    assert.equal(isFoilPrinting(slug), foil, `finish lost for (${JSON.stringify(set)}, ${foil})`);
  }
});

test('canonicalPrinting round-trips through parsePrinting', () => {
  // Write it, read it back, get the same collector item. If these two ever disagree, a written
  // row buckets somewhere other than where the writer intended.
  for (const set of [UNCATEGORISED_BUCKET, '001', '004']) {
    for (const foil of [false, true]) {
      const parsed = parsePrinting(canonicalPrinting(set, foil));
      assert.deepEqual(parsed, { set, foil }, `round trip failed for (${set}, ${foil})`);
    }
  }
});

test('canonicalPrinting output is always found by printingSlugs', () => {
  // The read side must name the key the write side produces, or an edited row becomes
  // invisible to the very lookup that should find it.
  for (const set of [UNCATEGORISED_BUCKET, '001']) {
    for (const foil of [false, true]) {
      assert.ok(
        printingSlugs(set, foil).includes(canonicalPrinting(set, foil)),
        `printingSlugs(${set}, ${foil}) does not include its own canonical key`,
      );
    }
  }
});

/* ---------------- what is NOT yet true, stated on purpose ---------------- */

test('writers still emit legacy keys - this is the pre-activation state, recorded not assumed', async () => {
  // Step 1 makes readers capable of understanding canonical rows BEFORE anything writes them.
  // Writers are switched in the activation commit. Asserting the current state here means the
  // change of behaviour has to be deliberate: whoever flips the writers must update this test,
  // and cannot do it by accident.
  const src = await (await import('node:fs/promises')).readFile('src/store/ownedRepository.js', 'utf8');
  assert.match(src, /const vslug = /, 'the writer helper still exists');
  assert.ok(
    src.includes('LEGACY_FOIL') && src.includes('LEGACY_UNCATEGORISED'),
    'the writer names the LEGACY constants explicitly, so the transition is visible in the source',
  );
});
