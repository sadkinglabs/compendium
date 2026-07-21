// v11 wants, per collector item - the writers that make "I need the Beta one" representable.
//
// Against a real database, because the assertions that matter are about what ends up STORED:
// which key, and whether anything else on the row survived. Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import {
  setWantedForItem, stepWantedForItem, addWantedForItem, wantedItemsForCard, qtyFor,
} from './ownedRepository.js';
import {
  LEGACY_UNCATEGORISED, LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL, isLegacyPrinting,
} from './printings.js';

const require = createRequire(import.meta.url);
const PID = 'test-profile';
let sdb;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; } finally { st.free(); }
};
const ledger = (cardId = 'c1') =>
  rows('SELECT variant_slug, qty_owned, qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=? ORDER BY variant_slug;', [PID, cardId]);
const seed = (slug, owned = 0, wanted = 0, cardId = 'c1') =>
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [`seed-${slug}-${cardId}`, PID, cardId, slug, owned, wanted, '', '2026-01-01', '2026-01-01']);

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  __setBackendForTests({
    query(sql, params = []) { return Promise.resolve(rows(sql, params)); },
    run(sql, params = []) { sdb.run(sql, params); return Promise.resolve(); },
    exec(sql) { sdb.run(sql); return Promise.resolve(); },
    tx(stmts) { sdb.run('BEGIN;'); try { for (const [s, p = []] of stmts) sdb.run(s, p); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
    persist() { return Promise.resolve(); },
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);
  sdb.run('INSERT INTO profiles(id,name,schema_version,created_at) VALUES(?,?,?,?);', [PID, 'Test', 10, '2026-01-01']);
  __setActiveIdForTests(PID);
});

beforeEach(() => { sdb.run('DELETE FROM owned_cards;'); });

/* ---------------- the point of the whole exercise ---------------- */

test('"I need the Beta one" is finally representable', async () => {
  await setWantedForItem('c1', { set: '002', foil: false }, 1);
  assert.deepEqual(ledger(), [{ variant_slug: '002', qty_owned: 0, qty_wanted: 1 }]);
});

test('wants on the same card in different sets and finishes are separate rows', async () => {
  await setWantedForItem('c1', { set: '001', foil: false }, 1);
  await setWantedForItem('c1', { set: '002', foil: false }, 2);
  await setWantedForItem('c1', { set: '002', foil: true }, 3);
  assert.deepEqual(ledger(), [
    { variant_slug: '001', qty_owned: 0, qty_wanted: 1 },
    { variant_slug: '002', qty_owned: 0, qty_wanted: 2 },
    { variant_slug: '002:f', qty_owned: 0, qty_wanted: 3 },
  ]);
});

/* ---------------- canonical keys only ---------------- */

test('NO writer here ever emits a legacy key', async () => {
  await setWantedForItem('c1', { set: '', foil: false }, 1);
  await setWantedForItem('c1', { set: '', foil: true }, 2);
  await setWantedForItem('c1', { set: '001', foil: true }, 3);
  await addWantedForItem('c2', { set: '', foil: false }, 1);
  await addWantedForItem('c2', { set: '', foil: true }, 1);
  const all = rows('SELECT variant_slug FROM owned_cards;');
  assert.ok(all.length > 0);
  for (const r of all) {
    assert.equal(isLegacyPrinting(r.variant_slug), false, `legacy key written: ${JSON.stringify(r.variant_slug)}`);
  }
});

test('an uncategorised want uses the canonical key, not the empty string', async () => {
  await setWantedForItem('c1', {}, 2);
  assert.deepEqual(ledger(), [{ variant_slug: UNCATEGORISED, qty_owned: 0, qty_wanted: 2 }]);
});

test('an uncategorised FOIL want is its own collector item', async () => {
  await setWantedForItem('c1', { foil: true }, 1);
  assert.deepEqual(ledger(), [{ variant_slug: UNCATEGORISED_FOIL, qty_owned: 0, qty_wanted: 1 }]);
});

/* ---------------- the shared row, and the bug that made '' unsafe ---------------- */

test('setting a want to zero does NOT delete owned copies on the same row', async () => {
  // This is the exact shape of the defect that made dropping '' rows destructive: ownership
  // and the wishlist share a row, so a careless delete takes both.
  seed(UNCATEGORISED, 3, 2);
  await setWantedForItem('c1', {}, 0);
  assert.deepEqual(ledger(), [{ variant_slug: UNCATEGORISED, qty_owned: 3, qty_wanted: 0 }]);
});

test('the row IS removed once both quantities reach zero', async () => {
  seed(UNCATEGORISED, 0, 1);
  await setWantedForItem('c1', {}, 0);
  assert.deepEqual(ledger(), [], 'no 0/0 tombstone is left behind');
});

/* ---------------- writing over a legacy row ---------------- */

test('editing a want on a LEGACY row converts that row instead of duplicating it', async () => {
  // Looking only for the canonical key would create a second row meaning the same collector
  // item, and the two would drift apart.
  seed(LEGACY_UNCATEGORISED, 2, 1);
  await setWantedForItem('c1', {}, 5);
  assert.deepEqual(ledger(), [{ variant_slug: UNCATEGORISED, qty_owned: 2, qty_wanted: 5 }],
    'one row, canonical key, owned copies preserved');
});

test('a legacy FOIL row is found and converted too', async () => {
  seed(LEGACY_FOIL, 1, 0);
  await setWantedForItem('c1', { foil: true }, 2);
  assert.deepEqual(ledger(), [{ variant_slug: UNCATEGORISED_FOIL, qty_owned: 1, qty_wanted: 2 }]);
});

test('a canonical row is preferred when both forms somehow exist', async () => {
  seed(LEGACY_UNCATEGORISED, 1, 1);
  seed(UNCATEGORISED, 2, 2);
  await setWantedForItem('c1', {}, 9);
  const after = ledger();
  assert.equal(after.find((r) => r.variant_slug === UNCATEGORISED).qty_wanted, 9);
  assert.equal(after.find((r) => r.variant_slug === LEGACY_UNCATEGORISED)?.qty_wanted, 1,
    'the legacy row is left for the boot pass rather than silently merged here');
});

/* ---------------- stepping and atomic adds ---------------- */

test('stepping floors at zero rather than going negative', async () => {
  await setWantedForItem('c1', { set: '001' }, 1);
  await stepWantedForItem('c1', { set: '001' }, -5);
  assert.deepEqual(ledger(), []);
});

test('stepping composes across separate collector items', async () => {
  await stepWantedForItem('c1', { set: '001' }, 2);
  await stepWantedForItem('c1', { set: '002' }, 3);
  await stepWantedForItem('c1', { set: '001' }, 1);
  assert.deepEqual(ledger(), [
    { variant_slug: '001', qty_owned: 0, qty_wanted: 3 },
    { variant_slug: '002', qty_owned: 0, qty_wanted: 3 },
  ]);
});

test('atomic adds accumulate without a read-modify-write', async () => {
  await Promise.all([
    addWantedForItem('c1', { set: '002' }, 1),
    addWantedForItem('c1', { set: '002' }, 1),
    addWantedForItem('c1', { set: '002' }, 1),
  ]);
  assert.deepEqual(ledger(), [{ variant_slug: '002', qty_owned: 0, qty_wanted: 3 }],
    'overlapping increments do not lose each other');
});

test('an atomic add never disturbs owned copies on the same row', async () => {
  seed('002', 4, 0);
  await addWantedForItem('c1', { set: '002' }, 2);
  assert.deepEqual(ledger(), [{ variant_slug: '002', qty_owned: 4, qty_wanted: 2 }]);
});

/* ---------------- reading back ---------------- */

test('wantedItemsForCard reports every collector item, in canonical terms', async () => {
  seed(LEGACY_UNCATEGORISED, 0, 1);
  await setWantedForItem('c1', { set: '002' }, 2);
  await setWantedForItem('c1', { set: '002', foil: true }, 3);
  const m = await wantedItemsForCard('c1');
  assert.equal(m.get(UNCATEGORISED), 1, 'a legacy row is reported under its canonical name');
  assert.equal(m.get('002'), 2);
  assert.equal(m.get('002:f'), 3);
});

test('card-level totals still sum across every collector item', async () => {
  // qtyFor is the existing card-level read; per-item wants must not break it.
  await setWantedForItem('c1', { set: '001' }, 1);
  await setWantedForItem('c1', { set: '002' }, 2);
  const { wanted } = await qtyFor('c1');
  assert.equal(wanted, 3);
});
