// The transactional bulk WANT command - Select-all Add and the paste-resolver commit route here.
//
// A batch of wants is a durable write, and it must not reopen the two defect classes v11 spent
// rounds closing:
//
//   1. LOST UPDATES. It runs inside `withExclusiveCollectionWrites` - the same barrier every bulk
//      command uses - so a queued absolute `setWantedForItem` cannot interleave with the batch
//      increment and clobber it. Bypassing the barrier on the atomic-increment argument was the
//      rev-3 design; Codex was right that it reopens the race, and this does not.
//
//   2. IMPOSSIBLE ITEMS BELOW THE UI. `assertRealSetCode` checks shape, not reality. This reads
//      the catalog INSIDE the holder and rejects the WHOLE batch before any SQL if any item names
//      a card that does not exist, a set the card is not printed in, a finish the printing does
//      not have, or an out-of-bounds quantity. "An impossible collector item cannot be written"
//      is therefore true below the UI, not merely above it.
//
// THE WRITE-OUTCOME CONTRACT. A web `tx()` commits sql.js and THEN awaits IndexedDB persistence,
// so a persist failure rejects AFTER the in-memory rows already changed. "Nothing was written"
// would be a lie, and a retry would double the wants. So a rejection carries where it failed:
//
//   { phase: 'prewrite' | 'transaction', writeState: 'none' | 'unknown' }
//
//   - prewrite/none: the barrier timed out or validation threw BEFORE `tx()` - nothing ran, so
//     "Nothing was added" is safe and no cache is invalidated.
//   - transaction/unknown: `tx()` was invoked and rejected - the write may have landed. The
//     command invalidates the cache regardless, and the caller must reconcile and say "couldn't
//     confirm", never "nothing written", and never auto-retry.
import { query as dbQuery, tx as dbTx } from './db.js';
import { activeProfileId as realActiveProfileId } from './profileRepository.js';
import { withExclusiveCollectionWrites } from './collectionWrites.js';
import { notifyOwnedChanged } from './ownedRepository.js';
import { canonicalPrinting } from './printings.js';
import { printingFinishes } from './printingRows.js';
import { uuid as newId, nowIso as newNow } from './ids.js';

// Codex's naming: 'prewrite' describes a validation/barrier failure more honestly than 'barrier',
// since a validation throw is also before any write. `writeState` is the safety-bearing field.
export function bulkWriteError(phase, writeState, message) {
  const e = new Error(message);
  e.name = 'BulkWriteError';
  e.phase = phase;
  e.writeState = writeState;
  return e;
}

/** Per-item quantity ceiling (§7.5 input bounds). A single line may not want more than this. */
export const MAX_ITEM_QTY = 999;
/** Per-batch item ceiling (§7.5). With MAX_ITEM_QTY this also makes merged totals safe by
 *  construction (2000 x 999 is far below Number.MAX_SAFE_INTEGER), so an overflow cannot arise. */
export const MAX_BATCH_ITEMS = 2000;

function setCodesOf(cardRow) {
  let raw = cardRow?.sets;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = []; } }
  return Array.isArray(raw) ? raw.map((s) => s?.code).filter(Boolean) : [];
}

/**
 * Validate and merge a want batch against the catalog. PURE - no database, no barrier.
 *
 * Rejects the whole batch (throws) on the first violation, naming the offending item, BEFORE any
 * caller builds SQL. Merges duplicates by `(cardId, canonical slug)` so a batch that lists the
 * same item twice writes one summed row.
 *
 * @param items       [{ cardId, set, foil, qty }]
 * @param catalogById Map<card_id, { sets, variants }> read authoritatively by the command
 * @returns [{ cardId, slug, qty }]
 */
