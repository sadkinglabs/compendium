// ProfileRepository - the active-profile gate and profile lifecycle.
// Profiles are universal and own every piece of user-created data. Nothing
// reads profile data without an active profile id; switching is atomic
// (set active id -> callers reload their partition fully, then render).
import { Preferences } from '@capacitor/preferences';
import { query, run, tx, persist } from './db.js';
import { SCHEMA_VERSION } from './schema.js';
import { uuid, nowIso } from './ids.js';
import { withProfileSwitchWriteBarrier } from './collectionWrites.js';

const ACTIVE_KEY = 'activeProfileId';

let activeId = null;

/** The id every profile-scoped query must use. Throws if not yet resolved. */
export function activeProfileId() {
  if (!activeId) throw new Error('No active profile - call initProfiles() first.');
  return activeId;
}

// Test-only: pin the active profile id without initProfiles()/Preferences.
export function __setActiveIdForTests(id) { activeId = id; }

/** Resolve (or create) the active profile on boot. Guarantees >=1 profile and
 *  EXACTLY one default (the is_default flag is the deletion shield - asserted
 *  every boot so it can never be lost to migrations or imports). */
const DEFAULT_NAME = 'Sorcerer';   // starter profile name - a little flavour out of the box

// Deterministic role repair: lowest created_at wins, then lowest id. Decided here in
// JS rather than by SQL row order, because ORDER BY leaves ties unspecified - the same
// rows must crown the same profile on every device and in every insertion order.
const oldestFirst = (a, b) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1;

export async function initProfiles() {
  let profiles = await listProfiles();
  if (profiles.length === 0) {
    const p = await createProfile(DEFAULT_NAME, { isDefault: true });
    activeId = p.id;
    profiles = await listProfiles();
  } else {
    const stored = (await Preferences.get({ key: ACTIVE_KEY })).value;
    activeId = profiles.some((p) => p.id === stored) ? stored : profiles[0].id;
  }
  // Repair to EXACTLY one: zero defaults crowns the oldest profile, multiples collapse
  // to the oldest holder. Clear-all and set-one commit together so the repair itself
  // can never be the moment the database has zero or two.
  const holders = profiles.filter((p) => p.is_default);
  if (holders.length !== 1) {
    const winner = (holders.length ? holders : profiles).slice().sort(oldestFirst)[0];
    await tx([
      ['UPDATE profiles SET is_default=0;'],
      ['UPDATE profiles SET is_default=1 WHERE id=?;', [winner.id]],
    ]);
  }
  // One-time flavour migration: an existing default still on the old auto name
  // "Default" (i.e. never renamed by the user) becomes "Sorcerer".
  await run("UPDATE profiles SET name=? WHERE is_default=1 AND name='Default';", [DEFAULT_NAME]);
  await Preferences.set({ key: ACTIVE_KEY, value: activeId });
  return getActiveProfile();
}

export async function listProfiles() {
  return query('SELECT * FROM profiles ORDER BY created_at ASC;');
}

/** Cross-profile digest for the profile picker (decks · matches per profile). */
export async function profileStats(id) {
  const decks = (await query('SELECT COUNT(*) c FROM decks WHERE profile_id=?;', [id]))[0].c;
  const matches = (await query('SELECT COUNT(*) c FROM matches WHERE profile_id=?;', [id]))[0].c;
  // Collected copies, counted the same way the dashboard counts them (homeRepository).
  // Deleting a profile cascades its collection too, so the delete confirmation must be
  // able to say how much collection is at stake - not just decks and matches.
  const cards = (await query('SELECT COALESCE(SUM(qty_owned),0) n FROM owned_cards WHERE profile_id=?;', [id]))[0].n;
  return { decks, matches, cards };
}

export async function getActiveProfile() {
  const rows = await query('SELECT * FROM profiles WHERE id=?;', [activeProfileId()]);
  return rows[0] || null;
}

export async function createProfile(name, { accent = 'gold', avatar = null, isDefault = false } = {}) {
  const id = uuid();
  const ts = nowIso();
  await run(
    `INSERT INTO profiles(id,name,avatar,accent,system,schema_version,is_default,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?);`,
    [id, name, avatar ? JSON.stringify(avatar) : null, accent, 'sorcery', SCHEMA_VERSION, isDefault ? 1 : 0, ts, ts]
  );
  // Seed this profile's settings row with defaults.
  await run('INSERT OR IGNORE INTO settings(profile_id) VALUES(?);', [id]);
  return { id, name, accent, created_at: ts };
}

export async function renameProfile(id, name) {
  await run('UPDATE profiles SET name=?, updated_at=? WHERE id=?;', [name, nowIso(), id]);
}

