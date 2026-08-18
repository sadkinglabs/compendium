// The Storage pillar's reads and container lifecycle.
//
// The interesting case is DELETING a container, and it is interesting for a reason worth stating:
// copies cannot be nowhere, so a delete MOVES them to Unfiled rather than removing them. That move
// has to merge with whatever is already loose, because the unique index on
// (container_id, owned_card_id) forbids a card sitting in one place twice - and the row it would
// collide with is a row this very statement is moving. Get that wrong and either the delete fails
// outright or copies quietly double.
//
// Every test here asserts the equality afterwards, because the entire point of a container
// operation is that it changes WHERE copies are and never HOW MANY.
// Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { __resetCollectionWritesForTests } from './collectionWrites.js';
import {
  listContainers, containerContents, getContainer, createContainer, updateContainer,
  deleteContainer, unfiledId, MAX_CONTAINER_NAME,
} from './storageDirectory.js';

const require = createRequire(import.meta.url);
const PID = 'p1';
const UNFILED = 'u1';
let sdb;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; } finally { st.free(); }
};
const broken = () => rows(`
  SELECT o.id, o.qty_owned, COALESCE((SELECT SUM(a.qty) FROM storage_allocations a WHERE a.owned_card_id=o.id),0) placed
    FROM owned_cards o WHERE o.profile_id=?;`, [PID])
  .filter((r) => Number(r.qty_owned) !== Number(r.placed))
  .map((r) => `${r.id}: owns ${r.qty_owned}, placed ${r.placed}`);
const at = (container, ownedId) => rows('SELECT qty FROM storage_allocations WHERE container_id=? AND owned_card_id=?;', [container, ownedId])[0]?.qty ?? null;

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
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES(?,'Home',12,'T');", [PID]);
  sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at) VALUES(?,?,'unfiled','Unfiled','','gold',-1,1,'T','T');", [UNFILED, PID]);
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('c1','Alpha Card','[{\"code\":\"001\"}]');");
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('c2','Beta Card','[{\"code\":\"002\"}]');");
  __resetCollectionWritesForTests();
});

/** An owned row with its copies split between Unfiled and one named container. */
const seed = (id, cardId, slug, owned, { into = null, filed = 0 } = {}) => {
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,0,'','T','T');", [id, PID, cardId, slug, owned]);
  if (into && filed > 0) sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,?,?,'T','T');", [`${id}-f`, PID, into, id, filed]);
  const loose = owned - filed;
  if (loose > 0) sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,?,?,'T','T');", [`${id}-u`, PID, UNFILED, id, loose]);
};

/* ---------------- reads ---------------- */

test('the container list counts ITEMS and COPIES separately, because they answer different questions', async () => {
  const b = await createContainer({ name: 'Trade Binder', kind: 'binder', colour: 'jade' });
  seed('o1', 'c1', '001', 4, { into: b, filed: 3 });
  seed('o2', 'c2', '002', 2, { into: b, filed: 2 });
  const list = await listContainers();
  const binder = list.find((c) => c.id === b);
  assert.equal(binder.cards, 2, 'two different cards');
  assert.equal(binder.copies, 5, 'five sleeves used');
  assert.equal(list.find((c) => c.is_system).copies, 1, 'the one loose copy');
});

test('Unfiled sorts first and an empty container still appears', async () => {
  await createContainer({ name: 'Zed Box', kind: 'box' });
  await createContainer({ name: 'Alpha Binder', kind: 'binder' });
  const list = await listContainers();
  assert.equal(list[0].name, 'Unfiled', 'the system place is always first');
  assert.deepEqual(list.slice(1).map((c) => c.name), ['Zed Box', 'Alpha Binder'],
    'then creation order, NOT alphabetical - a rename must not resequence the list under the user');
  assert.equal(list[1].copies, 0, 'an empty container is still a place that exists');
});

test('container contents report the quantity IN THIS PLACE, alongside the owned total', async () => {
  const b = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 5, { into: b, filed: 2 });
  const [row] = await containerContents(b);
  assert.equal(row.qty, 2, 'what is in the binder');
  assert.equal(row.qty_owned, 5, 'and what they own in total');
  assert.equal(row.name, 'Alpha Card', 'joined to the catalog so a row can render itself');
});

/* ---------------- naming ---------------- */

test('a blank name is refused, and so is impersonating Unfiled', async () => {
  await assert.rejects(() => createContainer({ name: '   ' }), { name: 'InvalidContainer' });
  await assert.rejects(() => createContainer({ name: 'unfiled' }), { name: 'InvalidContainer' },
    'case-insensitively - two places called Unfiled is indistinguishable in every later surface');
});

