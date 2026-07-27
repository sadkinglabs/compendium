import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScannerRegistry } from './scannerBridgeRegistry.js';

test('accepts a new request', () => {
  const r = createScannerRegistry();
  assert.equal(r.admit('r1').action, 'accept');
  assert.deepEqual(r.stats(), { pending: 1, resolved: 0, mutationInFlight: false });
});

test('ignores a duplicate while pending (a response is already coming)', () => {
  const r = createScannerRegistry();
  r.admit('r1');
  assert.equal(r.admit('r1').action, 'ignore');
});

test('replays the original ack for a resolved duplicate, never re-committing', () => {
  const r = createScannerRegistry();
  r.admit('r1', true);
  const ack = { status: 'committed', counts: { cardOwnedCount: 3 } };
  r.resolve('r1', ack);
  const again = r.admit('r1', true);
  assert.equal(again.action, 'replay');
  assert.deepEqual(again.ack, ack);           // same authoritative ack, no second commit
  assert.equal(r.stats().mutationInFlight, false);
});

test('allows only one mutation in flight; reads may run alongside', () => {
  const r = createScannerRegistry();
  assert.equal(r.admit('m1', true).action, 'accept');
  assert.deepEqual(r.admit('m2', true), { action: 'reject', reason: 'mutation-in-flight' });
  assert.equal(r.admit('read1', false).action, 'accept');
  assert.equal(r.stats().mutationInFlight, true);
});

test('a new mutation is allowed after the previous one resolves', () => {
  const r = createScannerRegistry();
  r.admit('m1', true);
  r.resolve('m1', { status: 'committed' });
  assert.equal(r.stats().mutationInFlight, false);
  assert.equal(r.admit('m2', true).action, 'accept');
});

test('resolving a non-pending request is a no-op (double-resolve safe)', () => {
  const r = createScannerRegistry();
  r.resolve('ghost', { status: 'committed' });
  assert.deepEqual(r.stats(), { pending: 0, resolved: 0, mutationInFlight: false });
});

test('a reused id with a different fingerprint is rejected as a collision, not replayed', () => {
  const r = createScannerRegistry();
  r.admit('r1', true, 'own:c1:Alpha:foil:1');
  r.resolve('r1', { status: 'committed' });
  // Same id, SAME operation -> safe replay.
  assert.equal(r.admit('r1', true, 'own:c1:Alpha:foil:1').action, 'replay');
  // Same id, DIFFERENT operation -> collision, must not replay the old ack.
  assert.deepEqual(r.admit('r1', true, 'own:c2:Beta:std:3'), { action: 'reject', reason: 'id-reuse-collision' });
});

test('clear forgets everything and frees the mutation slot', () => {
  const r = createScannerRegistry();
  r.admit('m1', true);
  r.clear();
  assert.deepEqual(r.stats(), { pending: 0, resolved: 0, mutationInFlight: false });
  // after teardown a fresh id is accepted again (no stale replay/ignore)
  assert.equal(r.admit('m1', true).action, 'accept');
});
