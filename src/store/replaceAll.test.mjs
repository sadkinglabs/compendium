// Restore REPLACES - Increment 4 of docs/proposals/restore-semantics.md (Rev 4).
// Run: npm run test:query
//
// This is the first destructive code in the programme, so the suite proves ABORTABILITY before it
// proves function: the three injected-failure tests run first and compare a FULL byte dump of the
// database, not row counts. Then the properties the design turns on: the journal row commits
// inside the replacement transaction, `DELETE FROM profiles` really cascades every profile-owned
// table, replacement is canonically equivalent to the archive and idempotent, nothing gains an
// "(imported)" suffix, the catalog survives, dash_seeded re-keys, and Increment 3's policy is
// ENFORCED - refusal and a stale bound archive both abort with nothing destroyed.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js';
import { __setBackendForTests, __resetWriteGateForTests, snapshot, run } from './db.js';
import { __setActiveIdForTests, activeProfileId, listProfiles } from './profileRepository.js';
import { buildProfileUnit } from './profileTransfer.js';
import { buildEnvelope, seal, contentDigestOf, canonicalJson } from './backup.js';
import { RECOVERY_POINTER_KEY, __setBackingForTests } from './recoveryStore.js';
import { bindExternalArchive } from './replacementPolicy.js';
import { planReplace, RESTORE_PENDING_KEY } from './replacePlan.js';
import { previewBackup, restoreAll, replaceAll } from './backupService.js';
import { ITERATED_COLLECTIONS } from './importBoundary.js';

const require = createRequire(import.meta.url);
let sdb;
let realBackend;
let prefs;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; }
  finally { st.free(); }
};
const count = (table) => rows(`SELECT COUNT(*) c FROM ${table};`)[0].c;

/** The whole database as bytes - the only honest "untouched afterwards". sql.js export() closes
 *  and reopens the handle, which silently RESETS per-connection pragmas, so foreign_keys is
 *  re-asserted or every later cascade in the suite would no-op. */
