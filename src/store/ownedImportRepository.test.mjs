// The transactional OWNED text-import writer, against a REAL in-memory sql.js database.
//
// Same protocol as the want command, so the same rigor: a pure whole-batch validator, the barrier
// serialization proven by a guarded/control counterfactual (final 3 vs 2), a production-wiring
// test that fails under a pass-through, and the write-outcome contract. Plus the owned-specific
// rules: an EMPTY setCode is a legitimate uncategorised item (a want may never be), and finish is
// carried end to end so `[Beta] [Foil]` files 002:f, not a Beta non-foil ledger lie.
//
// The END-TO-END section drives the real chain - grammar -> previewCollectionText ->
// planCollectionImport -> buildImportItems -> importCollectionResolved -> ledger readback - and
// asserts the exact stored slugs (002, 002:f, uncategorised:f), the brief's required evidence.
// Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { enqueueWrite, withExclusiveCollectionWrites, __resetCollectionWritesForTests } from './collectionWrites.js';
import { ownedRowKey, previewCollectionText } from './ownedRepository.js';
import {
  createOwnedImportCommand, planOwnedItemBatch, importCollectionResolved, MAX_ITEM_QTY, MAX_BATCH_ITEMS,
} from './ownedImportRepository.js';
import { planCollectionImport, buildImportItems } from './importPlan.js';

const require = createRequire(import.meta.url);
const PID = 'p1';
let sdb;
let notifyCount = 0;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; } finally { st.free(); }
};
const runTx = (stmts) => {
  sdb.run('BEGIN;');
  try { for (const [s, p = []] of stmts) sdb.run(s, p); sdb.run('COMMIT;'); }
  catch (e) { sdb.run('ROLLBACK;'); throw e; }
  return Promise.resolve();
};
const ownOf = (slug, cardId = 'c1', pid = PID) =>
  rows('SELECT qty_owned FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, slug])[0]?.qty_owned ?? 0;
const seedOwn = (slug, owned, cardId = 'c1', pid = PID) =>
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?);',
    [`s-${pid}-${cardId}-${slug}`, pid, cardId, slug, owned, '', 'x', 'x']);

let n = 0;
const deps = (exclusive, over = {}) => ({
  exclusive,
  query: (s, p = []) => Promise.resolve(rows(s, p)),
  tx: runTx,
  notify: () => { notifyCount++; },
  uuid: () => `u${++n}`,
  nowIso: () => 'x',
  activeProfileId: () => PID,
  ...over,
});
const cmd = (exclusive = (fn) => fn(), over = {}) => createOwnedImportCommand(deps(exclusive, over)).importCollectionResolved;
// c1: Alpha (both finishes) + Beta (Standard only).
const catalog = (variants) => new Map([['c1', { card_id: 'c1', sets: '[{"code":"001","name":"Alpha"},{"code":"002","name":"Beta"}]', variants: JSON.stringify(variants) }]]);
const CV = [{ set: '001', finish: 'Standard' }, { set: '001', finish: 'Foil' }, { set: '002', finish: 'Standard' }];

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  __setBackendForTests({
    query: (s, p = []) => Promise.resolve(rows(s, p)),
    run: (s, p = []) => { sdb.run(s, p); return Promise.resolve(); },
    exec: (s) => { sdb.run(s); return Promise.resolve(); },
    tx: runTx,
    persist: () => Promise.resolve(),
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES('p1','A',11,'x');");
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES('p2','B',11,'x');");
  sdb.run(`INSERT INTO cards(card_id,name,sets,variants) VALUES('c1','C',
    '[{"code":"001","name":"Alpha"},{"code":"002","name":"Beta"}]',
    '${JSON.stringify(CV)}');`);
  // End-to-end fixtures: Albespine Pikemen (ap) - Alpha + Beta, Beta has Standard AND Foil so
  // [Beta] and [Beta] [Foil] resolve to 002 / 002:f. Wild Boars (wb) - multi-set, so a bare [Foil]
  // line cannot resolve and lands uncategorised.
  sdb.run(`INSERT INTO cards(card_id,name,sets,variants) VALUES('ap','Albespine Pikemen',
    '[{"code":"001","name":"Alpha"},{"code":"002","name":"Beta"}]',
    '[{"set":"001","finish":"Standard"},{"set":"002","finish":"Standard"},{"set":"002","finish":"Foil"}]');`);
  sdb.run(`INSERT INTO cards(card_id,name,sets,variants) VALUES('wb','Wild Boars',
    '[{"code":"001","name":"Alpha"},{"code":"002","name":"Beta"}]',
    '[{"set":"001","finish":"Standard"},{"set":"002","finish":"Standard"}]');`);
  // Winter River (wr): a single-set card whose sole Alpha printing is FOIL-ONLY. A bare line must
  // resolve to 001:f by P6, not a non-foil phantom the hardened writer would reject.
  sdb.run(`INSERT INTO cards(card_id,name,sets,variants) VALUES('wr','Winter River',
    '[{"code":"001","name":"Alpha"}]', '[{"set":"001","finish":"Foil"}]');`);
  __setActiveIdForTests(PID);
});

