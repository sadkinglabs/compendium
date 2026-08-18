// Filing a triage line - the last new backend primitive for v11.
//
// Moving a quantity out of the uncategorised pile and onto a real collector item is a MOVE, and
// a move is the operation most likely to duplicate or lose the thing it moves. So it follows
// the same protocol the bulk ownership commands use, for the same reasons:
//
//   capture profile -> exclusive admission -> authoritative read -> plan
//     -> one transaction -> authoritative read-back -> confirmed result
//     -> release -> one broadcast
//
// THE RESULT CONTRACT, identical to bulkOwnedRepository so callers do not learn two:
//   - confirmed: true    `moved` is authoritative, from the read-back.
//   - confirmed: false   the transaction resolved but we could not verify the outcome.
//                        `moved` is NULL and NO other quantity is exposed - not zero, not the
//                        plan's intent, and not an "attempted" count a caller could mistake for
//                        a result. Quantities are structurally absent, not merely discouraged.
//   - throws             the barrier was not achieved or the transaction failed. Nothing was
//                        written; the pile is exactly as it was.
//
// WHY IT RE-VALIDATES WHAT triage.js ALREADY CHECKED. The plan arrives from the UI, and UI
// state goes stale: a pile rendered before a scan, a destination chosen from a card that has
// since been swiped away. The pure module validates the plan it was given; this validates the
// plan against the DATABASE, under the barrier, at the moment of writing. Trusting the caller
// would make every one of those pure checks advisory.
//
// WHY ONLY ONE FIELD MOVES. A triage line is either owned copies or a want - never both, per
// the ruling that they resolve independently. The other field on the same row must survive
// untouched, which is why the drawdown names its column explicitly and the destination merge
// adds to one column only.
import { query as dbQuery, tx as dbTx } from './db.js';
import { activeProfileId as realActiveProfileId } from './profileRepository.js';
import { withExclusiveCollectionWrites } from './collectionWrites.js';
import { notifyOwnedChanged } from './ownedRepository.js';
import {
  canonicalPrinting, isRealSetCode,
  LEGACY_UNCATEGORISED, LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL,
} from './printings.js';
import { UNCATEGORISED_KEYS } from './triage.js';
import { assertEqualityStatements } from './storageRepository.js';
import { uuid, nowIso } from './ids.js';

const FIELDS = { owned: 'qty_owned', wanted: 'qty_wanted' };

