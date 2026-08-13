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
import { __setActiveIdForTests, activeProfileId, getActiveProfile, listProfiles } from './profileRepository.js';
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

/* ------------------------------------------------------------------------------------------
 * THE ADDITIVE WHOLE-APP TESTS THAT USED TO LIVE HERE ARE GONE, DELIBERATELY.
 *
 * They asserted the behaviour the owner reversed: that a whole-app archive is ADDED alongside
 * what is on the device, that nothing is ever deleted, and that colliding names are suffixed.
 * Restore now REPLACES, so those assertions describe a contract that no longer exists - keeping
 * them passing would have required keeping the superseded code path alive.
 *
 * Every property they protected is asserted on the replace path instead, and this list is the
 * audit trail for that claim rather than a promise to take on trust:
 *
 *   round-trip + exactly one Primary  -> replaceAll.test.mjs "canonical equivalence with it"
 *   atomicity on failure              -> replaceAll.test.mjs "ATOMICITY: an injected failure at
 *                                        the FIRST/MIDDLE/LAST statement leaves the database
 *                                        byte-identical" (three positions, full byte dump)
 *   one transaction                   -> replaceAll.test.mjs "the journal row is in the SAME
 *                                        transaction as the deletes, last"
 *   active profile follows the archive-> replaceAll.test.mjs (Beta becomes active) and
 *                                        restoreReconcile.test.mjs
 *   runtime active id, no relaunch    -> restoreReconcile.test.mjs
 *   dash_seeded carried               -> replaceAll.test.mjs "dash_seeded keys are RE-KEYED"
 *   name collisions                   -> INVERTED on purpose: replace must NOT suffix
 *                                        (replaceAll.test.mjs "no (imported) suffix anywhere"),
 *                                        while import still does (the CONTRAST test there)
 *   "nothing is deleted"              -> RETIRED. The owner replaced this property; the opposite
 *                                        is now asserted ("the device state it replaced is gone").
 * ---------------------------------------------------------------------------------------- */

test('the ADDITIVE executor refuses a whole-app archive outright', async () => {
  // The boundary, not the caller, is what makes the routing safe. classifyBackup decides which
  // operation a file authorises; this proves restoreAll refuses to be the wrong one, so a dropped
  // or renamed `operation` field in the UI cannot silently reinstate additive whole-app restore.
  const { text } = await captureArchive();
  const preview = await previewBackup(text);
  const before = rows('SELECT COUNT(*) c FROM profiles;')[0].c;
  await assert.rejects(restoreAll(preview), (e) => e.code === 'whole-app-archive');
  assert.equal(rows('SELECT COUNT(*) c FROM profiles;')[0].c, before, 'a refused route must write nothing');
});

test('a post-commit failure on the IMPORT path is a CAVEAT, never a retryable failure', async () => {
  // Kept, and re-pointed at the additive path it actually governs. A retry after a committed
  // import adds the profile a second time, so reporting failure here would do more damage than
  // reporting success. The replace path has its own, harsher version of this in replaceAll.test.mjs:
  // there a retry could destroy the recovery point.
  const text = await legacyBundleText('Imported');
  const preview = await previewBackup(text);
  const realSet = globalThis.window.localStorage.setItem;
  globalThis.window.localStorage.setItem = () => { throw new Error('Preferences unavailable'); };

  let result;
  try {
    result = await restoreAll(preview);        // must NOT reject
  } finally {
    globalThis.window.localStorage.setItem = realSet;
  }

  assert.equal(result.activeReconciled, false, 'the caller needs to know the switch did not settle');
  assert.equal(result.profiles, 1, 'the rows committed regardless');
  assert.equal(rows("SELECT COUNT(*) c FROM profiles WHERE name='Imported';")[0].c, 1);
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

test('a whole-app archive is still identified as whole-app, not mistaken for legacy', async () => {
  // The classification half of the old test survives; its second half - that restoreAll then runs
  // it additively - is the behaviour the owner reversed, and the refusal is asserted above.
  const { text } = await captureArchive();
  const p = await previewBackup(text);
  assert.equal(p.kind, 'whole-app');
  assert.ok(Array.isArray(p.env?.payload?.profiles), 'a whole-app preview carries the envelope');
});
