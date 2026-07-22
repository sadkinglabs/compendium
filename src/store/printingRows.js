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

import { matchesSetTerms } from './cardQuery.js';

/** The finish labels this build understands. A fourth appearing in the catalog is a build stop. */
export const CATALOG_FINISHES = Object.freeze(['Standard', 'Foil', 'Rainbow']);

// The label -> category map, non-throwing (`null` for unknown). Availability logic wraps this in
// the fail-closed `normalizeFinishLabel`; the DISPLAY helpers (art, products) use it directly and
// simply skip an unknown finish, because a picture must never take a render down.
function finishCategory(label) {
  if (label === 'Standard') return 'nonFoil';
  if (label === 'Foil' || label === 'Rainbow') return 'foil';
  return null;
}

/**
 * One catalog finish label -> the binary collector finish.
 *
 * `Standard` is non-foil; `Foil` and `Rainbow` are both the foil category. Anything else throws:
 * the collector-item model is binary, and a finish we cannot place must not be guessed at. This
 * is the fail-closed gate the catalog-contract test relies on.
 */
export function normalizeFinishLabel(label) {
  const cat = finishCategory(label);
  if (cat === null) throw new Error(`normalizeFinishLabel: unknown catalog finish ${JSON.stringify(label)}`);
  return cat;
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

// A card's sets ([{ code, name }]), parsed and DEDUPED by code. A catalog entry that lists the
// same set twice must not become two identical printing rows.
function setsOf(card) {
  let raw = card?.sets;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = []; } }
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    const code = s?.code;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name: s.name || code });
  }
  return out;
}

// Default printing order: numeric set code (001 Alpha < 002 Beta < ... < 999 Promo), which
// equals the app's canonical SET_RANK for every current set. Production injects SET_RANK so the
// two never drift; keeping the default here lets this module stay free of the set-catalog JSON
// (and its non-DB test import). A non-numeric code sorts last, deterministically.
const defaultSetRank = (code) => { const n = Number(code); return Number.isFinite(n) ? n : 99; };

/** True when this expanded row has no real printing to file - a catalog-unknown card. */
export const isRefusalRow = (row) => !!row?.refusal;

/**
 * Expand catalog cards into ONE ROW PER PRINTING - the shape the item-grain add surface renders.
 *
 * This is the reframe: selecting a row selects the collector item, because the row already
 * carries `card_id + set`. A multi-set card unpacks into a row per set; `setTerms` (from
 * `parseQuery`, Codex Major 7) filters those rows so `set:beta` leaves only the Beta rows and
 * "Select all" cannot ask a printing question there is no longer anything to ask.
 *
 * A card the catalog places in NO set produces a single refusal row - listed so its copies are
 * not silently hidden, but offering nothing to file (§4).
 */
export function expandItemRows(cards, setTerms = [], setRank = defaultSetRank) {
  const rows = [];
  for (const card of cards || []) {
    const sets = setsOf(card);
    if (!sets.length) {
      rows.push({ card, refusal: true, key: `${card.card_id}|` });
      continue;
    }
    const ordered = sets.slice().sort((a, b) => (setRank(a.code) ?? 99) - (setRank(b.code) ?? 99));
    for (const s of ordered) {
      if (!matchesSetTerms(`${s.code} ${s.name}`, setTerms)) continue;
      rows.push({
        card,
        set: s.code,
        setName: s.name,
        finishes: printingFinishes(card, s.code),
        key: `${card.card_id}|${s.code}`,
      });
    }
  }
  return rows;
}

/**
 * The image slug for one collector item (card + set + finish), or null.
 *
 * Returns a SLUG, never a URL - rendering routes it through `cardArt.js`'s `cardImageUrl`, the
 * single seam that decides bundled-vs-CDN and honours zero-image mode. So this is CDN-ready by
 * construction: when card art moves to a CDN, only `cardImageUrl` changes.
 *
 * Deterministic fallback chain:
 *   1. a variant of this set in the requested finish, with an image. When `foil` and the set
 *      has both a Foil and a Rainbow variant (the 4 dual promos), PREFER the Rainbow art - the
 *      premium face fronts the collapsed foil item, by rule not by ordering accident.
 *   2. else a variant of this set in the OTHER finish, with an image (a Beta foil still shows
 *      Beta art, not the card's Alpha default).
 *   3. else the card's default `image_slug`.
 *   4. else null - the caller renders the data-derived placeholder.
 */
export function printingArt(card, setCode, foil) {
  const vs = variantsOf(card).filter((v) => v && v.set === setCode && v.image);
  const want = foil ? 'foil' : 'nonFoil';
  const inFinish = vs.filter((v) => finishCategory(v.finish) === want);
  if (inFinish.length) {
    if (foil) {
      const rainbow = inFinish.find((v) => v.finish === 'Rainbow');
      if (rainbow) return rainbow.image;
    }
    return inFinish[0].image;
  }
  if (vs.length) return vs[0].image;                 // the other finish of this set
  return card?.image_slug || null;
}

// product code -> human label, by transform not lookup, so a NEW product value degrades to a
// readable label instead of a blank or a crash.
const humanizeProduct = (p) => String(p || '').replace(/_/g, ' ').trim();

/**
 * Where a collector item can be obtained: the distinct human-readable `product` labels of its
 * variants (card + set + finish). Crucial for promos, whose finishes span different sources -
 * a collapsed foil item aggregates its Foil AND Rainbow variants' origins (Dust, Organized Play).
 * Display only; no storage, no writers. Ordered by first appearance for determinism.
 */
export function printingProducts(card, setCode, foil) {
  const want = foil ? 'foil' : 'nonFoil';
  const out = [];
  const seen = new Set();
  for (const v of variantsOf(card)) {
    if (!v || v.set !== setCode || finishCategory(v.finish) !== want || !v.product) continue;
    const label = humanizeProduct(v.product);
    if (label && !seen.has(label)) { seen.add(label); out.push(label); }
  }
  return out;
}
