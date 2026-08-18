// v10 -> v11 ledger canonicalisation, as a PURE function.
//
// This module decides what the ownership ledger should become. It never touches the database,
// never reads the catalog itself, and never looks at the clock. Everything it needs arrives as
// an argument, so the same code serves two callers that must not diverge:
//
//   - boot canonicalisation, over the live `owned_cards` table;
//   - the profile-import boundary, over a bundle that arrived from another device.
//
// Two implementations of one mapping WOULD drift, and the drift would only ever show up on
// restore - the least-tested path in the app. Hence one function, called twice.
//
// WHAT CHANGES. In v10, `variant_slug` overloads the empty string: it is both "I own copies
// whose set was never established" and the only row a wishlist entry can live on. v11 gives
// each meaning its own key:
//
//   ''      -> 'uncategorised'      set unknown, non-foil
//   'foil'  -> 'uncategorised:f'    set unknown, foil (the legacy card-level foil row)
//   '001'   -> '001'                already categorised; untouched
//
// A want is not relabelled the same way as ownership, because the two know different things.
// Owned copies genuinely sit in an unknown set. A legacy want knows neither set nor finish, and
// the owner ruled both: finish is non-foil (a set is completed in non-foil, so that is the
// default copy), and the set is inferred ONLY when the card belongs to exactly one set. This is
// why one v10 row can become two v11 rows - see planCard.
// The keys come from printings.js and are NOT redeclared here. They were, once, and the two
// declarations drifted into a ledger no reader could see - see the block at the top of that file.
import {
  LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL, isLegacyPrinting,
} from './printings.js';

export { UNCATEGORISED, UNCATEGORISED_FOIL } from './printings.js';

/** True for a v10 key that canonicalisation must rewrite. */
export const isLegacyKey = isLegacyPrinting;

// ---------------------------------------------------------------------------
// IDENTITY CONTRACT
//
// A split turns one source row into two logical rows, so the planner cannot simply carry the
// source `id` across - that would emit two rows sharing one PRIMARY KEY and leave the
// persistence adapter guessing which is authoritative.
//
// The rule is deliberately narrow enough to be unique BY CONSTRUCTION rather than by a
// tie-break: a planned row keeps a source id only when a source row already sat at that exact
// destination key. `(profile_id, card_id, variant_slug)` is UNIQUE, so at most one source row
// can ever qualify for a given destination, and no id can be claimed twice. Legacy keys are
// always rewritten, so a legacy row never qualifies for its own destination.
//
// Everything else is a NEW logical row: `id: null` and `needsId: true`, stated loudly rather
// than left for the adapter to infer. Source ids that no destination retained come back as
// `releasedIds` so the adapter can delete exactly those rows and nothing else.
// ---------------------------------------------------------------------------

// Merge two contributions landing on the same key. Neither side wins silently: quantities sum,
// the earliest creation is kept because that is when the collector first recorded the card, the
// latest update is kept because that is the freshest edit, and notes are concatenated rather
// than one being dropped. A user's typed note is not something a migration may discard.
function merge(a, b) {
  if (!a) return { ...b };
  const notes = [a.notes, b.notes]
    .map((n) => (n || '').trim())
    .filter(Boolean)
    .filter((n, i, all) => all.indexOf(n) === i);   // distinct - re-runs must not duplicate
  return {
    ...a,
    qty_owned: (a.qty_owned || 0) + (b.qty_owned || 0),
    qty_wanted: (a.qty_wanted || 0) + (b.qty_wanted || 0),
    notes: notes.join(' | '),
    created_at: earliest(a.created_at, b.created_at),
    updated_at: latest(a.updated_at, b.updated_at),
    // Identity never comes from merging: it is decided once, below, by the destination rule.
    id: a.id != null ? a.id : (b.id != null ? b.id : null),
  };
}

// Timestamps are ISO strings, so lexicographic order is chronological. A missing timestamp
// loses to a present one rather than poisoning the comparison.
function earliest(x, y) { if (!x) return y; if (!y) return x; return x < y ? x : y; }
function latest(x, y) { if (!x) return y; if (!y) return x; return x > y ? x : y; }