/** Atomic switch: set the active id, persist, return the loaded profile. */
export async function switchProfile(id, { timeoutMs } = {}) {
  const exists = await query('SELECT id FROM profiles WHERE id=?;', [id]);
  if (!exists.length) throw new Error('Unknown profile: ' + id);
  // Write barrier: let pending Collection writes finish UNDER the current profile before the
  // active id changes, so an in-flight edit stays visible where the user made it.
  //
  // EXCLUSIVE, not merely drained. Draining says "nothing is in flight right now" and grants
  // nothing about the next instant, so a bulk command could enter between the drain and the
  // flip. Sharing the barrier means the two serialize instead of interleaving, and the flip
  // must stay INSIDE it for that to hold.
  //
  // This is the ONLY call site entitled to the tolerant barrier. A switch does not
  // read-then-write the ledger, and queued writes carry an explicit profileId so they commit
  // under the profile they were scheduled for whatever the active id becomes - the drain
  // preserves an edit's visibility, not its correctness. So a hung storage operation must not
  // be able to trap the user in a profile.
  await withProfileSwitchWriteBarrier(async () => {
    activeId = id;
    await Preferences.set({ key: ACTIVE_KEY, value: id });
  }, timeoutMs === undefined ? undefined : { timeoutMs });
  return getActiveProfile();
}

/** Move the Primary role (the is_default flag) to another profile. Clear-all and
 *  set-one commit together, so no moment - not even mid-operation - has the database
 *  without a Primary or holding two. */
export async function setPrimary(id) {
  const exists = await query('SELECT id FROM profiles WHERE id=?;', [id]);
  if (!exists.length) throw new Error('Unknown profile: ' + id);
  await tx([
    ['UPDATE profiles SET is_default=0;'],
    ['UPDATE profiles SET is_default=1 WHERE id=?;', [id]],
  ]);
  await persist();
}

/** Delete a Primary by handing the role to another profile - transfer and delete in
 *  ONE transaction, so a crash between them can never leave zero Primaries (which the
 *  boot repair would hand to an arbitrary survivor, not the one the user chose).
 *  If the deleted profile was active, reconcile through switchProfile() - never by
 *  writing Preferences directly, which would leave the runtime id pointing at a
 *  deleted profile until relaunch. */
export async function deleteProfileTransferringPrimary(id, newPrimaryId) {
  if (id === newPrimaryId) throw new Error('The new default must be a different profile.');
  const profiles = await listProfiles();
  if (profiles.length <= 1) throw new Error('Cannot delete the only profile.');
  const target = profiles.find((p) => p.id === id);
  if (!target) throw new Error('Unknown profile: ' + id);
  if (!profiles.some((p) => p.id === newPrimaryId)) throw new Error('Unknown profile: ' + newPrimaryId);
  // The role must actually be moving. Without this the function would happily delete a
  // NON-default profile and hand the role to newPrimaryId anyway - a silent reassignment
  // no caller asked for, from a function whose name promises the opposite. Deleting an
  // ordinary profile is deleteProfile()'s job.
  if (!target.is_default) throw new Error('Not the default profile - use deleteProfile(): ' + id);
  await tx([
    ['UPDATE profiles SET is_default=0;'],
    ['UPDATE profiles SET is_default=1 WHERE id=?;', [newPrimaryId]],
    ['DELETE FROM storage_allocations WHERE profile_id=?;', [id]],
    ['DELETE FROM profiles WHERE id=?;', [id]],   // ON DELETE CASCADE clears data
  ]);
  await persist();
  if (activeId === id) await switchProfile(newPrimaryId);
  return getActiveProfile();
}

/** Delete a profile (cascades all its data). The default profile (explicit
 *  is_default flag) and the last remaining profile are protected; if the
 *  active profile is deleted, fall back to another existing profile. To delete
 *  the default, transfer the role: deleteProfileTransferringPrimary(). */
export async function deleteProfile(id) {
  const profiles = await listProfiles();
  if (profiles.length <= 1) throw new Error('Cannot delete the only profile.');
  if (profiles.find((p) => p.id === id)?.is_default) throw new Error('The default profile cannot be deleted.');
  // Allocations first, THEN the profile. Deleting the profile cascades to owned_cards and to
  // storage_containers independently, and allocations hold a RESTRICT reference to owned rows - so
  // whether the delete succeeds depends on which cascade SQLite happens to process first. It works
  // today on both backends, and "works because of an ordering nobody promised" is exactly the shape
  // of the native/web divergences this repo has been bitten by. Making it explicit costs one
  // statement and removes the dependency entirely.
  await tx([
    ['DELETE FROM storage_allocations WHERE profile_id=?;', [id]],
    ['DELETE FROM profiles WHERE id=?;', [id]],   // ON DELETE CASCADE clears the rest
  ]);
  await persist();
  if (activeId === id) {
    const next = (await listProfiles())[0];
    await switchProfile(next.id);
  }
  return getActiveProfile();
}
