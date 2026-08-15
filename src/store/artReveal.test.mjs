// ArtImg reveal contract (Codex review, docs/proposals/decks-swap-artifacts.md).
// Run: npm run test:query
// Pins the properties whose absence WAS the shipped defect: a warm key must not
// grant pre-load visibility or an instant reveal, and a stale settle timer must
// not settle a replacement identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialReveal, revealReduce, revealPresentation,
  REVEAL_COLD_MS, REVEAL_WARM_MS, SETTLE_AFTER_MS,
} from './artReveal.js';

const ID1 = '0|file:///a.jpg';
const ID2 = '1|file:///a.jpg';   // gen bump: error retry / quarantine re-resolve

test('every new identity begins hidden - warm history grants nothing pre-load', () => {
  const p = revealPresentation(initialReveal, ID1);
  assert.equal(p.revealed, false);
  assert.equal(p.style.opacity, 0);
  // Warmth is only consulted AT load time (the component passes it on LOADED);
  // there is no state in which an unloaded identity renders visible.
  const other = revealReduce(initialReveal, { type: 'LOADED', id: ID2, warm: true });
  assert.equal(revealPresentation(other, ID1).revealed, false);
});

test('only the element\'s own load reveals it, and warm shortens - never skips - the fade', () => {
  const cold = revealReduce(initialReveal, { type: 'LOADED', id: ID1, warm: false });
  const pc = revealPresentation(cold, ID1);
  assert.equal(pc.revealed, true);
  assert.equal(pc.className, 'cx-art-reveal');            // fading, not instant
  const warm = revealReduce(initialReveal, { type: 'LOADED', id: ID1, warm: true });
  const pw = revealPresentation(warm, ID1);
  assert.equal(pw.revealed, true);
  assert.match(pw.className, /cx-art-reveal-warm/);       // shorter fade
  assert.match(pw.className, /cx-art-reveal(\s|$)/);      // still a fade
});

test('an error retry (gen bump) is a new identity and starts hidden again', () => {
  const shown = revealReduce(initialReveal, { type: 'LOADED', id: ID1, warm: true });
  assert.equal(revealPresentation(shown, ID2).revealed, false);   // replacement hidden until ITS load
});

test('settle drops the classes for the same identity only - a stale timer is inert', () => {
  let st = revealReduce(initialReveal, { type: 'LOADED', id: ID1, warm: false });
  // Identity moves on (retry), then the OLD timer fires:
  st = revealReduce(st, { type: 'LOADED', id: ID2, warm: false });
  const afterStale = revealReduce(st, { type: 'SETTLED', id: ID1 });
  assert.deepEqual(afterStale, st);                        // ignored
  const settled = revealReduce(st, { type: 'SETTLED', id: ID2 });
  assert.equal(settled.at, 'settled');
  const ps = revealPresentation(settled, ID2);
  assert.equal(ps.revealed, true);
  assert.equal(ps.className, '');                          // inline/class control released
  assert.equal(ps.style, null);
});

test('the settle delay outlasts both fades', () => {
  assert.ok(SETTLE_AFTER_MS > REVEAL_COLD_MS);
  assert.ok(SETTLE_AFTER_MS > REVEAL_WARM_MS);
  assert.ok(REVEAL_WARM_MS < REVEAL_COLD_MS);
});
