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

test('malformed variants read as none rather than throwing', () => {
  assert.deepEqual(printingFinishes({ variants: '{not json' }, '001'), { nonFoil: true, foil: false });
  assert.deepEqual(printingFinishes({ variants: null }, '001'), { nonFoil: true, foil: false });
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
