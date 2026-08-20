// The Storage pillar's reads and container lifecycle - what the UI asks for and what it changes
// about the CONTAINERS themselves. Copies moving between places is `storageRepository`'s business;
// this module never invents or destroys one.
//
// WHY IT IS NOT IN storageRepository. That module is the transactional core: DOM-free, node-testable,
// and deliberately returning STATEMENTS rather than executing them, so a caller can compose them into
// a transaction it already owns. Reads bound to `db.js` would take that property away from it. This
// module is the bound half, and it composes the core's statements rather than writing its own SQL for
// anything that touches an allocation.
//
// COORDINATION, per the tiering the core documents: container lifecycle and multi-item filing are
// profile-wide, so they take `withExclusiveCollectionWrites`; filing one collector item shares the
// exact `enqueueWrite` key its ownership stepper uses. The reads take nothing.
import { query, tx } from './db.js';
import { enqueueWrite, withExclusiveCollectionWrites } from './collectionWrites.js';
import { activeProfileId } from './profileRepository.js';
import { notifyOwnedChanged, ownedRowKey } from './ownedRepository.js';
import { uuid, nowIso } from './ids.js';
import {
  SYSTEM_KIND, UNFILED_NAME, DEFAULT_COLOUR, isContainerColour, isUserContainerKind,
} from './storageVocabulary.js';
import {
  assertEqualityStatements, placeStatements, planPlaceRemoval, removalStatements, StorageConflict,
} from './storageRepository.js';
import { parsePrinting, printingSlugs } from './printings.js';

/** Longest a container name may be. The column is TEXT; this is the product limit. */
export const MAX_CONTAINER_NAME = 60;
export const MAX_CONTAINER_DESC = 240;
const MAX_STORAGE_SELECTION = 500;
const itemWriteKey = (pid, cardId, variantSlug) => {
  const { set, foil } = parsePrinting(variantSlug);
  return ownedRowKey(pid, cardId, set, foil);
};

/**
 * ONE human message for any Storage write failure. Two reasons this exists:
 *  - a refused move must never leak a `StorageConflict`'s internal string ("moveItemCopies: 1 copies
 *    requested but Unfiled holds 0") to a person; and
 *  - every refusal must read as an ERROR, so the tone is `danger` - `warn` renders identically to a
 *    success toast, which is the exact "clarity in erroring" gap this closes.
 * Returns `{ text, tone }`; callers `toast(m.text, { tone: m.tone })`.
 */
export function storageWriteMessage(err) {
  if (err?.name === 'StorageConflict') {
    const free = Number(err?.detail?.available);
    return {
      text: Number.isFinite(free) && free > 0
        ? `Only ${free} ${free === 1 ? 'copy is' : 'copies are'} free to move`
        : 'Those copies aren’t there anymore',
      tone: 'danger',
    };
  }
  // InvalidAllocation carries copy already written for a person ("That place no longer exists").
  return { text: err?.message || 'Could not save that change', tone: 'danger' };
}

/**
 * Resolve a global-decrease conflict's filed places to a human phrase: "Beta binder (2), Bulk box (1)".
 * The conflict carries container ids, not names (it is thrown deep in the transactional core), so the
 * naming that the global-minus "wall" needs is done HERE, with a read, rather than in the pure
 * message function. Returns '' when nothing resolves, so the caller can fall back to the plain wall.
 */
export async function filedPlacesSummary(filed = [], pid = activeProfileId()) {
  const ids = [...new Set((filed || []).map((f) => f?.container_id).filter(Boolean))];
  if (!ids.length) return '';
  const rows = await query(
    `SELECT id, name FROM storage_containers WHERE profile_id=? AND id IN (${ids.map(() => '?').join(',')});`,
    [pid, ...ids],
  );
  const nameOf = new Map(rows.map((r) => [r.id, r.name]));
  return (filed || [])
    .map((f) => ({ name: nameOf.get(f?.container_id), qty: Number(f?.qty) || 0 }))
    .filter((p) => p.name && p.qty > 0)
    .map((p) => `${p.name} (${p.qty})`)
    .join(', ');
}

