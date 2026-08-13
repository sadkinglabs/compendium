// Whole-app backup and restore: the ORCHESTRATION. Everything here touches the database, the
// filesystem or preferences, which is exactly why it is not in `backup.js` - that module is pure and
// its tests depend on staying that way.
//
// See docs/proposals/backup-and-restore.md (Revision 4, owner-approved).
//
// The two properties this file exists to hold:
//   BACKUP is a CONSISTENT snapshot. Every read happens inside `db.snapshot()`, which holds an
//   exclusive write gate, so no write can land between two table reads and none can be enrolled into
//   the snapshot's transaction (Codex Blocker 1).
//   RESTORE is ONE transaction. Every profile's statements are planned purely and concatenated, so
//   the whole restore commits or none of it does - including across process death (Codex Blocker 2).
//   Stage 0 measured this: the owner's real profile plans to ~1,479 statements / 0.38 MiB.
import { Preferences } from '@capacitor/preferences';
import { snapshot, query, tx, acquireExclusiveSession } from './db.js';
import { SCHEMA_VERSION } from './schema.js';
import { listProfiles, activeProfileId, switchProfile } from './profileRepository.js';
import { buildProfileUnit, importProfile } from './profileTransfer.js';
import { buildEnvelope, seal, parseBackup, readBackup, summarise } from './backup.js';
import { ITERATED_COLLECTIONS } from './importBoundary.js';
import { writeCandidate, verifyCandidate, promote } from './recoveryStore.js';
import { replacementPolicy, assertBoundArchiveMatches, ReplaceRefused } from './replacementPolicy.js';
import { planReplace, RESTORE_PENDING_KEY } from './replacePlan.js';
import { nowIso } from './ids.js';
import { saveTextFile } from '../native.js';

// No ACTIVE_KEY here on purpose. This module used to keep its own copy of profileRepository's
// 'activeProfileId' Preferences key and write it directly - a second authority over which profile is
// active, which is exactly how restore ended up disagreeing with the repository. The key belongs to
// profileRepository; this module goes through switchProfile().
const SEEN_BUILD_KEY = 'changelogSeenBuild';

// vite defines __APP_BUILD__; `node --test` does not, and this module is unit-tested.
const currentBuild = () => (typeof __APP_BUILD__ === 'undefined' ? null : Number(__APP_BUILD__));

/** compendium-backup-20260810-143005.json */
function backupFilename(at = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `compendium-backup-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.json`;
}

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

/**
 * Build, seal and verify the whole-app archive, then hand it to the platform.
 *
 * Returns `{ status, filename, profiles, rows }` where status is 'prepared' on the device path.
 * It is NOT called 'stored', and that is deliberate: `saveTextFile` writes to a cache directory and
 * opens the share sheet, and it CANNOT observe whether the user chose a durable destination or
 * dismissed the sheet (native.js:65-79 swallows dismissal). Reporting "backed up" here would be a
 * false safety signal on the one feature whose entire purpose is safety.
 */
export async function backupAll({ appBuild = currentBuild(), now = new Date() } = {}) {
  // Preferences are not the database, so they are read outside the snapshot.
  const seen = (await Preferences.get({ key: SEEN_BUILD_KEY })).value;

  const { units, activeProfileIndex } = await snapshot(async () => {
    const profiles = await listProfiles();
    const built = [];
    for (const p of profiles) built.push(await buildProfileUnit(p.id));
    let active = null;
    try { active = activeProfileId(); } catch { active = null; }   // pre-init: not an error here
    const idx = profiles.findIndex((p) => p.id === active);
    return { units: built, activeProfileIndex: idx >= 0 ? idx : null };
  });

  const envelope = buildEnvelope({
    schemaVersion: SCHEMA_VERSION,
    appBuild,
    exportedAt: now.toISOString(),
    appGlobal: { activeProfileIndex, changelogSeenBuild: seen == null ? null : Number(seen) },
    profiles: units,
  });

  const file = await seal(envelope);
  const text = JSON.stringify(file);

  // Read it back through the SAME path a restore would use, before handing it to the user. A file
  // that cannot be re-read is reported as a failure rather than delivered as a backup.
  const verified = await parseBackup(text);

  const filename = backupFilename(now);
  const outcome = await saveTextFile(filename, text, 'application/json');
  if (outcome === 'failed') {
    throw new Error('The backup could not be written to this device.');
  }

  const rows = summarise(verified).reduce((a, s) => a + s.rows, 0);
  return { status: 'prepared', filename, profiles: units.length, rows, bytes: text.length };
}

