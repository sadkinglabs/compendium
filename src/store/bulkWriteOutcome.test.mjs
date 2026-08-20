import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bulkWriteFailure } from './bulkWriteOutcome.js';

const bulkErr = (writeState) => Object.assign(new Error('x'), { name: 'BulkWriteError', writeState });

const DEFINITE = "Couldn't update those cards.";
const CONFIRM = "Couldn't confirm the update - check the refreshed counts before trying again.";

test('an INDETERMINATE write (unknown) is never a definite failure or success', () => {
  const o = bulkWriteFailure(bulkErr('unknown'));
  assert.equal(o.indeterminate, true);
  assert.equal(o.copy, CONFIRM);
  assert.notEqual(o.copy, DEFINITE);
  assert.equal(o.keepSelection, false, 'no retry invitation');
  assert.equal(o.tone, 'warn');
});

test('a prewrite/none failure is a definite, retry-safe failure', () => {
  const o = bulkWriteFailure(bulkErr('none'));
  assert.equal(o.indeterminate, false);
  assert.equal(o.copy, DEFINITE);
  assert.equal(o.keepSelection, true);
  assert.equal(o.tone, 'danger');
});

test('a non-bulk error is treated as a definite failure', () => {
  for (const e of [new Error('boom'), null, undefined, { name: 'TypeError' }]) {
    const o = bulkWriteFailure(e);
    assert.equal(o.indeterminate, false);
    assert.equal(o.copy, DEFINITE);
  }
});

test('PROPERTY: only writeState "unknown" is ever indeterminate', () => {
  for (const ws of ['none', 'unknown', 'confirmed', undefined, null, 'weird']) {
    const o = bulkWriteFailure(bulkErr(ws));
    assert.equal(o.indeterminate, ws === 'unknown');
    // and an indeterminate outcome can NEVER carry the definite-failure copy
    if (o.indeterminate) assert.notEqual(o.copy, DEFINITE);
  }
});

/* ---------------- a REFUSED write is not a FAILED one ---------------- */

const refusal = (n) => Object.assign(bulkErr('none'), {
  storageConflict: { items: Array.from({ length: n }, (_, i) => ({ cardId: `c${i}`, target: 0, filed: [{ container_id: 'b1', qty: 2 }] })) },
});

test('a storage refusal says what is in the way, not that the app failed', () => {
  const o = bulkWriteFailure(refusal(3));
  assert.equal(o.filed, 3);
  assert.notEqual(o.copy, DEFINITE, 'the wall is the model working, not a malfunction');
  assert.match(o.copy, /3 printings have copies filed away/);
  assert.match(o.copy, /return them to Unfiled/, 'and it names the way out');
  assert.equal(o.keepSelection, true, 'nothing was written, so the selection is still actionable');
  assert.equal(o.tone, 'danger');
});

test('a single refused printing reads as one, not "1 printings"', () => {
  assert.match(bulkWriteFailure(refusal(1)).copy, /^1 printing has copies filed away/);
});

test('an INDETERMINATE write is never described as a refusal, whatever it carries', () => {
  // The safety-bearing rule outranks the nicer message: a write that may have landed must point at
  // the refreshed counts, never at a wall the user could try to walk around.
  const e = Object.assign(bulkErr('unknown'), { storageConflict: { items: [{ cardId: 'c0' }] } });
  const o = bulkWriteFailure(e);
  assert.equal(o.filed, 0);
  assert.equal(o.copy, CONFIRM);
  assert.equal(o.keepSelection, false);
});
