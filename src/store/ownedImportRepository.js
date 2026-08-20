// The transactional OWNED text-import writer - the collection paste's Confirm commits here.
//
// This is the hardening of the old `importCollectionResolved`, which accepted only
// { card_id, qty, setCode }, hardcoded canonicalPrinting(setCode, false), and wrote WITHOUT the
// barrier or any catalog validation. That left three holes v11 spent rounds closing everywhere
// else:
//
//   1. FINISH WAS DROPPED. `2 Card [Beta] [Foil]` persisted as Beta NON-foil - a ledger lie. The
//      writer now carries `foil` end to end and files canonicalPrinting(setCode, foil).
//   2. IMPOSSIBLE ITEMS BELOW THE UI. Plan-time UI validation is bypassable; a forged or regressed
//      caller could write a non-foil Winter River (a printing that does not exist). This reads the
//      catalog INSIDE the barrier and rejects the WHOLE batch before any SQL if any item names a
//      card that does not exist, a set the card is not printed in, or a finish that printing lacks.
//   3. LOST UPDATES. It runs inside `withExclusiveCollectionWrites` - the same barrier the want
//      command uses - so a queued absolute ownership edit cannot interleave with the batch
//      increment and clobber it.
//
// THE OWNED/WANTED ASYMMETRY. An EMPTY setCode is VALID here and writes the canonical uncategorised
// key for the finish (uncategorised / uncategorised:f). Uncategorised OWNED copies are a
// first-class state - the To Be Categorised pile a bare import line legitimately lands in. A WANT
// may never be uncategorised, which is why the want command has no empty-setCode branch.
//
// It carries the SAME write-outcome contract as the want command (bulkWriteContract.js): a
// rejection says whether it failed before the transaction (prewrite/none - nothing written) or
// during it (transaction/unknown - the web commit-then-persist hazard means the write may have
// landed; broadcast, reconcile, never claim nothing-written, never auto-retry).
import { query as dbQuery, tx as dbTx } from './db.js';
import { activeProfileId as realActiveProfileId } from './profileRepository.js';
import { withExclusiveCollectionWrites } from './collectionWrites.js';
import { notifyOwnedChanged } from './ownedRepository.js';
import { canonicalPrinting } from './printings.js';
import { printingFinishes } from './printingRows.js';
import { uuid as newId, nowIso as newNow } from './ids.js';
import { bulkWriteError, MAX_ITEM_QTY, MAX_BATCH_ITEMS } from './bulkWriteContract.js';
import { planAllocationChanges, placeUnfiledByKeyStatements, assertEqualityStatements } from './storageRepository.js';

// The largest total the ledger can safely STORE. MAX_ITEM_QTY (999) is only an input/delta limit;
// the ledger itself has no 999 cap (two 999 imports legitimately total 1998 - see the data model), so
// Adjust plans against this ceiling and never truncates an existing total. It is the JS safe-integer
// bound because a total larger than that cannot be represented, not a product rule.
const LEDGER_MAX = Number.MAX_SAFE_INTEGER;

// Re-exported so callers and tests can reach the shared bounds through this command's module.
export { MAX_ITEM_QTY, MAX_BATCH_ITEMS };

function setCodesOf(cardRow) {
  let raw = cardRow?.sets;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = []; } }
  return Array.isArray(raw) ? raw.map((s) => s?.code).filter(Boolean) : [];
}

/**
 * Validate and merge an owned-import batch against the catalog. PURE - no database, no barrier.
 *
 * Rejects the whole batch (throws) on the first violation, naming the offending item, BEFORE any
 * SQL. Merges duplicates by `(card_id, canonical slug)` so a batch that lists the same item twice
 * writes one summed row.
 *
 * @param items       [{ card_id, qty, setCode, foil }]  setCode '' = uncategorised (owned only)
 * @param catalogById Map<card_id, { sets, variants }> read authoritatively by the command
 * @returns [{ card_id, slug, qty }]
 */