/**
 * Plan the v11 rows for ONE card in ONE profile.
 *
 * @param rows    every `owned_cards` row for this (profile, card), v10 or already-v11
 * @param setCodes the set codes this card belongs to, from the catalog. `[]` for a card the
 *                 catalog does not know - a catalog gap, not a user decision, so its want
 *                 stays uncategorised rather than being guessed at.
 * @returns { rows, releasedIds } - the rows this card should have afterwards, and the source
 *          ids no longer used. `0/0` rows are dropped: a row recording neither ownership nor a
 *          want is a tombstone, and keeping it would satisfy "no empty-string rows survive"
 *          only by accident.
 */
export function planCard(rows, setCodes) {
  const source = [...(rows || [])];
  const byKey = new Map();
  const put = (key, row) => byKey.set(key, merge(byKey.get(key), { ...row, variant_slug: key }));

  // A card in exactly one set has an unambiguous home for its want. Two or more sets is
  // precisely the case the user must resolve, so it is parked rather than guessed - guessing
  // is the bug that made the wishlist show ALPHA for Beta copies in the first place.
  const soleSet = Array.isArray(setCodes) && setCodes.length === 1 ? setCodes[0] : null;

  // Sorted so the plan cannot depend on the order the database happened to return rows in.
  // Query order is not a semantic input.
  const ordered = source.slice().sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));

  // Where each source row's OWNED copies ended up. Storage allocations hang off owned rows, so
  // when a row is released its allocations must follow its COPIES - and only its copies. A want
  // carries no allocations, which is why the wanted destination is deliberately not recorded.
  const ownedDest = new Map();   // source row id -> destination variant_slug

  for (const row of ordered) {
    const slug = row.variant_slug ?? '';
    const owned = row.qty_owned || 0;
    const wanted = row.qty_wanted || 0;

    if (!isLegacyKey(slug)) {
      if (owned > 0 && row.id != null) ownedDest.set(row.id, slug);
      put(slug, row); continue;                             // already categorised - untouched
    }

    // ONE v10 row can become TWO v11 rows. An '' row holding both a want and owned copies
    // splits: the copies keep an unknown set, while the want may be resolvable to a real one.
    // Splitting is why quantities are carried across explicitly instead of copying the row.
    const ownedKey = slug === LEGACY_FOIL ? UNCATEGORISED_FOIL : UNCATEGORISED;
    if (owned > 0) {
      if (row.id != null) ownedDest.set(row.id, ownedKey);
      put(ownedKey, { ...row, qty_owned: owned, qty_wanted: 0 });
    }

    // EVERY positive legacy want is preserved, whichever legacy row carried it.
    //
    // The app only ever wrote wants to the '' row, but nothing in the schema enforces that, and
    // imported, hand-edited or historically malformed data can carry a want on a legacy 'foil'
    // row. Conservation is unconditional in the proposal, so "the app would not have written
    // this" is not a licence to delete it - that reasoning would silently destroy wishlist data
    // on exactly the inputs we control least.
    //
    // The owner ruling applies uniformly: legacy wants are non-foil, filed to the sole set when
    // the card has exactly one and parked as uncategorised otherwise. A want carried on a foil
    // row is still a want for a non-foil copy; the row it sat on described its ownership, never
    // its wanted finish.
    if (wanted > 0) put(soleSet || UNCATEGORISED, { ...row, qty_owned: 0, qty_wanted: wanted });
  }

  // Identity, applied once per destination. A source row retains its id only if it already sat
  // at this exact key; unique indexing makes that at most one row, so no id is reused.
  const retained = new Set();
  const planned = [];
  for (const [key, row] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if ((row.qty_owned || 0) <= 0 && (row.qty_wanted || 0) <= 0) continue;   // tombstone
    const sitting = source.find((r) => (r.variant_slug ?? '') === key && r.id != null);
    if (sitting) {
      retained.add(sitting.id);
      planned.push({ ...row, variant_slug: key, id: sitting.id, needsId: false });
    } else {
      planned.push({ ...row, variant_slug: key, id: null, needsId: true });
    }
  }

  const releasedIds = source
    .map((r) => r.id)
    .filter((id) => id != null && !retained.has(id));

  // The ownership identity map: for every RELEASED row that carried copies, the destination key
  // that absorbed them. Only positive-owned rows appear - a released wishlist-only row has no
  // destination here and legitimately needs none, because a want holds no allocations. An
  // allocation found on such a row is corruption, and the caller must abort rather than re-home it
  // by guesswork.
  const ownedIdentity = releasedIds
    .filter((id) => ownedDest.has(id))
    .map((id) => ({ releasedId: id, variant_slug: ownedDest.get(id) }));

  return { rows: planned, releasedIds, ownedIdentity };
}

