// Fixtures for the goal drain lifecycle (src/pillars/collectionGoalDrain.js). Run: npm run test:ui
// The load-bearing case is the Stage C race Codex flagged: a slow reconcile must NOT
// overwrite a newer optimistic edit. Forced deterministically with deferred promises.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoalDrain } from './collectionGoalDrain.js';

function defer() { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; }
const tick = () => new Promise((r) => setTimeout(r, 0));

test('reconciles the authoritative snapshot once writes drain with nothing newer pending', async () => {
  let applied = null;
  const drain = createGoalDrain({ read: async () => 'AUTH', apply: (s) => { applied = s; } });
  const w = defer();
  drain.track(w.p);
  w.resolve();
  await tick(); await tick();
  assert.equal(applied, 'AUTH');
});

test('a slow reconcile does NOT overwrite a newer optimistic edit (the Stage C race)', async () => {
  let applied = null;
  const reads = [];
  const gate = defer();                 // pauses reconcile A's read
  const drain = createGoalDrain({
    read: async () => { reads.push('read'); await gate.p; return 'SNAP'; },
    apply: (s) => { applied = s; },
  });
  // Write A drains -> reconcile A begins and pauses on the gate.
  const wA = defer(); drain.track(wA.p); wA.resolve();
  await tick();
  assert.deepEqual(reads, ['read'], 'reconcile A started and is awaiting the read');
  assert.equal(drain.pending(), 0);
  // Write B begins (a fresh optimistic tap) while reconcile A is still paused.
  const wB = defer(); drain.track(wB.p);
  assert.equal(drain.pending(), 1);
  // Reconcile A's read now resolves - it MUST bail (a newer write began).
  gate.resolve();
  await tick(); await tick();
  assert.equal(applied, null, 'stale snapshot discarded; the optimistic edit stands');
  // Write B drains -> reconcile B applies authoritatively (nothing newer).
  wB.resolve();
  await tick(); await tick();
  assert.equal(applied, 'SNAP', 'once B settles, the authoritative snapshot applies');
});

test('a cancelled drain (list change / unmount) does not apply a late reconcile', async () => {
  let applied = null;
  let cancelled = false;
  const gate = defer();
  const drain = createGoalDrain({
    read: async () => { await gate.p; return 'SNAP'; },
    apply: (s) => { applied = s; },
    isAlive: () => !cancelled,
  });
  const w = defer(); drain.track(w.p); w.resolve();
  await tick();
  cancelled = true;      // list changed / component unmounted while the read was in flight
  gate.resolve();
  await tick(); await tick();
  assert.equal(applied, null, 'a late reconcile after cancel is dropped');
});
