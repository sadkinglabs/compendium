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
 * @param items       [{ card_id, setCode, foil, qty }]  qty 0 = clear
 * @param catalogById Map<card_id, { sets, variants }>  (positive items only need be present)
 * @param currentByKey Map<`card_id|slug`, { id, qty_owned, qty_wanted }>  the owned rows already on file
 * @returns { statements:[{sql,params}], set, removed, cleared, unchanged, cards }
 */
export function planOwnedSetBatch(items, catalogById, currentByKey, { pid, uuid, now }) {
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
    if (!Number.isSafeInteger(qty) || qty < 0 || qty > MAX_ITEM_QTY) throw new Error(`planOwnedSetBatch: qty ${JSON.stringify(qty)} out of range (0..${MAX_ITEM_QTY}) for ${cardId}`);

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

  // Pass 2: turn each unique target into a statement, OMITTING no-ops (unchanged rows).
  const statements = [];
  const cards = new Set();
  let set = 0, removed = 0, cleared = 0, unchanged = 0;
  for (const { card_id, slug, qty } of targets.values()) {
    cards.add(card_id);
    const existing = currentByKey.get(`${card_id}|${slug}`);
    const curOwned = existing ? (existing.qty_owned || 0) : 0;
    if (qty === 0) {
      if (!existing || curOwned === 0) { unchanged += 1; continue; }   // already empty - true no-op
      if ((existing.qty_wanted || 0) > 0) { statements.push({ sql: 'UPDATE owned_cards SET qty_owned=0, updated_at=? WHERE id=?;', params: [now, existing.id] }); cleared += 1; }
      else { statements.push({ sql: 'DELETE FROM owned_cards WHERE id=?;', params: [existing.id] }); removed += 1; }
    } else if (existing && curOwned === qty) {
      unchanged += 1;   // already at the requested value - true no-op
    } else if (existing) {
      statements.push({ sql: 'UPDATE owned_cards SET qty_owned=?, updated_at=? WHERE id=?;', params: [qty, now, existing.id] });
      set += 1;
    } else {
      statements.push({ sql: 'INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?);', params: [uuid(), pid, card_id, slug, qty, '', now, now] });
      set += 1;
    }
  }
  return { statements, set, removed, cleared, unchanged, cards: cards.size };
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
        const stmts = plan.map((p) => ([
          `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
           VALUES(?,?,?,?,?,0,'',?,?)
           ON CONFLICT(profile_id,card_id,variant_slug)
           DO UPDATE SET qty_owned=qty_owned+excluded.qty_owned, updated_at=excluded.updated_at;`,
          [uuid(), pid, p.card_id, p.slug, p.qty, now, now],
        ]));

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

  /**
   * Commit an absolute owned-SET batch (bulk edit / bulk delete). One transaction, ONE broadcast.
   * @returns { set, removed, cards } - printings set to a positive qty, rows removed, distinct cards.
   */
  async function setOwnedItemsBulk(items, pid = activeProfileId()) {
    if (!pid) throw bulkWriteError('prewrite', 'none', 'setOwnedItemsBulk: no active profile.');
    if (items != null && !Array.isArray(items)) throw bulkWriteError('prewrite', 'none', 'setOwnedItemsBulk: items must be an array.');
    const list = items || [];
    const empty = { set: 0, removed: 0, cleared: 0, unchanged: 0, cards: 0 };
    if (!list.length) return empty;
    if (list.length > MAX_BATCH_ITEMS) throw bulkWriteError('prewrite', 'none', `setOwnedItemsBulk: batch exceeds ${MAX_BATCH_ITEMS} items.`);

    let ranTransaction = false;
    try {
      const result = await exclusive(async () => {
        const catalog = await readCatalog(list.filter((i) => (i?.qty | 0) > 0).map((i) => i?.card_id));
        // Current owned rows (incl. qty_owned) for these cards, so a zero can delete-or-keep-want, a
        // set can update-or-insert, and a no-op (already at the value) writes nothing.
        const cardIds = [...new Set(list.map((i) => i?.card_id).filter(Boolean))];
        const currentByKey = new Map();
        for (let i = 0; i < cardIds.length; i += 400) {
          const chunk = cardIds.slice(i, i + 400);
          const rows = await query(`SELECT id, card_id, variant_slug, qty_owned, qty_wanted FROM owned_cards WHERE profile_id=? AND card_id IN (${chunk.map(() => '?').join(',')});`, [pid, ...chunk]);
          for (const r of rows) currentByKey.set(`${r.card_id}|${r.variant_slug}`, r);
        }
        const plan = planOwnedSetBatch(list, catalog, currentByKey, { pid, uuid, now: nowIso() });   // throws (prewrite) on an impossible positive OR a conflicting target
        const summary = { set: plan.set, removed: plan.removed, cleared: plan.cleared, unchanged: plan.unchanged, cards: plan.cards };
        if (!plan.statements.length) return { ...summary, noop: true };
        ranTransaction = true;
        await tx(plan.statements.map((s) => [s.sql, s.params]));
        return { ...summary, noop: false };
      });
      if (ranTransaction && !result.noop) notify();
      return { set: result.set, removed: result.removed, cleared: result.cleared, unchanged: result.unchanged, cards: result.cards };
    } catch (e) {
      if (ranTransaction) notify();
      if (e && e.name === 'BulkWriteError') throw e;
      throw ranTransaction
        ? bulkWriteError('transaction', 'unknown', e?.message || String(e))
        : bulkWriteError('prewrite', 'none', e?.message || String(e));
    }
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

  return { importCollectionResolved, setOwnedItemsBulk, createListWithEntries };
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
export const createListWithEntries = production.createListWithEntries;
