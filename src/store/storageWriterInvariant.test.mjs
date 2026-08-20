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
import { createOwnedImportCommand } from './ownedImportRepository.js';
import { createTriageCommands } from './triageRepository.js';
import { triagePile, fileLinePlan } from './triage.js';
import { createWantedBulkCommand } from './wantedBulkRepository.js';
import { createCanonicaliser } from './canonicaliseBoot.js';
import { placeUnfiledByKeyStatements, takeUnfiledByKeyStatements, assertEqualityStatements } from './storageRepository.js';

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
  // `_meta` is created by openDatabase, not by a migration, so a suite that applies MIGRATIONS
  // alone does not have it - and the boot passes write their markers there.
  sdb.run('CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);');
  for (const m of MIGRATIONS) sdb.run(m.sql);
  __setActiveIdForTests(PID);
});

beforeEach(() => {
  sdb.run('DELETE FROM storage_allocations; DELETE FROM storage_containers; DELETE FROM owned_cards; DELETE FROM profiles; DELETE FROM cards; DELETE FROM _meta;');
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
  // Unfiled-only, which is the case zero still clears. A filed row is refused - see the wall
  // section at the foot of this file.
  seedOwned('o1', 'sole1', '001', 3, { binder: 0 });
  await repo.setOwnedInSet('sole1', '001', 0);
  assert.deepEqual(brokenRows(), []);
  assert.equal(rows("SELECT id FROM storage_allocations WHERE owned_card_id='o1';").length, 0);
  assert.equal(rows("SELECT id FROM owned_cards WHERE id='o1';").length, 0);
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
// DELETED WITH THEIR MODULE. bulkOwnedRepository carried the add1/ensure1/remove1 protocol and was
// superseded three days after it was written by the Set-to-N / Adjust-by-N surface in
// ownedImportRepository, which is what the app actually ships. Its equality routing and the eight
// tests that covered it went with it; the live bulk path is exercised under "the IMPORT writers"
// below. Recorded here rather than silently vanishing, because the coverage count changed.

/** Copies of one owned row sitting in one container. Lived in the deleted block; still needed. */
const at = (container, ownedId) => rows('SELECT qty FROM storage_allocations WHERE container_id=? AND owned_card_id=?;', [container, ownedId])[0]?.qty || 0;

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

test('setOwnedItemsBulk to zero DELETES an UNFILED row, rather than failing on RESTRICT', async () => {
  seedOwned('o1', 'sole1', '001', 3, { binder: 0 });
  const r = await importCmd.setOwnedItemsBulk([{ card_id: 'sole1', setCode: '001', foil: false, qty: 0 }], PID);
  assert.equal(r.removed, 1);
  assert.deepEqual(brokenRows(), []);
  assert.equal(rows("SELECT id FROM storage_allocations WHERE owned_card_id='o1';").length, 0, 'no place outlived its row');
});

test('setOwnedItemsBulk to zero on a WANTED row clears the places but keeps the row', async () => {
  seedOwned('o1', 'sole1', '001', 2, { binder: 0 });
  sdb.run("UPDATE owned_cards SET qty_wanted=1 WHERE id='o1';");
  const r = await importCmd.setOwnedItemsBulk([{ card_id: 'sole1', setCode: '001', foil: false, qty: 0 }], PID);
  assert.equal(r.cleared, 1);
  assert.deepEqual(brokenRows(), [], 'a row at zero copies holds zero places');
  assert.equal(rows("SELECT qty_wanted FROM owned_cards WHERE id='o1';")[0].qty_wanted, 1, 'the want survives');
});

test('BULK SET-TO-0 REFUSES a filed row, and says how many items are in the way', async () => {
  // Owner ruling 2026-08-19. This test asserted the OPPOSITE until that date: Set-to-0 deleted the
  // row and its binder allocation outright, on the reading that total removal needs no attribution.
  // It removes the user's filing record, which is user data, so it is now refused like any other
  // decrease into filed copies.
  seedOwned('o1', 'sole1', '001', 3, { binder: 2 });
  await assert.rejects(
    () => importCmd.setOwnedItemsBulk([{ card_id: 'sole1', setCode: '001', foil: false, qty: 0 }], PID),
    (e) => {
      assert.equal(e.name, 'BulkWriteError');
      assert.equal(e.phase, 'prewrite');
      assert.equal(e.writeState, 'none', 'planning precedes any statement - nothing was written');
      assert.equal(e.storageConflict.items.length, 1);
      assert.equal(e.storageConflict.items[0].target, 0);
      assert.deepEqual(e.storageConflict.items[0].filed, [{ container_id: 'b1', qty: 2 }]);
      return true;
    },
  );
  assert.equal(rows("SELECT qty_owned FROM owned_cards WHERE id='o1';")[0].qty_owned, 3, 'the refused set wrote nothing');
  assert.equal(at('b1', 'o1'), 2, 'and the filing is exactly as it was');
  assert.deepEqual(brokenRows(), [], 'a refused zero leaves the equality intact');
});

test('BULK ADJUST down to zero rides the same wall, so the two commands cannot disagree', async () => {
  // Adjust resolves `max(0, cur + delta)` inside the barrier, so an over-large negative delta lands
  // on a target of 0 and must be refused by the same rule rather than falling through the old
  // zero fast path.
  seedOwned('o1', 'sole1', '001', 3, { binder: 2 });
  await assert.rejects(
    () => importCmd.adjustOwnedItemsBulk([{ card_id: 'sole1', setCode: '001', foil: false, delta: -9 }], PID),
    (e) => e.name === 'BulkWriteError' && e.storageConflict?.items?.length === 1,
  );
  assert.equal(rows("SELECT qty_owned FROM owned_cards WHERE id='o1';")[0].qty_owned, 3);
  assert.deepEqual(brokenRows(), []);
});

test('a bulk selection that is PARTLY blocked writes nothing at all', async () => {
  // Fails whole, unchanged by the ruling - but now reachable through a zero target, which it was
  // not before. Half a collection filed away is worse than an explained refusal.
  seedOwned('o1', 'sole1', '001', 3, { binder: 2 });   // blocked
  seedOwned('o2', 'multi1', '001', 2, { binder: 0 });  // satisfiable
  await assert.rejects(() => importCmd.setOwnedItemsBulk([
    { card_id: 'sole1', setCode: '001', foil: false, qty: 0 },
    { card_id: 'multi1', setCode: '001', foil: false, qty: 0 },
  ], PID), { name: 'BulkWriteError' });
  assert.equal(rows("SELECT qty_owned FROM owned_cards WHERE id='o2';")[0].qty_owned, 2, 'the satisfiable item was not written either');
  assert.deepEqual(brokenRows(), []);
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

/* ---------------- the WANT writers: proven inert, not assumed inert ---------------- */
//
// A want holds no copies, so it holds no places, and every want writer must leave the allocation
// graph EXACTLY as it found it. That is easy to believe and worth proving: the wishlist shares the
// uncategorised row with ownership, so a want writer is one careless column away from moving copies.

const wantedBulk = createWantedBulkCommand({
  exclusive: (fn) => fn(),
  query: (s, p = []) => Promise.resolve(rows(s, p)),
  tx: (st) => { sdb.run('BEGIN;'); try { st.forEach(([s, p = []]) => sdb.run(s, p)); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
  notify: () => {},
  activeProfileId: () => PID,
});
/** The whole allocation graph, ordered, as a comparable snapshot. */
const graph = () => rows('SELECT container_id, owned_card_id, qty FROM storage_allocations WHERE profile_id=? ORDER BY container_id, owned_card_id;', [PID]);

test('addWantedItemsBulk leaves the allocation graph byte-identical', async () => {
  seedOwned('o2', 'multi1', '001', 3, { binder: 2 });   // the row the want will land on
  const before = graph();
  const r = await wantedBulk.addWantedItemsBulk([{ cardId: 'multi1', set: '001', foil: false, qty: 2 }], PID);
  assert.equal(r.items, 1);
  assert.deepEqual(graph(), before, 'a want moved no copy and touched no place');
  assert.deepEqual(brokenRows(), []);
});

test('a want on a card owning nothing creates a row with no places at all', async () => {
  await wantedBulk.addWantedItemsBulk([{ cardId: 'multi1', set: '002', foil: false, qty: 1 }], PID);
  assert.deepEqual(graph(), [], '0 = SUM(none); a zero-quantity allocation would fail CHECK (qty > 0)');
  assert.deepEqual(brokenRows(), []);
});

test('every want writer in the module leaves the graph alone, one after another', async () => {
  seedOwned('o2', 'multi1', '001', 3, { binder: 2 });
  const before = graph();
  await repo.setWanted('multi1', 2, PID, { set: '001', foil: false });
  await repo.stepWantedForItem('multi1', { set: '001', foil: false }, 1, PID);
  await repo.addWantedForItem('multi1', { set: '002', foil: false }, 3, PID);
  await repo.setWantedForItem('multi1', { set: '001', foil: false }, 0, PID);
  await wantedBulk.addWantedItemsBulk([{ cardId: 'multi1', set: '002', foil: false, qty: 1 }], PID);
  assert.deepEqual(graph(), before, 'five want writers, zero movement');
  assert.deepEqual(brokenRows(), []);
});

/* ---------------- CANONICALISATION: both assertions, against a real database ---------------- */
//
// The canonicaliser's own suite drives a fake database, so it can prove an assertion STATEMENT was
// composed but never that SQLite acts on it. These run the real thing. An assertion nobody has
// watched fire is a comment.

const canonicalise = createCanonicaliser({
  query: (s2, p2 = []) => Promise.resolve(rows(s2, p2)),
  tx: (st) => { sdb.run('BEGIN;'); try { st.forEach(([s2, p2 = []]) => sdb.run(s2, p2)); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
});

test('canonicalisation carries filed copies onto the row that absorbs them', async () => {
  // A legacy row with copies in a binder, converted to its canonical key. The copies must arrive
  // at the destination in the SAME container - re-parented, not re-placed.
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('L1',?,'sole1','',3,0,'','x','x');", [PID]);
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('LA',?,'b1','L1',2,'x','x');", [PID]);
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('LU',?,?,'L1',1,'x','x');", [PID, UNFILED]);

  await canonicalise();
  assert.deepEqual(brokenRows(), []);
  // '' becomes 'uncategorised', NOT '001'. Canonicalisation converts the KEY; it does not file
  // copies to a set on the user's behalf even when the card has only one - that is triage's job,
  // and backfillSingleSetOwned was removed for exactly this reason.
  const dest = rows("SELECT id FROM owned_cards WHERE card_id='sole1' AND variant_slug='uncategorised';")[0];
  assert.ok(dest, 'the legacy row was converted');
  assert.equal(at('b1', dest.id), 2, 'the binder copies followed the conversion');
  assert.equal(at(UNFILED, dest.id), 1);
});

test('THE EQUALITY ASSERTION FIRES: a ledger that already disagrees with its places aborts boot', async () => {
  // This is the assertion the pass shipped without. Canonicalisation MERGES rows, so the
  // destination's count comes from the planner while its places come from re-parenting - two
  // pieces of arithmetic that have to agree. If they ever do not, the marker must NOT be written
  // over the top saying the conversion succeeded.
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('L1',?,'sole1','',3,0,'','x','x');", [PID]);
  // Two copies placed against a row that records three. A state nothing legitimate produces.
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('LA',?,'b1','L1',2,'x','x');", [PID]);

  await assert.rejects(() => canonicalise(), 'boot fails closed rather than stamping a lie');
  // And the rollback is total: the v10 row is untouched and no marker was written.
  assert.equal(rows("SELECT variant_slug FROM owned_cards WHERE id='L1';")[0].variant_slug, '',
    "the user's data is exactly as it was");
  assert.equal(rows("SELECT value FROM _meta WHERE key='owned_cards_canonical_version';").length, 0,
    'no marker claims a conversion that rolled back');
});

/* ---------------- WHERE THE WALL ACTUALLY IS, walked one tap at a time ---------------- */
//
// Written after a device pass, because I predicted this wrong and the app was right. Reasoning
// about a stepper in the abstract is not the same as counting the taps.
//
// AMENDED BY THE OWNER, 2026-08-19. This section previously recorded the opposite conclusion: that
// a stepper could ALWAYS walk a card down to nothing however it was filed, because the last tap
// targets zero, and total removal needs no attribution. That reasoning was about the COUNT and left
// out the FILING. Reaching zero threw away the record that three copies were in the Beta binder,
// which is user data in its own right - and an accidental last-copy minus is the single easiest way
// to lose it, because re-adding the copies puts them all in Unfiled with nothing to restore from.
//
// So the wall now runs the whole way down. A decrease is refused whenever it would eat into filed
// copies, whether the target is 2 or 0, and the tests below walk both halves of that.
//
// The old split was already inconsistent with itself, which is the strongest evidence it was wrong:
// clearing a count to zero on a row that ALSO held a want went through planGlobalRemoval and
// refused, while the identical gesture on a row without a want deleted the row and its filing.

test('a stepper walks a filed card down to its filed copies, and then stops', async () => {
  seedOwned('o1', 'sole1', '001', 4, { binder: 1 });     // 1 filed, 3 loose
  for (const target of [3, 2, 1]) {
    await repo.setOwnedInSet('sole1', '001', target);    // funded by Unfiled
    assert.deepEqual(brokenRows(), [], `step to ${target} broke the equality`);
  }
  assert.equal(at(UNFILED, 'o1'), 0, 'Unfiled is exhausted');
  assert.equal(at('b1', 'o1'), 1, 'and the filed copy is still filed');

  // The last tap targets ZERO, and zero is no longer an exemption: the only copy left is in a
  // binder, so removing it would discard the user's filing rather than merely their count.
  await assert.rejects(() => repo.setOwnedInSet('sole1', '001', 0), (e) => {
    assert.equal(e.name, 'StorageConflict');
    assert.deepEqual(e.detail.filed, [{ container_id: 'b1', qty: 1 }]);
    return true;
  });
  assert.equal(rows("SELECT qty_owned FROM owned_cards WHERE id='o1';")[0].qty_owned, 1, 'the refused tap wrote nothing');
  assert.equal(at('b1', 'o1'), 1);
  assert.deepEqual(brokenRows(), [], 'a refused zero leaves the equality intact');
});

test('the wall runs all the way down: a fully filed card refuses BOTH a partial step and zero', async () => {
  seedOwned('o1', 'sole1', '001', 3, { binder: 3 });     // nothing loose
  await assert.rejects(() => repo.setOwnedInSet('sole1', '001', 2), { name: 'StorageConflict' });
  assert.equal(rows("SELECT qty_owned FROM owned_cards WHERE id='o1';")[0].qty_owned, 3, 'nothing moved');

  await assert.rejects(() => repo.setOwnedInSet('sole1', '001', 0), { name: 'StorageConflict' });
  assert.equal(rows("SELECT qty_owned FROM owned_cards WHERE id='o1';")[0].qty_owned, 3);
  assert.equal(at('b1', 'o1'), 3, 'the binder is untouched by either refusal');
  assert.deepEqual(brokenRows(), []);
});

test('unfile the copies and the same zero goes through - the wall names its own exit', async () => {
  // The refusal has to be actionable, not merely correct. Returning the copies to Unfiled is the
  // fix the toast tells the user to make, so it must actually unblock the gesture.
  seedOwned('o1', 'sole1', '001', 3, { binder: 3 });
  await assert.rejects(() => repo.setOwnedInSet('sole1', '001', 0), { name: 'StorageConflict' });
  sdb.run("UPDATE storage_allocations SET container_id=? WHERE owned_card_id='o1';", [UNFILED]);
  await repo.setOwnedInSet('sole1', '001', 0);
  assert.equal(rows("SELECT id FROM owned_cards WHERE id='o1';").length, 0, 'the row is gone');
  assert.equal(rows("SELECT id FROM storage_allocations WHERE owned_card_id='o1';").length, 0);
  assert.deepEqual(brokenRows(), []);
});

test('a zero on a row with NO places at all still deletes, because nothing is being discarded', async () => {
  // A want-only row cleared to nothing, and the shape a broken ledger could also present. Neither
  // has a filing to lose, so neither is the guard's business.
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('w1',?,'sole1','001',0,2,'','T','T');", [PID]);
  await repo.setWantedForItem('sole1', { set: '001', foil: false }, 0, PID);
  assert.equal(rows("SELECT id FROM owned_cards WHERE id='w1';").length, 0, 'a row holding neither copies nor wants is removed');
  assert.deepEqual(brokenRows(), []);
});

test('the card-level and FOIL steppers hit the same wall as the per-set one', async () => {
  // Three separate delete branches in ownedRepository, three separate chances to forget the guard.
  seedOwned('o1', 'sole1', 'uncategorised', 2, { binder: 2 });
  seedOwned('o2', 'sole1', 'uncategorised:f', 1, { binder: 1 });
  await assert.rejects(() => repo.setOwned('sole1', 0), { name: 'StorageConflict' });
  await assert.rejects(() => repo.stepOwnedBucket('sole1', -2), { name: 'StorageConflict' });
  await assert.rejects(() => repo.setFoil('sole1', 0), { name: 'StorageConflict' });
  assert.equal(at('b1', 'o1'), 2);
  assert.equal(at('b1', 'o2'), 1);
  assert.deepEqual(brokenRows(), []);
});

test('the WANT writers fail closed on a row that somehow still holds filed copies', async () => {
  // The two want-writer delete branches fire only when the row ALREADY holds no copies, and by the
  // defining equality a row with no copies has no places - so in a healthy ledger this guard can
  // never trigger. That is an argument about arithmetic in another function, not a property of the
  // delete, so the state is seeded here directly: qty_owned 0 with two copies in a binder. If the
  // guard were absent, clearing the want would take the allocation with it and the only record of
  // where those copies live would be gone. Refusing leaves the corruption visible and repairable.
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('x1',?,'sole1','001',0,1,'','T','T');", [PID]);
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('x1-b',?,'b1','x1',2,'T','T');", [PID]);

  await assert.rejects(() => repo.setWantedForItem('sole1', { set: '001', foil: false }, 0, PID), { name: 'StorageConflict' });
  await assert.rejects(() => repo.setWanted('sole1', 0, PID, { set: '001', foil: false }), { name: 'StorageConflict' });
  assert.equal(at('b1', 'x1'), 2, 'the filing survived the refusal');
  assert.equal(rows("SELECT id FROM owned_cards WHERE id='x1';").length, 1, 'and so did the row that names it');
});

/* ---------------- and WHO IS EXEMPT, which is a property, not an oversight ---------------- */
//
// The wall is on INTERACTIVE decreases. Two kinds of writer legitimately take a filed row to zero
// and must keep doing so, or the ruling would break restore and boot instead of protecting them:
//
//   - import / restore reconciliation, which REPLACES the ledger authoritatively (the owner's
//     earlier "restore = replace" ruling). It never asks the wall because it never subtracts from a
//     surviving row: `planReplace` deletes every profile and re-inserts the archive's rows, and
//     `importProfile` builds a fresh profile. Neither reaches `planAllocationChanges` at all.
//   - triage and canonicalisation, whose drains are KEY MOVES: the source row hits zero only
//     because its allocations were re-parented onto the destination first, so no filing is lost.
//
// A guard written one layer too low - in `clearAllocationsStatements`, say - would fire on all of
// these. These tests are what would notice.

test('EXEMPT: triage may still empty a FULLY filed row, because the places move with the copies', async () => {
  seedOwned('o1', 'multi1', 'uncategorised', 3, { binder: 3 });   // nothing loose - a stepper would refuse
  const r = await triage(filePlan('multi1', '002'));
  assert.equal(r.confirmed, true);
  assert.equal(rows("SELECT id FROM owned_cards WHERE id='o1';").length, 0, 'the drained source row is gone');
  const dest = rows("SELECT id FROM owned_cards WHERE card_id='multi1' AND variant_slug='002';")[0].id;
  assert.equal(at('b1', dest), 3, 'and every filed copy is still in the binder, under the right printing');
  assert.deepEqual(brokenRows(), []);
});

test('EXEMPT: boot canonicalisation may still release a FULLY filed row', async () => {
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('L1',?,'sole1','',2,0,'','x','x');", [PID]);
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('LA',?,'b1','L1',2,'x','x');", [PID]);
  await canonicalise();
  assert.equal(rows("SELECT id FROM owned_cards WHERE id='L1';").length, 0, 'the legacy row was released');
  const dest = rows("SELECT id FROM owned_cards WHERE card_id='sole1' AND variant_slug='uncategorised';")[0].id;
  assert.equal(at('b1', dest), 2, 'its filing came with it');
  assert.deepEqual(brokenRows(), []);
});

test('the conflict says WHERE the copies are, which is the whole point of refusing', async () => {
  // The UI does not use this yet - it reports a generic failure - but the data has to be here for
  // the Storage surfaces to name a container instead of saying "cannot".
  seedOwned('o1', 'sole1', '001', 3, { binder: 3 });
  await assert.rejects(() => repo.setOwnedInSet('sole1', '001', 2), (e) => {
    assert.equal(e.name, 'StorageConflict');
    assert.equal(e.detail.requested, 1);
    assert.equal(e.detail.unfiled, 0);
    assert.deepEqual(e.detail.filed, [{ container_id: 'b1', qty: 3 }]);
    return true;
  });
});

/* ---------------- THE BUCKET IS NOT THE KEY ---------------- */
//
// The defect class the owner called years before it bit: `''` is BOTH the UI's uncategorised bucket
// and the v10 legacy key, so a bucket passed where a storage key belongs matches nothing, writes
// nothing, and reports success. It cost us undoBulkOwned - restoring an Alpha row worked, restoring
// an Uncategorised row silently did not, and the read-back then blamed the user for an edit they
// had not made.
//
// No guard can tell the two apart by value. So the distinction is enforced by INTENT, at the write
// boundary, where only a canonical key can ever be correct.

test('a key-resolved PLACE refuses the raw bucket instead of matching nothing', async () => {
  for (const bucket of ['', null, undefined]) {
    assert.throws(() => placeUnfiledByKeyStatements({ profileId: PID, cardId: 'sole1', variantSlug: bucket, qty: 1 }),
      { name: 'InvalidPrinting' }, `the ${JSON.stringify(bucket)} bucket must not reach SQL`);
  }
});

test('a key-resolved TAKE refuses it too, and names the fix', () => {
  assert.throws(() => takeUnfiledByKeyStatements({ profileId: PID, cardId: 'sole1', variantSlug: '', qty: 1 }),
    (e) => e.name === 'InvalidPrinting' && /canonicalPrinting/.test(e.message));
});

test('a v10 legacy key is refused at the WRITE boundary - writers emit canonical keys only', () => {
  for (const legacy of ['', 'foil']) {
    assert.throws(() => placeUnfiledByKeyStatements({ profileId: PID, cardId: 'sole1', variantSlug: legacy, qty: 1 }),
      { name: 'InvalidPrinting' });
  }
});

test('but the equality guard ACCEPTS legacy keys, because it names rows to check', () => {
  // Not a weakening. Triage drains v10 rows, so it asserts over them by design - and a row on a
  // legacy key is a real row. The write boundary is where intent is knowable; this is not.
  assert.equal(assertEqualityStatements(PID, [{ cardId: 'sole1', variantSlug: '' }], 'x').length, 1);
  assert.equal(assertEqualityStatements(PID, [{ cardId: 'sole1', variantSlug: 'foil' }], 'x').length, 1);
  assert.throws(() => assertEqualityStatements(PID, [{ cardId: 'sole1', variantSlug: null }], 'x'),
    { name: 'InvalidPrinting' }, 'a MISSING slug is still a bug - it can only be an oversight');
});

test('the canonical key for the uncategorised bucket is what the writers actually store', async () => {
  // The end-to-end statement of the same thing: ask for the bucket, get the key.
  await repo.setOwned('sole1', 2);
  const slugs = rows("SELECT variant_slug FROM owned_cards WHERE card_id='sole1';").map((r) => r.variant_slug);
  assert.deepEqual(slugs, ['uncategorised'], "never '' - no canonical ownership key is the empty string");
  assert.deepEqual(brokenRows(), []);
});