/**
 * Every container for a profile, with what it holds.
 *
 * ONE grouped query, not one per container - the listDecks N+1 lesson. `cards` counts DISTINCT
 * collector items and `copies` sums the physical cards, because those are different questions a
 * binder answers ("how many different cards" vs "how many sleeves used") and a single number would
 * have to pick one and be wrong for the other.
 *
 * Unfiled sorts first (`sort_order -1`), then user containers by their order, then name - so the
 * list is stable across renames rather than resequencing under the user's thumb.
 */
export async function listContainers(pid = activeProfileId()) {
  return query(
    `SELECT c.id, c.kind, c.name, c.description, c.colour, c.sort_order, c.is_system,
            COUNT(a.id) cards,
            COALESCE(SUM(a.qty), 0) copies
       FROM storage_containers c
       LEFT JOIN storage_allocations a ON a.container_id = c.id
      WHERE c.profile_id = ?
      GROUP BY c.id
      ORDER BY c.sort_order, c.name COLLATE NOCASE;`,
    [pid],
  );
}

/**
 * What is inside one container: a row per collector item, with the card fields the list rows render.
 *
 * `qty` is the number of copies IN THIS CONTAINER, never the owned total - the whole point of a
 * container view is what is physically in it. `qty_owned` rides along so a surface can say "3 of
 * your 5" without a second query.
 *
 * `image_slug`, `is_site` and `variants` are the art fields the row's thumbnail needs. `variants`
 * is selected for the same reason `recentlyAdded` selects it: a row here is a collector item
 * (card + set + finish), so its thumb must wear THAT printing's illustration rather than the
 * card's default - a Beta row showing Alpha art would contradict the set name printed beside it.
 * `is_site` only picks the crop (Site art is stored portrait), and `elements` already rides along
 * for the deterministic zero-image fallback.
 */
export async function containerContents(containerId, pid = activeProfileId()) {
  return query(
    `SELECT a.id alloc_id, a.qty, o.id owned_id, o.card_id, o.variant_slug, o.qty_owned,
            cd.name, cd.type, cd.rarity, cd.elements, cd.sets, cd.image_slug, cd.is_site, cd.variants
       FROM storage_allocations a
       JOIN owned_cards o ON o.id = a.owned_card_id
       LEFT JOIN cards cd ON cd.card_id = o.card_id
      WHERE a.container_id = ? AND a.profile_id = ?
      ORDER BY cd.name COLLATE NOCASE, o.variant_slug;`,
    [containerId, pid],
  );
}

/** Every place for one collector item, including empty places so the card ledger can file into them. */
export async function itemStorage(cardId, variantSlug, pid = activeProfileId()) {
  // Resolve the owned row across BOTH schemas, like every ownership reader: a collector item can
  // still sit on a v10 legacy key (`''`/`'foil'`) before boot canonicalisation collapses it, and an
  // exact match on the canonical slug would return nothing and leave the ledger unfileable. Canonical
  // is preferred when both somehow exist; the resolved row's ACTUAL slug is threaded downstream so
  // the in-transaction equality backstop keys on the row that really holds the copies.
  const { set, foil } = parsePrinting(variantSlug);
  const slugs = printingSlugs(set, foil);
  const rows = await query(
    `SELECT id, variant_slug, qty_owned FROM owned_cards
      WHERE profile_id=? AND card_id=? AND variant_slug IN (${slugs.map(() => '?').join(',')});`,
    [pid, cardId, ...slugs],
  );
  const owned = rows.find((r) => r.variant_slug === variantSlug) || rows[0] || null;
  if (!owned) return { ownedId: null, ownedSlug: variantSlug, total: 0, places: [] };
  const places = await query(
    `SELECT c.id, c.kind, c.name, c.description, c.colour, c.sort_order, c.is_system,
            a.id alloc_id, COALESCE(a.qty, 0) qty
       FROM storage_containers c
       LEFT JOIN storage_allocations a ON a.container_id=c.id AND a.owned_card_id=?
      WHERE c.profile_id=?
      ORDER BY c.sort_order, c.name COLLATE NOCASE;`,
    [owned.id, pid],
  );
  return { ownedId: owned.id, ownedSlug: owned.variant_slug, total: Number(owned.qty_owned) || 0, places };
}

