// Why the import boundary is NOT wired into importProfile yet.
//
// It was, for one commit, and it was a live data-corruption path rather than a dormant feature.
// These tests pin the reason so reconnecting it cannot happen by accident: the counterfactual
// below must go green BEFORE prepareBundle returns to profileTransfer.
//
// The rule this encodes: canonical rows may not exist while any ACTIVE writer computes its new
// value from a card-level total and writes the result to a legacy key.
// Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { importProfile } from './profileTransfer.js';
import { stepWanted, setWanted, qtyFor } from './ownedRepository.js';
import { LEGACY_UNCATEGORISED, isLegacyPrinting } from './printings.js';

const require = createRequire(import.meta.url);
const PID = 'home-profile';
let sdb;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; } finally { st.free(); }
};

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  __setBackendForTests({
    query: (s, p = []) => Promise.resolve(rows(s, p)),
    run: (s, p = []) => { sdb.run(s, p); return Promise.resolve(); },
    exec: (s) => { sdb.run(s); return Promise.resolve(); },
    tx: (st) => { sdb.run('BEGIN;'); try { for (const [s, p = []] of st) sdb.run(s, p); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
    persist: () => Promise.resolve(),
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);
  __setActiveIdForTests(PID);
});

beforeEach(() => {
  sdb.run('DELETE FROM owned_cards; DELETE FROM profiles; DELETE FROM cards;');
  sdb.run('INSERT INTO profiles(id,name,schema_version,created_at) VALUES(?,?,?,?);', [PID, 'Home', 10, '2026-01-01']);
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('c1','Single','[{\"code\":\"004\"}]');");
});

const seedCanonical = (slug, wanted) =>
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?,?);',
    [`seed-${slug}`, PID, 'c1', slug, wanted, '', '2026-01-01', '2026-01-01']);

/* ---------------- THE COUNTERFACTUAL ---------------- */
//
// This is the gate on reconnecting the boundary. While it fails, normalisation must stay out of
// the production path; when it passes, the active writers have been switched and it may return.

test('CHARACTERIZATION: the current heart inflates a canonical want - exactly, not conditionally', async () => {
  // This asserts the BROKEN state unconditionally, on purpose.
  //
  // My first version branched on the outcome and passed either way, which meant it could never
  // fail and therefore proved nothing about activation readiness. A test that accepts both the
  // defect and its fix is not a gate; it is a comment that costs CPU.
  //
  // At activation this test is DELETED and replaced by the contract below it.
  seedCanonical('004', 2);
  assert.equal((await qtyFor('c1')).wanted, 2);

  await stepWanted('c1', +1);

  assert.equal((await qtyFor('c1')).wanted, 5,
    'one tap adds three: the writer reads the total, adds one, and orphans the canonical row');
  assert.deepEqual(rows('SELECT variant_slug, qty_wanted FROM owned_cards ORDER BY variant_slug;'), [
    { variant_slug: LEGACY_UNCATEGORISED, qty_wanted: 3 },
    { variant_slug: '004', qty_wanted: 2 },
  ], 'two rows for one want - this is why the import boundary stays disconnected');
});

test('ACTIVATION CONTRACT: written now, skipped now, unconditional later', { skip: 'activation' }, async () => {
  // The unconditional end-to-end contract activation must satisfy. Written here so it is not
  // invented later under pressure: remove the skip, delete the characterization test above,
  // and reconnect prepareBundle only when this passes.
  seedCanonical('004', 2);
  await stepWanted('c1', +1);
  assert.equal((await qtyFor('c1')).wanted, 3, 'a tap adds exactly one');
  const stored = rows('SELECT variant_slug, qty_wanted FROM owned_cards;');
  assert.equal(stored.length, 1, 'exactly one row');
  assert.deepEqual(stored[0], { variant_slug: '004', qty_wanted: 3 });
  assert.equal(stored.some((r) => isLegacyPrinting(r.variant_slug)), false);
});

test('GATE: setWanted has the same problem, so it is not specific to stepping', async () => {
  seedCanonical('004', 2);
  await setWanted('c1', 4);
  const stored = rows('SELECT variant_slug, qty_wanted FROM owned_cards ORDER BY variant_slug;');
  assert.equal(stored.length, 2, 'the canonical row is orphaned rather than updated');
});

/* ---------------- the boundary really is disconnected ---------------- */

test('importProfile does NOT normalise today - legacy keys pass straight through', async () => {
  const pid = await importProfile({
    app: 'compendium', schemaVersion: 10, profile: { name: 'Imported', accent: 'gold' },
    owned_cards: [{ card_id: 'c1', variant_slug: LEGACY_UNCATEGORISED, qty_owned: 1, qty_wanted: 2, notes: '', created_at: 'x', updated_at: 'x' }],
  });
  const stored = rows('SELECT variant_slug FROM owned_cards WHERE profile_id=?;', [pid]);
  assert.deepEqual(stored, [{ variant_slug: LEGACY_UNCATEGORISED }],
    'the row stays legacy, so the active writers can still edit it correctly');
});

test('a future bundle is still accepted today - the version gate arrives with reconnection', async () => {
  // Recorded rather than asserted as desirable. Rejecting it needs the boundary, and the
  // boundary needs canonical writers. Stating the gap keeps it from being forgotten.
  const pid = await importProfile({
    app: 'compendium', schemaVersion: 99, profile: { name: 'Future', accent: 'gold' }, owned_cards: [],
  });
  assert.ok(pid, 'no version gate is active on the production path yet');
});

test('a non-Compendium file is still rejected', async () => {
  await assert.rejects(importProfile({ app: 'something-else' }), /not a compendium/i);
  assert.equal(rows('SELECT COUNT(*) n FROM profiles;')[0].n, 1, 'only the home profile exists');
});
