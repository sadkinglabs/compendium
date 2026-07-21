// The import boundary, end to end against the REAL importProfile and a real database.
//
// importBoundary.test.mjs proves the pure decisions. This file proves the consequence Codex
// asked for and that a pure test structurally cannot: when a bundle is rejected, NO PROFILE
// EXISTS afterwards. Asserting that an error was thrown is the easy half; the requirement is
// that the user is not left with an orphaned half-profile to find and delete.
// Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { importProfile } from './profileTransfer.js';
import { ImportRejected } from './importBoundary.js';
import { LEGACY_UNCATEGORISED, LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL, isLegacyPrinting } from './printings.js';

const require = createRequire(import.meta.url);
const HOME = 'home-profile';
let sdb;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; } finally { st.free(); }
};
const profileCount = () => rows('SELECT COUNT(*) n FROM profiles;')[0].n;

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  __setBackendForTests({
    query(sql, params = []) { return Promise.resolve(rows(sql, params)); },
    run(sql, params = []) { sdb.run(sql, params); return Promise.resolve(); },
    exec(sql) { sdb.run(sql); return Promise.resolve(); },
    tx(stmts) { sdb.run('BEGIN;'); try { for (const [s, p = []] of stmts) sdb.run(s, p); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
    persist() { return Promise.resolve(); },
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);
  __setActiveIdForTests(HOME);
});

beforeEach(() => {
  sdb.run('DELETE FROM owned_cards; DELETE FROM profiles; DELETE FROM cards;');
  sdb.run('INSERT INTO profiles(id,name,schema_version,created_at) VALUES(?,?,?,?);', [HOME, 'Home', 10, '2026-01-01']);
  // c1 is a reprint (want must park), c2 is single-set (want must file).
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('c1','Reprinted','[{\"code\":\"001\"},{\"code\":\"002\"}]');");
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('c2','Single','[{\"code\":\"004\"}]');");
});

const owned = (o) => ({
  id: 'src', profile_id: 'other-device', card_id: 'c1', variant_slug: LEGACY_UNCATEGORISED,
  qty_owned: 0, qty_wanted: 0, notes: '', created_at: '2026-01-01', updated_at: '2026-01-01', ...o,
});
const bundle = (o = {}) => ({
  app: 'compendium', schemaVersion: 10, profile: { name: 'Imported', accent: 'gold' }, owned_cards: [], ...o,
});

/* ---------------- rejection leaves nothing ---------------- */

test('a FUTURE bundle is rejected and creates no profile', async () => {
  const before = profileCount();
  await assert.rejects(
    importProfile(bundle({ schemaVersion: 99, owned_cards: [owned({ qty_owned: 1 })] })),
    (e) => e instanceof ImportRejected && e.code === 'future',
  );
  assert.equal(profileCount(), before, 'NO profile row exists afterwards');
});

test('a malformed bundle is rejected and creates no profile', async () => {
  const before = profileCount();
  for (const bad of [null, { app: 'other' }, bundle({ owned_cards: 5 }), bundle({ owned_cards: [{ qty_owned: 1 }] })]) {
    await assert.rejects(importProfile(bad), (e) => e instanceof ImportRejected);
  }
  assert.equal(profileCount(), before, 'still no orphaned profiles after four rejections');
});

test('rejection leaves no owned_cards rows either', async () => {
  await assert.rejects(importProfile(bundle({ schemaVersion: 99, owned_cards: [owned({ qty_owned: 5 })] })));
  assert.equal(rows('SELECT COUNT(*) n FROM owned_cards;')[0].n, 0);
});

/* ---------------- acceptance converts ---------------- */

test('a v10 bundle imports, and the stored rows carry canonical keys', async () => {
  const pid = await importProfile(bundle({
    owned_cards: [
      owned({ id: 'a', card_id: 'c1', variant_slug: LEGACY_UNCATEGORISED, qty_owned: 2 }),
      owned({ id: 'b', card_id: 'c1', variant_slug: LEGACY_FOIL, qty_owned: 1 }),
      owned({ id: 'c', card_id: 'c2', variant_slug: LEGACY_UNCATEGORISED, qty_wanted: 3 }),
    ],
  }));
  const stored = rows('SELECT card_id, variant_slug, qty_owned, qty_wanted FROM owned_cards WHERE profile_id=?;', [pid]);
  assert.equal(stored.some((r) => isLegacyPrinting(r.variant_slug)), false, 'no legacy key reaches the database');

  const byKey = Object.fromEntries(stored.map((r) => [`${r.card_id}|${r.variant_slug}`, r]));
  assert.equal(byKey[`c1|${UNCATEGORISED}`].qty_owned, 2);
  assert.equal(byKey[`c1|${UNCATEGORISED_FOIL}`].qty_owned, 1);
  assert.equal(byKey['c2|004'].qty_wanted, 3, 'the single-set want was filed, not parked');
});

test('a want on a REPRINTED card is parked, exactly as at boot', async () => {
  const pid = await importProfile(bundle({ owned_cards: [owned({ card_id: 'c1', qty_wanted: 4 })] }));
  const stored = rows('SELECT variant_slug, qty_wanted FROM owned_cards WHERE profile_id=?;', [pid]);
  assert.deepEqual(stored, [{ variant_slug: UNCATEGORISED, qty_wanted: 4 }]);
});

test('quantities are conserved through a real import', async () => {
  const src = [
    owned({ id: 'a', card_id: 'c1', variant_slug: LEGACY_UNCATEGORISED, qty_owned: 3, qty_wanted: 2 }),
    owned({ id: 'b', card_id: 'c1', variant_slug: LEGACY_FOIL, qty_owned: 1 }),
    owned({ id: 'c', card_id: 'c2', variant_slug: '004', qty_owned: 4 }),
  ];
  const pid = await importProfile(bundle({ owned_cards: src }));
  const stored = rows('SELECT SUM(qty_owned) o, SUM(qty_wanted) w FROM owned_cards WHERE profile_id=?;', [pid])[0];
  assert.equal(stored.o, 8, 'owned conserved');
  assert.equal(stored.w, 2, 'wanted conserved');
});

test('importing does not disturb the existing profile', async () => {
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted) VALUES('mine',?,'c1','001',7,0);", [HOME]);
  await importProfile(bundle({ owned_cards: [owned({ qty_owned: 1 })] }));
  const mine = rows('SELECT qty_owned, variant_slug FROM owned_cards WHERE profile_id=?;', [HOME]);
  assert.deepEqual(mine, [{ qty_owned: 7, variant_slug: '001' }], "the home profile's ledger is untouched");
});

test('a second import of the same bundle does not merge into the first', async () => {
  // Profile isolation: two imports are two independent profiles, not one doubled ledger.
  const b = bundle({ owned_cards: [owned({ card_id: 'c2', variant_slug: LEGACY_UNCATEGORISED, qty_owned: 2 })] });
  const first = await importProfile(b);
  const second = await importProfile(b);
  assert.notEqual(first, second);
  for (const pid of [first, second]) {
    const t = rows('SELECT SUM(qty_owned) o FROM owned_cards WHERE profile_id=?;', [pid])[0];
    assert.equal(t.o, 2, 'each profile holds its own two copies');
  }
});
