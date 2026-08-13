// Database layer with two backends behind one API:
//   - web  : sql.js (wasm) + IndexedDB persistence  (dev preview, browser)
//   - native: @capacitor-community/sqlite            (device builds)
// Public API: openDatabase, query, run, exec, tx, persist, snapshot,
//             awaitQuiescence, acquireExclusiveSession, RestoreInProgressError.
import { Capacitor } from '@capacitor/core';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js';

const isWeb = Capacitor.getPlatform() === 'web';

let backend = null;
let openPromise = null;

/** Singleton open - concurrent callers (React StrictMode) share one open. */
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
    if (m.version <= current) continue;
    // Run the DDL then bump the version. Atomicity via an explicit BEGIN/COMMIT
    // wrapper proved unreliable across the sql.js multi-statement path, so
    // instead each migration must be idempotent: a re-run after a crash between
    // the DDL and the version bump tolerates "already exists" and still advances.
    try {
      await exec(m.sql);
    } catch (e) {
      if (!/duplicate column|already exists/i.test(String(e?.message || e))) throw e;
      // else: partially-applied on a prior boot - the version bump below finishes it.
    }
    await run("INSERT OR REPLACE INTO _meta(key,value) VALUES('schema_version',?);", [String(m.version)]);
  }
}

/* ------------------------------------------------------------------ */
/* Admission boundary, snapshot reads, and the exclusive session       */
/* ------------------------------------------------------------------ */

// Every mutation is ADMITTED before it touches the backend and SETTLES when it finishes, so at any
// instant the set of in-flight writes is known. The old gate awaited a snapshot and then forgot the
// write it had admitted, which made "wait for in-flight writes to finish" unimplementable - and a
// destructive restore needs exactly that guarantee before it may capture or replace anything.
let inFlight = 0;
let quiescers = [];      // awaitQuiescence resolvers, run when inFlight returns to 0

// The exclusive session's owner token, or null. Plain module state on purpose: JavaScript is
// single-threaded, so an ordinary check-and-set with no await between check and set IS atomic,
// and anything fancier would only obscure that.
let exclusiveToken = null;

// Held while a snapshot's read transaction is open. Writes admitted before or during a snapshot are
// DELAYED behind it, never dropped; refusal is reserved for the exclusive session, whose whole point
// is that external work must not queue up against a state that is about to be replaced.
//
// WHY A GATE AND NOT JUST A TRANSACTION. Both backends use ONE connection. So a write issued while a
// snapshot's transaction is open does not merely race the snapshot's reads - it JOINS that
// transaction, and is committed or rolled back with it. A transaction alone therefore makes the
// problem worse, not better: it silently enrols unrelated work.
//
// This is the narrowest place to fix that, because db.js is already the single choke point for every
// write in the app. Excluding only Collection writes would not do: `withExclusiveCollectionWrites`
// governs the Collection queue, while deck saves, match recording and profile mutations come
// straight here.
let writeGate = null;

/** Resolves immediately unless a snapshot is open. */
const whenWritable = () => writeGate ?? Promise.resolve();

/** Refused admission: an exclusive session owns the database and the caller is not it. */
export class RestoreInProgressError extends Error {
  constructor(message = 'A restore is in progress - the database is temporarily unavailable for writes.') {
    super(message);
    this.name = 'RestoreInProgressError';
  }
}

/**
 * Admit one operation ('write' | 'snapshot'). Refuses with RestoreInProgressError while an
 * exclusive session is open and `token` is not that session's - external work fails loudly rather
 * than queueing against a session that may be replacing the very rows it targets.
 *
 * Returns settle(), which the caller MUST invoke in a `finally` - an operation that admits and
 * never settles holds quiescence open forever, which is the admit-and-forget bug reborn.
 * ('exclusive' is not an admission: acquiring the session is an ordered transition, not a counted
 * operation - see acquireExclusiveSession.)
 */
function admit(kind, token) {
  if (kind === 'exclusive') throw new Error('db.admit: exclusive is a session - use acquireExclusiveSession().');
  if (exclusiveToken !== null && token !== exclusiveToken) throw new RestoreInProgressError();
  inFlight++;
  let settled = false;
  return () => {
    if (settled) return;   // idempotent, so a double settle cannot free someone else's slot
    settled = true;
    if (--inFlight === 0) { const waiters = quiescers; quiescers = []; for (const w of waiters) w(); }
  };
}

/** Resolves when every admitted operation has settled. */
export function awaitQuiescence() {
  if (inFlight === 0) return Promise.resolve();
  return new Promise((resolve) => { quiescers.push(resolve); });
}

