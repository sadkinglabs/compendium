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
import { stepWanted, stepOwnedBucket, setFoil, setOwnedInSet, setFoilInSet, setListEntry, stepListEntry, ownedRowKey, listRowKey , listCards, listEntries, exportListText, listProgress, listProgressBulk, listThumbsBulk } from './ownedRepository.js';
import { enqueueWrite, __resetCollectionWritesForTests } from './collectionWrites.js';

const require = createRequire(import.meta.url);
let sdb;

function defer() { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; }
const tick = () => new Promise((r) => setTimeout(r, 0));
// Sums across every row: post-v11 a want lives on its collector item, not on one fixed row.
const wantedOf = async (pid, cardId) =>
  (await query('SELECT SUM(qty_wanted) q FROM owned_cards WHERE profile_id=? AND card_id=?;', [pid, cardId]))[0]?.q ?? 0;
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
  // listCards joins the catalog, so the boundary tests need a real card row.
  sdb.run("INSERT INTO cards(card_id,name,system,sets) VALUES('c','Test Card','sorcery','[{\"code\":\"001\"}]');");
  // stepWanted resolves to a collector item now, so every fixture card needs its printings -
  // a card the catalog does not place in a set has no want row to resolve to.
  sdb.run("INSERT INTO cards(card_id,name,system,sets) VALUES('cardH','cardH','sorcery','[{\"code\":\"001\"}]');");
  sdb.run("INSERT INTO cards(card_id,name,system,sets) VALUES('cardX','cardX','sorcery','[{\"code\":\"001\"}]');");
  sdb.run("INSERT INTO cards(card_id,name,system,sets) VALUES('cardY','cardY','sorcery','[{\"code\":\"001\"}]');");

});

