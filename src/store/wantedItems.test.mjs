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
  subscribeCollection, wishlistCards, cardWantKey,
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
  await setWantedForItem('c1', { set: '001', foil: false }, 1);
  await setWantedForItem('c1', { set: '002', foil: false }, 2);
  await setWantedForItem('c1', { set: '001', foil: true }, 3);
  await addWantedForItem('c2', { set: '004', foil: false }, 1);
  await addWantedForItem('c2', { set: '004', foil: true }, 1);
  const all = rows('SELECT variant_slug FROM owned_cards;');
  assert.ok(all.length > 0);
  for (const r of all) {
    assert.equal(isLegacyPrinting(r.variant_slug), false, `legacy key written: ${JSON.stringify(r.variant_slug)}`);
  }
});

/* ---------------- unresolved wants are REFUSED ---------------- */

test('creating an uncategorised want is refused, and writes nothing', async () => {
  // I originally asserted the opposite - that these writers happily produced canonical
  // uncategorised wants - and called it correct. It is not: 2.1 reserves that state for
  // migration, import and triage. Ordinary code manufacturing it would recreate exactly what
  // this work removes, and nothing downstream would object, because the row is well-formed.
  for (const item of [{}, { set: '' }, { set: null }, { foil: true }]) {
    await assert.rejects(() => setWantedForItem('c1', item, 2), /is not a set code/);
  }
  assert.deepEqual(ledger(), [], 'no row was created by any rejected call');
});

test('the uncategorised KEYS are refused as sets too, not just the empty string', async () => {
  // A caller passing a storage key through as if it were a set code.
  for (const set of [UNCATEGORISED, UNCATEGORISED_FOIL]) {
    await assert.rejects(() => setWantedForItem('c1', { set }, 1), /is not a set code/);
    await assert.rejects(() => addWantedForItem('c1', { set }, 1), /is not a set code/);
    await assert.rejects(() => stepWantedForItem('c1', { set }, 1), /is not a set code/);
  }
  assert.deepEqual(ledger(), []);
});

test('a rejected write emits NO collection notification', async () => {
  // A subscriber must not be told something changed when nothing did - a spurious refresh
  // would make the failure look like a successful no-op.
  let fired = 0;
  const unsub = subscribeCollection(() => { fired++; });
  await assert.rejects(() => setWantedForItem('c1', {}, 1), /is not a set code/);
  await assert.rejects(() => addWantedForItem('c1', {}, 1), /is not a set code/);
  unsub();
  assert.equal(fired, 0);
});

test('a rejected write does not disturb an existing row', async () => {
  seed('001', 2, 3);
  await assert.rejects(() => setWantedForItem('c1', {}, 9), /is not a set code/);
  assert.deepEqual(ledger(), [{ variant_slug: '001', qty_owned: 2, qty_wanted: 3 }]);
});

/* ---------------- the shared row, and the bug that made '' unsafe ---------------- */

test('setting a want to zero does NOT delete owned copies on the same row', async () => {
  // This is the exact shape of the defect that made dropping '' rows destructive: ownership
  // and the wishlist share a row, so a careless delete takes both.
  seed('001', 3, 2);
  await setWantedForItem('c1', { set: '001' }, 0);
  assert.deepEqual(ledger(), [{ variant_slug: '001', qty_owned: 3, qty_wanted: 0 }]);
});

test('the row IS removed once both quantities reach zero', async () => {
  seed('001', 0, 1);
  await setWantedForItem('c1', { set: '001' }, 0);
  assert.deepEqual(ledger(), [], 'no 0/0 tombstone is left behind');
});

/* ---------------- writing over a legacy row ---------------- */

