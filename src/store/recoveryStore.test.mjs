// The recovery snapshot store, against BOTH backings - the real native (Filesystem) and web
// (IndexedDB) implementations driven over fake platform APIs, plus a real in-memory database for
// the pointer. Run: npm run test:query
//
// What this file pins is the crash-safety ORDERING, not just end states: the pointer commits
// before the previous file is deleted, a failed pointer commit deletes nothing, and an orphaned
// candidate is swept without touching the published point.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests, __resetWriteGateForTests } from './db.js';
import { buildEnvelope, seal, contentDigestOf } from './backup.js';
import {
  RECOVERY_POINTER_KEY,
  listRecoveryPoints, writeCandidate, verifyCandidate, readRecoveryPoint,
  deleteRecoveryPoint, promote, currentRecoveryPointId, sweepOrphans, durability,
  __setBackingForTests, __nativeBackingForTests, __webBackingForTests,
} from './recoveryStore.js';

const require = createRequire(import.meta.url);
let sdb;
let realBackend;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; }
  finally { st.free(); }
};

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
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
  sdb.run('DELETE FROM catalog_meta;');
  __setBackendForTests(realBackend);
});

afterEach(() => {
  __resetWriteGateForTests();
  __setBackendForTests(realBackend);
  __setBackingForTests(null);   // next test must install its own
});

/* ------------------------------------------------------------------ */
/* Fake platform APIs - faithful to the surface each backing touches   */
/* ------------------------------------------------------------------ */

