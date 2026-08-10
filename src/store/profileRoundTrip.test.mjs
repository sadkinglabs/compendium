// CHARACTERIZATION: what a profile export/import round trip actually carries, table by table
// and field by field, against TODAY'S code. Run: npm run test:query
//
// WHY THIS EXISTS (Increment A, Stage 1). Stage 4 extracts `buildProfileUnit` / `planProfileUnit` out of
// `exportProfile` / `importProfile` so the per-profile path and the new whole-app path share ONE
// implementation. That function is the most hardened in the store - its comments record two separately
// paid-for bugs - and Codex required a safety net written BEFORE the extraction, not after.
//
// The two historical bugs are already characterized in `importProfileBoundary.test.mjs`: the disconnected
// import boundary (an imported want multiplying on the first tap) and the orphan profile (a mid-import
// failure leaving a husk). This file adds the third guard Codex asked for, which did not exist: a
// SCHEMA-DERIVED, ALL-TABLE, ALL-FIELD round trip.
//
// The point is the failure mode it prevents. A weaker test that only checks the exporter is satisfiable by
// adding a table to the export and forgetting the import - the archive would then contain the data and
// never give it back, which is the worst thing a backup feature can do. So this asserts the ROUND TRIP,
// and it fails if EITHER side drops a table or a field.
//
// It is also fail-closed against the future: the profile-owned table set is read from the live schema
// after migrations, so a v12 table that nobody teaches this test about turns it RED rather than passing
// silently.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { exportProfile, importProfile, buildProfileUnit, planProfileUnit } from './profileTransfer.js';

const require = createRequire(import.meta.url);
const SRC = 'src-profile';

let sdb;
let realBackend;   // restored after any test that swaps it

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; }
  finally { st.free(); }
};

/* ------------------------------------------------------------------ */
/* The table set, derived from the live schema - never hand-listed      */
/* ------------------------------------------------------------------ */

// Shared, read-only catalog content: no profile owns it, and a bundle must never carry it.
const CATALOG_TABLES = new Set(['cards', 'rules', 'faqs', 'link_graph', 'catalog_meta']);
// Database-level bookkeeping, not user data.
const META_TABLES = new Set(['_meta']);
// The spine itself: carried as the bundle's `profile` object, not as a row list.
const SPINE_TABLES = new Set(['profiles']);

/** Every table a profile owns, directly (`profile_id`) or transitively (FK to one that does). */
function profileOwnedTables() {
  return rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
    .map((r) => r.name)
    .filter((t) => !CATALOG_TABLES.has(t) && !META_TABLES.has(t) && !SPINE_TABLES.has(t));
}

/* ------------------------------------------------------------------ */
/* Sentinels: one row per table, a distinctive value in every column    */
/* ------------------------------------------------------------------ */

const TS = '2026-03-04T05:06:07.000Z';

