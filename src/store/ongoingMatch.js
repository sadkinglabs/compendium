// Ongoing (in-progress, resumable) match — the snapshot of a live life-tracker
// game that the user has stepped away from (e.g. to check a Codex rule). It is
// ephemeral UI state, not match history, so it lives in localStorage (profile-
// scoped) and survives navigation and app restarts until the match is ended or
// discarded. Shape is owned by LifeCounter/App (lives, max, log, elapsed, avatars…).
import { activeProfileId } from './profileRepository.js';

const KEY = () => `cx-ongoing-match:${activeProfileId()}`;

export function saveOngoing(snapshot) {
  try { localStorage.setItem(KEY(), JSON.stringify(snapshot)); } catch { /* quota/security — ignore */ }
}
export function loadOngoing() {
  try { const s = localStorage.getItem(KEY()); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function clearOngoing() {
  try { localStorage.removeItem(KEY()); } catch { /* ignore */ }
}
