// Primary as a role, against a real in-memory database. Run: npm run test:query
//
// The is_default flag is the deletion shield, and it used to be immortal: nothing could move it, so
// the profile a restore happened to crown could never be removed. These tests pin the role's new
// contract - transferable, enforced to EXACTLY one, and moved atomically so no failure can leave
// the database without a Primary or holding two.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js';
import { __setBackendForTests, __resetWriteGateForTests } from './db.js';
import {
  __setActiveIdForTests, activeProfileId, getActiveProfile, initProfiles, listProfiles,
  setPrimary, deleteProfile, deleteProfileTransferringPrimary,
} from './profileRepository.js';

const require = createRequire(import.meta.url);
let sdb;
let realBackend;
let prefs;              // fake Capacitor Preferences store

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; }
  finally { st.free(); }
};
const defaults = () => rows('SELECT id FROM profiles WHERE is_default=1 ORDER BY id;').map((r) => r.id);

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

// The persisted active-profile pointer, wherever Preferences prefixed it.
const storedActiveId = () => {
  for (const [k, v] of prefs) if (k.endsWith('activeProfileId')) return v;
  return null;
};

const seed = (pid, name, isDefault, createdAt = '2026-01-01') => {
  sdb.run('INSERT INTO profiles(id,name,avatar,accent,system,schema_version,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [pid, name, null, 'gold', 'sorcery', SCHEMA_VERSION, isDefault ? 1 : 0, createdAt, createdAt]);
  sdb.run('INSERT OR IGNORE INTO settings(profile_id) VALUES(?);', [pid]);
};

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
  sdb.run('DELETE FROM profiles;');
  seed('p-one', 'Alpha', true, '2026-01-01');
  seed('p-two', 'Beta', false, '2026-01-02');
  __setActiveIdForTests('p-one');
  prefs.clear();
});

afterEach(() => {
  __resetWriteGateForTests();
  __setBackendForTests(realBackend);
});

/* ------------------------------------------------------------------ */
/* setPrimary - the role moves, atomically                             */
/* ------------------------------------------------------------------ */

test('setPrimary moves the role and leaves exactly one Primary', async () => {
  await setPrimary('p-two');
  assert.deepEqual(defaults(), ['p-two']);
});

test('setPrimary refuses an unknown id and changes nothing', async () => {
  await assert.rejects(setPrimary('ghost'), /Unknown profile/);
  assert.deepEqual(defaults(), ['p-one']);
});

test('setPrimary is atomic: a failure mid-transaction leaves the previous Primary intact', async () => {
  // Fail on the LAST statement - a non-atomic clear-then-set would already have cleared every
  // flag, leaving the database with ZERO Primaries until the next boot repair.
  __setBackendForTests({
    ...realBackend,
    tx: (st) => {
      sdb.run('BEGIN;');
      try {
        st.forEach(([s, p = []], i) => {
          if (i === st.length - 1) throw new Error('storage failed at the last statement');
          sdb.run(s, p);
        });
        sdb.run('COMMIT;');
      } catch (e) { sdb.run('ROLLBACK;'); throw e; }
      return Promise.resolve();
    },
  });
  await assert.rejects(setPrimary('p-two'), /storage failed/);
  assert.deepEqual(defaults(), ['p-one'], 'the role must not move, and must not vanish');
});

test('setPrimary commits ONCE - clear and set are one transaction, never two run() writes', async () => {
  let txCalls = 0;
  const runWrites = [];
  __setBackendForTests({
    ...realBackend,
    run: (s, p) => { runWrites.push(s); return realBackend.run(s, p); },
    tx: (st) => { txCalls += 1; return realBackend.tx(st); },
  });
  await setPrimary('p-two');
  assert.equal(txCalls, 1);
  assert.ok(!runWrites.some((s) => /is_default/.test(s)),
    'a bare run() touching is_default means the role has a window with zero or two holders');
});

/* ------------------------------------------------------------------ */
/* deleteProfileTransferringPrimary - role transfer + delete, one tx   */
/* ------------------------------------------------------------------ */

test('deleting a Primary with transfer leaves exactly one Primary and the profile gone', async () => {
  __setActiveIdForTests('p-two');
  await deleteProfileTransferringPrimary('p-one', 'p-two');
  assert.deepEqual(defaults(), ['p-two']);
  assert.equal(rows('SELECT COUNT(*) c FROM profiles;')[0].c, 1);
  assert.equal(activeProfileId(), 'p-two', 'the active profile was not deleted, so it must not change');
});

test('deleting the ACTIVE Primary reconciles the active id immediately, with no relaunch', async () => {
  assert.equal(activeProfileId(), 'p-one', 'precondition: the Primary is active');
  await deleteProfileTransferringPrimary('p-one', 'p-two');
  // The repository runtime id is the gate every profile-scoped read and write passes through -
  // if it still says p-one, every later write lands in a deleted partition.
  assert.equal(activeProfileId(), 'p-two');
  assert.equal((await getActiveProfile()).name, 'Beta');
  assert.equal(storedActiveId(), 'p-two', 'the persisted pointer must agree with the runtime id');
});