export function planOwnedItemBatch(items, catalogById) {
  if (!Array.isArray(items)) throw new Error('planOwnedItemBatch: items must be an array');
  if (items.length > MAX_BATCH_ITEMS) throw new Error(`planOwnedItemBatch: batch exceeds ${MAX_BATCH_ITEMS} items`);
  const merged = new Map();
  for (const it of items) {
    const cardId = it?.card_id;
    const setCode = it?.setCode;
    // A real boolean, not a coercion. `!!"false"` is true, which would file the wrong item.
    if (typeof it?.foil !== 'boolean') {
      throw new Error(`planOwnedItemBatch: foil must be a boolean for ${cardId}, got ${JSON.stringify(it?.foil)}`);
    }
    const foil = it.foil;
    const qty = it?.qty;
    if (!Number.isSafeInteger(qty) || qty <= 0 || qty > MAX_ITEM_QTY) {
      throw new Error(`planOwnedItemBatch: qty ${JSON.stringify(qty)} out of range (1..${MAX_ITEM_QTY}) for ${cardId}`);
    }
    const card = catalogById.get(cardId);
    if (!card) throw new Error(`planOwnedItemBatch: unknown card ${JSON.stringify(cardId)}`);

    // setCode must be EXACTLY a string. Only the empty string means uncategorised; undefined, null,
    // false, and 0 are malformed input, not a shorthand the writer is allowed to reinterpret as a
    // valid uncategorised item.
    if (typeof setCode !== 'string') {
      throw new Error(`planOwnedItemBatch: setCode must be a string for ${cardId}, got ${JSON.stringify(setCode)}`);
    }
    // A nonempty setCode must be a real set of THIS card AND carry the requested finish
    // (printingFinishes is strict - it throws on malformed catalog variants rather than authorising
    // a phantom item). An empty setCode is the uncategorised owned bucket - no set or finish check,
    // because the owned grain may legitimately be uncategorised.
    if (setCode) {
      if (!setCodesOf(card).includes(setCode)) {
        throw new Error(`planOwnedItemBatch: ${JSON.stringify(setCode)} is not a set of ${cardId}`);
      }
      const fin = printingFinishes(card, setCode);
      if (foil ? !fin.foil : !fin.nonFoil) {
        throw new Error(`planOwnedItemBatch: ${foil ? 'foil' : 'non-foil'} is not a printing of ${cardId} in ${setCode}`);
      }
    }

    const slug = canonicalPrinting(setCode, foil);
    const key = `${cardId}|${slug}`;
    const nextQty = (merged.get(key)?.qty || 0) + qty;
    if (!Number.isSafeInteger(nextQty)) throw new Error(`planOwnedItemBatch: merged qty overflow for ${key}`);
    merged.set(key, { card_id: cardId, slug, qty: nextQty });
  }
  return [...merged.values()];
}

/**
 * Plan an ABSOLUTE owned-set batch: each item SETS `qty_owned` for its collector item, rather than
 * adding. `qty: 0` clears the copies - deleting the row, UNLESS it also carries a want, in which case
 * only the owned count is zeroed so a bulk owned cleanup never wipes a wishlist goal. PURE.
 *
 * Order-INDEPENDENT: every item is validated FIRST, then duplicate targets for one collector item are
 * coalesced when identical and REJECTED when they conflict (`[{0},{5}]` is a caller bug, not a
 * silent first-wins). A no-op (setting a row to the value it already holds, or clearing an
 * already-empty one) emits NO statement and counts as `unchanged`, so the toast can be honest and the
 * write can be a true no-op.
 *
 * A POSITIVE set validates the printing against the catalog (a foil-only set can't take a non-foil,
 * etc.), like the add path. A ZERO is exempt - clearing a historical or malformed row must always be
 * possible, exactly as the want writers treat zero.
 *
 * `ceiling` is the maximum a stored total may be SET to, defaulting to MAX_ITEM_QTY (999) so the
 * direct Set path preserves its 0..999 input contract. The Adjust path passes a ledger-safe ceiling
 * so it never silently truncates a legitimately larger existing total (two 999 imports = 1998) down
 * to 999 - 999 is an input limit, not a stored-ledger cap.
 *
 * @param items       [{ card_id, setCode, foil, qty }]  qty 0 = clear
 * @param catalogById Map<card_id, { sets, variants }>  (positive items only need be present)
 * @param currentByKey Map<`card_id|slug`, { id, qty_owned, qty_wanted }>  the owned rows already on file
 * @param opts        { pid, uuid, now, ceiling = MAX_ITEM_QTY }
 * @returns { statements, set, removed, cleared, unchanged, cards, copiesAdded, copiesRemoved }
 *          `set` = rows whose positive target was updated/inserted (INCLUDES a lowering to a positive
 *          value, e.g. 5->2); `copiesAdded`/`copiesRemoved` are the true copy movement from the
 *          authoritative cur->target pairs, so a confirmation can state copies, not just rows.
 */