// @capacitor/filesystem: keyed on directory + path, throws on missing files like the plugin does.
function fakeFilesystem() {
  const files = new Map();   // 'DATA/recovery/rp-x.json' -> text
  const key = (o) => `${o.directory}/${o.path}`;
  return {
    files,
    async writeFile(o) { files.set(key(o), o.data); return { uri: `file://${key(o)}` }; },
    async readFile(o) {
      if (!files.has(key(o))) throw new Error('File does not exist.');
      return { data: files.get(key(o)) };
    },
    async deleteFile(o) { if (!files.delete(key(o))) throw new Error('File does not exist.'); },
    async readdir(o) {
      const prefix = `${key(o)}/`;
      const names = [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
      if (!names.length) throw new Error('Directory does not exist.');
      return { files: names.map((name) => ({ name, type: 'file' })) };
    },
  };
}

// indexedDB: just enough of the event-based request/transaction surface for the web backing -
// open with onupgradeneeded, one op per transaction, oncomplete fired after the request settles.
function fakeIndexedDB() {
  const dbs = new Map();     // name -> Map(storeName -> Map(key -> value))
  const factory = {
    open(name) {
      const r = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null, error: null };
      queueMicrotask(() => {
        const isNew = !dbs.has(name);
        if (isNew) dbs.set(name, new Map());
        const stores = dbs.get(name);
        r.result = {
          createObjectStore: (s) => { stores.set(s, new Map()); },
          transaction: (storeName, mode) => makeTx(stores.get(storeName), mode),
        };
        if (isNew) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  };
  function makeTx(store) {
    const t = { oncomplete: null, onerror: null, onabort: null, error: null };
    let fired = false;
    const settle = (req, work) => {
      queueMicrotask(() => {
        try { req.result = work(); req.onsuccess?.(); }
        catch (e) { req.error = e; t.error = e; req.onerror?.(); if (!fired) { fired = true; t.onerror?.(); } return; }
        if (!fired) { fired = true; queueMicrotask(() => t.oncomplete?.()); }
      });
    };
    const request = (work) => { const req = { onsuccess: null, onerror: null, result: undefined, error: null }; settle(req, work); return req; };
    t.objectStore = () => ({
      put: (value, k) => request(() => { store.set(k, value); return k; }),
      get: (k) => request(() => store.get(k)),
      delete: (k) => request(() => { store.delete(k); return undefined; }),
      getAllKeys: () => request(() => [...store.keys()]),
    });
    return t;
  }
  return { factory, dbs };
}

/* ------------------------------------------------------------------ */
/* One suite, two backings                                             */
/* ------------------------------------------------------------------ */

// Each context exposes the same handles: the backing under test, direct access to the stored
// bytes (to corrupt them and to observe files), and the durability the fake platform implies.
const contexts = [
  {
    name: 'native/Filesystem',
    expectedPersistent: true,
    make() {
      const fs = fakeFilesystem();
      const fileKey = (id) => `DATA/recovery/${id}.json`;
      return {
        backing: __nativeBackingForTests(fs),
        has: (id) => fs.files.has(fileKey(id)),
        corrupt: (id, mutate) => fs.files.set(fileKey(id), mutate(fs.files.get(fileKey(id)))),
      };
    },
  },
  {
    name: 'web/IndexedDB',
    expectedPersistent: false,   // node has no navigator.storage, and the probe must say so
    make() {
      const idb = fakeIndexedDB();
      const store = () => idb.dbs.get('compendium_recovery')?.get('files') ?? new Map();
      return {
        backing: __webBackingForTests(idb.factory),
        has: (id) => store().has(id),
        corrupt: (id, mutate) => store().set(id, mutate(store().get(id))),
      };
    },
  },
];

const archiveText = async ({ decks = 1, exportedAt = '2026-08-12T10:00:00.000Z' } = {}) => {
  const unit = {
    profile: { name: 'Alpha', avatar: null, accent: 'gold', system: 'sorcery', is_default: 1, created_at: '2026-01-01', updated_at: '2026-01-01' },
    dashSeeded: false,
    decks: Array.from({ length: decks }, (_, i) => ({ id: `d-${i}`, name: `Deck ${i}` })),
    deck_entries: [], deck_history: [], saved: [], notes: [], collections: [], collection_items: [],
    owned_cards: [], card_lists: [], card_list_entries: [], links: [], matches: [],
    match_log_entries: [], dashboard_blocks: [], dashboard_layouts: [], resume: null, settings: null,
  };
  const env = await seal(buildEnvelope({
    schemaVersion: 11, appBuild: 213, exportedAt,
    appGlobal: { activeProfileIndex: 0, changelogSeenBuild: null }, profiles: [unit],
  }));
  return JSON.stringify(env);
};

for (const context of contexts) {
  const t = (name, fn) => test(`[${context.name}] ${name}`, async () => {
    const ctx = context.make();
    __setBackingForTests(ctx.backing);
    await fn(ctx);
  });

  t('a candidate round-trips, verifies, and its id is never reused', async (ctx) => {
    const text = await archiveText();
    const a = await writeCandidate(text);
    const b = await writeCandidate(text);
    assert.notEqual(a, b, 'same bytes, distinct immutable ids - nothing is ever overwritten');
    assert.equal(await readRecoveryPoint(a), text);
    assert.equal(await verifyCandidate(a), true);
    assert.equal(ctx.has(a) && ctx.has(b), true);
  });

  t('verifyCandidate rejects a corrupted candidate', async (ctx) => {
    const id = await writeCandidate(await archiveText());
    assert.equal(await verifyCandidate(id), true, 'sanity: intact bytes verify');
    // Flip user data underneath the store, the way storage rot would - the JSON stays parseable,
    // only the recomputed digest can notice.
    ctx.corrupt(id, (text) => text.replace('"Deck 0"', '"Deck X"'));
    assert.equal(await verifyCandidate(id), false);
    assert.equal(await verifyCandidate('rp-never-written'), false, 'missing is unverifiable, not an error');
  });

  t('promote publishes the point: pointer, metadata, and the comparable digest', async () => {
    const text = await archiveText({ decks: 3 });
    const id = await writeCandidate(text);
    assert.equal(await currentRecoveryPointId(), null);
    const meta = await promote(id);
    assert.equal(await currentRecoveryPointId(), id);
    const listed = await listRecoveryPoints();
    assert.equal(listed.length, 1, 'retention is ONE published point');
    assert.deepEqual(listed[0], meta);
    assert.equal(meta.profiles, 1);
    assert.equal(meta.rows, 3);
    assert.equal(meta.createdAt, '2026-08-12T10:00:00.000Z');
    assert.equal(meta.digest, await contentDigestOf(JSON.parse(text)),
      'the listed digest is the CONTENT digest - the one Increment 3 can compare');
  });

  t('the previous point is removed only AFTER the new pointer commits', async (ctx) => {
    const a = await promote(await writeCandidate(await archiveText()));
    const b = await writeCandidate(await archiveText({ decks: 2 }));

    // Instrument both sides of the ordering: the database write that commits the pointer, and the
    // backing delete that removes the old file.
    const events = [];
    __setBackendForTests({
      ...realBackend,
      run: (s, p = []) => {
        if (p?.[0] === RECOVERY_POINTER_KEY) events.push(`pointer-commit:${JSON.parse(p[1]).id}`);
        return realBackend.run(s, p);
      },
    });
    __setBackingForTests({
      ...ctx.backing,
      remove: (id) => { events.push(`remove:${id}`); return ctx.backing.remove(id); },
    });

    await promote(b);
    assert.equal(await currentRecoveryPointId(), b);
    assert.equal(ctx.has(a.id), false, 'the old file is gone in the end state');
    const commitAt = events.indexOf(`pointer-commit:${b}`);
    const removeAt = events.indexOf(`remove:${a.id}`);
    assert.ok(commitAt !== -1 && removeAt !== -1, `both events observed: ${events.join(', ')}`);
    assert.ok(commitAt < removeAt,
      `the pointer must commit before the previous file is deleted - saw: ${events.join(', ')}`);
  });

  t('a failed pointer commit deletes nothing - the previous point stays published and intact', async (ctx) => {
    const a = await promote(await writeCandidate(await archiveText()));
    const b = await writeCandidate(await archiveText({ decks: 2 }));

    __setBackendForTests({
      ...realBackend,
      run: (s, p = []) => {
        if (p?.[0] === RECOVERY_POINTER_KEY) return Promise.reject(new Error('injected: disk full'));
        return realBackend.run(s, p);
      },
    });
    await assert.rejects(() => promote(b), /injected/);

    __setBackendForTests(realBackend);
    assert.equal(await currentRecoveryPointId(), a.id, 'the pointer still names the previous point');
    assert.equal(ctx.has(a.id), true, 'and its file was never touched');
    assert.equal(await verifyCandidate(a.id), true);
  });

  t('a crash between write and promote leaves an orphan; sweepOrphans clears it, the published point survives', async (ctx) => {
    const a = await promote(await writeCandidate(await archiveText()));
    // The crash: a candidate is written, then the process dies before promote. Nothing references it.
    const orphan = await writeCandidate(await archiveText({ decks: 2 }));

    const removed = await sweepOrphans();
    assert.deepEqual(removed, [orphan]);
    assert.equal(ctx.has(orphan), false);
    assert.equal(await currentRecoveryPointId(), a.id, 'the published pointer is untouched');
    assert.equal(ctx.has(a.id), true, 'and so is its file');
    assert.equal(await verifyCandidate(a.id), true);
  });

  t('sweepOrphans refuses to sweep past an unreadable pointer', async () => {
    await promote(await writeCandidate(await archiveText()));
    sdb.run('UPDATE catalog_meta SET value=? WHERE key=?;', ['{not json', RECOVERY_POINTER_KEY]);
    // "No pointer" and "unreadable pointer" must not look alike: sweeping blind here would delete
    // the recovery point itself.
    await assert.rejects(() => sweepOrphans(), /unreadable/);
  });

  t('deleteRecoveryPoint on the published point retires the pointer and the file', async (ctx) => {
    const a = await promote(await writeCandidate(await archiveText()));
    await deleteRecoveryPoint(a.id);
    assert.equal(await currentRecoveryPointId(), null);
    assert.equal(ctx.has(a.id), false);
    assert.deepEqual(await listRecoveryPoints(), []);
    await deleteRecoveryPoint(a.id);   // idempotent - deleting the departed is not an error
  });

  t('promote refuses an id that was never written', async () => {
    await assert.rejects(() => promote('rp-never-written'), /does not exist/);
    assert.equal(await currentRecoveryPointId(), null, 'and publishes nothing');
  });

  t('durability reports without enforcing', async () => {
    const d = await durability();
    assert.equal(typeof d.persistent, 'boolean');
    assert.equal(typeof d.reason, 'string');
    assert.ok(d.reason.length > 0);
    assert.equal(d.persistent, context.expectedPersistent);
  });
}