// One seeder per profile-owned table. A table with no seeder FAILS the first test below - that is the
// mechanism that makes a future migration impossible to forget.
const SEEDERS = {
  decks: (pid) => ['INSERT INTO decks(id,profile_id,name,slug,archetype,avatar_card_id,avatar_slug,cover_slug,notes,curiosa_url,wins,losses,starred,lib_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);',
    ['deck-1', pid, 'Sentinel Deck', 'sentinel-deck', 'sentinel-archetype', 'sentinel_card', 'av-slug', 'cov-slug', 'deck notes sentinel', 'https://curiosa.io/decks/sentinel', 1, 0, 1, 7, TS, TS]],
  deck_entries: () => ['INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES(?,?,?,?,?,?);',
    ['de-1', 'deck-1', 'spellbook', 'sentinel_card', 3, 'sentinel_slug']],
  deck_history: () => ['INSERT INTO deck_history(id,deck_id,ts,text) VALUES(?,?,?,?);',
    ['dh-1', 'deck-1', TS, 'history text sentinel']],
  saved: (pid) => ['INSERT INTO saved(id,profile_id,target_type,target_id,created_at) VALUES(?,?,?,?,?);',
    ['sv-1', pid, 'card', 'sentinel_card', TS]],
  notes: (pid) => ['INSERT INTO notes(id,profile_id,target_type,target_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?);',
    ['nt-1', pid, 'card', 'sentinel_card', 'note body sentinel', TS, TS]],
  collections: (pid) => ['INSERT INTO collections(id,profile_id,name,created_at) VALUES(?,?,?,?);',
    ['col-1', pid, 'Sentinel Collection', TS]],
  collection_items: () => ['INSERT INTO collection_items(id,collection_id,target_type,target_id,added_at) VALUES(?,?,?,?,?);',
    ['ci-1', 'col-1', 'card', 'sentinel_card', TS]],
  owned_cards: (pid) => ['INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    // variant_slug '' deliberately, so v11 canonicalisation DOES fire: this row carries both owned
    // copies and a want, and the restore splits it (want -> canonical printing, owned -> To Be
    // Categorised). That reshape is the intended semantics, so it is asserted by conserved totals in
    // its own test rather than by row identity.
    ['oc-1', pid, 'sentinel_card', '', 4, 2, 'owned notes sentinel', TS, TS]],
  card_lists: (pid) => ['INSERT INTO card_lists(id,profile_id,kind,name,description,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?);',
    ['cl-1', pid, 'wanted', 'Sentinel List', 'list description sentinel', 5, TS, TS]],
  card_list_entries: () => ['INSERT INTO card_list_entries(id,list_id,card_id,quantity,variant_slug,added_at) VALUES(?,?,?,?,?,?);',
    ['cle-1', 'cl-1', 'sentinel_card', 6, 'sentinel_slug', TS]],
  links: (pid) => ['INSERT INTO links(id,profile_id,kind,a_type,a_id,b_type,b_id,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?);',
    ['lk-1', pid, 'card_card', 'card', 'sentinel_card', 'card', 'sentinel_card_2', 'link description sentinel', TS, TS]],
  matches: (pid) => ['INSERT INTO matches(id,profile_id,played_at,mode,player_avatar,opponent_name,opponent_avatar,player_final_life,opponent_final_life,winner,duration_sec,notes,deck_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?);',
    ['mt-1', pid, TS, 'sentinel-mode', 'sentinel_card', 'Sentinel Opponent', 'sentinel_card_2', 17, 3, 'player', 1234, 'match notes sentinel', 'deck-1']],
  match_log_entries: () => ['INSERT INTO match_log_entries(id,match_id,t,who,kind,delta,to_life,to_max) VALUES(?,?,?,?,?,?,?,?);',
    ['ml-1', 'mt-1', TS, 'player', 'life', -3, 17, 20]],
  dashboard_blocks: (pid) => ['INSERT INTO dashboard_blocks(id,profile_id,type,width,config,sort_order,created_at) VALUES(?,?,?,?,?,?,?);',
    // A REGISTERED widget kind: filterImportedBlocks drops unsupported types on import, so an
    // invented kind would look like data loss when it is actually the intended guard.
    // Not 'urls' either: that config is deliberately sanitized (safeHref) - a transformation, not a loss.
    ['db-1', pid, 'winRate', 'full', '{"sentinel":"config"}', 2, TS]],
  dashboard_layouts: (pid) => ['INSERT INTO dashboard_layouts(id,profile_id,name,blocks,saved_at) VALUES(?,?,?,?,?);',
    ['dl-1', pid, 'Sentinel Layout', '[{"type":"winRate","width":"full"}]', TS]],
  resume: (pid) => ['INSERT INTO resume(profile_id,target_type,target_id,title,at) VALUES(?,?,?,?,?);',
    [pid, 'card', 'sentinel_card', 'Sentinel Title', TS]],
  settings: (pid) => ['UPDATE settings SET film_grain=?,keep_awake=?,immersive=?,default_max_life=?,die_type=?,haptics=?,rarity_colors=?,theme=?,persist_search=?,font_scale=?,high_contrast=?,reduced_motion=? WHERE profile_id=?;',
    [0, 0, 0, 17, 20, 0, 1, 'sentinel-theme', 1, 1.5, 1, 1, pid]],
};

/**
 * Columns excluded from the field-fidelity comparison, each with the reason it is NOT a loss.
 * This list IS the documentation of what the round trip transforms - Stage 4 must preserve every
 * entry's justification or change it deliberately.
 */
const TRANSFORMED = {
  // Every id is re-keyed so two imports never collide (profileTransfer.js:122-127).
  _all: ['id', 'profile_id'],
  deck_entries: ['deck_id'],          // follows the re-keyed deck
  deck_history: ['deck_id'],
  collection_items: ['collection_id'],
  card_list_entries: ['list_id'],
  match_log_entries: ['match_id'],
  matches: ['deck_id'],               // piloted deck follows the re-keyed deck
  // W-L is DERIVED from matches, deliberately recomputed rather than trusted (profileTransfer.js:185-196).
  decks: ['wins', 'losses'],
  // accent_metal is the retired counter-skin picker: deliberately not restored (profileTransfer.js:177-180).
  settings: ['accent_metal'],
};

