// Database layer with two backends behind one API:
//   - web  : sql.js (wasm) + IndexedDB persistence  (dev preview, browser)
//   - native: @capacitor-community/sqlite            (device builds)
// Public API: openDatabase, query, run, exec, tx, execMany, persist.
import { Capacitor } from '@capacitor/core';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js';

const BASE = import.meta.env.BASE_URL;
const isWeb = Capacitor.getPlatform() === 'web';

let backend = null;
let openPromise = null;

/** Singleton open — concurrent callers (React StrictMode) share one open. */
export function openDatabase() {
  if (!openPromise) openPromise = _open();
  return openPromise;
}

async function _open() {
  backend = isWeb ? await webBackend() : await nativeBackend();
  await runMigrations();
  await persist();
  return backend;
}

async function runMigrations() {
  await exec('CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);');
  const cur = (await query("SELECT value FROM _meta WHERE key='schema_version';"))[0];
  const current = cur ? parseInt(cur.value, 10) : 0;
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      await exec(m.sql);
      await run("INSERT OR REPLACE INTO _meta(key,value) VALUES('schema_version',?);", [String(m.version)]);
    }
  }
}

/* Public API — delegate to the active backend. */
export const query = (sql, params = []) => backend.query(sql, params);
export const run = (sql, params = []) => backend.run(sql, params);
export const exec = (sql) => backend.exec(sql);
export const tx = (statements) => backend.tx(statements);
export const execMany = (statements) => backend.execMany(statements);
export const persist = () => backend.persist();

/* ------------------------------------------------------------------ */
/* web backend: sql.js + IndexedDB                                     */
/* ------------------------------------------------------------------ */
async function webBackend() {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs({ locateFile: () => `${BASE}assets/sql-wasm.wasm` });
  const bytes = await idbLoad();
  const sdb = new SQL.Database(bytes || undefined);
  sdb.run('PRAGMA foreign_keys = ON;');

  let saveTimer = null;
  const doSave = () => idbSave(sdb.export());
  // Durability: flush any pending debounced save when the page is backgrounded/closed.
  const flush = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } doSave(); };
  window.addEventListener('pagehide', flush);
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  const api = {
    query(sql, params) {
      const stmt = sdb.prepare(sql);
      try {
        if (params && params.length) stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return Promise.resolve(rows);
      } finally { stmt.free(); }
    },
    run(sql, params) { sdb.run(sql, params || []); return api.persist(); },
    exec(sql) { sdb.run(sql); return Promise.resolve(); },           // multi-statement, no persist
    execMany(statements) { for (const [s, p = []] of statements) sdb.run(s, p); return Promise.resolve(); },
    tx(statements) {
      sdb.run('BEGIN;');
      try { for (const [s, p = []] of statements) sdb.run(s, p); sdb.run('COMMIT;'); }
      catch (e) { sdb.run('ROLLBACK;'); throw e; }
      return api.persist();
    },
    // Debounced persist — coalesces bursts of writes into one IndexedDB save.
    persist() {
      if (saveTimer) clearTimeout(saveTimer);
      return new Promise((resolve) => { saveTimer = setTimeout(() => { doSave().then(resolve); }, 180); });
    },
  };
  return api;
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('compendium_store', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbLoad() {
  const d = await idbOpen();
  return new Promise((resolve, reject) => {
    const t = d.transaction('kv', 'readonly').objectStore('kv').get('db');
    t.onsuccess = () => resolve(t.result || null);
    t.onerror = () => reject(t.error);
  });
}
async function idbSave(bytes) {
  const d = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx2 = d.transaction('kv', 'readwrite');
    tx2.objectStore('kv').put(bytes, 'db');
    tx2.oncomplete = () => resolve();
    tx2.onerror = () => reject(tx2.error);
  });
}

/* ------------------------------------------------------------------ */
/* native backend: @capacitor-community/sqlite                         */
/* ------------------------------------------------------------------ */
async function nativeBackend() {
  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const DB = 'compendium';
  const isConn = (await sqlite.isConnection(DB, false)).result;
  const db = isConn ? await sqlite.retrieveConnection(DB, false)
                    : await sqlite.createConnection(DB, false, 'no-encryption', SCHEMA_VERSION, false);
  await db.open();
  return {
    async query(sql, params) { return (await db.query(sql, params)).values || []; },
    async run(sql, params) { return db.run(sql, params, false); },
    async exec(sql) { return db.execute(sql, false); },
    async execMany(statements) { return db.executeSet(statements.map(([statement, values = []]) => ({ statement, values })), false); },
    async tx(statements) { return db.executeSet(statements.map(([statement, values = []]) => ({ statement, values })), true); },
    async persist() { /* native autosaves */ },
  };
}