const dump = () => {
  const bytes = Buffer.from(sdb.export());
  sdb.run('PRAGMA foreign_keys = ON;');
  return bytes;
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

/** In-memory recovery backing. kind 'native' reports durable; kind 'web' does not (node has no
 *  navigator.storage), which is exactly how the policy paths are steered below. */
function memoryBacking(kind = 'native') {
  const files = new Map();
  return {
    kind, files,
    async write(id, text) { files.set(id, text); },
    async read(id) { return files.get(id) ?? null; },
    async remove(id) { files.delete(id); },
    async list() { return [...files.keys()]; },
  };
}

/** Every profile-owned table gets at least one row, so the cascade test cannot pass vacuously
 *  and the equivalence test carries real breadth. Values stay in CANONICAL form (safe URL,
 *  supported widget type, null duration, W-L matching the matches) so restore's contract
 *  normalisation is the identity over them. */
function seedProfile(pid, name, isDefault, createdAt) {
  const ts = createdAt;
  sdb.run('INSERT INTO profiles(id,name,avatar,accent,system,schema_version,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [pid, name, isDefault ? '{"kind":"initial","value":"A"}' : null, 'gold', 'sorcery', SCHEMA_VERSION, isDefault ? 1 : 0, ts, ts]);
  sdb.run('INSERT OR IGNORE INTO settings(profile_id) VALUES(?);', [pid]);
  sdb.run('INSERT INTO decks(id,profile_id,name,slug,archetype,avatar_card_id,avatar_slug,cover_slug,notes,curiosa_url,wins,losses,starred,lib_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);',
    [`${pid}-d1`, pid, `${name} Deck`, 'deck', null, null, null, null, '', 'https://curiosa.io/x', 1, 0, 0, 0, ts, ts]);
  sdb.run('INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES(?,?,?,?,?,?);',
    [`${pid}-de1`, `${pid}-d1`, 'spellbook', 'sentinel_card', 2, '004']);
  sdb.run('INSERT INTO deck_history(id,deck_id,ts,text) VALUES(?,?,?,?);', [`${pid}-dh1`, `${pid}-d1`, ts, 'built']);
  sdb.run('INSERT INTO saved(id,profile_id,target_type,target_id,created_at) VALUES(?,?,?,?,?);',
    [`${pid}-s1`, pid, 'card', 'sentinel_card', ts]);
  sdb.run('INSERT INTO notes(id,profile_id,target_type,target_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?);',
    [`${pid}-n1`, pid, 'card', 'sentinel_card', `${name} note`, ts, ts]);
  sdb.run('INSERT INTO collections(id,profile_id,name,created_at) VALUES(?,?,?,?);', [`${pid}-c1`, pid, 'Binder', ts]);
  sdb.run('INSERT INTO collection_items(id,collection_id,target_type,target_id,added_at) VALUES(?,?,?,?,?);',
    [`${pid}-ci1`, `${pid}-c1`, 'card', 'sentinel_card', ts]);
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [`${pid}-oc1`, pid, 'sentinel_card', '004', 3, 0, '', ts, ts]);
  sdb.run('INSERT INTO card_lists(id,profile_id,kind,name,description,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?);',
    [`${pid}-l1`, pid, 'custom', 'Wants', '', 0, ts, ts]);
  // Storage (v12): the system Unfiled place plus a user binder, and the owned row's 3 copies split
  // across them - so the cascade assertion below proves the places die with the profile, and the
  // restore comparisons have a container graph to be equivalent about.
  sdb.run('INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?);',
    [`${pid}-u1`, pid, 'unfiled', 'Unfiled', '', 'gold', -1, 1, ts, ts]);
  sdb.run('INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?);',
    [`${pid}-b1`, pid, 'binder', 'Sentinel Binder', '', 'ruby', 0, 0, ts, ts]);
  sdb.run('INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,?,?,?,?);',
    [`${pid}-a1`, pid, `${pid}-b1`, `${pid}-oc1`, 1, ts, ts]);
  sdb.run('INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,?,?,?,?);',
    [`${pid}-a2`, pid, `${pid}-u1`, `${pid}-oc1`, 2, ts, ts]);
  sdb.run('INSERT INTO card_list_entries(id,list_id,card_id,quantity,variant_slug,added_at) VALUES(?,?,?,?,?,?);',
    [`${pid}-le1`, `${pid}-l1`, 'sentinel_card', 1, '004', ts]);
  sdb.run('INSERT INTO links(id,profile_id,kind,a_type,a_id,b_type,b_id,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?);',
    [`${pid}-lk1`, pid, 'card_card', 'card', 'sentinel_card', 'card', 'other_card', 'combo', ts, ts]);
  sdb.run('INSERT INTO matches(id,profile_id,played_at,mode,player_avatar,opponent_name,opponent_avatar,player_final_life,opponent_final_life,winner,duration_sec,notes,deck_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?);',
    [`${pid}-m1`, pid, ts, 'standard', null, 'Rival', null, 12, 0, 'player', null, '', `${pid}-d1`]);
  sdb.run('INSERT INTO match_log_entries(id,match_id,t,who,kind,delta,to_life,to_max) VALUES(?,?,?,?,?,?,?,?);',
    [`${pid}-ml1`, `${pid}-m1`, ts, 'player', 'life', -2, 18, 20]);
  sdb.run('INSERT INTO dashboard_blocks(id,profile_id,type,width,config,sort_order,created_at) VALUES(?,?,?,?,?,?,?);',
    [`${pid}-b1`, pid, 'note', 'full', '{"name":"Note"}', 0, ts]);
  sdb.run('INSERT INTO dashboard_layouts(id,profile_id,name,blocks,saved_at) VALUES(?,?,?,?,?);',
    [`${pid}-dl1`, pid, 'Layout', '[]', ts]);
  sdb.run('INSERT INTO resume(profile_id,target_type,target_id,title,at) VALUES(?,?,?,?,?);',
    [pid, 'deck', `${pid}-d1`, `${name} Deck`, ts]);
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
  sdb.run('PRAGMA foreign_keys = ON;');   // belt and braces: dump() re-opens the handle
  sdb.run('DELETE FROM profiles; DELETE FROM cards; DELETE FROM catalog_meta;');
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('sentinel_card','Sentinel','[{\"code\":\"004\"}]');");
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('other_card','Other','[{\"code\":\"004\"}]');");
  sdb.run("INSERT OR REPLACE INTO catalog_meta(key,value) VALUES('version','7');");
  sdb.run("INSERT OR REPLACE INTO catalog_meta(key,value) VALUES('dash_seeded:p-one','1');");
  seedProfile('p-one', 'Alpha', true, '2026-01-01');
  seedProfile('p-two', 'Beta', false, '2026-01-02');
  __setActiveIdForTests('p-two');
  prefs.clear();
  __setBackingForTests(memoryBacking());   // durable by default; policy tests install their own
});

afterEach(() => {
  __resetWriteGateForTests();
  __setBackendForTests(realBackend);
  __setBackingForTests(null);
});

/* ------------------------------------------------------------------ */
/* Archive + capture helpers                                           */
/* ------------------------------------------------------------------ */

/** The device's current state as an (unsealed) whole-app envelope, via the real capture path. */
async function deviceEnvelope() {
  return snapshot(async () => {
    const ps = await listProfiles();
    const units = [];
    for (const p of ps) units.push(await buildProfileUnit(p.id));
    let active = null;
    try { active = activeProfileId(); } catch { active = null; }
    const idx = ps.findIndex((p) => p.id === active);
    return buildEnvelope({
      schemaVersion: SCHEMA_VERSION, appBuild: 220, exportedAt: '2026-08-12T10:00:00.000Z',
      appGlobal: { activeProfileIndex: idx >= 0 ? idx : null, changelogSeenBuild: null },
      profiles: units,
    });
  });
}

const archiveText = async () => JSON.stringify(await seal(await deviceEnvelope()));

