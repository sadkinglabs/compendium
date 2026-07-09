// The ONE owned-vs-required comparison primitive for the Collection pillar. Pure
// and DB-free (no ./db import), so it unit-tests under `node --test` like
// cardQuery.js, and every consumer - deck buildability, wanted-list progress,
// future set-completion - computes from it. The "decks never reserve cards"
// invariant is STRUCTURAL here: compare() is read-only over the full owned map and
// returns min(owned, required) per line - no decrement, no allocation, no ordering
// effect - so any number of decks needing the same copies all read buildable.

// Sum a [{card_id, qty}] list (duplicates tolerated) into a Map<card_id, qty>.
export function aggregate(required) {
  const m = new Map();
  for (const r of required || []) {
    if (r.card_id == null) continue;
    m.set(r.card_id, (m.get(r.card_id) || 0) + (r.qty || 0));
  }
  return m;
}

// required: [{card_id, qty}] OR a pre-aggregated Map<card_id, qty>.
// ownedByCard: Map<card_id, totalOwned> (already summed across printings).
// unresolved: count of required cards that couldn't be identified (e.g. deck
//   placeholders with card_id null) - surfaced so a deck with unknown cards is
//   never falsely reported buildable.
export function compareRequirements(required, ownedByCard, unresolved = 0) {
  const reqMap = required instanceof Map ? required : aggregate(required);
  const owned = ownedByCard || new Map();
  const lines = [];
  let totalRequired = 0, totalHave = 0;
  for (const [card_id, qty] of reqMap) {
    const have = Math.min(owned.get(card_id) || 0, qty);
    const missing = Math.max(0, qty - have);
    totalRequired += qty;
    totalHave += have;
    lines.push({ card_id, required: qty, owned: owned.get(card_id) || 0, have, missing, complete: missing === 0 });
  }
  lines.sort((a, b) => (b.missing - a.missing) || (b.required - a.required));   // missing first
  const totalMissing = totalRequired - totalHave;
  return {
    totalRequired, totalHave, totalMissing,
    totalCards: lines.length,
    completedCards: lines.filter((l) => l.complete).length,
    percent: totalRequired === 0 ? 100 : Math.round((totalHave / totalRequired) * 100),
    complete: totalMissing === 0 && unresolved === 0,   // unknown cards block "buildable"
    unresolved,
    lines,
  };
}

export function missingLines(report) {
  return (report?.lines || []).filter((l) => l.missing > 0);
}

// Shopping-list text: "2x Sol Ring", one per missing card, sorted by name. The
// single formatter every "Missing:" surface and generated list shares.
export function formatMissingText(report, nameById, title) {
  const names = nameById || new Map();
  const rows = missingLines(report).map((l) => ({ name: names.get(l.card_id) || l.card_id, missing: l.missing }));
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const body = rows.map((r) => `${r.missing}x ${r.name}`).join('\n');
  const header = title ? `${title} (${rows.length} card${rows.length === 1 ? '' : 's'})\n` : '';
  return header + body;
}