/**
 * How many copies of each collector item are FILED - in a named place rather than Unfiled - keyed
 * exactly like `ownedBySet`: "cardId|setCode" -> { owned, foil }.
 *
 * WHAT IT IS FOR. The Collection grids step ownership optimistically, and the storage wall refuses a
 * decrease whose target falls below this number. Without it the grid paints the new count and snaps
 * back a beat later, so the tile appears to undo itself over behaviour that is working. With it, a
 * tap that is going to be refused simply does not paint. It is PRESENTATION input only - see
 * predictGlobalRemovalRefusal - and a row missing from this map predicts nothing, which is exactly
 * the right reading: nothing filed, nothing to refuse.
 *
 * DRIVEN FROM THE ALLOCATIONS, not from owned_cards, because most collections file few of their
 * rows: this walks `idx_alloc_owned (profile_id, owned_card_id)` over the copies that are actually
 * in a place, rather than probing storage once per owned row. A row with nothing filed contributes
 * nothing and is absent, which is why the consumer must read an absent key as zero.
 *
 * The set bucket comes from `parsePrinting`, the same parse `ownedBySet` uses, so a legacy v10 key
 * and its canonical replacement land on the SAME tile - the key has to match the row the stepper
 * writes to, or the prediction would be about a different collector item.
 */
export async function filedBySet(pid = activeProfileId()) {
  const rows = await query(
    `SELECT o.card_id, o.variant_slug, SUM(a.qty) filed
       FROM storage_allocations a
       JOIN storage_containers c ON c.id = a.container_id AND c.is_system = 0
       JOIN owned_cards o ON o.id = a.owned_card_id
      WHERE a.profile_id = ?
      GROUP BY a.owned_card_id, o.card_id, o.variant_slug;`,
    [pid],
  );
  const m = new Map();
  for (const r of rows) {
    const { set, foil } = parsePrinting(r.variant_slug);
    const key = r.card_id + '|' + set;
    const cur = m.get(key) || { owned: 0, foil: 0 };
    cur[foil ? 'foil' : 'owned'] += Number(r.filed) || 0;
    m.set(key, cur);
  }
  return m;
}

/**
 * Does this collector item have ANY copies filed in a named place - either finish, any amount?
 *
 * The card sheet's FiledSeal asks exactly one yes/no question about the (card, set) it is showing,
 * and neither existing read answers it: `itemStorage` is per FINISH (the sheet holds one finish at a
 * time, so it would report "not filed" for a card whose foils are all in a binder), and `filedBySet`
 * builds the whole profile's map to answer about one tile.
 *
 * BOTH finishes and every slug each can be sitting on come from `printingSlugs`, never a literal -
 * a real ledger still holds v10 keys ('' / 'foil') beside the canonical ones, so an exact-slug read
 * would quietly say "not filed" about copies that are.
 *
 * `is_system = 0` is what makes it FILED rather than merely owned: Unfiled is where copies are when
 * they are nowhere, which is the opposite of what the mark claims. There is deliberately NO qty
 * guard: the allocations table carries CHECK(qty > 0) and the removal path deletes an emptied row
 * rather than parking it at zero, so a `qty > 0` predicate here would be unreachable - it was
 * written, found unkillable by mutation, and removed rather than left as reassuring dead SQL.
 */
export async function itemFiledAny(cardId, set, pid = activeProfileId()) {
  const slugs = [...new Set([...printingSlugs(set, false), ...printingSlugs(set, true)])];
  const rows = await query(
    `SELECT 1 found
       FROM storage_allocations a
       JOIN storage_containers c ON c.id = a.container_id AND c.is_system = 0
       JOIN owned_cards o ON o.id = a.owned_card_id AND o.profile_id = a.profile_id
      WHERE a.profile_id = ?
        AND o.card_id = ? AND o.variant_slug IN (${slugs.map(() => '?').join(',')})
      LIMIT 1;`,
    [pid, cardId, ...slugs],
  );
  return rows.length > 0;
}

/** Read-only Codex summary: quantities grouped by physical place across every printing. */
export async function cardStorageSummary(cardId, pid = activeProfileId()) {
  return query(
    `SELECT c.id, c.name, c.is_system, c.colour, SUM(a.qty) qty
       FROM storage_allocations a
       JOIN storage_containers c ON c.id=a.container_id AND c.profile_id=a.profile_id
       JOIN owned_cards o ON o.id=a.owned_card_id AND o.profile_id=a.profile_id
      WHERE a.profile_id=? AND o.card_id=?
      GROUP BY c.id
      ORDER BY c.sort_order, c.name COLLATE NOCASE;`,
    [pid, cardId],
  );
}

