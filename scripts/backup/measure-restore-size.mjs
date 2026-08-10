// Increment A, Stage 0, measurement 1: how big is a whole-app restore's statement set?
//
// WHY THIS EXISTS. The approved design restores every profile in ONE transaction, so atomicity is a
// property of SQLite rather than of our own bookkeeping (backup-and-restore.md, Options / H). Revision 2
// of that proposal ASSUMED one transaction was too big, and designed a weaker per-profile restore with
// in-memory compensation around the assumption. Codex refused it: the proposal claimed atomic restore in
// its acceptance criteria and accepted a permanent partial restore in its design. So the assumption is
// now measured BEFORE any feature code exists, and the measurement picks the design:
//
//   fits  -> Options / H, one executeSet, no recovery code of our own
//   too big -> Options / J, a durable _meta restore journal with startup recovery (reviewed first)
//
// HOW. It does not reimplement anything. It drives the REAL importProfile against a real in-memory
// sql.js database, wrapping tx() to record the exact statement set the production path builds. The
// numbers are therefore what would actually be handed to executeSet on device, not an estimate.
//
// Usage:
//   node scripts/backup/measure-restore-size.mjs                  # synthetic scales
//   node scripts/backup/measure-restore-size.mjs <bundle.json>... # the owner's real exports
//
// A real export is produced today from the app: profile chip -> Export, once per profile. Pass every
// profile's file to measure a true whole-app restore.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { MIGRATIONS, SCHEMA_VERSION } from '../../src/store/schema.js';
import { __setBackendForTests } from '../../src/store/db.js';
import { __setActiveIdForTests } from '../../src/store/profileRepository.js';
import { importProfile } from '../../src/store/profileTransfer.js';
import { cardSlug } from '../../src/store/cardSlug.js';

const require = createRequire(import.meta.url);
const PID = 'measure-host';

let sdb;
let captured = null;   // set while a restore is being measured

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; }
  finally { st.free(); }
};

async function openDb() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  __setBackendForTests({
    query: (s, p = []) => Promise.resolve(rows(s, p)),
    run: (s, p = []) => { sdb.run(s, p); return Promise.resolve(); },
    exec: (s) => { sdb.run(s); return Promise.resolve(); },
    // THE CAPTURE POINT. Records the statement set, then executes it for real so the measurement
    // also proves the set is valid SQL against the live schema - not merely that it is small.
    tx: (statements) => {
      // Loop, not push(...statements): spreading a 300k-element array exceeds the argument limit
      // and throws RangeError - which is itself a small omen about handing sets this size to a bridge.
      if (captured) for (const st of statements) captured.push(st);
      sdb.run('BEGIN;');
      try { for (const [s, p = []] of statements) sdb.run(s, p); sdb.run('COMMIT;'); }
      catch (e) { sdb.run('ROLLBACK;'); throw e; }
      return Promise.resolve();
    },
    persist: () => Promise.resolve(),
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);
  __setActiveIdForTests(PID);
}

/** Serialised size of a statement set, as executeSet would have to materialise it. */
function measure(statements) {
  let sqlBytes = 0;
  let paramBytes = 0;
  for (const [sql, params = []] of statements) {
    sqlBytes += Buffer.byteLength(sql, 'utf8');
    paramBytes += Buffer.byteLength(JSON.stringify(params ?? []), 'utf8');
  }
  return { count: statements.length, sqlBytes, paramBytes, totalBytes: sqlBytes + paramBytes };
}

const fmt = (n) => n.toLocaleString('en-US');
const mib = (n) => (n / 1024 / 1024).toFixed(2) + ' MiB';

/* ------------------------------------------------------------------ */
/* synthetic bundles - shaped like real usage, scaled                  */
/* ------------------------------------------------------------------ */

const iso = (i) => new Date(Date.UTC(2026, 0, 1 + (i % 365))).toISOString();

/**
 * A bundle at a given scale. Proportions follow how the app is actually used: the collection ledger
 * dominates, decks and matches are secondary, everything else is small.
 */