/* ------------------------------------------------------------------ */
/* §7 equivalence - the exclusion set, enumerated in ONE helper        */
/* ------------------------------------------------------------------ */

// What restore legitimately regenerates, and therefore what equivalence must not compare:
//   - PHYSICAL ids: every row `id`, every `profile_id`, and the FK columns that carry them
//     (deck_entries/deck_history.deck_id, collection_items.collection_id,
//     card_list_entries.list_id, match_log_entries.match_id, matches.deck_id).
//     Relational identity is PRESERVED by rewriting parent ids deterministically from row
//     content and mapping children through the same table - a re-key that broke a link would
//     surface as a mismatch, not vanish.
//   - PLANNER-REGENERATED timestamps: profiles.created_at / updated_at (planProfileUnit stamps
//     its own). Row-level timestamps are carried by the bundle and stay comparable.
// Everything else - names, counts, settings, dashSeeded, is_default, row timestamps - compares.
function normalisedUnit(unit) {
  const u = JSON.parse(JSON.stringify(unit));
  u.profile = { ...u.profile, created_at: null, updated_at: null };

  const mapOf = (arr, strip) => {
    const keyed = (arr || []).map((r) => ({ id: r.id, key: canonicalJson(strip(r)) ?? 'null' }));
    keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return new Map(keyed.map((k, i) => [k.id, `#${i}`]));
  };
  const deckMap = mapOf(u.decks, ({ id, profile_id, ...r }) => r);
  const colMap = mapOf(u.collections, ({ id, profile_id, ...r }) => r);
  const listMap = mapOf(u.card_lists, ({ id, profile_id, ...r }) => r);
  // Storage compares as a SEMANTIC GRAPH, never by row identity. Restore re-keys every id, so a
  // digest that included them would always differ - and, worse, a digest that merely counted rows
  // would MATCH while container_id had been remapped to the wrong container and every card had
  // quietly changed binder. Containers are keyed by their content, allocations by which container
  // and which owned row they name.
  const contMap = mapOf(u.storage_containers, ({ id, profile_id, ...r }) => r);
  const ownedMap = mapOf(u.owned_cards, ({ id, profile_id, ...r }) => r);
  // Matches reference decks, so their deck_id is remapped BEFORE their own keys are derived.
  u.matches = (u.matches || []).map((m) => ({ ...m, deck_id: m.deck_id ? (deckMap.get(m.deck_id) ?? null) : null }));
  const matchMap = mapOf(u.matches, ({ id, profile_id, ...r }) => r);

  const scrub = (arr, fn) => (arr || []).map(fn);
  u.decks = scrub(u.decks, ({ id, profile_id, ...r }) => ({ ...r, id: deckMap.get(id) }));
  u.deck_entries = scrub(u.deck_entries, ({ id, ...r }) => ({ ...r, deck_id: deckMap.get(r.deck_id) }));
  u.deck_history = scrub(u.deck_history, ({ id, ...r }) => ({ ...r, deck_id: deckMap.get(r.deck_id) }));
  u.saved = scrub(u.saved, ({ id, profile_id, ...r }) => r);
  u.notes = scrub(u.notes, ({ id, profile_id, ...r }) => r);
  u.collections = scrub(u.collections, ({ id, profile_id, ...r }) => ({ ...r, id: colMap.get(id) }));
  u.collection_items = scrub(u.collection_items, ({ id, ...r }) => ({ ...r, collection_id: colMap.get(r.collection_id) }));
  u.owned_cards = scrub(u.owned_cards, ({ id, profile_id, ...r }) => r);
  u.storage_containers = scrub(u.storage_containers, ({ id, profile_id, ...r }) => ({ ...r, id: contMap.get(id) }));
  u.storage_allocations = scrub(u.storage_allocations, ({ id, profile_id, ...r }) => ({
    ...r, container_id: contMap.get(r.container_id), owned_card_id: ownedMap.get(r.owned_card_id),
  }));
  u.card_lists = scrub(u.card_lists, ({ id, profile_id, ...r }) => ({ ...r, id: listMap.get(id) }));
  u.card_list_entries = scrub(u.card_list_entries, ({ id, ...r }) => ({ ...r, list_id: listMap.get(r.list_id) }));
  u.links = scrub(u.links, ({ id, profile_id, ...r }) => r);
  u.matches = scrub(u.matches, ({ id, profile_id, ...r }) => ({ ...r, id: matchMap.get(id) }));
  u.match_log_entries = scrub(u.match_log_entries, ({ id, ...r }) => ({ ...r, match_id: matchMap.get(r.match_id) }));
  u.dashboard_blocks = scrub(u.dashboard_blocks, ({ id, profile_id, ...r }) => r);
  u.dashboard_layouts = scrub(u.dashboard_layouts, ({ id, profile_id, ...r }) => r);
  if (u.resume) {
    const { profile_id, ...r } = u.resume;
    // resume.target_id is a profile-owned reference when it names a deck, so it is remapped like
    // every other one above. It was left raw here because nothing exercised it - and while the
    // restore wrote the id verbatim, both sides held the SAME dead id and compared equal. Two
    // faults cancelling out is not equivalence, and this line stops them cancelling.
    // `card` and `rule` targets are catalog ids and must pass through untouched.
    u.resume = r.target_type === 'deck' ? { ...r, target_id: deckMap.get(r.target_id) ?? null } : r;
  }
  if (u.settings) { const { profile_id, ...r } = u.settings; u.settings = r; }
  return u;
}