async function commitItemMove({ cardId, variantSlug, fromContainerId, toContainerId, qty }, pid, ledger = null) {
  if (!Number.isSafeInteger(qty) || qty <= 0) {
    throw Object.assign(new Error('Choose a positive whole number of copies.'), { name: 'InvalidAllocation' });
  }
  if (!fromContainerId || !toContainerId || fromContainerId === toContainerId) return { moved: 0 };
  const current = ledger || await itemStorage(cardId, variantSlug, pid);
  if (!current.ownedId) throw Object.assign(new Error('That collector item is no longer owned.'), { name: 'InvalidAllocation' });
  const from = current.places.find((p) => p.id === fromContainerId);
  const to = current.places.find((p) => p.id === toContainerId);
  if (!from || !to) throw Object.assign(new Error('That place no longer exists.'), { name: 'InvalidAllocation' });
  const plan = planPlaceRemoval(from.alloc_id ? { id: from.alloc_id, qty: Number(from.qty) || 0 } : null, qty);
  if (plan.conflict) {
    const available = Number(from.qty) || 0;
    throw new StorageConflict({ requested: qty, available, unfiled: available, from: from.id }, 'moveItemCopies');
  }
  const now = nowIso();
  await tx([
    ...removalStatements(plan, now),
    ...placeStatements({ profileId: pid, containerId: to.id, ownedCardId: current.ownedId, qty, now }),
    // Key the backstop on the row's actual slug (legacy or canonical), never the passed-in
    // canonical, so it can never assert a vacuous non-match on an un-migrated row.
    ...assertEqualityStatements(pid, [{ cardId, variantSlug: current.ownedSlug || variantSlug }], 'move-item'),
  ]);
  notifyOwnedChanged();
  return { moved: qty };
}

async function moveItemCopies(args, pid) {
  return enqueueWrite(itemWriteKey(pid, args.cardId, args.variantSlug), () => commitItemMove(args, pid));
}

/** Set one named place's quantity; the difference moves to or from Unfiled. */
export async function setItemContainerQty({ cardId, variantSlug, containerId, qty }, pid = activeProfileId()) {
  if (!Number.isSafeInteger(qty) || qty < 0) {
    throw Object.assign(new Error('A filed quantity must be a non-negative whole number.'), { name: 'InvalidAllocation' });
  }
  return enqueueWrite(itemWriteKey(pid, cardId, variantSlug), async () => {
    // The target is absolute UI state, so derive its delta only after this item reaches the
    // front of the existing ownership queue. Reading it before admission lets rapid taps apply
    // two deltas from the same stale quantity.
    const ledger = await itemStorage(cardId, variantSlug, pid);
    const target = ledger.places.find((p) => p.id === containerId);
    const unfiled = ledger.places.find((p) => p.is_system);
    if (!target || target.is_system || !unfiled) throw Object.assign(new Error('That filing destination is unavailable.'), { name: 'InvalidAllocation' });
    const before = Number(target.qty) || 0;
    if (qty === before) return { moved: 0 };
    return commitItemMove({
      cardId, variantSlug,
      fromContainerId: qty > before ? unfiled.id : target.id,
      toContainerId: qty > before ? target.id : unfiled.id,
      qty: Math.abs(qty - before),
    }, pid, ledger);
  });
}

/** Direct secondary action: move a known quantity from one place to another. */
export async function moveItemAllocation(args, pid = activeProfileId()) {
  return moveItemCopies(args, pid);
}

/**
 * Move every selected source allocation to one destination in a single exclusive transaction.
 *
 * `movedIds` names the owned rows that ACTUALLY moved, and it is not decoration: the caller asked
 * about a selection, and only the rows read inside the lock can answer which parts of that selection
 * had anything to move. A caller that inferred it from `items` would be guessing, because one card
 * can own two collector items (standard and foil) and one `items` count cannot say whether that is
 * two finishes of one card or one finish of two. `bulkFileFromUnfiled` reports on that difference.
 */
