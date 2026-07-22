// resolveWantList - a pasted wishlist into the whole-paste draft (brief §3.2 / §3.5).
//
// Every line runs through the real grammar (parseItemText). A line whose SET is determined (named,
// or the card's only set) becomes a FIXED row; a line whose set is ambiguous becomes a needsChoice
// row; a name the catalog does not know is `unknown`; a grammar-problem line is `flagged`. Finish is
// NOT decided here - the batch finish governs it in batchWantPlan unless the line carried an
// explicit [Foil] lock. Nothing is written; resolveWantList only reads.
//
// The want asymmetry vs the owned import: a want is NEVER uncategorised. A bare multi-set line does
// not silently file to one set and does not fall to an Uncategorised bucket - it becomes a
// needsChoice row the user must resolve or skip.
import { query } from './db.js';
import { parseItemText } from './itemLineGrammar.js';
import { expandItemRows, isRefusalRow } from './printingRows.js';
import { MAX_BATCH_ITEMS } from './bulkWriteContract.js';

// Match a set annotation token against a card's own sets, by numeric code or full name,
// case-insensitively. (Local so the grammar and this resolver stay catalog-free of each other.)
function matchSetToken(setToken, setInfos) {
  if (!setToken) return null;
  const t = String(setToken).trim().toLowerCase();
  for (const s of setInfos) {
    if (String(s.code || '').toLowerCase() === t) return s.code;
    if (String(s.name || '').toLowerCase() === t) return s.code;
  }
  return null;
}

// Decide one line's SET (finish is deferred to the batch policy).
//   -> { kind:'fixed', fixedSet, lockedFinish } | { kind:'choice', lockedFinish, reason }
function resolveWant(setInfos, setToken, wantFoil) {
  const lockedFinish = wantFoil ? 'foil' : null;
  if (setToken) {
    const matched = matchSetToken(setToken, setInfos);
    if (!matched) return { kind: 'choice', lockedFinish, reason: `unknown set "${setToken}"` };
    const s = setInfos.find((x) => x.code === matched);
    // A [Foil] lock on a set with no foil printing is impossible AT THAT set - offer other sets.
    if (wantFoil && !s.foil) return { kind: 'choice', lockedFinish, reason: `no foil printing in ${s.name}` };
    return { kind: 'fixed', fixedSet: matched, lockedFinish };
  }
  if (setInfos.length === 1) return { kind: 'fixed', fixedSet: setInfos[0].code, lockedFinish };
  return { kind: 'choice', lockedFinish, reason: null };   // multi-set, set undetermined
}

/** True when a resolved draft has anything to review (recognized, unknown, or flagged). Only pure
 *  header/blank input yields nothing - the caller shows "No cards recognised" ONLY then. */
export function hasReviewContent(draft) {
  return !!(draft && (draft.fixed.length || draft.needsChoice.length || draft.unknown.length || draft.flagged.length));
}

// Resolve unique card names in one pass: batched `IN (...)` queries (chunked for the SQLite bound
// parameter ceiling) into a lowercase-name -> card map, so a 2,000-line paste is a handful of
// native round trips, not 2,000.
async function catalogByName(names) {
  const uniq = [...new Set(names.map((n) => n.toLowerCase()))];
  const map = new Map();
  for (let i = 0; i < uniq.length; i += 400) {
    const chunk = uniq.slice(i, i + 400);
    const rows = await query(`SELECT card_id, name, sets, variants FROM cards WHERE lower(name) IN (${chunk.map(() => '?').join(',')});`, chunk);
    for (const c of rows) map.set(String(c.name).toLowerCase(), c);
  }
  return map;
}

/**
 * @returns { fixed, needsChoice, unknown, flagged }
 *   fixed      : [{ key, cardId, name, qty, parts, sets, anyFoil, fixedSet, lockedFinish }]  set known
 *   needsChoice: [{ key, cardId, name, qty, parts, sets, anyFoil, fixedSet:null, lockedFinish, reason }]
 *   unknown    : [name]
 *   flagged    : [{ raw, name, qty, problems }]
 */
export async function resolveWantList(text) {
  const parsed = parseItemText(text);
  if (parsed.length > MAX_BATCH_ITEMS) {
    const e = new Error(`Too many lines to import (max ${MAX_BATCH_ITEMS}).`);
    e.name = 'ImportTooLarge';
    throw e;
  }

  const flagged = [];
  const bySource = new Map();   // source key -> { key, name, setToken, foil, parts }
  for (const line of parsed) {
    if (line.problems.length) { flagged.push({ raw: line.raw, name: line.name, qty: line.qty, problems: line.problems }); continue; }
    const key = `${line.name.toLowerCase()}|${(line.setToken || '').toLowerCase()}|${line.foil ? 1 : 0}`;
    const prev = bySource.get(key);
    if (prev) prev.parts.push(line.qty);
    else bySource.set(key, { key, name: line.name, setToken: line.setToken, foil: line.foil, parts: [line.qty] });
  }

  const groups = [...bySource.values()];
  const catalog = await catalogByName(groups.map((g) => g.name));

  const fixed = [];
  const needsChoice = [];
  const unknown = [];
  const byFixed = new Map();
  const sum = (parts) => parts.reduce((s, x) => s + x, 0);

  for (const g of groups) {
    const c = catalog.get(g.name.toLowerCase());
    if (!c) { unknown.push(g.name); continue; }

    // Per-set finish availability via the display expander (permissive; the durable writer re-checks
    // strictly). A card with no sets can hold no want - a want cannot be uncategorised - so it is
    // reported unknown rather than becoming an unfileable row.
    const setInfos = expandItemRows([c])
      .filter((r) => !isRefusalRow(r))
      .map((r) => ({ code: r.set, name: r.setName, nonFoil: r.finishes.nonFoil, foil: r.finishes.foil }));
    if (!setInfos.length) { unknown.push(c.name); continue; }
    const anyFoil = setInfos.some((s) => s.foil);

    const r = resolveWant(setInfos, g.setToken, g.foil);
    if (r.kind === 'fixed') {
      // Merge fixed aliases (`[Beta]` and `[002]`) that name the same set + lock, so they are one
      // row; convergence across a chosen set is handled again canonically at commit time.
      const fkey = `${c.card_id}|${r.fixedSet}|${r.lockedFinish || ''}`;
      const existing = byFixed.get(fkey);
      if (existing) { existing.parts.push(...g.parts); existing.qty += sum(g.parts); continue; }
      const item = { key: g.key, cardId: c.card_id, name: c.name, qty: sum(g.parts), parts: [...g.parts], sets: setInfos, anyFoil, fixedSet: r.fixedSet, lockedFinish: r.lockedFinish };
      byFixed.set(fkey, item);
      fixed.push(item);
    } else {
      needsChoice.push({ key: g.key, cardId: c.card_id, name: c.name, qty: sum(g.parts), parts: [...g.parts], sets: setInfos, anyFoil, fixedSet: null, lockedFinish: r.lockedFinish, reason: r.reason });
    }
  }

  return { fixed, needsChoice, unknown, flagged };
}
