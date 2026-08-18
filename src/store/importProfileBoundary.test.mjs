// The import boundary, ACTIVE, plus the contract that gated its reconnection.
//
// It was disconnected for two checkpoints because normalisation wrote canonical keys while the
// active want writers still derived their new value from a card-level total: one heart tap on
// an imported want added three. These tests are what proved that, and what now proves it is
// fixed - the same scenarios, asserting the opposite outcomes.
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
let backend;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; } finally { st.free(); }
};

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  backend = {
    query: (s, p = []) => Promise.resolve(rows(s, p)),
    run: (s, p = []) => { sdb.run(s, p); return Promise.resolve(); },
    exec: (s) => { sdb.run(s); return Promise.resolve(); },
    tx: (st) => { sdb.run('BEGIN;'); try { for (const [s, p = []] of st) sdb.run(s, p); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
    persist: () => Promise.resolve(),
  };
  // Indirected so a test can swap tx() for a failing one and prove atomicity.
  __setBackendForTests({
    query: (...a) => backend.query(...a),
    run: (...a) => backend.run(...a),
    exec: (...a) => backend.exec(...a),
    tx: (...a) => backend.tx(...a),
    persist: (...a) => backend.persist(...a),
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);
  __setActiveIdForTests(PID);
});

beforeEach(() => {
  sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards; DELETE FROM profiles; DELETE FROM cards;');
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

test('ACTIVATION CONTRACT: an imported canonical want takes exactly one tap to reach 3', async () => {
  // ENABLED. This is the contract the whole disconnection existed to protect: before
  // activation the same sequence produced 5 across two rows, because the writer summed every
  // row and wrote the total somewhere else.
  seedCanonical('004', 2);
  await stepWanted('c1', +1);
  assert.equal((await qtyFor('c1')).wanted, 3, 'a tap adds exactly one');
  const stored = rows('SELECT variant_slug, qty_wanted FROM owned_cards;');
  assert.equal(stored.length, 1, 'exactly one row');
  assert.deepEqual(stored[0], { variant_slug: '004', qty_wanted: 3 });
  assert.equal(stored.some((r) => isLegacyPrinting(r.variant_slug)), false);
});

test('setWanted updates the canonical row in place rather than orphaning it', async () => {
  // Before activation this produced two rows: the original plus a legacy one holding the new
  // value. The card-level gesture now resolves to the collector item that already carries the
  // want, so the number the user is looking at is the number that changes.
  seedCanonical('004', 2);
  await setWanted('c1', 4);
  assert.deepEqual(rows('SELECT variant_slug, qty_wanted FROM owned_cards;'), [
    { variant_slug: '004', qty_wanted: 4 },
  ]);
});

test('a want on a REPRINT with no existing want asks rather than guessing', async () => {
  // The gesture cannot tell which printing is meant, and guessing is the original defect.
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('c2','Reprinted','[{\"code\":\"001\"},{\"code\":\"002\"}]');");
  await assert.rejects(() => stepWanted('c2', +1), (e) => {
    assert.equal(e.name, 'NeedsPrintingChoice');
    assert.deepEqual(e.options, ['001', '002'], 'it hands the caller the choices to offer');
    return true;
  });
  assert.equal(rows("SELECT COUNT(*) n FROM owned_cards WHERE card_id='c2';")[0].n, 0, 'nothing was written');
});

test('an UNCATEGORISED want is edited in place, not filed on the user behalf', async () => {
  // A migration leftover. Triage is what resolves it; a heart tap must not silently choose a
  // set for previously recorded data.
  seedCanonical('uncategorised', 2);
  await stepWanted('c1', +1);
  assert.deepEqual(rows('SELECT variant_slug, qty_wanted FROM owned_cards;'), [
    { variant_slug: 'uncategorised', qty_wanted: 3 },
  ]);
});

/* ---------------- the boundary really is disconnected ---------------- */

test('importProfile normalises a v10 bundle - no legacy key reaches the database', async () => {
  const pid = await importProfile({
    app: 'compendium', schemaVersion: 10, profile: { name: 'Imported', accent: 'gold' },
    owned_cards: [{ card_id: 'c1', variant_slug: LEGACY_UNCATEGORISED, qty_owned: 1, qty_wanted: 2, notes: '', created_at: 'x', updated_at: 'x' }],
  });
  const stored = rows('SELECT variant_slug, qty_owned, qty_wanted FROM owned_cards WHERE profile_id=? ORDER BY variant_slug;', [pid]);
  assert.equal(stored.some((r) => isLegacyPrinting(r.variant_slug)), false);
  // c1 is single-set (004), so the want is filed while the copies stay uncategorised.
  assert.deepEqual(stored, [
    { variant_slug: '004', qty_owned: 0, qty_wanted: 2 },
    { variant_slug: 'uncategorised', qty_owned: 1, qty_wanted: 0 },
  ]);
});

test('a FUTURE bundle is now rejected, and creates no profile', async () => {
  const before = rows('SELECT COUNT(*) n FROM profiles;')[0].n;
  await assert.rejects(importProfile({
    app: 'compendium', schemaVersion: 99, profile: { name: 'Future', accent: 'gold' }, owned_cards: [],
  }), (e) => e.name === 'ImportRejected' && e.code === 'future');
  assert.equal(rows('SELECT COUNT(*) n FROM profiles;')[0].n, before);
});

test('a non-Compendium file is still rejected', async () => {
  await assert.rejects(importProfile({ app: 'something-else' }), /not a compendium/i);
  assert.equal(rows('SELECT COUNT(*) n FROM profiles;')[0].n, 1, 'only the home profile exists');
});

/* ---------------- no orphan, proven by atomicity rather than by validation ---------------- */

test('a DATABASE failure mid-import leaves no profile behind', async () => {
  // The case validation can never cover: the bundle is perfectly well-formed and the failure
  // is a constraint, a full disk, or anything else that is not a property of the input.
  // Previously createProfile() ran first, outside any transaction, so this left a profile with
  // partial contents for the user to find and delete.
  const before = rows('SELECT COUNT(*) n FROM profiles;')[0].n;
  const realTx = backend.tx;
  backend.tx = () => Promise.reject(new Error('disk full'));
  try {
    await assert.rejects(importProfile({
      app: 'compendium', schemaVersion: 10, profile: { name: 'Doomed', accent: 'gold' },
      owned_cards: [{ card_id: 'c1', variant_slug: '', qty_owned: 1, qty_wanted: 0, notes: '', created_at: 'x', updated_at: 'x' }],
    }), /disk full/);
  } finally { backend.tx = realTx; }

  assert.equal(rows('SELECT COUNT(*) n FROM profiles;')[0].n, before, 'NO profile row survives');
  assert.equal(rows("SELECT COUNT(*) n FROM profiles WHERE name='Doomed';")[0].n, 0);
  assert.equal(rows('SELECT COUNT(*) n FROM settings;')[0].n, 0, 'and no orphaned settings row either');
});

test('a constraint violation partway through the rows rolls the profile back too', async () => {
  // A duplicate primary key deep in the insert list - the shape of failure a validator cannot
  // predict, because it depends on what is already in the database.
  const before = rows('SELECT COUNT(*) n FROM profiles;')[0].n;
  await assert.rejects(importProfile({
    app: 'compendium', schemaVersion: 10, profile: { name: 'Broken', accent: 'gold' },
    // Two card_lists sharing one id: the second INSERT violates the primary key.
    card_lists: [
      { id: 'dupe', kind: 'custom', name: 'A', description: '', sort_order: 0, created_at: 'x', updated_at: 'x' },
      { id: 'dupe', kind: 'custom', name: 'B', description: '', sort_order: 1, created_at: 'x', updated_at: 'x' },
    ],
  }));
  assert.equal(rows('SELECT COUNT(*) n FROM profiles;')[0].n, before, 'the profile went back with the rollback');
});

test('a successful import still creates exactly one profile with its settings', async () => {
  const pid = await importProfile({
    app: 'compendium', schemaVersion: 10, profile: { name: 'Good', accent: 'jade' },
    owned_cards: [{ card_id: 'c1', variant_slug: '', qty_owned: 2, qty_wanted: 0, notes: '', created_at: 'x', updated_at: 'x' }],
  });
  assert.equal(rows('SELECT COUNT(*) n FROM profiles WHERE id=?;', [pid])[0].n, 1);
  assert.equal(rows('SELECT COUNT(*) n FROM settings WHERE profile_id=?;', [pid])[0].n, 1, 'settings came with it');
  assert.equal(rows('SELECT accent FROM profiles WHERE id=?;', [pid])[0].accent, 'jade', 'accent preserved');
  assert.equal(rows('SELECT qty_owned o FROM owned_cards WHERE profile_id=?;', [pid])[0].o, 2);
});
