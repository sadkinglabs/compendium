// Increment 1: Rainbow finish semantics.
//
// Two kinds of test here. Fixture tests pin the normaliser and printingFinishes on synthetic
// cards, deterministically. The CATALOG-CONTRACT test reads the real bundled catalog and fails
// the build if a finish label appears that this build does not know - the guard that stops a
// future catalog drop from silently mis-filing a fourth finish (a SELECT-1-class "passed every
// gate, broke on the data" defect, caught before it ships).
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CATALOG_FINISHES, normalizeFinishLabel, printingFinishes } from './printingRows.js';

const require = createRequire(import.meta.url);

// A card whose variants carry (set, finish). Variants may be an array or a JSON string - both
// occur at runtime (parsed catalog vs the raw DB TEXT column), so both are tested.
const card = (variants, { asString = false } = {}) => ({
  card_id: 'c', name: 'C',
  variants: asString ? JSON.stringify(variants) : variants,
});
const V = (set, finish) => ({ set, finish });
const V2 = (set, finish, image) => ({ set, finish, image });
const P = (set, finish, product) => ({ set, finish, product });

/* ---------------- the normaliser ---------------- */

test('Standard is non-foil; Foil and Rainbow are both foil', () => {
  assert.equal(normalizeFinishLabel('Standard'), 'nonFoil');
  assert.equal(normalizeFinishLabel('Foil'), 'foil');
  assert.equal(normalizeFinishLabel('Rainbow'), 'foil', 'Rainbow is a flavour of foil');
});

test('an unknown finish label throws - fail closed, never guessed', () => {
  assert.throws(() => normalizeFinishLabel('Holographic'), /unknown catalog finish/);
  assert.throws(() => normalizeFinishLabel(undefined), /unknown catalog finish/);
  assert.throws(() => normalizeFinishLabel(''), /unknown catalog finish/);
});

/* ---------------- printingFinishes ---------------- */

test('a set with both Standard and Foil has both finishes', () => {
  assert.deepEqual(printingFinishes(card([V('001', 'Standard'), V('001', 'Foil')]), '001'),
    { nonFoil: true, foil: true });
});

test('a foil-only printing (Winter River in Alpha) is foil, not non-foil', () => {
  assert.deepEqual(printingFinishes(card([V('001', 'Foil')]), '001'), { nonFoil: false, foil: true });
});

test('a rainbow-only promo is foil-only - Rainbow collapses into the foil slot', () => {
  assert.deepEqual(printingFinishes(card([V('999', 'Rainbow')]), '999'), { nonFoil: false, foil: true });
});

test('a promo with Foil AND Rainbow collapses to one available foil', () => {
  // The four dual promos (Druid, Witch, Sorcerer, Spellslinger). Standard present here too.
  assert.deepEqual(printingFinishes(card([V('999', 'Standard'), V('999', 'Foil'), V('999', 'Rainbow')]), '999'),
    { nonFoil: true, foil: true });
  // Foil + Rainbow with no Standard is foil-only.
  assert.deepEqual(printingFinishes(card([V('999', 'Foil'), V('999', 'Rainbow')]), '999'),
    { nonFoil: false, foil: true });
});

test('a standard-only printing is non-foil only', () => {
  assert.deepEqual(printingFinishes(card([V('006', 'Standard')]), '006'), { nonFoil: true, foil: false });
});

test('a set with NO variant data reads as non-foil only - conservative, invents no foil', () => {
  // A card listed in a set but with no variants entry for it (the P6 fallback).
  assert.deepEqual(printingFinishes(card([V('001', 'Foil')]), '002'), { nonFoil: true, foil: false });
  assert.deepEqual(printingFinishes(card([]), '001'), { nonFoil: true, foil: false });
});

test('only THIS set is considered, not the card overall', () => {
  const c = card([V('001', 'Standard'), V('999', 'Foil')]);
  assert.deepEqual(printingFinishes(c, '001'), { nonFoil: true, foil: false });
  assert.deepEqual(printingFinishes(c, '999'), { nonFoil: false, foil: true });
});

test('variants parse from a JSON string exactly as from an array', () => {
  const asArr = printingFinishes(card([V('001', 'Standard'), V('001', 'Foil')]), '001');
  const asStr = printingFinishes(card([V('001', 'Standard'), V('001', 'Foil')], { asString: true }), '001');
  assert.deepEqual(asStr, asArr);
});