beforeEach(() => { sdb.run('DELETE FROM owned_cards;'); __resetCollectionWritesForTests(); notifyCount = 0; });

/* ---------------- planOwnedItemBatch (pure) ---------------- */

test('an unknown card is rejected', () => {
  assert.throws(() => planOwnedItemBatch([{ card_id: 'x', setCode: '001', foil: false, qty: 1 }], catalog(CV)), /unknown card/);
});

test('a set the card is not printed in is rejected', () => {
  assert.throws(() => planOwnedItemBatch([{ card_id: 'c1', setCode: '999', foil: false, qty: 1 }], catalog(CV)), /is not a set/);
});

test('a FORGED non-foil printing that does not exist is rejected (Winter River shape)', () => {
  // 002 is Standard-only, so foil on 002 is impossible; the forged item is rejected below the UI.
  assert.throws(() => planOwnedItemBatch([{ card_id: 'c1', setCode: '002', foil: true, qty: 1 }], catalog(CV)), /foil is not a printing/);
});

test('an EMPTY setCode is a VALID uncategorised owned item (owned-only asymmetry)', () => {
  assert.deepEqual(planOwnedItemBatch([{ card_id: 'c1', setCode: '', foil: false, qty: 2 }], catalog(CV)),
    [{ card_id: 'c1', slug: 'uncategorised', qty: 2 }]);
  assert.deepEqual(planOwnedItemBatch([{ card_id: 'c1', setCode: '', foil: true, qty: 3 }], catalog(CV)),
    [{ card_id: 'c1', slug: 'uncategorised:f', qty: 3 }], 'uncategorised foil is legitimate for owned');
});

test('an uncategorised item is accepted even for a card with malformed variants (no finish check)', () => {
  // Uncategorised needs no set/finish, so a card whose variants would trip the strict reader still
  // files uncategorised - the finish check that throws is only reached for a real setCode.
  const bad = new Map([['c1', { sets: '[]', variants: '{not json' }]]);
  assert.deepEqual(planOwnedItemBatch([{ card_id: 'c1', setCode: '', foil: true, qty: 1 }], bad),
    [{ card_id: 'c1', slug: 'uncategorised:f', qty: 1 }]);
});

test('foil must be a real boolean - coercion rejected', () => {
  for (const foil of ['false', 'true', 0, 1, null, undefined]) {
    assert.throws(() => planOwnedItemBatch([{ card_id: 'c1', setCode: '001', foil, qty: 1 }], catalog(CV)), /foil must be a boolean/, JSON.stringify(foil));
  }
});

test('quantity bounds are enforced', () => {
  for (const qty of [0, -1, 1.5, NaN, MAX_ITEM_QTY + 1]) {
    assert.throws(() => planOwnedItemBatch([{ card_id: 'c1', setCode: '001', foil: false, qty }], catalog(CV)), /out of range/, String(qty));
  }
});

test('duplicates merge by canonical slug, quantities summed', () => {
  const plan = planOwnedItemBatch([
    { card_id: 'c1', setCode: '001', foil: false, qty: 2 },
    { card_id: 'c1', setCode: '001', foil: false, qty: 3 },
    { card_id: 'c1', setCode: '001', foil: true, qty: 1 },
    { card_id: 'c1', setCode: '', foil: false, qty: 4 },
  ], catalog(CV));
  assert.deepEqual(plan.sort((a, b) => a.slug.localeCompare(b.slug)), [
    { card_id: 'c1', slug: '001', qty: 5 },
    { card_id: 'c1', slug: '001:f', qty: 1 },
    { card_id: 'c1', slug: 'uncategorised', qty: 4 },
  ]);
});

