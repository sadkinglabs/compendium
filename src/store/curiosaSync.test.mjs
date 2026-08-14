// Curiosa re-sync commit - Increment 2 of docs/proposals/curiosa-resync.md.
// Run: npm run test:query
//
// Proves the properties the design turns on: the delta apply converges the deck
// on the remote list, quantity updates keep each row's variant_slug, duplicate
// (zone, card) rows collapse, placeholder rows are untouched, name/notes are
// never modified, an in-sync target is a no-op with no history row, re-running
// an applied target is a no-op (idempotent), and - first - an injected failure
// inside the transaction leaves the deck byte-for-byte unchanged (atomicity).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests, __resetWriteGateForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { commitCuriosaSync, logCuriosaChecked, planCuriosaSync, importCuriosaUrl } from './deckRepository.js';
import { slugify } from './ids.js';

/** Stub the web fetch path of curiosaQuery: routes tRPC procedure -> json payload. */
function stubCuriosa(byProc) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const proc = Object.keys(byProc).find((p) => String(url).includes(p));
    return { ok: true, status: 200, json: async () => [{ result: { data: { json: proc ? byProc[proc] : null } } }] };
  };
  return () => { globalThis.fetch = real; };
}

const require = createRequire(import.meta.url);
let sdb;
let failOn = null;   // RegExp - a tx statement matching it throws (atomicity probe)

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; }
  finally { st.free(); }
};

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  for (const m of MIGRATIONS) sdb.run(m.sql);
  // Mirrors the web backend's tx shape (BEGIN / statements / COMMIT, ROLLBACK on
  // throw) so the injected failure exercises the same rollback path production uses.
  __setBackendForTests({
    query(sql, params) {
      const st = sdb.prepare(sql);
      try { if (params && params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return Promise.resolve(r); }
      finally { st.free(); }
    },
    run(sql, params) { sdb.run(sql, params || []); return Promise.resolve(); },
    exec(sql) { sdb.run(sql); return Promise.resolve(); },
    tx(statements) {
      sdb.run('BEGIN;');
      try {
        for (const [s, p = []] of statements) {
          if (failOn && failOn.test(s)) throw new Error('injected failure');
          sdb.run(s, p);
        }
        sdb.run('COMMIT;');
      } catch (e) { sdb.run('ROLLBACK;'); throw e; }
      return Promise.resolve();
    },
    persist() { return Promise.resolve(); },
  });
  __setActiveIdForTests('p1');
});

beforeEach(() => {
  failOn = null;
  __resetWriteGateForTests();
  sdb.run('DELETE FROM deck_history; DELETE FROM deck_entries; DELETE FROM decks; DELETE FROM profiles; DELETE FROM cards;');
  sdb.run("INSERT INTO profiles(id,name,schema_version) VALUES('p1','Test',11);");
  for (const [id, name] of [['alpha', 'Alpha'], ['beta', 'Beta'], ['gamma', 'Gamma'], ['pond', 'Pond'], ['old-av', 'Old Avatar'], ['new-av', 'New Avatar']]) {
    sdb.run('INSERT INTO cards(card_id,name) VALUES(?,?);', [id, name]);
  }
  sdb.run("INSERT INTO decks(id,profile_id,name,notes,curiosa_url,avatar_card_id,updated_at) VALUES('d1','p1','My Deck','my notes','https://curiosa.io/decks/abcdef1234567890','old-av','2026-01-01T00:00:00.000Z');");
  // alpha: qty 3 with a chosen variant - the row a sync must not clobber.
  sdb.run("INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES('e1','d1','spellbook','alpha',3,'alpha-foil');");
  sdb.run("INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES('e2','d1','spellbook','beta',2,'');");
  sdb.run("INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES('e3','d1','atlas','pond',4,'');");
  // Anonymous placeholder from an old import - must survive any sync untouched.
  sdb.run("INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES('e4','d1','spellbook',NULL,2,'');");
});

const TARGET = {
  avatar: { cardId: 'new-av', name: 'New Avatar' },
  entries: [
    { zone: 'spellbook', cardId: 'alpha', qty: 4, name: 'Alpha' },   // 3 -> 4 (change)
    { zone: 'atlas', cardId: 'pond', qty: 4, name: 'Pond' },         // unchanged
    { zone: 'collection', cardId: 'gamma', qty: 1, name: 'Gamma' },  // add
  ],                                                                  // beta -> remove
};

