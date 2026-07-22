// resolveWantList against a REAL in-memory sql.js catalog (src/store/wantImport.js).
// Run: npm run test:query
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { resolveWantList, hasReviewContent } from './wantImport.js';
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
  const r = only(d.fixed);
  assert.equal(r.cardId, 'wb'); assert.equal(r.fixedSet, '001'); assert.equal(r.lockedFinish, null);
  assert.deepEqual(r.parts, [3]); assert.equal(r.qty, 3);
  assert.equal(d.needsChoice.length, 0);
});

test('a bare foil-only single-set line is a fixed row (its finish is forced foil by the planner)', async () => {
  // resolveWantList only fixes the SET; the batch policy in batchWantPlan forces foil for a
  // foil-only set. So the resolver marks fixedSet with no explicit lock.
  const d = await resolveWantList('1 Winter River');
  const r = only(d.fixed);
  assert.equal(r.fixedSet, '001'); assert.equal(r.lockedFinish, null);
  assert.equal(r.anyFoil, true, 'Alpha is foil-only, so foil is available');
});

test('a bare MULTI-set line needs a choice - never silently one set, never uncategorised', async () => {
  const d = await resolveWantList('2 Albespine Pikemen');
  assert.equal(d.fixed.length, 0);
  const row = only(d.needsChoice);
  assert.equal(row.cardId, 'mp');
  assert.equal(row.fixedSet, null);
  assert.deepEqual(row.sets.map((s) => s.code), ['001', '002']);
});

test('an annotated valid set is a fixed row (finish deferred to the batch)', async () => {
  const d = await resolveWantList('1 Albespine Pikemen [Beta]');
  const r = only(d.fixed);
  assert.equal(r.fixedSet, '002'); assert.equal(r.lockedFinish, null);
});

test('[Foil] on a card with a foil printing carries the lock; on one without stays fixed but impossible', async () => {
  const ok = only((await resolveWantList('1 Druid [Foil]')).fixed);
  assert.equal(ok.fixedSet, '999'); assert.equal(ok.lockedFinish, 'foil');
  // Wax Golem's sole set has no foil: still a fixed row (the set is known), but anyFoil false, so
  // the planner marks it an impossible lock.
  const bad = only((await resolveWantList('1 Wax Golem [Foil]')).fixed);
  assert.equal(bad.fixedSet, '001'); assert.equal(bad.lockedFinish, 'foil'); assert.equal(bad.anyFoil, false);
});

test('an annotated set that LACKS foil needs a choice (pick another set), with a reason', async () => {
  const d = await resolveWantList('1 Albespine Pikemen [Beta] [Foil]');
  const row = only(d.needsChoice);
  assert.match(row.reason, /no foil printing in Beta/);
  assert.equal(row.lockedFinish, 'foil');
});

test('an unknown name is surfaced, not written', async () => {
  const d = await resolveWantList('1 Nonexistent Card');
  assert.deepEqual(d.unknown, ['Nonexistent Card']);
  assert.equal(d.fixed.length, 0);
});

test('a malformed-quantity line is flagged, never resolved', async () => {
  const d = await resolveWantList('0 Wild Boars\n1.5 Druid');
  assert.equal(d.fixed.length, 0);
  assert.deepEqual(d.flagged.map((f) => f.problems[0]), ['quantity out of range', 'quantity out of range']);
});

test('two set ALIASES merge to one fixed row; two FINISH LOCKS stay distinct', async () => {
  const alias = await resolveWantList('1 Albespine Pikemen [Beta]\n1 Albespine Pikemen [002]');
  assert.equal(only(alias.fixed).qty, 2, 'aliases collapse, copies summed');
  const finishes = await resolveWantList('1 Druid\n1 Druid [Foil]');
  assert.equal(finishes.fixed.length, 2, 'Druid (batch finish) and Druid [Foil] lock are distinct rows');
});

test('ROUND TRIP: a formatted item re-imports to the same (card, set) fixed row', async () => {
  const line = formatItemLine({ qty: 4, name: 'Albespine Pikemen', set: 'Beta', foil: false });
  const r = only((await resolveWantList(line)).fixed);
  assert.equal(r.cardId, 'mp'); assert.equal(r.fixedSet, '002'); assert.equal(r.qty, 4);
});

test('the 2000-line ceiling is enforced before any catalog query', async () => {
  const text = Array.from({ length: MAX_BATCH_ITEMS + 1 }, () => '1 Wild Boars').join('\n');
  await assert.rejects(() => resolveWantList(text), (e) => e.name === 'ImportTooLarge');
});

test('hasReviewContent: unknown-only and flagged-only drafts DO open review; empty does not', async () => {
  const unknownOnly = await resolveWantList('1 Nonexistent Card');
  assert.equal(hasReviewContent(unknownOnly), true, 'an unknown-only paste must reach review to name the skip');
  const flaggedOnly = await resolveWantList('0 Wild Boars');
  assert.equal(hasReviewContent(flaggedOnly), true);
  const headerOnly = await resolveWantList('## Spellbook\n// a comment');
  assert.equal(hasReviewContent(headerOnly), false, 'only headers -> nothing to review');
});
