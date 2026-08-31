// SorceryTCG import + re-sync - docs/proposals/curiosa-resync.md, re-pointed to
// sorcerytcg.com (the platform moved off curiosa.io in August 2026; internal
// names and the decks.curiosa_url column deliberately kept theirs).
// Run: npm run test:query
//
// Proves the properties the design turns on: the read fails CLOSED (a row we
// cannot place aborts the whole plan, because a skipped row reads as a removal),
// the delta apply converges the deck on the remote list, quantity updates keep
// each row's variant_slug, duplicate (zone, card) rows collapse, placeholder rows
// are untouched, notes are touched ONLY inside the managed Maybeboard block (and
// not at all when the target carries no maybeboard field), an in-sync target is a
// no-op with no history row, re-running an applied target is a no-op (idempotent),
// and an injected failure inside the transaction leaves the deck byte-for-byte
// unchanged - entries, name AND notes (atomicity).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests, __resetWriteGateForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { commitCuriosaSync, logCuriosaChecked, planCuriosaSync, importCuriosaUrl } from './deckRepository.js';
import { slugify } from './ids.js';

// The managed block's delimiters, written out rather than imported: this file
// asserts the BYTES that land in `notes`, so it must not agree with the renderer
// by construction. maybeboardBlock.test.mjs owns the render rules themselves.
const B = '--- Maybeboard (synced from SorceryTCG) ---';
const E = '--- end Maybeboard ---';

/** Stub the web fetch path of curiosaQuery. One procedure now: `deck.get`.
 *  Pass the DECK payload, or `{ __http: N }` for a transport failure, or
 *  `{ __trpc: N }` for tRPC's other failure shape (HTTP 200 with an error body). */
let lastUrl = null;   // the URL the stubbed transport was last asked for
function stubDeckGet(deck) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    lastUrl = String(url);
    if (deck && typeof deck === 'object' && deck.__http) return { ok: false, status: deck.__http, json: async () => [] };
    if (deck && typeof deck === 'object' && deck.__trpc) {
      return { ok: true, status: 200, json: async () => [{ error: { json: { message: 'No deck', code: -32004, data: { code: 'NOT_FOUND', httpStatus: deck.__trpc, path: 'deck.get' } } } }] };
    }
    return { ok: true, status: 200, json: async () => [{ result: { data: { json: deck === undefined ? null : deck } } }] };
  };
  return () => { globalThis.fetch = real; };
}

/* ---- payload builders (shape probed live 2026-08-30) ---- */
const DECK_ID = 'abcdef1234567890';
const entry = (board, name, quantity, category) => ({
  board, quantity,
  card: { id: `c-${name}`, name, slug: slugify(name), engine: { type: 'x', category } },
  printing: { id: `p-${name}` },
});
const avatarRow = (name) => entry('Avatar', name, 1, 'Avatar');
const spell = (name, q = 1) => entry('Main', name, q, 'Spell');
const site = (name, q = 1) => entry('Main', name, q, 'Site');
const coll = (name, q = 1) => entry('Collection', name, q, 'Spell');
const maybe = (name, q = 1) => entry('Maybeboard', name, q, 'Spell');
const deckPayload = (decklist, over = {}) => ({
  id: DECK_ID, name: 'My Deck', format: 'standard', visibility: 'public',
  owner: { id: 'u1' }, feature: {}, decklist, ...over,
});

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
    // JSON columns seeded as valid JSON: getCatalog's jp() defaults only fire on
    // a PARSE ERROR, and JSON.parse(null) "succeeds" as null.
    sdb.run("INSERT INTO cards(card_id,name,elements,thresholds,sets,variants) VALUES(?,?,'[]','{}','[]','[]');", [id, name]);
  }
  // The saved URL is deliberately the LEGACY curiosa.io form: those rows are in
  // real databases, the ids survived the platform move, and curiosaIdFrom is
  // host-agnostic - every sync test below therefore also proves they still resolve.
  sdb.run("INSERT INTO decks(id,profile_id,name,notes,curiosa_url,avatar_card_id,updated_at) VALUES('d1','p1','My Deck','my notes','https://curiosa.io/decks/abcdef1234567890','old-av','2026-01-01T00:00:00.000Z');");
  // alpha: qty 3 with a chosen variant - the row a sync must not clobber.
  sdb.run("INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES('e1','d1','spellbook','alpha',3,'alpha-foil');");
  sdb.run("INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES('e2','d1','spellbook','beta',2,'');");
  sdb.run("INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES('e3','d1','atlas','pond',4,'');");
  // Anonymous placeholder from an old import - must survive any sync untouched.
  sdb.run("INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES('e4','d1','spellbook',NULL,2,'');");
});

