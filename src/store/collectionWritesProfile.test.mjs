// Profile-safety of the Collection write path, against a REAL in-memory sql.js DB with
// TWO profiles. Proves the integrity boundary Codex required: a queued write bound to
// profile A commits under A even if the active profile flips to B mid-flight, and
// switchProfile drains the queue before flipping. Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests, query } from './db.js';
import { __setActiveIdForTests, activeProfileId, switchProfile } from './profileRepository.js';
import { stepWanted, stepOwnedBucket, setFoil, setOwnedInSet, setFoilInSet, setListEntry, stepListEntry, ownedRowKey, listRowKey } from './ownedRepository.js';
import { enqueueWrite, __resetCollectionWritesForTests } from './collectionWrites.js';

const require = createRequire(import.meta.url);
let sdb;

function defer() { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; }
const tick = () => new Promise((r) => setTimeout(r, 0));
const wantedOf = async (pid, cardId) =>
  (await query('SELECT qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, '']))[0]?.qty_wanted ?? 0;
const ownedInRow = async (pid, cardId, slug) =>
  (await query('SELECT qty_owned FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, slug]))[0]?.qty_owned ?? 0;
const listQty = async (listId, cardId) =>
  (await query('SELECT quantity FROM card_list_entries WHERE list_id=? AND card_id=? AND variant_slug=?;', [listId, cardId, '']))[0]?.quantity ?? 0;

before(async () => {
  // switchProfile persists via @capacitor/preferences, whose web impl reads window.localStorage.
  if (typeof globalThis.window === 'undefined') {
    const store = new Map();
    globalThis.window = { localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
      key: (i) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    } };
  }
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
  for (const m of MIGRATIONS) sdb.run(m.sql);
  for (const id of ['A', 'B']) sdb.run('INSERT INTO profiles(id,name,schema_version,created_at) VALUES(?,?,?,?);', [id, id, 10, '2026-01-01']);
  sdb.run("INSERT INTO card_lists(id,profile_id,kind,name,created_at) VALUES('LA','A','custom','ListA','2026-01-01');");
  sdb.run("INSERT INTO card_lists(id,profile_id,kind,name,created_at) VALUES('LB','B','custom','ListB','2026-01-01');");
});

beforeEach(() => { sdb.run('DELETE FROM owned_cards;'); sdb.run('DELETE FROM card_list_entries;'); __resetCollectionWritesForTests(); __setActiveIdForTests('A'); });

test('a write bound to A commits under A even if the active profile flips to B mid-flight', async () => {
  __setActiveIdForTests('A');
  const d = defer();
  // Profile-bound fn (explicit 'A'); it awaits, THEN performs the read+write - the window
  // in which the old barrier-only design could be redirected.
  const p = enqueueWrite(ownedRowKey('A', 'cardX', '', false), async () => { await d.p; return stepWanted('cardX', 1, 'A'); });
  __setActiveIdForTests('B');   // the active profile changes while the write is in flight
  d.resolve();
  await p;
  assert.equal(await wantedOf('A', 'cardX'), 1, 'the edit landed in the ORIGIN profile A');
  assert.equal(await wantedOf('B', 'cardX'), 0, 'nothing leaked into B');
});

// Every interactive owned-row writer must honour an explicit profileId even when the
// ACTIVE profile is someone else - i.e. none of them silently re-resolves activeProfileId().
const OWNED_CASES = [
  { name: 'stepWanted',      run: () => stepWanted('c', 1, 'A'),           read: (p) => wantedOf(p, 'c'),          expect: 1 },
  { name: 'stepOwnedBucket', run: () => stepOwnedBucket('c', 1, 'A'),      read: (p) => ownedInRow(p, 'c', ''),    expect: 1 },
  { name: 'setFoil',         run: () => setFoil('c', 3, 'A'),              read: (p) => ownedInRow(p, 'c', 'foil'),expect: 3 },
  { name: 'setOwnedInSet',   run: () => setOwnedInSet('c', '001', 2, 'A'), read: (p) => ownedInRow(p, 'c', '001'), expect: 2 },
  { name: 'setFoilInSet',    run: () => setFoilInSet('c', '001', 2, 'A'),  read: (p) => ownedInRow(p, 'c', '001:f'),expect: 2 },
];
for (const tc of OWNED_CASES) {
  test(`${tc.name}(…, 'A') writes profile A's row, not B, while the ACTIVE profile is B`, async () => {
    __setActiveIdForTests('B');
    await tc.run();
    assert.equal(await tc.read('A'), tc.expect, 'wrote A (the explicit profile)');
    assert.equal(await tc.read('B'), 0, 'nothing leaked into B (the active profile)');
  });
}

test('list-entry writes are profile-scoped: an A-bound write cannot touch a B-owned list', async () => {
  await setListEntry('LB', 'c', 4, 'B');    // B's own list, seeded legitimately
  __setActiveIdForTests('B');               // active profile is B
  await setListEntry('LA', 'c', 2, 'A');    // A-bound, A's list -> writes despite active B
  await setListEntry('LB', 'c', 99, 'A');   // A-bound, B's list -> REFUSED at the boundary
  await stepListEntry('LB', 'c', 9, 'A');   // A-bound step on B's list -> reads 0 (scoped) then refuses
  assert.equal(await listQty('LA', 'c'), 2, 'A wrote its own list');
  assert.equal(await listQty('LB', 'c'), 4, "B-owned list untouched by A-bound writes");
});

test('stepListEntry bound to A steps its own list correctly while the active profile is B', async () => {
  await setListEntry('LA', 'c', 3, 'A');
  __setActiveIdForTests('B');
  await stepListEntry('LA', 'c', 2, 'A');   // 3 -> 5 on A's list
  assert.equal(await listQty('LA', 'c'), 5);
});

// Stage B shared-chain properties: the migrated callers key wishlist + unspecified-owned
// on the SAME '' owned_cards row, and both list-entry surfaces on the same (list,card)
// row - so serialized re-reads mean neither can clobber the other (races #1 and #3).
test('wishlist + unspecified-owned share the "" row chain and do not clobber each other', async () => {
  await stepOwnedBucket('c', 5, 'A');   // '' row owned=5
  await stepWanted('c', 2, 'A');        // '' row wanted=2 (same row)
  __resetCollectionWritesForTests();
  const key = ownedRowKey('A', 'c', '', false);   // wishlist AND name-level owned land here
  const d = defer();
  const pWanted = enqueueWrite(key, async () => { await d.p; return stepWanted('c', 1, 'A'); });
  const pOwned = enqueueWrite(key, () => stepOwnedBucket('c', 1, 'A'));
  d.resolve();
  await Promise.all([pWanted, pOwned]);
  assert.equal(await wantedOf('A', 'c'), 3, 'wanted 2 -> 3; the owned write did not restore stale wanted');
  assert.equal(await ownedInRow('A', 'c', ''), 6, 'owned 5 -> 6; the wanted write did not restore stale owned');
});

test('both list-entry surfaces share one (list,card) chain: concurrent +1s do not lose an update', async () => {
  const key = listRowKey('A', 'LA', 'c');
  const d = defer();
  const p1 = enqueueWrite(key, async () => { await d.p; return stepListEntry('LA', 'c', 1, 'A'); });
  const p2 = enqueueWrite(key, () => stepListEntry('LA', 'c', 1, 'A'));
  d.resolve();
  await Promise.all([p1, p2]);
  assert.equal(await listQty('LA', 'c'), 2, 'both +1s committed via serialized re-read; none lost');
});

test('switchProfile drains the queue before flipping the active profile (barrier preserves the edit)', async () => {
  __setActiveIdForTests('A');
  const d = defer();
  let committed = false;
  enqueueWrite(ownedRowKey('A', 'cardY', '', false), async () => { await d.p; await stepWanted('cardY', 1, 'A'); committed = true; });
  const switching = switchProfile('B');   // awaits settleCollectionWrites()
  await tick();
  assert.equal(activeProfileId(), 'A', 'must NOT flip while a Collection write is pending');
  assert.equal(committed, false);
  d.resolve();
  await switching;
  assert.equal(activeProfileId(), 'B', 'flips only after the drain');
  assert.equal(committed, true, 'the pending edit was preserved, committed under A');
  assert.equal(await wantedOf('A', 'cardY'), 1);
  __setActiveIdForTests('A');
});
