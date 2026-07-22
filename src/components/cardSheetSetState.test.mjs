// The distinction the heart depends on. Run: npm run test:ui
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialSetState, cardSheetSetReducer as r, explicitSetOf, displaySetOf,
} from './cardSheetSetState.js';

const run = (s, ...as) => as.reduce(r, s);

test('an automatic default shows a set but establishes NO intent', () => {
  // The exact failure: ownership loads, the effect picks Alpha, and the heart treated that as
  // the user having chosen Alpha.
  const s = run(initialSetState(), { type: 'default', set: '001' });
  assert.equal(displaySetOf(s), '001', 'the sheet has something to render');
  assert.equal(explicitSetOf(s), null, 'but the user has not chosen anything');
});

test('a segment tap establishes intent', () => {
  const s = run(initialSetState(), { type: 'default', set: '001' }, { type: 'select', set: '002' });
  assert.equal(displaySetOf(s), '002');
  assert.equal(explicitSetOf(s), '002');
});

test('opening the sheet AT a set is explicit - the caller already said which', () => {
  const s = initialSetState('002');
  assert.equal(explicitSetOf(s), '002');
  assert.equal(displaySetOf(s), '002');
});

test('the default never overrides a set the sheet was opened at', () => {
  const s = run(initialSetState('002'), { type: 'default', set: '001' });
  assert.equal(displaySetOf(s), '002');
  assert.equal(explicitSetOf(s), '002');
});

test('the default never overrides a user selection', () => {
  const s = run(initialSetState(), { type: 'select', set: '002' }, { type: 'default', set: '001' });
  assert.equal(displaySetOf(s), '002');
  assert.equal(explicitSetOf(s), '002');
});

test('the default applies once, not on every ownership refresh', () => {
  const s = run(initialSetState(), { type: 'default', set: '001' }, { type: 'default', set: '002' });
  assert.equal(displaySetOf(s), '001', 'a later refresh must not snap the selection mid-edit');
});

test('a default of null leaves both empty, so a reprint still asks', () => {
  const s = run(initialSetState(), { type: 'default', set: null });
  assert.equal(explicitSetOf(s), null);
  assert.equal(displaySetOf(s, 'fallback'), 'fallback');
});