/**
 * Plan a whole ledger.
 *
 * @param rows   every `owned_cards` row, across every profile
 * @param setsOf (card_id) => set codes, or `[]`/null when the catalog does not know the card
 * @returns { rows, releasedIds, touched } - the complete v11 ledger, the source ids to delete,
 *          and how many (profile, card) groups actually changed. `touched` is what lets a
 *          caller skip a no-op write and lets a test prove idempotency by value rather than by
 *          inspecting SQL.
 */
export function planLedger(rows, setsOf) {
  // Grouped by profile, THEN by card - a nested map rather than a joined composite key. A
  // composite key needs a separator that cannot occur in an id, and every attempt to write one
  // here ended up as a raw control byte in the source. Nesting removes the need for a separator
  // altogether, so the hazard cannot recur.
  const byProfile = new Map();
  for (const row of rows || []) {
    if (!byProfile.has(row.profile_id)) byProfile.set(row.profile_id, new Map());
    const byCard = byProfile.get(row.profile_id);
    if (!byCard.has(row.card_id)) byCard.set(row.card_id, []);
    byCard.get(row.card_id).push(row);
  }

  // Sorted so the plan never depends on the order the database returned rows in.
  const groups = [];
  for (const pid of [...byProfile.keys()].sort()) {
    const byCard = byProfile.get(pid);
    for (const cid of [...byCard.keys()].sort()) groups.push(byCard.get(cid));
  }

  const out = [];
  const released = [];
  const ownedIdentity = [];
  let touched = 0;
  for (const group of groups) {
    const plan = planCard(group, setsOf ? setsOf(group[0].card_id) : []);
    if (changed(group, plan.rows)) touched++;
    out.push(...plan.rows);
    released.push(...plan.releasedIds);
    // Carried up with the card and profile, because a destination is only identified by the whole
    // key - the adapter has to find one row among every card in every profile.
    for (const e of plan.ownedIdentity) {
      ownedIdentity.push({ ...e, card_id: group[0].card_id, profile_id: group[0].profile_id });
    }
  }
  return { rows: out, releasedIds: released, ownedIdentity, touched };
}

// Did this group actually change?
//
// `touched` decides whether authoritative output gets persisted, so it compares EVERY field the
// planner intentionally controls - key, quantities, notes, timestamps and identity state - not
// just the ones that happen to move in the common case. Narrowing it to "structural change"
// would require proving the omitted fields cannot change without one, and that proof is exactly
// the kind of reasoning this review caught me getting wrong.
function changed(before, after) {
  if (before.length !== after.length) return true;
  const key = (r) => JSON.stringify([
    r.variant_slug ?? '',
    r.qty_owned || 0,
    r.qty_wanted || 0,
    (r.notes || '').trim(),
    r.created_at || '',
    r.updated_at || '',
    r.id == null ? 'NEW' : `ID:${r.id}`,
  ]);   // JSON, not a joined string - no separator means no separator to get wrong
  const a = before.map(key).sort();
  const b = after.map(key).sort();
  return a.some((v, i) => v !== b[i]);
}
