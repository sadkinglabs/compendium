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
  createOwnedImportCommand, planOwnedItemBatch, planOwnedSetBatch, importCollectionResolved, setOwnedItemsBulk, adjustOwnedItemsBulk, createListWithEntries, addEntriesToList, MAX_ITEM_QTY, MAX_BATCH_ITEMS,
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
// Seeds a row AS THE BACKFILL LEAVES IT - copies placed in Unfiled. A seeded row with copies and
// no allocation is a state v12 cannot produce, and it makes every decrease in this file look like
// copies filed in a binder the fixture never created.
const place = (rowId, owned, pid = PID) => {
  if (owned > 0) sdb.run('INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,?,?,?,?);',
    [`a-${rowId}`, pid, 'u-' + pid, rowId, owned, 'x', 'x']);
};
const seedOwn = (slug, owned, cardId = 'c1', pid = PID) => {
  const id = `s-${pid}-${cardId}-${slug}`;
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?);',
    [id, pid, cardId, slug, owned, '', 'x', 'x']);
  place(id, owned, pid);
};

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
  // v12: every profile has an Unfiled container, and the import writers now place the copies they
  // file. Without one the equality guard inside the transaction rolls the whole import back - which
  // is the guard doing its job, on a profile the boot backfill could never have produced.
  for (const id of ['p1', 'p2']) sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,colour,is_system,created_at,updated_at) VALUES(?,?,'unfiled','Unfiled','gold',1,'x','x');", ['u-' + id, id]);
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

