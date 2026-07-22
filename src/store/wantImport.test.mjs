// resolveWantList against a REAL in-memory sql.js catalog (src/store/wantImport.js).
// Run: npm run test:query
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { resolveWantList } from './wantImport.js';
import { formatItemLine } from './itemLineGrammar.js';
import { MAX_BATCH_ITEMS } from './bulkWriteContract.js';

const require = createRequire(import.meta.url);
let sdb;
const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; } finally { st.free(); }
};

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  __setBackendForTests({
    query: (s, p = []) => Promise.resolve(rows(s, p)),
    run: (s, p = []) => { sdb.run(s, p); return Promise.resolve(); },
    exec: (s) => { sdb.run(s); return Promise.resolve(); },
    tx: () => Promise.resolve(),
    persist: () => Promise.resolve(),
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);
  const card = (id, name, sets, variants) => sdb.run('INSERT INTO cards(card_id,name,sets,variants) VALUES(?,?,?,?);', [id, name, JSON.stringify(sets), JSON.stringify(variants)]);
  // Multi-set, no foil anywhere.
  card('mp', 'Albespine Pikemen', [{ code: '001', name: 'Alpha' }, { code: '002', name: 'Beta' }], [{ set: '001', finish: 'Standard' }, { set: '002', finish: 'Standard' }]);
  card('wb', 'Wild Boars', [{ code: '001', name: 'Alpha' }], [{ set: '001', finish: 'Standard' }]);            // single, non-foil
  card('wr', 'Winter River', [{ code: '001', name: 'Alpha' }], [{ set: '001', finish: 'Foil' }]);              // single, foil-only
  card('dr', 'Druid', [{ code: '999', name: 'Promotional' }], [{ set: '999', finish: 'Standard' }, { set: '999', finish: 'Foil' }, { set: '999', finish: 'Rainbow' }]);   // both finishes
  card('wx', 'Wax Golem', [{ code: '001', name: 'Alpha' }], [{ set: '001', finish: 'Standard' }]);             // single, non-foil - impossible [Foil]
});

const only = (arr) => { assert.equal(arr.length, 1); return arr[0]; };

test('a bare single-set line resolves silently to non-foil', async () => {
  const d = await resolveWantList('3 Wild Boars');
  assert.deepEqual(only(d.resolved), { cardId: 'wb', name: 'Wild Boars', setCode: '001', foil: false, parts: [3], qty: 3 });
  assert.equal(d.needsChoice.length, 0);
});

test('a bare foil-only single-set line resolves to foil (P6)', async () => {
  const d = await resolveWantList('1 Winter River');
  assert.deepEqual(only(d.resolved).foil, true);
  assert.equal(only(d.resolved).setCode, '001');
});

test('a bare MULTI-set line needs a choice - never silently one set, never uncategorised', async () => {
  const d = await resolveWantList('2 Albespine Pikemen');
  assert.equal(d.resolved.length, 0);
  const row = only(d.needsChoice);
  assert.equal(row.cardId, 'mp');
  assert.equal(row.lockedFinish, null);
  assert.deepEqual(row.sets.map((s) => s.code), ['001', '002']);
});

test('an annotated valid set resolves directly', async () => {
  const d = await resolveWantList('1 Albespine Pikemen [Beta]');
  assert.deepEqual(only(d.resolved), { cardId: 'mp', name: 'Albespine Pikemen', setCode: '002', foil: false, parts: [1], qty: 1 });
});

test('[Foil] on a card with a foil printing resolves; on one without becomes an impossible lock', async () => {
  const ok = await resolveWantList('1 Druid [Foil]');
  assert.deepEqual(only(ok.resolved), { cardId: 'dr', name: 'Druid', setCode: '999', foil: true, parts: [1], qty: 1 });
  const bad = await resolveWantList('1 Wax Golem [Foil]');
  const row = only(bad.needsChoice);
  assert.equal(row.lockedFinish, 'foil');
  assert.equal(row.anyFoil, false, 'no printing supports foil - the lock is impossible');
});

test('an annotated set that lacks the requested finish needs a choice, with a reason', async () => {
  const d = await resolveWantList('1 Albespine Pikemen [Beta] [Foil]');
  const row = only(d.needsChoice);
  assert.match(row.reason, /no foil printing in Beta/);
  assert.equal(row.lockedFinish, 'foil');
});

test('an unknown name is surfaced, not written', async () => {
  const d = await resolveWantList('1 Nonexistent Card');
  assert.deepEqual(d.unknown, ['Nonexistent Card']);
  assert.equal(d.resolved.length, 0);
});

test('a malformed-quantity line is flagged, never resolved', async () => {
  const d = await resolveWantList('0 Wild Boars\n1.5 Druid');
  assert.equal(d.resolved.length, 0);
  assert.deepEqual(d.flagged.map((f) => f.problems[0]), ['quantity out of range', 'quantity out of range']);
});

test('two set ALIASES merge to one resolved item; two FINISHES stay distinct', async () => {
  const alias = await resolveWantList('1 Albespine Pikemen [Beta]\n1 Albespine Pikemen [002]');
  assert.equal(only(alias.resolved).qty, 2, 'aliases collapse, copies summed');
  const finishes = await resolveWantList('1 Druid\n1 Druid [Foil]');
  assert.equal(finishes.resolved.length, 2, 'Druid non-foil and Druid foil are distinct wants');
});

test('ROUND TRIP: a formatted resolved item re-imports to the same (card, set, foil, qty)', async () => {
  const line = formatItemLine({ qty: 4, name: 'Albespine Pikemen', set: 'Beta', foil: false });
  const d = await resolveWantList(line);
  assert.deepEqual(only(d.resolved), { cardId: 'mp', name: 'Albespine Pikemen', setCode: '002', foil: false, parts: [4], qty: 4 });
});

test('the 2000-line ceiling is enforced before any catalog query', async () => {
  const text = Array.from({ length: MAX_BATCH_ITEMS + 1 }, () => '1 Wild Boars').join('\n');
  await assert.rejects(() => resolveWantList(text), (e) => e.name === 'ImportTooLarge');
});