export async function bulkMoveAllocations({ fromContainerId, toContainerId, ownedCardIds }, pid = activeProfileId()) {
  const ids = [...new Set((ownedCardIds || []).filter(Boolean))];
  if (!ids.length || fromContainerId === toContainerId) return { items: 0, copies: 0, movedIds: [] };
  if (ids.length > MAX_STORAGE_SELECTION) throw Object.assign(new Error(`Select at most ${MAX_STORAGE_SELECTION} collector items.`), { name: 'InvalidAllocation' });
  let result = { items: 0, copies: 0, movedIds: [] };
  await withExclusiveCollectionWrites(async () => {
    const containers = await query('SELECT id FROM storage_containers WHERE profile_id=? AND id IN (?,?);', [pid, fromContainerId, toContainerId]);
    if (containers.length !== 2) throw Object.assign(new Error('A filing destination no longer exists.'), { name: 'InvalidAllocation' });
    const source = await query(
      `SELECT a.id alloc_id, a.owned_card_id, a.qty, o.card_id, o.variant_slug
         FROM storage_allocations a
         JOIN owned_cards o ON o.id=a.owned_card_id AND o.profile_id=a.profile_id
        WHERE a.profile_id=? AND a.container_id=?
          AND a.owned_card_id IN (${ids.map(() => '?').join(',')});`,
      [pid, fromContainerId, ...ids],
    );
    if (!source.length) return;
    const now = nowIso();
    const statements = [];
    for (const row of source) {
      statements.push(...removalStatements({ conflict: null, taken: [{ id: row.alloc_id, take: row.qty, left: 0 }] }, now));
      statements.push(...placeStatements({ profileId: pid, containerId: toContainerId, ownedCardId: row.owned_card_id, qty: row.qty, now }));
    }
    statements.push(...assertEqualityStatements(pid, source.map((r) => ({ cardId: r.card_id, variantSlug: r.variant_slug })), 'bulk-file'));
    await tx(statements);
    result = {
      items: source.length,
      copies: source.reduce((n, r) => n + (Number(r.qty) || 0), 0),
      movedIds: source.map((r) => r.owned_card_id),
    };
  });
  if (result.items) notifyOwnedChanged();
  return result;
}

/**
 * The GRID-side bulk File: put every UNFILED copy of a Collection selection into one place.
 *
 * The counterpart of the bulk File inside a place, and it differs in exactly one thing - the GRAIN
 * of what the user picked. The Collection grids select CARD + SET (`useCollectionSelection` keys its
 * snapshot `card_id|set`), while an allocation belongs to a COLLECTOR ITEM - card, set AND finish -
 * so one selected tile can stand for two `owned_cards` rows. BOTH finishes file, deliberately: the
 * tile shows one card in one set, and filing half of what it stands for would be a silent partial
 * the user has no way to see.
 *
 * Resolution names every slug each finish can be sitting on (`printingSlugs`), never a literal, because
 * a real ledger still holds v10 keys (`''` / `'foil'`) beside the canonical ones. An exact-slug read
 * would file the migrated rows and silently skip the rest.
 *
 * ONE query, then a PAIR FILTER. `card_id IN (…) AND variant_slug IN (…)` is a cross product, so it
 * also matches printings nobody selected - pick Alpha of one card and Beta of another and the query
 * offers Beta of the first as well. Filing that would move copies the user never chose, so the rows
 * are narrowed back to the exact (card, set) pairs picked.
 *
 * The move itself is `bulkMoveAllocations`, unchanged: it re-reads the source rows inside its own
 * exclusive transaction, asserts the qty_owned = SUM(allocations) equality there, and enforces the
 * selection cap - which is why there is no second cap message here. Resolution runs OUTSIDE that lock
 * on purpose and is only a candidate list; a row that stops being unfiled in between simply has no
 * source allocation to move and drops out. That is also how a card with nothing unfiled is skipped:
 * not a special case, just an empty source.
 *
 * Returns `{ items, copies, selected, filed }` - allocations moved, copies moved, tiles asked for,
 * and tiles that actually contributed. `selected - filed` is the honest "had nothing unfiled" count,
 * and it cannot be derived from `items` (see `movedIds` above).
 */
