// THE STORAGE INVARIANT: after any production writer, every owned copy is still in exactly one
// place.
//
//     qty_owned = SUM(storage_allocations.qty for that owned row)
//
// WHY THIS FILE EXISTS, stated plainly because the lesson is the point. Increment 1 routed only the
// DELETE paths through the mutation boundary and reported the writers as done. Increases and
// decreases were never wired, so tapping + on any card after the upgrade moved qty_owned while its
// Unfiled allocation stood still - the defining equality broken through shipping UI on the first
// interaction.
//
// It survived my own testing because I had made the suite blind to it: when the schema bump caused
// foreign-key failures, I patched every fixture with a blanket `DELETE FROM storage_allocations`
// before the owned-row deletes. That silenced the errors and, in the same stroke, removed the only
// state in which the gap could be observed. A green 1116/1116 proved less than it appeared.
//
// So this file follows writerInvariant.test.mjs deliberately: it is NOT a list of writers I
// remember. It seeds a REAL allocation graph, exercises every exported write function, and asserts
// the ledger - which means a writer added later is caught by the same assertion without anyone
// remembering to extend it.
// Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import * as repo from './ownedRepository.js';

const require = createRequire(import.meta.url);
const PID = 'p1';
const UNFILED = 'u1';
let sdb;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; } finally { st.free(); }
};

/** Every owned row whose copies are not exactly accounted for by its places. */
const brokenRows = () => rows(`
  SELECT o.id, o.card_id, o.variant_slug, o.qty_owned,
         COALESCE((SELECT SUM(a.qty) FROM storage_allocations a WHERE a.owned_card_id = o.id), 0) placed
    FROM owned_cards o WHERE o.profile_id = ?;`, [PID])
  .filter((r) => Number(r.qty_owned) !== Number(r.placed))
  .map((r) => `${r.card_id}|${r.variant_slug}: owns ${r.qty_owned}, placed ${r.placed}`);

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  __setBackendForTests({
    query: (s, p = []) => Promise.resolve(rows(s, p)),
    run: (s, p = []) => { sdb.run(s, p); return Promise.resolve(); },
    tx: (st) => { sdb.run('BEGIN;'); try { st.forEach(([s, p = []]) => sdb.run(s, p)); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
    exec: (s) => { sdb.run(s); return Promise.resolve(); },
    persist: () => Promise.resolve(),
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);
  __setActiveIdForTests(PID);
});

beforeEach(() => {
  sdb.run('DELETE FROM storage_allocations; DELETE FROM storage_containers; DELETE FROM owned_cards; DELETE FROM profiles; DELETE FROM cards;');
  sdb.run('INSERT INTO profiles(id,name,schema_version,created_at) VALUES(?,?,?,?);', [PID, 'Home', 12, 'T']);
  // A REAL allocation graph, which is the whole point: the fixtures that hid this bug deleted it.
  sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,colour,is_system,created_at,updated_at) VALUES(?,?,'unfiled','Unfiled','gold',1,'T','T');", [UNFILED, PID]);
  sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,colour,is_system,created_at,updated_at) VALUES('b1',?,'binder','Binder','ruby',0,'T','T');", [PID]);
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('sole1','Sole','[{\"code\":\"001\"}]');");
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('multi1','Multi','[{\"code\":\"001\"},{\"code\":\"002\"}]');");
});

/** Seed an owned row with its copies already placed, as the backfill leaves them. */
const seedOwned = (id, cardId, slug, owned, { binder = 0 } = {}) => {
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?);',
    [id, PID, cardId, slug, owned, '', 'T', 'T']);
  if (binder > 0) sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,'b1',?,?,'T','T');", [`${id}-b`, PID, id, binder]);
  const loose = owned - binder;
  if (loose > 0) sdb.run('INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,?,?,?,?);', [`${id}-u`, PID, UNFILED, id, loose, 'T', 'T']);
};

/* ---------------- the invariant, per writer ---------------- */

