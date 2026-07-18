// Fixtures for the hardware-back consumer registry (src/back.js).
// Run: npm run test:app   (node --test)
//
// Proves contract item (a): registered consumers run FIRST (this is the whole registry) and in
// LIFO order (most-recently-opened peels first), stopping at the first that HANDLES the event
// (returns true). This is the half App consults before the navBack fallback order.
//
// back.js holds a module-level `consumers` array, so every test unregisters what it registers
// (via the returned closure) to stay isolated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerBackConsumer, runBackConsumers } from './back.js';

test('(a) consumers run LIFO - most recently registered first', () => {
  const calls = [];
  const offA = registerBackConsumer(() => { calls.push('A'); return false; });
  const offB = registerBackConsumer(() => { calls.push('B'); return false; });
  const offC = registerBackConsumer(() => { calls.push('C'); return false; });
  const handled = runBackConsumers();
  offA(); offB(); offC();
  assert.deepEqual(calls, ['C', 'B', 'A']);   // reverse of registration
  assert.equal(handled, false);               // none returned true
});

test('runBackConsumers stops at the first consumer that returns true', () => {
  const calls = [];
  const offA = registerBackConsumer(() => { calls.push('A'); return true; });
  const offB = registerBackConsumer(() => { calls.push('B'); return false; });
  const offC = registerBackConsumer(() => { calls.push('C'); return true; });   // top of stack, handles
  const handled = runBackConsumers();
  offA(); offB(); offC();
  assert.equal(handled, true);
  assert.deepEqual(calls, ['C']);   // C handled it; B and A never run
});

test('a non-true return (undefined) is treated as "did not handle" and falls through', () => {
  const calls = [];
  const offTop = registerBackConsumer(() => { calls.push('top'); /* returns undefined */ });
  const offBottom = registerBackConsumer(() => { calls.push('bottom'); return true; });
  // bottom registered last -> runs first, handles.
  const handled = runBackConsumers();
  offTop(); offBottom();
  assert.equal(handled, true);
  assert.deepEqual(calls, ['bottom']);
});

test('an empty registry returns false (App proceeds to the fallback order)', () => {
  assert.equal(runBackConsumers(), false);
});

test('the unregister closure removes exactly its own consumer', () => {
  const calls = [];
  const offA = registerBackConsumer(() => { calls.push('A'); return false; });
  const offB = registerBackConsumer(() => { calls.push('B'); return false; });
  offB();                       // remove only B
  runBackConsumers();
  offA();                       // cleanup
  assert.deepEqual(calls, ['A']);   // B was removed; A still ran
});

test('unregistering the same consumer twice is harmless (no double-remove of a neighbour)', () => {
  const calls = [];
  const offA = registerBackConsumer(() => { calls.push('A'); return false; });
  const offB = registerBackConsumer(() => { calls.push('B'); return false; });
  offA(); offA();               // second call is a no-op (A already gone)
  runBackConsumers();
  offB();                       // cleanup
  assert.deepEqual(calls, ['B']);   // A removed once; B intact
});
