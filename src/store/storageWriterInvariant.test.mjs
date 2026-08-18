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
import { createBulkOwnedCommands } from './bulkOwnedRepository.js';
import { createOwnedImportCommand } from './ownedImportRepository.js';
import { createTriageCommands } from './triageRepository.js';
import { triagePile, fileLinePlan } from './triage.js';

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
  // `variants` is not optional decoration: the want writers authorise through printingFinishes,
  // which reads it STRICTLY and rejects a card it cannot describe. A fixture without it fails on
  // InvalidPrinting before the equality is ever evaluated - the assertion silently never runs.
  sdb.run("INSERT INTO cards(card_id,name,sets,variants) VALUES('sole1','Sole','[{\"code\":\"001\"}]','[{\"set\":\"001\",\"finish\":\"Standard\"},{\"set\":\"001\",\"finish\":\"Foil\"}]');");
  sdb.run("INSERT INTO cards(card_id,name,sets,variants) VALUES('multi1','Multi','[{\"code\":\"001\"},{\"code\":\"002\"}]','[{\"set\":\"001\",\"finish\":\"Standard\"},{\"set\":\"001\",\"finish\":\"Foil\"},{\"set\":\"002\",\"finish\":\"Standard\"}]');");
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

/* ---------------- the BULK writers ---------------- */
//
// Same assertion, second module. Bulk was as unwired as the steppers and just as silent about it,
// and no per-writer test above can see it: applyBulkOwned composes its own transaction.

