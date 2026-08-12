// The recovery snapshot store - where "the state a restore is about to replace" lives while the
// replacement is the thing that could destroy it. See docs/proposals/restore-semantics.md §4.
//
// Two decisions carry the whole design:
//
//   CANDIDATES ARE IMMUTABLE. Capacitor does not document atomic file replacement, so nothing here
//   may ever depend on one. A candidate is written once under a fresh id and never touched again;
//   "update" does not exist in this module's vocabulary.
//
//   THE POINTER IS A DATABASE ROW. Which recovery point is current is decided by one
//   `catalog_meta` write, which IS atomic - and `catalog_meta` is device-owned state that the
//   replacement transaction preserves, so the pointer outlives the data it protects. The previous
//   point's file is deleted only AFTER the new pointer commits: a crash in between leaves an
//   orphan file for `sweepOrphans()` to clear, and orphaned bytes are cheap where a missing
//   recovery point is not.
//
// Retention is ONE published recovery point. This is an undo, not a backup history - the user's
// history lives in the backups they export.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { query, run } from './db.js';
import { uuid, nowIso } from './ids.js';
import { canonicalJson, sha256Hex, unsignedOf, contentDigestOf } from './backup.js';
import { ITERATED_COLLECTIONS } from './importBoundary.js';

/** The catalog_meta key naming the current recovery point. Its value is the point's metadata. */
export const RECOVERY_POINTER_KEY = 'recovery_point';

/* ------------------------------------------------------------------ */
/* Backings - one interface, two homes for the bytes                   */
/* ------------------------------------------------------------------ */

// Both expose { kind, write, read, remove, list }. `read` resolves null for a missing id rather
// than throwing, because "is it still there?" is a question this store asks on purpose.

const FILE_DIR = 'recovery';

// App-private storage (Directory.Data): survives restarts and is only removed with the app itself.
// The dependency is a parameter so `node --test` can drive this exact code against a fake plugin.
function nativeBacking(fs = Filesystem) {
  const pathOf = (id) => `${FILE_DIR}/${id}.json`;
  return {
    kind: 'native',
    async write(id, text) {
      await fs.writeFile({
        path: pathOf(id), data: text, directory: Directory.Data,
        encoding: Encoding.UTF8, recursive: true,
      });
    },
    async read(id) {
      try {
        const res = await fs.readFile({ path: pathOf(id), directory: Directory.Data, encoding: Encoding.UTF8 });
        return typeof res?.data === 'string' ? res.data : null;
      } catch { return null; }
    },
    async remove(id) { await fs.deleteFile({ path: pathOf(id), directory: Directory.Data }); },
    async list() {
      try {
        const res = await fs.readdir({ path: FILE_DIR, directory: Directory.Data });
        return (res?.files ?? [])
          .map((f) => (typeof f === 'string' ? f : f?.name))
          .filter((n) => typeof n === 'string' && n.endsWith('.json'))
          .map((n) => n.slice(0, -'.json'.length));
      } catch { return []; }   // the directory does not exist until the first candidate is written
    },
  };
}

