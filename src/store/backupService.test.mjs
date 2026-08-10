// Whole-app backup and restore, end to end against a real in-memory database.
// Run: npm run test:query
//
// backup.js proves the artifact is well-formed. THIS proves the round trip actually moves a whole
// installation: every profile, the app-global state, exactly one default afterwards, and - the
// property the design turns on - that a failure leaves the database completely untouched.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js';
import { __setBackendForTests, __resetWriteGateForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { backupAll, previewBackup, restoreAll } from './backupService.js';

const require = createRequire(import.meta.url);
let sdb;
let realBackend;
let prefs;              // fake Capacitor Preferences store

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; }
  finally { st.free(); }
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

// saveTextFile's WEB branch (native.js:73-78) does a blob download. Stub just enough of the DOM to
// let the real backupAll() run end to end here, rather than testing a reimplementation of it.
function installFakeDom() {
  globalThis.document = {
    createElement: () => ({ href: '', download: '', click() {}, remove() {} }),
    body: { appendChild() {} },
  };
  URL.createObjectURL = () => 'blob:fake';
  URL.revokeObjectURL = () => {};
}

const seedProfile = (pid, name, isDefault) => {
  sdb.run('INSERT INTO profiles(id,name,avatar,accent,system,schema_version,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [pid, name, null, 'gold', 'sorcery', SCHEMA_VERSION, isDefault ? 1 : 0, '2026-01-01', '2026-01-01']);
  sdb.run('INSERT OR IGNORE INTO settings(profile_id) VALUES(?);', [pid]);
  sdb.run('INSERT INTO decks(id,profile_id,name,created_at,updated_at) VALUES(?,?,?,?,?);',
    [`${pid}-deck`, pid, `${name} Deck`, '2026-01-01', '2026-01-01']);
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [`${pid}-oc`, pid, 'sentinel_card', '004', 3, 0, '', '2026-01-01', '2026-01-01']);
};

before(async () => {
  installFakeStorage();
  installFakeDom();
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
  sdb.run('DELETE FROM profiles; DELETE FROM cards; DELETE FROM catalog_meta;');
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('sentinel_card','Sentinel','[{\"code\":\"004\"}]');");
  seedProfile('p-one', 'Alpha', true);
  seedProfile('p-two', 'Beta', false);
  __setActiveIdForTests('p-two');
  prefs.clear();
});

afterEach(() => {
  __resetWriteGateForTests();
  __setBackendForTests(realBackend);
});

/* WHAT IS AND IS NOT COVERED HERE. backupAll() runs for real, including the platform hand-off through
   saveTextFile's web branch. What node cannot tell us is where the file actually WENT - that is the
   share-sheet behaviour this feature deliberately refuses to claim ("prepared", not "stored"), and it
   is a Stage 6 device check. Restore is driven from an archive this file builds, so a restore test
   never depends on the file system. */

/* ------------------------------------------------------------------ */

test('backupAll runs end to end and reports what it prepared', async () => {
  // The REAL entry point, not a reimplementation: snapshot -> build every unit -> seal -> verify by
  // re-reading through parseBackup -> hand to the platform.
  const result = await backupAll({ appBuild: 214, now: new Date('2026-08-10T14:30:05Z') });
  assert.equal(result.status, 'prepared', 'never "stored" - the app cannot see where the file went');
  assert.equal(result.profiles, 2, 'every profile, not just the active one');
  assert.ok(result.rows > 0 && result.bytes > 0);
  assert.match(result.filename, /^compendium-backup-\d{8}-\d{6}\.json$/);
});

test('backupAll takes its reads inside a snapshot, so a concurrent write cannot split it', async () => {
  // Proves the wiring, not just that db.snapshot exists: if backupAll read outside the gate, the
  // write below would land between two of its table reads.
  let sawBeginRead = false;
  __setBackendForTests({
    ...realBackend,
    beginRead: () => { sawBeginRead = true; return realBackend.beginRead(); },
  });
  await backupAll({ appBuild: 214 });
  assert.ok(sawBeginRead, 'backupAll did not open a snapshot');
});

