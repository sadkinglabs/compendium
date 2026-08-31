// The Folio repository (codexRepository.js, the `folios` section) against a REAL in-memory
// sql.js database with TWO profiles. Run: npm run test:query
//
// WHY THIS EXISTS. Folios are the Codex's user-made groupings of cards and articles. The rename
// from "collections" is a surface change - the tables are still `collections`/`collection_items`
// (the v13 table rename is designed and deferred) - but the same change added three profile gates
// that did not exist before: deleting a folio's items, reading a folio's items, and both arms of
// the item toggle all used to trust the folio id the caller handed in. A foreign id therefore
// reached the child table, which has no profile_id of its own to fall back on.
//
// So the point of this file is the failure mode, not the CRUD: every function is exercised with
// ANOTHER profile's folio id, and each refusal is asserted on ROW COUNTS read straight out of the
// database rather than on what the function returned. A return value can be right while the write
// still happened - toggleFolioItem in particular returns true on a refused insert - and a test that
// believed the return value would pass against a repository with no gates at all.
//
// Two quirks are PINNED here rather than fixed, because the UI depends on neither and changing
// them is a product decision:
//   1. the dedup key is (collection_id, target_id) and ignores target_type;
//   2. toggleFolioItem returns true even when its guarded insert matched no folio.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import {
  listFolios, createFolio, foliosForTarget, renameFolio, deleteFolio, folioItems, toggleFolioItem,
} from './codexRepository.js';

const require = createRequire(import.meta.url);
const TS = '2026-03-04T05:06:07.000Z';

let sdb;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; }
  finally { st.free(); }
};
/** Row counts read straight from the tables - the only honest witness for a refusal. */
const folioRows = (pid) => rows('SELECT id, name FROM collections WHERE profile_id=? ORDER BY name;', [pid]);
const itemCount = (folioId) => rows('SELECT COUNT(*) n FROM collection_items WHERE collection_id=?;', [folioId])[0].n;
const allItemCount = () => rows('SELECT COUNT(*) n FROM collection_items;')[0].n;

/** Seed a folio directly, so the fixture never depends on the code under test. */
const seedFolio = (id, pid, name, createdAt = TS) =>
  sdb.run('INSERT INTO collections(id,profile_id,name,created_at) VALUES(?,?,?,?);', [id, pid, name, createdAt]);
const seedItem = (id, folioId, type, targetId, addedAt = TS) =>
  sdb.run('INSERT INTO collection_items(id,collection_id,target_type,target_id,added_at) VALUES(?,?,?,?,?);',
    [id, folioId, type, targetId, addedAt]);

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
  for (const id of ['A', 'B']) {
    sdb.run('INSERT INTO profiles(id,name,schema_version,created_at) VALUES(?,?,?,?);', [id, id, 10, TS]);
  }
  // Catalog rows for the name resolver: a card resolves by card_id, an article by rule_id,
  // and anything else falls back to its raw id.
  sdb.run("INSERT INTO cards(card_id,name,system,sets) VALUES('sentinel_card','Sentinel','sorcery','[{\"code\":\"001\"}]');");
  sdb.run("INSERT INTO rules(rule_id,parent_id,title,content,system) VALUES('rule_airborne',NULL,'Airborne','body','sorcery');");
});

beforeEach(() => {
  sdb.run('DELETE FROM collection_items;');
  sdb.run('DELETE FROM collections;');
  __setActiveIdForTests('A');
});

/* ---------------- CRUD ---------------- */

test('createFolio / listFolios / renameFolio / deleteFolio round-trip under one profile', async () => {
  const id = await createFolio('Openings');
  assert.equal(folioRows('A').length, 1, 'one folio row exists in the table');

  let list = await listFolios();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Openings');
  assert.equal(list[0].id, id);

  await renameFolio(id, 'Opening Lines');
  assert.deepEqual(folioRows('A').map((f) => f.name), ['Opening Lines']);

  await deleteFolio(id);
  assert.equal(folioRows('A').length, 0, 'the folio row is gone');
  assert.deepEqual(await listFolios(), []);
});

test('listFolios carries each folio item count, and zero for an empty one', async () => {
  seedFolio('f-full', 'A', 'Full');
  seedFolio('f-empty', 'A', 'Empty');
  seedItem('i-1', 'f-full', 'card', 'sentinel_card');
  seedItem('i-2', 'f-full', 'rule', 'rule_airborne');

  const byName = new Map((await listFolios()).map((f) => [f.name, f.count]));
  assert.equal(byName.get('Full'), 2);
  assert.equal(byName.get('Empty'), 0, 'an empty folio counts 0, not undefined');
});