/* ------------------------------------------------------------------ */
/* Restore                                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Which operation is this file, and which is it NOT                   */
/* ------------------------------------------------------------------ */

/** The two operations a backup file can name. A file is one or the other, never both. */
export const REPLACE_ALL = 'replace-all';
export const IMPORT_PROFILE = 'import-profile';

/**
 * Classify a file into the operation it authorises, in ONE place.
 *
 * The knowledge used to be spread: `previewBackup` branched on shape, `restoreAll` branched again,
 * and `replaceAll` re-derived the same distinction to refuse. Three readings of one question is how
 * a caller ends up routing a single-profile export into a whole-app replacement - and that is the
 * one mistake this operation must never make, because a single-profile file is not authority to
 * delete everything else on the device.
 *
 * Callers should switch on `operation` and hand the SAME preview to the matching executor.
 */
export async function classifyBackup(text) {
  const preview = await previewBackup(text);
  return {
    ...preview,
    operation: preview.kind === 'whole-app' ? REPLACE_ALL : IMPORT_PROFILE,
    destructive: preview.kind === 'whole-app',
  };
}

/**
 * Parse and fully validate a backup, returning what a restore WOULD do. Writes nothing.
 * The UI shows this and waits for confirmation before an executor is called.
 */
export async function previewBackup(text) {
  const read = await readBackup(text);

  // A legacy single-profile export. Every file written before this feature is one of these, so this
  // is not a rare path - it is the common one until whole-app backups have been around a while.
  if (read.kind === 'profile') {
    const b = read.bundle;
    const rows = ITERATED_COLLECTIONS.reduce((a, k) => a + (b[k]?.length ?? 0), 0);
    return {
      kind: 'profile',
      bundle: b,
      exportedAt: b.exportedAt ?? null,
      appBuild: null,
      profiles: [{
        name: b.profile?.name ?? 'Profile',
        isDefault: false,
        decks: b.decks?.length ?? 0,
        ownedCards: b.owned_cards?.length ?? 0,
        matches: b.matches?.length ?? 0,
        rows,
      }],
    };
  }

  const env = read.env;
  return { kind: 'whole-app', env, profiles: summarise(env), exportedAt: env.exportedAt, appBuild: env.appBuild };
}

/** card_id -> set codes, read once for the whole restore rather than per profile. */
async function catalogSets() {
  const setsById = new Map();
  for (const c of await query('SELECT card_id, sets FROM cards;')) {
    try {
      const parsed = JSON.parse(c.sets || '[]');
      setsById.set(c.card_id, Array.isArray(parsed) ? parsed.map((x) => x?.code).filter(Boolean) : []);
    } catch { setsById.set(c.card_id, []); }
  }
  return (cardId) => setsById.get(cardId) || [];
}

/**
 * Restore every profile in the archive, additively, in ONE transaction.
 *
 * Nothing is deleted. The archive's default profile becomes the device's default, which leaves any
 * pre-existing starter profile non-default and therefore deletable by the user if they want
 * (profileRepository.js:111-112). Revision 3 tried to delete that starter automatically; the
 * condition was unreachable and relaxing it would have deleted on a guess, so the design has no
 * profile-deletion path at all.
 *
 * Accepts what `previewBackup` returned. A LEGACY single-profile file is routed to the existing
 * `importProfile` path unchanged - it is one profile, it has its own hardened import, and re-planning
 * it here would be a second implementation of something that already works.
 *
 * A bare envelope is still accepted so callers (and tests) can pass `env` directly.
 */
export async function restoreAll(preview) {
  if (preview?.kind === 'profile') {
    const pid = await importProfile(preview.bundle);
    // OPEN IT. This used to return `activeProfileId: pid` without switching, so the field named a
    // profile that was not active - the caller was told where the data went and the app kept
    // showing somewhere else. Same family as the restore authority split: reporting an id is not
    // the same as making it true. planProfileUnit always writes is_default 0, so opening an
    // imported profile cannot take the Primary role from whoever holds it.
    let activeReconciled = false;
    try { await switchProfile(pid); activeReconciled = true; }
    catch { /* the rows are committed; the user can switch by hand */ }
    return { profiles: 1, activeProfileId: pid, activeReconciled, statements: null, via: 'profile-import' };
  }

  // A WHOLE-APP ARCHIVE IS REFUSED HERE, at the boundary, not merely routed away from by the caller.
  // This function is the ADDITIVE executor, and additive is no longer what a whole-app backup means:
  // it authorises replacement. Leaving the boundary permissive meant one dropped or renamed
  // `operation` field in App.jsx could silently reinstate the superseded behaviour - two of
  // everything - with every routing test still green, because the tests checked classification while
  // the executor accepted either.
  //
  // The classifier decides which operation a file authorises; this makes the executor refuse to be
  // the wrong one.
  // A whole-app envelope reaches the end of this function and no further: the additive whole-app
  // implementation that used to live below has been DELETED, not merely guarded. Leaving unreachable
  // destructive-adjacent code behind would make it ambiguous which behaviour is authoritative, and
  // the retired tests that described it are documented in backupService.test.mjs.
  throw new ReplaceRefused('whole-app-archive',
    'That is a whole-app backup, which replaces all data. Restore it with Replace all data, not Import.');
}