// No `maybeboard` field, on purpose: every commit test using TARGET is also a
// test that a target which says nothing about notes leaves notes alone.
const TARGET = {
  avatar: { cardId: 'new-av', name: 'New Avatar' },
  entries: [
    { zone: 'spellbook', cardId: 'alpha', qty: 4, name: 'Alpha' },   // 3 -> 4 (change)
    { zone: 'atlas', cardId: 'pond', qty: 4, name: 'Pond' },         // unchanged
    { zone: 'collection', cardId: 'gamma', qty: 1, name: 'Gamma' },  // add
  ],                                                                  // beta -> remove
};
const IN_SYNC_ENTRIES = [
  { zone: 'spellbook', cardId: 'alpha', qty: 3 },
  { zone: 'spellbook', cardId: 'beta', qty: 2 },
  { zone: 'atlas', cardId: 'pond', qty: 4 },
];

const entryState = () => rows('SELECT id, zone, card_id, quantity, variant_slug FROM deck_entries ORDER BY id;');
const notesOf = (id = 'd1') => rows('SELECT notes FROM decks WHERE id=?;', [id])[0].notes;

test('atomicity: an injected mid-transaction failure changes nothing - entries, deck row and notes', async () => {
  const beforeEntries = entryState();
  const beforeDeck = rows('SELECT * FROM decks;');
  failOn = /deck_history/;   // fires AFTER the entry writes and the decks UPDATE are queued
  await assert.rejects(() => commitCuriosaSync('d1', { ...TARGET, maybeboard: [{ name: 'Gamma', qty: 2 }] }), /injected failure/);
  assert.deepEqual(entryState(), beforeEntries);
  assert.deepEqual(rows('SELECT * FROM decks;'), beforeDeck);
  assert.equal(notesOf(), 'my notes');                       // the block write rolled back with the rest
  assert.equal(rows('SELECT COUNT(*) c FROM deck_history;')[0].c, 0);
});

test('delta apply converges on the remote list and reports counts', async () => {
  const r = await commitCuriosaSync('d1', TARGET);
  assert.deepEqual(r, { applied: true, adds: 1, removes: 1, changes: 1, duplicates: 0, avatarChanged: true, maybeboardChanged: false, renamedTo: null });

  const alpha = rows("SELECT quantity, variant_slug FROM deck_entries WHERE card_id='alpha';")[0];
  assert.equal(alpha.quantity, 4);
  assert.equal(alpha.variant_slug, 'alpha-foil');            // variant survives the qty update
  assert.equal(rows("SELECT COUNT(*) c FROM deck_entries WHERE card_id='beta';")[0].c, 0);
  assert.equal(rows("SELECT quantity FROM deck_entries WHERE card_id='gamma' AND zone='collection';")[0].quantity, 1);
  assert.equal(rows("SELECT quantity FROM deck_entries WHERE card_id='pond';")[0].quantity, 4);
  assert.equal(rows('SELECT COUNT(*) c FROM deck_entries WHERE card_id IS NULL;')[0].c, 1);   // placeholder untouched

  const deck = rows("SELECT name, notes, avatar_card_id, updated_at FROM decks WHERE id='d1';")[0];
  assert.equal(deck.name, 'My Deck');                        // never modified
  assert.equal(deck.notes, 'my notes');                      // no maybeboard field on the target: notes untouched
  assert.equal(deck.avatar_card_id, 'new-av');
  assert.notEqual(deck.updated_at, '2026-01-01T00:00:00.000Z');

  const hist = rows("SELECT text FROM deck_history WHERE deck_id='d1';");
  assert.equal(hist.length, 1);
  assert.equal(hist[0].text, 'Synced from SorceryTCG (+1 / -1 / ~1 / avatar)');
});

