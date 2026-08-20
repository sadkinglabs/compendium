// The message an optimistic ownership step shows when it does not land.
//
// This exists because a device pass found the app reporting a REFUSAL as a malfunction. Tapping
// minus on a card whose copies are all filed said "Couldn't save; count restored" - which is what
// it says for a disk error. The write was refused on purpose: the app declined to guess which
// physical copy left. Reporting the model working as a bug teaches the user to distrust a wall
// that is protecting their filing.
//
// So these tests are mostly about the DISTINCTION rather than the wording.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepFailureMessage } from './ownedStepMessage.js';

const conflict = (filed) => {
  const e = new Error('refused');
  e.name = 'StorageConflict';
  e.detail = { requested: 1, unfiled: 0, filed };
  return e;
};

test('a plain write failure still says the count was restored', () => {
  const m = stepFailureMessage('save-failed', new Error('disk full'));
  assert.match(m.text, /Couldn't save; count restored/);
  assert.equal(m.tone, 'danger');
});

test('a REFUSAL says the copies are filed, not that saving failed', () => {
  const m = stepFailureMessage('save-failed', conflict([{ container_id: 'b1', qty: 3 }]));
  assert.doesNotMatch(m.text, /Couldn't save/, 'nothing malfunctioned, so do not say it did');
  assert.match(m.text, /3 copies are filed away/);
  assert.match(m.text, /return them to Unfiled to lower this/, 'it must say what to do about it');
});

test('a resolved place phrase names WHERE the copies are filed (the wall no longer just says away)', () => {
  const m = stepFailureMessage('save-failed', conflict([{ container_id: 'b1', qty: 2 }, { container_id: 'b2', qty: 1 }]), 'Beta binder (2), Bulk box (1)');
  assert.match(m.text, /3 copies are filed in Beta binder \(2\), Bulk box \(1\)/, 'names the places');
  assert.match(m.text, /return them to Unfiled to lower this/);
  assert.equal(m.tone, 'danger');
});

test('one filed copy reads as one copy', () => {
  const m = stepFailureMessage('save-failed', conflict([{ container_id: 'b1', qty: 1 }]));
  assert.match(m.text, /1 copy is filed away/);
});

test('the count comes from the CONFLICT, summed across every container holding copies', () => {
  // Not from anything the UI tracks, so the number can never disagree with the reason the write
  // was refused.
  const m = stepFailureMessage('save-failed', conflict([
    { container_id: 'b1', qty: 2 }, { container_id: 'b2', qty: 4 },
  ]));
  assert.match(m.text, /6 copies are filed away/);
});

test('a conflict that names no container still explains itself', () => {
  const m = stepFailureMessage('save-failed', conflict([]));
  assert.match(m.text, /filed away/);
});

test('unresolved keeps its "reopen to confirm", conflict or not', () => {
  // The two axes are independent: WHY the write did not land, and whether we could read back.
  assert.match(stepFailureMessage('save-failed-unresolved', new Error('x')).text, /couldn't check - reopen to confirm/);
  const c = stepFailureMessage('save-failed-unresolved', conflict([{ container_id: 'b1', qty: 2 }]));
  assert.match(c.text, /2 copies are filed away/);
  assert.match(c.text, /reopen to confirm/);
});

test('a successful-but-unconfirmed write is never described as a refusal', () => {
  // The write LANDED here. Even if a conflict object were somehow passed, the reason wins.
  const m = stepFailureMessage('unconfirmed', conflict([{ container_id: 'b1', qty: 2 }]));
  assert.match(m.text, /Saved, but couldn't refresh/);
  assert.doesNotMatch(m.text, /filed away/);
});