test('malformed catalog variants reject a REAL-set item (authoritative), never a phantom', () => {
  const bad = new Map([['c1', { sets: '[{"code":"001","name":"Alpha"}]', variants: '{not json' }]]);
  assert.throws(() => planOwnedItemBatch([{ card_id: 'c1', setCode: '001', foil: false, qty: 1 }], bad), /malformed variants JSON/);
});

test('the 2000-item batch ceiling is enforced', () => {
  const batch = (nn) => Array.from({ length: nn }, () => ({ card_id: 'c1', setCode: '001', foil: false, qty: 1 }));
  assert.doesNotThrow(() => planOwnedItemBatch(batch(MAX_BATCH_ITEMS), catalog(CV)), '2000 allowed');
  assert.throws(() => planOwnedItemBatch(batch(MAX_BATCH_ITEMS + 1), catalog(CV)), /exceeds 2000/);
  assert.throws(() => planOwnedItemBatch('nope', catalog(CV)), /must be an array/);
});

/* ---------------- the command against a real database ---------------- */

test('a batch is filed at the right slugs, foil carried, total conserved', async () => {
  const res = await cmd()([
    { card_id: 'c1', setCode: '001', foil: false, qty: 2 },
    { card_id: 'c1', setCode: '002', foil: false, qty: 1 },
    { card_id: 'c1', setCode: '001', foil: true, qty: 3 },
    { card_id: 'c1', setCode: '', foil: true, qty: 4 },
  ]);
  assert.deepEqual(res, { names: 4, copies: 10 });
  assert.equal(ownOf('001'), 2);
  assert.equal(ownOf('002'), 1);
  assert.equal(ownOf('001:f'), 3);
  assert.equal(ownOf('uncategorised:f'), 4);
  assert.equal(notifyCount, 1, 'one broadcast');
});

test('+= accumulates onto existing ownership', async () => {
  seedOwn('001', 4);
  await cmd()([{ card_id: 'c1', setCode: '001', foil: false, qty: 1 }]);
  assert.equal(ownOf('001'), 5, 'additive, not absolute');
});

test('an impossible item rejects the WHOLE batch - nothing written, no broadcast', async () => {
  seedOwn('001', 4);
  await assert.rejects(
    () => cmd()([{ card_id: 'c1', setCode: '001', foil: false, qty: 1 }, { card_id: 'c1', setCode: '002', foil: true, qty: 1 }]),
    (e) => e.name === 'BulkWriteError' && e.phase === 'prewrite' && e.writeState === 'none',
  );
  assert.equal(ownOf('001'), 4, 'the valid item did not slip through');
  assert.equal(notifyCount, 0);
});

test('an empty batch is a no-op, no transaction, no broadcast', async () => {
  assert.deepEqual(await cmd()([]), { names: 0, copies: 0 });
  assert.equal(notifyCount, 0);
});

test('only the passed profile is written', async () => {
  await cmd()([{ card_id: 'c1', setCode: '001', foil: false, qty: 2 }], 'p2');
  assert.equal(ownOf('001', 'c1', 'p2'), 2);
  assert.equal(ownOf('001', 'c1', 'p1'), 0);
});

/* ---------------- write-outcome contract ---------------- */

test('a barrier failure before tx is prewrite/none - nothing written, no broadcast', async () => {
  const failBarrier = () => Promise.reject(new Error('drain timeout'));
  await assert.rejects(
    () => cmd(failBarrier)([{ card_id: 'c1', setCode: '001', foil: false, qty: 1 }]),
    (e) => e.phase === 'prewrite' && e.writeState === 'none',
  );
  assert.equal(notifyCount, 0);
});

test('INDETERMINATE web failure: tx applies then rejects -> transaction/unknown, broadcasts, no lie', async () => {
  seedOwn('001', 1);
  const applyThenReject = async (stmts) => { await runTx(stmts); throw new Error('IndexedDB quota exceeded'); };
  await assert.rejects(
    () => cmd((fn) => fn(), { tx: applyThenReject })([{ card_id: 'c1', setCode: '001', foil: false, qty: 1 }]),
    (e) => e.phase === 'transaction' && e.writeState === 'unknown',
  );
  assert.equal(ownOf('001'), 2, 'the write actually landed - "nothing written" would have been a lie');
  assert.equal(notifyCount, 1, 'cache invalidated despite the rejection');
});