test('a whole-app archive round-trips every profile, and lands exactly one default', async () => {
  const { text } = await captureArchive();
  const { env, profiles } = await previewBackup(text);
  assert.equal(profiles.length, 2, 'both profiles must be in the archive');
  assert.deepEqual(profiles.map((p) => p.name).sort(), ['Alpha', 'Beta']);
  assert.equal(profiles.filter((p) => p.isDefault).length, 1);

  const before = rows('SELECT COUNT(*) c FROM profiles;')[0].c;
  const result = await restoreAll(env);
  assert.equal(result.profiles, 2);

  assert.equal(rows('SELECT COUNT(*) c FROM profiles;')[0].c, before + 2, 'restore must be ADDITIVE');
  assert.equal(rows('SELECT COUNT(*) c FROM profiles WHERE is_default=1;')[0].c, 1,
    'exactly one default profile must exist after a restore');
  // The archive's default won, so the pre-existing starter is now deletable by the user.
  const def = rows('SELECT name FROM profiles WHERE is_default=1;')[0].name;
  assert.match(def, /^Alpha/);
});

test('NOTHING is deleted by a restore - the design has no profile-deletion path', async () => {
  const { text } = await captureArchive();
  const { env } = await previewBackup(text);
  const namesBefore = rows('SELECT id FROM profiles ORDER BY id;').map((r) => r.id);
  await restoreAll(env);
  const after = rows('SELECT id FROM profiles ORDER BY id;').map((r) => r.id);
  for (const id of namesBefore) assert.ok(after.includes(id), `pre-existing profile ${id} was removed`);
});

test('name collisions are disambiguated against the device AND within the same restore', async () => {
  const { text } = await captureArchive();
  const { env } = await previewBackup(text);
  await restoreAll(env);
  const names = rows("SELECT name FROM profiles WHERE name LIKE 'Alpha%' ORDER BY name;").map((r) => r.name);
  assert.deepEqual(names, ['Alpha', 'Alpha (imported)']);

  // Restoring the SAME archive again must not collide with the copies it made last time.
  await restoreAll((await previewBackup(text)).env);
  const again = rows("SELECT name FROM profiles WHERE name LIKE 'Alpha%';").map((r) => r.name);
  assert.equal(new Set(again).size, again.length, `duplicate names: ${again.join(', ')}`);
});

test('ATOMICITY: a failure part-way through leaves the database exactly as it was', async () => {
  const { text } = await captureArchive();
  const { env } = await previewBackup(text);

  const snapshotOf = () => ({
    profiles: rows('SELECT id,name,is_default FROM profiles ORDER BY id;'),
    decks: rows('SELECT id,profile_id,name FROM decks ORDER BY id;'),
    owned: rows('SELECT id,profile_id,card_id,qty_owned FROM owned_cards ORDER BY id;'),
  });
  const before = snapshotOf();

  // Fail on the LAST statement, so a non-atomic implementation would already have written the first
  // profile in full - which is precisely the partial restore revision 2 accepted.
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

  await assert.rejects(restoreAll(env), /storage failed/);
  assert.deepEqual(snapshotOf(), before, 'a failed restore must leave nothing behind');
});

test('the whole restore is planned as ONE transaction, not one per profile', async () => {
  const { text } = await captureArchive();
  const { env } = await previewBackup(text);
  let txCalls = 0;
  __setBackendForTests({ ...realBackend, tx: (st) => { txCalls += 1; return realBackend.tx(st); } });
  await restoreAll(env);
  assert.equal(txCalls, 1, 'restore must commit once for the whole archive');
});

test('app-global state is carried: the active profile follows the archive', async () => {
  const { text } = await captureArchive();
  const { env } = await previewBackup(text);
  // 'Beta' was active when the archive was taken; its restored copy must become active.
  const result = await restoreAll(env);
  const activeName = rows('SELECT name FROM profiles WHERE id=?;', [result.activeProfileId])[0].name;
  assert.match(activeName, /^Beta/);
});

test('the dashboard-seeded flag is carried explicitly, per profile', async () => {
  sdb.run("INSERT OR REPLACE INTO catalog_meta(key,value) VALUES('dash_seeded:p-one','1');");
  const { text } = await captureArchive();
  const { env } = await previewBackup(text);
  assert.equal(env.payload.profiles.find((u) => u.profile.name === 'Alpha').dashSeeded, true);
  assert.equal(env.payload.profiles.find((u) => u.profile.name === 'Beta').dashSeeded, false);

  await restoreAll(env);
  const seeded = rows("SELECT key FROM catalog_meta WHERE key LIKE 'dash_seeded:%';").map((r) => r.key);
  assert.equal(seeded.length, 2, 'exactly the one seeded source profile plus its restored copy');
});

test('a corrupt archive is refused and writes nothing', async () => {
  const { text } = await captureArchive();
  const bad = text.replace('"qty_owned":3', '"qty_owned":99');
  const before = rows('SELECT COUNT(*) c FROM profiles;')[0].c;
  await assert.rejects(previewBackup(bad), (e) => e.code === 'corrupt');
  assert.equal(rows('SELECT COUNT(*) c FROM profiles;')[0].c, before);
});