beforeEach(() => { sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards;'); sdb.run('DELETE FROM card_list_entries;'); __resetCollectionWritesForTests(); __setActiveIdForTests('A'); });

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
  { name: 'stepOwnedBucket', run: () => stepOwnedBucket('c', 1, 'A'),      read: (p) => ownedInRow(p, 'c', 'uncategorised'),   expect: 1 },
  { name: 'setFoil',         run: () => setFoil('c', 3, 'A'),              read: (p) => ownedInRow(p, 'c', 'uncategorised:f'), expect: 3 },
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

// Post-v11 these are DIFFERENT rows: card-level owned lands on the uncategorised row while a
// want resolves to its collector item. They no longer share storage, which is the point of the
// schema change - but they are still stepped through the same queue, and neither may clobber
// the other's read-modify-write.
test('wishlist and uncategorised-owned writes do not clobber each other', async () => {
  await stepOwnedBucket('c', 5, 'A');   // '' row owned=5
  await stepWanted('c', 2, 'A');        // '' row wanted=2 (same row)
  __resetCollectionWritesForTests();
  const key = ownedRowKey('A', 'c', '001', false);
  const d = defer();
  const pWanted = enqueueWrite(key, async () => { await d.p; return stepWanted('c', 1, 'A'); });
  const pOwned = enqueueWrite(key, () => stepOwnedBucket('c', 1, 'A'));
  d.resolve();
  await Promise.all([pWanted, pOwned]);
  assert.equal(await wantedOf('A', 'c'), 3, 'wanted 2 -> 3; the owned write did not restore stale wanted');
  assert.equal(await ownedInRow('A', 'c', 'uncategorised'), 6, 'owned 5 -> 6; the wanted write did not restore stale owned');
});

test('dropping uncategorised owned to 0 preserves the wishlist (no data loss)', async () => {
  // Device-found: a card in the Wishlist (qty_wanted on the '' row) that also has
  // Unspecified owned (bulk multi-set add lands here). Stepping owned to 0 via My
  // Collection must NOT delete the shared row and wipe the wishlist.
  await stepOwnedBucket('c', 2, 'A');   // '' row owned=2
  await stepWanted('c', 3, 'A');        // '' row wanted=3 (SAME row)
  await setOwnedInSet('c', '', 0, 'A'); // the My Collection Unspecified stepper path
  assert.equal(await ownedInRow('A', 'c', ''), 0, 'owned went to 0');
  assert.equal(await wantedOf('A', 'c'), 3, 'the wishlist on the same row survived');
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

test('a HUNG A-bound write does not trap the user in profile A, and still commits under A', async () => {
  // The tolerant barrier's integration case. Three things must hold together, and it is the
  // combination that justifies withProfileSwitchWriteBarrier existing at all:
  //   1. the switch to B completes after the bounded wait rather than hanging on the write;
  //   2. a write queued while the barrier was held runs under B once admission reopens;
  //   3. when the hung A-bound write finally resumes it STILL commits under A, because the
  //      write carries its own profileId and never consults the active id.
  // If (3) failed, proceeding past the drain would be silent cross-profile corruption and
  // the tolerant path would be indefensible.
  __setActiveIdForTests('A');
  __resetCollectionWritesForTests();
  const hung = defer();
  let hungCommitted = false;
  const slow = enqueueWrite(ownedRowKey('A', 'cardH', '', false), async () => {
    await hung.p;
    await stepWanted('cardH', 1, 'A');       // explicitly A-bound, scheduled while A was active
    hungCommitted = true;
  });

  await switchProfile('B', { timeoutMs: 20 });
  assert.equal(activeProfileId(), 'B', 'the switch completed despite the hung write');
  assert.equal(hungCommitted, false, 'and it completed WITHOUT waiting for that write');

  // A write queued after the flip belongs to B and must run once the barrier released.
  await enqueueWrite(ownedRowKey('B', 'cardH', '', false), async () => { await stepWanted('cardH', 1, 'B'); });
  assert.equal(await wantedOf('B', 'cardH'), 1, 'the B-bound write ran under B');

  hung.resolve();
  await slow;
  assert.equal(hungCommitted, true);
  assert.equal(await wantedOf('A', 'cardH'), 1, 'the hung write still committed under A');
  assert.equal(await wantedOf('B', 'cardH'), 1, 'and did not leak into B');
  __setActiveIdForTests('A');
});

test('switchProfile drains the queue before flipping the active profile (barrier preserves the edit)', async () => {
  __setActiveIdForTests('A');
  const d = defer();
  let committed = false;
  enqueueWrite(ownedRowKey('A', 'cardY', '', false), async () => { await d.p; await stepWanted('cardY', 1, 'A'); committed = true; });
  const switching = switchProfile('B');   // takes the exclusive Collection-write barrier
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

/* ---------------- profile boundary on READS, not just writes ---------------- */

test("another profile's list id returns NOTHING through every read path", async () => {
  // The disclosure this closes: the Collection nav cache is a module singleton holding a whole
  // list row, so opening A's list, switching to B and returning restored A's list under B -
  // name and entries rendered, and Export could hand them over. Writes had always refused the
  // foreign id; reads had not. The UI cache is now profile-aware AND every child-list read
  // joins card_lists on profile_id, because either guard alone is one refactor from leaking.
  __setActiveIdForTests('A');
  await setListEntry('LA', 'c', 3, 'A');
  assert.equal(await listQty('LA', 'c'), 3, 'the row exists under A');

  __setActiveIdForTests('B');
  assert.deepEqual(await listCards('LA'), [], 'listCards must not read across profiles');
  assert.deepEqual(await listEntries('LA'), [], 'listEntries must not read across profiles');
  assert.equal(await exportListText('LA'), '', 'export must produce nothing for a foreign list');

  const prog = await listProgress('LA');
  assert.equal(prog.totalRequired ?? 0, 0, 'progress must not compute from a foreign list');

  const bulk = await listProgressBulk(['LA']);
  assert.equal(bulk.get('LA')?.totalRequired ?? 0, 0, 'bulk progress must not leak either');

  const thumbs = await listThumbsBulk(['LA']);
  assert.equal(thumbs.get('LA'), undefined, 'thumbnails must not leak either');

  __setActiveIdForTests('A');
  assert.equal((await listCards('LA')).length, 1, 'and A can still read its own list');
});

test('an explicit profileId still wins over the active one', async () => {
  // The queued-write contract extended to reads: a caller that captured a profile can finish
  // its work correctly even after the active id moves.
  __setActiveIdForTests('A');
  await setListEntry('LA', 'c', 1, 'A');
  __setActiveIdForTests('B');
  const rows = await listCards('LA', 'A');
  assert.equal(rows.length, 1, 'explicitly asking as A returns A rows while B is active');
  assert.deepEqual(await listCards('LA'), [], 'and the default binding still refuses');
});

test('progress captures ONE profile even if the active id switches between its reads', async () => {
  // listProgress is two reads with an await between them. Each used to resolve the active
  // profile independently, so a switch landing in that gap combined one profile's
  // requirements with another's ownership.
  //
  // No interposition needed: the profile is captured SYNCHRONOUSLY when the call is made
  // (a default parameter), so switching immediately afterwards lands squarely in the gap
  // between the requirements read and the ownership read.
  __setActiveIdForTests('A');
  await setListEntry('LA', 'c', 2, 'A');       // A needs 2
  await setOwnedInSet('c', '001', 5, 'A');     // A owns 5 -> complete
  // B owns nothing and needs nothing.

  const pending = listProgress('LA');          // captures A here, before any await resolves
  __setActiveIdForTests('B');                  // switch inside the operation
  const prog = await pending;

  assert.equal(activeProfileId(), 'B', 'the active profile really did change mid-operation');
  assert.equal(prog.totalRequired, 2, "requirements came from A's list");
  assert.ok(prog.complete, "and ownership came from A too - 5 covers the 2 required");
  __setActiveIdForTests('A');
});

test('bulk progress captures one profile the same way', async () => {
  __setActiveIdForTests('A');
  await setListEntry('LA', 'c', 2, 'A');
  await setOwnedInSet('c', '001', 5, 'A');
  const pending = listProgressBulk(['LA']);
  __setActiveIdForTests('B');
  const out = await pending;
  assert.equal(out.get('LA')?.totalRequired, 2);
  assert.ok(out.get('LA')?.complete);
  __setActiveIdForTests('A');
});