/**
 * Claim the database exclusively. The transition is ordered, and the order is the point:
 *
 *   1. The claim is a SYNCHRONOUS check-and-set: the token is published before the first await, so
 *      two claimants can never both believe they own the database. The loser is REFUSED, never
 *      queued - a queued restore would run against whatever state the winner left behind.
 *   2. External admission closes at that same instant, because admit() checks the token that was
 *      just published. Nothing can slip in between the quiescence check and the claim, because the
 *      claim comes first.
 *   3. Only then does the owner wait out the operations admitted before the claim. It has issued
 *      nothing itself yet, so it is not in the set it drains - it cannot wait for itself.
 *
 * The returned session's operations carry the token, so they are admitted while external writes are
 * refused: `readTransaction` is the owner-scoped consistent read (what a capture uses), `tx` the
 * owner-scoped write. `release()` reopens external admission and belongs in a `finally`.
 */
export async function acquireExclusiveSession({ timeoutMs = 10000 } = {}) {
  if (exclusiveToken !== null) {
    throw new RestoreInProgressError('An exclusive session is already open.');
  }
  const token = {};          // identity is the credential; it never leaves this closure
  exclusiveToken = token;    // admission closes HERE, before any await

  // BOUNDED, and it must be. The token is published before the wait, so a write that never settles
  // would not merely hang the restore - it would leave every external write refused for the life of
  // the process, turning the app read-only with no error path and no way back. On timeout the claim
  // is surrendered and the caller is told what happened, which is recoverable; an unbounded wait is
  // not. `withProfileSwitchWriteBarrier` bounds its drain for the same reason.
  const drained = await Promise.race([
    awaitQuiescence().then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  if (!drained) {
    exclusiveToken = null;   // surrender the claim, or the database stays shut
    throw new Error(`db.acquireExclusiveSession: ${inFlight} write(s) did not settle within ${timeoutMs}ms - refusing to capture a state that is still moving.`);
  }
  let released = false;
  return {
    readTransaction: (fn) => snapshotUnder(fn, token),
    tx: async (statements) => {
      const settle = admit('write', token);
      try { await whenWritable(); return await backend.tx(statements); }
      finally { settle(); }
    },
    release: () => {
      if (released) return;
      released = true;
      // Guarded so a stale release (after a test reset re-opened admission) cannot revoke a
      // successor's claim.
      if (exclusiveToken === token) exclusiveToken = null;
    },
  };
}

/* Public API - admit, then delegate to the active backend. Reads are never gated. */
export const query = (sql, params = []) => backend.query(sql, params);
export const run = async (sql, params = []) => {
  const settle = admit('write');
  try { await whenWritable(); return await backend.run(sql, params); }
  finally { settle(); }
};
export const exec = async (sql) => {
  const settle = admit('write');
  try { await whenWritable(); return await backend.exec(sql); }
  finally { settle(); }
};
export const tx = async (statements) => {
  const settle = admit('write');
  try { await whenWritable(); return await backend.tx(statements); }
  finally { settle(); }
};
// NOT gated: persist() flushes already-committed state and writes nothing new to the database. A
// snapshot holds no uncommitted data, so flushing during one is a no-op on correctness.
export const persist = () => backend.persist();

/**
 * Run `fn`'s reads against a consistent snapshot of the database.
 *
 * Takes the write gate for the duration AND opens a read transaction, then commits. `fn` must only
 * read: any write it issues would await the gate this call is holding, and deadlock. That is a
 * deliberate shape - it makes "a snapshot writes nothing" structural rather than a rule to remember.
 * (The exclusive session's readTransaction shares this machinery but carries the owner token, so it
 * is admitted while external snapshots are refused.)
 *
 * Snapshots serialise against each other, so two concurrent backups cannot interleave.
 */
export function snapshot(fn) { return snapshotUnder(fn, undefined); }

async function snapshotUnder(fn, token) {
  const settle = admit('snapshot', token);
  try {
    while (writeGate) await writeGate;          // wait out any snapshot already in progress
    if (!backend.beginRead || !backend.endRead) {
      throw new Error('db.snapshot: the active backend does not support snapshot reads.');
    }
    let release;
    writeGate = new Promise((resolve) => { release = resolve; });
    try {
      await backend.beginRead();
      try {
        return await fn();
      } finally {
        // Ends the read transaction whether fn resolved or threw, so a failed backup never leaves a
        // transaction open on the shared connection.
        await backend.endRead();
      }
    } finally {
      writeGate = null;
      release();                                 // let delayed writes through
    }
  } finally {
    settle();
  }
}

// Test-only: inject a backend (a bare sql.js wrapper) so the store layer can run in
// `node --test` without Capacitor/Vite. NEVER called by app code.
export function __setBackendForTests(b) { backend = b; }

// Test-only: admission and the write gate are module state, so a test that throws mid-operation
// could otherwise wedge every later test in the file. Releases any quiescence waiters rather than
// abandoning them. NEVER called by app code.
export function __resetWriteGateForTests() {
  const r = writeGate;
  writeGate = null;
  exclusiveToken = null;
  inFlight = 0;
  const waiters = quiescers; quiescers = []; for (const w of waiters) w();
  return r;
}

/* ------------------------------------------------------------------ */
/* web backend: sql.js + IndexedDB                                     */
/* ------------------------------------------------------------------ */
async function webBackend() {
  const initSqlJs = (await import('sql.js')).default;
  // Resolved through Vite's asset pipeline rather than a hardcoded /assets path: `?url` yields the
  // emitted, hashed, base-correct URL. The old hardcoded path broke silently when
  // vite-plugin-static-copy changed where it put the file. Inside webBackend, so `node --test` -
  // which never opens the web backend - never evaluates a Vite-only import specifier.
  const wasmUrl = (await import('sql.js/dist/sql-wasm.wasm?url')).default;
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const bytes = await idbLoad();
  const sdb = new SQL.Database(bytes || undefined);
  sdb.run('PRAGMA foreign_keys = ON;');

  let saveTimer = null;
  // One shared promise per debounce window: EVERY caller in a burst resolves (or
  // rejects) together when the single coalesced save actually completes - so an
  // awaited write is durable, and a QuotaExceededError surfaces instead of
  // hanging or becoming an unhandled rejection.
  let pending = null;         // { promise, resolve, reject }
  const doSave = () => idbSave(sdb.export());
  function runSave() {
    saveTimer = null;
    const p = pending; pending = null;
    if (!p) return;
    doSave().then(p.resolve, (err) => {
      // Storage full / write blocked - surface it (a silent failure would lose
      // data the UI already confirmed). Broadcast so the shell can warn once.
      try { window.dispatchEvent(new CustomEvent('cx-storage-error', { detail: String(err?.name || err) })); } catch { /* no window */ }
      p.reject(err);
    });
  }
  // Durability: flush any pending debounced save when the page is backgrounded/closed.
  const flush = () => { if (saveTimer) { clearTimeout(saveTimer); runSave(); } };
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
    // Read snapshot. sql.js is synchronous, so nothing can interleave DURING one statement - but our
    // reads are awaited one table at a time, and a write can land between two of those awaits. The
    // transaction plus db.js's write gate is what closes that window.
    beginRead() { sdb.run('BEGIN;'); return Promise.resolve(); },
    endRead() { sdb.run('COMMIT;'); return Promise.resolve(); },
    tx(statements) {
      sdb.run('BEGIN;');
      try { for (const [s, p = []] of statements) sdb.run(s, p); sdb.run('COMMIT;'); }
      catch (e) { sdb.run('ROLLBACK;'); throw e; }
      return api.persist();
    },
    // Debounced persist - coalesces a burst of writes into one IndexedDB save,
    // but keeps a SINGLE shared promise so every awaiting caller resolves when
    // the write is durable (short 40ms window shrinks the OS-kill loss gap).
    persist() {
      if (!pending) {
        let resolve, reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        pending = { promise, resolve, reject };
      }
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(runSave, 40);
      return pending.promise;
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

// The native plugin's execute() splits a multi-statement string on ';' with a
// splitter that mangles SQL comments (sql.js tolerates them; native does not -
// a leading block comment arrives at sqlite as a dangling '/*'). Strip both
// comment styles here, respecting single-quoted string literals so we never
// touch data. Applied only at the native exec boundary; source keeps its docs.
function stripSqlComments(sql) {
  let out = '';
  let inStr = false;
  for (let i = 0, n = sql.length; i < n; ) {
    const c = sql[i], c2 = sql[i + 1];
    if (inStr) {
      out += c;
      if (c === "'") {
        if (c2 === "'") { out += c2; i += 2; continue; } // escaped ''
        inStr = false;
      }
      i++;
    } else if (c === "'") {
      inStr = true; out += c; i++;
    } else if (c === '-' && c2 === '-') {
      while (i < n && sql[i] !== '\n') i++;               // line comment -> EOL
    } else if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;                                              // skip closing */
    } else {
      out += c; i++;
    }
  }
  return out;
}

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
    async exec(sql) { return db.execute(stripSqlComments(sql), false); },
    async tx(statements) { return db.executeSet(statements.map(([statement, values = []]) => ({ statement, values })), true); },
    // Read snapshot, via the plugin's own transaction control. Paired with db.js's write gate: the
    // connection is shared, so without the gate an unrelated write would be enrolled INTO this
    // transaction and committed or rolled back with the backup that opened it.
    async beginRead() { return db.beginTransaction(); },
    async endRead() { return db.commitTransaction(); },
    async persist() { /* native autosaves */ },
  };
}