test('editing a want on a per-set row updates it rather than duplicating it', async () => {
  // Looking only for one spelling of the key would create a second row meaning the same
  // collector item, and the two would drift apart. Uncategorised rows are no longer reachable
  // from these writers at all - only triage may resolve those.
  seed('001', 2, 1);
  await setWantedForItem('c1', { set: '001' }, 5);
  assert.deepEqual(ledger(), [{ variant_slug: '001', qty_owned: 2, qty_wanted: 5 }],
    'one row, owned copies preserved');
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

/* ---------------- adversarial set codes, across ALL THREE writers ---------------- */

test('every writer refuses storage keys, foil suffixes and padding', async () => {
  // My first validator listed forbidden values inline and missed half of them: the legacy
  // 'foil' key sailed through as a "set", and '001:f' with foil:true produced the malformed
  // key '001:f:f'. A hand-written reject-list is the wrong shape - the rule is what a set
  // code IS, which is why this now shares assertRealSetCode with every other writer.
  const bad = [
    undefined, null, '', '   ', ' 001', '001 ',
    'foil',              // the legacy card-level key
    'uncategorised',
    'uncategorised:f',
    '001:f',             // a printing key, not a set
    5, {}, [],
  ];
  for (const set of bad) {
    for (const [name, call] of [
      ['setWantedForItem', () => setWantedForItem('c1', { set }, 1)],
      ['stepWantedForItem', () => stepWantedForItem('c1', { set }, 1)],
      ['addWantedForItem', () => addWantedForItem('c1', { set }, 1)],
    ]) {
      await assert.rejects(call, /is not a set code/, `${name} accepted ${JSON.stringify(set)}`);
    }
  }
  assert.deepEqual(ledger(), [], 'not one of those attempts wrote a row');
});

test('the malformed double-suffix key can no longer be produced', async () => {
  // canonicalPrinting('001:f', true) returns '001:f:f'. It stays permissive because ownership
  // migration needs it; the want boundary is what must never hand it such an input.
  await assert.rejects(() => setWantedForItem('c1', { set: '001:f', foil: true }, 1), /is not a set code/);
  assert.equal(rows("SELECT COUNT(*) n FROM owned_cards WHERE variant_slug LIKE '%:f:f';")[0].n, 0);
});

test('adversarial rejections emit no notification either', async () => {
  let fired = 0;
  const unsub = subscribeCollection(() => { fired++; });
  for (const set of ['foil', '001:f', '  ', 'uncategorised']) {
    await assert.rejects(() => setWantedForItem('c1', { set }, 1));
    await assert.rejects(() => addWantedForItem('c1', { set }, 1));
  }
  unsub();
  assert.equal(fired, 0);
});

/* ---------------- the wishlist is per collector item ---------------- */

test('Alpha and Beta wants are two independently editable rows', async () => {
  // The Wishlist surface could not honestly display the v11 model while wishlistCards() grouped
  // by card_id: two wants collapsed into one row, and editing it could not say which item was
  // meant - which is what raised NeedsPrintingChoice on a card the user could plainly see.
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('c1','Reprinted','[{\"code\":\"001\"},{\"code\":\"002\"}]');");
  await setWantedForItem('c1', { set: '001', foil: false }, 1);
  await setWantedForItem('c1', { set: '002', foil: false }, 2);

  const wl = await wishlistCards();
  assert.equal(wl.length, 2, 'two rows, not one');
  assert.deepEqual(wl.map((r) => [r.set, r.foil, r.quantity]), [['001', false, 1], ['002', false, 2]]);
  assert.equal(new Set(wl.map((r) => r.item_id)).size, 2, 'each row has its own identity');

  // Incrementing one leaves the other alone, and needs no choice.
  await stepWantedForItem('c1', { set: '002', foil: false }, 1);
  const after = await wishlistCards();
  assert.deepEqual(after.map((r) => [r.set, r.quantity]), [['001', 1], ['002', 3]]);

  // Removing one leaves the other.
  await setWantedForItem('c1', { set: '001', foil: false }, 0);
  assert.deepEqual((await wishlistCards()).map((r) => r.set), ['002']);
});

test('a foil want is its own wishlist row, and says so', async () => {
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('c3','Both','[{\"code\":\"001\"}]');");
  await setWantedForItem('c3', { set: '001', foil: false }, 1);
  await setWantedForItem('c3', { set: '001', foil: true }, 1);
  const wl = (await wishlistCards()).filter((r) => r.card_id === 'c3');
  assert.equal(wl.length, 2);
  assert.deepEqual(wl.map((r) => r.foil).sort(), [false, true]);
});

/* ---------------- one chain per card, across BOTH surfaces ---------------- */

test('two concurrent increments from different surfaces finish at 3, not 2', async () => {
  // THE LOST UPDATE. The card sheet called the writer directly while Wishlist rows enqueued, so
  // a step that read 1 could store an absolute 2 over an atomic add that had already made it 2 -
  // one increment gone, both surfaces reporting success. Both now queue under cardWantKey.
  const { enqueueWrite, __resetCollectionWritesForTests } = await import('./collectionWrites.js');
  __resetCollectionWritesForTests();
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('cRace','Solo','[{\"code\":\"004\"}]');");
  seed('004', 0, 1, 'cRace');

  const key = cardWantKey(PID, 'cRace');
  await Promise.all([
    enqueueWrite(key, () => addWantedForItem('cRace', { set: '004', foil: false }, 1, PID)),
    enqueueWrite(key, () => stepWantedForItem('cRace', { set: '004', foil: false }, 1, PID)),
  ]);

  assert.deepEqual(ledger('cRace'), [{ variant_slug: '004', qty_owned: 0, qty_wanted: 3 }],
    'both increments landed');
});

test('COUNTERFACTUAL: bypassing the shared chain loses one of them', async () => {
  // Without this the test above proves only that two awaited calls work. Running the same pair
  // UNQUEUED must corrupt, or the chain is decoration.
  const { __resetCollectionWritesForTests } = await import('./collectionWrites.js');
  __resetCollectionWritesForTests();
  sdb.run('DELETE FROM owned_cards;');
  seed('004', 0, 1, 'cRace');

  // stepWantedForItem reads, then writes an absolute. Interleaving an atomic add between its
  // read and its write is exactly what the queue prevents.
  const stepped = stepWantedForItem('cRace', { set: '004', foil: false }, 1, PID);
  await addWantedForItem('cRace', { set: '004', foil: false }, 1, PID);
  await stepped;

  assert.equal(ledger('cRace')[0].qty_wanted, 2,
    'unqueued, the absolute write clobbers the atomic add - 3 increments became 2');
});
