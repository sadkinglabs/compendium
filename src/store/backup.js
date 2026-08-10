// Whole-app backup: the PURE core. No database, no DOM, no Capacitor - so all of it is testable
// under `npm run test:query`, and none of it can be reached from the app until Stage 5 wires it.
//
// See docs/proposals/backup-and-restore.md (Revision 4, owner-approved). This module owns the
// artifact - its shape, its integrity, and every reason to refuse one. It does NOT own reading or
// writing the database; Stage 4 supplies the per-profile unit builders.
//
// THE ONE RULE THAT MATTERS MOST HERE: writer and reader must hash byte-identical documents.
// Revision 3 of the proposal had the writer hash the envelope BEFORE `integrity` was attached while
// the reader stripped only `integrity.digest` - leaving `integrity.algorithm` in the reader's
// preimage and not the writer's. Every valid archive would have failed its own integrity check.
// The fix is to name the preimage once, `unsigned`, and have both sides use that name.
import {
  ImportRejected, MAX_SUPPORTED_SCHEMA, ITERATED_COLLECTIONS, validateBundle,
} from './importBoundary.js';

/** The envelope version this build writes. 1 (or absent) is the legacy single-profile bundle. */
export const BUNDLE_FORMAT = 2;

export const DIGEST_ALGORITHM = 'SHA-256';

/**
 * Ceilings, checked before anything is allocated or written.
 *
 * A whole-app archive is a far larger accident-and-hostility surface than a single profile, and the
 * existing import boundary validates shape but never size. Numbers are calibrated against measured
 * reality (see the Stage 0 result in the proposal): the owner's real profile is ~1,470 rows and
 * ~450 KiB; a synthetic "heavy collector" across three profiles is ~102,000 rows. Every limit below
 * is therefore generous by one to two orders of magnitude against real use, and still finite against
 * a corrupt or crafted file.
 */
export const LIMITS = {
  // Deliberately not "as big as possible": the file is read into a string and then parsed into an
  // object graph, so peak memory is a multiple of this. 32 MiB is ~70x the owner's current export.
  fileBytes: 32 * 1024 * 1024,
  profiles: 50,
  rowsPerTable: 250_000,
  rowsTotal: 1_000_000,
};

/* ------------------------------------------------------------------ */
/* Canonical JSON - the digest preimage must be byte-stable            */
/* ------------------------------------------------------------------ */

/**
 * Deterministic JSON: object keys sorted, arrays left in order, no incidental whitespace.
 *
 * Two documents that differ only in key insertion order must produce the same bytes, or the digest
 * would depend on how the object happened to be built rather than on what it contains.
 *
 * `undefined` members are dropped exactly as `JSON.stringify` drops them, so canonicalising a value
 * and re-parsing it is stable. Non-finite numbers throw rather than silently becoming `null`: a
 * NaN in a backup is a bug upstream, and quietly encoding it as null would hide it.
 */