const entryState = () => rows('SELECT id, zone, card_id, quantity, variant_slug FROM deck_entries ORDER BY id;');

test('atomicity: an injected mid-transaction failure changes nothing', async () => {
  const beforeEntries = entryState();
  const beforeDeck = rows('SELECT * FROM decks;');
  failOn = /deck_history/;
  await assert.rejects(() => commitCuriosaSync('d1', TARGET), /injected failure/);
  assert.deepEqual(entryState(), beforeEntries);
  assert.deepEqual(rows('SELECT * FROM decks;'), beforeDeck);
  assert.equal(rows('SELECT COUNT(*) c FROM deck_history;')[0].c, 0);
});

test('delta apply converges on the remote list and reports counts', async () => {
  const r = await commitCuriosaSync('d1', TARGET);
  assert.deepEqual(r, { applied: true, adds: 1, removes: 1, changes: 1, avatarChanged: true, renamedTo: null });

  const alpha = rows("SELECT quantity, variant_slug FROM deck_entries WHERE card_id='alpha';")[0];
  assert.equal(alpha.quantity, 4);
  assert.equal(alpha.variant_slug, 'alpha-foil');            // variant survives the qty update
  assert.equal(rows("SELECT COUNT(*) c FROM deck_entries WHERE card_id='beta';")[0].c, 0);
  assert.equal(rows("SELECT quantity FROM deck_entries WHERE card_id='gamma' AND zone='collection';")[0].quantity, 1);
  assert.equal(rows("SELECT quantity FROM deck_entries WHERE card_id='pond';")[0].quantity, 4);
  assert.equal(rows('SELECT COUNT(*) c FROM deck_entries WHERE card_id IS NULL;')[0].c, 1);   // placeholder untouched

  const deck = rows("SELECT name, notes, avatar_card_id, updated_at FROM decks WHERE id='d1';")[0];
  assert.equal(deck.name, 'My Deck');                        // never modified
  assert.equal(deck.notes, 'my notes');                      // never modified
  assert.equal(deck.avatar_card_id, 'new-av');
  assert.notEqual(deck.updated_at, '2026-01-01T00:00:00.000Z');

  const hist = rows("SELECT text FROM deck_history WHERE deck_id='d1';");
  assert.equal(hist.length, 1);
  assert.equal(hist[0].text, 'Synced from Curiosa (+1 / -1 / ~1 / avatar)');
});

test('idempotent: re-running an applied target is a no-op with no history row', async () => {
  await commitCuriosaSync('d1', TARGET);
  const afterFirst = entryState();
  const r = await commitCuriosaSync('d1', TARGET);
  assert.equal(r.applied, false);
  assert.deepEqual(entryState(), afterFirst);
  assert.equal(rows('SELECT COUNT(*) c FROM deck_history;')[0].c, 1);
});

test('an already-in-sync target writes nothing, and the check breadcrumb logs', async () => {
  const inSync = {
    avatar: { cardId: 'old-av', name: 'Old Avatar' },
    entries: [
      { zone: 'spellbook', cardId: 'alpha', qty: 3 },
      { zone: 'spellbook', cardId: 'beta', qty: 2 },
      { zone: 'atlas', cardId: 'pond', qty: 4 },
    ],
  };
  const beforeEntries = entryState();
  const r = await commitCuriosaSync('d1', inSync);
  assert.equal(r.applied, false);
  assert.deepEqual(entryState(), beforeEntries);
  assert.equal(rows("SELECT updated_at FROM decks WHERE id='d1';")[0].updated_at, '2026-01-01T00:00:00.000Z');
  assert.equal(rows('SELECT COUNT(*) c FROM deck_history;')[0].c, 0);

  await logCuriosaChecked('d1');
  assert.equal(rows('SELECT text FROM deck_history;')[0].text, 'Checked Curiosa - already in sync');
});

test('duplicate (zone, card) rows collapse into the first, keeping its variant', async () => {
  sdb.run("INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES('e5','d1','spellbook','alpha',1,'other');");
  const r = await commitCuriosaSync('d1', TARGET);
  assert.equal(r.applied, true);
  const alphas = rows("SELECT id, quantity, variant_slug FROM deck_entries WHERE card_id='alpha';");
  assert.equal(alphas.length, 1);
  assert.equal(alphas[0].id, 'e1');
  assert.equal(alphas[0].quantity, 4);
  assert.equal(alphas[0].variant_slug, 'alpha-foil');
});