export function planOwnedSetBatch(items, catalogById, currentByKey, { pid, uuid, now, ceiling = MAX_ITEM_QTY }) {
  if (!Array.isArray(items)) throw new Error('planOwnedSetBatch: items must be an array');
  if (items.length > MAX_BATCH_ITEMS) throw new Error(`planOwnedSetBatch: batch exceeds ${MAX_BATCH_ITEMS} items`);

  // Pass 1: validate EVERY item, then fold into one target per collector item. Validation precedes
  // the fold so a malformed item is caught regardless of its position or whether it is a duplicate.
  const targets = new Map();   // key -> { card_id, slug, qty }
  for (const it of items) {
    const cardId = it?.card_id;
    if (typeof it?.foil !== 'boolean') throw new Error(`planOwnedSetBatch: foil must be a boolean for ${cardId}, got ${JSON.stringify(it?.foil)}`);
    const foil = it.foil;
    const setCode = it?.setCode;
    if (typeof setCode !== 'string') throw new Error(`planOwnedSetBatch: setCode must be a string for ${cardId}, got ${JSON.stringify(setCode)}`);
    const qty = it?.qty;
    if (!Number.isSafeInteger(qty) || qty < 0 || qty > ceiling) throw new Error(`planOwnedSetBatch: qty ${JSON.stringify(qty)} out of range (0..${ceiling}) for ${cardId}`);

    if (qty > 0) {   // a positive set must name a real printing (zero is exempt - see the doc above)
      const card = catalogById.get(cardId);
      if (!card) throw new Error(`planOwnedSetBatch: unknown card ${JSON.stringify(cardId)}`);
      if (setCode) {
        if (!setCodesOf(card).includes(setCode)) throw new Error(`planOwnedSetBatch: ${JSON.stringify(setCode)} is not a set of ${cardId}`);
        const fin = printingFinishes(card, setCode);
        if (foil ? !fin.foil : !fin.nonFoil) throw new Error(`planOwnedSetBatch: ${foil ? 'foil' : 'non-foil'} is not a printing of ${cardId} in ${setCode}`);
      }
    }

    const slug = canonicalPrinting(setCode, foil);
    const key = `${cardId}|${slug}`;
    const prev = targets.get(key);
    if (prev && prev.qty !== qty) throw new Error(`planOwnedSetBatch: conflicting targets for ${key} - ${prev.qty} and ${qty}`);
    if (!prev) targets.set(key, { card_id: cardId, slug, qty });   // identical duplicate coalesces
  }

  // Pass 2: turn each unique target into a statement, OMITTING no-ops (unchanged rows). Copy movement
  // (copiesAdded/copiesRemoved) is accumulated from the authoritative cur->target pair per row, so the
  // confirmation reports what actually changed on the ledger rather than what was requested.
  const statements = [];
  // Every row whose count actually moves, in the shape the shared allocation planner takes. The
  // planner stays PURE - it cannot read the places itself - so it names the movement and the
  // command layer, which has a query, turns it into allocation statements. Without this the whole
  // absolute-import path moved copies while their places stood still, and its clear-to-zero would
  // have failed outright on real data: an owned row with allocations cannot be deleted under
  // RESTRICT, which is the point of RESTRICT.
  const changes = [];
  const cards = new Set();
  let set = 0, removed = 0, cleared = 0, unchanged = 0, copiesAdded = 0, copiesRemoved = 0;
  for (const { card_id, slug, qty } of targets.values()) {
    cards.add(card_id);
    const existing = currentByKey.get(`${card_id}|${slug}`);
    const curOwned = existing ? (existing.qty_owned || 0) : 0;
    const moved = (rowId) => changes.push({ rowId, cardId: card_id, variantSlug: slug, before: curOwned, after: qty });
    if (qty === 0) {
      if (!existing || curOwned === 0) { unchanged += 1; continue; }   // already empty - true no-op
      copiesRemoved += curOwned;
      moved(existing.id);
      if ((existing.qty_wanted || 0) > 0) { statements.push({ sql: 'UPDATE owned_cards SET qty_owned=0, updated_at=? WHERE id=?;', params: [now, existing.id] }); cleared += 1; }
      else { statements.push({ sql: 'DELETE FROM owned_cards WHERE id=?;', params: [existing.id] }); removed += 1; }
    } else if (existing && curOwned === qty) {
      unchanged += 1;   // already at the requested value - true no-op
    } else if (existing) {
      if (qty > curOwned) copiesAdded += qty - curOwned; else copiesRemoved += curOwned - qty;
      moved(existing.id);
      statements.push({ sql: 'UPDATE owned_cards SET qty_owned=?, updated_at=? WHERE id=?;', params: [qty, now, existing.id] });
      set += 1;
    } else {
      copiesAdded += qty;
      moved(null);
      statements.push({ sql: 'INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?);', params: [uuid(), pid, card_id, slug, qty, '', now, now] });
      set += 1;
    }
  }
  return { statements, changes, set, removed, cleared, unchanged, cards: cards.size, copiesAdded, copiesRemoved };
}

