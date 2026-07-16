// The update gate: which release notes has this install not seen yet?
// Run: npm run test:query
//
// WHY THE STAMP LIVES HERE AND NOT IN THE settings TABLE
//
// "Which build did this install last show notes for" is a property of the
// install on this device. It is not user data, so it does not belong to a
// profile. Putting it in the per-profile settings table would cost a migration
// and a SCHEMA_VERSION bump and buy two defects: the notes would re-appear on
// every profile switch, and a profile exported from another device would carry
// its stamp along and either suppress notes you haven't read or replay ones you
// have. @capacitor/preferences is native SharedPreferences/UserDefaults and is
// what COMPENDIUM_ARCHITECTURE.md names for app-global singletons - the same
// tier activeProfileId uses. Nothing here touches profileTransfer.
//
// THE BUG THIS EXISTS TO KILL
//
// vite.config.js defines __APP_BUILD__ as JSON.stringify(String(pkg.build)), so
// it reaches app code as a STRING. Compare it as one and '9' > '35' is true,
// because '9' sorts after '3'. The gate would then be correct for builds 10-99
// and silently wrong at the boundary - passing every casual test written with
// two-digit builds. pendingEntries takes a NUMBER and refuses anything else;
// the caller is the only place a conversion happens.
import { Preferences } from '@capacitor/preferences';

const SEEN_BUILD = 'changelogSeenBuild';

/** The last build whose notes were dismissed, or null if this install has never
 *  dismissed any (a fresh install). Unparseable values collapse to null too, so
 *  a corrupt write degrades to one redundant modal rather than an exception on
 *  the boot path. */
export async function getSeenBuild() {
  const raw = (await Preferences.get({ key: SEEN_BUILD })).value;
  const n = Number(raw);
  return raw != null && Number.isFinite(n) ? n : null;
}

/** Record that the notes up to `build` have been seen. Called on DISMISSAL, not
 *  on display: if the app is killed while the modal is open the notes come back
 *  next launch, which is the harmless failure. Stamping on show would swallow a
 *  release's notes for good. */
export async function setSeenBuild(build) {
  await Preferences.set({ key: SEEN_BUILD, value: String(build) });
}

/**
 * The entries this install should be shown, newest first.
 *
 * The rule, stated once:  seen < entry.build <= current
 *
 *  - Lower bound: catch-up. Skipping two releases shows both, not just the last.
 *  - Upper bound: notes are usually written before the build that ships them, so
 *    an entry authored ahead of `current` must stay invisible until it ships.
 *  - `seen === null` (fresh install) means no lower bound at all: an alpha tester
 *    gets the whole history. This is a DELIBERATE, TEMPORARY alpha choice - see
 *    docs/proposals/changelog-screen.md. Revisit at 1.0, when onboarding exists
 *    and a user with no baseline becomes the common case rather than the rare one.
 *
 * Note what this rule does NOT do: it never asks whether `current` has an entry
 * of its own. A release that ships without notes must not swallow the notes of
 * the release before it.
 */
export function pendingEntries(changelog, seen, current) {
  if (!Number.isFinite(current)) {
    // Returning [] here is fail-safe (show nothing) rather than fail-loud, which
    // means a caller that forgot Number(__APP_BUILD__) would kill the gate
    // SILENTLY - no crash, no notes, every test still green, because "[] is a
    // valid answer" is exactly what the unit tests assert. The unit tests cannot
    // catch a caller's mistake, so say something. import.meta.env is undefined
    // under node --test; the ?. keeps this file importable there.
    if (import.meta.env?.DEV) console.error('pendingEntries: current build is not a number:', current);
    return [];
  }
  return (changelog || []).filter((e) => e.build <= current && (seen === null || e.build > seen));
}
