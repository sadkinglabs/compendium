// WHICH OPERATION DOES THIS FILE AUTHORISE? Increment 7 of docs/proposals/restore-semantics.md.
// Run: npm run test:query
//
// A whole-app backup authorises REPLACE. A single-profile export authorises IMPORT and nothing
// more - it is not permission to delete everything else on the device. That distinction used to be
// re-derived in three places (previewBackup, restoreAll, replaceAll), which is how a caller ends up
// pointing a single-profile file at a destructive path. classifyBackup answers it once.
//
// The other half of the increment is that an import must be OPENED without stealing the Primary
// role. restoreAll's legacy branch returned `activeProfileId: pid` while never switching to it, so
// the field named a profile that was not active - the caller was told where the data went and the
// app kept showing somewhere else.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js';
import { __setBackendForTests, __resetWriteGateForTests } from './db.js';
import { __setActiveIdForTests, activeProfileId, listProfiles } from './profileRepository.js';
import { __setBackingForTests } from './recoveryStore.js';
import {
  classifyBackup, previewBackup, restoreAll, replaceAll, REPLACE_ALL, IMPORT_PROFILE,
} from './backupService.js';
import { buildEnvelope, seal } from './backup.js';
import { buildProfileUnit } from './profileTransfer.js';
import { snapshot } from './db.js';

const require = createRequire(import.meta.url);
let sdb, realBackend, prefs;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; }
  finally { st.free(); }
};
const dump = () => { const b = Buffer.from(sdb.export()); sdb.run('PRAGMA foreign_keys = ON;'); return b; };
const defaults = () => rows('SELECT id FROM profiles WHERE is_default=1;').map((r) => r.id);

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

const memoryBacking = () => {
  const files = new Map();
  return {
    kind: 'native', files,
    async write(id, t) { files.set(id, t); }, async read(id) { return files.get(id) ?? null; },
    async remove(id) { files.delete(id); }, async list() { return [...files.keys()]; },
  };
};

function seedProfile(pid, name, isDefault, createdAt) {
  sdb.run('INSERT INTO profiles(id,name,avatar,accent,system,schema_version,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [pid, name, null, 'gold', 'sorcery', SCHEMA_VERSION, isDefault ? 1 : 0, createdAt, createdAt]);
  sdb.run('INSERT OR IGNORE INTO settings(profile_id) VALUES(?);', [pid]);
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [`${pid}-oc`, pid, 'sentinel_card', '004', 2, 0, '', createdAt, createdAt]);
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
  seedProfile('p-one', 'Alpha', true, '2026-01-01');
  seedProfile('p-two', 'Beta', false, '2026-01-02');
  __setActiveIdForTests('p-two');
  prefs.clear();
  __setBackingForTests(memoryBacking());
});

afterEach(() => {
  __resetWriteGateForTests();
  __setBackendForTests(realBackend);
  __setBackingForTests(null);
});

/** A sealed whole-app archive of the device's current state. */
async function wholeAppText() {
  const units = await snapshot(async () => {
    const out = [];
    for (const p of await listProfiles()) out.push(await buildProfileUnit(p.id));
    return out;
  });
  const env = await seal(buildEnvelope({
    schemaVersion: SCHEMA_VERSION, appBuild: 1, exportedAt: '2026-02-01T00:00:00.000Z',
    appGlobal: { activeProfileIndex: 0, changelogSeenBuild: null }, profiles: units,
  }));
  return JSON.stringify(env);
}

/** A legacy single-profile export. `bundleFormat` absent, or set explicitly. */
async function legacyText({ bundleFormat, name = 'Alpha' } = {}) {
  const unit = await snapshot(() => buildProfileUnit('p-one'));
  const bundle = { app: 'compendium', schemaVersion: SCHEMA_VERSION, exportedAt: '2026-02-01T00:00:00.000Z', ...unit };
  bundle.profile = { ...bundle.profile, name };
  if (bundleFormat !== undefined) bundle.bundleFormat = bundleFormat;
  return JSON.stringify(bundle);
}

/* ------------------------------ classification ------------------------------ */

test('a whole-app archive classifies as REPLACE, and is marked destructive', async () => {
  const c = await classifyBackup(await wholeAppText());
  assert.equal(c.operation, REPLACE_ALL);
  assert.equal(c.destructive, true, 'the UI needs this to decide how hard to ask');
  assert.equal(c.kind, 'whole-app');
});

test('a legacy file with NO bundleFormat classifies as IMPORT, and is not destructive', async () => {
  const c = await classifyBackup(await legacyText());
  assert.equal(c.operation, IMPORT_PROFILE);
  assert.equal(c.destructive, false);
  assert.equal(c.kind, 'profile');
});

test('bundleFormat 1 classifies as IMPORT too', async () => {
  const c = await classifyBackup(await legacyText({ bundleFormat: 1 }));
  assert.equal(c.operation, IMPORT_PROFILE);
  assert.equal(c.destructive, false);
});

