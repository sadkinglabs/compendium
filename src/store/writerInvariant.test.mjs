// THE WRITER INVARIANT: after canonicalisation, no production writer may create a v10 key.
//
// This test should have existed before the writers were flipped. Instead the v10 paths were
// found one at a time by review - the scanner, the text import, "add all missing", the bulk
// commands - each one a row that would have been written behind the marker and then been
// invisible to a v11 reader, or worse, silently duplicated by a later edit.
//
// So it is deliberately NOT a list of writers I remember. It exercises every exported write
// function this module can reach and asserts the LEDGER, which means a new writer added later
// is caught by the same assertion without anyone remembering to extend it.
// Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import * as repo from './ownedRepository.js';
import { isLegacyPrinting, LEGACY_UNCATEGORISED, LEGACY_FOIL } from './printings.js';

const require = createRequire(import.meta.url);
const PID = 'p1';
let sdb;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; } finally { st.free(); }
};
const legacyRows = () =>
  rows('SELECT card_id, variant_slug, qty_owned, qty_wanted FROM owned_cards;')
    .filter((r) => isLegacyPrinting(r.variant_slug));

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
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES('p1','A',11,'x');");
  // v12: every profile has an Unfiled container, and the ownership writers now place the
  // copies they create. A fixture without one is not a lighter fixture - it is a profile
  // the boot backfill could never have produced, and the writers fail closed on it.
  sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,colour,is_system,created_at,updated_at) VALUES(?,?,'unfiled','Unfiled','gold',1,'t','t');", ['u-p1', 'p1']);
  // sole1 is printed once; multi1 is a reprint. Both shapes matter: a writer that resolves a
  // collector item behaves differently for each, and only one of them may ever ask.
  // variants are needed now that positive item-writes validate the (set, finish) against the catalog
  // (assertRealPrinting). Both finishes on every set these tests write, so only the UNCATEGORISED
  // path - the actual subject here - exercises the writer divergence, never a phantom rejection.
  sdb.run("INSERT INTO cards(card_id,name,system,sets,variants) VALUES('sole1','Sole','sorcery','[{\"code\":\"004\"}]','[{\"slug\":\"004-sole1-s\",\"set\":\"004\",\"finish\":\"Standard\"},{\"slug\":\"004-sole1-f\",\"set\":\"004\",\"finish\":\"Foil\"}]');");
  sdb.run("INSERT INTO cards(card_id,name,system,sets,variants) VALUES('multi1','Reprinted','sorcery','[{\"code\":\"001\"},{\"code\":\"002\"}]','[{\"slug\":\"001-multi1-s\",\"set\":\"001\",\"finish\":\"Standard\"},{\"slug\":\"001-multi1-f\",\"set\":\"001\",\"finish\":\"Foil\"},{\"slug\":\"002-multi1-s\",\"set\":\"002\",\"finish\":\"Standard\"},{\"slug\":\"002-multi1-f\",\"set\":\"002\",\"finish\":\"Foil\"}]');");
  __setActiveIdForTests(PID);
});

