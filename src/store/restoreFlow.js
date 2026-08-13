// The restore confirm screen's DECISIONS, as pure functions - which executor a file goes to, whether
// the destructive button may be pressed, and what the user is told afterwards.
//
// WHY THIS MODULE EXISTS. All of it lived in `RestorePreviewModal`, which nothing can execute:
// App.jsx has no test coverage, and `node --test` cannot mount a React component without a DOM. So
// the one place that decides whether a user's data is deleted was the one place no test could reach.
// The service boundary refuses the dangerous mistake outright (restoreAll rejects whole-app archives,
// replaceAll rejects single-profile ones), but "the boundary catches it" is a second line, not a
// reason to leave the first one unexaminable.
//
// Same shape as the other UI-state extractions in this codebase: no React, no DOM, no imports that
// touch the database. The component keeps the effects and the markup; every judgement is here.
import { REPLACE_ALL } from './backupService.js';

/** Which executor this preview authorises. The classifier decided it; this only reads the answer,
 *  because a second derivation is how the wrong file reaches the destructive path. */
export function executorFor(preview) {
  return preview?.operation === REPLACE_ALL ? 'replace' : 'import';
}

/**
 * May the destructive button be pressed?
 *
 * `policy === null` means "not answered yet", and it is treated as NOT allowed. That is the whole
 * point: an earlier version computed this only once the policy resolved, so the button was live for
 * the width of an async import and a quick confirm on a non-persistent browser produced exactly the
 * "offered, then failed" experience the fail-closed design exists to remove. Unknown is not
 * permission.
 */
export function confirmState({ destructive = false, policy = null, binding = null, busy = false } = {}) {
  if (!destructive) return { blocked: busy, pending: false, reason: null };
  if (binding) return { blocked: busy, pending: false, reason: null };
  if (policy == null) return { blocked: true, pending: true, reason: null };
  if (!policy.allowed) return { blocked: true, pending: false, reason: policy.reason, remedy: policy.remedy };
  return { blocked: busy, pending: false, reason: null };
}

/**
 * What the user is told once an executor returns.
 *
 * THREE OUTCOMES, and only one of them is a failure - which is not reachable from a returned result
 * at all, because past the commit the executors return instead of rejecting. `settled: false` means
 * the rows are in and something after them did not finish; the next launch completes it from the
 * journal row. Saying "failed" there would invite the retry that could destroy the recovery point,
 * which is the entire reason this distinction exists.
 */
export function outcomeMessage(result) {
  const n = result?.profiles ?? 0;
  const noun = `${n} profile${n === 1 ? '' : 's'}`;
  const replacing = result?.via === 'replace';
  const settled = replacing ? result?.settled !== false : result?.activeReconciled !== false;
  if (settled) {
    return { tone: 'ok', text: replacing ? `Replaced everything with ${noun}.` : `Restored ${noun}.` };
  }
  return {
    tone: 'ok',                    // deliberately NOT danger: the data is in.
    text: replacing
      ? `Replaced everything with ${noun}. Reopen the app to finish tidying up.`
      : `Restored ${noun}. Reopen the app to finish switching.`,
  };
}

/** A refusal that never reached a commit. Only pre-commit paths produce these. */
export function failureMessage(err) {
  return { tone: 'danger', text: `Restore failed: ${err?.message || err}` };
}