/* ------------------------------------------------------------------ */
/* Replace - restore-semantics.md §2, the destructive path              */
/* ------------------------------------------------------------------ */

/**
 * Replace EVERYTHING profile-owned with the archive. The first destructive operation in the app,
 * built to be abortable before it is anything else: every failure before the one commit leaves
 * the device byte-identical, and past the commit the operation is finishable, never abandoned.
 *
 * The sequence is the proposal's §2, inside one exclusive session:
 *   acquire (close admission, drain) -> capture via session.readTransaction -> write + verify the
 *   recovery candidate -> [bind check when durability is refused] -> ONE tx (deletes + inserts +
 *   Primary + journal row) -> reconcile active via switchProfile() -> publish the recovery
 *   pointer, clear the journal -> release.
 *
 * POLICY IS ENFORCED HERE, not merely available: replacementPolicy() runs before the session is
 * even claimed, and when it refuses, the ONLY way forward is a bound external archive checked
 * against the CAPTURED envelope after drain (assertBoundArchiveMatches) - a stale file aborts
 * with nothing destroyed. The policy module cannot enforce its own use; this call site is where
 * "impossible without it" is made true.
 *
 * Accepts what `previewBackup` returned (or a bare envelope). A legacy single-profile file is
 * REFUSED: it is never authority to delete the whole app (§9) - route it through restoreAll's
 * import path instead.
 */