test('a duplicate name is refused, but renaming a container to its own name is not', async () => {
  const a = await createContainer({ name: 'Binder' });
  await assert.rejects(() => createContainer({ name: 'binder' }), { name: 'InvalidContainer' });
  await updateContainer(a, { name: 'Binder', colour: 'ruby' });   // must not trip on itself
  assert.equal((await getContainer(a)).colour, 'ruby');
});

test('names are trimmed and bounded; unknown kinds and colours are rejected outright', async () => {
  const id = await createContainer({ name: `  ${'x'.repeat(200)}  ` });
  assert.equal((await getContainer(id)).name.length, MAX_CONTAINER_NAME);
  await assert.rejects(() => createContainer({ name: 'A', kind: 'unfiled' }), { name: 'InvalidContainer' },
    'the system kind is not a user choice');
  await assert.rejects(() => createContainer({ name: 'B', colour: 'rgb(1,2,3)' }), { name: 'InvalidContainer' },
    'colour is written to the DB and ends up in a CSS custom property');
});

test('Unfiled cannot be renamed or deleted', async () => {
  const u = await unfiledId();
  await assert.rejects(() => updateContainer(u, { name: 'Loose' }), { name: 'InvalidContainer' });
  await assert.rejects(() => deleteContainer(u), { name: 'InvalidContainer' });
  assert.equal((await getContainer(u)).name, 'Unfiled');
});

/* ---------------- deletion: copies move, they never vanish ---------------- */

test('deleting a container moves its copies to Unfiled', async () => {
  const b = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 3, { into: b, filed: 3 });   // nothing loose
  await deleteContainer(b);
  assert.deepEqual(broken(), []);
  assert.equal(at(UNFILED, 'o1'), 3, 'the copies are loose now, not gone');
  assert.equal((await listContainers()).length, 1);
});

test('deleting MERGES with copies already loose, rather than colliding with them', async () => {
  // The unique index forbids one card in one place twice, and the row the move would collide with
  // is a row the same statement is moving. This is the case that breaks a naive re-parent.
  const b = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 5, { into: b, filed: 2 });   // 2 filed, 3 loose
  await deleteContainer(b);
  assert.deepEqual(broken(), []);
  assert.equal(at(UNFILED, 'o1'), 5, 'merged into one row of five');
  assert.equal(rows("SELECT id FROM storage_allocations WHERE owned_card_id='o1';").length, 1, 'one place, not two');
});

test('a mixed container - some cards loose, some not - merges only what needs it', async () => {
  const b = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 4, { into: b, filed: 1 });   // also loose
  seed('o2', 'c2', '002', 2, { into: b, filed: 2 });   // filed ONLY here
  await deleteContainer(b);
  assert.deepEqual(broken(), []);
  assert.equal(at(UNFILED, 'o1'), 4);
  assert.equal(at(UNFILED, 'o2'), 2, 'the wholesale re-parent picked up the un-merged one');
  assert.equal(rows('SELECT id FROM storage_allocations;').length, 2);
});

test('deleting an EMPTY container touches no allocation at all', async () => {
  const b = await createContainer({ name: 'Empty' });
  seed('o1', 'c1', '001', 2);
  const before = rows('SELECT id, container_id, qty FROM storage_allocations ORDER BY id;');
  await deleteContainer(b);
  assert.deepEqual(rows('SELECT id, container_id, qty FROM storage_allocations ORDER BY id;'), before);
  assert.deepEqual(broken(), []);
});

test('deleting one container leaves copies in the OTHER container alone', async () => {
  const a = await createContainer({ name: 'A' });
  const b = await createContainer({ name: 'B' });
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('o1',?,'c1','001',6,0,'','T','T');", [PID]);
  for (const [cid, q, n] of [[a, 2, 'a'], [b, 3, 'b'], [UNFILED, 1, 'u']]) {
    sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,'o1',?,'T','T');", [`x-${n}`, PID, cid, q]);
  }
  await deleteContainer(a);
  assert.deepEqual(broken(), []);
  assert.equal(at(b, 'o1'), 3, 'B is untouched');
  assert.equal(at(UNFILED, 'o1'), 3, 'A’s two joined the one already loose');
});

test('deleting a container never changes what the user OWNS', async () => {
  const b = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 5, { into: b, filed: 2 });
  seed('o2', 'c2', '002', 3, { into: b, filed: 3 });
  const ownedBefore = rows('SELECT id, qty_owned FROM owned_cards ORDER BY id;');
  await deleteContainer(b);
  assert.deepEqual(rows('SELECT id, qty_owned FROM owned_cards ORDER BY id;'), ownedBefore,
    'a container is where copies are, never how many there are');
  assert.deepEqual(broken(), []);
});