/** Build the command over injected primitives so the barrier tests run PRODUCTION code. */
export function createOwnedImportCommand({ exclusive, query, tx, notify, uuid = newId, nowIso = newNow, activeProfileId = realActiveProfileId }) {
  async function readCatalog(ids) {
    const map = new Map();
    const uniq = [...new Set(ids)];
    for (let i = 0; i < uniq.length; i += 400) {
      const chunk = uniq.slice(i, i + 400);
      const rows = await query(`SELECT card_id, sets, variants FROM cards WHERE card_id IN (${chunk.map(() => '?').join(',')});`, chunk);
      for (const r of rows) map.set(r.card_id, r);
    }
    return map;
  }

  /**
   * Commit a reviewed owned import. `pid` is captured by the CALLER at the gesture, before any
   * await, so the write binds to the profile the user was looking at.
   * @returns { items, cards, copies } on success; throws a BulkWriteError otherwise. `items` is the
   *          number of collector items (printings) filed; `cards` is the DISTINCT card count, so
   *          two printings of one card do not read as two cards in the confirmation.
   */
  async function importCollectionResolved(items, pid = activeProfileId()) {
    if (!pid) throw bulkWriteError('prewrite', 'none', 'importCollectionResolved: no active profile.');
    if (items != null && !Array.isArray(items)) throw bulkWriteError('prewrite', 'none', 'importCollectionResolved: items must be an array.');
    const list = items || [];
    if (!list.length) return { items: 0, cards: 0, copies: 0 };
    if (list.length > MAX_BATCH_ITEMS) throw bulkWriteError('prewrite', 'none', `importCollectionResolved: batch exceeds ${MAX_BATCH_ITEMS} items.`);

    let ranTransaction = false;
    try {
      const result = await exclusive(async () => {
        const catalog = await readCatalog(list.map((i) => i?.card_id));
        const plan = planOwnedItemBatch(list, catalog);   // throws (prewrite) on any impossible item
        if (!plan.length) return { items: 0, cards: 0, copies: 0, noop: true };

        const now = nowIso();
        // Read-free, like the scanner's adder and for the same reason, so the places are resolved
        // in SQL too rather than by a lookup that would reintroduce the read.
        const stmts = [
          ...plan.map((p) => ([
            `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
             VALUES(?,?,?,?,?,0,'',?,?)
             ON CONFLICT(profile_id,card_id,variant_slug)
             DO UPDATE SET qty_owned=qty_owned+excluded.qty_owned, updated_at=excluded.updated_at;`,
            [uuid(), pid, p.card_id, p.slug, p.qty, now, now],
          ])),
          ...plan.flatMap((p) => placeUnfiledByKeyStatements({ profileId: pid, cardId: p.card_id, variantSlug: p.slug, qty: p.qty, now })),
          ...assertEqualityStatements(pid, plan.map((p) => ({ cardId: p.card_id, variantSlug: p.slug })), 'importCollectionResolved'),
        ];

        ranTransaction = true;   // from here the database may differ, confirmed or not
        await tx(stmts);         // resolving means committed AND persisted; rejecting is indeterminate
        return { items: plan.length, cards: new Set(plan.map((p) => p.card_id)).size, copies: plan.reduce((s, p) => s + p.qty, 0) };
      });
      if (ranTransaction && !result.noop) notify();
      return result.noop ? { items: 0, cards: 0, copies: 0 } : result;
    } catch (e) {
      if (ranTransaction) notify();   // memory may have changed even on a rejected tx - invalidate
      if (e && e.name === 'BulkWriteError') throw e;   // already classified
      throw ranTransaction
        ? bulkWriteError('transaction', 'unknown', e?.message || String(e))
        : bulkWriteError('prewrite', 'none', e?.message || String(e));
    }
  }

  // Read the current owned rows (id + qty_owned + qty_wanted) for a set of cards under one profile,
  // keyed `card_id|variant_slug`. Shared by every absolute-set path so the plan can delete-or-keep-want
  // a zero, update-or-insert a positive, and no-op an already-correct row.
  async function readCurrentOwned(cardIds, pid) {
    const currentByKey = new Map();
    for (let i = 0; i < cardIds.length; i += 400) {
      const chunk = cardIds.slice(i, i + 400);
      const rows = await query(`SELECT id, card_id, variant_slug, qty_owned, qty_wanted FROM owned_cards WHERE profile_id=? AND card_id IN (${chunk.map(() => '?').join(',')});`, [pid, ...chunk]);
      for (const r of rows) currentByKey.set(`${r.card_id}|${r.variant_slug}`, r);
    }
    return currentByKey;
  }

  // Run one planned absolute write end to end under the barrier: the `plan` callback (executed INSIDE
  // the exclusive holder) returns a planOwnedSetBatch result; we run its statements in ONE tx and
  // broadcast exactly ONCE, or no-op silently when the plan is empty. Both setOwnedItemsBulk and
  // adjustOwnedItemsBulk funnel through here, so they share the single-broadcast + write-outcome
  // contract (prewrite/none before the tx, transaction/unknown once statements have been dispatched).
  async function runPlannedWrite(plan, pid) {
    let ranTransaction = false;
    try {
      const result = await exclusive(async () => {
        const p = await plan();   // throws (prewrite) on an impossible positive OR a conflicting target
        const summary = { set: p.set, removed: p.removed, cleared: p.cleared, unchanged: p.unchanged, cards: p.cards, copiesAdded: p.copiesAdded, copiesRemoved: p.copiesRemoved };
        if (!p.statements.length) return { ...summary, noop: true };
        const { pre, post, conflicts } = await planAllocationChanges({ query, profileId: pid, changes: p.changes || [], now: nowIso() });
        if (conflicts.length) {
          // Same policy as bulk: an absolute import is one atomic command, so a selection it
          // cannot satisfy fails whole rather than filing part of someone's collection.
          //
          // Raised as a BulkWriteError rather than a StorageConflict because that is what leaves
          // this function - the catch below classified the StorageConflict and dropped its detail
          // on the floor, so every refusal reached the user as the generic "Couldn't update those
          // cards", indistinguishable from a disk failure. It is prewrite/none by construction:
          // planning happens before a single statement is dispatched, so nothing was written and
          // the selection is safe to keep. The conflicts ride along so the surface can say WHY,
          // the way the stepper's wall already does.
          const e = bulkWriteError('prewrite', 'none',
            `ownedImport: ${conflicts.length} item${conflicts.length === 1 ? '' : 's'} hold copies outside Unfiled`);
          e.storageConflict = { items: conflicts };
          throw e;
        }
        ranTransaction = true;
        await tx([
          // Clears and removals first - a row with places cannot be deleted under RESTRICT - then
          // the counts, then the places, then the equality for every row the command touched.
          ...pre,
          ...p.statements.map((s) => [s.sql, s.params]),
          ...post,
          ...assertEqualityStatements(pid, (p.changes || []).map((c) => ({ cardId: c.cardId, variantSlug: c.variantSlug })), 'ownedImport'),
        ]);
        return { ...summary, noop: false };
      });
      if (ranTransaction && !result.noop) notify();
      return { set: result.set, removed: result.removed, cleared: result.cleared, unchanged: result.unchanged, cards: result.cards, copiesAdded: result.copiesAdded, copiesRemoved: result.copiesRemoved };
    } catch (e) {
      if (ranTransaction) notify();
      if (e && e.name === 'BulkWriteError') throw e;
      throw ranTransaction
        ? bulkWriteError('transaction', 'unknown', e?.message || String(e))
        : bulkWriteError('prewrite', 'none', e?.message || String(e));
    }
  }

  /**
   * Commit an absolute owned-SET batch (bulk edit / bulk delete). One transaction, ONE broadcast.
   * Each target is bounded 0..MAX_ITEM_QTY (the direct-Set input contract).
   * @param items [{ card_id, setCode, foil, qty }]  qty 0 = clear (row removed, any want kept)
   * @returns { set, removed, cleared, unchanged, cards, copiesAdded, copiesRemoved }
   */
  async function setOwnedItemsBulk(items, pid = activeProfileId()) {
    if (!pid) throw bulkWriteError('prewrite', 'none', 'setOwnedItemsBulk: no active profile.');
    if (items != null && !Array.isArray(items)) throw bulkWriteError('prewrite', 'none', 'setOwnedItemsBulk: items must be an array.');
    const list = items || [];
    if (!list.length) return { set: 0, removed: 0, cleared: 0, unchanged: 0, cards: 0, copiesAdded: 0, copiesRemoved: 0 };
    if (list.length > MAX_BATCH_ITEMS) throw bulkWriteError('prewrite', 'none', `setOwnedItemsBulk: batch exceeds ${MAX_BATCH_ITEMS} items.`);

    return runPlannedWrite(async () => {
      const catalog = await readCatalog(list.filter((i) => (i?.qty | 0) > 0).map((i) => i?.card_id));
      const cardIds = [...new Set(list.map((i) => i?.card_id).filter(Boolean))];
      const currentByKey = await readCurrentOwned(cardIds, pid);
      return planOwnedSetBatch(list, catalog, currentByKey, { pid, uuid, now: nowIso() });
    }, pid);
  }

  /**
   * Commit a RELATIVE owned-adjust batch (bulk "Adjust": raise or lower each item by a signed delta).
   * The absolute target is computed from the PRESENT count INSIDE the barrier - `max(0, cur + delta)` -
   * so it respects what's on file and a UI-side compute can't race it. There is NO upper clamp to 999:
   * MAX_ITEM_QTY bounds the per-request delta (an INPUT limit), never the resulting stored total, so a
   * legitimately larger existing total (two 999 imports = 1998) is never silently truncated. Reaching
   * 0 reuses the set-to-0 semantics (owned row removed, any wishlist want preserved). The resolved
   * target is planned against a ledger-safe ceiling and guarded to a safe integer. One tx, ONE broadcast.
   * @param items [{ card_id, setCode, foil, delta }]  delta signed, non-zero, |delta| <= MAX_ITEM_QTY
   * @returns { set, removed, cleared, unchanged, cards, copiesAdded, copiesRemoved }
   *          (set = rows updated/inserted to a positive value, incl. a positive lowering; removed+cleared = fell to 0)
   */
  async function adjustOwnedItemsBulk(items, pid = activeProfileId()) {
    if (!pid) throw bulkWriteError('prewrite', 'none', 'adjustOwnedItemsBulk: no active profile.');
    if (items != null && !Array.isArray(items)) throw bulkWriteError('prewrite', 'none', 'adjustOwnedItemsBulk: items must be an array.');
    const list = items || [];
    if (!list.length) return { set: 0, removed: 0, cleared: 0, unchanged: 0, cards: 0, copiesAdded: 0, copiesRemoved: 0 };
    if (list.length > MAX_BATCH_ITEMS) throw bulkWriteError('prewrite', 'none', `adjustOwnedItemsBulk: batch exceeds ${MAX_BATCH_ITEMS} items.`);
    // Validate shape up front (prewrite): a non-zero, in-range signed delta over a well-formed printing.
    for (const it of list) {
      if (typeof it?.foil !== 'boolean') throw bulkWriteError('prewrite', 'none', `adjustOwnedItemsBulk: foil must be a boolean for ${it?.card_id}, got ${JSON.stringify(it?.foil)}`);
      if (typeof it?.setCode !== 'string') throw bulkWriteError('prewrite', 'none', `adjustOwnedItemsBulk: setCode must be a string for ${it?.card_id}, got ${JSON.stringify(it?.setCode)}`);
      const d = it?.delta;
      if (!Number.isSafeInteger(d) || d === 0 || d < -MAX_ITEM_QTY || d > MAX_ITEM_QTY) throw bulkWriteError('prewrite', 'none', `adjustOwnedItemsBulk: delta ${JSON.stringify(d)} out of range (non-zero, +-${MAX_ITEM_QTY}) for ${it?.card_id}`);
    }

    return runPlannedWrite(async () => {
      const cardIds = [...new Set(list.map((i) => i.card_id).filter(Boolean))];
      const currentByKey = await readCurrentOwned(cardIds, pid);
      // Fold deltas per collector item FIRST (two picks of one printing sum), then resolve each to an
      // absolute target against the present count. This coalesces to one target per key, so the set
      // planner never sees a "conflict".
      const deltaByKey = new Map();
      for (const it of list) {
        const slug = canonicalPrinting(it.setCode, it.foil);
        const key = `${it.card_id}|${slug}`;
        const prev = deltaByKey.get(key);
        deltaByKey.set(key, { card_id: it.card_id, setCode: it.setCode, foil: it.foil, slug, delta: (prev ? prev.delta : 0) + it.delta });
      }
      const absoluteList = [...deltaByKey.values()].map(({ card_id, setCode, foil, slug, delta }) => {
        const cur = currentByKey.get(`${card_id}|${slug}`)?.qty_owned || 0;
        // Guard the authoritative present count and the resolved total as safe non-negative integers -
        // a corrupt/overflowing row must reject (prewrite), never write a garbage total.
        if (!Number.isSafeInteger(cur) || cur < 0) throw new Error(`adjustOwnedItemsBulk: present count ${JSON.stringify(cur)} is not a safe non-negative integer for ${card_id}`);
        const raw = cur + delta;
        if (!Number.isSafeInteger(raw)) throw new Error(`adjustOwnedItemsBulk: ${cur} + ${delta} overflows the safe-integer range for ${card_id}`);
        return { card_id, setCode, foil, qty: Math.max(0, raw) };   // floor at 0; NO upper clamp
      });
      const catalog = await readCatalog(absoluteList.filter((i) => i.qty > 0).map((i) => i.card_id));
      return planOwnedSetBatch(absoluteList, catalog, currentByKey, { pid, uuid, now: nowIso(), ceiling: LEDGER_MAX });
    }, pid);
  }

  /**
   * Create a list AND populate it in ONE transaction (bulk "New list from selection"). The parent row
   * and every entry commit together or not at all, so a backgrounded app or a mid-loop profile switch
   * can never leave a half-populated list. `cardIds` are card-grain and de-duplicated. `pid` is
   * captured by the CALLER at the submit gesture.
   *
   * `card_list_entries.card_id` has NO catalog foreign key, so an unknown id would commit as a phantom
   * entry that joins away to nothing on read - counted but invisible, an internally inconsistent list.
   * We therefore fail closed: strict input validation up front, then an authoritative catalog-membership
   * check INSIDE the barrier that rejects the whole operation before a single row is written.
   * @returns { id, kind, name, entries } on success; throws a BulkWriteError otherwise.
   */
  async function createListWithEntries({ kind, name, description = '', cardIds } = {}, pid = activeProfileId()) {
    if (!pid) throw bulkWriteError('prewrite', 'none', 'createListWithEntries: no active profile.');
    if (kind !== 'wanted' && kind !== 'custom') throw bulkWriteError('prewrite', 'none', `createListWithEntries: kind must be "wanted" or "custom", got ${JSON.stringify(kind)}.`);
    const nm = String(name || '').trim();
    if (!nm) throw bulkWriteError('prewrite', 'none', 'createListWithEntries: a name is required.');
    if (!Array.isArray(cardIds)) throw bulkWriteError('prewrite', 'none', 'createListWithEntries: cardIds must be an array.');
    // Enforce the ceiling against the RAW array, before dedup, so duplicates can't smuggle an
    // unbounded payload past the guard.
    if (cardIds.length > MAX_BATCH_ITEMS) throw bulkWriteError('prewrite', 'none', `createListWithEntries: exceeds ${MAX_BATCH_ITEMS} entries.`);
    // Reject a malformed id, never silently drop it - a dropped id is a silent partial write.
    for (const c of cardIds) {
      if (typeof c !== 'string' || !c.trim()) throw bulkWriteError('prewrite', 'none', `createListWithEntries: invalid card id ${JSON.stringify(c)}.`);
    }
    const ids = [...new Set(cardIds.map((c) => c.trim()))];

    const listId = uuid();
    const now = nowIso();
    let ranTransaction = false;
    try {
      await exclusive(async () => {
        // Authoritative catalog read under the barrier: reject the WHOLE op if any id is not a real
        // card. Thrown as a plain Error while ranTransaction is false, so the catch classifies it
        // prewrite/none - nothing written, no broadcast.
        if (ids.length) {
          const catalog = await readCatalog(ids);
          const missing = ids.filter((id) => !catalog.has(id));
          if (missing.length) throw new Error(`createListWithEntries: unknown card(s) ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}.`);
        }
        const stmts = [
          ['INSERT INTO card_lists(id,profile_id,kind,name,description,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?);', [listId, pid, kind, nm, description || '', now, now]],
          ...ids.map((cid) => ['INSERT INTO card_list_entries(id,list_id,card_id,quantity,variant_slug,added_at) VALUES(?,?,?,1,?,?);', [uuid(), listId, cid, '', now]]),
        ];
        ranTransaction = true;
        await tx(stmts);
      });
      notify();
      return { id: listId, kind, name: nm, entries: ids.length };
    } catch (e) {
      if (ranTransaction) notify();
      if (e && e.name === 'BulkWriteError') throw e;
      throw ranTransaction
        ? bulkWriteError('transaction', 'unknown', e?.message || String(e))
        : bulkWriteError('prewrite', 'none', e?.message || String(e));
    }
  }

  /**
   * Add card ids to an EXISTING list as one barrier-guarded transaction. Mirrors createListWithEntries:
   * strict input validation + the MAX_BATCH_ITEMS ceiling on the RAW array, an authoritative catalog-
   * membership check INSIDE the barrier, and the list must belong to the active profile (fail closed on
   * a foreign/stale id). Ids already in the list are skipped so no duplicate row is ever written - the
   * op is idempotent. @returns { listId, added, skipped } on success; throws a BulkWriteError otherwise.
   */
  async function addEntriesToList({ listId, cardIds } = {}, pid = activeProfileId()) {
    if (!pid) throw bulkWriteError('prewrite', 'none', 'addEntriesToList: no active profile.');
    const lid = String(listId || '').trim();
    if (!lid) throw bulkWriteError('prewrite', 'none', 'addEntriesToList: a listId is required.');
    if (!Array.isArray(cardIds)) throw bulkWriteError('prewrite', 'none', 'addEntriesToList: cardIds must be an array.');
    // Ceiling against the RAW array, before dedup, so duplicates can't smuggle an unbounded payload past.
    if (cardIds.length > MAX_BATCH_ITEMS) throw bulkWriteError('prewrite', 'none', `addEntriesToList: exceeds ${MAX_BATCH_ITEMS} entries.`);
    for (const c of cardIds) {
      if (typeof c !== 'string' || !c.trim()) throw bulkWriteError('prewrite', 'none', `addEntriesToList: invalid card id ${JSON.stringify(c)}.`);
    }
    const ids = [...new Set(cardIds.map((c) => c.trim()))];
    const now = nowIso();
    let ranTransaction = false;
    let added = 0;
    let skipped = 0;
    try {
      await exclusive(async () => {
        // The list must exist AND belong to this profile - a foreign/stale id is rejected, nothing written.
        const owned = await query('SELECT id FROM card_lists WHERE id=? AND profile_id=?;', [lid, pid]);
        if (!owned.length) throw new Error('addEntriesToList: no such list for this profile.');
        if (ids.length) {
          const catalog = await readCatalog(ids);
          const missing = ids.filter((id) => !catalog.has(id));
          if (missing.length) throw new Error(`addEntriesToList: unknown card(s) ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}.`);
        }
        // Skip ids already in the list (card grain) so we never write a duplicate entry.
        const existing = new Set((await query('SELECT card_id FROM card_list_entries WHERE list_id=?;', [lid])).map((r) => r.card_id));
        const fresh = ids.filter((id) => !existing.has(id));
        skipped = ids.length - fresh.length;
        added = fresh.length;
        if (fresh.length) {
          ranTransaction = true;
          await tx([
            ...fresh.map((cid) => ['INSERT INTO card_list_entries(id,list_id,card_id,quantity,variant_slug,added_at) VALUES(?,?,?,1,?,?);', [uuid(), lid, cid, '', now]]),
            ['UPDATE card_lists SET updated_at=? WHERE id=? AND profile_id=?;', [now, lid, pid]],
          ]);
        }
      });
      if (ranTransaction) notify();   // an all-present op wrote nothing - honour the no-op contract (no broadcast)
      return { listId: lid, added, skipped };
    } catch (e) {
      if (ranTransaction) notify();
      if (e && e.name === 'BulkWriteError') throw e;
      throw ranTransaction
        ? bulkWriteError('transaction', 'unknown', e?.message || String(e))
        : bulkWriteError('prewrite', 'none', e?.message || String(e));
    }
  }

  return { importCollectionResolved, setOwnedItemsBulk, adjustOwnedItemsBulk, createListWithEntries, addEntriesToList };
}

/** Production instance, wired to the REAL barrier. */
const production = createOwnedImportCommand({
  exclusive: withExclusiveCollectionWrites,
  query: dbQuery,
  tx: dbTx,
  notify: notifyOwnedChanged,
});

export const importCollectionResolved = production.importCollectionResolved;
export const setOwnedItemsBulk = production.setOwnedItemsBulk;
export const adjustOwnedItemsBulk = production.adjustOwnedItemsBulk;
export const createListWithEntries = production.createListWithEntries;
export const addEntriesToList = production.addEntriesToList;
