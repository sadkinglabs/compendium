// The replacement plan - the ONE ordered statement list that makes "Restore backup" mean REPLACE.
// Increment 4 of docs/proposals/restore-semantics.md (Rev 4, owner-approved), §2-§3 and §8.
//
// PURE, like planProfileUnit: no query, no transaction, no id taken from the database. The caller
// (backupService.replaceAll) captures the current state inside the exclusive session and hands the
// pieces in, so everything destructive is decided here in memory and committed there in one tx().
//
// Two properties this module exists to hold:
//
//   EVERYTHING COMMITS TOGETHER. Deletes, re-keyed inserts, the Primary flag and the journal row
//   are one list for one tx(). A crash at any point either leaves the device untouched or leaves
//   it fully replaced WITH the journal row present - no third state exists for startup to misread.
//
//   THE JOURNAL ROW IS IN THE LIST, LAST. `restore_pending` committing separately - before or
//   after - would let a crash between the two commits tell startup "the database was untouched"
//   about a replacement that already happened, and startup would then abandon (delete) the only
//   recovery point for it. Inside the list, marker and data are one fact.
//
// Deletion is targeted by §8's ownership table, never by "everything that looks app-global" -
// and since Increment 6 that table is CODE: the delete phase is derived from the persisted-state
// registry (persistedState.js), so nothing can be deleted here without a registered `replace` or
// `re-key` disposition saying so. `catalog_meta.version`, catalog rows, the recovery pointer and
// everything unregistered are PRESERVED by never being named.
import { planProfileUnit } from './profileTransfer.js';
import { prepareBundle } from './importBoundary.js';
import { replacementDeletes } from './persistedState.js';
import { uuid } from './ids.js';

/** The catalog_meta journal key. Present = the replacement committed; absent = it did not.
 *  Written inside the replacement transaction, cleared once the pointer is published. */
export const RESTORE_PENDING_KEY = 'restore_pending';

/**
 * Plan the whole replacement for a validated whole-app envelope.
 *
 * @param env          an envelope `parseBackup`/`readBackup` accepted (validated, digest-checked)
 * @param candidateId  the VERIFIED recovery candidate's immutable id - the journal must name it
 * @param profileIds   the profile ids captured from the state being replaced, for `dash_seeded:`
 *                     re-keying (their rows die with `DELETE FROM profiles`, their keys die here)
 * @param setsOf       (card_id) => set codes, read from the catalog by the caller
 *
 * Returns `{ statements, profiles, intendedActiveId, intendedPrimaryId }`.
 *
 * `uniqueProfileName` is deliberately NOT applied: the deletes at the head of this same list mean
 * there is nothing left to collide with, and §7 requires two archived profiles sharing a name to
 * come back sharing it - "Alpha (imported)" after a restore would be the merge semantics this
 * whole programme replaces.
 */
export function planReplace(env, { candidateId, profileIds = [], setsOf = () => [] } = {}) {
  if (typeof candidateId !== 'string' || !candidateId) {
    throw new Error('planReplace: a verified recovery candidate id is required - the journal row must name it.');
  }
  const units = env?.payload?.profiles;
  if (!Array.isArray(units) || units.length === 0) {
    throw new Error('planReplace: only a whole-app archive can replace the whole app.');
  }

  const statements = [];

  // DELETES FIRST, derived from the registry rather than spelled here: `DELETE FROM profiles`
  // takes every profile-owned row through ON DELETE CASCADE (asserted table-by-table in
  // replaceAll.test.mjs, not trusted), and the captured profiles' dash_seeded keys - device-side
  // storage the cascade cannot reach - are dropped by name, only for the pids this plan is
  // deleting. Anything the registry does not mark destructive cannot appear in this phase.
  statements.push(...replacementDeletes(profileIds));

  const created = [];
  for (const unit of units) {
    // The same boundary every import trusts: validate, then normalise v10 -> v11, in memory.
    const { bundle } = prepareBundle(
      { app: 'compendium', schemaVersion: env.schemaVersion, ...unit }, setsOf);

    const name = bundle.profile?.name || 'Profile';
    let avatar = null;
    try { avatar = bundle.profile?.avatar ? JSON.parse(bundle.profile.avatar) : null; } catch { avatar = null; }

    const plan = planProfileUnit(bundle, {
      pid: uuid(), name, avatar,
      // Carried explicitly by a v2 unit, so a faithfully restored dashboard - including a
      // deliberately empty one - is not repopulated with starter widgets. (This is also the
      // "write keys for restored pids" half of the dash_seeded re-key.)
      dashSeeded: unit.dashSeeded,
    });
    statements.push(...plan.statements);
    created.push({ pid: plan.pid, name, wasDefault: unit.profile?.is_default === 1 });
  }

  // Primary from the archive. Every insert above wrote is_default=0 and the table was emptied
  // first, so a single set suffices - and it is inside the same transaction, so no committed
  // state ever has zero Primaries. parseBackup guarantees exactly one candidate; the fallback
  // only guards a caller that skipped the gate.
  const primary = created.find((c) => c.wasDefault) ?? created[0];
  statements.push(['UPDATE profiles SET is_default=1 WHERE id=?;', [primary.pid]]);

  // The archive's active profile may differ from its Primary - both are re-expressed against the
  // re-keyed ids so the journal (and the caller's reconciliation) name profiles that exist.
  const idx = env.payload.appGlobal?.activeProfileIndex;
  const intendedActiveId = (idx != null && created[idx]) ? created[idx].pid : primary.pid;

  // THE JOURNAL ROW, LAST, IN THE SAME LIST. See the header for why it can live nowhere else.
  statements.push(['INSERT OR REPLACE INTO catalog_meta(key,value) VALUES(?,?);',
    [RESTORE_PENDING_KEY, JSON.stringify({
      candidateId, intendedActiveId, intendedPrimaryId: primary.pid,
    })]]);

  return { statements, profiles: created, intendedActiveId, intendedPrimaryId: primary.pid };
}