export function canonicalJson(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number (${value})`);
    return JSON.stringify(value);
  }
  if (t === 'string' || t === 'boolean') return JSON.stringify(value);
  if (t === 'undefined' || t === 'function' || t === 'symbol') return undefined;
  if (Array.isArray(value)) {
    // An array member that would serialise to nothing becomes null, matching JSON.stringify.
    return '[' + value.map((v) => canonicalJson(v) ?? 'null').join(',') + ']';
  }
  if (t === 'object') {
    const parts = [];
    for (const key of Object.keys(value).sort()) {
      const encoded = canonicalJson(value[key]);
      if (encoded === undefined) continue;           // drop undefined members, as JSON does
      parts.push(JSON.stringify(key) + ':' + encoded);
    }
    return '{' + parts.join(',') + '}';
  }
  throw new TypeError(`canonicalJson: unsupported type ${t}`);
}

/* ------------------------------------------------------------------ */
/* Digest                                                              */
/* ------------------------------------------------------------------ */

/**
 * SHA-256 of a string, as lowercase hex, via Web Crypto.
 *
 * THROWS when Web Crypto is unavailable, and that is deliberate: a backup with no verifiable digest
 * is exactly the artifact this feature exists to avoid, so the operation fails loudly rather than
 * writing something that cannot be checked later. Availability is expected everywhere we run - the
 * Capacitor WebView serves from `https://localhost` (a secure context) and Node has had
 * `globalThis.crypto.subtle` for years - but it is asserted rather than assumed.
 */
export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ImportRejected('no-crypto',
      'This device cannot compute a backup checksum, so the backup was not created.');
  }
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest(DIGEST_ALGORITHM, bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ */
/* The envelope                                                        */
/* ------------------------------------------------------------------ */

/**
 * THE canonical preimage, defined in exactly one place.
 *
 * `unsigned` is the whole envelope INCLUDING `integrity.algorithm` and EXCLUDING `integrity.digest`.
 * Both `seal` (writer) and `verifyDigest` (reader) hash precisely this, so they cannot drift.
 */
export function unsignedOf(envelope) {
  const { integrity, ...rest } = envelope;
  return { ...rest, integrity: { algorithm: integrity?.algorithm ?? DIGEST_ALGORITHM } };
}

/**
 * Assemble the unsigned envelope. `profiles` are already-built units (Stage 4 supplies the builder);
 * this module never touches the database.
 */
export function buildEnvelope({ schemaVersion, appBuild, exportedAt, appGlobal, profiles }) {
  return {
    app: 'compendium',
    bundleFormat: BUNDLE_FORMAT,
    schemaVersion,
    appBuild,
    exportedAt,
    integrity: { algorithm: DIGEST_ALGORITHM },
    payload: {
      appGlobal: {
        activeProfileIndex: appGlobal?.activeProfileIndex ?? null,
        changelogSeenBuild: appGlobal?.changelogSeenBuild ?? null,
      },
      profiles,
    },
  };
}

/** Seal an unsigned envelope into the file that gets written. */
export async function seal(envelope) {
  const unsigned = unsignedOf(envelope);
  const digest = await sha256Hex(canonicalJson(unsigned));
  return { ...unsigned, integrity: { algorithm: DIGEST_ALGORITHM, digest } };
}

/* ------------------------------------------------------------------ */
/* Reading: every reason to refuse, in the order that writes nothing   */
/* ------------------------------------------------------------------ */

/** True for the legacy single-profile bundle, which the existing import path still handles. */
export function isLegacyBundle(obj) {
  const f = obj?.bundleFormat;
  return f == null || f === 1;
}

function assertEnvelopeShape(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new ImportRejected('malformed', 'That file is not a Compendium backup.');
  }
  if (env.app !== 'compendium') {
    throw new ImportRejected('not-compendium', 'That file is not a Compendium backup.');
  }
  if (!Number.isInteger(env.bundleFormat) || env.bundleFormat < 1) {
    throw new ImportRejected('malformed', 'That backup has an unreadable format.');
  }
  if (env.bundleFormat > BUNDLE_FORMAT) {
    throw new ImportRejected('future',
      `That backup was written by a newer version of Compendium (format ${env.bundleFormat}). Update the app and try again.`);
  }
  const v = env.schemaVersion;
  if (!Number.isInteger(v) || v < 1) {
    throw new ImportRejected('malformed', 'That backup has an unreadable version.');
  }
  if (v > MAX_SUPPORTED_SCHEMA) {
    throw new ImportRejected('future',
      `That backup was exported by a newer version of Compendium (schema ${v}). Update the app and try again.`);
  }
  const p = env.payload;
  if (!p || typeof p !== 'object' || !Array.isArray(p.profiles)) {
    throw new ImportRejected('malformed', 'That backup is damaged (no profiles).');
  }
}

async function verifyDigest(env) {
  const claimed = env.integrity?.digest;
  if (typeof claimed !== 'string' || !claimed) {
    throw new ImportRejected('no-digest', 'That backup has no checksum, so it cannot be trusted.');
  }
  if (env.integrity?.algorithm !== DIGEST_ALGORITHM) {
    throw new ImportRejected('malformed', 'That backup uses an unknown checksum algorithm.');
  }
  const actual = await sha256Hex(canonicalJson(unsignedOf(env)));
  if (actual !== claimed) {
    throw new ImportRejected('corrupt',
      'That backup failed its checksum: it is damaged or was edited. Nothing has been changed.');
  }
}

