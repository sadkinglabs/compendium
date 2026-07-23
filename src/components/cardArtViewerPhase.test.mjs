import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewerTransition as r, initialViewerState as init } from './cardArtViewerPhase.js';

const run = (state, ...events) => events.reduce(r, state);
const at = (phase, startTransform = null) => ({ phase, startTransform });

test('CLOSE from preparing, entering, or open always reaches exiting', () => {
  assert.equal(run(at('preparing'), { type: 'CLOSE' }).phase, 'exiting');
  assert.equal(run(at('entering'), { type: 'CLOSE' }).phase, 'exiting');
  assert.equal(run(at('open'), { type: 'CLOSE' }).phase, 'exiting');
});

test('a late PREPARED cannot reopen an exiting viewer (the reopening race)', () => {
  const s = run(at('open'), { type: 'CLOSE' }, { type: 'PREPARED', transform: 'scale(.94)' });
  assert.equal(s.phase, 'exiting', 'PREPARED is ignored unless phase is preparing');
});

test('a late ENTERED cannot reopen an exiting viewer', () => {
  const s = run(at('exiting'), { type: 'ENTERED' });
  assert.equal(s.phase, 'exiting');
});

test('repeated CLOSE is idempotent', () => {
  const s = run(at('open'), { type: 'CLOSE' }, { type: 'CLOSE' }, { type: 'CLOSE' });
  assert.equal(s.phase, 'exiting');
});

test('EXITED is accepted only from exiting', () => {
  assert.equal(run(at('exiting'), { type: 'EXITED' }).phase, 'closed');
  assert.equal(run(at('entering'), { type: 'EXITED' }).phase, 'entering', 'ignored off the exit path');
  assert.equal(run(at('open'), { type: 'EXITED' }).phase, 'open');
});

test('ENTERED is accepted only from entering', () => {
  assert.equal(run(at('entering'), { type: 'ENTERED' }).phase, 'open');
  assert.equal(run(at('preparing'), { type: 'ENTERED' }).phase, 'preparing');
});

test('PREPARED is accepted only from preparing, and snapshots the start transform', () => {
  const s = run(at('preparing'), { type: 'PREPARED', transform: 'translate(1px,2px) scale(.3)' });
  assert.equal(s.phase, 'entering');
  assert.equal(s.startTransform, 'translate(1px,2px) scale(.3)');
  assert.equal(run(at('open'), { type: 'PREPARED', transform: 'x' }).phase, 'open', 'ignored once past preparing');
});

test('origin and no-origin paths follow the SAME phases (transform may be null)', () => {
  const withOrigin = run(init(false), { type: 'PREPARED', transform: 'translate(...)' }, { type: 'ENTERED' });
  const noOrigin = run(init(false), { type: 'PREPARED', transform: null }, { type: 'ENTERED' });
  assert.equal(withOrigin.phase, 'open');
  assert.equal(noOrigin.phase, 'open');
  assert.equal(noOrigin.startTransform, null);
});

test('a full lifecycle is monotonic: preparing -> entering -> open -> exiting -> closed', () => {
  let s = init(false);
  assert.equal(s.phase, 'preparing');
  s = r(s, { type: 'PREPARED', transform: 's' }); assert.equal(s.phase, 'entering');
  s = r(s, { type: 'ENTERED' }); assert.equal(s.phase, 'open');
  s = r(s, { type: 'CLOSE' }); assert.equal(s.phase, 'exiting');
  s = r(s, { type: 'EXITED' }); assert.equal(s.phase, 'closed');
});

test('reduced motion starts OPEN (bypasses the entrance)', () => {
  assert.equal(init(true).phase, 'open');
  assert.equal(init(false).phase, 'preparing');
});

test('an unknown event is a no-op', () => {
  assert.deepEqual(r(at('open'), { type: 'WAT' }), at('open'));
});
