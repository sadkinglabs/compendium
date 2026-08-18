// The transactional bulk want command. The counterfactual at the bottom is the load-bearing
// test: it proves the barrier is doing the work, not decorating it, by running the SAME command
// factory guarded and unguarded and asserting exact finals (3 vs 2). Deterministic promise gates,
// no timers. Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { enqueueWrite, withExclusiveCollectionWrites, __resetCollectionWritesForTests } from './collectionWrites.js';
import { cardWantKey } from './ownedRepository.js';
import {
  createWantedBulkCommand, planWantedItemBatch, addWantedItemsBulk, MAX_ITEM_QTY,
} from './wantedBulkRepository.js';

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
const wantOf = (slug, cardId = 'c1', pid = PID) =>
  rows('SELECT qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, slug])[0]?.qty_wanted ?? 0;
const seedWant = (slug, wanted, cardId = 'c1', pid = PID) =>
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?,?);',
    [`s-${pid}-${cardId}-${slug}`, pid, cardId, slug, wanted, '', 'x', 'x']);

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
const cmd = (exclusive = (fn) => fn(), over = {}) => createWantedBulkCommand(deps(exclusive, over)).addWantedItemsBulk;
const catalog = (variants) => new Map([['c1', { card_id: 'c1', sets: '[{"code":"001","name":"Alpha"},{"code":"002","name":"Beta"}]', variants: JSON.stringify(variants) }]]);

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
  // c1: Alpha (both finishes) + Beta (non-foil only). Winter-River-shaped foil-only lives on 002:f absence.
  sdb.run(`INSERT INTO cards(card_id,name,sets,variants) VALUES('c1','C',
    '[{"code":"001","name":"Alpha"},{"code":"002","name":"Beta"}]',
    '[{"set":"001","finish":"Standard"},{"set":"001","finish":"Foil"},{"set":"002","finish":"Standard"}]');`);
  __setActiveIdForTests(PID);
});

