// Startup reconciliation - Increment 5 of docs/proposals/restore-semantics.md (Rev 4).
// Run: npm run test:query
//
// Each test CONSTRUCTS the exact database state a crash would leave and then runs
// reconciliation against it, exactly as the next boot would. The property under test is the
// startup table in §3: the journal row is the single durable fact, so its absence must read
// "nothing happened" (abandon the orphan, keep the published point, touch no profile) and its
// presence must read "finish idempotently" - and neither conclusion may ever flip.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Preferences } from '@capacitor/preferences';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js';
import { __setBackendForTests, __resetWriteGateForTests, snapshot, tx } from './db.js';
import { __setActiveIdForTests, activeProfileId, listProfiles } from './profileRepository.js';
import { buildProfileUnit } from './profileTransfer.js';
import { buildEnvelope, seal } from './backup.js';
import { RECOVERY_POINTER_KEY, __setBackingForTests, writeCandidate, promote } from './recoveryStore.js';
import { planReplace, RESTORE_PENDING_KEY } from './replacePlan.js';
import { reconcileRestore } from './restoreReconcile.js';

const require = createRequire(import.meta.url);
let sdb;
let realBackend;
let prefs;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; }
  finally { st.free(); }
};
const count = (table) => rows(`SELECT COUNT(*) c FROM ${table};`)[0].c;
const journalRow = () => rows('SELECT value FROM catalog_meta WHERE key=?;', [RESTORE_PENDING_KEY])[0]?.value ?? null;
const pointerRow = () => rows('SELECT value FROM catalog_meta WHERE key=?;', [RECOVERY_POINTER_KEY])[0]?.value ?? null;

/** The whole database as bytes - the only honest "untouched afterwards". sql.js export() closes
 *  and reopens the handle, which silently RESETS per-connection pragmas, so foreign_keys is
 *  re-asserted or every later cascade in the file would no-op. */
const dump = () => {
  const bytes = Buffer.from(sdb.export());
  sdb.run('PRAGMA foreign_keys = ON;');
  return bytes;
};

// @capacitor/preferences' web implementation reads window.localStorage.
function installFakeStorage() {
  prefs = new Map();
  globalThis.window = globalThis.window || {};
  globalThis.window.localStorage = {
    getItem: (k) => (prefs.has(k) ? prefs.get(k) : null),
    setItem: (k, v) => prefs.set(k, String(v)),
    removeItem: (k) => prefs.delete(k),
    clear: () => prefs.clear(),
    key: (i) => [...prefs.keys()][i] ?? null,
    get length() { return prefs.size; },
  };
  if (!globalThis.localStorage) globalThis.localStorage = globalThis.window.localStorage;
}

/** In-memory recovery backing, with every remove() recorded so "not deleted twice" is an
 *  observation rather than an inference. */
function memoryBacking() {
  const files = new Map();
  const removed = [];
  return {
    kind: 'native', files, removed,
    async write(id, text) { files.set(id, text); },
    async read(id) { return files.get(id) ?? null; },
    async remove(id) { files.delete(id); removed.push(id); },
    async list() { return [...files.keys()]; },
  };
}
let backing;

/** Every profile-owned table the plan re-keys gets a row, mirroring replaceAll.test.mjs, so the
 *  constructed replacement transaction is a REAL one rather than a stub. */
function seedProfile(pid, name, isDefault, createdAt) {
  const ts = createdAt;
  sdb.run('INSERT INTO profiles(id,name,avatar,accent,system,schema_version,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [pid, name, null, 'gold', 'sorcery', SCHEMA_VERSION, isDefault ? 1 : 0, ts, ts]);
  sdb.run('INSERT OR IGNORE INTO settings(profile_id) VALUES(?);', [pid]);
  sdb.run('INSERT INTO decks(id,profile_id,name,slug,archetype,avatar_card_id,avatar_slug,cover_slug,notes,curiosa_url,wins,losses,starred,lib_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);',
    [`${pid}-d1`, pid, `${name} Deck`, 'deck', null, null, null, null, '', null, 0, 0, 0, 0, ts, ts]);
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [`${pid}-oc1`, pid, 'sentinel_card', '004', 3, 0, '', ts, ts]);
}

before(async () => {
  installFakeStorage();
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  realBackend = {
    query: (s, p = []) => Promise.resolve(rows(s, p)),
    run: (s, p = []) => { sdb.run(s, p); return Promise.resolve(); },
    exec: (s) => { sdb.run(s); return Promise.resolve(); },
    tx: (st) => {
      sdb.run('BEGIN;');
      try { for (const [s, p = []] of st) sdb.run(s, p); sdb.run('COMMIT;'); }
      catch (e) { sdb.run('ROLLBACK;'); throw e; }
      return Promise.resolve();
    },
    persist: () => Promise.resolve(),
    beginRead: () => { sdb.run('BEGIN;'); return Promise.resolve(); },
    endRead: () => { sdb.run('COMMIT;'); return Promise.resolve(); },
  };
  __setBackendForTests(realBackend);
  for (const m of MIGRATIONS) sdb.run(m.sql);
});