export async function replaceAll(preview, { binding = null } = {}) {
  if (preview?.kind === 'profile') {
    throw new ReplaceRefused('single-profile',
      'That file is a single-profile export, so it cannot replace all data. Import it as a profile instead.');
  }
  const env = preview?.env ?? preview;
  if (!Array.isArray(env?.payload?.profiles)) {
    throw new ReplaceRefused('single-profile', 'Only a whole-app backup can replace all data.');
  }

  // The gate, before anything is claimed or written. Refusal here costs nothing.
  const policy = await replacementPolicy();
  if (!policy.allowed && !binding) {
    throw new ReplaceRefused(policy.code, policy.reason);
  }

  const session = await acquireExclusiveSession();
  try {
    // A PENDING JOURNAL ROW BLOCKS A SECOND REPLACEMENT, and this is a data-loss guard rather than
    // tidiness. A row still here means a previous replacement COMMITTED but never finished
    // publishing its recovery pointer. planReplace writes the journal with INSERT OR REPLACE, so
    // proceeding would overwrite the row naming the ORIGINAL pre-restore candidate with one naming
    // a candidate captured from the already-replaced state - and the only copy of what the user had
    // before would become an orphan for the next sweep to delete.
    //
    // Startup reconciliation finishes the previous operation, so the way forward is a relaunch, not
    // a retry here.
    const pending = await query('SELECT value FROM catalog_meta WHERE key=?;', [RESTORE_PENDING_KEY]);
    if (pending.length) {
      throw new ReplaceRefused('reconciliation-pending',
        'A previous restore has not finished. Reopen the app to complete it, then try again.');
    }

    // CAPTURE, after the drain, through the owner-scoped consistent read. This is the exact state
    // the replacement will destroy - the candidate, the binding check and the plan's dash_seeded
    // re-key all derive from it and nothing else.
    const captured = await session.readTransaction(async () => {
      const profiles = await listProfiles();
      const units = [];
      for (const p of profiles) units.push(await buildProfileUnit(p.id));
      let active = null;
      try { active = activeProfileId(); } catch { active = null; }   // pre-init: not an error here
      const idx = profiles.findIndex((p) => p.id === active);
      return {
        units,
        activeProfileIndex: idx >= 0 ? idx : null,
        profileIds: profiles.map((p) => p.id),
        setsOf: await catalogSets(),
      };
    });

    // changelogSeenBuild is device-install state the format is dropping (§8 Exclude); the recovery
    // candidate never carries it, and contentDigestOf ignores it, so a user's own export - which
    // still does - binds against this capture cleanly.
    const captureEnv = await seal(buildEnvelope({
      schemaVersion: SCHEMA_VERSION, appBuild: currentBuild(), exportedAt: nowIso(),
      appGlobal: { activeProfileIndex: captured.activeProfileIndex, changelogSeenBuild: null },
      profiles: captured.units,
    }));

    // The recovery point, written under an immutable id and read back through the same digest
    // check a restore would use. Any answer but "verified" aborts with nothing destroyed.
    const candidateId = await writeCandidate(JSON.stringify(captureEnv));
    if (!(await verifyCandidate(candidateId))) {
      throw new Error('The safety snapshot could not be verified on this device, so nothing was replaced.');
    }

    // Durability refused: the user's external file must describe THIS capture, not whatever the
    // state was when they exported it. Checked after drain, so nothing can settle in between.
    if (!policy.allowed) await assertBoundArchiveMatches(binding, captureEnv);

    // ONE TRANSACTION. Deletes, re-keyed inserts, Primary and the journal row commit together or
    // not at all - the property everything downstream (startup reconciliation, Undo) rests on.
    const plan = planReplace(env, {
      candidateId, profileIds: captured.profileIds, setsOf: captured.setsOf,
    });
    await session.tx(plan.statements);

    // COMMITTED. From here the operation is finished, not failed: the journal row is durable, so
    // even if every step below dies, startup reconciliation completes idempotently from it.
    // Through the repository, never a direct Preferences write - restoreAll's comment records the
    // three-authorities break that rule exists to prevent.
    let activeReconciled = false;
    try { await switchProfile(plan.intendedActiveId); activeReconciled = true; }
    catch { /* the journal row still names the intent; startup finishes it */ }

    // Publish the pointer with the session's own admitted write - external admission is closed,
    // so recoveryStore's default run() would be refused - then retire the journal: the pointer
    // now carries everything the row was protecting.
    //
    // GUARDED, because the comment above has to be true in code and not only in prose. An
    // unguarded rejection here propagated out of replaceAll and the UI reported "Restore failed"
    // for an operation whose data had already committed. That invited a retry, and a retry would
    // have captured the ALREADY-REPLACED state and overwritten the journal naming the real
    // pre-restore candidate - destroying the user's only copy of what they had, through the very
    // action the error message suggested.
    //
    // So past the commit there is no failure, only "finished" or "deferred". Deferred means the
    // rows are in and startup reconciliation completes the rest idempotently from the journal row,
    // which is exactly why the row is retired LAST.
    let published = false;
    let retired = false;
    try {
      const write = (sql, params) => session.tx([[sql, params]]);
      await promote(candidateId, { write });
      published = true;
      // THE JOURNAL IS THE RETRY TICKET, so it may only be torn up when there is nothing left to
      // retry. Retiring it here unconditionally covered the case where publication failed and
      // missed the mirror image: switchProfile fails, publication then SUCCEEDS, and the row is
      // deleted anyway - taking with it the only record of `intendedActiveId`. The next boot would
      // find no pending operation, be unable to adopt the archive's active profile, and fall back to
      // whichever restored profile sorts first, while the toast had promised that reopening would
      // finish the job. The promise was made durable by a row this line then removed.
      //
      // So: retire only when the active profile settled too. Otherwise leave it and let startup
      // reconciliation finish - it is idempotent, and re-promoting an already-published id is a
      // no-op by design.
      if (activeReconciled) {
        await write('DELETE FROM catalog_meta WHERE key=?;', [RESTORE_PENDING_KEY]);
        retired = true;
      }
    } catch { /* the journal row survives; the next boot finishes it */ }

    return {
      profiles: plan.profiles.length,
      activeProfileId: plan.intendedActiveId,
      activeReconciled,
      recoveryPointId: candidateId,
      statements: plan.statements.length,
      // false => committed but not fully settled. The caller MUST NOT present this as a failure.
      // All three matter: a lingering journal row is not cosmetic, because it REFUSES the next
      // replacement until a relaunch clears it - so leaving one is a reason to tell the user to
      // reopen, not to call the operation done.
      settled: published && activeReconciled && retired,
      published,
      via: 'replace',
    };
  } finally {
    // Always - a failed replace must cost the restore, never leave the app read-only. An orphaned
    // candidate is startup's sweep to collect; a missing release has no collector.
    session.release();
  }
}