async function normalisedDigest(env) {
  return contentDigestOf({
    schemaVersion: env.schemaVersion,
    payload: {
      appGlobal: { activeProfileIndex: env.payload.appGlobal?.activeProfileIndex ?? null },
      profiles: env.payload.profiles.map(normalisedUnit),
    },
  });
}

/* ------------------------------------------------------------------ */
/* ATOMICITY FIRST - abortable before functional                       */
/* ------------------------------------------------------------------ */

/** Fail the REPLACEMENT transaction (identified by its leading delete) at one statement. */
function failingTxAt(position) {
  return (st) => {
    if (!st.some(([s]) => s === 'DELETE FROM profiles;')) return realBackend.tx(st);
    const i = position === 'first' ? 0 : position === 'middle' ? Math.floor(st.length / 2) : st.length - 1;
    sdb.run('BEGIN;');
    try {
      st.forEach(([s, p = []], k) => {
        if (k === i) throw new Error(`injected failure at statement ${k} of ${st.length}`);
        sdb.run(s, p);
      });
      sdb.run('COMMIT;');
    } catch (e) { sdb.run('ROLLBACK;'); throw e; }
    return Promise.resolve();
  };
}

for (const position of ['first', 'middle', 'last']) {
  test(`ATOMICITY: an injected failure at the ${position.toUpperCase()} statement leaves the database byte-identical`, async () => {
    const preview = await previewBackup(await archiveText());
    const before = dump();
    __setBackendForTests({ ...realBackend, tx: failingTxAt(position) });

    await assert.rejects(replaceAll(preview), /injected failure/);

    assert.deepEqual(dump(), before, 'the database bytes changed across a failed replacement');
    // The two rows a partial commit would have left behind, asserted by name as well as by byte:
    assert.equal(count(`catalog_meta WHERE key='${RESTORE_PENDING_KEY}'`), 0, 'the journal row must not survive a failed transaction');
    assert.equal(count(`catalog_meta WHERE key='${RECOVERY_POINTER_KEY}'`), 0, 'no pointer may be published for a replacement that did not happen');
    assert.equal(activeProfileId(), 'p-two', 'the active profile must not move on failure');

    // And the session was released - the app is not left read-only by a failed replace.
    __setBackendForTests(realBackend);
    await run("INSERT INTO notes(id,profile_id,target_type,target_id,body) VALUES('after','p-two','card','x','ok');");
    assert.equal(count("notes WHERE id='after'"), 1);
  });
}

/* ------------------------------------------------------------------ */
/* The journal row commits INSIDE the replacement transaction          */
/* ------------------------------------------------------------------ */

test('the journal row is in the SAME transaction as the deletes, last, and names the right ids', async () => {
  const preview = await previewBackup(await archiveText());
  let replacementList = null;
  let journalAtCommit;                       // read the instant the commit returns, before promote
  __setBackendForTests({
    ...realBackend,
    tx: (st) => {
      const p = realBackend.tx(st);
      if (st.some(([s]) => s === 'DELETE FROM profiles;')) {
        replacementList = st;
        journalAtCommit = rows('SELECT value FROM catalog_meta WHERE key=?;', [RESTORE_PENDING_KEY])[0]?.value ?? null;
      }
      return p;
    },
  });

  const result = await replaceAll(preview);

  // Structural: the one transaction that deletes also carries the journal row, as its LAST entry.
  assert.ok(replacementList, 'no replacement transaction was observed');
  const [lastSql, lastParams] = replacementList[replacementList.length - 1];
  assert.match(lastSql, /INSERT OR REPLACE INTO catalog_meta/);
  assert.equal(lastParams[0], RESTORE_PENDING_KEY, 'the journal row must be the final statement of the replacement tx');

  // Observed: present the moment the commit returns, with the ids startup would need.
  const journal = JSON.parse(journalAtCommit);
  assert.equal(journal.candidateId, result.recoveryPointId);
  assert.equal(journal.intendedActiveId, result.activeProfileId);
  assert.equal(journal.intendedPrimaryId, rows('SELECT id FROM profiles WHERE is_default=1;')[0].id);

  // And after the pointer publishes, the journal is retired - the pointer carries it from here.
  assert.equal(count(`catalog_meta WHERE key='${RESTORE_PENDING_KEY}'`), 0, 'a completed replace must clear the journal');
  const pointer = JSON.parse(rows('SELECT value FROM catalog_meta WHERE key=?;', [RECOVERY_POINTER_KEY])[0].value);
  assert.equal(pointer.id, result.recoveryPointId, 'the published pointer must name the candidate the journal named');
});