test('printingFinishes THROWS on malformed variants - the durable boundary fails closed', () => {
  // Corrupt catalog metadata must not be read as a valid non-foil-only printing and authorise
  // an item the catalog never established. Display degrades; authorisation rejects.
  assert.throws(() => printingFinishes({ variants: '{not json' }, '001'), /malformed variants JSON/);
  assert.throws(() => printingFinishes({ variants: '{"broken":true}' }, '001'), /variants must be an array/);
  assert.throws(() => printingFinishes({ variants: { broken: true } }, '001'), /variants must be an array/);
  assert.throws(() => printingFinishes({ variants: null }, '001'), /variants must be an array/);
});

test('a VALID array with no entry for the set is still non-foil-only (the blessed fallback)', () => {
  assert.deepEqual(printingFinishes(card([V('002', 'Standard')]), '001'), { nonFoil: true, foil: false });
  assert.deepEqual(printingFinishes(card([]), '001'), { nonFoil: true, foil: false });
});

test('authoritativeVariantsOf accepts arrays and valid JSON, throws on the rest', async () => {
  const { authoritativeVariantsOf } = await import('./printingRows.js');
  assert.deepEqual(authoritativeVariantsOf({ variants: [V('001', 'Standard')] }), [V('001', 'Standard')]);
  assert.deepEqual(authoritativeVariantsOf({ variants: '[{"set":"001","finish":"Standard"}]' }), [{ set: '001', finish: 'Standard' }]);
  assert.deepEqual(authoritativeVariantsOf({ variants: [] }), [], 'a valid empty array is fine - the standard-only fallback');
  assert.throws(() => authoritativeVariantsOf({ variants: '{not json' }), /malformed variants JSON/);
  assert.throws(() => authoritativeVariantsOf({ variants: '{}' }), /variants must be an array/);
  assert.throws(() => authoritativeVariantsOf({ variants: 42 }), /variants must be an array/);
});

test('authoritativeVariantsOf validates EVERY entry, not just the outer array', async () => {
  // The gap Codex found: `finishesFrom` filters entries by set and silently ignores the rest, so
  // a malformed but array-shaped record read as "no variant for this set" and fell through to the
  // standard-only fallback - authorising a phantom item. Every entry must be a well-shaped object
  // with a string set and a KNOWN finish, or the whole card is rejected.
  const { authoritativeVariantsOf } = await import('./printingRows.js');
  assert.throws(() => authoritativeVariantsOf({ variants: ['bad'] }), /invalid variant at 0/);
  assert.throws(() => authoritativeVariantsOf({ variants: [null] }), /invalid variant at 0/);
  assert.throws(() => authoritativeVariantsOf({ variants: [[]] }), /invalid variant at 0/, 'a nested array is not a variant object');
  assert.throws(() => authoritativeVariantsOf({ variants: [{ set: 123, finish: 'Foil' }] }), /invalid variant at 0/, 'a numeric set is not a string set');
  assert.throws(() => authoritativeVariantsOf({ variants: [{ set: '  ', finish: 'Foil' }] }), /invalid variant at 0/, 'a blank set is rejected');
  assert.throws(() => authoritativeVariantsOf({ variants: [{ set: '001' }] }), /unknown catalog finish/, 'a missing finish is rejected via the normaliser');
  assert.throws(() => authoritativeVariantsOf({ variants: [{ set: '002', finish: 'Future' }] }), /unknown catalog finish/, 'an unknown finish for ANOTHER set still rejects the whole card');
});

test('printingFinishes rejects the phantom-item cases, does not fall through to standard', () => {
  // The consequence of the gap, at the durable boundary: each of these once produced a standard
  // item for set 001; now each throws instead of authorising nothing the catalog established.
  assert.throws(() => printingFinishes({ variants: ['bad'] }, '001'), /invalid variant at 0/);
  assert.throws(() => printingFinishes({ variants: [{ set: 123, finish: 'Foil' }] }, '001'), /invalid variant at 0/);
  assert.throws(() => printingFinishes({ variants: [{ set: '002', finish: 'Future' }] }, '001'), /unknown catalog finish/);
});

/* ---------------- the catalog contract ---------------- */

