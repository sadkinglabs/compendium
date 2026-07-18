// Ongoing (in-progress, resumable) match - the snapshot of a live life-tracker
// game that the user has stepped away from (e.g. to check a Codex rule). It is
// ephemeral UI state, not match history, so it lives in localStorage (profile-
// scoped) and survives navigation and app restarts until the match is ended or
// discarded. The snapshot's shape/defaults/version are owned by ./matchSnapshot.js;
// this module only persists and validates it. LifeCounter produces it, App/LifeCounter
// consume it (lives, max, log, elapsed, avatars, oppName, recorded, clockOn).
import { activeProfileId } from './profileRepository.js';
import { isValidMatchSnapshot } from './matchSnapshot.js';

const KEY = () => `cx-ongoing-match:${activeProfileId()}`;

export function saveOngoing(snapshot) {
  try { localStorage.setItem(KEY(), JSON.stringify(snapshot)); } catch { /* quota/security - ignore */ }
}

export function loadOngoing() {
  try {
    const raw = localStorage.getItem(KEY());
    if (!raw) return null;
    const snap = JSON.parse(raw);
    // A stale snapshot (older app version, or corrupt) must NOT resume into undefined
    // life totals - matchSnapshot owns the version + finite-field check. Discard on fail.
    if (!isValidMatchSnapshot(snap)) { clearOngoing(); return null; }
    return snap;
  } catch { clearOngoing(); return null; }
}
export function clearOngoing() {
  try { localStorage.removeItem(KEY()); } catch { /* ignore */ }
}
