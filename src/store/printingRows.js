// Per-printing finish availability, from the catalog's variant metadata.
//
// v11's collector item is card + set + FINISH, where finish is the binary nonFoil/foil the
// ledger stores. But the catalog's `variants[].finish` has THREE labels - Standard, Foil, and
// Rainbow - and Rainbow appears only in the Promotional set (999). Rainbow is a foil treatment,
// so it normalises to the foil category; the owner ruled it a flavour of foil, not a third
// collector tier. Rainbow is catalog METADATA only - it is never stored, so no migration is
// involved. This module is where the three labels become the two the rest of the app speaks.
//
// The normaliser is EXHAUSTIVE and FAIL-CLOSED: a label it does not know throws, rather than
// being silently bucketed as non-foil. A future catalog drop with a fourth finish must stop the
// build (see printingRows.test.mjs's catalog-contract test), not quietly mis-file cards.

/** The finish labels this build understands. A fourth appearing in the catalog is a build stop. */
export const CATALOG_FINISHES = Object.freeze(['Standard', 'Foil', 'Rainbow']);

/**
 * One catalog finish label -> the binary collector finish.
 *
 * `Standard` is non-foil; `Foil` and `Rainbow` are both the foil category. Anything else throws:
 * the collector-item model is binary, and a finish we cannot place must not be guessed at.
 */
export function normalizeFinishLabel(label) {
  if (label === 'Standard') return 'nonFoil';
  if (label === 'Foil' || label === 'Rainbow') return 'foil';
  throw new Error(`normalizeFinishLabel: unknown catalog finish ${JSON.stringify(label)}`);
}

// `card.variants` is a JSON string in the DB (TEXT column) but an array when it arrives already
// parsed. Accept either; a malformed value reads as no variants rather than throwing, because a
// display helper must never take down a render.
function variantsOf(card) {
  const v = card?.variants;
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

/**
 * Which finishes a card's printing in one set actually has: `{ nonFoil, foil }`.
 *
 * Read from the variants of that set, each label run through the normaliser. A set the card is
 * listed in but for which the catalog carries NO variant data reads as non-foil-only - the
 * conservative default that matches the product rule and cannot invent a foil that may not
 * exist. So a foil-only printing (Winter River in Alpha) is `{ nonFoil: false, foil: true }`,
 * a rainbow-only promo is likewise foil-only, and a promo with both Foil and Rainbow collapses
 * to one available foil.
 */
export function printingFinishes(card, setCode) {
  const mine = variantsOf(card).filter((v) => v && v.set === setCode);
  if (!mine.length) return { nonFoil: true, foil: false };
  let nonFoil = false;
  let foil = false;
  for (const v of mine) {
    const cat = normalizeFinishLabel(v.finish);   // throws on an unknown label - fail closed
    if (cat === 'nonFoil') nonFoil = true;
    else foil = true;
  }
  return { nonFoil, foil };
}
