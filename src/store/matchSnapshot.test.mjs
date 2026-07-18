// Fixtures for the ongoing-match serialized contract (src/store/matchSnapshot.js).
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchSnapshot, readMatchSnapshot, isValidMatchSnapshot, SNAP_VERSION } from './matchSnapshot.js';

// A fully-normalized resumable state (what read() returns and build() consumes).
const normalized = {
  mode: 'full',
  settings: { default_max_life: 20, die_type: 6 },
  you: { card_id: 'av1', name: 'A' },
  opp: { card_id: 'av2', name: 'B' },
  deck: { id: 'd1', name: 'Deck' },
  p: { life: 17, max: 20 },
  e: { life: 20, max: 20 },
  log: [{ who: 'player', delta: -3, to: 17 }],
  elapsedSec: 125,
  oppName: 'Rival',
  recorded: true,
  clockOn: true,
};

test('round-trip: read(build(normalizedState)) deep-equals the normalized state', () => {
  assert.deepEqual(readMatchSnapshot(buildMatchSnapshot(normalized)), normalized);
});

test('round-trip holds for the defaulted edges (empty log, nulls, explicit false)', () => {
  const s = {
    mode: 'quick', settings: {}, you: null, opp: null, deck: null,
    p: { life: 20, max: 20 }, e: { life: 20, max: 20 },
    log: [], elapsedSec: 0, oppName: '', recorded: false, clockOn: false,
  };
  assert.deepEqual(readMatchSnapshot(buildMatchSnapshot(s)), s);
});

test('build serializes normalized sides to the flat on-disk fields + version', () => {
  const snap = buildMatchSnapshot(normalized);
  assert.equal(snap.v, SNAP_VERSION);
  assert.deepEqual(
    { pLife: snap.pLife, pMax: snap.pMax, eLife: snap.eLife, eMax: snap.eMax },
    { pLife: 17, pMax: 20, eLife: 20, eMax: 20 },
  );
});

// --- raw v1 compatibility: snapshots exactly as the current implementation writes them ---

test('a raw v1 snapshot with an omitted optional field reads with the default', () => {
  const raw = { v: 1, mode: 'full', settings: {}, you: null, opp: null, deck: null, pLife: 20, pMax: 20, eLife: 20, eMax: 20 };
  const r = readMatchSnapshot(raw);
  assert.deepEqual(r.log, []);
  assert.equal(r.elapsedSec, 0);
  assert.equal(r.oppName, '');
  assert.equal(r.recorded, false);
  assert.equal(r.clockOn, false);
});

test('explicit false for clockOn and recorded is preserved (not re-defaulted)', () => {
  const raw = { v: 1, mode: 'full', settings: {}, pLife: 20, pMax: 20, eLife: 20, eMax: 20, clockOn: false, recorded: false };
  const r = readMatchSnapshot(raw);
  assert.equal(r.clockOn, false, 'clockOn ?? false keeps a stored false');
  assert.equal(r.recorded, false);
});

test('identity + settings objects pass through unchanged; deck null stays null', () => {
  const you = { card_id: 'x', name: 'X' };
  const settings = { default_max_life: 15 };
  const raw = { v: 1, mode: 'full', settings, you, opp: null, deck: null, pLife: 5, pMax: 15, eLife: 15, eMax: 15 };
  const r = readMatchSnapshot(raw);
  assert.equal(r.you, you);           // same reference, no flatten
  assert.equal(r.settings, settings);
  assert.equal(r.deck, null);
});

test('finite-but-out-of-range life is returned RAW (restoreSide clamps later, not this module)', () => {
  const raw = { v: 1, mode: 'full', settings: {}, pLife: 999, pMax: 999, eLife: 20, eMax: 20 };
  const r = readMatchSnapshot(raw);
  assert.deepEqual(r.p, { life: 999, max: 999 }, 'unclamped here');
});

test('isValidMatchSnapshot: version + finite life/max; range not checked', () => {
  assert.equal(isValidMatchSnapshot({ v: 1, pLife: 20, pMax: 20, eLife: 20, eMax: 20 }), true);
  assert.equal(isValidMatchSnapshot({ v: 1, pLife: 999, pMax: 999, eLife: 20, eMax: 20 }), true, 'out-of-range but finite is valid (clamped on restore)');
  assert.equal(isValidMatchSnapshot({ v: 2, pLife: 20, pMax: 20, eLife: 20, eMax: 20 }), false, 'wrong version');
  assert.equal(isValidMatchSnapshot({ v: 1, pLife: NaN, pMax: 20, eLife: 20, eMax: 20 }), false, 'non-finite');
  assert.equal(isValidMatchSnapshot(null), false);
});
