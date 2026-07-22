// resolveWantList - a pasted wishlist into the whole-paste draft (brief §3.2 / §3.5).
//
// Every line runs through the real grammar (parseItemText). A line whose collector item is fully
// DETERMINED lands in `resolved`; a line that needs a set or finish decision lands in `needsChoice`
// (carrying the card's real per-set finish availability, so the resolver sheet only ever offers
// real printings); a name the catalog does not know lands in `unknown`; a line with a grammar
// problem lands in `flagged`. Nothing is written here - resolveWantList only reads.
//
// The want asymmetry vs the owned import: a want is NEVER uncategorised. A bare multi-set line does
// not silently file to one set (the v10 defect) and does not fall to an Uncategorised bucket - it
// becomes a needsChoice row the user must resolve or skip. Single-set lines still resolve silently
// (P6: non-foil, or foil where the sole printing is foil-only).
import { query } from './db.js';
import { parseItemText } from './itemLineGrammar.js';
import { expandItemRows, isRefusalRow } from './printingRows.js';
import { MAX_BATCH_ITEMS } from './bulkWriteContract.js';

// Match a set annotation token against a card's own sets, by numeric code or full name,
// case-insensitively. (Kept local so the grammar and this resolver stay catalog-free of each other.)
function matchSetToken(setToken, setInfos) {
  if (!setToken) return null;
  const t = String(setToken).trim().toLowerCase();
  for (const s of setInfos) {
    if (String(s.code || '').toLowerCase() === t) return s.code;
    if (String(s.name || '').toLowerCase() === t) return s.code;
  }
  return null;
}

// Decide one line against a card's per-set finish availability.
//   -> { kind:'resolved', setCode, foil } | { kind:'needsChoice', lockedFinish, reason }
function resolveWant(setInfos, setToken, wantFoil) {
  const bySet = (code) => setInfos.find((s) => s.code === code);
  if (setToken) {
    const matched = matchSetToken(setToken, setInfos);
    if (!matched) return { kind: 'needsChoice', lockedFinish: wantFoil ? 'foil' : null, reason: `unknown set "${setToken}"` };
    const s = bySet(matched);
    if (wantFoil ? s.foil : s.nonFoil) return { kind: 'resolved', setCode: matched, foil: wantFoil };
    return { kind: 'needsChoice', lockedFinish: wantFoil ? 'foil' : null, reason: `no ${wantFoil ? 'foil' : 'non-foil'} printing in ${s.name}` };
  }
  if (setInfos.length === 1) {
    const s = setInfos[0];
    if (wantFoil) return s.foil ? { kind: 'resolved', setCode: s.code, foil: true } : { kind: 'needsChoice', lockedFinish: 'foil', reason: 'no foil printing' };
    if (s.nonFoil) return { kind: 'resolved', setCode: s.code, foil: false };
    if (s.foil) return { kind: 'resolved', setCode: s.code, foil: true };   // foil-only sole printing (P6)
    return { kind: 'needsChoice', lockedFinish: null, reason: null };
  }
  return { kind: 'needsChoice', lockedFinish: wantFoil ? 'foil' : null, reason: null };   // multi-set, undetermined
}

/**
 * @returns { resolved, needsChoice, unknown, flagged }
 *   resolved   : [{ cardId, name, setCode, foil, qty, parts }]  merged by canonical identity
 *   needsChoice: [{ key, cardId, name, qty, parts, sets:[{code,name,nonFoil,foil}], anyFoil, lockedFinish, reason }]
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
  const byItem = new Map();   // source key -> { key, name, setToken, foil, parts }
  for (const line of parsed) {
    if (line.problems.length) { flagged.push({ raw: line.raw, name: line.name, qty: line.qty, problems: line.problems }); continue; }
    const key = `${line.name.toLowerCase()}|${(line.setToken || '').toLowerCase()}|${line.foil ? 1 : 0}`;
    const prev = byItem.get(key);
    if (prev) prev.parts.push(line.qty);
    else byItem.set(key, { key, name: line.name, setToken: line.setToken, foil: line.foil, parts: [line.qty] });
  }

  const resolved = [];
  const needsChoice = [];
  const unknown = [];
  const byResolved = new Map();
  const sum = (parts) => parts.reduce((s, x) => s + x, 0);

  for (const g of byItem.values()) {
    const c = (await query('SELECT card_id, name, sets, variants FROM cards WHERE lower(name)=? LIMIT 1;', [g.name.toLowerCase()]))[0];
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
    if (r.kind === 'resolved') {
      const ckey = `${c.card_id}|${r.setCode}|${r.foil ? 1 : 0}`;
      const existing = byResolved.get(ckey);
      if (existing) { existing.parts.push(...g.parts); existing.qty += sum(g.parts); continue; }
      const item = { cardId: c.card_id, name: c.name, setCode: r.setCode, foil: r.foil, parts: [...g.parts], qty: sum(g.parts) };
      byResolved.set(ckey, item);
      resolved.push(item);
    } else {
      needsChoice.push({
        key: g.key, cardId: c.card_id, name: c.name, qty: sum(g.parts), parts: [...g.parts],
        sets: setInfos, anyFoil, lockedFinish: r.lockedFinish, reason: r.reason,
      });
    }
  }

  return { resolved, needsChoice, unknown, flagged };
}
