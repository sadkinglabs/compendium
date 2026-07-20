// Pure set-completion model for the Collection sets-home (Collection UX redesign,
// Phase 1). DOM-free and DB-free: the pillar injects the parsed catalog + the owned
// map, this computes per-set completion. Tested in setCompletion.test.mjs.
//
// Contract (proposal §4 / Codex Major 2):
//   - derive EVERY set from setCatalog, so a zero-owned set still renders (0%) and a
//     brand-new set code that appears on a card shows up automatically;
//   - denominator = unique collectible cards listing that set (TOKEN cards excluded);
//   - completion counts NON-FOIL ownership only. Foils are not chased by most collectors,
//     so a foil-only card does NOT count toward a set's completion. (A per-set non-foil /
//     foil / playset breakdown lives inside the set page, not here.)
//   - the '' Unspecified ownership bucket is never a set (cards list only real sets),
//     so it is inherently excluded from every denominator.
import { isTokenCard } from './tokens.js';

// Set order is derived from the numeric set code (same rule as sets.js:setRank, inlined
// here so this pure model has no JSON-import dependency and runs under bare `node --test`).
// Non-numeric codes (e.g. the '' Unspecified bucket) sort last.
const setRank = (code) => (code && /^\d+$/.test(code) ? parseInt(code, 10) : Number.MAX_SAFE_INTEGER);

/**
 * @param {Array}  catalogCards  parsed catalog rows (each with card_id + _sets:[{name,code}])
 * @param {Map}    ownedBySet    Map<"cardId|setCode", {owned,foil}> from ownedRepository.ownedBySet()
 * @param {Object} setCatalog    code -> display name (setCatalog.json)
 * @returns {Array<{code,name,ownedUnique,foilUnique,totalCollectible,pct}>} real sets, by set code
 */
export function buildSetCompletion(catalogCards, ownedBySet, setCatalog) {
  const sets = new Map(); // code -> { code, name, ownedUnique, totalCollectible }
  const ensure = (code, name) => {
    let s = sets.get(code);
    if (!s) {
      s = { code, name: name || code, ownedUnique: 0, foilUnique: 0, totalCollectible: 0 };
      sets.set(code, s);
    } else if (name && s.name === code) {
      s.name = name; // upgrade a code-only placeholder once a real name shows up
    }
    return s;
  };

  // Seed every set the catalog names, so an in-catalog set with no cards still renders.
  // Skip the '' Unspecified ownership bucket (SET_LABEL carries it) — it is not a set.
  for (const code of Object.keys(setCatalog || {})) { if (!code) continue; ensure(code, setCatalog[code]); }

  for (const card of catalogCards || []) {
    if (isTokenCard(card)) continue;
    const cardId = card.card_id ?? card.id;
    const seen = new Set(); // a card should list each set once; be defensive
    for (const entry of card._sets || []) {
      const code = entry && entry.code;
      if (!code || seen.has(code)) continue; // no code / dupe -> skip
      seen.add(code);
      const s = ensure(code, (setCatalog && setCatalog[code]) || entry.name);
      s.totalCollectible += 1;
      const o = ownedBySet && ownedBySet.get(cardId + '|' + code);
      if (o && (o.owned || 0) > 0) s.ownedUnique += 1; // completion: non-foil only
      // foilUnique is REPORTED (the tile's "N foil" stat) but never feeds completion.
      if (o && (o.foil || 0) > 0) s.foilUnique += 1;
    }
  }

  return [...sets.values()]
    .map((s) => ({ ...s, pct: s.totalCollectible ? s.ownedUnique / s.totalCollectible : 0 }))
    .sort((a, b) => setRank(a.code) - setRank(b.code) || String(a.code).localeCompare(String(b.code)));
}
