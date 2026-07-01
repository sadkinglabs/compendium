// ProfileRepository — the active-profile gate and profile lifecycle.
// Profiles are universal and own every piece of user-created data. Nothing
// reads profile data without an active profile id; switching is atomic
// (set active id -> callers reload their partition fully, then render).
import { Preferences } from '@capacitor/preferences';
import { query, run, persist } from './db.js';
import { SCHEMA_VERSION } from './schema.js';
import { uuid, nowIso } from './ids.js';

const ACTIVE_KEY = 'activeProfileId';

let activeId = null;

/** The id every profile-scoped query must use. Throws if not yet resolved. */
export function activeProfileId() {
  if (!activeId) throw new Error('No active profile — call initProfiles() first.');
  return activeId;
}

/** Resolve (or create) the active profile on boot. Guarantees >=1 profile. */
export async function initProfiles() {
  const profiles = await listProfiles();
  if (profiles.length === 0) {
    const p = await createProfile('Default');
    activeId = p.id;
  } else {
    const stored = (await Preferences.get({ key: ACTIVE_KEY })).value;
    activeId = profiles.some((p) => p.id === stored) ? stored : profiles[0].id;
  }
  await Preferences.set({ key: ACTIVE_KEY, value: activeId });
  return getActiveProfile();
}

export async function listProfiles() {
  return query('SELECT * FROM profiles ORDER BY created_at ASC;');
}

export async function getActiveProfile() {
  const rows = await query('SELECT * FROM profiles WHERE id=?;', [activeProfileId()]);
  return rows[0] || null;
}

export async function createProfile(name, { accent = 'gold', avatar = null } = {}) {
  const id = uuid();
  const ts = nowIso();
  await run(
    `INSERT INTO profiles(id,name,avatar,accent,system,schema_version,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?);`,
    [id, name, avatar ? JSON.stringify(avatar) : null, accent, 'sorcery', SCHEMA_VERSION, ts, ts]
  );
  // Seed this profile's settings row with defaults.
  await run('INSERT OR IGNORE INTO settings(profile_id) VALUES(?);', [id]);
  return { id, name, accent, created_at: ts };
}

export async function renameProfile(id, name) {
  await run('UPDATE profiles SET name=?, updated_at=? WHERE id=?;', [name, nowIso(), id]);
}

/** Atomic switch: set the active id, persist, return the loaded profile. */
export async function switchProfile(id) {
  const exists = await query('SELECT id FROM profiles WHERE id=?;', [id]);
  if (!exists.length) throw new Error('Unknown profile: ' + id);
  activeId = id;
  await Preferences.set({ key: ACTIVE_KEY, value: id });
  return getActiveProfile();
}

/** Delete a profile (cascades all its data). Cannot delete the last one; if the
 *  active profile is deleted, fall back to another existing profile. */
export async function deleteProfile(id) {
  const profiles = await listProfiles();
  if (profiles.length <= 1) throw new Error('Cannot delete the only profile.');
  await run('DELETE FROM profiles WHERE id=?;', [id]); // ON DELETE CASCADE clears data
  await persist();
  if (activeId === id) {
    const next = (await listProfiles())[0];
    await switchProfile(next.id);
  }
  return getActiveProfile();
}