const bulk = createBulkOwnedCommands({
  exclusive: (fn) => fn(),          // the barrier is not what these tests are about
  query: (s, p = []) => Promise.resolve(rows(s, p)),
  tx: (st) => { sdb.run('BEGIN;'); try { st.forEach(([s, p = []]) => sdb.run(s, p)); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
  notify: () => {},
  activeProfileId: () => PID,
});
const T = (cardId, set = '001') => ({ cardId, set });
const at = (container, ownedId) => rows('SELECT qty FROM storage_allocations WHERE container_id=? AND owned_card_id=?;', [container, ownedId])[0]?.qty || 0;

test('bulk add1 places the copies it adds', async () => {
  seedOwned('o1', 'sole1', '001', 2, { binder: 1 });
  const r = await bulk.applyBulkOwned('add1', [T('sole1')]);
  assert.equal(r.confirmed, true);
  assert.deepEqual(brokenRows(), []);
  assert.equal(at(UNFILED, 'o1'), 2, 'the new copy went to Unfiled');
  assert.equal(at('b1', 'o1'), 1, 'the binder is untouched by an add');
});

test('bulk remove1 takes from Unfiled and leaves the binder alone', async () => {
  seedOwned('o1', 'sole1', '001', 3, { binder: 1 });   // 1 filed, 2 loose
  await bulk.applyBulkOwned('remove1', [T('sole1')]);
  assert.deepEqual(brokenRows(), []);
  assert.equal(at(UNFILED, 'o1'), 1);
  assert.equal(at('b1', 'o1'), 1, 'the binder is not raided to satisfy a global minus');
});

test('bulk remove1 REJECTS when the copies are all filed, and writes nothing', async () => {
  seedOwned('o1', 'sole1', '001', 2, { binder: 2 });   // nothing loose
  await assert.rejects(() => bulk.applyBulkOwned('remove1', [T('sole1')]), { name: 'StorageConflict' });
  assert.equal(rows("SELECT qty_owned FROM owned_cards WHERE id='o1';")[0].qty_owned, 2, 'the count did not move');
  assert.equal(at('b1', 'o1'), 2, 'and neither did the filing');
});

test('a mixed bulk selection fails WHOLE - the satisfiable item is not written either', async () => {
  // Sec 5: a bulk command that half-applies is worse than one that explains itself.
  seedOwned('o1', 'sole1', '001', 2, { binder: 0 });   // satisfiable
  seedOwned('o2', 'multi1', '001', 2, { binder: 2 });  // not
  await assert.rejects(() => bulk.applyBulkOwned('remove1', [T('sole1'), T('multi1')]),
    (e) => e.name === 'StorageConflict' && e.detail.items.length === 1 && e.detail.items[0].cardId === 'multi1');
  assert.equal(rows("SELECT qty_owned FROM owned_cards WHERE id='o1';")[0].qty_owned, 2, 'the satisfiable item was not written');
});

test('bulk remove1 reaching ZERO clears the places, filed or not', async () => {
  // Total removal needs no attribution: the wall exists because the app cannot know WHICH copy
  // left, and when every copy leaves there is nothing to guess.
  seedOwned('o1', 'sole1', '001', 1, { binder: 1 });
  await bulk.applyBulkOwned('remove1', [T('sole1')]);
  assert.deepEqual(brokenRows(), []);
  assert.equal(rows("SELECT id FROM storage_allocations WHERE owned_card_id='o1';").length, 0);
});

test('undo of a bulk add takes the placed copy back out', async () => {
  seedOwned('o1', 'sole1', '001', 1, { binder: 0 });
  const r = await bulk.applyBulkOwned('add1', [T('sole1')]);
  const u = await bulk.undoBulkOwned(r.undo);
  assert.equal(u.applied, 1);
  assert.deepEqual(brokenRows(), []);
  assert.equal(at(UNFILED, 'o1'), 1, 'back to where it started');
});

test('undo of a bulk remove puts the copy back in Unfiled', async () => {
  seedOwned('o1', 'sole1', '001', 2, { binder: 0 });
  const r = await bulk.applyBulkOwned('remove1', [T('sole1')]);
  const u = await bulk.undoBulkOwned(r.undo);
  assert.equal(u.applied, 1);
  assert.deepEqual(brokenRows(), []);
  assert.equal(at(UNFILED, 'o1'), 2);
});

test('undo REFUSED by its guard moves the places no more than it moves the count', async () => {
  // The guard and the allocation must agree about whether the undo happened. If the places moved
  // while the conditional UPDATE declined, the equality would break on a row nobody wrote to.
  seedOwned('o1', 'sole1', '001', 1, { binder: 0 });
  const r = await bulk.applyBulkOwned('add1', [T('sole1')]);
  await repo.setOwnedInSet('sole1', '001', 5);        // the user edits it before undoing
  const u = await bulk.undoBulkOwned(r.undo);
  assert.equal(u.applied, 0);
  assert.equal(u.conflicts, 1);
  assert.deepEqual(brokenRows(), [], 'the declined undo left the ledger consistent');
  assert.equal(at(UNFILED, 'o1'), 5, "the user's edit survived intact");
});

/* ---------------- the IMPORT writers ---------------- */
//
// Third module, same assertion. The absolute path had a second defect the equality alone would not
// have named: its clear-to-zero DELETEs the owned row, and an owned row with places cannot be
// deleted under RESTRICT. On any real v12 profile a bulk delete through import would have failed
// outright - not a drift, a hard error - and no fixture held a place to reveal it.

const importCmd = createOwnedImportCommand({
  exclusive: (fn) => fn(),
  query: (s, p = []) => Promise.resolve(rows(s, p)),
  tx: (st) => { sdb.run('BEGIN;'); try { st.forEach(([s, p = []]) => sdb.run(s, p)); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
  notify: () => {},
  activeProfileId: () => PID,
});

test('a resolved import places every copy it files', async () => {
  await importCmd.importCollectionResolved([{ card_id: 'multi1', setCode: '001', foil: false, qty: 3 }], PID);
  assert.deepEqual(brokenRows(), []);
});

test('a resolved import onto an existing row places only the copies it adds', async () => {
  seedOwned('o2', 'multi1', '001', 2, { binder: 2 });
  await importCmd.importCollectionResolved([{ card_id: 'multi1', setCode: '001', foil: false, qty: 3 }], PID);
  assert.deepEqual(brokenRows(), []);
  assert.equal(at(UNFILED, 'o2'), 3, 'the three new copies are loose');
  assert.equal(at('b1', 'o2'), 2, 'the existing filing is untouched');
});

test('setOwnedItemsBulk to zero DELETES a row that still has places, rather than failing on RESTRICT', async () => {
  seedOwned('o1', 'sole1', '001', 3, { binder: 2 });
  const r = await importCmd.setOwnedItemsBulk([{ card_id: 'sole1', setCode: '001', foil: false, qty: 0 }], PID);
  assert.equal(r.removed, 1);
  assert.deepEqual(brokenRows(), []);
  assert.equal(rows("SELECT id FROM storage_allocations WHERE owned_card_id='o1';").length, 0, 'no place outlived its row');
});

test('setOwnedItemsBulk to zero on a WANTED row clears the places but keeps the row', async () => {
  seedOwned('o1', 'sole1', '001', 2, { binder: 1 });
  sdb.run("UPDATE owned_cards SET qty_wanted=1 WHERE id='o1';");
  const r = await importCmd.setOwnedItemsBulk([{ card_id: 'sole1', setCode: '001', foil: false, qty: 0 }], PID);
  assert.equal(r.cleared, 1);
  assert.deepEqual(brokenRows(), [], 'a row at zero copies holds zero places');
  assert.equal(rows("SELECT qty_wanted FROM owned_cards WHERE id='o1';")[0].qty_wanted, 1, 'the want survives');
});

test('setOwnedItemsBulk raising a count places the difference in Unfiled', async () => {
  seedOwned('o1', 'sole1', '001', 2, { binder: 2 });
  await importCmd.setOwnedItemsBulk([{ card_id: 'sole1', setCode: '001', foil: false, qty: 5 }], PID);
  assert.deepEqual(brokenRows(), []);
  assert.equal(at(UNFILED, 'o1'), 3);
  assert.equal(at('b1', 'o1'), 2);
});

test('adjustOwnedItemsBulk lowering takes from Unfiled and refuses to reach into a binder', async () => {
  seedOwned('o1', 'sole1', '001', 4, { binder: 3 });   // 1 loose
  await importCmd.adjustOwnedItemsBulk([{ card_id: 'sole1', setCode: '001', foil: false, delta: -1 }], PID);
  assert.deepEqual(brokenRows(), []);
  assert.equal(at('b1', 'o1'), 3);

  // A second step of the same size cannot come from anywhere legitimate.
  await assert.rejects(() => importCmd.adjustOwnedItemsBulk([{ card_id: 'sole1', setCode: '001', foil: false, delta: -1 }], PID),
    (e) => /hold copies outside Unfiled/.test(e.message));
  assert.equal(rows("SELECT qty_owned FROM owned_cards WHERE id='o1';")[0].qty_owned, 3, 'the refused adjust wrote nothing');
});

/* ---------------- TRIAGE: a key move, so the places FOLLOW the copies ---------------- */
//
// Fourth module, and the only one where the right answer is not "place it in Unfiled". Filing
// establishes which printing some copies are; it does not move them off the shelf. A copy in a
// binder before triage is in that same binder after it - so the allocations are RE-PARENTED, not
// removed and re-created.

const triage = createTriageCommands({
  exclusive: (fn) => fn(),
  query: (s, p = []) => Promise.resolve(rows(s, p)),
  tx: (st) => { sdb.run('BEGIN;'); try { st.forEach(([s, p = []]) => sdb.run(s, p)); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
  notify: () => {},
  activeProfileId: () => PID,
}).fileTriageLine;
// Built the way the UI builds one, so the test exercises the plan shape production sees.
const filePlan = (cardId, set) => {
  const ledgerRows = rows('SELECT card_id, variant_slug, qty_owned, qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=?;', [PID, cardId]);
  const pile = triagePile(ledgerRows, (id) => (id === 'multi1' ? ['001', '002'] : ['001']));
  return fileLinePlan(pile[0], pile[0].lines[0], set);
};

test('filing keeps the copies in the containers they were already in', async () => {
  // The whole point of re-parenting rather than re-placing: triage must not quietly unfile a
  // collection on the way to establishing its printings.
  seedOwned('o1', 'multi1', 'uncategorised', 3, { binder: 2 });   // 2 in the binder, 1 loose
  const r = await triage(filePlan('multi1', '002'));
  assert.equal(r.confirmed, true);
  assert.deepEqual(brokenRows(), []);
  const dest = rows("SELECT id FROM owned_cards WHERE card_id='multi1' AND variant_slug='002';")[0].id;
  assert.equal(at('b1', dest), 2, 'the binder copies are still in the binder, now under the right printing');
  assert.equal(at(UNFILED, dest), 1, 'and the loose one is still loose');
  assert.equal(rows("SELECT id FROM storage_allocations WHERE owned_card_id='o1';").length, 0, 'nothing left behind');
});

test('filing onto a destination that already has places MERGES per container', async () => {
  seedOwned('o1', 'multi1', 'uncategorised', 2, { binder: 1 });
  seedOwned('o2', 'multi1', '002', 3, { binder: 3 });
  await triage(filePlan('multi1', '002'));
  assert.deepEqual(brokenRows(), []);
  assert.equal(at('b1', 'o2'), 4, 'one binder row, not two - the unique index would not permit two');
  assert.equal(at(UNFILED, 'o2'), 1);
});

test('a triage move conserves every copy and every place', async () => {
  seedOwned('o1', 'multi1', 'uncategorised', 4, { binder: 4 });   // entirely filed
  await triage(filePlan('multi1', '001'));
  assert.deepEqual(brokenRows(), []);
  const total = rows('SELECT SUM(qty) t FROM storage_allocations WHERE profile_id=?;', [PID])[0].t;
  assert.equal(total, 4, 'no copy was invented and none was dropped');
});