test('a target with no maybeboard field never touches notes, not even an existing block', async () => {
  // Backwards safety: an older plan (or any caller that never asked about the
  // Maybeboard) must not be read as "the remote Maybeboard is empty" - that
  // would delete a block the user can see.
  sdb.run("UPDATE decks SET notes=? WHERE id='d1';", [`intro\n\n${B}\n2x Gamma\n${E}\n\noutro`]);
  const beforeNotes = notesOf();
  const r = await commitCuriosaSync('d1', TARGET);
  assert.equal(r.applied, true);
  assert.equal(r.maybeboardChanged, false);
  assert.equal(notesOf(), beforeNotes);                      // byte-identical
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
  const inSync = { avatar: { cardId: 'old-av', name: 'Old Avatar' }, entries: IN_SYNC_ENTRIES };
  const beforeEntries = entryState();
  const r = await commitCuriosaSync('d1', inSync);
  assert.equal(r.applied, false);
  assert.deepEqual(entryState(), beforeEntries);
  assert.equal(rows("SELECT updated_at FROM decks WHERE id='d1';")[0].updated_at, '2026-01-01T00:00:00.000Z');
  assert.equal(rows('SELECT COUNT(*) c FROM deck_history;')[0].c, 0);

  await logCuriosaChecked('d1');
  assert.equal(rows('SELECT text FROM deck_history;')[0].text, 'Checked SorceryTCG - already in sync');
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
  const r = await commitCuriosaSync('d1', { ...TARGET, rawName: 'Blood & Thunder v2' });
  assert.equal(r.renamedTo, 'Blood & Thunder v2');
  const deck = rows("SELECT name, slug, notes FROM decks WHERE id='d1';")[0];
  assert.equal(deck.name, 'Blood & Thunder v2');
  assert.equal(deck.slug, slugify('Blood & Thunder v2'));
  assert.equal(deck.notes, 'my notes');
  assert.match(rows("SELECT text FROM deck_history WHERE deck_id='d1';")[0].text, /renamed to Blood & Thunder v2/);
});

test('a name-only change still applies, with zero entry counts', async () => {
  const r = await commitCuriosaSync('d1', { avatar: null, entries: IN_SYNC_ENTRIES, rawName: 'Fresh Name' });
  assert.deepEqual(r, { applied: true, adds: 0, removes: 0, changes: 0, duplicates: 0, avatarChanged: false, maybeboardChanged: false, renamedTo: 'Fresh Name' });
  assert.equal(rows('SELECT text FROM deck_history;')[0].text, 'Synced from SorceryTCG (renamed to Fresh Name)');
});

test('rename dedups against a sibling deck and re-running settles - no rename loop', async () => {
  sdb.run("INSERT INTO decks(id,profile_id,name) VALUES('d3','p1','Fire v2');");
  const first = await commitCuriosaSync('d1', { ...TARGET, rawName: 'Fire v2' });
  assert.equal(first.renamedTo, 'Fire v2 (1)');            // sibling owns the bare name
  const again = await commitCuriosaSync('d1', { ...TARGET, rawName: 'Fire v2' });
  assert.equal(again.applied, false);                       // dedup lands on the current name: settled
  assert.equal(again.renamedTo, null);
  assert.equal(rows("SELECT name FROM decks WHERE id='d1';")[0].name, 'Fire v2 (1)');
  assert.equal(rows("SELECT COUNT(*) c FROM deck_history WHERE deck_id='d1';")[0].c, 1);
});

/* ---- managed Maybeboard block ---- */

test('a maybeboard-only change applies, appends the block after the user text, and logs (maybeboard)', async () => {
  const target = { avatar: null, entries: IN_SYNC_ENTRIES, maybeboard: [{ name: 'Gamma', qty: 2 }, { name: 'Beta', qty: 1 }] };
  const r = await commitCuriosaSync('d1', target);
  assert.deepEqual(r, { applied: true, adds: 0, removes: 0, changes: 0, duplicates: 0, avatarChanged: false, maybeboardChanged: true, renamedTo: null });
  assert.equal(notesOf(), `my notes\n\n${B}\n1x Beta\n2x Gamma\n${E}`);
  assert.equal(rows('SELECT text FROM deck_history;')[0].text, 'Synced from SorceryTCG (maybeboard)');
  const again = await commitCuriosaSync('d1', target);
  assert.equal(again.applied, false);                       // deterministic render: no phantom second write
  assert.equal(again.maybeboardChanged, false);
});