export function createTriageCommands({ exclusive, query, tx, notify, activeProfileId }) {
  /**
   * File one triage line onto a real set.
   *
   * @param plan from `fileLinePlan` - { card_id, qty, field, fromSlugs, to: { set, foil } }
   */
  async function fileTriageLine(plan) {
    // Validated BEFORE the barrier: a malformed plan should not consume an exclusive holder,
    // and these checks need nothing from the database.
    const field = FIELDS[plan?.field];
    if (!field) throw new Error(`fileTriageLine: unknown field ${JSON.stringify(plan?.field)}.`);
    if (!plan.card_id) throw new Error('fileTriageLine: no card.');
    if (!isRealSetCode(plan?.to?.set)) throw new Error(`fileTriageLine: ${JSON.stringify(plan?.to?.set)} is not a set code.`);
    // FINISH IS NOT NEGOTIABLE, and the plan does not get a vote on it.
    //
    // `to.foil` must be a real boolean: `!!` would coerce the string "false" to true and quietly
    // turn a non-foil destination foil.
    if (typeof plan?.to?.foil !== 'boolean') {
      throw new Error(`fileTriageLine: to.foil must be a boolean, got ${JSON.stringify(plan?.to?.foil)}.`);
    }
    const foil = plan.to.foil;
    // A want is always non-foil (§7.4). Migration never creates a foil want and no writer may,
    // so a plan asking to file one is refused rather than honoured.
    if (field === 'qty_wanted' && foil) {
      throw new Error('fileTriageLine: wants are non-foil; a foil want cannot be filed.');
    }

    // SOURCES ARE DERIVED, not taken from the plan.
    //
    // `fromSlugs` is UI provenance and may be stale or forged. If it decided what gets drained,
    // a plan could move foil ownership into a non-foil row - copies silently changing finish -
    // or omit a source that appeared after the render, stranding those copies in the pile.
    //
    // Ownership drains only the keys of ITS OWN finish. A want drains all four, because the
    // §7.4 ruling means a legacy want can have survived on any of them while still being
    // non-foil.
    const sources = field === 'qty_wanted'
      ? [...UNCATEGORISED_KEYS]
      : (foil ? [LEGACY_FOIL, UNCATEGORISED_FOIL] : [LEGACY_UNCATEGORISED, UNCATEGORISED]);

    // The plan's provenance is still checked, but only as a sanity assertion: it may not name
    // anything outside the pile, and it may not claim a source this operation would not drain.
    for (const slug of new Set(plan.fromSlugs || [])) {
      if (!UNCATEGORISED_KEYS.includes(slug)) {
        throw new Error(`fileTriageLine: may only drain uncategorised rows, not ${slug}.`);
      }
      if (!sources.includes(slug)) {
        throw new Error(`fileTriageLine: ${slug} does not belong to a ${foil ? 'foil' : 'non-foil'} ${plan.field} line.`);
      }
    }

    // CAPTURED, not read again later. A profile switch mid-operation must not redirect the
    // write: every statement below is scoped to the id we started with.
    const pid = activeProfileId();
    if (!pid) throw new Error('fileTriageLine: no active profile.');

    const dest = canonicalPrinting(plan.to.set, foil);

    return exclusive(async () => {
      // AUTHORITATIVE READ, inside the barrier. The quantity in the plan came from a render and
      // may be stale - the user could have scanned another copy since. Moving the planned
      // amount rather than the amount that is actually there is how a move invents copies.
      // MEMBERSHIP, proven against the catalog rather than taken from the plan.
      //
      // The shape check above rejects storage keys and malformed values, but '999' is a
      // perfectly well-shaped set code that a given card may simply never have been printed in.
      // The pure layer proved membership against the sets it was handed at render time; this
      // proves it against the catalog now. Filing onto a set the card does not belong to would
      // create a collector item that no reader can bucket and no later triage can find.
      const cardSets = await query('SELECT sets FROM cards WHERE card_id=?;', [plan.card_id]);
      let known = [];
      try {
        const parsed = JSON.parse(cardSets[0]?.sets || '[]');
        known = Array.isArray(parsed) ? parsed.map((x) => x?.code).filter(Boolean) : [];
      } catch { known = []; }
      // A card the catalog does not know has NO valid destination. Refusing is right: the pile
      // shows such cards as unresolvable precisely because there is nothing to file them to.
      if (!known.includes(plan.to.set)) {
        throw new Error(`fileTriageLine: ${plan.card_id} is not printed in set ${plan.to.set}.`);
      }

      const before = await query(
        `SELECT id, variant_slug, qty_owned, qty_wanted FROM owned_cards
          WHERE profile_id=? AND card_id=? AND variant_slug IN (${[...sources, dest].map(() => '?').join(',')});`,
        [pid, plan.card_id, ...sources, dest],
      );
      const at = (slug) => before.find((r) => r.variant_slug === slug);
      const moving = sources.reduce((n, slug) => n + (at(slug)?.[field] || 0), 0);

      // Nothing to move is a no-op, NOT a failure and NOT a broadcast. The row may have been
      // filed by another surface already; saying so honestly beats inventing a change.
      if (moving <= 0) return { confirmed: true, moved: 0, noop: true };

      const now = nowIso();
      const statements = [];

      // FILING IS A KEY MOVE, so the allocations FOLLOW THE COPIES - they are not removed from
      // one place and invented in another. Triage does not change what the user owns or where it
      // physically sits; it establishes which printing those copies are. A copy that was in a
      // binder before triage is in that same binder after it.
      //
      // Only the SOURCE places are read here. The DESTINATION row is resolved in SQL at execution
      // time, never guessed: an id invented for a row that does not exist yet is wrong the moment
      // anything else creates that row first, and the re-parent would then reference a row that
      // was never inserted.
      const srcIds = sources.map((slug) => at(slug)?.id).filter(Boolean);
      const srcAllocs = field === 'qty_owned' && srcIds.length
        ? await query(`SELECT id, profile_id, container_id, qty FROM storage_allocations WHERE owned_card_id IN (${srcIds.map(() => '?').join(',')});`, srcIds)
        : [];

      // DRAW DOWN one column only. The other field on the same row is untouched, because owned
      // and wanted resolve independently - filing copies must not silently discard a want that
      // shares the row.
      for (const slug of sources) {
        const row = at(slug);
        if (!row || !(row[field] > 0)) continue;
        statements.push([
          `UPDATE owned_cards SET ${field}=0, updated_at=? WHERE profile_id=? AND card_id=? AND variant_slug=?;`,
          [now, pid, plan.card_id, slug],
        ]);
      }

      // MERGE at the destination, adding rather than replacing: the user may already own copies
      // of this exact collector item, and filing must not overwrite them.
      statements.push([
        `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
         VALUES(?,?,?,?,?,?,'',?,?)
         ON CONFLICT(profile_id,card_id,variant_slug)
         DO UPDATE SET ${field}=${field}+excluded.${field}, updated_at=excluded.updated_at;`,
        [uuid(), pid, plan.card_id, dest,
          field === 'qty_owned' ? moving : 0,
          field === 'qty_wanted' ? moving : 0,
          now, now],
      ]);

      // RE-PARENT, after the destination row exists and before the sources are deleted - the
      // window in which both ends of the move are present. Merging where two source places share
      // a container with each other or with the destination is the ON CONFLICT clause; one
      // statement per source allocation rather than an INSERT ... SELECT because each needs its
      // own primary key, and a SELECT yielding two rows would collide on one generated id.
      for (const a of srcAllocs) {
        statements.push([
          `INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at)
           SELECT ?, a.profile_id, a.container_id, d.id, a.qty, ?, ?
             FROM storage_allocations a
             JOIN owned_cards d ON d.profile_id=? AND d.card_id=? AND d.variant_slug=?
            WHERE a.id=?
           ON CONFLICT(container_id,owned_card_id) DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at;`,
          [uuid(), now, now, pid, plan.card_id, dest, a.id],
        ]);
        statements.push(['DELETE FROM storage_allocations WHERE id=?;', [a.id]]);
      }

      // ACCEPTED ALPHA DEBT, owner ruling: a note on a fully drained source row is LOST.
      //
      // The v11 proposal's merge policy says distinct non-empty notes should be carried to the
      // destination and the earliest created_at preserved. Filing does neither: the destination
      // is inserted with notes='' and an emptied source is deleted underneath it. A note on a
      // row that survives (because its other quantity remains) is unaffected.
      //
      // Recorded rather than silently skipped so it is a decision with an owner, not a defect
      // nobody noticed. Closing it means reading notes/created_at in the authoritative read
      // above and merging them into the upsert - a contained change, deliberately deferred.
      // Delete ONLY rows this operation emptied, and only when BOTH quantities are zero. A
      // source row still holding the other field must survive; that asymmetry is the whole
      // reason the empty-string row was unsafe to drop in the first place.
      for (const slug of sources) {
        statements.push([
          'DELETE FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=? AND qty_owned=0 AND qty_wanted=0;',
          [pid, plan.card_id, slug],
        ]);
      }

      // The equality for both ends of the move, inside the transaction. Filing conserves copies,
      // so if either side comes out disagreeing with its places, nothing commits.
      statements.push(...assertEqualityStatements(pid, [...sources, dest].map((slug) => ({ cardId: plan.card_id, variantSlug: slug })), 'fileTriageLine'));

      await tx(statements);

      // AUTHORITATIVE READ-BACK. Conservation is checked against what the database actually
      // holds now, not against what we intended - the difference between the two is exactly
      // what a confirmation is for.
      let confirmed = false;
      let moved = null;
      try {
        const after = await query(
          `SELECT variant_slug, qty_owned, qty_wanted FROM owned_cards
            WHERE profile_id=? AND card_id=? AND variant_slug IN (${[...sources, dest].map(() => '?').join(',')});`,
          [pid, plan.card_id, ...sources, dest],
        );
        const sumBefore = before.reduce((n, r) => n + (r[field] || 0), 0);
        const sumAfter = after.reduce((n, r) => n + (r[field] || 0), 0);
        const destAfter = after.find((r) => r.variant_slug === dest)?.[field] || 0;
        const sourcesDrained = sources.every((s) => !(after.find((r) => r.variant_slug === s)?.[field] > 0));
        const destBefore = at(dest)?.[field] || 0;

        // Three independent facts, all of which must hold: the total is conserved, the sources
        // are empty, and the destination grew by exactly the amount that left them.
        confirmed = sumAfter === sumBefore && sourcesDrained && destAfter === destBefore + moving;
        if (confirmed) moved = moving;
      } catch {
        confirmed = false;   // a failed read-back is an unconfirmed result, never a failed write
      }

      // No quantity is exposed when unconfirmed. `attempted` was a hedge - a number the caller
      // could mistake for a result - and the established boundary is that an unverified outcome
      // reports nothing numeric at all.
      return confirmed ? { confirmed, moved } : { confirmed, moved: null };
    }).then((result) => {
      // ONE broadcast, and only when a transaction actually ran. It is a cache invalidation
      // rather than a success announcement, so it fires for the unconfirmed case too: persisted
      // state may well have changed, and stale UI is worse than a redundant refresh.
      if (!result.noop) notify();
      return result;
    });
  }

  return { fileTriageLine };
}

const production = createTriageCommands({
  exclusive: withExclusiveCollectionWrites,
  query: dbQuery,
  tx: dbTx,
  notify: notifyOwnedChanged,
  activeProfileId: realActiveProfileId,
});

export const fileTriageLine = production.fileTriageLine;