function syntheticBundle({ owned, decks, entriesPerDeck, matches, logPerMatch, lists, listEntries, notes }) {
  const b = {
    app: 'compendium', schemaVersion: SCHEMA_VERSION, exportedAt: iso(0),
    profile: { name: 'Synthetic', avatar: null, accent: 'gold' },
    decks: [], deck_entries: [], deck_history: [], saved: [], notes: [],
    collections: [], collection_items: [], owned_cards: [], card_lists: [], card_list_entries: [],
    links: [], matches: [], match_log_entries: [], dashboard_blocks: [], dashboard_layouts: [],
    resume: null, settings: null,
  };
  // Keys MUST be unique on (card_id, variant_slug): owned_cards carries a unique index
  // (schema.js idx_owned_key), so colliding synthetic rows silently merge and under-measure the
  // dominant table. The fidelity check exists because the first version of this generator did
  // exactly that and lost up to 90% of owned_cards before anyone looked.
  // Shape: a collector owns N distinct cards, most in one printing, some in two.
  for (let i = 0; i < owned; i++) {
    b.owned_cards.push({ id: `o${i}`, card_id: `card_${Math.floor(i / 2)}`, variant_slug: i % 2 ? 'set_004' : '',
      qty_owned: (i % 4) + 1, qty_wanted: i % 7 === 0 ? 2 : 0, notes: '', created_at: iso(i), updated_at: iso(i) });
  }
  for (let d = 0; d < decks; d++) {
    b.decks.push({ id: `d${d}`, name: `Deck ${d}`, slug: `deck-${d}`, archetype: 'midrange',
      avatar_card_id: 'card_1', avatar_slug: '', cover_slug: '', notes: 'x'.repeat(120), curiosa_url: null,
      wins: 3, losses: 2, starred: 0, lib_order: d, created_at: iso(d), updated_at: iso(d) });
    for (let e = 0; e < entriesPerDeck; e++) {
      b.deck_entries.push({ id: `d${d}e${e}`, deck_id: `d${d}`, zone: e % 5 === 0 ? 'atlas' : 'spellbook',
        card_id: `card_${(d * 37 + e) % 1200}`, quantity: (e % 3) + 1, variant_slug: '' });
    }
    b.deck_history.push({ id: `d${d}h`, deck_id: `d${d}`, ts: iso(d), text: 'Created' });
  }
  for (let m = 0; m < matches; m++) {
    b.matches.push({ id: `m${m}`, played_at: iso(m), mode: 'standard', player_avatar: 'card_1',
      opponent_name: `Opponent ${m % 40}`, opponent_avatar: 'card_2', player_final_life: 20 - (m % 20),
      opponent_final_life: m % 20, winner: m % 2 ? 'player' : 'opponent', duration_sec: 900 + m,
      notes: '', deck_id: decks ? `d${m % decks}` : null });
    for (let l = 0; l < logPerMatch; l++) {
      b.match_log_entries.push({ id: `m${m}l${l}`, match_id: `m${m}`, t: iso(m), who: l % 2 ? 'player' : 'opponent',
        kind: 'life', delta: -1, to_life: 20 - l, to_max: 20 });
    }
  }
  for (let L = 0; L < lists; L++) {
    b.card_lists.push({ id: `L${L}`, kind: L % 2 ? 'wanted' : 'custom', name: `List ${L}`, description: '',
      sort_order: L, created_at: iso(L), updated_at: iso(L) });
    for (let e = 0; e < listEntries; e++) {
      b.card_list_entries.push({ id: `L${L}e${e}`, list_id: `L${L}`, card_id: `card_${(L * 13 + e) % 1200}`,
        quantity: 1, variant_slug: '', added_at: iso(e) });
    }
  }
  for (let n = 0; n < notes; n++) {
    b.notes.push({ id: `n${n}`, target_type: 'card', target_id: `card_${n % 1200}`,
      body: 'A note about this card. '.repeat(6), created_at: iso(n), updated_at: iso(n) });
  }
  return b;
}

const SCALES = [
  ['light      (new user)', { owned: 300, decks: 3, entriesPerDeck: 60, matches: 20, logPerMatch: 20, lists: 2, listEntries: 20, notes: 10 }],
  ['moderate   (a season)', { owned: 2000, decks: 10, entriesPerDeck: 60, matches: 150, logPerMatch: 30, lists: 5, listEntries: 60, notes: 60 }],
  ['heavy      (collector)', { owned: 6000, decks: 25, entriesPerDeck: 60, matches: 600, logPerMatch: 40, lists: 12, listEntries: 150, notes: 200 }],
  ['extreme    (stress)', { owned: 20000, decks: 60, entriesPerDeck: 60, matches: 2000, logPerMatch: 50, lists: 30, listEntries: 400, notes: 800 }],
];

// Big enough that no synthetic owned row references a card the catalog lacks: an unknown card_id
// would be a DIFFERENT measurement (unresolved-placeholder handling), not the one we want.
const CATALOG_CARDS = Math.max(...SCALES.map(([, c]) => Math.ceil(c.owned / 2))) + 100;

async function seedSyntheticCatalog() {
  sdb.run('DELETE FROM cards;');
  sdb.run('BEGIN;');
  for (let i = 0; i < CATALOG_CARDS; i++) {
    sdb.run(`INSERT INTO cards(card_id,name,sets) VALUES('card_${i}','Card ${i}','[{"code":"004"}]');`);
  }
  sdb.run('COMMIT;');
}

/**
 * Seed the REAL catalog for a real-bundle measurement. This matters: `prepareBundle` resolves each
 * owned row's printing against `cards.sets`, and v11 canonicalisation can SPLIT one legacy row into
 * separate collector items. Against a synthetic catalog the real card ids resolve to nothing, no
 * canonicalisation fires, and the statement count comes out as a lower bound rather than the truth.
 * Keyed exactly as catalog.js does it, via cardSlug, so the ids match the bundle's.
 */