test('listFolios is newest-first', async () => {
  // created_at has millisecond resolution, so three creates in a tight loop can tie. The
  // fixture stamps distinct timestamps instead - what is under test is the ORDER BY, not
  // the clock.
  seedFolio('f-old', 'A', 'Oldest', '2026-01-01T00:00:00.000Z');
  seedFolio('f-mid', 'A', 'Middle', '2026-02-01T00:00:00.000Z');
  seedFolio('f-new', 'A', 'Newest', '2026-03-01T00:00:00.000Z');
  assert.deepEqual((await listFolios()).map((f) => f.name), ['Newest', 'Middle', 'Oldest']);
});

test('deleteFolio removes the folio AND its items - no orphans left behind', async () => {
  seedFolio('f-1', 'A', 'Doomed');
  seedItem('i-1', 'f-1', 'card', 'sentinel_card');
  seedItem('i-2', 'f-1', 'rule', 'rule_airborne');
  await deleteFolio('f-1');
  assert.equal(folioRows('A').length, 0);
  assert.equal(allItemCount(), 0, 'the child rows went with the parent');
});

/* ---------------- the Add to Folio picker ---------------- */

test('PICKER FLOW: create a folio from the sheet, and the target is in it', async () => {
  // What FolioPicker does on "Add": create, then toggle the current entry in.
  const id = await createFolio('Reference');
  await toggleFolioItem(id, 'card', 'sentinel_card');
  assert.equal(itemCount(id), 1, 'the target really was written');

  const picker = await foliosForTarget('sentinel_card');
  assert.equal(picker.length, 1);
  assert.equal(picker[0].name, 'Reference');
  assert.equal(picker[0].inIt, 1, 'the picker row reads as already in');

  // A second target is not in it, and toggling the first one back out empties the folio.
  const other = await foliosForTarget('rule_airborne');
  assert.equal(other[0].inIt, 0);
  assert.equal(await toggleFolioItem(id, 'card', 'sentinel_card'), false, 'the second tap removes');
  assert.equal(itemCount(id), 0);
  assert.equal((await foliosForTarget('sentinel_card'))[0].inIt, 0);
});

test('foliosForTarget is newest-first, and lists folios the target is not in', async () => {
  seedFolio('f-old', 'A', 'Oldest', '2026-01-01T00:00:00.000Z');
  seedFolio('f-new', 'A', 'Newest', '2026-03-01T00:00:00.000Z');
  seedItem('i-1', 'f-old', 'card', 'sentinel_card');
  const picker = await foliosForTarget('sentinel_card');
  assert.deepEqual(picker.map((f) => [f.name, f.inIt]), [['Newest', 0], ['Oldest', 1]]);
});

/* ---------------- pinned quirk: the dedup key ignores target_type ---------------- */

test('QUIRK (pinned, not fixed): the dedup key is (folio, target_id) and ignores target_type', async () => {
  // A card and an article that happened to share an id are ONE entry as far as the toggle is
  // concerned: adding the card then "adding" the article of the same id removes the card
  // instead. Nothing in the product can reach this today (card_ids and rule_ids do not
  // collide), and the fix is a schema-shaped decision, so it is pinned rather than repaired.
  const id = await createFolio('Ambiguous');
  assert.equal(await toggleFolioItem(id, 'card', 'shared_id'), true);
  assert.equal(itemCount(id), 1);

  assert.equal(await toggleFolioItem(id, 'rule', 'shared_id'), false,
    'the differently-typed target matched the existing row and toggled it OUT');
  assert.equal(itemCount(id), 0, 'so the card entry is gone and the rule entry was never added');

  // The same blindness in the picker read: the EXISTS clause matches on target_id alone.
  await toggleFolioItem(id, 'card', 'shared_id');
  const picker = await foliosForTarget('shared_id');
  assert.equal(picker[0].inIt, 1, 'reads as in it whatever type the caller means');
});

/* ---------------- name resolution ---------------- */

test('folioItems resolves card names, article titles, and falls back to the raw id', async () => {
  seedFolio('f-1', 'A', 'Mixed');
  seedItem('i-card', 'f-1', 'card', 'sentinel_card', '2026-01-03T00:00:00.000Z');
  seedItem('i-rule', 'f-1', 'rule', 'rule_airborne', '2026-01-02T00:00:00.000Z');
  seedItem('i-ghost', 'f-1', 'card', 'deleted_from_catalog', '2026-01-01T00:00:00.000Z');

  const items = await folioItems('f-1');
  assert.deepEqual(items.map((r) => [r.target_type, r.name]), [
    ['card', 'Sentinel'],                    // cards.name
    ['rule', 'Airborne'],                    // rules.title
    ['card', 'deleted_from_catalog'],        // no catalog row: the id stands in, the row survives
  ], 'newest-added first, each resolved to what it can be');
});

/* ---------------- cross-profile refusal, asserted on row counts ---------------- */
//
// B is active throughout; every call is handed one of A's ids. Nothing may move, and the
// assertions read the tables directly because the return values cannot prove it.

