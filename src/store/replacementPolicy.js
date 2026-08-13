// The replacement policy - whether destructive replacement may proceed, and the binding that
// substitutes for durability when it may not. See docs/proposals/restore-semantics.md §5.
//
// Increment 2's `durability()` REPORTS where the recovery bytes live and whether the platform
// promises to keep them. This module turns that report into policy: on a runtime that cannot
// promise durability, "Replace all data" is DISABLED - not warned about - because a recovery
// point the browser may evict is indistinguishable from no recovery point at the only moment
// it matters.
//
// The remedy is an external archive, and Rev 3's hole was WHEN it was checked. An archive
// verified before the exclusive session describes a state that may already be stale: a write
// settling in between meant the artifact described state A while the replacement destroyed
// state B. So the archive is bound by its CANONICAL CONTENT DIGEST and compared against the
// frozen capture, inside the session, after drain - `assertBoundArchiveMatches` is that
// comparison, and a mismatch aborts before anything is destroyed.
//
// Everything here fails closed. An unreadable probe is not durable; a missing binding does not
// match; a file that cannot be verified is not a safety net. Refusal taxonomy for the UI:
//   - not durable          -> replacementPolicy() returns { allowed: false, code: 'not-durable' }
//   - corrupt / unreadable -> readBackup's ImportRejected propagates from bindExternalArchive,
//                             already typed and user-worded; this module does not re-wrap it
//   - single-profile file  -> ReplaceRefused 'single-profile'
//   - stale archive        -> ReplaceRefused 'stale-archive'
import { readBackup, contentDigestOf } from './backup.js';
import { durability } from './recoveryStore.js';

/** Thrown for every refusal this module owns, with a `code` so callers can tell the cases apart.
 *  Mirrors ImportRejected, which covers the refusals `readBackup` owns. */
export class ReplaceRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReplaceRefused';
    this.code = code;
  }
}

/**
 * May destructive replacement proceed on this runtime?
 *
 * Allowed exactly when the recovery backing is persistent - native app-private storage, or web
 * with `navigator.storage.persist()` granted. Anything else refuses: a probe that throws, a
 * missing StorageManager, or a report that is not literally `persistent: true` all collapse to
 * "not durable", because "cannot be determined" and "not durable" must be the same answer.
 *
 * The shape is for a UI to consume as-is: `allowed` gates the button, `reason` says why, and on
 * refusal `code` is machine-readable and `remedy` names the way forward (bind and verify an
 * external archive - see `bindExternalArchive`).
 *
 * `probe` is injectable for tests, per the promote({ write }) idiom; app code passes nothing.
 */
export async function replacementPolicy({ probe = durability } = {}) {
  let report = null;
  try { report = await probe(); } catch { report = null; }   // an unreadable probe is not durable
  if (report?.persistent === true) {
    return { allowed: true, code: null, reason: report.reason, remedy: null };
  }
  return {
    allowed: false,
    code: 'not-durable',
    reason: report?.reason ?? 'Durability could not be determined, so it is treated as absent.',
    remedy: 'Export a backup to a file first - Compendium will check it describes the exact data being replaced.',
  };
}

/**
 * Bind a user-supplied backup file as the durable substitute for this replacement attempt.
 *
 * The file goes through the SAME gate every restore read uses - `readBackup` parses it, checks
 * its digest, bounds and shape, and throws ImportRejected for anything it cannot trust, so a
 * corrupt file is refused here and never becomes a safety net. A legacy single-profile export is
 * refused too: only a whole-app archive can stand in for a whole-app recovery point.
 *
 * What is retained is deliberately NOT the archive: the binding is keyed by the canonical
 * content digest, the one identity that survives re-export - two backups of identical data
 * taken at different times bind identically, because `contentDigestOf` excludes the volatile
 * envelope. The rest is display metadata for the confirm screen.
 */
export async function bindExternalArchive(text) {
  const read = await readBackup(text);   // ImportRejected propagates: corrupt, tampered, oversized
  if (read.kind !== 'whole-app') {
    throw new ReplaceRefused('single-profile',
      'That file is a single-profile export. Only a full backup of all data can protect a full replacement - use Back up all data and supply that file.');
  }
  return {
    contentDigest: await contentDigestOf(read.env),
    exportedAt: read.env.exportedAt ?? null,
    profiles: read.env.payload.profiles.length,
  };
}

/**
 * The point of the whole increment: called AFTER capture, INSIDE the exclusive session, so the
 * comparison is against the frozen state the replacement will actually destroy - not against
 * whatever the state happened to be when the user picked the file.
 *
 * `captureEnvelope` is the session's captured whole-app envelope (Increment 4 produces it via
 * `session.readTransaction`). Equal content digests mean every row the replacement destroys is
 * in the user's external file; anything else aborts, and nothing has been destroyed yet.
 */
export async function assertBoundArchiveMatches(binding, captureEnvelope) {
  const bound = binding?.contentDigest;
  if (typeof bound !== 'string' || !bound) {
    // Reaching the destructive step with nothing bound is a caller bug, and it fails closed.
    throw new ReplaceRefused('nothing-bound',
      'No external backup is bound to this replacement, so it cannot proceed.');
  }
  if ((await contentDigestOf(captureEnvelope)) !== bound) {
    throw new ReplaceRefused('stale-archive',
      'Your data changed after that backup was exported, so it no longer describes what would be replaced. Export a fresh backup and try again.');
  }
}
