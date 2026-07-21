// To Be Categorised - the pile, as pure data.
//
// After canonicalisation a ledger can hold rows whose set was never established: copies filed
// by a text import or an early scanner, and legacy wants on reprinted cards that migration
// refused to guess at. This module turns those rows into the things a user is actually asked
// to resolve, and nothing else. No database, no components.
//
// OWNED AND WANTED ARE ASKED SEPARATELY, on purpose. They sit on the same row, but they are
// different questions with different answers: "which set are these copies from?" and "which one
// did you want?" - and owning an Alpha copy while wanting the Beta one is an ordinary thing for
// a collector. Codex's ruling is that triage resolves a wanted quantity independently of any
// owned quantity on the same card, so each line is filed on its own.
//
// FINISH IS NEVER ASKED HERE. An uncategorised row already states its finish - that survived
// migration intact; only the set was lost. Asking again would invite the user to contradict
// what their own ledger says.
import {
  UNCATEGORISED, UNCATEGORISED_FOIL, LEGACY_UNCATEGORISED, LEGACY_FOIL,
  parsePrinting, isUncategorised, isRealSetCode,
} from './printings.js';

/** Every uncategorised key - the only rows triage is ever allowed to drain. */
export const UNCATEGORISED_KEYS = [LEGACY_UNCATEGORISED, LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL];

/** The kinds of line triage can present. Each is filed independently. */
export const OWNED_NONFOIL = 'owned';
export const OWNED_FOIL = 'ownedFoil';
export const WANTED = 'wanted';

/**
 * Turn raw ownership rows into the triage pile.
 *
 * @param rows      `owned_cards` rows for one profile, any schema
 * @param setsOf    (card_id) => set codes, so a line can offer real choices
 * @returns entries, one per card, each carrying only the lines that actually need resolving.
 *          A card with nothing uncategorised does not appear at all.
 */
export function triagePile(rows, setsOf = () => []) {
  const byCard = new Map();

  for (const r of rows || []) {
    const slug = r?.variant_slug ?? LEGACY_UNCATEGORISED;
    if (!isUncategorised(slug)) continue;              // categorised rows are not in the pile
    const { foil } = parsePrinting(slug);
    const owned = r.qty_owned || 0;
    const wanted = r.qty_wanted || 0;
    if (owned <= 0 && wanted <= 0) continue;           // a 0/0 row asks nothing

    if (!byCard.has(r.card_id)) {
      byCard.set(r.card_id, {
        card_id: r.card_id, owned: 0, ownedFoil: 0, wanted: 0,
        // PROVENANCE, per line. Filing has to drain the keys the quantity actually came from,
        // and for a want that is not knowable from the line itself: a want is displayed as
        // non-foil by the §7.4 ruling, but it can have SURVIVED on any of the four
        // uncategorised keys, foil ones included. Aggregating first and assuming two source
        // keys later would leave the original quantity behind and mint a second at the
        // destination.
        ownedFrom: new Set(), ownedFoilFrom: new Set(), wantedFrom: new Set(),
      });
    }
    const e = byCard.get(r.card_id);
    if (owned > 0) {
      e[foil ? 'ownedFoil' : 'owned'] += owned;
      e[foil ? 'ownedFoilFrom' : 'ownedFrom'].add(slug);
    }
    // A want is non-foil by the §7.4 ruling regardless of the row it survived on, so foil
    // wants are not a separate line. Migration never creates one and no writer may.
    if (wanted > 0) { e.wanted += wanted; e.wantedFrom.add(slug); }
  }

  const out = [];
  for (const cardId of [...byCard.keys()].sort()) {     // stable order, never query order
    const e = byCard.get(cardId);
    const sets = (setsOf(cardId) || []).filter(Boolean);
    const lines = [];
    if (e.owned > 0) lines.push({ kind: OWNED_NONFOIL, qty: e.owned, foil: false, from: [...e.ownedFrom].sort() });
    if (e.ownedFoil > 0) lines.push({ kind: OWNED_FOIL, qty: e.ownedFoil, foil: true, from: [...e.ownedFoilFrom].sort() });
    if (e.wanted > 0) lines.push({ kind: WANTED, qty: e.wanted, foil: false, from: [...e.wantedFrom].sort() });
    if (lines.length) out.push({ card_id: cardId, sets, lines, resolvable: sets.length > 0 });
  }
  return out;
}

/** How many individual decisions the pile holds - lines, not cards. */
export function pendingCount(pile) {
  return (pile || []).reduce((n, e) => n + e.lines.length, 0);
}

/**
 * The single-set cards in the pile, which need no decision at all.
 *
 * A card printed once can only have come from that set, so asking would be theatre. This is the
 * one inference triage is allowed to make, and it is not a guess - it is the same rule
 * migration uses for wants, applied to copies once the user is present to see the result.
 *
 * Deliberately NOT run automatically at boot: the old backfill did that silently, and a
 * migration that quietly moves a user's copies is exactly what this design replaced.
 */
export function autoResolvable(pile) {
  return (pile || [])
    .filter((e) => e.sets.length === 1)
    .flatMap((e) => e.lines.map((l) => ({ card_id: e.card_id, set: e.sets[0], kind: l.kind, qty: l.qty, foil: l.foil })));
}

/**
 * What filing one line means, as data a caller can hand to the repository.
 *
 * Returns the source item to draw down and the destination item to add to, so the caller writes
 * both halves of a move rather than inventing them. Quantities are carried explicitly: filing
 * must conserve, and a move that reads a total and writes it elsewhere is how copies get
 * duplicated.
 */
export function fileLinePlan(entry, line, set) {
  // The destination must be one of THIS card's sets, not merely truthy. Stale UI state can
  // offer a set the card was never printed in - filing there would move copies onto a
  // collector item that does not exist, which no reader can bucket and no later triage can
  // find again.
  if (!isRealSetCode(set)) throw new Error(`A triage line needs a real destination set, not ${JSON.stringify(set)}.`);
  if (!entry?.sets?.includes(set)) throw new Error(`${set} is not one of this card's sets.`);
  if (!line?.from?.length) throw new Error('A triage line must know which rows its quantity came from.');

  // Sources are constrained to the uncategorised keys. A forged or stale plan naming a
  // categorised row would otherwise drain holdings the user never put in the pile.
  const foreign = line.from.filter((slug) => !UNCATEGORISED_KEYS.includes(slug));
  if (foreign.length) throw new Error(`Triage may only drain uncategorised rows, not ${foreign.join(', ')}.`);

  const wanted = line.kind === WANTED;
  return {
    card_id: entry.card_id,
    qty: line.qty,
    field: wanted ? 'wanted' : 'owned',
    // EVERY key this quantity actually came from, not an assumed pair. A want can have
    // survived on a foil key while being filed as non-foil, so a fixed two-key drawdown would
    // leave the original behind and duplicate it at the destination.
    fromSlugs: line.from,
    to: { set, foil: line.foil },
  };
}