test('REFUSAL listFolios: B never sees A folios, and A still has them', async () => {
  seedFolio('f-a', 'A', 'A Folio');
  __setActiveIdForTests('B');
  assert.deepEqual(await listFolios(), [], 'B lists nothing');
  assert.equal(folioRows('A').length, 1, "and A's row is still there to have been leaked");
});

test('REFUSAL createFolio: a folio is born to the ACTIVE profile, never the other one', async () => {
  __setActiveIdForTests('B');
  await createFolio("B's Own");
  assert.equal(folioRows('B').length, 1);
  assert.equal(folioRows('A').length, 0, 'nothing was created under A');
});

test('REFUSAL foliosForTarget: the picker under B offers no A folio', async () => {
  seedFolio('f-a', 'A', 'A Folio');
  seedItem('i-1', 'f-a', 'card', 'sentinel_card');
  __setActiveIdForTests('B');
  assert.deepEqual(await foliosForTarget('sentinel_card'), [], 'no foreign folio is offered');
  assert.equal(itemCount('f-a'), 1, "and A's item was not disturbed by the read");
});

test("REFUSAL renameFolio: B cannot rename A's folio", async () => {
  seedFolio('f-a', 'A', 'A Folio');
  __setActiveIdForTests('B');
  await renameFolio('f-a', 'Renamed By B');
  assert.deepEqual(folioRows('A').map((f) => f.name), ['A Folio'], 'the name is untouched');
  assert.equal(rows("SELECT COUNT(*) n FROM collections WHERE name='Renamed By B';")[0].n, 0);
});

test("REFUSAL deleteFolio: B deletes neither A's folio NOR its items", async () => {
  // The gate under test is the IN-subquery on the child delete. Without it the parent survives
  // (it was already gated) and the ITEMS vanish - a foreign profile silently emptying a folio,
  // which is why this asserts the child count and not just the parent.
  seedFolio('f-a', 'A', 'A Folio');
  seedItem('i-1', 'f-a', 'card', 'sentinel_card');
  seedItem('i-2', 'f-a', 'rule', 'rule_airborne');
  __setActiveIdForTests('B');
  await deleteFolio('f-a');
  assert.equal(folioRows('A').length, 1, 'the folio row survived');
  assert.equal(itemCount('f-a'), 2, 'and so did both of its items');
});

test("REFUSAL folioItems: B reading A's folio id gets nothing, while the rows still exist", async () => {
  seedFolio('f-a', 'A', 'A Folio');
  seedItem('i-1', 'f-a', 'card', 'sentinel_card');
  seedItem('i-2', 'f-a', 'rule', 'rule_airborne');
  __setActiveIdForTests('B');
  assert.deepEqual(await folioItems('f-a'), [], 'a foreign folio reads empty');
  assert.equal(itemCount('f-a'), 2, 'the rows are there - the read refused them, it did not miss them');
});

test("REFUSAL toggleFolioItem (insert arm): B cannot add into A's folio", async () => {
  seedFolio('f-a', 'A', 'A Folio');
  __setActiveIdForTests('B');
  const got = await toggleFolioItem('f-a', 'card', 'sentinel_card');
  assert.equal(itemCount('f-a'), 0, 'the guarded INSERT ... SELECT matched no folio, so nothing was written');
  assert.equal(allItemCount(), 0, 'and it did not land anywhere else either');
  // QUIRK (pinned, not fixed): the guard lives in the statement and the row count is never read
  // back, so the refusal is reported as a success. Harmless today - B's picker cannot show A's
  // folio in the first place - and pinned so a future caller that trusts this value finds it
  // documented rather than surprising.
  assert.equal(got, true, 'a refused cross-profile insert still returns true');
});

test("REFUSAL toggleFolioItem (delete arm): B cannot remove an item from A's folio", async () => {
  seedFolio('f-a', 'A', 'A Folio');
  seedItem('i-1', 'f-a', 'card', 'sentinel_card');
  __setActiveIdForTests('B');
  const got = await toggleFolioItem('f-a', 'card', 'sentinel_card');
  assert.equal(itemCount('f-a'), 1, "A's item survived - the gated probe never matched it");
  assert.equal(got, true, 'the ungated probe would have returned false after deleting it');
  assert.equal(allItemCount(), 1, 'and no stray row was inserted under B either');
});

test('and after all that refusing, A can still work its own folio normally', async () => {
  // A refusal test suite that gated everything to death would pass too. This is the control.
  seedFolio('f-a', 'A', 'A Folio');
  seedItem('i-1', 'f-a', 'card', 'sentinel_card');
  __setActiveIdForTests('A');
  assert.equal((await folioItems('f-a')).length, 1);
  assert.equal(await toggleFolioItem('f-a', 'card', 'sentinel_card'), false);
  assert.equal(itemCount('f-a'), 0);
  await deleteFolio('f-a');
  assert.equal(folioRows('A').length, 0);
});