beforeEach(() => { sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards;'); __resetCollectionWritesForTests(); notifyCount = 0; });

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

test('setCode must be exactly a STRING - only "" means uncategorised, not undefined/null/false/0', () => {
  // Codex Major 3a: every falsy setCode once wrote uncategorised. A non-string is now malformed.
  for (const setCode of [undefined, null, false, 0]) {
    assert.throws(() => planOwnedItemBatch([{ card_id: 'c1', setCode, foil: true, qty: 1 }], catalog(CV)), /setCode must be a string/, JSON.stringify(setCode));
  }
  // The empty string is the ONE valid falsy setCode.
  assert.deepEqual(planOwnedItemBatch([{ card_id: 'c1', setCode: '', foil: true, qty: 1 }], catalog(CV)), [{ card_id: 'c1', slug: 'uncategorised:f', qty: 1 }]);
});

/* ---------------- planOwnedSetBatch (pure, absolute set / delete) ---------------- */

const setArgs = { pid: 'p1', uuid: () => 'ID', now: 'T' };

test('set: positive UPDATEs a CHANGED row, INSERTs a missing one', () => {
  const cur = new Map([['c1|001', { id: 'row1', qty_owned: 1, qty_wanted: 0 }]]);
  const plan = planOwnedSetBatch([
    { card_id: 'c1', setCode: '001', foil: false, qty: 3 },
    { card_id: 'c1', setCode: '002', foil: false, qty: 2 },
  ], catalog(CV), cur, setArgs);
  assert.equal(plan.set, 2); assert.equal(plan.removed, 0); assert.equal(plan.unchanged, 0); assert.equal(plan.cards, 1);
  assert.match(plan.statements[0].sql, /UPDATE owned_cards SET qty_owned=\?/);
  assert.deepEqual(plan.statements[0].params, [3, 'T', 'row1']);
  assert.match(plan.statements[1].sql, /INSERT INTO owned_cards/);
});

test('set to the value a row ALREADY holds is a true no-op (no statement, counted unchanged)', () => {
  const cur = new Map([['c1|001', { id: 'row1', qty_owned: 3, qty_wanted: 0 }]]);
  const plan = planOwnedSetBatch([{ card_id: 'c1', setCode: '001', foil: false, qty: 3 }], catalog(CV), cur, setArgs);
  assert.deepEqual(plan.statements, []); assert.equal(plan.set, 0); assert.equal(plan.unchanged, 1);
});

test('set 0 DELETEs an owned-only row, ZEROES a wanted row, and NO-OPs an already-empty one', () => {
  const cur = new Map([
    ['c1|001', { id: 'owned-only', qty_owned: 2, qty_wanted: 0 }],
    ['c1|002', { id: 'also-wanted', qty_owned: 1, qty_wanted: 2 }],
    ['c1|001:f', { id: 'want-only', qty_owned: 0, qty_wanted: 1 }],   // owned already 0
  ]);
  const plan = planOwnedSetBatch([
    { card_id: 'c1', setCode: '001', foil: false, qty: 0 },
    { card_id: 'c1', setCode: '002', foil: false, qty: 0 },
    { card_id: 'c1', setCode: '001', foil: true, qty: 0 },
  ], catalog(CV), cur, setArgs);
  assert.equal(plan.removed, 1); assert.equal(plan.cleared, 1); assert.equal(plan.unchanged, 1);
  assert.equal(plan.statements.length, 2, 'the already-empty row wrote nothing');
  assert.match(plan.statements[0].sql, /DELETE FROM owned_cards/);
  assert.deepEqual(plan.statements[0].params, ['owned-only']);
  assert.match(plan.statements[1].sql, /UPDATE owned_cards SET qty_owned=0/);   // want preserved
  assert.deepEqual(plan.statements[1].params, ['T', 'also-wanted']);
});

test('CONFLICTING duplicate targets are REJECTED order-independently; identical ones coalesce', () => {
  // The exact defect Codex found: [{0},{5}] must not be silent first-wins.
  for (const pair of [[0, 5], [5, 0]]) {
    assert.throws(() => planOwnedSetBatch([
      { card_id: 'c1', setCode: '001', foil: false, qty: pair[0] },
      { card_id: 'c1', setCode: '001', foil: false, qty: pair[1] },
    ], catalog(CV), new Map(), setArgs), /conflicting targets/, `order ${pair}`);
  }
  const cur = new Map([['c1|001', { id: 'r', qty_owned: 1, qty_wanted: 0 }]]);
  const plan = planOwnedSetBatch([
    { card_id: 'c1', setCode: '001', foil: false, qty: 4 },
    { card_id: 'c1', setCode: '001', foil: false, qty: 4 },   // identical -> one target
  ], catalog(CV), cur, setArgs);
  assert.equal(plan.statements.length, 1); assert.equal(plan.set, 1);
});

test('every item is validated BEFORE the fold - an impossible later item still throws', () => {
  assert.throws(() => planOwnedSetBatch([
    { card_id: 'c1', setCode: '001', foil: false, qty: 1 },
    { card_id: 'c1', setCode: '002', foil: true, qty: 1 },   // 002 is standard-only
  ], catalog(CV), new Map(), setArgs), /foil is not a printing/);
});

test('a POSITIVE set validates the printing; ZERO clearing an impossible pair is exempt', () => {
  assert.throws(() => planOwnedSetBatch([{ card_id: 'c1', setCode: '002', foil: true, qty: 1 }], catalog(CV), new Map(), setArgs), /foil is not a printing/);
  const cur = new Map([['c1|002:f', { id: 'phantom', qty_owned: 3, qty_wanted: 0 }]]);
  const plan = planOwnedSetBatch([{ card_id: 'c1', setCode: '002', foil: true, qty: 0 }], catalog(CV), cur, setArgs);
  assert.equal(plan.removed, 1);   // a historical malformed row can always be cleared
});

test('set: foil must be a real boolean and qty in 0..MAX', () => {
  assert.throws(() => planOwnedSetBatch([{ card_id: 'c1', setCode: '001', foil: 'false', qty: 1 }], catalog(CV), new Map(), setArgs), /foil must be a boolean/);
  assert.throws(() => planOwnedSetBatch([{ card_id: 'c1', setCode: '001', foil: false, qty: -1 }], catalog(CV), new Map(), setArgs), /out of range/);
  assert.throws(() => planOwnedSetBatch([{ card_id: 'c1', setCode: '001', foil: false, qty: MAX_ITEM_QTY + 1 }], catalog(CV), new Map(), setArgs), /out of range/);
});

test('setOwnedItemsBulk end-to-end: sets, deletes owned-only, keeps a wanted row (one broadcast)', async () => {
  // Seed: c1/001 owned=1, c1/002 owned=2 AND wanted=1.
  await importCollectionResolved([{ card_id: 'c1', setCode: '001', foil: false, qty: 1 }, { card_id: 'c1', setCode: '002', foil: false, qty: 2 }]);
  const { setWantedForItem } = await import('./ownedRepository.js');
  await setWantedForItem('c1', { set: '002', foil: false }, 1);

  let fired = 0; const { subscribeCollection } = await import('./ownedRepository.js');
  const unsub = subscribeCollection(() => { fired += 1; });
  const r = await setOwnedItemsBulk([
    { card_id: 'c1', setCode: '001', foil: false, qty: 5 },   // set
    { card_id: 'c1', setCode: '002', foil: false, qty: 0 },   // clear owned, but 002 is wanted -> keep row
  ]);
  unsub();
  assert.equal(fired, 1, 'exactly ONE broadcast for the whole batch');
  assert.deepEqual(r, { set: 1, removed: 0, cleared: 1, unchanged: 0, cards: 1, copiesAdded: 4, copiesRemoved: 2 });
  const c1 = rows('SELECT variant_slug, qty_owned, qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=? ORDER BY variant_slug;', [PID, 'c1']);
  assert.equal(c1.find((x) => x.variant_slug === '001')?.qty_owned, 5);
  const beta = c1.find((x) => x.variant_slug === '002');
  assert.equal(beta?.qty_owned, 0, 'owned cleared'); assert.equal(beta?.qty_wanted, 1, 'want kept');
});

/* ---------------- setOwnedItemsBulk: barrier + write-outcome contract (direct) ---------------- */

const cmdSet = (exclusive = (fn) => fn(), over = {}) => createOwnedImportCommand(deps(exclusive, over)).setOwnedItemsBulk;

test('setOwnedItemsBulk: a barrier failure before tx is prewrite/none, no broadcast', async () => {
  const failBarrier = () => Promise.reject(new Error('drain timeout'));
  await assert.rejects(() => cmdSet(failBarrier)([{ card_id: 'c1', setCode: '001', foil: false, qty: 5 }]),
    (e) => e.name === 'BulkWriteError' && e.phase === 'prewrite' && e.writeState === 'none');
  assert.equal(notifyCount, 0);
});

test('setOwnedItemsBulk: apply-then-reject -> transaction/unknown, the write LANDED, one broadcast', async () => {
  seedOwn('001', 1);
  const applyThenReject = async (stmts) => { await runTx(stmts); throw new Error('IndexedDB quota exceeded'); };
  await assert.rejects(() => cmdSet((fn) => fn(), { tx: applyThenReject })([{ card_id: 'c1', setCode: '001', foil: false, qty: 9 }]),
    (e) => e.phase === 'transaction' && e.writeState === 'unknown');
  assert.equal(ownOf('001'), 9, 'the absolute set actually landed - "nothing written" would be a lie');
  assert.equal(notifyCount, 1);
});

test('setOwnedItemsBulk: an all-no-op batch runs no transaction and does not broadcast', async () => {
  seedOwn('001', 3);
  const r = await cmdSet()([{ card_id: 'c1', setCode: '001', foil: false, qty: 3 }]);   // already 3
  assert.deepEqual(r, { set: 0, removed: 0, cleared: 0, unchanged: 1, cards: 1, copiesAdded: 0, copiesRemoved: 0 });
  assert.equal(notifyCount, 0, 'no change -> no broadcast');
});

test('setOwnedItemsBulk: writes under the CAPTURED profile even if active switches mid-flight', async () => {
  const gate = deferred();
  let active = PID;
  const cmd2 = createOwnedImportCommand(deps((fn) => fn(), { activeProfileId: () => active, tx: async (s) => { await gate.promise; return runTx(s); } })).setOwnedItemsBulk;
  const p = cmd2([{ card_id: 'c1', setCode: '001', foil: false, qty: 4 }], PID);   // pid captured = p1
  active = 'p2';                       // active flips while the tx is parked
  gate.resolve();
  await p;
  assert.equal(ownOf('001', 'c1', PID), 4, 'landed in the captured profile');
  assert.equal(ownOf('001', 'c1', 'p2'), 0, 'nothing leaked into the switched-to profile');
});

test('PRODUCTION WIRING: exported setOwnedItemsBulk BLOCKS behind a held barrier write', async () => {
  __resetCollectionWritesForTests();
  const held = deferred();
  const first = enqueueWrite(ownedRowKey(PID, 'c1', '001'), async () => { await held.promise; });
  let ran = false;
  const bulk = setOwnedItemsBulk([{ card_id: 'c1', setCode: '001', foil: false, qty: 2 }]).then(() => { ran = true; });
  await settleTurns();
  assert.equal(ran, false, 'the bulk set waited for the in-flight write to drain');
  held.resolve(); await first; await bulk;
  assert.equal(ran, true);
});

/* ---------------- adjustOwnedItemsBulk: relative delta, floor 0, keep want (direct) ---------------- */

const cmdAdjust = (exclusive = (fn) => fn(), over = {}) => createOwnedImportCommand(deps(exclusive, over)).adjustOwnedItemsBulk;
const wantedOf = (slug, cardId = 'c1', pid = PID) =>
  rows('SELECT qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, slug])[0]?.qty_wanted ?? 0;
const rowExists = (slug, cardId = 'c1', pid = PID) =>
  rows('SELECT 1 FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, slug]).length > 0;

test('adjustOwnedItemsBulk: a positive delta RAISES against the present count', async () => {
  seedOwn('001', 2);
  const r = await cmdAdjust()([{ card_id: 'c1', setCode: '001', foil: false, delta: 3 }]);
  assert.equal(ownOf('001'), 5, '2 + 3');
  assert.deepEqual(r, { set: 1, removed: 0, cleared: 0, unchanged: 0, cards: 1, copiesAdded: 3, copiesRemoved: 0 });
  assert.equal(notifyCount, 1);
});

test('adjustOwnedItemsBulk: a positive delta on an ABSENT row inserts from 0', async () => {
  const r = await cmdAdjust()([{ card_id: 'c1', setCode: '001', foil: false, delta: 4 }]);
  assert.equal(ownOf('001'), 4);
  assert.equal(r.set, 1);
});

test('adjustOwnedItemsBulk: a negative delta LOWERS against the present count', async () => {
  seedOwn('001', 5);
  await cmdAdjust()([{ card_id: 'c1', setCode: '001', foil: false, delta: -3 }]);
  assert.equal(ownOf('001'), 2, '5 - 3');
});

test('adjustOwnedItemsBulk: removing MORE than present floors at 0 - row deleted when no want', async () => {
  seedOwn('001', 2);
  const r = await cmdAdjust()([{ card_id: 'c1', setCode: '001', foil: false, delta: -5 }]);
  assert.equal(rowExists('001'), false, 'floored to 0 with no want -> row removed');
  assert.deepEqual(r, { set: 0, removed: 1, cleared: 0, unchanged: 0, cards: 1, copiesAdded: 0, copiesRemoved: 2 },
    'only the 2 present copies were removed, not the requested 5');
});

test('adjustOwnedItemsBulk: falling to 0 KEEPS a wishlist want (owned zeroed, row survives)', async () => {
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [`s-want`, PID, 'c1', '001', 2, 1, '', 'x', 'x']);
  place('s-want', 2);
  const r = await cmdAdjust()([{ card_id: 'c1', setCode: '001', foil: false, delta: -9 }]);
  assert.equal(ownOf('001'), 0, 'owned cleared');
  assert.equal(wantedOf('001'), 1, 'the want is preserved');
  assert.equal(r.cleared, 1);
  assert.equal(r.copiesRemoved, 2, 'only the 2 present copies count as removed');
});

// The 999 REGRESSIONS: MAX_ITEM_QTY is an INPUT/delta limit, never a stored-ledger cap. A row already
// above 999 (two 999 imports = 1998) must adjust arithmetically, not be truncated to 999.
test('adjustOwnedItemsBulk: an existing total ABOVE 999 raises arithmetically - 1998 + 1 = 1999 (no truncation)', async () => {
  seedOwn('001', 1998);
  const r = await cmdAdjust()([{ card_id: 'c1', setCode: '001', foil: false, delta: 1 }]);
  assert.equal(ownOf('001'), 1999, 'raised, NOT clamped to 999 - that would silently delete ~999 copies');
  assert.equal(r.copiesAdded, 1);
  assert.equal(r.set, 1);
});

test('adjustOwnedItemsBulk: an existing total ABOVE 999 lowers arithmetically - 1998 - 1 = 1997', async () => {
  seedOwn('001', 1998);
  const r = await cmdAdjust()([{ card_id: 'c1', setCode: '001', foil: false, delta: -1 }]);
  assert.equal(ownOf('001'), 1997);
  assert.equal(r.copiesRemoved, 1);
});

test('adjustOwnedItemsBulk: a present count outside the safe-integer range rejects prewrite/none, no broadcast', async () => {
  seedOwn('001', Number.MAX_SAFE_INTEGER);   // a corrupt/overflowing row
  await assert.rejects(() => cmdAdjust()([{ card_id: 'c1', setCode: '001', foil: false, delta: 1 }]),
    (e) => e.phase === 'prewrite' && e.writeState === 'none' && /overflow/.test(e.message));
  assert.equal(notifyCount, 0, 'an unsafe overflow rejects without notification');
});

test('adjustOwnedItemsBulk: removing from an already-empty printing is a true no-op', async () => {
  const r = await cmdAdjust()([{ card_id: 'c1', setCode: '001', foil: false, delta: -3 }]);
  assert.deepEqual(r, { set: 0, removed: 0, cleared: 0, unchanged: 1, cards: 1, copiesAdded: 0, copiesRemoved: 0 });
  assert.equal(notifyCount, 0);
});

test('adjustOwnedItemsBulk: a mixed batch honours each card present count, one broadcast', async () => {
  seedOwn('001', 1);            // c1 Alpha non-foil = 1
  seedOwn('001', 4, 'ap');     // ap Alpha non-foil = 4
  const r = await cmdAdjust()([
    { card_id: 'c1', setCode: '001', foil: false, delta: 2 },   // 1 -> 3
    { card_id: 'ap', setCode: '001', foil: false, delta: -1 },  // 4 -> 3
  ]);
  assert.equal(ownOf('001', 'c1'), 3);
  assert.equal(ownOf('001', 'ap'), 3);
  assert.equal(r.set, 2);
  assert.equal(notifyCount, 1, 'one broadcast for the whole batch');
});

test('adjustOwnedItemsBulk: repeated deltas for one printing SUM before resolving', async () => {
  seedOwn('001', 1);
  await cmdAdjust()([
    { card_id: 'c1', setCode: '001', foil: false, delta: 2 },
    { card_id: 'c1', setCode: '001', foil: false, delta: 3 },
  ]);
  assert.equal(ownOf('001'), 6, '1 + (2 + 3), not a "conflicting target" rejection');
});

test('adjustOwnedItemsBulk: a zero or malformed delta is prewrite/none, nothing written', async () => {
  for (const delta of [0, 1.5, '3', null, undefined, MAX_ITEM_QTY + 1]) {
    notifyCount = 0;
    await assert.rejects(() => cmdAdjust()([{ card_id: 'c1', setCode: '001', foil: false, delta }]),
      (e) => e.phase === 'prewrite' && e.writeState === 'none', JSON.stringify(delta));
    assert.equal(notifyCount, 0);
  }
});

test('adjustOwnedItemsBulk: apply-then-reject -> transaction/unknown, the delta LANDED, one broadcast', async () => {
  seedOwn('001', 2);
  const applyThenReject = async (stmts) => { await runTx(stmts); throw new Error('IndexedDB quota exceeded'); };
  await assert.rejects(() => cmdAdjust((fn) => fn(), { tx: applyThenReject })([{ card_id: 'c1', setCode: '001', foil: false, delta: 3 }]),
    (e) => e.phase === 'transaction' && e.writeState === 'unknown');
  assert.equal(ownOf('001'), 5, 'the raise actually landed');
  assert.equal(notifyCount, 1);
});

test('adjustOwnedItemsBulk: writes under the CAPTURED profile even if active switches mid-flight', async () => {
  seedOwn('001', 1, 'c1', PID);
  const gate = deferred();
  let active = PID;
  const cmd2 = createOwnedImportCommand(deps((fn) => fn(), { activeProfileId: () => active, tx: async (s) => { await gate.promise; return runTx(s); } })).adjustOwnedItemsBulk;
  const p = cmd2([{ card_id: 'c1', setCode: '001', foil: false, delta: 3 }], PID);
  active = 'p2';
  gate.resolve();
  await p;
  assert.equal(ownOf('001', 'c1', PID), 4, 'landed in the captured profile');
  assert.equal(ownOf('001', 'c1', 'p2'), 0, 'nothing leaked into the switched-to profile');
});

test('PRODUCTION WIRING: exported adjustOwnedItemsBulk BLOCKS behind a held barrier write', async () => {
  __resetCollectionWritesForTests();
  const held = deferred();
  const first = enqueueWrite(ownedRowKey(PID, 'c1', '001'), async () => { await held.promise; });
  let ran = false;
  const bulk = adjustOwnedItemsBulk([{ card_id: 'c1', setCode: '001', foil: false, delta: 2 }]).then(() => { ran = true; });
  await settleTurns();
  assert.equal(ran, false, 'the adjust waited for the in-flight write to drain');
  held.resolve(); await first; await bulk;
  assert.equal(ran, true);
});

/* ---------------- createListWithEntries: one transaction, contract ---------------- */

const cmdList = (exclusive = (fn) => fn(), over = {}) => createOwnedImportCommand(deps(exclusive, over)).createListWithEntries;
const listRows = (pid = PID) => rows('SELECT id, kind, name FROM card_lists WHERE profile_id=?;', [pid]);
const entryCards = (listId) => rows('SELECT card_id FROM card_list_entries WHERE list_id=? ORDER BY card_id;', [listId]).map((r) => r.card_id);

test('createListWithEntries: list + entries commit together, de-duplicated, one broadcast', async () => {
  const r = await cmdList()({ kind: 'wanted', name: 'Buy list', cardIds: ['c1', 'c1', 'ap', 'wb'] });
  assert.equal(r.entries, 3);   // c1 de-duplicated
  assert.equal(notifyCount, 1);
  assert.deepEqual(entryCards(r.id).sort(), ['ap', 'c1', 'wb']);
  assert.equal(listRows().find((l) => l.id === r.id)?.kind, 'wanted');
});

test('createListWithEntries: a mid-transaction failure rolls BOTH the list and its entries back', async () => {
  const appendBad = (stmts) => runTx([...stmts, ['THIS IS NOT VALID SQL;', []]]);
  await assert.rejects(() => cmdList((fn) => fn(), { tx: appendBad })({ kind: 'custom', name: 'Doomed', cardIds: ['c1', 'ap'] }),
    (e) => e.phase === 'transaction' && e.writeState === 'unknown');
  assert.equal(listRows().find((l) => l.name === 'Doomed'), undefined, 'no half-populated list survives');
});

test('createListWithEntries: an empty name is prewrite/none, nothing written', async () => {
  await assert.rejects(() => cmdList()({ kind: 'custom', name: '   ', cardIds: ['c1'] }),
    (e) => e.phase === 'prewrite' && e.writeState === 'none');
  assert.equal(notifyCount, 0);
});

test('createListWithEntries: an UNKNOWN catalog id rejects the whole op - prewrite/none, no list, no broadcast', async () => {
  await assert.rejects(() => cmdList()({ kind: 'custom', name: 'Phantoms', cardIds: ['c1', 'ghost-card'] }),
    (e) => e.phase === 'prewrite' && e.writeState === 'none' && /unknown card/.test(e.message));
  assert.equal(listRows().find((l) => l.name === 'Phantoms'), undefined, 'no partially-populated list survives');
  assert.equal(rows("SELECT COUNT(*) n FROM card_list_entries WHERE card_id='ghost-card';")[0].n, 0, 'no phantom entry committed');
  assert.equal(notifyCount, 0, 'a rejected create never broadcasts');
});

test('createListWithEntries: a malformed id is REJECTED, not silently filtered', async () => {
  for (const bad of [['c1', ''], ['c1', '   '], ['c1', 42], ['c1', null], ['c1', { card_id: 'c1' }]]) {
    notifyCount = 0;
    await assert.rejects(() => cmdList()({ kind: 'custom', name: 'Malformed', cardIds: bad }),
      (e) => e.phase === 'prewrite' && e.writeState === 'none', `${JSON.stringify(bad)} should reject`);
    assert.equal(listRows().find((l) => l.name === 'Malformed'), undefined);
    assert.equal(notifyCount, 0);
  }
});

test('createListWithEntries: kind must be exactly wanted or custom; cardIds must be an array', async () => {
  await assert.rejects(() => cmdList()({ kind: 'buylist', name: 'X', cardIds: ['c1'] }),
    (e) => e.phase === 'prewrite' && e.writeState === 'none' && /kind must be/.test(e.message));
  await assert.rejects(() => cmdList()({ kind: 'custom', name: 'X', cardIds: 'c1' }),
    (e) => e.phase === 'prewrite' && e.writeState === 'none' && /must be an array/.test(e.message));
  assert.equal(notifyCount, 0);
});

test('createListWithEntries: the ceiling is enforced on the RAW array, before de-duplication', async () => {
  // 2001 duplicates of ONE real card dedupe to a single entry, but the raw count still exceeds the
  // ceiling - the guard must fire on the input, not the deduped set.
  const flood = Array.from({ length: MAX_BATCH_ITEMS + 1 }, () => 'c1');
  await assert.rejects(() => cmdList()({ kind: 'custom', name: 'Flood', cardIds: flood }),
    (e) => e.phase === 'prewrite' && e.writeState === 'none' && /exceeds 2000/.test(e.message));
  assert.equal(listRows().find((l) => l.name === 'Flood'), undefined);
  assert.equal(notifyCount, 0);
});

test('createListWithEntries: an apply-then-reject (web) is transaction/unknown with ONE invalidation', async () => {
  const applyThenReject = async (stmts) => { await runTx(stmts); throw new Error('IndexedDB quota exceeded'); };
  await assert.rejects(() => cmdList((fn) => fn(), { tx: applyThenReject })({ kind: 'custom', name: 'Landed', cardIds: ['c1', 'ap'] }),
    (e) => e.phase === 'transaction' && e.writeState === 'unknown');
  assert.equal(listRows().find((l) => l.name === 'Landed')?.name, 'Landed', 'the rows actually landed - "nothing written" would be a lie');
  assert.equal(notifyCount, 1, 'exactly one invalidation after an indeterminate write');
});

test('PRODUCTION WIRING: exported createListWithEntries BLOCKS behind a held barrier write', async () => {
  __resetCollectionWritesForTests();
  const held = deferred();
  const first = enqueueWrite(ownedRowKey(PID, 'c1', '001'), async () => { await held.promise; });
  let ran = false;
  const create = createListWithEntries({ kind: 'custom', name: 'Barriered', cardIds: ['c1'] }).then(() => { ran = true; });
  await settleTurns();
  assert.equal(ran, false, 'the list create waited for the in-flight write to drain');
  held.resolve(); await first; await create;
  assert.equal(ran, true);
});

test('createListWithEntries: writes under the CAPTURED profile even if active switches mid-flight', async () => {
  const gate = deferred();
  let active = PID;
  const cmd2 = createOwnedImportCommand(deps((fn) => fn(), { activeProfileId: () => active, tx: async (s) => { await gate.promise; return runTx(s); } })).createListWithEntries;
  const p = cmd2({ kind: 'custom', name: 'Captured', cardIds: ['c1'] }, PID);
  active = 'p2';
  gate.resolve();
  const r = await p;
  assert.equal(listRows(PID).find((l) => l.id === r.id)?.name, 'Captured', 'created under the captured profile');
  assert.equal(listRows('p2').find((l) => l.id === r.id), undefined, 'nothing under the switched-to profile');
});

/* ---------------- addEntriesToList: add to an EXISTING list, one transaction ---------------- */

const cmdAdd = (exclusive = (fn) => fn(), over = {}) => createOwnedImportCommand(deps(exclusive, over)).addEntriesToList;
const seedList = async (name, cardIds) => (await cmdList()({ kind: 'custom', name, cardIds })).id;

test('addEntriesToList: adds deduped ids, SKIPS ones already in the list, one broadcast', async () => {
  const id = await seedList('Binder', ['c1']);          // c1 already present
  notifyCount = 0;
  const r = await cmdAdd()({ listId: id, cardIds: ['c1', 'ap', 'ap', 'wb'] });   // c1 existing; ap deduped
  assert.equal(r.added, 2);        // ap + wb
  assert.equal(r.skipped, 1);      // c1 already there
  assert.deepEqual(entryCards(id), ['ap', 'c1', 'wb'], 'no duplicate c1 row');
  assert.equal(notifyCount, 1);
});

test('addEntriesToList: a list from ANOTHER profile is rejected - prewrite/none, nothing written', async () => {
  const other = createOwnedImportCommand(deps((fn) => fn(), { activeProfileId: () => 'p2' })).createListWithEntries;
  const foreign = (await other({ kind: 'custom', name: 'Theirs', cardIds: ['c1'] }, 'p2')).id;
  notifyCount = 0;
  await assert.rejects(() => cmdAdd()({ listId: foreign, cardIds: ['ap'] }),
    (e) => e.phase === 'prewrite' && e.writeState === 'none' && /no such list/.test(e.message));
  assert.deepEqual(entryCards(foreign), ['c1'], 'the foreign list is untouched');
  assert.equal(notifyCount, 0);
});

test('addEntriesToList: an UNKNOWN catalog id rejects the whole op - prewrite/none, no partial add', async () => {
  const id = await seedList('Guard', ['c1']);
  notifyCount = 0;
  await assert.rejects(() => cmdAdd()({ listId: id, cardIds: ['ap', 'ghost-card'] }),
    (e) => e.phase === 'prewrite' && e.writeState === 'none' && /unknown card/.test(e.message));
  assert.deepEqual(entryCards(id), ['c1'], 'nothing added when one id is bogus');
  assert.equal(notifyCount, 0);
});

test('addEntriesToList: the ceiling is enforced on the RAW array, before dedup', async () => {
  const id = await seedList('Flood2', ['c1']);
  const flood = Array.from({ length: MAX_BATCH_ITEMS + 1 }, () => 'ap');
  await assert.rejects(() => cmdAdd()({ listId: id, cardIds: flood }),
    (e) => e.phase === 'prewrite' && e.writeState === 'none' && /exceeds 2000/.test(e.message));
});

test('addEntriesToList: all ids already present -> added 0 / skipped N, no duplicate rows, ZERO broadcasts', async () => {
  const id = await seedList('Full', ['c1']);
  await cmdAdd()({ listId: id, cardIds: ['ap'] });       // now c1 + ap
  notifyCount = 0;
  const r = await cmdAdd()({ listId: id, cardIds: ['c1', 'ap'] });
  assert.equal(r.added, 0);
  assert.equal(r.skipped, 2);
  assert.deepEqual(entryCards(id), ['ap', 'c1']);
  assert.equal(notifyCount, 0, 'a no-op add wrote nothing, so it must not broadcast a Collection refresh');
});

test('addEntriesToList: writes under the CAPTURED profile even if active switches mid-flight', async () => {
  const targetA = await seedList('MineA', ['c1']);       // list owned by PID (A)
  const gate = deferred();
  let active = PID;
  // Move the active-profile read to a gated tx so the profile can switch after capture but before write.
  const cmd2 = createOwnedImportCommand(deps((fn) => fn(), {
    activeProfileId: () => active,
    tx: async (s) => { await gate.promise; return runTx(s); },
  })).addEntriesToList;
  const p = cmd2({ listId: targetA, cardIds: ['ap'] }, PID);   // pid captured = A
  active = 'p2';                                                // active switches to B mid-flight
  gate.resolve();
  const r = await p;
  assert.equal(r.added, 1);
  assert.deepEqual(entryCards(targetA), ['ap', 'c1'], 'the add landed on A - the captured profile, not the switched-to B');
});

test('addEntriesToList: a malformed id / missing listId / non-array is prewrite/none', async () => {
  await assert.rejects(() => cmdAdd()({ listId: '', cardIds: ['c1'] }),
    (e) => e.phase === 'prewrite' && e.writeState === 'none' && /listId is required/.test(e.message));
  const id = await seedList('Arr', ['c1']);
  await assert.rejects(() => cmdAdd()({ listId: id, cardIds: 'c1' }),
    (e) => e.phase === 'prewrite' && e.writeState === 'none' && /must be an array/.test(e.message));
  await assert.rejects(() => cmdAdd()({ listId: id, cardIds: ['ap', 42] }),
    (e) => e.phase === 'prewrite' && e.writeState === 'none' && /invalid card id/.test(e.message));
});

test('addEntriesToList: an apply-then-reject (web) is transaction/unknown with ONE invalidation', async () => {
  const id = await seedList('Landing', ['c1']);
  notifyCount = 0;
  const applyThenReject = async (stmts) => { await runTx(stmts); throw new Error('IndexedDB quota exceeded'); };
  await assert.rejects(() => cmdAdd((fn) => fn(), { tx: applyThenReject })({ listId: id, cardIds: ['ap'] }),
    (e) => e.phase === 'transaction' && e.writeState === 'unknown');
  assert.ok(entryCards(id).includes('ap'), 'the entry actually landed - "nothing written" would be a lie');
  assert.equal(notifyCount, 1);
});

test('PRODUCTION WIRING: exported addEntriesToList BLOCKS behind a held barrier write', async () => {
  const id = await seedList('Barriered2', ['c1']);
  __resetCollectionWritesForTests();
  const held = deferred();
  const first = enqueueWrite(ownedRowKey(PID, 'c1', '001'), async () => { await held.promise; });
  let ran = false;
  const add = addEntriesToList({ listId: id, cardIds: ['ap'] }).then(() => { ran = true; });
  await settleTurns();
  assert.equal(ran, false, 'the add waited for the in-flight write to drain');
  held.resolve(); await first; await add;
  assert.equal(ran, true);
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
  assert.deepEqual(res, { items: 4, cards: 1, copies: 10 });
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
  assert.deepEqual(await cmd()([]), { items: 0, cards: 0, copies: 0 });
  assert.equal(notifyCount, 0);
});

test('two 999 contributions for one item COMMIT 1998 (each is within the per-line bound)', async () => {
  // Codex Major 2: preview must not pre-merge to a 1998 item the writer rejects. Passed as two
  // 999 contributions, planOwnedItemBatch merges them to 1998, which is legitimate ownership.
  const res = await cmd()([
    { card_id: 'c1', setCode: '002', foil: false, qty: 999 },
    { card_id: 'c1', setCode: '002', foil: false, qty: 999 },
  ]);
  assert.deepEqual(res, { items: 1, cards: 1, copies: 1998 });
  assert.equal(ownOf('002'), 1998);
});

test('a single 1000 contribution is still invalid', async () => {
  await assert.rejects(() => cmd()([{ card_id: 'c1', setCode: '002', foil: false, qty: 1000 }]),
    (e) => e.phase === 'prewrite' && e.writeState === 'none');
  assert.equal(ownOf('002'), 0);
});

test('2001 contributions are rejected before catalog read or write', async () => {
  seedOwn('001', 7);
  let queried = false;
  const spyQuery = (s, p = []) => { if (/FROM cards/.test(s)) queried = true; return Promise.resolve(rows(s, p)); };
  const batch = Array.from({ length: MAX_BATCH_ITEMS + 1 }, () => ({ card_id: 'c1', setCode: '001', foil: false, qty: 1 }));
  await assert.rejects(() => cmd((fn) => fn(), { query: spyQuery })(batch),
    (e) => e.phase === 'prewrite' && e.writeState === 'none' && /exceeds 2000/.test(e.message));
  assert.equal(queried, false, 'no catalog query for an over-ceiling batch');
  assert.equal(ownOf('001'), 7, 'nothing written');
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
    // The competing write PLACES its copy, as every real writer now does. A stand-in that raises
    // the count without a place models an interleaving v12 cannot produce, and the import's
    // equality assertion - correctly - refuses to commit on top of it.
    sdb.run('UPDATE owned_cards SET qty_owned=? WHERE profile_id=? AND card_id=? AND variant_slug=?;', [cur + 1, PID, 'c1', '001']);
    sdb.run("UPDATE storage_allocations SET qty=qty+1 WHERE container_id=? AND owned_card_id=(SELECT id FROM owned_cards WHERE profile_id=? AND card_id='c1' AND variant_slug='001');", ['u-' + PID, PID]);
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

// ADJUST is a READ-modify-write (unlike the import's atomic +=), so a stale read is a lost update.
// These prove the authoritative read sits INSIDE the exclusive holder. The guarded arm asserts 3: it
// can ONLY reach 3 if the barrier drains the concurrent write BEFORE adjust reads. Hoist
// readCurrentOwned outside the holder and this arm drops to 2 and FAILS - that is the regression fence.
test('COUNTERFACTUAL (adjust): the real barrier makes the delta read the post-write value - final 3', async () => {
  const r = raceScenario(withExclusiveCollectionWrites);
  await r.absReadDone.promise;                               // the concurrent absolute write has read 1, parked
  const bulk = cmdAdjust(r.exclusive, { tx: r.tx })([{ card_id: 'c1', setCode: '001', foil: false, delta: 1 }]);
  r.absWriteGo.resolve();                                    // barrier drains it first: 1 -> 2
  await r.bulkAtTx.promise;                                  // adjust admitted AFTER; it read 2 inside the holder, plans 3
  r.bulkTxGo.resolve();
  await Promise.all([r.absolute, bulk]);
  assert.equal(ownOf('001'), 3, 'the delta resolved against the fresh 2 - no increment lost');
});

test('COUNTERFACTUAL control (adjust): a pass-through barrier reads stale and loses the increment - final 2', async () => {
  const r = raceScenario((fn) => fn());
  await r.absReadDone.promise;                               // absolute has read 1, parked
  const bulk = cmdAdjust(r.exclusive, { tx: r.tx })([{ card_id: 'c1', setCode: '001', foil: false, delta: 1 }]);
  await r.bulkAtTx.promise;                                  // no barrier: adjust already read the STALE 1, plans 2
  r.bulkTxGo.resolve();                                      // adjust writes 2
  await bulk;
  r.absWriteGo.resolve();                                    // absolute writes its stale 1+1 -> stays 2
  await r.absolute;
  assert.equal(ownOf('001'), 2, 'the delta read stale 1 - the concurrent increment was lost (this is what the holder-scoped read prevents)');
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
  assert.equal(res.items, 3, 'three collector items');
  assert.equal(res.cards, 2, 'two distinct cards (ap x2, wb)');
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
  assert.equal(res.items, 1);
  assert.equal(ownOf('001:f', 'wr'), 1, 'the sole foil printing, not a rejected non-foil phantom');
  assert.equal(ownOf('001', 'wr'), 0);
});

/* ================= production grammar path through previewCollectionText ================= */
//
// Codex Major 1: the production path must run the real line grammar (parseItemText), preserving
// problems into the review model, not clamp/drop. These drive previewCollectionText itself.

test('PRODUCTION PATH: malformed quantities are FLAGGED, not clamped or dropped or written', async () => {
  const { items, flagged } = await previewCollectionText('0 Wild Boars\n-1 Wild Boars\n1.5 Wild Boars');
  assert.equal(items.length, 0, 'no writable item from a malformed-quantity line');
  assert.deepEqual(flagged.map((f) => f.raw.trim()), ['0 Wild Boars', '-1 Wild Boars', '1.5 Wild Boars']);
  for (const f of flagged) assert.ok(f.problems.includes('quantity out of range'), f.raw);
});

test('PRODUCTION PATH: a bare line is quantity 1, headers are skipped', async () => {
  const { items } = await previewCollectionText('## Spellbook\nWild Boars\n// comment');
  assert.equal(items.length, 1);
  assert.equal(items[0].card_id, 'wb');
  assert.equal(items[0].qty, 1, 'a bare name is one copy, not dropped');
});

test('PRODUCTION PATH: two 999 lines survive as parts [999,999] and commit 1998 through the writer', async () => {
  const { items } = await previewCollectionText('999 Albespine Pikemen [Beta]\n999 Albespine Pikemen [Beta]');
  assert.equal(items.length, 1, 'one collector item...');
  assert.deepEqual(items[0].parts, [999, 999], '...but two contributions retained');
  assert.equal(items[0].qty, 1998);
  const res = await importCollectionResolved(buildImportItems(planCollectionImport({ items, unresolved: [], flagged: [] }), {}), PID);
  assert.equal(res.copies, 1998);
  assert.equal(ownOf('002', 'ap'), 1998, 'the paste preview and the durable writer agree');
});

test('PRODUCTION PATH: 2001 lines are rejected before any catalog query', async () => {
  const text = Array.from({ length: MAX_BATCH_ITEMS + 1 }, () => '1 Wild Boars').join('\n');
  await assert.rejects(() => previewCollectionText(text), (e) => e.name === 'ImportTooLarge');
});

test('PRODUCTION PATH: two set ALIASES resolve to one item; distinct FINISHES stay two', async () => {
  // Codex Minor: [Beta] and [002] name the same Beta printing - one review row, two copies, not
  // two printings. [Beta] and [Beta] [Foil] are genuinely different collector items - two rows.
  const alias = await previewCollectionText('1 Albespine Pikemen [Beta]\n1 Albespine Pikemen [002]');
  assert.equal(alias.items.length, 1, 'aliases collapse to one collector item');
  assert.equal(alias.items[0].qty, 2, 'both copies kept');
  assert.deepEqual(alias.items[0].resolved, { setCode: '002', foil: false });

  const finishes = await previewCollectionText('1 Albespine Pikemen [Beta]\n1 Albespine Pikemen [Beta] [Foil]');
  assert.equal(finishes.items.length, 2, 'non-foil and foil are distinct items');
});

test('a non-boolean foil cannot reach the writer through buildImportItems - no row, no broadcast', async () => {
  seedOwn('001', 3);
  const forged = [{ card_id: 'c1', name: 'C', key: 'c||0', qty: 1, parts: [1], sets: [{ code: '001', name: 'Alpha' }], resolved: { setCode: '001', foil: 'false' } }];
  assert.throws(() => buildImportItems(planCollectionImport({ items: forged, unresolved: [], flagged: [] })), /foil must be a boolean/);
  assert.equal(ownOf('001'), 3, 'nothing written');
  assert.equal(notifyCount, 0, 'no broadcast');
});