export function planWantedItemBatch(items, catalogById) {
  if (!Array.isArray(items)) throw new Error('planWantedItemBatch: items must be an array');
  if (items.length > MAX_BATCH_ITEMS) throw new Error(`planWantedItemBatch: batch exceeds ${MAX_BATCH_ITEMS} items`);
  const merged = new Map();
  for (const it of items) {
    const cardId = it?.cardId;
    const set = it?.set;
    // A real boolean, not a coercion. `!!"false"` is true, which would file the wrong item; the
    // durable boundary must reject malformed input, not silently reinterpret it.
    if (typeof it?.foil !== 'boolean') {
      throw new Error(`planWantedItemBatch: foil must be a boolean for ${cardId}, got ${JSON.stringify(it?.foil)}`);
    }
    const foil = it.foil;
    const qty = it?.qty;

    if (!Number.isSafeInteger(qty) || qty <= 0 || qty > MAX_ITEM_QTY) {
      throw new Error(`planWantedItemBatch: qty ${JSON.stringify(qty)} out of range (1..${MAX_ITEM_QTY}) for ${cardId}`);
    }
    const card = catalogById.get(cardId);
    if (!card) throw new Error(`planWantedItemBatch: unknown card ${JSON.stringify(cardId)}`);
    if (!set || !setCodesOf(card).includes(set)) {
      throw new Error(`planWantedItemBatch: ${JSON.stringify(set)} is not a set of ${cardId}`);
    }
    const fin = printingFinishes(card, set);
    if (foil ? !fin.foil : !fin.nonFoil) {
      throw new Error(`planWantedItemBatch: ${foil ? 'foil' : 'non-foil'} is not a printing of ${cardId} in ${set}`);
    }

    const slug = canonicalPrinting(set, foil);
    const key = `${cardId}|${slug}`;
    const nextQty = (merged.get(key)?.qty || 0) + qty;
    if (!Number.isSafeInteger(nextQty)) throw new Error(`planWantedItemBatch: merged qty overflow for ${key}`);
    merged.set(key, { cardId, slug, qty: nextQty });
  }
  return [...merged.values()];
}

/** Build the command over injected primitives so the barrier tests run PRODUCTION code. */
export function createWantedBulkCommand({ exclusive, query, tx, notify, uuid = newId, nowIso = newNow, activeProfileId = realActiveProfileId }) {
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
   * Add a batch of wants. `pid` is captured by the CALLER at the gesture, before any await.
   * @returns { items, copies } on success; throws a BulkWriteError otherwise.
   */
  async function addWantedItemsBulk(items, pid = activeProfileId()) {
    if (!pid) throw bulkWriteError('prewrite', 'none', 'addWantedItemsBulk: no active profile.');
    if (items != null && !Array.isArray(items)) throw bulkWriteError('prewrite', 'none', 'addWantedItemsBulk: items must be an array.');
    const list = items || [];
    if (!list.length) return { items: 0, copies: 0 };
    // Reject an oversized batch BEFORE taking the barrier - a bounds failure need not cost a holder.
    if (list.length > MAX_BATCH_ITEMS) throw bulkWriteError('prewrite', 'none', `addWantedItemsBulk: batch exceeds ${MAX_BATCH_ITEMS} items.`);

    let ranTransaction = false;
    try {
      const result = await exclusive(async () => {
        // Authoritative catalog read INSIDE the holder: validation and the write see one world.
        const catalog = await readCatalog(list.map((i) => i?.cardId));
        const plan = planWantedItemBatch(list, catalog);   // throws (prewrite) on any impossible item
        if (!plan.length) return { items: 0, copies: 0, noop: true };

        const now = nowIso();
        const stmts = plan.map((p) => ([
          `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
           VALUES(?,?,?,?,0,?,'',?,?)
           ON CONFLICT(profile_id,card_id,variant_slug)
           DO UPDATE SET qty_wanted=qty_wanted+excluded.qty_wanted, updated_at=excluded.updated_at;`,
          [uuid(), pid, p.cardId, p.slug, p.qty, now, now],
        ]));

        ranTransaction = true;   // from here the database may differ, confirmed or not
        await tx(stmts);         // resolving means committed AND persisted; rejecting is indeterminate
        return { items: plan.length, copies: plan.reduce((s, p) => s + p.qty, 0) };
      });
      if (ranTransaction && !result.noop) notify();
      return result.noop ? { items: 0, copies: 0 } : result;
    } catch (e) {
      if (ranTransaction) notify();   // memory may have changed even on a rejected tx - invalidate
      if (e && e.name === 'BulkWriteError') throw e;   // already classified
      throw ranTransaction
        ? bulkWriteError('transaction', 'unknown', e?.message || String(e))
        : bulkWriteError('prewrite', 'none', e?.message || String(e));
    }
  }

  return { addWantedItemsBulk };
}

/** Production instance, wired to the REAL barrier. */
const production = createWantedBulkCommand({
  exclusive: withExclusiveCollectionWrites,
  query: dbQuery,
  tx: dbTx,
  notify: notifyOwnedChanged,
});

export const addWantedItemsBulk = production.addWantedItemsBulk;