beforeEach(() => { sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards;'); __resetCollectionWritesForTests(); notifyCount = 0; });

/* ---------------- planWantedItemBatch (pure) ---------------- */

test('an unknown card is rejected', () => {
  assert.throws(() => planWantedItemBatch([{ cardId: 'x', set: '001', foil: false, qty: 1 }], catalog([])), /unknown card/);
});

test('a set the card is not printed in is rejected', () => {
  assert.throws(() => planWantedItemBatch([{ cardId: 'c1', set: '999', foil: false, qty: 1 }], catalog([{ set: '001', finish: 'Standard' }])), /is not a set/);
});

test('a finish the printing does not have is rejected (non-foil Winter River shape)', () => {
  // 002 is Standard-only here, so a foil want on 002 is impossible.
  const cat = new Map([['c1', { sets: '[{"code":"002","name":"Beta"}]', variants: '[{"set":"002","finish":"Standard"}]' }]]);
  assert.throws(() => planWantedItemBatch([{ cardId: 'c1', set: '002', foil: true, qty: 1 }], cat), /foil is not a printing/);
});

test('quantity bounds are enforced', () => {
  const cat = catalog([{ set: '001', finish: 'Standard' }]);
  for (const qty of [0, -1, 1.5, NaN, MAX_ITEM_QTY + 1]) {
    assert.throws(() => planWantedItemBatch([{ cardId: 'c1', set: '001', foil: false, qty }], cat), /out of range/, String(qty));
  }
});

test('duplicates merge by canonical slug, quantities summed', () => {
  const plan = planWantedItemBatch([
    { cardId: 'c1', set: '001', foil: false, qty: 2 },
    { cardId: 'c1', set: '001', foil: false, qty: 3 },
    { cardId: 'c1', set: '001', foil: true, qty: 1 },
  ], catalog([{ set: '001', finish: 'Standard' }, { set: '001', finish: 'Foil' }]));
  assert.deepEqual(plan.sort((a, b) => a.slug.localeCompare(b.slug)), [
    { cardId: 'c1', slug: '001', qty: 5 },
    { cardId: 'c1', slug: '001:f', qty: 1 },
  ]);
});

/* ---------------- the command against a real database ---------------- */

test('a batch is filed, and the total conserved', async () => {
  const res = await cmd()([
    { cardId: 'c1', set: '001', foil: false, qty: 2 },
    { cardId: 'c1', set: '002', foil: false, qty: 1 },
    { cardId: 'c1', set: '001', foil: true, qty: 3 },
  ]);
  assert.deepEqual(res, { items: 3, copies: 6 });
  assert.equal(wantOf('001'), 2);
  assert.equal(wantOf('002'), 1);
  assert.equal(wantOf('001:f'), 3);
  assert.equal(notifyCount, 1, 'one broadcast');
});

test('+= accumulates onto an existing want', async () => {
  seedWant('001', 4);
  await cmd()([{ cardId: 'c1', set: '001', foil: false, qty: 1 }]);
  assert.equal(wantOf('001'), 5, 'additive, not absolute');
});

test('an impossible item rejects the WHOLE batch - nothing written, no broadcast', async () => {
  seedWant('001', 4);
  await assert.rejects(
    () => cmd()([{ cardId: 'c1', set: '001', foil: false, qty: 1 }, { cardId: 'c1', set: '002', foil: true, qty: 1 }]),
    (e) => e.name === 'BulkWriteError' && e.phase === 'prewrite' && e.writeState === 'none',
  );
  assert.equal(wantOf('001'), 4, 'the valid item did not slip through');
  assert.equal(notifyCount, 0, 'nothing ran, nothing invalidated');
});

test('an empty batch is a no-op, no transaction, no broadcast', async () => {
  const res = await cmd()([]);
  assert.deepEqual(res, { items: 0, copies: 0 });
  assert.equal(notifyCount, 0);
});

test('only the passed profile is written', async () => {
  await cmd()([{ cardId: 'c1', set: '001', foil: false, qty: 2 }], 'p2');
  assert.equal(wantOf('001', 'c1', 'p2'), 2);
  assert.equal(wantOf('001', 'c1', 'p1'), 0);
});

/* ---------------- write-outcome contract ---------------- */

test('a barrier failure before tx is prewrite/none - nothing written, no broadcast', async () => {
  const failBarrier = () => Promise.reject(new Error('drain timeout'));
  await assert.rejects(
    () => cmd(failBarrier)([{ cardId: 'c1', set: '001', foil: false, qty: 1 }]),
    (e) => e.phase === 'prewrite' && e.writeState === 'none',
  );
  assert.equal(notifyCount, 0);
});

test('INDETERMINATE web failure: tx applies then rejects -> transaction/unknown, broadcasts, no lie', async () => {
  // The sql.js-commit-then-persist-fails shape. The rows DID change; the command must not claim
  // nothing was written, must invalidate the cache, and must never auto-retry.
  seedWant('001', 1);
  const applyThenReject = async (stmts) => { await runTx(stmts); throw new Error('IndexedDB quota exceeded'); };
  await assert.rejects(
    () => cmd((fn) => fn(), { tx: applyThenReject })([{ cardId: 'c1', set: '001', foil: false, qty: 1 }]),
    (e) => e.phase === 'transaction' && e.writeState === 'unknown',
  );
  assert.equal(wantOf('001'), 2, 'the write actually landed - "nothing written" would have been a lie');
  assert.equal(notifyCount, 1, 'cache invalidated despite the rejection');
});

/* ---------------- the counterfactual: the barrier is load-bearing ---------------- */
//
// The bulk command writes via an atomic SQL += (no read-modify-write), so it cannot lose ITS
// OWN increment - the loss comes from a queued ABSOLUTE want write (the stepper: read N, write
// N+1 absolute) clobbering the bulk's increment when it lands in between. To make that
// deterministic despite differing await-depths, BOTH the absolute write and the bulk's tx are
// gated, and each arm is orchestrated to force its characteristic order. Positive milestones
// only - no settleTurns here.

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const settleTurns = async (k = 5) => { for (let i = 0; i < k; i++) await new Promise((r) => setTimeout(r, 0)); };

function raceScenario(exclusive) {
  seedWant('001', 1);
  const absReadDone = deferred();
  const absWriteGo = deferred();
  // The queued ABSOLUTE write: read the current qty, then (gated) write read+1 as an absolute.
  const absolute = enqueueWrite(cardWantKey(PID, 'c1'), async () => {
    const cur = wantOf('001');
    absReadDone.resolve();
    await absWriteGo.promise;
    sdb.run('UPDATE owned_cards SET qty_wanted=? WHERE profile_id=? AND card_id=? AND variant_slug=?;', [cur + 1, PID, 'c1', '001']);
  });
  // The bulk's tx is gated so we control exactly when its += executes, independent of await-depth.
  const bulkAtTx = deferred();
  const bulkTxGo = deferred();
  const gatedTx = async (stmts) => { bulkAtTx.resolve(); await bulkTxGo.promise; return runTx(stmts); };
  return { absolute, absReadDone, absWriteGo, bulkAtTx, bulkTxGo, tx: gatedTx, exclusive };
}

test('COUNTERFACTUAL guarded: the real barrier drains the absolute write first - final 3', async () => {
  const r = raceScenario(withExclusiveCollectionWrites);
  await r.absReadDone.promise;                              // absolute has read 1, parked
  const bulk = cmd(r.exclusive, { tx: r.tx })([{ cardId: 'c1', set: '001', foil: false, qty: 1 }]);
  // The guarded bulk is blocked at the barrier: its gated tx is NOT reached yet.
  r.absWriteGo.resolve();                                   // absolute drains: 1 -> 2
  await r.bulkAtTx.promise;                                 // barrier THEN admits the bulk to its tx
  r.bulkTxGo.resolve();                                     // bulk += on 2 -> 3
  await Promise.all([r.absolute, bulk]);
  assert.equal(wantOf('001'), 3, 'no increment lost - the barrier serialized them');
});

test('COUNTERFACTUAL control: without the barrier the absolute write clobbers the increment - final 2', async () => {
  const r = raceScenario((fn) => fn());
  await r.absReadDone.promise;                              // absolute has read 1, parked
  const bulk = cmd(r.exclusive, { tx: r.tx })([{ cardId: 'c1', set: '001', foil: false, qty: 1 }]);
  await r.bulkAtTx.promise;                                 // no barrier: bulk reaches its tx now, absolute still parked
  r.bulkTxGo.resolve();                                     // bulk += on the STALE 1 -> 2
  await bulk;
  r.absWriteGo.resolve();                                   // absolute now writes its stale absolute 2 -> stays 2
  await r.absolute;
  assert.equal(wantOf('001'), 2, 'the bulk increment was lost - this is what the barrier prevents');
});

test('PRODUCTION WIRING: the exported addWantedItemsBulk BLOCKS behind a held barrier write', async () => {
  // Proves production is wired to the real barrier, not a pass-through. A held write occupies
  // the barrier; production must not write until it releases. The negative ("has not written")
  // is settle-bounded after a positive milestone - the codebase's blessed shape for a negative.
  seedWant('001', 1);
  const heldStarted = deferred();
  const release = deferred();
  const held = enqueueWrite(cardWantKey(PID, 'c1'), async () => { heldStarted.resolve(); await release.promise; });
  await heldStarted.promise;                                // the held write occupies the barrier

  const bulk = addWantedItemsBulk([{ cardId: 'c1', set: '001', foil: false, qty: 1 }], PID);
  await settleTurns();
  assert.equal(wantOf('001'), 1, 'production is BLOCKED behind the held write - a pass-through would have written by now');

  release.resolve();
  await Promise.all([held, bulk]);
  assert.equal(wantOf('001'), 2, 'and it applies once the barrier frees');
});

/* ================= Codex increment-3 acceptance matrix ================= */
import { MAX_BATCH_ITEMS } from './wantedBulkRepository.js';

test('foil must be a real boolean - coercion is rejected, not silently reinterpreted', () => {
  const cat = catalog([{ set: '001', finish: 'Standard' }]);
  for (const foil of ['false', 'true', 0, 1, null, undefined]) {
    assert.throws(() => planWantedItemBatch([{ cardId: 'c1', set: '001', foil, qty: 1 }], cat), /foil must be a boolean/, JSON.stringify(foil));
  }
  assert.throws(() => planWantedItemBatch([{ cardId: 'c1', set: '001', qty: 1 }], cat), /foil must be a boolean/, 'omitted foil');
});

test('malformed catalog variants reject the batch (authoritative), never authorise a phantom item', () => {
  const bad = new Map([['c1', { sets: '[{"code":"001","name":"Alpha"}]', variants: '{not json' }]]);
  assert.throws(() => planWantedItemBatch([{ cardId: 'c1', set: '001', foil: false, qty: 1 }], bad), /malformed variants JSON/);
  const badShape = new Map([['c1', { sets: '[{"code":"001","name":"Alpha"}]', variants: '{"broken":true}' }]]);
  assert.throws(() => planWantedItemBatch([{ cardId: 'c1', set: '001', foil: false, qty: 1 }], badShape), /variants must be an array/);
});

test('a Rainbow-only promo accepts foil and rejects non-foil THROUGH planWantedItemBatch', () => {
  const rainbow = new Map([['c1', { sets: '[{"code":"999","name":"Promotional"}]', variants: '[{"set":"999","finish":"Rainbow"}]' }]]);
  assert.deepEqual(planWantedItemBatch([{ cardId: 'c1', set: '999', foil: true, qty: 1 }], rainbow), [{ cardId: 'c1', slug: '999:f', qty: 1 }]);
  assert.throws(() => planWantedItemBatch([{ cardId: 'c1', set: '999', foil: false, qty: 1 }], rainbow), /non-foil is not a printing/);
});

test('the 2000-item batch ceiling is enforced at the durable boundary', () => {
  const cat = catalog([{ set: '001', finish: 'Standard' }]);
  const batch = (nn) => Array.from({ length: nn }, () => ({ cardId: 'c1', set: '001', foil: false, qty: 1 }));
  assert.doesNotThrow(() => planWantedItemBatch(batch(MAX_BATCH_ITEMS), cat), '2000 is allowed');
  assert.throws(() => planWantedItemBatch(batch(MAX_BATCH_ITEMS + 1), cat), /exceeds 2000/);
  assert.throws(() => planWantedItemBatch('nope', cat), /must be an array/);
});

test('a transaction that fails AFTER earlier statements leaves ZERO rows changed', async () => {
  // Append an invalid statement to the command's transaction: the earlier upserts must all roll
  // back, the outcome is transaction/unknown, and exactly one invalidation fires.
  seedWant('001', 5);
  const appendBad = (stmts) => runTx([...stmts, ['THIS IS NOT VALID SQL;', []]]);
  await assert.rejects(
    () => cmd((fn) => fn(), { tx: appendBad })([
      { cardId: 'c1', set: '001', foil: false, qty: 1 },
      { cardId: 'c1', set: '002', foil: false, qty: 1 },
    ]),
    (e) => e.phase === 'transaction' && e.writeState === 'unknown',
  );
  assert.equal(wantOf('001'), 5, 'the earlier upsert rolled back');
  assert.equal(wantOf('002'), 0, 'no partial write survived');
  assert.equal(notifyCount, 1, 'one invalidation - a transaction was attempted');
});

test('A->B profile switch while the PRODUCTION command is parked writes only A', async () => {
  // Exercises addWantedItemsBulk (not an injected imitation): pid is captured at the call, so a
  // switch to B while it waits behind the barrier cannot redirect it.
  __setActiveIdForTests('p1');
  const started = deferred();
  const release = deferred();
  const held = enqueueWrite(cardWantKey('p1', 'c1'), async () => { started.resolve(); await release.promise; });
  await started.promise;

  const bulk = addWantedItemsBulk([{ cardId: 'c1', set: '001', foil: false, qty: 2 }]);   // captures p1
  __setActiveIdForTests('p2');                                                             // active switches to B
  release.resolve();
  await Promise.all([held, bulk]);
  __setActiveIdForTests('p1');

  assert.equal(wantOf('001', 'c1', 'p1'), 2, 'landed in the captured profile A');
  assert.equal(wantOf('001', 'c1', 'p2'), 0, 'nothing leaked into B');
});
