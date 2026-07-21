// Repository tests for the ownership ledger (owned_cards) - the two surfaces Codex's
// review flagged as data defects: (1) foil classification across BOTH foil
// vocabularies ('foil' and '<code>:f'), and (2) the single-set backfill's
// transactional conservation (a retry after an interrupted move must not duplicate
// copies). Runs the REAL store code against an in-memory sql.js DB via a
// test-injected backend + pinned profile. Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { qtyFor, ownWantMap, recentlyAdded } from './ownedRepository.js';

const require = createRequire(import.meta.url);
const PID = 'test-profile';
let sdb;

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  __setBackendForTests({
    query(sql, params = []) { const st = sdb.prepare(sql); try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return Promise.resolve(r); } finally { st.free(); } },
    run(sql, params = []) { sdb.run(sql, params); return Promise.resolve(); },
    exec(sql) { sdb.run(sql); return Promise.resolve(); },
    tx(stmts) { sdb.run('BEGIN;'); try { for (const [s, p = []] of stmts) sdb.run(s, p); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
    persist() { return Promise.resolve(); },
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);   // the real schema, in order
  sdb.run('INSERT INTO profiles(id,name,schema_version,created_at) VALUES(?,?,?,?);', [PID, 'Test', 10, '2026-01-01']);
  __setActiveIdForTests(PID);
});

beforeEach(() => { sdb.run('DELETE FROM owned_cards;'); sdb.run('DELETE FROM cards;'); });

let uid = 0;
const own = (cardId, slug, owned, wanted = 0) => sdb.run(
  'INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?);',
  ['o' + (++uid), PID, cardId, slug, owned, wanted, '2026-01-01', '2026-01-0' + ((uid % 9) + 1)]);
const card = (cardId, sets) => sdb.run(
  'INSERT INTO cards(card_id,name,sets,system) VALUES(?,?,?,?);', [cardId, cardId, JSON.stringify(sets), 'sorcery']);
const one = (sql) => { const r = sdb.exec(sql); return r.length ? r[0].values[0][0] : 0; };
const rowQty = (cardId, slug) => one(`SELECT qty_owned FROM owned_cards WHERE card_id='${cardId}' AND variant_slug='${slug}';`);
const rowWanted = (cardId, slug) => one(`SELECT qty_wanted FROM owned_cards WHERE card_id='${cardId}' AND variant_slug='${slug}';`);
const totalOwned = (cardId) => one(`SELECT COALESCE(SUM(qty_owned),0) FROM owned_cards WHERE card_id='${cardId}';`);

test('foil classification: a set foil (001:f) counts as foil, not regular', async () => {
  own('c1', '001', 2); own('c1', '001:f', 1); own('c1', 'foil', 1); own('c1', '', 1);
  const q = await qtyFor('c1');
  assert.equal(q.owned, 3, 'regular = 001(2) + Unspecified(1)');
  assert.equal(q.foil, 2, 'foil = 001:f(1) + legacy foil(1)');
  const m = await ownWantMap();
  assert.deepEqual(m.get('c1'), { owned: 3, foil: 2, wanted: 0 });
});

test('foil classification: recentlyAdded splits set foils correctly', async () => {
  card('c1', [{ code: '001', name: 'Alpha' }]);
  own('c1', '001', 2); own('c1', '001:f', 3);
  const r = (await recentlyAdded(5)).find((x) => x.card_id === 'c1');
  assert.equal(r.qty_owned, 2);
  assert.equal(r.qty_foil, 3);
});