test('block surgery preserves the user text on both sides of a mid-notes block', async () => {
  sdb.run("UPDATE decks SET notes=? WHERE id='d1';", [`Plan for Regionals\n\n${B}\n1x Beta\n${E}\n\nSideboard thoughts: bring the Pond.`]);
  const r = await commitCuriosaSync('d1', { avatar: null, entries: IN_SYNC_ENTRIES, maybeboard: [{ name: 'Gamma', qty: 3 }] });
  assert.equal(r.maybeboardChanged, true);
  assert.equal(notesOf(), `Plan for Regionals\n\n${B}\n3x Gamma\n${E}\n\nSideboard thoughts: bring the Pond.`);
});

test('an empty remote maybeboard removes the block and leaves the surrounding notes', async () => {
  sdb.run("UPDATE decks SET notes=? WHERE id='d1';", [`Plan for Regionals\n\n${B}\n1x Beta\n${E}\n\nSideboard thoughts.`]);
  const r = await commitCuriosaSync('d1', { avatar: null, entries: IN_SYNC_ENTRIES, maybeboard: [] });
  assert.equal(r.maybeboardChanged, true);
  assert.equal(notesOf(), 'Plan for Regionals\n\nSideboard thoughts.');
  assert.equal(rows('SELECT text FROM deck_history;')[0].text, 'Synced from SorceryTCG (maybeboard)');
});

test('an empty remote maybeboard with no block in the notes is not a change at all', async () => {
  const r = await commitCuriosaSync('d1', { avatar: null, entries: IN_SYNC_ENTRIES, maybeboard: [] });
  assert.equal(r.applied, false);
  assert.equal(r.maybeboardChanged, false);
  assert.equal(notesOf(), 'my notes');
  assert.equal(rows('SELECT COUNT(*) c FROM deck_history;')[0].c, 0);
});

test('duplicate-only cleanup still applies - not discarded as a no-op', async () => {
  sdb.run("INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES('e5','d1','spellbook','alpha',1,'');");
  const inSync = { avatar: null, entries: [
    { zone: 'spellbook', cardId: 'alpha', qty: 4 },         // 3 + 1 across two local rows
    { zone: 'spellbook', cardId: 'beta', qty: 2 },
    { zone: 'atlas', cardId: 'pond', qty: 4 },
  ] };
  const r = await commitCuriosaSync('d1', inSync);
  assert.deepEqual(r, { applied: true, adds: 0, removes: 0, changes: 0, duplicates: 1, avatarChanged: false, maybeboardChanged: false, renamedTo: null });
  const alphas = rows("SELECT quantity, variant_slug FROM deck_entries WHERE card_id='alpha';");
  assert.equal(alphas.length, 1);
  assert.equal(alphas[0].quantity, 4);
  assert.equal(alphas[0].variant_slug, 'alpha-foil');       // survivor keeps its variant
  assert.equal(rows('SELECT text FROM deck_history;')[0].text, 'Synced from SorceryTCG (tidied 1 duplicate)');
  const again = await commitCuriosaSync('d1', inSync);
  assert.equal(again.applied, false);                       // idempotent after the tidy
});

test('rename settles in ONE sync when a plan-time collision has disappeared (raw-name re-dedup)', async () => {
  // Upstream says "Fire v2"; during planning a sibling owned it, so the plan
  // DISPLAYED "Fire v2 (1)". The sibling is gone by commit time - commit dedups
  // the RAW name against fresh state and takes the bare name directly.
  const r = await commitCuriosaSync('d1', { ...TARGET, rawName: 'Fire v2' });
  assert.equal(r.renamedTo, 'Fire v2');
});

test('the check breadcrumb refuses a deck outside the active profile', async () => {
  sdb.run("INSERT INTO profiles(id,name,schema_version) VALUES('p2','Other',11);");
  sdb.run("INSERT INTO decks(id,profile_id,name) VALUES('d2','p2','Not Mine');");
  await logCuriosaChecked('d2');
  assert.equal(rows("SELECT COUNT(*) c FROM deck_history WHERE deck_id='d2';")[0].c, 0);   // refused
  await logCuriosaChecked('d1');
  assert.equal(rows("SELECT COUNT(*) c FROM deck_history WHERE deck_id='d1';")[0].c, 1);   // owned deck still logs
});

test('a deck outside the active profile is refused', async () => {
  sdb.run("INSERT INTO profiles(id,name,schema_version) VALUES('p2','Other',11);");
  sdb.run("INSERT INTO decks(id,profile_id,name) VALUES('d2','p2','Not Mine');");
  await assert.rejects(() => commitCuriosaSync('d2', TARGET), /no longer exists/);
});