test('the sequence runs through the session in order: capture, candidate, then the one transaction', async () => {
  const preview = await previewBackup(await archiveText());
  const calls = [];
  const backing = memoryBacking();
  const write = backing.write.bind(backing);
  backing.write = (id, text) => { calls.push('candidate-write'); return write(id, text); };
  __setBackingForTests(backing);
  __setBackendForTests({
    ...realBackend,
    beginRead: () => { calls.push('beginRead'); return realBackend.beginRead(); },
    endRead: () => { calls.push('endRead'); return realBackend.endRead(); },
    tx: (st) => { calls.push(st.some(([s]) => s === 'DELETE FROM profiles;') ? 'replace-tx' : 'tx'); return realBackend.tx(st); },
  });

  await replaceAll(preview);

  const order = ['beginRead', 'endRead', 'candidate-write', 'replace-tx'];
  const seen = calls.filter((c) => order.includes(c));
  assert.deepEqual(seen.slice(0, 4), order,
    `capture must close before the candidate is written, and both before the replacement: ${calls.join(' -> ')}`);
});

/* ------------------------------------------------------------------ */
/* The cascade assumption, asserted table by table                     */
/* ------------------------------------------------------------------ */

test('DELETE FROM profiles cascades EVERY profile-owned table (assumption 4, not trusted)', () => {
  assert.equal(rows('PRAGMA foreign_keys;')[0].foreign_keys, 1, 'precondition: FK enforcement is on');
  const tables = [...ITERATED_COLLECTIONS, 'resume', 'settings'];
  for (const t of tables) assert.ok(count(t) > 0, `precondition: ${t} must be seeded or this test proves nothing`);

  sdb.run('DELETE FROM profiles;');

  assert.equal(count('profiles'), 0);
  for (const t of tables) assert.equal(count(t), 0, `${t} did not cascade - planReplace's one delete would strand rows`);
  // And the catalog is untouched by the cascade - the boundary the deletes must respect.
  assert.ok(count('cards') > 0);
  assert.equal(rows("SELECT value FROM catalog_meta WHERE key='version';")[0].value, '7');
});

/* ------------------------------------------------------------------ */
/* Replacement semantics                                               */
/* ------------------------------------------------------------------ */

test('restoring an archive yields canonical equivalence with it - and the device state it replaced is gone', async () => {
  const text = await archiveText();
  const wanted = await normalisedDigest((await previewBackup(text)).env);

  // Diverge the device so the replace has something real to destroy.
  seedProfile('p-three', 'Intruder', false, '2026-02-01');
  sdb.run("UPDATE owned_cards SET qty_owned=9 WHERE id='p-one-oc1';");
  const diverged = await normalisedDigest(await deviceEnvelope());
  assert.notEqual(diverged, wanted, 'the normaliser is vacuous if divergence does not change the digest');

  const result = await replaceAll(await previewBackup(text));

  assert.equal(result.via, 'replace');
  assert.equal(result.profiles, 2);
  assert.equal(count('profiles'), 2, 'replace, not merge: the intruder profile must be gone');
  assert.equal(await normalisedDigest(await deviceEnvelope()), wanted,
    'the device is not canonically equivalent to the archive it restored');
  // The archive's active (Beta) and Primary (Alpha) DIFFER, and both must land.
  assert.equal(rows('SELECT name FROM profiles WHERE is_default=1;')[0].name, 'Alpha');
  assert.equal(rows('SELECT name FROM profiles WHERE id=?;', [activeProfileId()])[0].name, 'Beta');
  assert.equal(result.activeReconciled, true);
});

test('restoring the SAME archive twice is canonically equivalent both times (idempotent)', async () => {
  const text = await archiveText();
  const wanted = await normalisedDigest((await previewBackup(text)).env);

  await replaceAll(await previewBackup(text));
  const first = await normalisedDigest(await deviceEnvelope());
  await replaceAll(await previewBackup(text));
  const second = await normalisedDigest(await deviceEnvelope());

  assert.equal(first, wanted);
  assert.equal(second, wanted);
  assert.equal(count('profiles'), 2, 'a second replace must not accumulate profiles');
});

test('duplicate profile names come back as duplicates - no "(imported)" suffix anywhere', async () => {
  // §7's required case: two profiles sharing a name, holding different decks.
  sdb.run("UPDATE profiles SET name='Alpha' WHERE id='p-two';");
  const text = await archiveText();
  const wanted = await normalisedDigest((await previewBackup(text)).env);

  await replaceAll(await previewBackup(text));

  const names = rows('SELECT name FROM profiles;').map((r) => r.name);
  assert.deepEqual(names, ['Alpha', 'Alpha'], 'both profiles must keep the shared name exactly');
  assert.equal(count("profiles WHERE name LIKE '%(imported%'"), 0, 'replace must never disambiguate - there is nothing to collide with');
  assert.equal(await normalisedDigest(await deviceEnvelope()), wanted);
  // The two same-named profiles are still DIFFERENT profiles with their own decks.
  assert.equal(count('decks'), 2);
  assert.equal(rows('SELECT COUNT(DISTINCT profile_id) c FROM decks;')[0].c, 2);
});

