// The Library's manual order.
//
// The only property that matters here is that the arrangement the user let go of is the arrangement
// `listDecks` reads back. That query sorts `starred DESC, lib_order ASC, name ASC`, so a favourite
// outranks lib_order whatever number it carries - which makes "the write refused an order the query
// cannot reproduce" a correctness test, not a style one.
// Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { reorderDecks, listDecks } from './deckRepository.js';

const require = createRequire(import.meta.url);
const PID = 'p1';
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
    tx: (st) => { sdb.run('BEGIN;'); try { st.forEach(([s, p = []]) => sdb.run(s, p)); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
    exec: (s) => { sdb.run(s); return Promise.resolve(); },
    persist: () => Promise.resolve(),
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);
  __setActiveIdForTests(PID);
});

beforeEach(() => {
  sdb.run('DELETE FROM deck_entries; DELETE FROM decks; DELETE FROM profiles;');
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES(?,'Home',12,'T');", [PID]);
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES('p2','Theirs',12,'T');");
});

/** A deck row placed directly, so the fixture states its starred flag and lib_order outright. */
const deck = (id, name, { pid = PID, starred = 0, order = 1 } = {}) => {
  sdb.run(
    `INSERT INTO decks(id,profile_id,name,slug,archetype,avatar_card_id,wins,losses,starred,lib_order,created_at,updated_at)
     VALUES(?,?,?,?,'',NULL,0,0,?,?,'T','T');`,
    [id, pid, name, name.toLowerCase(), starred, order],
  );
  return id;
};
const libraryOrder = async () => (await listDecks()).map((d) => d.name);
const orderOf = (pid = PID) => rows('SELECT id, lib_order FROM decks WHERE profile_id=? ORDER BY id;', [pid])
  .map((r) => `${r.id}:${r.lib_order}`);

test('a dropped arrangement is what the Library reads back', async () => {
  deck('a', 'A', { order: 1 }); deck('b', 'B', { order: 2 }); deck('c', 'C', { order: 3 });
  assert.deepEqual(await libraryOrder(), ['A', 'B', 'C']);
  await reorderDecks(['c', 'a', 'b']);
  assert.deepEqual(await libraryOrder(), ['C', 'A', 'B']);
  await reorderDecks(['b', 'c', 'a']);
  assert.deepEqual(await libraryOrder(), ['B', 'C', 'A']);
  assert.deepEqual(orderOf(), ['a:3', 'b:1', 'c:2'], 'positions are 1-based and contiguous');
});

test('it repairs decks that share a lib_order, where name was silently breaking the tie', async () => {
  deck('a', 'Aaa', { order: 0 }); deck('z', 'Zzz', { order: 0 });
  assert.deepEqual(await libraryOrder(), ['Aaa', 'Zzz'], 'alphabetical, because lib_order says nothing');
  await reorderDecks(['z', 'a']);
  assert.deepEqual(await libraryOrder(), ['Zzz', 'Aaa']);
});

test('THE STARRED CLAMP: an order the query cannot reproduce is refused, not written', async () => {
  deck('s1', 'Fav1', { starred: 1, order: 1 });
  deck('s2', 'Fav2', { starred: 1, order: 2 });
  deck('p1', 'Plain1', { starred: 0, order: 3 });
  deck('p2', 'Plain2', { starred: 0, order: 4 });
  assert.deepEqual(await libraryOrder(), ['Fav1', 'Fav2', 'Plain1', 'Plain2']);
  const before = orderOf();
  const refuses = async (ids, why) => {
    await assert.rejects(() => reorderDecks(ids), { name: 'InvalidDeckOrder' }, why);
    assert.deepEqual(orderOf(), before, 'and nothing partial was written');
  };
  await refuses(['s1', 'p1', 's2', 'p2'], 'a favourite dragged below a plain deck');
  await refuses(['p1', 'p2', 's1', 's2'], 'the whole favourite block dragged under');
  await refuses(['s1', 's2', 'p2', 'p1'].slice(1).concat('s1'), 'a favourite stranded at the end');
  // Reordering WITHIN each run is exactly what the clamp permits.
  await reorderDecks(['s2', 's1', 'p2', 'p1']);
  assert.deepEqual(await libraryOrder(), ['Fav2', 'Fav1', 'Plain2', 'Plain1']);
});

test('the id set must match EXACTLY - a filtered, padded or duplicated order writes nothing', async () => {
  deck('a', 'A', { order: 1 }); deck('b', 'B', { order: 2 }); deck('c', 'C', { order: 3 });
  const before = orderOf();
  const refuses = async (ids, why) => {
    await assert.rejects(() => reorderDecks(ids), { name: 'InvalidDeckOrder' }, why);
    assert.deepEqual(orderOf(), before, 'and nothing partial was written');
  };
  await refuses(['c', 'a'], 'the Library has a search field - a filtered order would demote the hidden decks');
  await refuses(['c', 'a', 'b', 'ghost'], 'an id this profile does not own');
  await refuses(['c', 'c', 'a'], 'a duplicate cannot describe a position for every deck');
  await refuses([], 'an empty order is not "leave it alone"');
  await refuses(['a', 'b', 'b'], 'right length by accident, wrong membership');
});

test('reordering one profile leaves another profile’s library untouched', async () => {
  deck('a', 'A', { order: 1 }); deck('b', 'B', { order: 2 });
  deck('t1', 'T1', { pid: 'p2', order: 1 }); deck('t2', 'T2', { pid: 'p2', order: 2 });
  await reorderDecks(['b', 'a']);
  assert.deepEqual(await libraryOrder(), ['B', 'A']);
  assert.deepEqual(orderOf('p2'), ['t1:1', 't2:2'], 'the other profile never moved');
  // An id from the other profile cannot be smuggled in through the UI's ordering - not when it
  // lengthens the list, and not when it SUBSTITUTES for one of ours and the count still adds up.
  // The second shape is the dangerous one: without membership validation it would renumber the
  // decks it did recognise and leave a half-applied order behind.
  await assert.rejects(() => reorderDecks(['b', 'a', 't1']), { name: 'InvalidDeckOrder' });
  await assert.rejects(() => reorderDecks(['t1', 'a']), { name: 'InvalidDeckOrder' });
  assert.deepEqual(orderOf(), ['a:2', 'b:1'], 'ours is untouched by the substitution attempt');
  assert.deepEqual(orderOf('p2'), ['t1:1', 't2:2']);
  // And the other profile's own reorder is scoped to it.
  await reorderDecks(['t2', 't1'], 'p2');
  assert.deepEqual(orderOf('p2'), ['t1:2', 't2:1']);
  assert.deepEqual(orderOf(), ['a:2', 'b:1'], 'still ours');
});