test('CATALOG CONTRACT: the bundled catalog contains exactly the finishes this build knows', () => {
  // If this fails, a catalog drop introduced a finish label the normaliser would throw on.
  // Resolve the new label deliberately (extend the normaliser + this contract) rather than
  // letting it reach a surface. This is the build stop the whole fail-closed design exists for.
  const cards = Object.values(require('../../public/catalog/cards.json'));
  const seen = new Set();
  for (const c of cards) for (const v of (c.variants || [])) if (v && v.finish != null) seen.add(v.finish);

  assert.deepEqual([...seen].sort(), [...CATALOG_FINISHES].sort(),
    `catalog finishes ${JSON.stringify([...seen].sort())} differ from the known set ${JSON.stringify([...CATALOG_FINISHES].sort())}`);

  // And every real label must pass the normaliser without throwing.
  for (const label of seen) assert.doesNotThrow(() => normalizeFinishLabel(label), `normaliser rejects real label ${label}`);
});

test('CATALOG CONTRACT: printingFinishes never throws across the entire catalog', () => {
  // Exercises the normaliser on every real printing - the corpus proof that nothing in the
  // shipped data trips the fail-closed throw.
  const cards = Object.values(require('../../public/catalog/cards.json'));
  for (const c of cards) for (const s of (c.sets || [])) {
    assert.doesNotThrow(() => printingFinishes(c, s.code), `${c.name} / ${s.code}`);
  }
});

test('CATALOG CONTRACT: every bundled card passes strict entry validation', async () => {
  // The finish enumeration above skips entries with a null finish, so it would not catch a
  // structurally-malformed entry like ['bad']. This runs the strict schema check over every card
  // so a future drop that ships a wrongly-shaped variant entry stops the build here.
  const { authoritativeVariantsOf } = await import('./printingRows.js');
  const cards = Object.values(require('../../public/catalog/cards.json'));
  for (const c of cards) {
    assert.doesNotThrow(() => authoritativeVariantsOf(c), `${c.name} (${c.card_id}) has a malformed variant entry`);
  }
});

/* ================= increment 2: expansion, art, origins ================= */
import {
  expandItemRows, isRefusalRow, printingArt, printingProducts,
} from './printingRows.js';

const cardWith = (id, sets, variants) => ({
  card_id: id, name: id, image_slug: `${id}-default.webp`,
  sets: JSON.stringify(sets.map((c) => ({ code: c, name: { '001': 'Alpha', '002': 'Beta', '999': 'Promotional' }[c] || c }))),
  variants,
});

/* ---------------- expandItemRows ---------------- */

test('a multi-set card unpacks into one row per printing, in set-rank order', () => {
  const rows = expandItemRows([cardWith('c', ['002', '001'], [])]);
  assert.deepEqual(rows.map((r) => r.set), ['001', '002'], 'Alpha before Beta by rank, not input order');
  assert.deepEqual(rows.map((r) => r.key), ['c|001', 'c|002']);
});

test('setTerms filter the PRINTINGS, not the card - only the matching rows survive', () => {
  const rows = expandItemRows([cardWith('c', ['001', '002'], [])], ['beta']);
  assert.deepEqual(rows.map((r) => r.set), ['002'], 'set:beta leaves only the Beta row');
});

test('multiple set terms OR across tokens', () => {
  const rows = expandItemRows([cardWith('c', ['001', '002', '999'], [])], ['alpha', 'beta']);
  assert.deepEqual(rows.map((r) => r.set).sort(), ['001', '002']);
});

test('a doubled catalog set entry becomes ONE row', () => {
  const card = { card_id: 'c', name: 'c', sets: JSON.stringify([{ code: '001', name: 'Alpha' }, { code: '001', name: 'Alpha' }]), variants: [] };
  assert.equal(expandItemRows([card]).length, 1);
});

test('a card with no sets is a single refusal row, listed but unfileable', () => {
  const card = { card_id: 'c', name: 'c', sets: '[]', variants: [] };
  const rows = expandItemRows([card]);
  assert.equal(rows.length, 1);
  assert.equal(isRefusalRow(rows[0]), true);
  assert.equal(rows[0].key, 'c|');
});

test('each row carries its finish availability', () => {
  const rows = expandItemRows([cardWith('c', ['001'], [V('001', 'Foil')])]);
  assert.deepEqual(rows[0].finishes, { nonFoil: false, foil: true });
});

/* ---------------- printingArt ---------------- */

test('art follows set and finish', () => {
  const c = cardWith('c', ['001'], [V2('001', 'Standard', '001-s.webp'), V2('001', 'Foil', '001-f.webp')]);
  assert.equal(printingArt(c, '001', false), '001-s.webp');
  assert.equal(printingArt(c, '001', true), '001-f.webp');
});

test('a collapsed foil item prefers the Rainbow art', () => {
  const c = cardWith('d', ['999'], [V2('999', 'Foil', '999-d.webp'), V2('999', 'Rainbow', '999-op.webp')]);
  assert.equal(printingArt(c, '999', true), '999-op.webp', 'the premium face fronts the foil item');
});