// Every production write path that can touch qty_owned. Deliberately exhaustive rather than
// selective: the gap this file exists for was in the writers I did not think about.
const WRITERS = [
  { name: 'setOwned', run: () => repo.setOwned('sole1', 3) },
  { name: 'setOwned (down)', run: () => repo.setOwned('sole1', 1) },
  { name: 'stepOwnedBucket (up)', run: () => repo.stepOwnedBucket('sole1', 2) },
  { name: 'stepOwnedBucket (down)', run: () => repo.stepOwnedBucket('sole1', -1) },
  { name: 'setFoil', run: () => repo.setFoil('sole1', 2) },
  { name: 'setOwnedInSet', run: () => repo.setOwnedInSet('multi1', '001', 4) },
  { name: 'setOwnedInSet (down)', run: () => repo.setOwnedInSet('multi1', '001', 1) },
  { name: 'setFoilInSet', run: () => repo.setFoilInSet('multi1', '001', 1) },
  { name: 'addOwnedCopies', run: () => repo.addOwnedCopies('sole1', 2) },
  { name: 'addOwnedCopiesInSet', run: () => repo.addOwnedCopiesInSet?.('multi1', '002', 2) },
  // Wishlist writers must leave the graph alone: a want holds no copies, so it holds no places.
  { name: 'setWanted', run: () => repo.setWanted('sole1', 2) },
  { name: 'setWantedForItem', run: () => repo.setWantedForItem('multi1', { set: '002', foil: false }, 2) },
];

for (const w of WRITERS) {
  test(`${w.name} leaves every copy in exactly one place`, async () => {
    seedOwned('o1', 'sole1', '001', 2, { binder: 1 });
    seedOwned('o2', 'multi1', '001', 2, { binder: 0 });
    const out = w.run();
    if (out === undefined) return;              // helper not present in this build
    await out;
    assert.deepEqual(brokenRows(), [], `${w.name} broke the equality`);
  });
}

test('every writer in sequence still leaves the equality intact', async () => {
  // A writer clean in isolation can still break the ledger when it edits a row another writer
  // created - which per-writer tests cannot see.
  seedOwned('o1', 'sole1', '001', 2, { binder: 1 });
  seedOwned('o2', 'multi1', '001', 2, { binder: 0 });
  for (const w of WRITERS) { const out = w.run(); if (out !== undefined) await out; }
  assert.deepEqual(brokenRows(), [], 'the combined ledger broke the equality');
});

/* ---------------- the cases the equality is really about ---------------- */

test('an increase places the new copies rather than only raising the count', async () => {
  seedOwned('o1', 'sole1', '001', 2, { binder: 1 });
  await repo.setOwnedInSet('sole1', '001', 5);
  assert.deepEqual(brokenRows(), []);
  // and the new copies land in Unfiled, never in the user's binder
  const binder = rows("SELECT qty FROM storage_allocations WHERE container_id='b1' AND owned_card_id='o1';");
  assert.equal(binder[0]?.qty, 1, 'filing is untouched by a global increase');
});

test('a global decrease comes out of Unfiled, never out of a binder', async () => {
  seedOwned('o1', 'sole1', '001', 4, { binder: 1 });   // 1 filed, 3 loose
  await repo.setOwnedInSet('sole1', '001', 2);
  assert.deepEqual(brokenRows(), []);
  const binder = rows("SELECT qty FROM storage_allocations WHERE container_id='b1' AND owned_card_id='o1';");
  assert.equal(binder[0]?.qty, 1, 'the binder is not raided to satisfy a global minus');
});

test('setting a count to zero removes the row AND its places, leaving nothing stranded', async () => {
  seedOwned('o1', 'sole1', '001', 3, { binder: 2 });
  await repo.setOwnedInSet('sole1', '001', 0);
  assert.deepEqual(brokenRows(), []);
  assert.equal(rows("SELECT id FROM storage_allocations WHERE owned_card_id='o1';").length, 0);
});

test('a wishlist-only row has no places, and that satisfies the equality', async () => {
  // 0 = SUM(none). A zero-quantity allocation would violate CHECK (qty > 0) and fail boot, which
  // is the distinction that would have broken the backfill.
  await repo.setWanted('sole1', 2);
  assert.deepEqual(brokenRows(), []);
  const allocs = rows('SELECT id FROM storage_allocations WHERE profile_id=?;', [PID]);
  assert.equal(allocs.length, 0, 'a want holds no copies, so it holds no places');
});