async function seedRealCatalog() {
  const path = ['dist/catalog/cards.json', 'android/app/src/main/assets/public/catalog/cards.json']
    .find((p) => existsSync(p));
  if (!path) {
    console.log('! No catalog found (dist/ or android assets). Falling back to a synthetic catalog:');
    console.log('  real card ids will not resolve, v11 canonicalisation will not fire, and the');
    console.log('  statement count will be a LOWER BOUND. Run `npm run build` to produce dist/catalog.\n');
    await seedSyntheticCatalog();
    return null;
  }
  const cardsObj = JSON.parse(readFileSync(path, 'utf8'));
  sdb.run('DELETE FROM cards;');
  sdb.run('BEGIN;');
  for (const c of Object.values(cardsObj)) {
    sdb.run('INSERT OR REPLACE INTO cards(card_id,name,sets,variants) VALUES(?,?,?,?);',
      [cardSlug(c.name), c.name, JSON.stringify(c.sets ?? []), JSON.stringify(c.variants ?? [])]);
  }
  sdb.run('COMMIT;');
  const n = rows('SELECT COUNT(*) c FROM cards;')[0].c;
  console.log(`Catalog: ${fmt(n)} cards seeded from ${path} - printings resolve, so v11 canonicalisation is live.\n`);
  return n;
}

function resetProfiles() {
  sdb.run('DELETE FROM profiles;');
  sdb.run('INSERT INTO profiles(id,name,schema_version,created_at) VALUES(?,?,?,?);', [PID, 'Host', SCHEMA_VERSION, iso(0)]);
}

// Tables the bundle carries as arrays, and where they land. Used for the fidelity check below.
const ARRAY_TABLES = [
  'decks', 'deck_entries', 'deck_history', 'saved', 'notes', 'collections', 'collection_items',
  'owned_cards', 'card_lists', 'card_list_entries', 'links', 'matches', 'match_log_entries',
  'dashboard_blocks', 'dashboard_layouts',
];

const PROFILE_SCOPED = new Set(['decks', 'saved', 'notes', 'collections', 'owned_cards', 'card_lists',
  'links', 'matches', 'dashboard_blocks', 'dashboard_layouts']);

/**
 * FIDELITY CHECK. The statement count came out BELOW the bundle row count, which has two possible
 * causes: the import is legitimately collapsing rows (v11 canonicalisation merges legacy printings
 * onto one collector item), or it is silently DROPPING data. Those are opposite conclusions, so the
 * measurement verifies which by counting what actually landed. A measurement whose fidelity is
 * unverified is not evidence.
 */
function fidelity(bundles, pids) {
  const report = [];
  for (const t of ARRAY_TABLES) {
    const expected = bundles.reduce((a, b) => a + (b[t]?.length ?? 0), 0);
    if (!expected) continue;
    let actual;
    if (PROFILE_SCOPED.has(t)) {
      actual = pids.reduce((a, pid) => a + rows(`SELECT COUNT(*) c FROM ${t} WHERE profile_id=?;`, [pid])[0].c, 0);
    } else {
      actual = rows(`SELECT COUNT(*) c FROM ${t};`)[0].c;   // child tables, DB is reset per measurement
    }
    if (actual !== expected) report.push(`${t}: bundle ${fmt(expected)} -> restored ${fmt(actual)}`);
  }
  return report;
}

async function measureBundles(label, bundles) {
  resetProfiles();
  captured = [];
  const t0 = process.hrtime.bigint();
  const pids = [];
  for (const b of bundles) pids.push(await importProfile(b));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const m = measure(captured);
  captured = null;
  const rowTotal = bundles.reduce((a, b) => a + Object.values(b).filter(Array.isArray).reduce((x, arr) => x + arr.length, 0), 0);
  console.log(
    `${label.padEnd(24)} profiles=${String(bundles.length).padStart(2)}  rows=${fmt(rowTotal).padStart(9)}  ` +
    `statements=${fmt(m.count).padStart(9)}  set=${mib(m.totalBytes).padStart(10)}  built+executed in ${ms.toFixed(0)} ms`
  );
  const delta = fidelity(bundles, pids);
  for (const d of delta) console.log(`${''.padEnd(24)}   ~ ${d}`);
  return m;
}

/* ------------------------------------------------------------------ */

const files = process.argv.slice(2);
await openDb();

console.log('\nIncrement A, Stage 0 / measurement 1 - whole-restore statement set');
console.log('Captured from the REAL importProfile path via db.js tx(); executed against live schema v' + SCHEMA_VERSION + '.\n');

if (files.length) {
  await seedRealCatalog();
  const bundles = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  for (const [i, b] of bundles.entries()) await measureBundles(`profile ${i + 1} alone`, [b]);
  if (bundles.length > 1) await measureBundles('ALL PROFILES (whole restore)', bundles);
} else {
  await seedSyntheticCatalog();
  for (const [label, cfg] of SCALES) {
    // One profile at this scale, then three profiles at this scale - a whole-app restore is N profiles.
    await measureBundles(label + ' x1', [syntheticBundle(cfg)]);
    await measureBundles(label + ' x3', [syntheticBundle(cfg), syntheticBundle(cfg), syntheticBundle(cfg)]);
  }
  console.log('\nPass the owner\'s real per-profile exports as arguments to pin this to actual data.');
}
console.log('');