test('a transaction that fails AFTER earlier statements leaves ZERO rows changed', async () => {
  seedOwn('001', 5);
  const appendBad = (stmts) => runTx([...stmts, ['THIS IS NOT VALID SQL;', []]]);
  await assert.rejects(
    () => cmd((fn) => fn(), { tx: appendBad })([
      { card_id: 'c1', setCode: '001', foil: false, qty: 1 },
      { card_id: 'c1', setCode: '002', foil: false, qty: 1 },
    ]),
    (e) => e.phase === 'transaction' && e.writeState === 'unknown',
  );
  assert.equal(ownOf('001'), 5, 'the earlier upsert rolled back');
  assert.equal(ownOf('002'), 0, 'no partial write survived');
  assert.equal(notifyCount, 1);
});

/* ---------------- the counterfactual: the barrier is load-bearing ---------------- */
//
// The import writes via an atomic SQL += so it cannot lose ITS OWN increment - the loss comes from
// a queued ABSOLUTE owned write (read N, write N+1 absolute) clobbering the import's increment when
// it lands in between. Both writes are gated so each arm forces its characteristic order,
// independent of await-depth. Positive milestones only.

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const settleTurns = async (k = 5) => { for (let i = 0; i < k; i++) await new Promise((r) => setTimeout(r, 0)); };

function raceScenario(exclusive) {
  seedOwn('001', 1);
  const absReadDone = deferred();
  const absWriteGo = deferred();
  const absolute = enqueueWrite(ownedRowKey(PID, 'c1', '001'), async () => {
    const cur = ownOf('001');
    absReadDone.resolve();
    await absWriteGo.promise;
    sdb.run('UPDATE owned_cards SET qty_owned=? WHERE profile_id=? AND card_id=? AND variant_slug=?;', [cur + 1, PID, 'c1', '001']);
  });
  const bulkAtTx = deferred();
  const bulkTxGo = deferred();
  const gatedTx = async (stmts) => { bulkAtTx.resolve(); await bulkTxGo.promise; return runTx(stmts); };
  return { absolute, absReadDone, absWriteGo, bulkAtTx, bulkTxGo, tx: gatedTx, exclusive };
}

test('COUNTERFACTUAL guarded: the real barrier drains the absolute write first - final 3', async () => {
  const r = raceScenario(withExclusiveCollectionWrites);
  await r.absReadDone.promise;
  const bulk = cmd(r.exclusive, { tx: r.tx })([{ card_id: 'c1', setCode: '001', foil: false, qty: 1 }]);
  r.absWriteGo.resolve();                                   // absolute drains: 1 -> 2
  await r.bulkAtTx.promise;                                 // barrier THEN admits the import to its tx
  r.bulkTxGo.resolve();                                     // import += on 2 -> 3
  await Promise.all([r.absolute, bulk]);
  assert.equal(ownOf('001'), 3, 'no increment lost - the barrier serialized them');
});

test('COUNTERFACTUAL control: without the barrier the absolute write clobbers the increment - final 2', async () => {
  const r = raceScenario((fn) => fn());
  await r.absReadDone.promise;
  const bulk = cmd(r.exclusive, { tx: r.tx })([{ card_id: 'c1', setCode: '001', foil: false, qty: 1 }]);
  await r.bulkAtTx.promise;                                 // no barrier: import reaches its tx now, absolute still parked
  r.bulkTxGo.resolve();                                     // import += on the STALE 1 -> 2
  await bulk;
  r.absWriteGo.resolve();                                   // absolute writes its stale absolute 2 -> stays 2
  await r.absolute;
  assert.equal(ownOf('001'), 2, 'the import increment was lost - this is what the barrier prevents');
});