beforeEach(() => {
  sdb.run('PRAGMA foreign_keys = ON;');
  sdb.run('DELETE FROM profiles; DELETE FROM cards; DELETE FROM catalog_meta;');
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('sentinel_card','Sentinel','[{\"code\":\"004\"}]');");
  sdb.run("INSERT OR REPLACE INTO catalog_meta(key,value) VALUES('version','7');");
  seedProfile('p-one', 'Alpha', true, '2026-01-01');
  seedProfile('p-two', 'Beta', false, '2026-01-02');
  __setActiveIdForTests('p-two');
  prefs.clear();
  backing = memoryBacking();
  __setBackingForTests(backing);
});

afterEach(() => {
  __resetWriteGateForTests();
  __setBackendForTests(realBackend);
  __setBackingForTests(null);
});

/* ------------------------------------------------------------------ */
/* Crash-state construction                                            */
/* ------------------------------------------------------------------ */

/** The device's current state as a sealed whole-app archive, via the real capture path. */
async function sealedDeviceArchive() {
  const env = await snapshot(async () => {
    const ps = await listProfiles();
    const units = [];
    for (const p of ps) units.push(await buildProfileUnit(p.id));
    let active = null;
    try { active = activeProfileId(); } catch { active = null; }
    const idx = ps.findIndex((p) => p.id === active);
    return buildEnvelope({
      schemaVersion: SCHEMA_VERSION, appBuild: 220, exportedAt: '2026-08-12T10:00:00.000Z',
      appGlobal: { activeProfileIndex: idx >= 0 ? idx : null, changelogSeenBuild: null },
      profiles: units,
    });
  });
  return seal(env);
}

/**
 * Construct the exact state a process killed AFTER the replacement commit leaves behind:
 * the candidate file exists, the one transaction (deletes + inserts + Primary + journal) is
 * committed, and NOTHING after it happened - no pointer, no active-profile reconciliation.
 * Then reset the in-process identity to what a fresh boot sees: no resolved active id, and
 * Preferences still naming the pre-restore profile.
 */
async function crashAfterCommit() {
  const captureEnv = await sealedDeviceArchive();
  const candidateId = await writeCandidate(JSON.stringify(captureEnv));
  const archive = await sealedDeviceArchive();   // restoring "the same data" - content is irrelevant here
  const plan = planReplace(archive, {
    candidateId, profileIds: ['p-one', 'p-two'], setsOf: () => ['004'],
  });
  await tx(plan.statements);
  __setActiveIdForTests(null);
  prefs.clear();
  globalThis.window.localStorage.setItem('CapacitorStorage.activeProfileId', 'p-two');
  return { candidateId, plan };
}

const activePref = async () => (await Preferences.get({ key: 'activeProfileId' })).value;

/* ------------------------------------------------------------------ */
/* Killed BEFORE the commit - no journal row                           */
/* ------------------------------------------------------------------ */

test('killed BEFORE the commit: the orphan is swept, the published point SURVIVES, no profile changes', async () => {
  // A previously published recovery point, from some earlier successful replace...
  const prevId = await writeCandidate(JSON.stringify(await sealedDeviceArchive()));
  await promote(prevId);
  // ...and the crashed attempt's candidate: written and verified, but the process died before
  // the replacement transaction, so there is NO journal row.
  const orphanId = await writeCandidate(JSON.stringify(await sealedDeviceArchive()));
  const before = dump();

  const r = await reconcileRestore();

  assert.equal(r.status, 'idle');
  assert.deepEqual(r.swept, [orphanId], 'exactly the orphan is swept');
  assert.equal(backing.files.has(orphanId), false, 'the orphan candidate is gone');
  assert.equal(backing.files.has(prevId), true, 'the previously published point must survive the sweep');
  assert.equal(JSON.parse(pointerRow()).id, prevId, 'the pointer still names the previous point');
  assert.deepEqual(dump(), before, 'no database write may follow a replacement that never committed');
  assert.equal(activeProfileId(), 'p-two', 'no profile state changes when nothing happened');
});

/* ------------------------------------------------------------------ */
/* Killed AFTER the commit - journal present, pointer unpublished      */
/* ------------------------------------------------------------------ */