test('CONTRAST: the additive path still suffixes - which is exactly what replace removes', async () => {
  // The fail-first evidence for the no-suffix property: the same colliding name through the
  // ADDITIVE path gets a suffix, so the absence of one above is a property of replace and not an
  // accident of the fixture.
  //
  // Driven with a legacy single-profile file, because that is now the only input the additive
  // executor accepts - it refuses whole-app archives at the boundary, which is what stops a UI
  // routing slip from quietly reinstating additive whole-app restore.
  const { exportProfile } = await import('./profileTransfer.js');
  const bundle = await exportProfile('p-one');            // 'Alpha', a name already on the device
  const preview = await previewBackup(JSON.stringify(bundle));
  await restoreAll(preview);
  assert.ok(count("profiles WHERE name LIKE '%(imported)%'") > 0, 'import is expected to disambiguate');
});

test('the catalog and device state survive: catalog_meta.version, catalog rows, and the pointer', async () => {
  const cardsBefore = count('cards');
  await replaceAll(await previewBackup(await archiveText()));
  assert.equal(rows("SELECT value FROM catalog_meta WHERE key='version';")[0].value, '7');
  assert.equal(count('cards'), cardsBefore);
  assert.equal(count(`catalog_meta WHERE key='${RECOVERY_POINTER_KEY}'`), 1, 'the recovery pointer must outlive the data it protects');
});

test('dash_seeded keys are RE-KEYED: deleted pids dropped, restored pids written', async () => {
  // Seeded: dash_seeded:p-one (Alpha true, Beta false in the archive).
  await replaceAll(await previewBackup(await archiveText()));

  const keys = rows("SELECT key FROM catalog_meta WHERE key LIKE 'dash_seeded:%';").map((r) => r.key);
  assert.ok(!keys.includes('dash_seeded:p-one'), 'the deleted pid kept its key');
  const alphaPid = rows("SELECT id FROM profiles WHERE name='Alpha';")[0].id;
  const betaPid = rows("SELECT id FROM profiles WHERE name='Beta';")[0].id;
  assert.deepEqual(keys, [`dash_seeded:${alphaPid}`], 'exactly the restored Alpha carries the flag');
  assert.ok(!keys.includes(`dash_seeded:${betaPid}`), 'Beta was never seeded and must not become so');
});

/* ------------------------------------------------------------------ */
/* Increment 3 is ENFORCED, not merely available                       */
/* ------------------------------------------------------------------ */

test('replacement is IMPOSSIBLE when replacementPolicy() refuses and nothing is bound', async () => {
  __setBackingForTests({ kind: 'web' });   // node has no navigator.storage: not durable
  const preview = await previewBackup(await archiveText());
  const before = dump();

  await assert.rejects(replaceAll(preview), (e) => e.name === 'ReplaceRefused' && e.code === 'not-durable');

  assert.deepEqual(dump(), before, 'a refused replacement must write nothing');
  await run("INSERT INTO notes(id,profile_id,target_type,target_id,body) VALUES('after','p-two','card','x','ok');");
  assert.equal(count("notes WHERE id='after'"), 1, 'refusal must not leave a session holding the database');
});

test('replacement is IMPOSSIBLE when the bound archive is stale - checked against the CAPTURE, end to end', async () => {
  __setBackingForTests(memoryBacking('web'));            // not durable: the binding is the only net
  const staleText = await archiveText();                  // describes the device as it is NOW...
  sdb.run("UPDATE owned_cards SET qty_owned=7 WHERE id='p-two-oc1';");   // ...and now it is stale
  const binding = await bindExternalArchive(staleText);
  const preview = await previewBackup(staleText);
  const before = dump();

  await assert.rejects(replaceAll(preview, { binding }),
    (e) => e.name === 'ReplaceRefused' && e.code === 'stale-archive');

  assert.deepEqual(dump(), before, 'a stale binding must abort before anything is destroyed');
  assert.equal(count(`catalog_meta WHERE key='${RESTORE_PENDING_KEY}'`), 0);
  await run("INSERT INTO notes(id,profile_id,target_type,target_id,body) VALUES('after','p-two','card','x','ok');");
  assert.equal(count("notes WHERE id='after'"), 1, 'the session must be released after a stale abort');
});

test('a FRESH bound archive substitutes for durability and the replacement proceeds', async () => {
  __setBackingForTests(memoryBacking('web'));
  const targetText = await archiveText();                // the archive being restored
  seedProfile('p-three', 'Intruder', false, '2026-02-01');
  const binding = await bindExternalArchive(await archiveText());   // exported AFTER the change: fresh

  const result = await replaceAll(await previewBackup(targetText), { binding });

  assert.equal(result.via, 'replace');
  assert.equal(count('profiles'), 2, 'the fresh binding must unlock the replacement');
  assert.equal(count("profiles WHERE name='Intruder'"), 0);
});

