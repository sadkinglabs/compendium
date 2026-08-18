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
import { qtyFor, ownWantMap, recentlyAdded, setOwnedInSet } from './ownedRepository.js';

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

beforeEach(() => { sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards;'); sdb.run('DELETE FROM cards;'); });

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

test('recentlyAdded splits ONE card owned across sets into ONE ROW PER PRINTING', async () => {
  // The Apprentice Wizard defect: a card owned in Beta and Promotional collapsed into one row
  // stamped with the last-touched pill over the wrong art. Each printing is now its own row with
  // its own set bucket and foil sub-count; the uncategorised keys fold to the '' bucket.
  card('aw', [{ code: '002', name: 'Beta' }, { code: '999', name: 'Promotional' }]);
  own('aw', '002', 2);            // Beta, non-foil
  own('aw', '999', 1);            // Promotional, non-foil
  own('aw', '999:f', 2);         // Promotional, foil
  own('aw', 'uncategorised', 1); // a stray uncategorised copy -> the '' bucket
  const rows = (await recentlyAdded(20)).filter((x) => x.card_id === 'aw');
  const bySet = new Map(rows.map((x) => [x.set_code, x]));
  assert.deepEqual([...bySet.keys()].sort(), ['', '002', '999']);
  assert.deepEqual({ o: bySet.get('002').qty_owned, f: bySet.get('002').qty_foil }, { o: 2, f: 0 }, 'Beta row');
  assert.deepEqual({ o: bySet.get('999').qty_owned, f: bySet.get('999').qty_foil }, { o: 1, f: 2 }, 'Promotional row, foil as a sub-count');
  assert.equal(bySet.get('').qty_owned, 1, 'uncategorised bucket');
  assert.ok('variants' in rows[0], 'variants selected so the row can resolve its per-set art');
});


test('v11 regression: emptying UNCATEGORISED owned preserves a migrated want on that row', async () => {
  // The guard that protects this row compared against the literal '' and went dead the moment
  // writers became canonical - vslug returns 'uncategorised' now, so every uncategorised
  // reduction fell through to a delete that took the want with it. Migration produces exactly
  // this row shape for an ambiguous reprint, so the loss would have landed on real data.
  card('cU', [{ code: '001', name: 'Alpha' }, { code: '002', name: 'Beta' }]);
  own('cU', 'uncategorised', 2, 1);
  await setOwnedInSet('cU', '', 0);
  assert.equal(rowQty('cU', 'uncategorised'), 0, 'the copies are gone');
  assert.equal(rowWanted('cU', 'uncategorised'), 1, 'the want survives');
});