test('killed AFTER the commit: the finish is completed from the journal row alone', async () => {
  const { candidateId, plan } = await crashAfterCommit();
  assert.ok(journalRow(), 'precondition: the crash left the journal row');
  assert.equal(pointerRow(), null, 'precondition: the crash preceded the pointer publish');

  const r = await reconcileRestore();

  assert.equal(r.status, 'finished');
  // The pointer is published from the journal's candidateId.
  assert.equal(JSON.parse(pointerRow()).id, candidateId);
  // Active and Primary are reconciled to the journal's ids - active THROUGH switchProfile,
  // which is why Preferences and the in-memory id agree.
  assert.equal(activeProfileId(), plan.intendedActiveId);
  assert.equal(await activePref(), plan.intendedActiveId);
  const defaults = rows('SELECT id FROM profiles WHERE is_default=1;');
  assert.deepEqual(defaults.map((d) => d.id), [plan.intendedPrimaryId], 'exactly one Primary, the journal\'s');
  // The archive's active and Primary differ (Beta active, Alpha Primary), so this cannot pass
  // by conflating the two.
  assert.notEqual(plan.intendedActiveId, plan.intendedPrimaryId);
  // The journal row is deleted, and the candidate file - now the recovery point - remains.
  assert.equal(journalRow(), null);
  assert.equal(backing.files.has(candidateId), true);
});

/* ------------------------------------------------------------------ */
/* Killed MID-PUBLISH - pointer published, journal still present       */
/* ------------------------------------------------------------------ */

test('killed MID-PUBLISH: the journal is retired and the previous point is not deleted twice', async () => {
  // The previous recovery point, published before this replace...
  const prevId = await writeCandidate(JSON.stringify(await sealedDeviceArchive()));
  await promote(prevId);
  // ...then the replace commits and gets as far as promote() - which published the new pointer
  // and removed the previous file - before dying with the journal row still in place.
  const { candidateId } = await crashAfterCommit();
  await promote(candidateId);
  assert.deepEqual(backing.removed, [prevId], 'precondition: promote already deleted the previous point once');
  assert.ok(journalRow(), 'precondition: the journal row survived the crash');

  const r = await reconcileRestore();

  assert.equal(r.status, 'finished');
  assert.equal(journalRow(), null, 'the journal is retired');
  assert.equal(JSON.parse(pointerRow()).id, candidateId, 'the pointer still names the candidate');
  assert.equal(backing.files.has(candidateId), true, 'the published point is never swept');
  assert.deepEqual(backing.removed, [prevId], 'the previous point is deleted once, never twice');
});

/* ------------------------------------------------------------------ */
/* Idempotence - a second run is a no-op                               */
/* ------------------------------------------------------------------ */

test('reconciliation run twice: the second run is a no-op', async () => {
  await crashAfterCommit();
  const first = await reconcileRestore();
  assert.equal(first.status, 'finished');

  const bytes = dump();
  const files = new Map(backing.files);
  const active = activeProfileId();

  const second = await reconcileRestore();

  assert.equal(second.status, 'idle', 'with the journal retired there is nothing left to finish');
  assert.deepEqual(second.swept, [], 'nothing qualifies as an orphan after a clean finish');
  assert.deepEqual(dump(), bytes, 'the database is byte-identical across the second run');
  assert.deepEqual(new Map(backing.files), files, 'the stored recovery point is untouched');
  assert.equal(activeProfileId(), active);
});

/* ------------------------------------------------------------------ */
/* Failure leaves the journal row - and never blocks boot              */
/* ------------------------------------------------------------------ */

test('a reconciliation failure LEAVES the journal row and resolves instead of throwing', async () => {
  const { candidateId, plan } = await crashAfterCommit();
  // Inject a failure in the reconcile step itself: the first write of the finish (setPrimary's
  // transaction) dies, as a mid-boot storage failure would.
  __setBackendForTests({ ...realBackend, tx: async () => { throw new Error('injected reconcile failure'); } });
  const logged = [];
  const realError = console.error;
  console.error = (...a) => logged.push(a);

  let r;
  try { r = await reconcileRestore(); }
  finally { console.error = realError; }

  // Resolved, not rejected - the dynamic form of "boot is not blocked".
  assert.equal(r.status, 'deferred');
  assert.match(r.error, /injected reconcile failure/);
  assert.equal(logged.length, 1, 'the failure is logged, not silent');
  assert.ok(journalRow(), 'the journal row survives so the next boot can retry');
  assert.equal(pointerRow(), null, 'no pointer may be published by a failed finish');

  // And the next boot DOES retry, to completion.
  __setBackendForTests(realBackend);
  const retry = await reconcileRestore();
  assert.equal(retry.status, 'finished');
  assert.equal(JSON.parse(pointerRow()).id, candidateId);
  assert.equal(activeProfileId(), plan.intendedActiveId);
  assert.equal(journalRow(), null);
});