test('transfer and delete commit as ONE transaction, not a role write then a delete', async () => {
  let txCalls = 0;
  const runWrites = [];
  __setBackendForTests({
    ...realBackend,
    run: (s, p) => { runWrites.push(s); return realBackend.run(s, p); },
    tx: (st) => { txCalls += 1; return realBackend.tx(st); },
  });
  await deleteProfileTransferringPrimary('p-one', 'p-two');
  assert.equal(txCalls, 1);
  assert.ok(!runWrites.some((s) => /is_default|DELETE FROM profiles/.test(s)),
    'role transfer or delete outside the transaction reopens the crash window between them');
});

test('transfer-and-delete is atomic: a failure leaves the Primary, the profile and the active id intact', async () => {
  __setBackendForTests({
    ...realBackend,
    tx: (st) => {
      sdb.run('BEGIN;');
      try {
        st.forEach(([s, p = []], i) => {
          if (i === st.length - 1) throw new Error('storage failed at the last statement');
          sdb.run(s, p);
        });
        sdb.run('COMMIT;');
      } catch (e) { sdb.run('ROLLBACK;'); throw e; }
      return Promise.resolve();
    },
  });
  await assert.rejects(deleteProfileTransferringPrimary('p-one', 'p-two'), /storage failed/);
  assert.deepEqual(defaults(), ['p-one']);
  assert.equal(rows('SELECT COUNT(*) c FROM profiles;')[0].c, 2, 'nothing may be deleted by a failed transfer');
  assert.equal(activeProfileId(), 'p-one', 'the active id must not move when the delete did not happen');
});

test('transfer-and-delete refuses: same id, unknown ids', async () => {
  await assert.rejects(deleteProfileTransferringPrimary('p-one', 'p-one'), /different profile/);
  await assert.rejects(deleteProfileTransferringPrimary('ghost', 'p-two'), /Unknown profile/);
  await assert.rejects(deleteProfileTransferringPrimary('p-one', 'ghost'), /Unknown profile/);
  assert.deepEqual(defaults(), ['p-one']);
  assert.equal(rows('SELECT COUNT(*) c FROM profiles;')[0].c, 2);
});

test('transfer-and-delete refuses a profile that is NOT the default', async () => {
  // Without this guard the function deletes an ordinary profile and hands the role to
  // newPrimaryId anyway - a silent reassignment nobody asked for, from a function whose
  // name promises a transfer. p-two is not the default, so this must refuse outright and
  // leave both the role and the row exactly where they were.
  await assert.rejects(deleteProfileTransferringPrimary('p-two', 'p-one'), /Not the default/);
  assert.deepEqual(defaults(), ['p-one'], 'the role must not move');
  assert.equal(rows('SELECT COUNT(*) c FROM profiles;')[0].c, 2, 'nothing may be deleted');
});

test('the sole remaining profile still cannot be deleted, by either path', async () => {
  sdb.run("DELETE FROM profiles WHERE id='p-two';");
  await assert.rejects(deleteProfile('p-one'), /only profile/);
  await assert.rejects(deleteProfileTransferringPrimary('p-one', 'p-two'), /only profile/);
  assert.equal(rows('SELECT COUNT(*) c FROM profiles;')[0].c, 1);
});

/* ------------------------------------------------------------------ */
/* initProfiles - EXACTLY one Primary, deterministically               */
/* ------------------------------------------------------------------ */

// The winner must be a function of the DATA (lowest created_at, then lowest id), never of SQL row
// order - ORDER BY leaves ties unspecified, so an order-dependent repair could crown a different
// profile on each device holding the same rows.

test('initProfiles collapses multiple Primaries to the lowest created_at', async () => {
  sdb.run('DELETE FROM profiles;');
  seed('p-late', 'Late', true, '2026-01-05');
  seed('p-early', 'Early', true, '2026-01-02');
  seed('p-none', 'Bystander', false, '2026-01-01');
  await initProfiles();
  assert.deepEqual(defaults(), ['p-early'], 'the oldest Primary keeps the role - not the oldest profile');
});

test('the collapse is order-independent: a created_at tie falls to the lowest id, seeded either way', async () => {
  const winnerAfterSeeding = async (order) => {
    sdb.run('DELETE FROM profiles;');
    for (const pid of order) seed(pid, pid, true, '2026-03-01');
    prefs.clear();
    await initProfiles();
    const d = defaults();
    assert.equal(d.length, 1, 'exactly one Primary must survive');
    return d[0];
  };
  const first = await winnerAfterSeeding(['p-bb', 'p-aa']);
  const second = await winnerAfterSeeding(['p-aa', 'p-bb']);
  assert.equal(first, second, 'insertion order must not pick the winner');
  assert.equal(first, 'p-aa', 'ties on created_at break to the lowest id');
});

test('initProfiles still repairs ZERO Primaries, to the deterministic oldest', async () => {
  sdb.run('UPDATE profiles SET is_default=0;');
  await initProfiles();
  assert.deepEqual(defaults(), ['p-one']);
});