/**
 * `owned_cards` is compared by INVARIANT rather than by row, because v11 canonicalisation legitimately
 * reshapes it: an uncategorised row splits into the canonical printing (which carries the WANT, since a
 * want must name a printing) and the To Be Categorised pile (which keeps the OWNED copies). Row identity
 * is therefore the wrong thing to assert; conserved totals are the right thing. Its own test, below.
 */
const RESHAPED_BY_CANONICALISATION = new Set(['owned_cards']);

const ignoredFor = (t) => new Set([...TRANSFORMED._all, ...(TRANSFORMED[t] ?? [])]);
const columnsOf = (t) => rows(`PRAGMA table_info(${t});`).map((c) => c.name);
const rowsFor = (t, pid) => {
  const cols = columnsOf(t);
  if (cols.includes('profile_id')) return rows(`SELECT * FROM ${t} WHERE profile_id=?;`, [pid]);
  // Child table: reach it through its parent, which is the only profile-scoped anchor it has.
  const parent = { deck_entries: ['decks', 'deck_id'], deck_history: ['decks', 'deck_id'],
    collection_items: ['collections', 'collection_id'], card_list_entries: ['card_lists', 'list_id'],
    match_log_entries: ['matches', 'match_id'] }[t];
  const [ptable, fk] = parent;
  return rows(`SELECT c.* FROM ${t} c JOIN ${ptable} p ON p.id = c.${fk} WHERE p.profile_id=?;`, [pid]);
};

/* ------------------------------------------------------------------ */

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  realBackend = {
    query: (s, p = []) => Promise.resolve(rows(s, p)),
    run: (s, p = []) => { sdb.run(s, p); return Promise.resolve(); },
    exec: (s) => { sdb.run(s); return Promise.resolve(); },
    tx: (st) => { sdb.run('BEGIN;'); try { for (const [s, p = []] of st) sdb.run(s, p); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
    persist: () => Promise.resolve(),
  };
  __setBackendForTests(realBackend);
  for (const m of MIGRATIONS) sdb.run(m.sql);
  __setActiveIdForTests(SRC);
});

