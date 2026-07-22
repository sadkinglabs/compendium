// The profile-import boundary - validation and v10 -> v11 normalisation, both PURE.
//
// WHY THIS EXISTS SEPARATELY FROM BOOT CANONICALISATION. Boot converts the database once, at
// startup. An imported bundle arrives afterwards, so it walks straight past that guard: a
// restore of an old backup would put v10 rows into a v11 database, and nothing would notice
// until the next launch. "Wrong until you restart" is not a guarantee worth shipping.
//
// WHY IT RUNS BEFORE createProfile(). `importProfile` used to validate one field -
// `bundle.app` - and then create the profile, so a malformed or future bundle left an orphaned
// half-profile behind for the user to find and delete. Everything here is decided in memory,
// against no database, so a rejection leaves nothing at all.
//
// It reuses the SAME pure planner as boot. Two implementations of one mapping would drift, and
// the drift would only ever appear on restore - the least-tested path in the app.
import { planLedger } from './canonicalise.js';
import { isLegacyPrinting } from './printings.js';

/** The newest bundle this build understands. */
export const MAX_SUPPORTED_SCHEMA = 11;
/** Bundles predate the stamp, so a missing version means the oldest shape we ever wrote. */
export const ASSUMED_SCHEMA = 10;

/**
 * Every bundle field profileTransfer iterates. Each one must be an array or the import will
 * throw partway through, after the profile exists.
 */
export const ITERATED_COLLECTIONS = [
  'decks', 'deck_entries', 'deck_history', 'saved', 'notes', 'collections', 'collection_items',
  'owned_cards', 'card_lists', 'card_list_entries', 'links', 'matches', 'match_log_entries',
  'dashboard_blocks', 'dashboard_layouts',
];

/** Thrown for every rejection, with a `code` so callers can tell the cases apart. */
export class ImportRejected extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImportRejected';
    this.code = code;
  }
}

/**
 * Decide whether a bundle may be imported at all. Throws `ImportRejected`; returns the schema
 * version to treat it as.
 *
 * Deliberately strict about the FUTURE and forgiving about the past: forward-only migration
 * means we know how to read anything older, and by definition cannot know what a newer build
 * meant. Guessing there corrupts data silently, which is worse than refusing.
 */
export function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new ImportRejected('malformed', 'That file is not a Compendium profile.');
  }
  if (bundle.app !== 'compendium') {
    throw new ImportRejected('not-compendium', 'That file is not a Compendium profile.');
  }

  const raw = bundle.schemaVersion;
  const version = raw == null ? ASSUMED_SCHEMA : raw;
  // INTEGER, not merely a finite positive number. 10.5 is not a schema anyone ever wrote, and
  // treating it as v10 would import unknown data under a known label.
  if (!Number.isInteger(version) || version < 1) {
    throw new ImportRejected('malformed', 'That profile file has an unreadable version.');
  }
  if (version > MAX_SUPPORTED_SCHEMA) {
    throw new ImportRejected(
      'future',
      `That profile was exported by a newer version of Compendium (format ${version}). Update the app and try again.`,
    );
  }

  // EVERY collection profileTransfer later iterates, not just the ones this module cares about.
  //
  // Validating five of them was worse than validating none, because it made the no-orphan
  // guarantee look true: a bundle claiming `matches: 5` passed validation, the profile was
  // created, and the insert loop then threw on a number it could not iterate - leaving exactly
  // the half-profile the boundary exists to prevent. This list must stay in step with the
  // export shape; ITERATED_COLLECTIONS is the contract, and a test asserts it covers every
  // `for (const ... of bundle.X || [])` in profileTransfer.
  for (const key of ITERATED_COLLECTIONS) {
    if (bundle[key] != null && !Array.isArray(bundle[key])) {
      throw new ImportRejected('malformed', `That profile file is damaged (${key}).`);
    }
  }
  for (const row of bundle.owned_cards || []) {
    if (!row || typeof row !== 'object' || !row.card_id) {
      throw new ImportRejected('malformed', 'That profile file is damaged (owned_cards).');
    }
  }

  return version;
}

/** True when any ownership row still carries a v10 key. */
export function hasLegacyRows(bundle) {
  return (bundle?.owned_cards || []).some((r) => isLegacyPrinting(r?.variant_slug ?? ''));
}

/**
 * Return the bundle in v11 shape.
 *
 * SHAPE-FIRST, like the boot marker: the stamped version is a hint, the rows are the truth. A
 * bundle claiming v11 while carrying legacy keys - hand-edited, or written by an interrupted
 * export - is normalised anyway rather than trusted. A bundle that is genuinely already
 * canonical is returned UNCHANGED, so a v11 round trip cannot perturb anything.
 *
 * @param setsOf (card_id) => set codes. Injected, so this module never touches the catalog.
 */
export function normaliseBundle(bundle, setsOf) {
  if (!hasLegacyRows(bundle)) return bundle;

  // The planner groups by profile_id, and bundle rows all belong to one profile - but an
  // exported row may carry the SOURCE device's profile id, or none at all. Pin them to one
  // synthetic id so grouping cannot split a card across phantom profiles, then drop it again:
  // importProfile assigns the real profile id and a fresh row id to every row anyway.
  const pinned = (bundle.owned_cards || []).map((r) => ({ ...r, profile_id: 'import' }));
  const { rows } = planLedger(pinned, setsOf);

  return {
    ...bundle,
    schemaVersion: MAX_SUPPORTED_SCHEMA,
    owned_cards: rows.map(({ needsId, id, profile_id, ...row }) => row),
  };
}

/**
 * The whole boundary, in the order that makes a rejection leave nothing behind.
 * Validate, then normalise, and only then may a caller create anything.
 */
export function prepareBundle(bundle, setsOf) {
  const version = validateBundle(bundle);
  return { version, bundle: normaliseBundle(bundle, setsOf) };
}
