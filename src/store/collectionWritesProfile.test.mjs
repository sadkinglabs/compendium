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
import { stepWanted, ownedRowKey } from './ownedRepository.js';
import { enqueueWrite, __resetCollectionWritesForTests } from './collectionWrites.js';

const require = createRequire(import.meta.url);
let sdb;

function defer() { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; }
const tick = () => new Promise((r) => setTimeout(r, 0));
const wantedOf = async (pid, cardId) =>
  (await query('SELECT qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, '']))[0]?.qty_wanted ?? 0;

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
});

beforeEach(() => { sdb.run('DELETE FROM owned_cards;'); __resetCollectionWritesForTests(); __setActiveIdForTests('A'); });

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

test('switchProfile drains the queue before flipping the active profile (barrier preserves the edit)', async () => {
  __setActiveIdForTests('A');
  const d = defer();
  let committed = false;
  enqueueWrite(ownedRowKey('A', 'cardY', '', false), async () => { await d.p; await stepWanted('cardY', 1, 'A'); committed = true; });
  const switching = switchProfile('B');   // awaits settleCollectionWrites()
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
