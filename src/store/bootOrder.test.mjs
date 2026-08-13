// Boot order, asserted against App.jsx itself.
//
// Canonicalisation's POSITION is load-bearing in both directions and neither constraint is
// visible from the function itself:
//
//   - it needs the catalog to decide where an ambiguous legacy want belongs, so it cannot run
//     before seedCatalogIfNeeded() - and it cannot be a schema migration, because those run
//     inside openDatabase() before any catalog exists;
//   - it must convert EVERY profile, so it must run before initProfiles() makes one active.
//
// A refactor that reorders these lines would leave every unit test green and break the
// migration silently, which is exactly the class of failure this branch has produced twice.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/App.jsx', 'utf8');
const at = (needle) => {
  const i = src.indexOf(needle);
  assert.notEqual(i, -1, `boot step not found in App.jsx: ${needle}`);
  return i;
};

test('restore reconciliation is the FIRST thing after the database opens', () => {
  // Increment 5 (restore-semantics §3): the journal row must be read and acted on before
  // ANYTHING reads or writes a profile. The canonicalisation is the easy one to miss - it
  // converts every profile, so it is a profile-owned write - and initProfiles() makes one
  // active. Either running first against an unreconciled replacement silently resurrects the
  // pre-restore profile, and the symptom only appears one boot later.
  const rec = at('await reconcileRestore()');
  assert.ok(rec > at('await openDatabase()'), 'the journal row lives in the database, so the database opens first');
  assert.ok(rec < at('seedCatalogIfNeeded('), 'reconciliation precedes the catalog seed');
  assert.ok(rec < at('await initArtCache()'), 'reconciliation precedes the art cache');
  assert.ok(rec < at('await canonicaliseLedger()'), 'reconciliation precedes the ledger canonicalisation - a profile-owned write');
  assert.ok(rec < at('await initProfiles()'), 'reconciliation precedes initProfiles() making a profile active');
});

test('nothing else is awaited between openDatabase and reconciliation', () => {
  // "Immediately after openDatabase()" made structural: any await slipped in between is a
  // candidate profile touch, and this effect is exactly where one would be added in good faith.
  const between = src.slice(at('await openDatabase()'), at('await reconcileRestore()'));
  assert.equal((between.match(/await /g) || []).length, 1,
    'only the openDatabase await itself may precede reconciliation');
});

test('canonicalisation runs AFTER the catalog seed', () => {
  assert.ok(at('await canonicaliseLedger()') > at('seedCatalogIfNeeded('),
    'it reads the catalog to place ambiguous wants; before the seed it would decide against nothing');
});

test('canonicalisation runs BEFORE initProfiles', () => {
  assert.ok(at('await canonicaliseLedger()') < at('await initProfiles()'),
    'it converts every profile, so it cannot run once one is already active');
});

test('canonicalisation is NOT wrapped in a try/catch that swallows it', () => {
  // Every other boot gate is best-effort and must never cost a boot. This one is the opposite:
  // Collection must never render against a half-converted ledger, so a throw has to reach the
  // effect's own catch and put the app in its error state.
  const line = src.split('\n').find((l) => l.includes('await canonicaliseLedger()'));
  assert.ok(line, 'the call exists');
  assert.equal(/try\s*\{/.test(line), false, 'no inline try - a swallowed failure would expose a half-converted ledger');
  assert.equal(/catch/.test(line), false);
});

test('the obsolete single-set backfill is gone from boot', () => {
  // Canonicalisation converts the rows it used to look for, and retargeting it at the
  // uncategorised key would contradict the triage model.
  assert.equal(src.includes('backfillSingleSetOwned'), false);
});