/* ------------------------------ the refusal that matters ------------------------------ */

test('a single-profile file CANNOT reach the destructive path, and changes nothing', async () => {
  const preview = await previewBackup(await legacyText());
  const before = dump();
  await assert.rejects(replaceAll(preview), (e) => e.code === 'single-profile');
  assert.deepEqual(dump(), before, 'a refused replacement must not touch the database');
  assert.deepEqual(defaults(), ['p-one'], 'nor the Primary role');
  assert.equal(activeProfileId(), 'p-two', 'nor the active profile');
});

/* ------------------------------ import semantics ------------------------------ */

test('an imported profile is NOT Primary, and the existing Primary is untouched', async () => {
  const r = await restoreAll(await previewBackup(await legacyText({ name: 'Imported' })));
  assert.equal(r.via, 'profile-import');
  assert.deepEqual(defaults(), ['p-one'], 'an import must never take the Primary role');
  const imported = rows('SELECT id,is_default FROM profiles WHERE name=?;', ['Imported'])[0];
  assert.ok(imported, 'the profile was created');
  assert.equal(imported.is_default, 0);
});

test('an imported profile is OPENED, immediately, with no relaunch', async () => {
  // The regression: restoreAll returned activeProfileId without ever switching, so this field
  // named a profile that was not active.
  const r = await restoreAll(await previewBackup(await legacyText({ name: 'Imported' })));
  assert.equal(r.activeReconciled, true);
  assert.equal(activeProfileId(), r.activeProfileId, 'the reported id must be the ACTIVE id');
  const active = rows('SELECT name FROM profiles WHERE id=?;', [r.activeProfileId])[0];
  assert.equal(active.name, 'Imported', 'the app must be showing what was just imported');
  assert.notEqual(r.activeProfileId, 'p-two', 'still on the pre-import profile');
});

test('name collisions on import still dedupe - it is additive, so they are real', async () => {
  await restoreAll(await previewBackup(await legacyText({ name: 'Alpha' })));
  const names = rows("SELECT name FROM profiles WHERE name LIKE 'Alpha%' ORDER BY name;").map((r) => r.name);
  assert.equal(names.length, 2, 'the device already had an Alpha');
  assert.notEqual(names[0], names[1], 'two profiles must not share a name after an import');
});

/* ------------------------------ no regression in replace ------------------------------ */

test('a whole-app archive still replaces, and replacement does NOT dedupe names', async () => {
  const text = await wholeAppText();
  const r = await replaceAll(await previewBackup(text));
  assert.equal(r.via, 'replace');
  const names = rows('SELECT name FROM profiles ORDER BY name;').map((x) => x.name);
  assert.deepEqual(names, ['Alpha', 'Beta'], 'replace leaves exactly the archive, with no (imported) suffixes');
  assert.equal(defaults().length, 1, 'exactly one Primary survives');
});

/* ------------------------------ "Jump back in" survives a re-key ------------------------------ */

test('a resume pointer at a DECK follows the re-key instead of pointing at a dead id', async () => {
  // The bug this covers was invisible: overview() deletes a resume row whose target does not
  // resolve, so a verbatim deck id simply vanished on first Home load and the deck case silently
  // never worked across a restore.
  sdb.run('INSERT INTO decks(id,profile_id,name,created_at,updated_at) VALUES(?,?,?,?,?);',
    ['p-one-deck', 'p-one', 'Brambles', '2026-01-01', '2026-01-01']);
  sdb.run('INSERT INTO resume(profile_id,target_type,target_id,title,at) VALUES(?,?,?,?,?);',
    ['p-one', 'deck', 'p-one-deck', 'Brambles', '2026-01-01']);

  await replaceAll(await previewBackup(await wholeAppText()));

  const r = rows("SELECT target_type,target_id FROM resume WHERE target_type='deck';")[0];
  assert.ok(r, 'the resume row must survive the replacement');
  assert.notEqual(r.target_id, 'p-one-deck', 'the archived deck id is not the restored deck id');
  const deck = rows('SELECT id,name FROM decks WHERE id=?;', [r.target_id])[0];
  assert.ok(deck, 'the resume target must point at a deck that actually exists');
  assert.equal(deck.name, 'Brambles', 'and at the right one');
});

test('a resume pointer at a CARD is left alone - catalog ids are stable across a restore', async () => {
  sdb.run('INSERT INTO resume(profile_id,target_type,target_id,title,at) VALUES(?,?,?,?,?);',
    ['p-one', 'card', 'sentinel_card', 'Sentinel', '2026-01-01']);

  await replaceAll(await previewBackup(await wholeAppText()));

  const r = rows("SELECT target_id FROM resume WHERE target_type='card';")[0];
  assert.equal(r.target_id, 'sentinel_card', 'a catalog id must pass through unchanged');
});