/* ---- remote read: transport, failure classification ---- */

test('the web transport asks the /curiosa proxy for ONE deck.get, with collectionTracking off', async () => {
  // The whole deck now arrives in a single request (three procedures before), and
  // collectionTracking:false keeps the response to the decklist we actually read.
  const restore = stubDeckGet(deckPayload([spell('Alpha', 3), spell('Beta', 2), site('Pond', 4)]));
  try { await planCuriosaSync('d1'); } finally { restore(); }
  const [path, input] = lastUrl.split('input=');
  assert.equal(path, '/curiosa/api/trpc/deck.get?batch=1&');
  assert.deepEqual(JSON.parse(decodeURIComponent(input)), { 0: { json: { id: DECK_ID, collectionTracking: false } } });
});

/* ---- failure classification ---- */

test('REGRESSION: a deck the platform no longer has is a clear error, never a remove-everything diff', async () => {
  // A dead id now 404s, but a null deck in a 200 envelope stays guarded (private
  // decks are unprobed). Either way the plan must classify it as "deck gone" and
  // NOT diff the local deck against an empty list.
  for (const payload of [null, { __http: 404 }, { __trpc: 404 }]) {
    const restore = stubDeckGet(payload);
    try {
      await assert.rejects(
        () => planCuriosaSync('d1'),
        (e) => e.friendly === true && /SorceryTCG has no deck at this link any more/.test(e.message),
      );
    } finally { restore(); }
  }
});

