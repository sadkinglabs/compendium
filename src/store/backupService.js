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
import { snapshot, query, tx } from './db.js';
import { SCHEMA_VERSION } from './schema.js';
import { listProfiles, activeProfileId } from './profileRepository.js';
import { buildProfileUnit, planProfileUnit, importProfile } from './profileTransfer.js';
import { buildEnvelope, seal, parseBackup, readBackup, summarise } from './backup.js';
import { prepareBundle, ITERATED_COLLECTIONS } from './importBoundary.js';
import { uuid, nowIso } from './ids.js';
import { saveTextFile } from '../native.js';

const ACTIVE_KEY = 'activeProfileId';
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

/**
 * Parse and fully validate a backup, returning what a restore WOULD do. Writes nothing.
 * The UI shows this and waits for confirmation before `restoreAll` is called.
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
    return { profiles: 1, activeProfileId: pid, statements: null, via: 'profile-import' };
  }
  const env = preview?.env ?? preview;
  const setsOf = await catalogSets();
  const taken = new Set((await query('SELECT name FROM profiles;')).map((p) => p.name));

  const statements = [];
  const created = [];

  for (const unit of env.payload.profiles) {
    // Same boundary the per-profile import trusts: validate, then normalise v10 -> v11, in memory.
    const { bundle } = prepareBundle(
      { app: 'compendium', schemaVersion: env.schemaVersion, ...unit }, setsOf);

    // Restore under the original name, disambiguating against the device AND against names this
    // same restore has already claimed - two archived profiles can share a name.
    let name = bundle.profile?.name || 'Imported';
    if (taken.has(name)) name = `${name} (imported)`;
    let n = 2;
    while (taken.has(name)) { name = `${bundle.profile?.name || 'Imported'} (imported ${n++})`; }
    taken.add(name);

    let avatar = null;
    try { avatar = bundle.profile?.avatar ? JSON.parse(bundle.profile.avatar) : null; } catch { avatar = null; }

    const plan = planProfileUnit(bundle, {
      pid: uuid(), name, avatar,
      // Carried explicitly by a v2 unit, so a faithfully restored dashboard - including a
      // deliberately empty one - is not repopulated with starter widgets.
      dashSeeded: unit.dashSeeded,
    });
    statements.push(...plan.statements);
    created.push({ pid: plan.pid, name, wasDefault: unit.profile?.is_default === 1 });
  }

  // Adopt the archive's default. IN THE SAME TRANSACTION as the rows, so the database is never
  // momentarily without a default or with two.
  const newDefault = created.find((c) => c.wasDefault) ?? created[0];
  if (newDefault) {
    statements.push(['UPDATE profiles SET is_default=0;', []]);
    statements.push(['UPDATE profiles SET is_default=1 WHERE id=?;', [newDefault.pid]]);
  }

  // ONE transaction. Commits entirely or changes nothing (Options / H, size-measured in Stage 0).
  await tx(statements);

  // AFTER the commit, and separately recoverable: both are derivable from the restored database, so
  // a process death here costs at most "the wrong profile is active", which initProfiles() resolves
  // on the next boot.
  const idx = env.payload.appGlobal?.activeProfileIndex;
  const activePid = (idx != null && created[idx]) ? created[idx].pid : newDefault?.pid;
  if (activePid) await Preferences.set({ key: ACTIVE_KEY, value: activePid });

  const seen = env.payload.appGlobal?.changelogSeenBuild;
  const build = currentBuild();
  if (seen != null && build != null) {
    // CLAMPED: restoring a higher value from a newer device would permanently hide release notes
    // the user on this build has never seen.
    await Preferences.set({ key: SEEN_BUILD_KEY, value: String(Math.min(Number(seen), build)) });
  }

  return { profiles: created.length, activeProfileId: activePid, statements: statements.length, via: 'whole-app' };
}