test('art falls back to the other finish, then the card default, then null', () => {
  const otherFinish = cardWith('c', ['001'], [V2('001', 'Foil', '001-f.webp')]);
  assert.equal(printingArt(otherFinish, '001', false), '001-f.webp', 'no NF art -> show the foil art rather than Alpha default');
  const noneForSet = cardWith('c', ['001'], [V2('002', 'Standard', '002-s.webp')]);
  assert.equal(printingArt(noneForSet, '001', false), 'c-default.webp', 'no variant art for the set -> card default');
  const noDefault = { card_id: 'c', name: 'c', image_slug: null, sets: '[]', variants: [] };
  assert.equal(printingArt(noDefault, '001', false), null, 'nothing -> null, caller draws the placeholder');
});

test('printingArt returns a SLUG, never a URL (CDN-ready seam)', () => {
  const c = cardWith('c', ['001'], [V2('001', 'Standard', '001-s.webp')]);
  const art = printingArt(c, '001', false);
  assert.ok(!/^https?:|^\//.test(art), 'a bare slug, resolved later by cardImageUrl');
});

/* ---------------- printingProducts ---------------- */

test('origins are the distinct human-readable products for the item', () => {
  const c = cardWith('d', ['999'], [
    P('999', 'Foil', 'Dust'), P('999', 'Rainbow', 'Organized_Play'), P('999', 'Standard', 'Booster'),
  ]);
  assert.deepEqual(printingProducts(c, '999', true), ['Dust', 'Organized Play'], 'foil item aggregates Foil + Rainbow origins, humanized');
  assert.deepEqual(printingProducts(c, '999', false), ['Booster'], 'non-foil item shows its own origin');
});

test('origins dedupe and keep first-appearance order', () => {
  const c = cardWith('c', ['001'], [P('001', 'Foil', 'Box_Topper'), P('001', 'Rainbow', 'Box_Topper')]);
  assert.deepEqual(printingProducts(c, '001', true), ['Box Topper']);
});

/* ---------------- corpus ---------------- */

test('CATALOG CORPUS: expansion + art + products never throw over the whole catalog', () => {
  const cards = Object.values(require('../../public/catalog/cards.json')).map((c) => ({
    ...c, sets: JSON.stringify(c.sets || []), variants: c.variants || [],
  }));
  assert.doesNotThrow(() => {
    const rows = expandItemRows(cards);
    for (const r of rows) {
      if (isRefusalRow(r)) continue;
      printingArt(r.card, r.set, false); printingArt(r.card, r.set, true);
      printingProducts(r.card, r.set, false); printingProducts(r.card, r.set, true);
    }
  });
});

/* ---------------- display degrades where authorisation would reject ---------------- */

test('expandItemRows DEGRADES on malformed variants - a display row, not a crash', () => {
  // The strict/permissive split: the sheet keeps rendering; the durable writer re-checks and
  // rejects. A malformed card shows as a non-foil row rather than taking down the sheet.
  const bad = { card_id: 'c', name: 'c', sets: JSON.stringify([{ code: '001', name: 'Alpha' }]), variants: '{not json' };
  const rows = expandItemRows([bad]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].finishes, { nonFoil: true, foil: false }, 'degraded, not thrown');
});

test('printingArt and printingProducts stay permissive on malformed variants', () => {
  const bad = { card_id: 'c', name: 'c', image_slug: 'c-default.webp', variants: '{not json' };
  assert.equal(printingArt(bad, '001', false), 'c-default.webp', 'falls back to the card default');
  assert.deepEqual(printingProducts(bad, '001', false), [], 'no origins, no throw');
});

/* ---------------- defaultSetRank matches the canonical contract ---------------- */

test('the default set rank orders numeric codes and sinks non-numeric ones last', () => {
  // Exercised via expandItemRows with no injected setRank (the default). Numeric order, and a
  // non-numeric code sorts AFTER Promotional (999) - matching sets.js's MAX_SAFE_INTEGER, not 99.
  const card = { card_id: 'c', name: 'c', variants: '[]',
    sets: JSON.stringify([{ code: 'XX', name: 'Future' }, { code: '999', name: 'Promo' }, { code: '001', name: 'Alpha' }, { code: '002', name: 'Beta' }]) };
  assert.deepEqual(expandItemRows([card]).map((r) => r.set), ['001', '002', '999', 'XX'],
    'numeric ascending, non-numeric last (not undercutting 999)');
});