/**
 * Size ceilings. Counted AFTER parse because rows cannot be counted before it - the file-byte ceiling
 * is the one that runs first, and it is the one that bounds how much is parsed at all.
 */
function assertBounds(env) {
  const profiles = env.payload.profiles;
  if (profiles.length > LIMITS.profiles) {
    throw new ImportRejected('too-large', `That backup contains ${profiles.length} profiles, more than this app will restore.`);
  }
  let total = 0;
  for (const unit of profiles) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) {
      throw new ImportRejected('malformed', 'That backup is damaged (a profile entry is not an object).');
    }
    for (const key of ITERATED_COLLECTIONS) {
      const arr = unit[key];
      if (arr == null) continue;
      if (!Array.isArray(arr)) throw new ImportRejected('malformed', `That backup is damaged (${key}).`);
      if (arr.length > LIMITS.rowsPerTable) {
        throw new ImportRejected('too-large', `That backup contains an implausible number of ${key} rows.`);
      }
      total += arr.length;
      if (total > LIMITS.rowsTotal) {
        throw new ImportRejected('too-large', 'That backup is larger than this app will restore.');
      }
    }
  }
}

/**
 * Cardinality rules that nothing else enforces today. Both are refusals, never repairs: silently
 * "fixing" which profile is default would be the app choosing on the user's behalf.
 */
function assertCardinality(env) {
  const profiles = env.payload.profiles;
  const defaults = profiles.filter((u) => u?.profile?.is_default === 1).length;
  if (defaults !== 1) {
    throw new ImportRejected('malformed',
      `That backup names ${defaults} default profiles; exactly one is required.`);
  }
  const idx = env.payload.appGlobal?.activeProfileIndex;
  if (idx != null) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= profiles.length) {
      throw new ImportRejected('malformed', 'That backup points at a profile that is not in it.');
    }
  }
}

/** Per-unit row shape, reusing the SAME validator the live per-profile import already trusts. */
function assertUnitShapes(env) {
  for (const unit of env.payload.profiles) {
    // validateBundle expects a legacy-shaped bundle; a v2 unit is that shape plus `profile`. Reusing
    // it keeps ONE definition of "which collections must be arrays" and one owned_cards row check,
    // so the whole-app path cannot drift from the per-profile path.
    validateBundle({ app: 'compendium', schemaVersion: env.schemaVersion, ...unit });
  }
}

/**
 * The whole read path, in the order that leaves the database untouched on any rejection.
 *
 * Nothing here writes, so "leaves nothing behind" is structural rather than careful: a caller cannot
 * begin restoring until this has returned.
 */
export async function parseBackup(text) {
  if (typeof text !== 'string') {
    throw new ImportRejected('malformed', 'That file is not a Compendium backup.');
  }
  // FIRST, before the string is turned into an object graph several times its size.
  if (text.length > LIMITS.fileBytes) {
    throw new ImportRejected('too-large', 'That file is too large to be a Compendium backup.');
  }
  let env;
  try { env = JSON.parse(text); }
  catch { throw new ImportRejected('malformed', 'That file is not readable as a Compendium backup.'); }

  assertEnvelopeShape(env);
  await verifyDigest(env);      // integrity before content: refuse a damaged file before walking it
  assertBounds(env);
  assertUnitShapes(env);
  assertCardinality(env);
  return env;
}

/** Counts for the restore preview. Pure; assumes `parseBackup` already accepted the envelope. */
export function summarise(env) {
  return env.payload.profiles.map((unit) => ({
    name: unit.profile?.name ?? 'Profile',
    isDefault: unit.profile?.is_default === 1,
    decks: unit.decks?.length ?? 0,
    ownedCards: unit.owned_cards?.length ?? 0,
    matches: unit.matches?.length ?? 0,
    rows: ITERATED_COLLECTIONS.reduce((a, k) => a + (unit[k]?.length ?? 0), 0),
  }));
}
