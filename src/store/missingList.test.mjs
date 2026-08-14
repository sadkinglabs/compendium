// generateMissingList - the "Missing for <deck>" flow (owner call 2026-08-14:
// deck Buildability saves missing cards as a dedicated, shareable wanted list,
// not the Wishlist). Run: npm run test:query
// Properties: creates a wanted list with the missing quantities, REPLACES a
// same-named list on regeneration (deterministic name, no "(1)" clutter), and
// never touches another profile's same-named list.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests, __resetWriteGateForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { generateMissingList } from './ownedRepository.js';

const require = createRequire(import.meta.url);
let sdb;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; }
  finally { st.free(); }
};

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  for (const m of MIGRATIONS) sdb.run(m.sql);
  __setBackendForTests({
    query(sql, params) {
      const st = sdb.prepare(sql);
      try { if (params && params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return Promise.resolve(r); }
      finally { st.free(); }
    },
    run(sql, params) { sdb.run(sql, params || []); return Promise.resolve(); },
    exec(sql) { sdb.run(sql); return Promise.resolve(); },
    tx(statements) {
      sdb.run('BEGIN;');
      try { for (const [s, p = []] of statements) sdb.run(s, p); sdb.run('COMMIT;'); }
      catch (e) { sdb.run('ROLLBACK;'); throw e; }
      return Promise.resolve();
    },
    persist() { return Promise.resolve(); },
  });
  __setActiveIdForTests('p1');
});

beforeEach(() => {
  __resetWriteGateForTests();
  sdb.run('DELETE FROM card_list_entries; DELETE FROM card_lists; DELETE FROM profiles;');
  sdb.run("INSERT INTO profiles(id,name,schema_version) VALUES('p1','Test',11);");
  __setActiveIdForTests('p1');
});

const LINES = [
  { card_id: 'alpha', missing: 3, owned: 1, required: 4 },
  { card_id: 'beta', missing: 1, owned: 2, required: 3 },
  { card_id: 'gamma', missing: 0, owned: 4, required: 4 },   // owned in full: excluded
];

test('creates a wanted list holding exactly the missing quantities', async () => {
  const r = await generateMissingList('Missing for Fire', LINES);
  assert.equal(r.created, true);
  assert.equal(r.count, 2);
  const list = rows("SELECT kind, name, profile_id FROM card_lists;")[0];
  assert.equal(list.kind, 'wanted');
  assert.equal(list.name, 'Missing for Fire');
  assert.equal(list.profile_id, 'p1');
  const entries = rows('SELECT card_id, quantity FROM card_list_entries ORDER BY card_id;');
  assert.deepEqual(entries, [{ card_id: 'alpha', quantity: 3 }, { card_id: 'beta', quantity: 1 }]);
});

test('regenerating REPLACES the same-named list - one list, fresh entries, same id', async () => {
  const first = await generateMissingList('Missing for Fire', LINES);
  const second = await generateMissingList('missing for fire', [{ card_id: 'beta', missing: 2 }]);   // case-insensitive match
  assert.equal(second.created, false);
  assert.equal(second.id, first.id);
  assert.equal(rows('SELECT COUNT(*) c FROM card_lists;')[0].c, 1);
  assert.deepEqual(rows('SELECT card_id, quantity FROM card_list_entries;'), [{ card_id: 'beta', quantity: 2 }]);
});

test("another profile's same-named list is never matched or touched", async () => {
  sdb.run("INSERT INTO profiles(id,name,schema_version) VALUES('p2','Other',11);");
  sdb.run("INSERT INTO card_lists(id,profile_id,kind,name,sort_order) VALUES('L2','p2','wanted','Missing for Fire',0);");
  sdb.run("INSERT INTO card_list_entries(id,list_id,card_id,quantity) VALUES('E2','L2','theirs',9);");
  const r = await generateMissingList('Missing for Fire', LINES);
  assert.equal(r.created, true);                              // p1 gets its OWN list
  assert.equal(rows('SELECT COUNT(*) c FROM card_lists;')[0].c, 2);
  assert.deepEqual(rows("SELECT card_id, quantity FROM card_list_entries WHERE list_id='L2';"), [{ card_id: 'theirs', quantity: 9 }]);
});