export async function bulkFileFromUnfiled({ items, toContainerId }, pid = activeProfileId()) {
  // THE BUCKET IS NOT THE KEY, and this function has to hold both. A pick's set is a UI bucket
  // ('' for uncategorised); a resolved row's is a storage key ('uncategorised', 'foil', …). They are
  // compared below to decide which tile a moved row belongs to, so both sides are normalised through
  // the SAME `parsePrinting` - not one by hand and one by the parser, which is precisely how those
  // two spellings have drifted apart here before. It also makes the input forgiving: a caller who
  // hands over a storage key instead of a bucket gets the right answer rather than a miscount in a
  // toast.
  const bucketOf = (set) => parsePrinting(String(set ?? '')).set;
  const picks = [];
  const seen = new Set();
  for (const it of items || []) {
    if (!it?.cardId) continue;
    const set = bucketOf(it.set);
    const key = `${it.cardId}|${set}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push({ cardId: it.cardId, set });
  }
  if (!picks.length || !toContainerId) return { items: 0, copies: 0, selected: picks.length, filed: 0 };

  const fromContainerId = await unfiledId(pid);
  if (!fromContainerId) {
    throw Object.assign(new Error(`${UNFILED_NAME} is unavailable, so there is nothing to file from.`), { name: 'InvalidAllocation' });
  }

  const cardIds = [...new Set(picks.map((p) => p.cardId))];
  const slugs = new Set();
  const wanted = new Set();   // the exact (card, slug) pairs picked - the cross-product narrowing
  for (const p of picks) {
    for (const slug of [...printingSlugs(p.set, false), ...printingSlugs(p.set, true)]) {
      slugs.add(slug);
      wanted.add(`${p.cardId}|${slug}`);
    }
  }
  const slugList = [...slugs];
  const rows = await query(
    `SELECT id, card_id, variant_slug FROM owned_cards
      WHERE profile_id=?
        AND card_id IN (${cardIds.map(() => '?').join(',')})
        AND variant_slug IN (${slugList.map(() => '?').join(',')});`,
    [pid, ...cardIds, ...slugList],
  );
  const pickOf = new Map();   // owned row id -> the selected tile it belongs to
  const ownedCardIds = [];
  for (const r of rows) {
    if (!wanted.has(`${r.card_id}|${r.variant_slug}`)) continue;
    ownedCardIds.push(r.id);
    pickOf.set(r.id, `${r.card_id}|${bucketOf(r.variant_slug)}`);
  }

  const moved = await bulkMoveAllocations({ fromContainerId, toContainerId, ownedCardIds }, pid);
  const filed = new Set((moved.movedIds || []).map((id) => pickOf.get(id)).filter(Boolean));
  return { items: moved.items, copies: moved.copies, selected: picks.length, filed: filed.size };
}

/** One container's own row, or null. For a detail screen that was opened from a stale list. */
export async function getContainer(containerId, pid = activeProfileId()) {
  return (await query(
    'SELECT id, kind, name, description, colour, sort_order, is_system FROM storage_containers WHERE id=? AND profile_id=?;',
    [containerId, pid],
  ))[0] || null;
}

/**
 * Validate a name the user typed. Returns the trimmed name or throws.
 *
 * TWO refusals and ONE tolerance, and the difference is deliberate (Q9).
 *
 * A blank name is refused: it is unnameable in every later surface. The reserved name is refused:
 * a second "Unfiled" is indistinguishable from the system place in a list.
 *
 * A DUPLICATE IS ALLOWED. Q9: "must container names be unique? No, but warn on exact duplicate."
 * Two binders really can both be called "Beta", and the app is not the arbiter of what someone
 * calls their own shelves - the deck-name paths already work this way. The warning is the caller's
 * job, which is why duplicateName() below is a separate read: refusing here would put a wall in
 * front of a legitimate thing.
 */
function cleanName(raw) {
  const name = String(raw ?? '').trim().slice(0, MAX_CONTAINER_NAME);
  if (!name) throw Object.assign(new Error('A place needs a name.'), { name: 'InvalidContainer' });
  if (name.toLowerCase() === UNFILED_NAME.toLowerCase()) {
    throw Object.assign(new Error(`"${UNFILED_NAME}" is the place for cards you have not filed - pick another name.`), { name: 'InvalidContainer' });
  }
  return name;
}

/**
 * Does another place already carry this name? For the WARNING Q9 asks for, not a refusal.
 *
 * Read-only and caller-driven, so a surface can say "you already have one called that" and still
 * let the user proceed. Case-insensitive, because "beta" and "Beta" are the same shelf to a person.
 */
export async function duplicateName(name, { selfId = null, pid = activeProfileId() } = {}) {
  const wanted = String(name ?? '').trim().toLowerCase();
  if (!wanted) return false;
  const all = await listContainers(pid);
  return all.some((c) => c.id !== selfId && !c.is_system && String(c.name).toLowerCase() === wanted);
}

/** Create a user container. Never the system one - that is the backfill's and profile creation's job. */
export async function createContainer({ name, kind = 'binder', colour = DEFAULT_COLOUR, description = '' } = {}, pid = activeProfileId()) {
  if (!isUserContainerKind(kind)) throw Object.assign(new Error(`Unknown kind ${JSON.stringify(kind)}.`), { name: 'InvalidContainer' });
  if (!isContainerColour(colour)) throw Object.assign(new Error(`Unknown colour ${JSON.stringify(colour)}.`), { name: 'InvalidContainer' });
  const id = uuid();
  await withExclusiveCollectionWrites(async () => {
    const existing = await listContainers(pid);
    const clean = cleanName(name);
    // Appended, not inserted: a new place goes at the end of the user's order rather than
    // renumbering everything they have already arranged.
    const order = existing.reduce((n, c) => Math.max(n, Number(c.sort_order) || 0), 0) + 1;
    const now = nowIso();
    await tx([[
      `INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,0,?,?);`,
      [id, pid, kind, clean, String(description ?? '').slice(0, MAX_CONTAINER_DESC), colour, order, now, now],
    ]]);
  });
  notifyOwnedChanged();
  return id;
}

/** Rename / recolour / re-describe. The system container is immutable: it is not the user's to name. */
export async function updateContainer(containerId, { name, colour, description, kind } = {}, pid = activeProfileId()) {
  if (colour != null && !isContainerColour(colour)) {
    throw Object.assign(new Error(`Unknown colour ${JSON.stringify(colour)}.`), { name: 'InvalidContainer' });
  }
  // Q8: a kind changes after creation, because "cards move from a deck into a box constantly". The
  // kind describes what the place IS today, not what it was when it was made.
  if (kind != null && !isUserContainerKind(kind)) {
    throw Object.assign(new Error(`Unknown kind ${JSON.stringify(kind)}.`), { name: 'InvalidContainer' });
  }
  await withExclusiveCollectionWrites(async () => {
    const all = await listContainers(pid);
    const self = all.find((c) => c.id === containerId);
    if (!self) throw Object.assign(new Error('That place no longer exists.'), { name: 'InvalidContainer' });
    if (self.is_system) throw Object.assign(new Error(`${UNFILED_NAME} cannot be renamed.`), { name: 'InvalidContainer' });
    const sets = [];
    const params = [];
    if (name != null) { sets.push('name=?'); params.push(cleanName(name)); }
    if (colour != null) { sets.push('colour=?'); params.push(colour); }
    if (description != null) { sets.push('description=?'); params.push(String(description).slice(0, MAX_CONTAINER_DESC)); }
    if (kind != null) { sets.push('kind=?'); params.push(kind); }
    if (!sets.length) return;
    sets.push('updated_at=?'); params.push(nowIso());
    await tx([[`UPDATE storage_containers SET ${sets.join(', ')} WHERE id=? AND profile_id=?;`, [...params, containerId, pid]]]);
  });
  notifyOwnedChanged();
}

/**
 * Delete a container. Its copies go to Unfiled first (Q26).
 *
 * Under this model that is ARITHMETIC, not a policy choice: copies cannot be nowhere. Deleting a
 * binder does not mean the cards evaporated, it means they are no longer filed - which is exactly
 * what Unfiled represents. So no quantity changes and `qty_owned` is untouched throughout; only the
 * container_id of some allocations does.
 *
 * The move MERGES rather than inserting, because a card can already be unfiled as well as filed - the
 * unique index on (container_id, owned_card_id) is what would otherwise reject the whole delete.
 */
export async function deleteContainer(containerId, pid = activeProfileId()) {
  await withExclusiveCollectionWrites(async () => {
    const all = await listContainers(pid);
    const self = all.find((c) => c.id === containerId);
    if (!self) return;
    if (self.is_system) throw Object.assign(new Error(`${UNFILED_NAME} cannot be deleted.`), { name: 'InvalidContainer' });
    const unfiled = all.find((c) => c.is_system);
    if (!unfiled) throw new Error('deleteContainer: this profile has no Unfiled container.');

    const now = nowIso();
    await tx([
      // MERGE with what is already in Unfiled. `ON CONFLICT` cannot help here - the conflicting row is the
      // one we are moving FROM, so the upsert would add a row to itself.
      [`UPDATE storage_allocations
           SET qty = qty + COALESCE((SELECT m.qty FROM storage_allocations m
                                      WHERE m.container_id=? AND m.owned_card_id = storage_allocations.owned_card_id), 0),
               updated_at = ?
         WHERE container_id = ?;`, [containerId, now, unfiled.id]],
      // Now the moved rows carry no information the Unfiled row does not already have.
      [`DELETE FROM storage_allocations
         WHERE container_id = ?
           AND owned_card_id IN (SELECT owned_card_id FROM storage_allocations WHERE container_id = ?);`,
        [containerId, unfiled.id]],
      // Whatever is left was filed ONLY here, so it re-parents wholesale.
      ['UPDATE storage_allocations SET container_id=?, updated_at=? WHERE container_id=?;', [unfiled.id, now, containerId]],
      ['DELETE FROM storage_containers WHERE id=? AND profile_id=?;', [containerId, pid]],
      // The equality, in the same transaction. Nothing above may change a count - if the merge
      // arithmetic is wrong, this refuses the delete rather than losing the user's copies.
      [`INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at)
          SELECT ?, o.profile_id, 'delete-container-equality-violated', o.id, 0, '', ''
            FROM owned_cards o
           WHERE o.profile_id=?
             AND o.qty_owned <> COALESCE((SELECT SUM(a.qty) FROM storage_allocations a WHERE a.owned_card_id=o.id), 0);`,
        [uuid(), pid]],
    ]);
  });
  notifyOwnedChanged();
}

/**
 * Write the user's manual order for their places (Q10: "manual with sort_order").
 *
 * WHOLE-ORDER, NOT A STEP. The one-step swap this replaces existed to serve "Move earlier / Move
 * later" menu items; the gesture is now long-press and drag (DESIGN_SYSTEM §Ordering, owner ruling
 * 2026-08-20), and a drag states a whole arrangement, not a delta. Taking the whole list also makes
 * the write idempotent and self-repairing: places created in the same breath can share a sort_order,
 * and a renumber fixes that rather than tripping over it the way a value swap did.
 *
 * REFUSES RATHER THAN PARTIALLY APPLIES. `orderedIds` must be exactly the profile's non-system
 * containers - same members, no duplicates, nothing missing. A caller that hands over a filtered or
 * stale list is describing an order for a list that does not exist, and quietly ordering the subset
 * would silently demote every place it omitted. Validation happens inside the exclusive section, so
 * a place created or deleted on another surface between the drag and the drop is caught rather than
 * raced past.
 *
 * POSITIONS ARE 1-BASED because Unfiled sits at -1 and is pinned first (Q15). It is neither
 * reordered nor renumbered here; a 0-based scheme would tie it with the first user place and leave
 * `ORDER BY sort_order, name` to break the tie alphabetically.
 */
export async function reorderContainers(orderedIds, pid = activeProfileId()) {
  const ids = [...(orderedIds || [])];
  await withExclusiveCollectionWrites(async () => {
    const mine = (await listContainers(pid)).filter((c) => !c.is_system);
    const have = new Set(mine.map((c) => c.id));
    const seen = new Set(ids);
    if (ids.length !== mine.length || seen.size !== ids.length || ids.some((id) => !have.has(id))) {
      throw Object.assign(
        new Error('That ordering does not match your places any more - reopen Storage and try again.'),
        { name: 'InvalidContainer' },
      );
    }
    if (mine.every((c, i) => c.id === ids[i] && Number(c.sort_order) === i + 1)) return;
    const now = nowIso();
    await tx(ids.map((id, i) => [
      'UPDATE storage_containers SET sort_order=?, updated_at=? WHERE id=? AND profile_id=? AND is_system=0;',
      [i + 1, now, id, pid],
    ]));
  });
  notifyOwnedChanged();
}

/** The Unfiled container's id for a profile, for surfaces that need to name the default place. */
export async function unfiledId(pid = activeProfileId()) {
  return (await query('SELECT id FROM storage_containers WHERE profile_id=? AND is_system=1;', [pid]))[0]?.id || null;
}

export { SYSTEM_KIND, UNFILED_NAME };
