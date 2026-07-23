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