test('a null remote avatar never clears the local one', async () => {
  const r = await commitCuriosaSync('d1', { avatar: null, entries: TARGET.entries });
  assert.equal(r.avatarChanged, false);
  assert.equal(rows("SELECT avatar_card_id FROM decks WHERE id='d1';")[0].avatar_card_id, 'old-av');
});

test('rename follows the remote name: slug updates, notes survive, log names it', async () => {
  const r = await commitCuriosaSync('d1', { ...TARGET, name: 'Blood & Thunder v2' });
  assert.equal(r.renamedTo, 'Blood & Thunder v2');
  const deck = rows("SELECT name, slug, notes FROM decks WHERE id='d1';")[0];
  assert.equal(deck.name, 'Blood & Thunder v2');
  assert.equal(deck.slug, slugify('Blood & Thunder v2'));
  assert.equal(deck.notes, 'my notes');
  assert.match(rows("SELECT text FROM deck_history WHERE deck_id='d1';")[0].text, /renamed to Blood & Thunder v2/);
});

test('a name-only change still applies, with zero entry counts', async () => {
  const inSyncEntries = [
    { zone: 'spellbook', cardId: 'alpha', qty: 3 },
    { zone: 'spellbook', cardId: 'beta', qty: 2 },
    { zone: 'atlas', cardId: 'pond', qty: 4 },
  ];
  const r = await commitCuriosaSync('d1', { avatar: null, entries: inSyncEntries, name: 'Fresh Name' });
  assert.deepEqual(r, { applied: true, adds: 0, removes: 0, changes: 0, avatarChanged: false, renamedTo: 'Fresh Name' });
  assert.equal(rows("SELECT text FROM deck_history;")[0].text, 'Synced from Curiosa (renamed to Fresh Name)');
});

test('rename dedups against a sibling deck and re-running settles - no rename loop', async () => {
  sdb.run("INSERT INTO decks(id,profile_id,name) VALUES('d3','p1','Fire v2');");
  const first = await commitCuriosaSync('d1', { ...TARGET, name: 'Fire v2' });
  assert.equal(first.renamedTo, 'Fire v2 (1)');            // sibling owns the bare name
  const again = await commitCuriosaSync('d1', { ...TARGET, name: 'Fire v2' });
  assert.equal(again.applied, false);                       // dedup lands on the current name: settled
  assert.equal(again.renamedTo, null);
  assert.equal(rows("SELECT name FROM decks WHERE id='d1';")[0].name, 'Fire v2 (1)');
  assert.equal(rows("SELECT COUNT(*) c FROM deck_history WHERE deck_id='d1';")[0].c, 1);
});

test('REGRESSION: a deck Curiosa no longer has (200 + null) is a clear error, never a remove-everything diff', async () => {
  // Curiosa answers a nonexistent id with HTTP 200, deck.getById json:null and an
  // empty decklist (device-verified 2026-08-14). The plan must classify that as
  // "deck gone", NOT diff the local deck against an empty list.
  const restore = stubCuriosa({ 'deck.getById': null, 'deck.getDecklistById': [], 'deck.getSideboardById': [] });
  try {
    await assert.rejects(() => planCuriosaSync('d1'), /no deck at this link/);
  } finally { restore(); }
});

test('REGRESSION: importing a dead Curiosa URL errors instead of creating an empty deck', async () => {
  const restore = stubCuriosa({ 'deck.getById': null, 'deck.getDecklistById': [], 'deck.getSideboardById': [] });
  try {
    await assert.rejects(() => importCuriosaUrl('https://curiosa.io/decks/abcdef1234567890'), /no deck at this URL/);
    assert.equal(rows("SELECT COUNT(*) c FROM decks;")[0].c, 1);   // no ghost deck created
  } finally { restore(); }
});

test('a deck outside the active profile is refused', async () => {
  sdb.run("INSERT INTO profiles(id,name,schema_version) VALUES('p2','Other',11);");
  sdb.run("INSERT INTO decks(id,profile_id,name) VALUES('d2','p2','Not Mine');");
  await assert.rejects(() => commitCuriosaSync('d2', TARGET), /no longer exists/);
});