beforeEach(() => {
  sdb.run('DELETE FROM profiles;');   // cascades every profile-owned table
  sdb.run('DELETE FROM cards;');
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('sentinel_card','Sentinel','[{\"code\":\"004\"}]');");
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('sentinel_card_2','Sentinel Two','[{\"code\":\"004\"}]');");
  sdb.run('INSERT INTO profiles(id,name,avatar,accent,system,schema_version,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [SRC, 'Sentinel Source', JSON.stringify({ kind: 'card', value: 'sentinel_card' }), 'jade', 'sorcery', SCHEMA_VERSION, 1, TS, TS]);
  sdb.run('INSERT OR IGNORE INTO settings(profile_id) VALUES(?);', [SRC]);
  // Parents (profile-scoped) before children (FK to a parent): sqlite_master returns tables
  // alphabetically, which would insert deck_entries before decks and trip the FK constraint.
  const owned = profileOwnedTables();
  const isDirect = (t) => columnsOf(t).includes('profile_id');
  for (const t of [...owned.filter(isDirect), ...owned.filter((t2) => !isDirect(t2))]) {
    const seed = SEEDERS[t];
    if (!seed) continue;             // reported by the first test, not thrown here
    const [sql, params] = seed(SRC);
    sdb.run(sql, params);
  }
});

/* ------------------------------------------------------------------ */

afterEach(() => { __setBackendForTests(realBackend); });

test('FAIL-CLOSED: every profile-owned table in the live schema has a sentinel seeder', () => {
  const missing = profileOwnedTables().filter((t) => !SEEDERS[t]);
  assert.deepEqual(missing, [],
    `Profile-owned table(s) with no seeder: ${missing.join(', ')}.\n` +
    'A migration added a table this round-trip test knows nothing about. Add a seeder above AND make sure ' +
    'exportProfile/importProfile carry it - otherwise a backup would omit it silently.');
});

test('COMPLETENESS: every profile-owned table survives an export/import round trip', async () => {
  const tables = profileOwnedTables();
  const before = Object.fromEntries(tables.map((t) => [t, rowsFor(t, SRC).length]));
  for (const [t, n] of Object.entries(before)) assert.ok(n > 0, `seed produced no ${t} row`);

  const bundle = await exportProfile(SRC);
  const dst = await importProfile(bundle, { name: 'Restored' });

  const emptied = tables.filter((t) => rowsFor(t, dst).length === 0);
  assert.deepEqual(emptied, [],
    `Table(s) lost in the round trip: ${emptied.join(', ')}. ` +
    'Either exportProfile does not emit them or importProfile does not write them.');
});

test('FIELD FIDELITY: every carried field round-trips unchanged, except documented transformations', async () => {
  const tables = profileOwnedTables();
  const src = Object.fromEntries(tables.map((t) => [t, rowsFor(t, SRC)]));

  const bundle = await exportProfile(SRC);
  const dst = await importProfile(bundle, { name: 'Restored' });

  const losses = [];
  for (const t of tables) {
    if (RESHAPED_BY_CANONICALISATION.has(t)) continue;   // asserted by invariant instead - see below
    const ignore = ignoredFor(t);
    const a = src[t][0];
    const b = rowsFor(t, dst)[0];
    if (!b) { losses.push(`${t}: no restored row`); continue; }
    for (const col of Object.keys(a)) {
      if (ignore.has(col)) continue;
      if (a[col] !== b[col]) losses.push(`${t}.${col}: ${JSON.stringify(a[col])} -> ${JSON.stringify(b[col])}`);
    }
  }
  assert.deepEqual(losses, [], 'Fields changed or lost in the round trip:\n  ' + losses.join('\n  '));
});

test('CANONICALISATION: owned_cards is reshaped, but owned and wanted totals are conserved', async () => {
  // The documented v11 transformation, pinned so Stage 4 cannot alter it silently. An uncategorised row
  // carrying both owned copies and a want becomes TWO rows: the want on the canonical printing, the owned
  // copies in the To Be Categorised pile. What must never change is the arithmetic.
  const before = rows('SELECT card_id, SUM(qty_owned) o, SUM(qty_wanted) w FROM owned_cards WHERE profile_id=? GROUP BY card_id;', [SRC]);

  const bundle = await exportProfile(SRC);
  const dst = await importProfile(bundle, { name: 'Restored' });

  const after = rows('SELECT card_id, SUM(qty_owned) o, SUM(qty_wanted) w FROM owned_cards WHERE profile_id=? GROUP BY card_id;', [dst]);
  assert.deepEqual(after, before, 'owned/wanted totals per card must survive canonicalisation exactly');

  // And the reshape really did happen, so this test is guarding something rather than asserting a no-op.
  const slugs = rows('SELECT variant_slug FROM owned_cards WHERE profile_id=? ORDER BY variant_slug;', [dst]).map((r) => r.variant_slug);
  assert.ok(slugs.length >= 1 && !slugs.includes(''), `expected canonical slugs, got ${JSON.stringify(slugs)}`);
});

test('re-keyed foreign keys resolve to the RESTORED parent, never the source', async () => {
  const bundle = await exportProfile(SRC);
  const dst = await importProfile(bundle, { name: 'Restored' });

  const srcDeck = rows('SELECT id FROM decks WHERE profile_id=?;', [SRC])[0].id;
  const dstDeck = rows('SELECT id FROM decks WHERE profile_id=?;', [dst])[0].id;
  assert.notEqual(dstDeck, srcDeck, 'deck id was not re-keyed');

  const entryDeck = rows('SELECT deck_id FROM deck_entries WHERE id IN (SELECT c.id FROM deck_entries c JOIN decks p ON p.id=c.deck_id WHERE p.profile_id=?);', [dst])[0].deck_id;
  assert.equal(entryDeck, dstDeck, 'deck_entries points at the wrong deck');

  const matchDeck = rows('SELECT deck_id FROM matches WHERE profile_id=?;', [dst])[0].deck_id;
  assert.equal(matchDeck, dstDeck, 'match piloted-deck did not follow the re-keyed deck');
});

test("derived deck W-L is recomputed from the restored matches, not copied", async () => {
  // The source deck is seeded 1-0 and has exactly one winning match, so a correct recompute agrees.
  const bundle = await exportProfile(SRC);
  const dst = await importProfile(bundle, { name: 'Restored' });
  const d = rows('SELECT wins,losses FROM decks WHERE profile_id=?;', [dst])[0];
  assert.deepEqual({ wins: d.wins, losses: d.losses }, { wins: 1, losses: 0 });
});

test('KNOWN GAPS: the profile row itself does not round-trip completely (this is what Increment A closes)', async () => {
  // Characterizing the CURRENT contract, so Stage 4 cannot change it by accident. Every assertion here
  // is a gap the whole-app bundle format is designed to close - see backup-and-restore.md.
  const bundle = await exportProfile(SRC);
  assert.deepEqual(Object.keys(bundle.profile).sort(), ['accent', 'avatar', 'name'],
    'exportProfile emits only name/avatar/accent for the profile row');

  const dst = await importProfile(bundle, { name: 'Restored' });
  const p = rows('SELECT * FROM profiles WHERE id=?;', [dst])[0];
  assert.equal(p.is_default, 0, 'is_default is not carried; import always writes 0');
  assert.equal(p.system, 'sorcery', 'system is hard-coded on import, not carried');
  assert.notEqual(p.created_at, TS, 'created_at is stamped fresh, not carried');
  // What DOES carry:
  assert.equal(p.accent, 'jade');
  assert.equal(JSON.parse(p.avatar).value, 'sentinel_card');
});

test('the bundle carries no catalog content - only references to it', async () => {
  const bundle = await exportProfile(SRC);
  for (const t of CATALOG_TABLES) {
    assert.ok(!(t in bundle), `bundle leaked catalog table ${t}`);
  }
  assert.equal(bundle.owned_cards[0].card_id, 'sentinel_card', 'catalog refs are carried as ids');
});

/* ------------------------------------------------------------------ */
/* Stage 4: the extraction's own contracts                             */
/* ------------------------------------------------------------------ */

test('buildProfileUnit carries MORE than the legacy bundle - the full profile row and dashSeeded', async () => {
  sdb.run("INSERT OR REPLACE INTO catalog_meta(key,value) VALUES(?, '1');", [`dash_seeded:${SRC}`]);
  const unit = await buildProfileUnit(SRC);
  assert.deepEqual(Object.keys(unit.profile).sort(),
    ['accent', 'avatar', 'created_at', 'is_default', 'name', 'system', 'updated_at']);
  assert.equal(unit.profile.is_default, 1, 'is_default must survive into the unit');
  assert.equal(unit.profile.system, 'sorcery');
  assert.equal(unit.dashSeeded, true, 'the per-profile dashboard flag must be carried');
});

test('exportProfile NARROWS the unit - the legacy file format is unchanged by the extraction', async () => {
  // Widening the legacy bundle here would change a format that already exists on devices. That is
  // Increment A's job to do deliberately, not a side effect of refactoring.
  const bundle = await exportProfile(SRC);
  assert.deepEqual(Object.keys(bundle.profile).sort(), ['accent', 'avatar', 'name']);
  assert.ok(!('dashSeeded' in bundle), 'legacy bundle must not gain dashSeeded');
});

test('PURITY CONTRACT: planProfileUnit plans with no database at all', async () => {
  // The whole-app restore concatenates every profile's plan into ONE transaction (Options / H).
  // That is only possible if planning needs no database round-trip, so prove it against a backend
  // that throws on every call.
  const bundle = await exportProfile(SRC);
  __setBackendForTests(new Proxy({}, {
    get: () => () => { throw new Error('planProfileUnit touched the database'); },
  }));
  const { pid, statements } = planProfileUnit(bundle, { pid: 'fixed-pid', name: 'Planned' });
  assert.equal(pid, 'fixed-pid', 'the caller supplies the id; the planner never allocates one');
  assert.ok(statements.length > 1, 'planner produced no statements');
  assert.ok(statements.every(([sql]) => typeof sql === 'string'), 'statements must be [sql, params] pairs');
  // First two statements are the profile row and its settings row, inside the same set as the data.
  assert.match(statements[0][0], /^INSERT INTO profiles\(/);
  assert.match(statements[1][0], /INSERT OR IGNORE INTO settings/);
});

test('planProfileUnit accepts an explicit dashSeeded, and falls back to the legacy heuristic', async () => {
  const bundle = await exportProfile(SRC);
  const marker = (sts) => sts.some(([sql]) => sql.includes('catalog_meta'));
  assert.equal(marker(planProfileUnit(bundle, { pid: 'p', name: 'n', dashSeeded: true }).statements), true);
  assert.equal(marker(planProfileUnit(bundle, { pid: 'p', name: 'n', dashSeeded: false }).statements), false);
  // undefined -> the heuristic, which for a bundle carrying supported blocks marks it seeded
  assert.equal(marker(planProfileUnit(bundle, { pid: 'p', name: 'n' }).statements), true);
});