/* ------------------------------------------------------------------ */
/* planReplace - shape and refusals                                    */
/* ------------------------------------------------------------------ */

test('planReplace orders one list: deletes first, Primary after the inserts, journal LAST', async () => {
  const env = (await previewBackup(await archiveText())).env;
  const { statements, intendedActiveId, intendedPrimaryId } = planReplace(env, {
    candidateId: 'rp-test', profileIds: ['p-one', 'p-two'], setsOf: () => ['004'],
  });

  assert.equal(statements[0][0], 'DELETE FROM profiles;', 'profile-owned state dies first');
  assert.deepEqual(statements[1], ['DELETE FROM catalog_meta WHERE key=?;', ['dash_seeded:p-one']]);
  assert.deepEqual(statements[2], ['DELETE FROM catalog_meta WHERE key=?;', ['dash_seeded:p-two']]);
  const [lastSql, lastParams] = statements[statements.length - 1];
  assert.match(lastSql, /INSERT OR REPLACE INTO catalog_meta/);
  assert.equal(lastParams[0], RESTORE_PENDING_KEY);
  assert.deepEqual(JSON.parse(lastParams[1]),
    { candidateId: 'rp-test', intendedActiveId, intendedPrimaryId });
  assert.match(statements[statements.length - 2][0], /UPDATE profiles SET is_default=1 WHERE id=\?/,
    'the Primary lands inside the same list, before only the journal');
  assert.notEqual(intendedActiveId, intendedPrimaryId, 'archive active (Beta) and Primary (Alpha) differ and must both be re-keyed');
});

test('planReplace refuses to plan without a candidate id or from a non-whole-app bundle', async () => {
  const env = (await previewBackup(await archiveText())).env;
  assert.throws(() => planReplace(env, { profileIds: [] }), /candidate id/);
  assert.throws(() => planReplace({ profile: { name: 'X' }, decks: [] }, { candidateId: 'rp-x' }), /whole-app/);
});

test('replaceAll refuses a single-profile file - it is never authority to delete the whole app', async () => {
  const before = dump();
  await assert.rejects(replaceAll({ kind: 'profile', bundle: {} }),
    (e) => e.name === 'ReplaceRefused' && e.code === 'single-profile');
  assert.deepEqual(dump(), before);
});

/* ------------------------------------------------------------------ */
/* POST-COMMIT: finished or deferred, NEVER failed                     */
/* ------------------------------------------------------------------ */
//
// The blocker this section exists for. The destructive transaction commits, and THEN the pointer is
// published and the journal retired. Those two used to be unguarded, so either rejecting took the
// whole call down - and the UI said "Restore failed" for an operation whose data was already gone.
//
// That is not merely misleading. It invites a retry, and a retry would capture the ALREADY-REPLACED
// state as the new candidate and overwrite the journal row naming the real pre-restore one, leaving
// the user's only copy of what they had as an orphan for the next sweep. The error message would
// have destroyed the recovery point.

/** A backend whose tx() throws when `match(statements)` says so.
 *
 *  Matching has to be precise here. The post-commit steps go through session.tx as SINGLE-statement
 *  transactions, while the replacement itself is one large multi-statement tx that ALSO touches
 *  catalog_meta - it writes the journal row and deletes the re-keyed dash_seeded keys. Keying on the
 *  SQL text alone therefore aborts the commit and tests a pre-commit failure, which is a different
 *  thing that correctly rejects. So each predicate below pins the single-statement shape. */
function failingWhen(match, label) {
  return {
    ...realBackend,
    tx: (st) => (match(st) ? Promise.reject(new Error(`injected failure: ${label}`)) : realBackend.tx(st)),
  };
}
const isLone = (st, sqlPart, param) =>
  st.length === 1 && st[0][0].includes(sqlPart) && (param === undefined || (st[0][1] || []).includes(param));

const failPointer = () => failingWhen(
  (st) => isLone(st, 'catalog_meta', RECOVERY_POINTER_KEY), 'pointer publication');
const failRetire = () => failingWhen(
  (st) => isLone(st, 'DELETE FROM catalog_meta', RESTORE_PENDING_KEY), 'journal retirement');

for (const step of [
  { label: 'POINTER PUBLICATION', backend: failPointer },
  { label: 'JOURNAL RETIREMENT', backend: failRetire },
]) {
  test(`a ${step.label} failure after the commit is DEFERRED, not a rejection`, async () => {
    const preview = await previewBackup(await archiveText());
    sdb.run("INSERT INTO profiles(id,name,avatar,accent,system,schema_version,is_default,created_at,updated_at) VALUES('p-extra','Gamma',NULL,'gold','sorcery',11,0,'2026-01-03','2026-01-03');");
    __setBackendForTests(step.backend());

    // MUST NOT reject. The rows are committed; a rejection here is the bug.
    const r = await replaceAll(preview);

    assert.equal(r.via, 'replace');
    assert.equal(r.settled, false, 'the caller must be told this did not fully settle');
    assert.equal(count('profiles'), 2, 'the replacement itself committed - Gamma is gone');
  });
}

