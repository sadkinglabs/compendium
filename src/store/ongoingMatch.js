// Ongoing (in-progress, resumable) match — the snapshot of a live life-tracker
// game that the user has stepped away from (e.g. to check a Codex rule). It is
// ephemeral UI state, not match history, so it lives in localStorage (profile-
// scoped) and survives navigation and app restarts until the match is ended or
// discarded. Shape is owned by LifeCounter/App (lives, max, log, elapsed, avatars…).
import { activeProfileId } from './profileRepository.js';

const KEY = () => `cx-ongoing-match:${activeProfileId()}`;
const SNAP_VERSION = 1;   // bump when the snapshot shape changes (LifeCounter.buildSnapshot)

export function saveOngoing(snapshot) {
  try { localStorage.setItem(KEY(), JSON.stringify(snapshot)); } catch { /* quota/security — ignore */ }
}

// A stale snapshot (older app version, or corrupt) must NOT resume into
// undefined life totals — validate the version and the load-bearing numeric
// fields, and discard anything that doesn't check out.
function isValidSnapshot(s) {
  return !!s && s.v === SNAP_VERSION
    && Number.isFinite(s.pLife) && Number.isFinite(s.pMax)
    && Number.isFinite(s.eLife) && Number.isFinite(s.eMax);
}

export function loadOngoing() {
  try {
    const raw = localStorage.getItem(KEY());
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!isValidSnapshot(snap)) { clearOngoing(); return null; }
    return snap;
  } catch { clearOngoing(); return null; }
}
export function clearOngoing() {
  try { localStorage.removeItem(KEY()); } catch { /* ignore */ }
}