test('PRODUCTION WIRING: the exported importCollectionResolved BLOCKS behind a held barrier write', async () => {
  seedOwn('001', 1);
  const heldStarted = deferred();
  const release = deferred();
  const held = enqueueWrite(ownedRowKey(PID, 'c1', '001'), async () => { heldStarted.resolve(); await release.promise; });
  await heldStarted.promise;

  const bulk = importCollectionResolved([{ card_id: 'c1', setCode: '001', foil: false, qty: 1 }], PID);
  await settleTurns();
  assert.equal(ownOf('001'), 1, 'production is BLOCKED behind the held write - a pass-through would have written by now');

  release.resolve();
  await Promise.all([held, bulk]);
  assert.equal(ownOf('001'), 2, 'and it applies once the barrier frees');
});

test('A->B profile switch while the PRODUCTION command is parked writes only A', async () => {
  __setActiveIdForTests('p1');
  const started = deferred();
  const release = deferred();
  const held = enqueueWrite(ownedRowKey('p1', 'c1', '001'), async () => { started.resolve(); await release.promise; });
  await started.promise;

  const bulk = importCollectionResolved([{ card_id: 'c1', setCode: '001', foil: false, qty: 2 }]);   // captures p1
  __setActiveIdForTests('p2');
  release.resolve();
  await Promise.all([held, bulk]);
  __setActiveIdForTests('p1');

  assert.equal(ownOf('001', 'c1', 'p1'), 2, 'landed in the captured profile A');
  assert.equal(ownOf('001', 'c1', 'p2'), 0, 'nothing leaked into B');
});

/* ================= END-TO-END: grammar -> preview -> plan -> writer -> ledger ================= */
//
// The brief's required evidence: the real chain, not just the pure plan, storing the exact slugs.
// The ap / wb fixtures are seeded in the main `before` above - one multi-set card with a foil Beta
// printing (so [Beta] and [Beta] [Foil] resolve to 002 / 002:f) and one multi-set card whose bare
// [Foil] line cannot resolve (left Unspecified -> uncategorised:f).

test('END-TO-END: annotated text files 002, 002:f, and an unresolved [Foil] lands uncategorised:f', async () => {
  const text = [
    '2 Albespine Pikemen [Beta]',
    '1 Albespine Pikemen [Beta] [Foil]',
    '3 Wild Boars [Foil]',
  ].join('\n');

  const { items, unresolved } = await previewCollectionText(text);
  assert.deepEqual(unresolved, [], 'both names resolved');

  const plan = planCollectionImport({ items, unresolved });
  // The two Albespine printings are annotation-determined -> auto-file. Wild Boars [Foil] on a
  // multi-set card is not determined -> review, left Unspecified.
  assert.deepEqual(plan.single.map((i) => i.card_id).sort(), ['ap', 'ap'], 'both Albespine printings auto-file');
  assert.deepEqual(plan.multi.map((i) => i.card_id), ['wb'], 'the ambiguous [Foil] line falls to review');

  const writeItems = buildImportItems(plan, {});   // no set chosen for wb -> '' -> uncategorised
  const res = await importCollectionResolved(writeItems, PID);
  assert.equal(res.names, 3);
  assert.equal(res.copies, 6);

  assert.equal(ownOf('002', 'ap'), 2, '[Beta] -> 002');
  assert.equal(ownOf('002:f', 'ap'), 1, '[Beta] [Foil] -> 002:f, finish NOT dropped');
  assert.equal(ownOf('uncategorised:f', 'wb'), 3, 'the unresolved [Foil] kept its finish into the uncategorised bucket');
  assert.equal(ownOf('001', 'ap'), 0, 'nothing filed to Alpha');
  assert.equal(ownOf('uncategorised', 'wb'), 0, 'the foil intent was not silently downgraded to non-foil');
});

test('END-TO-END: a bare line for a foil-only single-set card resolves to 001:f (P6), no batch failure', async () => {
  const { items, unresolved } = await previewCollectionText('1 Winter River');
  assert.deepEqual(unresolved, []);
  const plan = planCollectionImport({ items, unresolved });
  assert.deepEqual(plan.single.map((i) => i.card_id), ['wr'], 'auto-files, does not fall to review');
  const res = await importCollectionResolved(buildImportItems(plan, {}), PID);
  assert.equal(res.names, 1);
  assert.equal(ownOf('001:f', 'wr'), 1, 'the sole foil printing, not a rejected non-foil phantom');
  assert.equal(ownOf('001', 'wr'), 0);
});
