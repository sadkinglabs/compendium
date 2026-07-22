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

    // An empty setCode is the uncategorised owned bucket - valid, no set or finish check (the
    // owned grain may legitimately be uncategorised). A nonempty setCode must be a real set of
    // THIS card AND carry the requested finish (printingFinishes is strict - it throws on
    // malformed catalog variants rather than authorising a phantom item).
    if (setCode) {
      if (!setCodesOf(card).includes(setCode)) {
        throw new Error(`planOwnedItemBatch: ${JSON.stringify(setCode)} is not a set of ${cardId}`);
      }
      const fin = printingFinishes(card, setCode);
      if (foil ? !fin.foil : !fin.nonFoil) {
        throw new Error(`planOwnedItemBatch: ${foil ? 'foil' : 'non-foil'} is not a printing of ${cardId} in ${setCode}`);
      }
    }

    const slug = canonicalPrinting(setCode || '', foil);
    const key = `${cardId}|${slug}`;
    const nextQty = (merged.get(key)?.qty || 0) + qty;
    if (!Number.isSafeInteger(nextQty)) throw new Error(`planOwnedItemBatch: merged qty overflow for ${key}`);
    merged.set(key, { card_id: cardId, slug, qty: nextQty });
  }
  return [...merged.values()];
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
   * @returns { names, copies } on success; throws a BulkWriteError otherwise.
   */
  async function importCollectionResolved(items, pid = activeProfileId()) {
    if (!pid) throw bulkWriteError('prewrite', 'none', 'importCollectionResolved: no active profile.');
    if (items != null && !Array.isArray(items)) throw bulkWriteError('prewrite', 'none', 'importCollectionResolved: items must be an array.');
    const list = items || [];
    if (!list.length) return { names: 0, copies: 0 };
    if (list.length > MAX_BATCH_ITEMS) throw bulkWriteError('prewrite', 'none', `importCollectionResolved: batch exceeds ${MAX_BATCH_ITEMS} items.`);

    let ranTransaction = false;
    try {
      const result = await exclusive(async () => {
        const catalog = await readCatalog(list.map((i) => i?.card_id));
        const plan = planOwnedItemBatch(list, catalog);   // throws (prewrite) on any impossible item
        if (!plan.length) return { names: 0, copies: 0, noop: true };

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
        return { names: plan.length, copies: plan.reduce((s, p) => s + p.qty, 0) };
      });
      if (ranTransaction && !result.noop) notify();
      return result.noop ? { names: 0, copies: 0 } : result;
    } catch (e) {
      if (ranTransaction) notify();   // memory may have changed even on a rejected tx - invalidate
      if (e && e.name === 'BulkWriteError') throw e;   // already classified
      throw ranTransaction
        ? bulkWriteError('transaction', 'unknown', e?.message || String(e))
        : bulkWriteError('prewrite', 'none', e?.message || String(e));
    }
  }

  return { importCollectionResolved };
}

/** Production instance, wired to the REAL barrier. */
const production = createOwnedImportCommand({
  exclusive: withExclusiveCollectionWrites,
  query: dbQuery,
  tx: dbTx,
  notify: notifyOwnedChanged,
});

export const importCollectionResolved = production.importCollectionResolved;