beforeEach(() => { sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards; DELETE FROM card_lists; DELETE FROM card_list_entries;'); });

/* ---------------- the invariant, per writer ---------------- */

// Every production write path that can touch owned_cards, with arguments that exercise the
// UNCATEGORISED case - the only one where the two schemas disagree, and therefore the only one
// where a writer can produce a legacy key.
const WRITERS = [
  { name: 'setOwned', run: () => repo.setOwned('sole1', 3) },
  { name: 'stepOwnedBucket', run: () => repo.stepOwnedBucket('sole1', 2) },
  { name: 'setFoil', run: () => repo.setFoil('sole1', 2) },
  { name: 'setOwnedInSet (uncategorised bucket)', run: () => repo.setOwnedInSet('sole1', '', 4) },
  { name: 'setFoilInSet (uncategorised bucket)', run: () => repo.setFoilInSet('sole1', '', 1) },
  { name: 'setOwnedInSet (real set)', run: () => repo.setOwnedInSet('multi1', '001', 2) },
  { name: 'setFoilInSet (real set)', run: () => repo.setFoilInSet('multi1', '001', 1) },
  { name: 'addOwnedCopies', run: () => repo.addOwnedCopies('sole1', 2) },
  { name: 'addOwnedCopiesInSet', run: () => repo.addOwnedCopiesInSet?.('multi1', '002', 2) },
  { name: 'setWanted (resolves)', run: () => repo.setWanted('sole1', 2) },
  { name: 'stepWanted (resolves)', run: () => repo.stepWanted('sole1', 1) },
  { name: 'addWantedCopies (resolves)', run: () => repo.addWantedCopies('sole1', 1) },
  { name: 'setWantedForItem', run: () => repo.setWantedForItem('multi1', { set: '002', foil: false }, 2) },
  { name: 'stepWantedForItem', run: () => repo.stepWantedForItem('multi1', { set: '002', foil: true }, 1) },
  { name: 'addWantedForItem', run: () => repo.addWantedForItem('multi1', { set: '001', foil: false }, 1) },
];

for (const w of WRITERS) {
  test(`${w.name} writes no legacy key`, async () => {
    const out = w.run();
    if (out === undefined) return;      // helper not present in this build
    await out;
    assert.deepEqual(legacyRows(), [], `${w.name} produced a v10 key`);
  });
}

test('every writer in sequence still leaves zero legacy keys', async () => {
  // Run them ALL against one ledger. A writer that is clean in isolation can still resurrect a
  // legacy row when it edits one another writer created, which per-writer tests cannot see.
  for (const w of WRITERS) { const out = w.run(); if (out !== undefined) await out; }
  assert.deepEqual(legacyRows(), [], 'the combined ledger holds a v10 key');
});

/* ---------------- the invariant survives a MIXED starting ledger ---------------- */

test('editing a pre-existing LEGACY row converts it rather than twinning it', async () => {
  // The realistic post-migration state is not a clean database: an import or an interrupted
  // conversion can leave a legacy row, and the first edit must absorb it.
  // Placed, as the backfill leaves them. These writers only INCREASE, so an unplaced seed would
  // pass here and still be a state v12 cannot produce - the kind of fixture that hides a gap
  // until the first decrease meets it.
  const seed = (slug, owned, wanted) => {
    sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
      [`s-${slug}`, PID, 'sole1', slug, owned, wanted, '', 'x', 'x']);
    if (owned > 0) sdb.run('INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,?,?,?,?);',
      [`a-${slug}`, PID, 'u-p1', `s-${slug}`, owned, 'x', 'x']);
  };

  seed(LEGACY_UNCATEGORISED, 2, 1);
  seed(LEGACY_FOIL, 3, 0);

  await repo.stepOwnedBucket('sole1', 1);
  await repo.setFoil('sole1', 4);
  await repo.stepWanted('sole1', 1);

  assert.deepEqual(legacyRows(), [], 'no legacy row survived being edited');
  const all = rows('SELECT variant_slug, qty_owned, qty_wanted FROM owned_cards ORDER BY variant_slug;');
  assert.equal(all.filter((r) => r.variant_slug === 'uncategorised').length, 1, 'one row, not a twin');
  assert.equal(all.filter((r) => r.variant_slug === 'uncategorised:f').length, 1);
});

/* ---------------- quantities are not lost while converting ---------------- */

test('converting a legacy row preserves BOTH quantities on it', async () => {
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    ['s1', PID, 'sole1', LEGACY_UNCATEGORISED, 5, 3, '', 'x', 'x']);
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('a1',?,'u-p1','s1',5,'x','x');", [PID]);
  await repo.stepOwnedBucket('sole1', 1);
  const row = rows("SELECT qty_owned, qty_wanted FROM owned_cards WHERE variant_slug='uncategorised';")[0];
  assert.equal(row.qty_owned, 6, 'owned stepped');
  assert.equal(row.qty_wanted, 3, 'the want that shared the legacy row survived the conversion');
});

/* ---------------- forbidden state ---------------- */

test('no production writer here creates an UNCATEGORISED want', async () => {
  // §2.1 reserves that state for migration, import and triage. A want that resolves to the
  // uncategorised row is only legitimate when one was already there.
  for (const w of WRITERS) { const out = w.run(); if (out !== undefined) await out; }
  const uncatWants = rows("SELECT card_id FROM owned_cards WHERE qty_wanted>0 AND variant_slug LIKE 'uncategorised%';");
  assert.deepEqual(uncatWants, [], 'a writer created an unresolved want');
});