/* ------------------------------------------------------------------ */

/**
 * Build the archive the way `backupAll` does, without going through `saveTextFile` (whose web branch
 * needs a DOM). This exercises snapshot + buildProfileUnit + seal + parseBackup - everything except
 * the platform hand-off, which is a Stage 6 device check.
 */
async function captureArchive() {
  const { snapshot } = await import('./db.js');
  const { listProfiles, activeProfileId } = await import('./profileRepository.js');
  const { buildProfileUnit } = await import('./profileTransfer.js');
  const { buildEnvelope, seal } = await import('./backup.js');

  const { units, idx } = await snapshot(async () => {
    const ps = await listProfiles();
    const built = [];
    for (const p of ps) built.push(await buildProfileUnit(p.id));
    return { units: built, idx: ps.findIndex((p) => p.id === activeProfileId()) };
  });
  const file = await seal(buildEnvelope({
    schemaVersion: SCHEMA_VERSION, appBuild: 214, exportedAt: '2026-08-10T10:00:00.000Z',
    appGlobal: { activeProfileIndex: idx, changelogSeenBuild: 213 }, profiles: units,
  }));
  return { text: JSON.stringify(file) };
}

/* ------------------------------------------------------------------ */
/* Legacy single-profile files - the shape that actually exists today  */
/* ------------------------------------------------------------------ */

/**
 * REGRESSION. The Restore button rejected every profile export ever written, with "unreadable
 * format", because parseBackup demands an integer bundleFormat and a legacy bundle has none. The
 * unit tests missed it: they only ever fed v2 envelopes they had just sealed, so the one input shape
 * that exists in the wild was the one never exercised. Found on a device, with a real archive.
 */
// Produced by the REAL legacy exporter, so the fixture cannot drift from what the app actually
// writes. A hand-built one was too thin - it omitted columns every real export carries, and the
// restore failed binding undefined, which said more about the fixture than about the code.
async function legacyBundleText(name = 'Sadkingbilly') {
  const { exportProfile } = await import('./profileTransfer.js');
  const b = await exportProfile('p-one');
  b.profile.name = name;
  return JSON.stringify(b);
}

test('REGRESSION: a legacy profile export (no bundleFormat) is READ, not rejected', async () => {
  const text = await legacyBundleText();
  assert.equal(JSON.parse(text).bundleFormat, undefined, 'fixture must have NO bundleFormat');
  const p = await previewBackup(text);
  assert.equal(p.kind, 'profile');
  assert.equal(p.profiles.length, 1);
  assert.equal(p.profiles[0].name, 'Sadkingbilly');
  assert.ok(p.profiles[0].decks >= 1);
  assert.ok(p.profiles[0].ownedCards >= 1);
});

test('REGRESSION: bundleFormat 1 is read as legacy too', async () => {
  const b = JSON.parse(await legacyBundleText());
  const p = await previewBackup(JSON.stringify({ ...b, bundleFormat: 1 }));
  assert.equal(p.kind, 'profile');
});

test('a legacy file restores through the existing per-profile import path', async () => {
  const before = rows('SELECT COUNT(*) c FROM profiles;')[0].c;
  const preview = await previewBackup(await legacyBundleText());
  const r = await restoreAll(preview);
  assert.equal(r.via, 'profile-import', 'must reuse importProfile, not re-plan the unit');
  assert.equal(r.profiles, 1);
  assert.equal(rows('SELECT COUNT(*) c FROM profiles;')[0].c, before + 1);
  assert.equal(rows('SELECT COUNT(*) c FROM decks WHERE profile_id=?;', [r.activeProfileId])[0].c, 1);
});

test('a legacy restore does not disturb the existing default profile', async () => {
  // Unlike a whole-app archive, a single profile carries no is_default claim, so it must not take
  // the flag from whatever is already here.
  const defBefore = rows('SELECT id FROM profiles WHERE is_default=1;')[0].id;
  await restoreAll(await previewBackup(await legacyBundleText()));
  assert.equal(rows('SELECT id FROM profiles WHERE is_default=1;')[0].id, defBefore);
  assert.equal(rows('SELECT COUNT(*) c FROM profiles WHERE is_default=1;')[0].c, 1);
});

test('a whole-app archive is still routed as whole-app, not mistaken for legacy', async () => {
  const { text } = await captureArchive();
  const p = await previewBackup(text);
  assert.equal(p.kind, 'whole-app');
  const r = await restoreAll(p);
  assert.equal(r.via, 'whole-app');
});