test('after a deferred replacement, a RETRY is refused and the recovery point survives', async () => {
  // The data-loss half. planReplace writes the journal with INSERT OR REPLACE, so an unguarded
  // retry would overwrite the row naming the pre-restore candidate with one naming a candidate
  // captured from the already-replaced state.
  const preview = await previewBackup(await archiveText());
  const backing = memoryBacking();
  __setBackingForTests(backing);
  __setBackendForTests(failPointer());

  const first = await replaceAll(preview);
  assert.equal(first.settled, false);

  const journal = rows('SELECT value FROM catalog_meta WHERE key=?;', [RESTORE_PENDING_KEY]);
  assert.equal(journal.length, 1, 'the journal row is the retry ticket and must survive');
  const originalCandidate = JSON.parse(journal[0].value).candidateId;
  assert.ok(backing.files.has(originalCandidate), 'the pre-restore capture must still be on disk');

  // THE RETRY. Refused, so the journal is not overwritten and the candidate is not orphaned.
  __setBackendForTests(realBackend);
  await assert.rejects(replaceAll(preview), (e) => e.code === 'reconciliation-pending');

  const after = rows('SELECT value FROM catalog_meta WHERE key=?;', [RESTORE_PENDING_KEY]);
  assert.equal(JSON.parse(after[0].value).candidateId, originalCandidate,
    'the retry overwrote the journal - the original pre-restore copy is now unreachable');
  assert.ok(backing.files.has(originalCandidate), 'the original capture must still exist');
});

test('and the next boot makes that deferred recovery point reachable', async () => {
  // Deferred is only acceptable because reconciliation finishes it. This is that promise, kept.
  const preview = await previewBackup(await archiveText());
  const backing = memoryBacking();
  __setBackingForTests(backing);
  __setBackendForTests(failPointer());
  const r = await replaceAll(preview);
  assert.equal(r.settled, false);

  __setBackendForTests(realBackend);
  const { reconcileRestore } = await import('./restoreReconcile.js');
  const outcome = await reconcileRestore();

  assert.equal(outcome.status, 'finished');
  const pointer = rows('SELECT value FROM catalog_meta WHERE key=?;', [RECOVERY_POINTER_KEY]);
  assert.equal(pointer.length, 1, 'the recovery point is published after reconciliation');
  assert.equal(JSON.parse(pointer[0].value).id, r.recoveryPointId);
  assert.equal(rows('SELECT value FROM catalog_meta WHERE key=?;', [RESTORE_PENDING_KEY]).length, 0,
    'and the journal is retired');
});

test('a failed ACTIVE-PROFILE reconciliation keeps the journal, and the next boot adopts the archive\'s profile', async () => {
  // The mirror image of the pointer-failure case, and the one that slipped through: switchProfile
  // fails, publication then SUCCEEDS, and retiring the journal unconditionally would delete the only
  // record of intendedActiveId. The next boot would find nothing pending, be unable to adopt the
  // archive's active profile, and fall back to whichever restored profile sorts first - while the
  // toast had promised that reopening would finish the job.
  const preview = await previewBackup(await archiveText());
  __setBackingForTests(memoryBacking());

  // switchProfile writes the active id through Preferences; failing that fails reconciliation
  // without disturbing the commit, which is the state this test is about.
  const realSet = globalThis.window.localStorage.setItem;
  globalThis.window.localStorage.setItem = () => { throw new Error('Preferences unavailable'); };
  let r;
  try { r = await replaceAll(preview); }
  finally { globalThis.window.localStorage.setItem = realSet; }

  assert.equal(r.activeReconciled, false, 'precondition: the active profile did not settle');
  assert.equal(r.published, true, 'precondition: the pointer DID publish, which is what used to retire the journal');
  assert.equal(r.settled, false, 'the caller must not be told this is finished');

  const journal = rows('SELECT value FROM catalog_meta WHERE key=?;', [RESTORE_PENDING_KEY]);
  assert.equal(journal.length, 1, 'the retry ticket must survive - startup cannot finish without it');
  assert.equal(JSON.parse(journal[0].value).intendedActiveId, r.activeProfileId);

  // THE PROMISE THE TOAST MAKES, kept: reopening finishes it.
  const { reconcileRestore } = await import('./restoreReconcile.js');
  const outcome = await reconcileRestore();
  assert.equal(outcome.status, 'finished');
  assert.equal(activeProfileId(), r.activeProfileId, "the archive's active profile is adopted, not an arbitrary survivor");
  assert.equal(rows('SELECT value FROM catalog_meta WHERE key=?;', [RESTORE_PENDING_KEY]).length, 0,
    'and only now is the journal retired');
});