// IndexedDB, in its OWN database rather than db.js's `compendium_store`: the recovery point must
// survive whatever happens to the database it protects, so it does not share a home with it.
function webBacking(idb = globalThis.indexedDB) {
  let openPromise = null;
  const open = () => {
    if (!openPromise) {
      openPromise = new Promise((resolve, reject) => {
        const r = idb.open('compendium_recovery', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('files');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    return openPromise;
  };
  // One operation per transaction, resolved on `oncomplete` - not on the request - so a resolved
  // write means the transaction committed, not merely that the request was queued.
  const op = (mode, fn) => open().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction('files', mode);
    const r = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
  return {
    kind: 'web',
    write: (id, text) => op('readwrite', (s) => s.put(text, id)).then(() => undefined),
    read: (id) => op('readonly', (s) => s.get(id)).then((v) => (v == null ? null : String(v))),
    remove: (id) => op('readwrite', (s) => s.delete(id)).then(() => undefined),
    list: () => op('readonly', (s) => s.getAllKeys()).then((keys) => (keys ?? []).map(String)),
  };
}

let backing = null;
function activeBacking() {
  if (!backing) backing = Capacitor.getPlatform() === 'web' ? webBacking() : nativeBacking();
  return backing;
}

/* ------------------------------------------------------------------ */
/* The pointer                                                         */
/* ------------------------------------------------------------------ */

// Increment 4's restore session must publish the pointer while external admission is closed, so
// every write here accepts an override that carries the session's token. Everything else - and
// everything today - uses the plain admitted write.
const defaultWrite = (sql, params) => run(sql, params);

async function readPointer() {
  const rows = await query('SELECT value FROM catalog_meta WHERE key=?;', [RECOVERY_POINTER_KEY]);
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].value); }
  catch {
    // LOUD, never null: "no pointer" and "unreadable pointer" must not look alike, because
    // sweepOrphans deletes everything the pointer does not name - a misread here deletes the
    // recovery point itself.
    throw new Error('recoveryStore: the recovery pointer is unreadable.');
  }
}

/** Metadata for a candidate, derived from its own bytes so it survives a process restart. */
async function metaOf(id, text) {
  const env = JSON.parse(text);
  const units = env?.payload?.profiles;
  if (!Array.isArray(units)) throw new Error('recoveryStore: that candidate is not a whole-app archive.');
  const rows = units.reduce(
    (a, unit) => a + ITERATED_COLLECTIONS.reduce((b, k) => b + (unit?.[k]?.length ?? 0), 0), 0);
  return {
    id,
    createdAt: env.exportedAt ?? nowIso(),
    profiles: units.length,
    rows,
    digest: await contentDigestOf(env),   // the COMPARABLE digest, not the volatile envelope one
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** The published recovery point's metadata, as a list (retention is one, so zero or one entry). */
export async function listRecoveryPoints() {
  const meta = await readPointer();
  return meta ? [meta] : [];
}

/** The current recovery point's id, or null when none is published. */
export async function currentRecoveryPointId() {
  return (await readPointer())?.id ?? null;
}

/** Write a candidate under a fresh immutable id. Nothing existing can be overwritten. */
export async function writeCandidate(text) {
  if (typeof text !== 'string' || !text) {
    throw new TypeError('recoveryStore.writeCandidate: a non-empty string is required.');
  }
  const id = `rp-${uuid()}`;
  await activeBacking().write(id, text);
  return id;
}

/**
 * Read a candidate back and recompute its digest. False for missing, unparseable, unsealed or
 * corrupted bytes - any answer other than "the digest matches" means the restore must not proceed,
 * so every failure mode collapses to the same boolean rather than a taxonomy of throws.
 */
export async function verifyCandidate(id) {
  try {
    const text = await activeBacking().read(id);
    if (text == null) return false;
    const env = JSON.parse(text);
    const claimed = env?.integrity?.digest;
    if (typeof claimed !== 'string' || !claimed) return false;
    return (await sha256Hex(canonicalJson(unsignedOf(env)))) === claimed;
  } catch { return false; }
}

/** The stored text of a recovery point or candidate. Missing is loud - a caller asking for a
 *  recovery point that does not exist is a bug or an eviction, and both deserve an error. */
export async function readRecoveryPoint(id) {
  const text = await activeBacking().read(id);
  if (text == null) throw new Error(`recoveryStore: recovery point ${id} does not exist.`);
  return text;
}

/**
 * Publish a candidate as THE recovery point.
 *
 * Order is the contract: the pointer row commits first, and only then is the previous point's
 * file deleted. A crash after the commit leaves an orphan (swept later); a failure during the
 * commit leaves the previous point published and intact. At no instant is there no recovery point.
 */
export async function promote(id, { write = defaultWrite } = {}) {
  const text = await activeBacking().read(id);
  if (text == null) throw new Error(`recoveryStore: cannot promote ${id} - it does not exist.`);
  const meta = await metaOf(id, text);
  const prev = await readPointer();
  await write('INSERT OR REPLACE INTO catalog_meta(key,value) VALUES(?,?);',
    [RECOVERY_POINTER_KEY, JSON.stringify(meta)]);
  if (prev && prev.id !== id) {
    // Best effort AFTER the commit: a failed delete is an orphan, which sweepOrphans owns.
    try { await activeBacking().remove(prev.id); } catch { /* swept at next startup */ }
  }
  return meta;
}

/** Delete a point. If it is the published one, the pointer is retired FIRST - the mirror of
 *  promote's ordering, so a crash can leave an orphan file but never a pointer at nothing. */
export async function deleteRecoveryPoint(id, { write = defaultWrite } = {}) {
  const current = await readPointer();
  if (current?.id === id) {
    await write('DELETE FROM catalog_meta WHERE key=?;', [RECOVERY_POINTER_KEY]);
  }
  try { await activeBacking().remove(id); } catch { /* already gone - deletion is idempotent */ }
}

/**
 * Delete every stored file the pointer does not name. Startup housekeeping for the orphans the
 * crash-safety ordering deliberately leaves behind - never run while a restore session is open,
 * because an unpromoted candidate mid-restore IS an orphan by this definition.
 */
export async function sweepOrphans() {
  const keep = (await readPointer())?.id ?? null;   // throws on an unreadable pointer: never sweep blind
  const removed = [];
  for (const id of await activeBacking().list()) {
    if (id === keep) continue;
    try { await activeBacking().remove(id); removed.push(id); } catch { /* try again next startup */ }
  }
  return removed;
}

/**
 * Where the bytes live and whether the platform promises to keep them. REPORT ONLY - the policy
 * that refuses a destructive restore over a non-persistent backing is Increment 3's, not this
 * module's.
 */
export async function durability() {
  if (activeBacking().kind === 'native') {
    return { persistent: true, reason: 'App-private storage (Directory.Data) is kept until the app is uninstalled.' };
  }
  const storage = globalThis.navigator?.storage;
  if (typeof storage?.persisted !== 'function') {
    return { persistent: false, reason: 'This browser does not expose StorageManager, so persistence cannot be confirmed.' };
  }
  try {
    return (await storage.persisted())
      ? { persistent: true, reason: 'The browser granted persistent storage for this origin.' }
      : { persistent: false, reason: 'Persistent storage is not granted - the browser may evict IndexedDB under storage pressure.' };
  } catch {
    return { persistent: false, reason: 'The persistence probe failed, so persistence cannot be confirmed.' };
  }
}

/* ------------------------------------------------------------------ */
/* Test seams - NEVER called by app code                               */
/* ------------------------------------------------------------------ */

// Inject a backing so the store runs in `node --test` without Capacitor. Mirrors
// db.__setBackendForTests.
export function __setBackingForTests(b) { backing = b; }

// Construct the REAL backing implementations over fake platform APIs, so the suite exercises this
// module's actual path handling and transaction code on both runtimes rather than a stand-in.
export function __nativeBackingForTests(fs) { return nativeBacking(fs); }
export function __webBackingForTests(idb) { return webBacking(idb); }