test('a server error is reported as one, and an unreachable host as a connection problem', async () => {
  const restore = stubDeckGet({ __http: 500 });
  try { await assert.rejects(() => planCuriosaSync('d1'), /SorceryTCG returned an error \(HTTP 500\)\. Try again later\./); }
  finally { restore(); }

  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try { await assert.rejects(() => planCuriosaSync('d1'), /Couldn't reach SorceryTCG - check your connection\./); }
  finally { globalThis.fetch = real; }
});

test('REGRESSION: importing a dead URL errors instead of creating an empty deck', async () => {
  for (const [payload, msgRe] of [[null, /no deck at this URL/], [{ __http: 404 }, /no deck at this link any more/]]) {
    const restore = stubDeckGet(payload);
    try {
      await assert.rejects(() => importCuriosaUrl('https://sorcerytcg.com/decks/abcdef1234567890'), msgRe);
      assert.equal(rows('SELECT COUNT(*) c FROM decks;')[0].c, 1);   // no ghost deck created
    } finally { restore(); }
  }
});

test('malformed, unknown-board or unplaceable rows abort the whole read instead of being skipped', async () => {
  // A skipped row is absent from the target, so the sync would REMOVE that card
  // locally - shape drift must fail closed, and must take the WHOLE payload with
  // it rather than dropping the offending row.
  const good = spell('Alpha', 4);
  const cases = [
    ['decklist not an array', deckPayload(undefined)],
    ['null row', deckPayload([good, null])],
    ['card missing', deckPayload([{ board: 'Main', quantity: 2 }])],
    ['name missing', deckPayload([{ ...good, card: { engine: { category: 'Spell' } } }])],
    ['name blank', deckPayload([{ ...good, card: { name: '   ', engine: { category: 'Spell' } } }])],
    ['quantity shape drift', deckPayload([spell('Alpha', 'four')])],
    ['negative quantity', deckPayload([spell('Alpha', -2)])],
    ['unknown board', deckPayload([good, entry('Sideboard', 'Beta', 1, 'Spell')])],
    ['main category we cannot place', deckPayload([entry('Main', 'Alpha', 4, 'Relic')])],
    ['main category missing', deckPayload([{ board: 'Main', quantity: 4, card: { name: 'Alpha' } }])],
  ];
  for (const [label, payload] of cases) {
    const restore = stubDeckGet(payload);
    try { await assert.rejects(() => planCuriosaSync('d1'), /Couldn't read SorceryTCG's response\./, label); }
    finally { restore(); }
  }
});

/* ---- plan ---- */

test('plan: a valid payload resolves and reports duplicates, placeholders, and the raw name', async () => {
  sdb.run("INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES('e5','d1','spellbook','alpha',1,'');");
  const restore = stubDeckGet(deckPayload([avatarRow('Old Avatar'), spell('Alpha', 4), site('Pond', 4)]));
  try {
    const p = await planCuriosaSync('d1');
    assert.equal(p.duplicateGroups, 1);                     // alpha sits on two rows
    assert.equal(p.placeholderCount, 1);                    // the seeded NULL row
    assert.equal(p.remoteTarget.rawName, 'My Deck');
    assert.deepEqual(p.remoteTarget.maybeboard, []);        // no Maybeboard rows upstream
    assert.equal(p.maybeboardChanged, false);
    assert.equal(p.diff.name, null);                        // remote name equals local
    assert.equal(p.diff.avatar, null);                      // same avatar
    assert.deepEqual(p.diff.removes.map((r) => r.cardId), ['beta']);
    assert.equal(p.diff.changes.length, 0);                 // 3+1 aggregated = remote 4
  } finally { restore(); }
});

test('plan: an unresolvable remote name goes to unknown WITH its zone, never into the target', async () => {
  const restore = stubDeckGet(deckPayload([
    avatarRow('Missing Avatar'), spell('Alpha', 3), spell('Beta', 2), site('Pond', 4), coll('Unheard Of', 2),
  ]));
  try {
    const p = await planCuriosaSync('d1');
    assert.deepEqual(p.unknown, [
      { name: 'Unheard Of', qty: 2, zone: 'collection' },
      { name: 'Missing Avatar', qty: 1, zone: 'avatar' },
    ]);
    assert.equal(p.remoteTarget.avatar, null);
    assert.equal(p.diff.isEmpty, true);                     // unknowns are shown, never applied
  } finally { restore(); }
});

test('plan + commit: a remote Maybeboard round-trips into the notes block and then reads as in sync', async () => {
  const payload = deckPayload([
    avatarRow('Old Avatar'), spell('Alpha', 3), spell('Beta', 2), site('Pond', 4),
    maybe('Gamma', 2), maybe('Gamma', 1), maybe('New Avatar', 1),
  ]);
  const restore = stubDeckGet(payload);
  try {
    const first = await planCuriosaSync('d1');
    assert.equal(first.diff.isEmpty, true);                 // the cards themselves already match
    assert.equal(first.maybeboardChanged, true);            // ... but the notes block does not
    assert.deepEqual(first.remoteTarget.maybeboard, [{ name: 'Gamma', qty: 2 }, { name: 'Gamma', qty: 1 }, { name: 'New Avatar', qty: 1 }]);

    const r = await commitCuriosaSync('d1', first.remoteTarget);
    assert.equal(r.applied, true);
    assert.equal(r.maybeboardChanged, true);
    assert.equal(notesOf(), `my notes\n\n${B}\n3x Gamma\n1x New Avatar\n${E}`);   // duplicate rows aggregate

    const second = await planCuriosaSync('d1');
    assert.equal(second.maybeboardChanged, false);          // idempotent: re-planning proposes nothing
    assert.equal(second.diff.isEmpty, true);
    assert.equal((await commitCuriosaSync('d1', second.remoteTarget)).applied, false);
  } finally { restore(); }
});

test('plan: a saved link that is not a deck URL is refused before any network call', async () => {
  sdb.run("UPDATE decks SET curiosa_url='https://example.com/nope' WHERE id='d1';");
  const restore = stubDeckGet(deckPayload([]));
  try { await assert.rejects(() => planCuriosaSync('d1'), /The saved link isn't a SorceryTCG deck URL\./); }
  finally { restore(); }
});

/* ---- import ---- */

test('import maps all four boards, writes the Maybeboard block, and records the sorcerytcg URL', async () => {
  const restore = stubDeckGet(deckPayload([
    avatarRow('New Avatar'),
    spell('Alpha', 3), spell('Nonexistent Card', 2), site('Pond', 2),
    coll('Gamma', 1),
    maybe('Beta', 2), maybe('Unheard Of', 1),
  ], { name: 'Imported Deck' }));
  let res;
  try { res = await importCuriosaUrl('https://sorcerytcg.com/decks/abcdef1234567890'); }
  finally { restore(); }

  assert.equal(res.name, 'Imported Deck');
  assert.deepEqual(res.warnings, ['Nonexistent Card']);      // maybeboard names are never resolved
  const deck = rows('SELECT * FROM decks WHERE id=?;', [res.id])[0];
  assert.equal(deck.avatar_card_id, 'new-av');
  assert.equal(deck.curiosa_url, 'https://sorcerytcg.com/decks/abcdef1234567890');
  assert.equal(deck.notes, `${B}\n2x Beta\n1x Unheard Of\n${E}`);
  assert.deepEqual(
    rows('SELECT zone, card_id, quantity FROM deck_entries WHERE deck_id=? ORDER BY zone, card_id;', [res.id]),
    [
      { zone: 'atlas', card_id: 'pond', quantity: 2 },
      { zone: 'collection', card_id: 'gamma', quantity: 1 },
      { zone: 'spellbook', card_id: null, quantity: 2 },     // unresolved name kept as a placeholder
      { zone: 'spellbook', card_id: 'alpha', quantity: 3 },
    ],
  );
  assert.equal(rows('SELECT text FROM deck_history WHERE deck_id=?;', [res.id])[0].text, 'Imported from SorceryTCG');
});

test('import: a legacy curiosa.io URL still resolves, and is saved in its sorcerytcg form', async () => {
  const restore = stubDeckGet(deckPayload([spell('Alpha', 1)], { name: 'Legacy Link Deck' }));
  let res;
  try { res = await importCuriosaUrl('https://curiosa.io/decks/abcdef1234567890'); }
  finally { restore(); }
  assert.equal(rows('SELECT curiosa_url FROM decks WHERE id=?;', [res.id])[0].curiosa_url, 'https://sorcerytcg.com/decks/abcdef1234567890');
});

test('import: a null or zero quantity reads as one copy, in the zones and in the block', async () => {
  const restore = stubDeckGet(deckPayload([spell('Alpha', null), site('Pond', 0), maybe('Beta', null)], { name: 'Odd Quantities' }));
  let res;
  try { res = await importCuriosaUrl('https://sorcerytcg.com/decks/abcdef1234567890'); }
  finally { restore(); }
  assert.deepEqual(
    rows('SELECT zone, card_id, quantity FROM deck_entries WHERE deck_id=? ORDER BY zone;', [res.id]),
    [{ zone: 'atlas', card_id: 'pond', quantity: 1 }, { zone: 'spellbook', card_id: 'alpha', quantity: 1 }],
  );
  assert.equal(rows('SELECT notes FROM decks WHERE id=?;', [res.id])[0].notes, `${B}\n1x Beta\n${E}`);
});

test('import: the Maybeboard block rides the SAME transaction as the entry inserts', async () => {
  // Failing the notes statement must take the entries down with it. If the block
  // were written in a second transaction the entries would already be committed -
  // a deck whose zones and whose notes disagree. (The empty deck row createDeck
  // wrote beforehand is pre-existing behaviour, outside this migration.)
  failOn = /UPDATE decks SET notes/;
  const restore = stubDeckGet(deckPayload([spell('Alpha', 1), maybe('Beta', 2)], { name: 'Atomic Deck' }));
  try { await assert.rejects(() => importCuriosaUrl('https://sorcerytcg.com/decks/abcdef1234567890'), /injected failure/); }
  finally { restore(); }
  assert.equal(rows("SELECT COUNT(*) c FROM deck_entries WHERE deck_id<>'d1';")[0].c, 0);
  assert.equal(rows("SELECT COUNT(*) c FROM decks WHERE notes IS NOT NULL AND id<>'d1';")[0].c, 0);
});

test('import: a deck with no Maybeboard leaves notes empty, and a malformed payload writes nothing', async () => {
  const restore = stubDeckGet(deckPayload([spell('Alpha', 1)], { name: 'Plain Deck' }));
  let res;
  try { res = await importCuriosaUrl('https://sorcerytcg.com/decks/abcdef1234567890'); }
  finally { restore(); }
  assert.equal(rows('SELECT notes FROM decks WHERE id=?;', [res.id])[0].notes, null);

  const restore2 = stubDeckGet(deckPayload([entry('Main', 'Alpha', 1, 'Relic')]));
  try {
    await assert.rejects(() => importCuriosaUrl('https://sorcerytcg.com/decks/abcdef1234567890'), /Couldn't read SorceryTCG's response\./);
    assert.equal(rows('SELECT COUNT(*) c FROM decks;')[0].c, 2);   // d1 + the plain deck: no third
  } finally { restore2(); }
});
