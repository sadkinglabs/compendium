// The restore confirm screen's decisions, now that they are reachable. Run: npm run test:query
//
// Codex's standing finding across three rounds was that the destructive-vs-additive choice lived in
// App.jsx, which no test can execute. The service boundary refuses the dangerous mistake either way,
// so this is regression hardening rather than the last line of defence - but the judgements below
// decide what a user is offered and what they are told after their data is replaced, and they were
// previously unexaminable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executorFor, confirmState, outcomeMessage, failureMessage } from './restoreFlow.js';
import { REPLACE_ALL, IMPORT_PROFILE } from './backupService.js';

/* ---------------------------------- routing ---------------------------------- */

test('a whole-app operation routes to REPLACE, a single-profile one to IMPORT', () => {
  assert.equal(executorFor({ operation: REPLACE_ALL }), 'replace');
  assert.equal(executorFor({ operation: IMPORT_PROFILE }), 'import');
});

test('anything unrecognised routes to IMPORT - the additive, non-destructive side', () => {
  // Fail safe rather than fail dangerous: a dropped or renamed field must not be able to select
  // the operation that deletes data. The executor boundary refuses the mismatch anyway, so the
  // outcome is a clean refusal rather than a wrong replacement.
  for (const p of [undefined, null, {}, { operation: 'nonsense' }, { operation: '' }]) {
    assert.equal(executorFor(p), 'import', `routed ${JSON.stringify(p)} to the destructive path`);
  }
});

/* ------------------------------ the destructive gate ------------------------------ */

test('an additive restore is never gated on durability', () => {
  const s = confirmState({ destructive: false, policy: null });
  assert.equal(s.blocked, false);
  assert.equal(s.pending, false);
});

test('an UNRESOLVED policy blocks the destructive button - unknown is not permission', () => {
  // The regression this file was written for. Computing `blocked` only once policy resolved left the
  // button live for the width of an async import.
  const s = confirmState({ destructive: true, policy: null });
  assert.equal(s.blocked, true, 'the destructive button was live before the answer arrived');
  assert.equal(s.pending, true, 'and the UI must be able to say so rather than looking ready');
});

test('a refused policy blocks, and carries the reason and the remedy for the user', () => {
  const s = confirmState({
    destructive: true,
    policy: { allowed: false, code: 'not-durable', reason: 'No durable store.', remedy: 'Supply a backup.' },
  });
  assert.equal(s.blocked, true);
  assert.equal(s.pending, false);
  assert.equal(s.reason, 'No durable store.');
  assert.equal(s.remedy, 'Supply a backup.');
});

test('a bound external archive unblocks a refused policy', () => {
  const policy = { allowed: false, reason: 'No durable store.', remedy: 'Supply a backup.' };
  assert.equal(confirmState({ destructive: true, policy }).blocked, true);
  assert.equal(confirmState({ destructive: true, policy, binding: { contentDigest: 'abc' } }).blocked, false);
});

test('a binding short-circuits even an unresolved policy, because it is the stronger guarantee', () => {
  assert.equal(confirmState({ destructive: true, policy: null, binding: { contentDigest: 'abc' } }).blocked, false);
});

test('busy blocks every path, so a double tap cannot start two replacements', () => {
  assert.equal(confirmState({ destructive: true, policy: { allowed: true }, busy: true }).blocked, true);
  assert.equal(confirmState({ destructive: false, busy: true }).blocked, true);
});

/* ------------------------------ what the user is told ------------------------------ */

test('a settled replacement says so plainly', () => {
  const m = outcomeMessage({ via: 'replace', profiles: 3, settled: true });
  assert.equal(m.tone, 'ok');
  assert.match(m.text, /Replaced everything with 3 profiles\./);
});

test('a DEFERRED replacement is never reported as a failure', () => {
  // The heart of it. Past the commit the data is in, so "failed" would invite the retry that could
  // destroy the recovery point.
  const m = outcomeMessage({ via: 'replace', profiles: 2, settled: false });
  assert.equal(m.tone, 'ok', 'a committed replacement must never be toned as a failure');
  assert.match(m.text, /Replaced everything with 2 profiles/);
  assert.match(m.text, /Reopen the app/, 'and it must name the one action that finishes it');
});

test('a deferred IMPORT is likewise a caveat, with its own wording', () => {
  const m = outcomeMessage({ via: 'profile-import', profiles: 1, activeReconciled: false });
  assert.equal(m.tone, 'ok');
  assert.match(m.text, /Restored 1 profile\. Reopen the app to finish switching\./);
});

test('singular and plural are both correct - the count is user-facing', () => {
  assert.match(outcomeMessage({ via: 'replace', profiles: 1, settled: true }).text, /1 profile\./);
  assert.match(outcomeMessage({ via: 'replace', profiles: 2, settled: true }).text, /2 profiles\./);
});

test('a missing settled flag is treated as settled, not as a false alarm', () => {
  // Absence means an executor that does not report it, not a failure. Warning "reopen the app" for
  // every successful restore would train the user to ignore the one that matters.
  assert.doesNotMatch(outcomeMessage({ via: 'replace', profiles: 1 }).text, /Reopen/);
});

test('only a thrown refusal is a failure, and it is toned as one', () => {
  const m = failureMessage(new Error('A previous restore has not finished.'));
  assert.equal(m.tone, 'danger');
  assert.match(m.text, /Restore failed: A previous restore has not finished\./);
});
