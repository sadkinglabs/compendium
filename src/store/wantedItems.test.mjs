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
  subscribeCollection, wishlistCards, wishlistExportText, queueWantWrite,
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
const ledger = (cardId = 'c1', pid = PID) =>
  rows('SELECT variant_slug, qty_owned, qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=? ORDER BY variant_slug;', [pid, cardId]);
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
  // Seed the CATALOG rows the want-writers now validate against: a positive want must name a real
  // printing (assertRealPrinting -> getCard -> printingFinishes). c1 is a reprint (Alpha 001 + Beta
  // 002, both finishes); c2 is Arderial 004, both finishes - covering every (set, foil) these tests
  // write. Without this, getCard returns null and every positive item-write would fail closed.
  const seedCard = (id, variants) => sdb.run('INSERT INTO cards(card_id,name,variants) VALUES(?,?,?);', [id, id, JSON.stringify(variants)]);
  // Every card these tests write to, listing Alpha/Beta/Arderial (001/002/004) in BOTH finishes so
  // any valid (set, foil) pair commits. 'occult' (mixed availability) is seeded per-test via seedMixed.
  const fullVariants = ['001', '002', '004'].flatMap((s) => [
    { slug: `${s}-x-b-s`, set: s, finish: 'Standard' }, { slug: `${s}-x-b-f`, set: s, finish: 'Foil' },
  ]);
  for (const id of ['c1', 'c2']) seedCard(id, fullVariants);   // c3/cRace/cBind are seeded per-test below
  __setActiveIdForTests(PID);
});

beforeEach(() => { sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards;'); });

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

/* ---------------- fail-closed: no phantom collector items (Codex Phase-2b Major 2) ---------------- */

// 'occult' has a Promotional (999) printing that is STANDARD-ONLY, plus Alpha (001) in both finishes
// - the exact 'mixed per-set finish availability' shape that makes a foil phantom (999:f) reachable.
const seedMixed = () => sdb.run('INSERT OR REPLACE INTO cards(card_id,name,variants) VALUES(?,?,?);',
  ['occult', 'Occult Ritual', JSON.stringify([
    { slug: '001-occult-b-s', set: '001', finish: 'Standard' },
    { slug: '001-occult-b-f', set: '001', finish: 'Foil' },
    { slug: '999-occult-b-s', set: '999', finish: 'Standard' },
  ])]);

test('a positive want on a printing the catalog lacks (Promotional foil) is refused, no row', async () => {
  seedMixed();
  for (const write of [
    () => addWantedForItem('occult', { set: '999', foil: true }, 1),
    () => setWantedForItem('occult', { set: '999', foil: true }, 2),
    () => stepWantedForItem('occult', { set: '999', foil: true }, 1),
  ]) await assert.rejects(write, /no foil printing/);
  assert.deepEqual(ledger('occult'), []);
});

test('a rejected phantom want emits NO collection notification', async () => {
  seedMixed();
  let fired = 0; const unsub = subscribeCollection(() => { fired++; });
  await assert.rejects(() => addWantedForItem('occult', { set: '999', foil: true }, 1));
  unsub();
  assert.equal(fired, 0, 'a refused write must not signal a change');
});

test('a valid foil want (Alpha, both finishes) commits', async () => {
  seedMixed();
  await addWantedForItem('occult', { set: '001', foil: true }, 1);
  assert.deepEqual(ledger('occult'), [{ variant_slug: '001:f', qty_owned: 0, qty_wanted: 1 }]);
});

test('a valid non-foil Promotional want commits - only the foil pair is impossible', async () => {
  seedMixed();
  await setWantedForItem('occult', { set: '999', foil: false }, 1);
  assert.deepEqual(ledger('occult'), [{ variant_slug: '999', qty_owned: 0, qty_wanted: 1 }]);
});

test('a HISTORICAL malformed item can still be cleared, and stepped DOWN even to a positive value', async () => {
  seedMixed();
  seed('999:f', 0, 3, 'occult');                                   // a phantom that predates the guard
  await setWantedForItem('occult', { set: '999', foil: true }, 0);  // clear must always work
  assert.deepEqual(ledger('occult'), []);
  seed('999:f', 0, 3, 'occult');
  await stepWantedForItem('occult', { set: '999', foil: true }, -1);  // decrement must not be blocked
  assert.deepEqual(ledger('occult'), [{ variant_slug: '999:f', qty_owned: 0, qty_wanted: 2 }]);
});

// STRICT boolean finish - the mutation sentinel for requireBooleanFinish. c1/001 genuinely has BOTH
// finishes, so the old `!!foil` coercion would turn 'false' into true, PASS the catalog check, and
// store a non-foil intent as foil. Remove requireBooleanFinish and this test fails: the malformed
// value coerces, canonicalises to '001:f', and writes instead of rejecting.
test('every positive writer rejects a NON-boolean finish outright, even on a card that has foil', async () => {
  let fired = 0; const unsub = subscribeCollection(() => { fired++; });
  for (const bad of ['false', 'true', 0, 1, null, undefined]) {
    for (const call of [
      () => addWantedForItem('c1', { set: '001', foil: bad }, 1),
      () => setWantedForItem('c1', { set: '001', foil: bad }, 1),
      () => stepWantedForItem('c1', { set: '001', foil: bad }, 1),
    ]) await assert.rejects(call, /foil must be an exact boolean/, `accepted ${JSON.stringify(bad)}`);
  }
  unsub();
  assert.deepEqual(ledger(), [], 'no malformed write reached the ledger');
  assert.equal(fired, 0, 'no rejected write signalled a change');
});

test('an EXACT boolean finish writes the right slug: false -> standard key, true -> foil key', async () => {
  await addWantedForItem('c1', { set: '001', foil: false }, 1);
  await addWantedForItem('c1', { set: '001', foil: true }, 1);
  assert.deepEqual(ledger().map((r) => r.variant_slug).sort(), ['001', '001:f']);
});

test('the public validate-bypass is gone: a stray 5th argument cannot skip catalog validation', async () => {
  // Before the fix, setWantedForItem(..., {validate:false}) persisted a phantom. The option no longer
  // exists, so the extra arg is inert and the catalog check still fires.
  seedMixed();
  await assert.rejects(
    () => setWantedForItem('occult', { set: '999', foil: true }, 1, PID, { validate: false }),
    /no foil printing/, 'the removed option must not resurrect the bypass');
  assert.deepEqual(ledger('occult'), []);
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
  await setWantedForItem('c1', { set: '001', foil: false }, 0);
  assert.deepEqual(ledger(), [{ variant_slug: '001', qty_owned: 3, qty_wanted: 0 }]);
});

test('the row IS removed once both quantities reach zero', async () => {
  seed('001', 0, 1);
  await setWantedForItem('c1', { set: '001', foil: false }, 0);
  assert.deepEqual(ledger(), [], 'no 0/0 tombstone is left behind');
});

/* ---------------- writing over a legacy row ---------------- */

test('editing a want on a per-set row updates it rather than duplicating it', async () => {
  // Looking only for one spelling of the key would create a second row meaning the same
  // collector item, and the two would drift apart. Uncategorised rows are no longer reachable
  // from these writers at all - only triage may resolve those.
  seed('001', 2, 1);
  await setWantedForItem('c1', { set: '001', foil: false }, 5);
  assert.deepEqual(ledger(), [{ variant_slug: '001', qty_owned: 2, qty_wanted: 5 }],
    'one row, owned copies preserved');
});

/* ---------------- stepping and atomic adds ---------------- */

test('stepping floors at zero rather than going negative', async () => {
  await setWantedForItem('c1', { set: '001', foil: false }, 1);
  await stepWantedForItem('c1', { set: '001', foil: false }, -5);
  assert.deepEqual(ledger(), []);
});

test('stepping composes across separate collector items', async () => {
  await stepWantedForItem('c1', { set: '001', foil: false }, 2);
  await stepWantedForItem('c1', { set: '002', foil: false }, 3);
  await stepWantedForItem('c1', { set: '001', foil: false }, 1);
  assert.deepEqual(ledger(), [
    { variant_slug: '001', qty_owned: 0, qty_wanted: 3 },
    { variant_slug: '002', qty_owned: 0, qty_wanted: 3 },
  ]);
});

test('atomic adds accumulate without a read-modify-write', async () => {
  await Promise.all([
    addWantedForItem('c1', { set: '002', foil: false }, 1),
    addWantedForItem('c1', { set: '002', foil: false }, 1),
    addWantedForItem('c1', { set: '002', foil: false }, 1),
  ]);
  assert.deepEqual(ledger(), [{ variant_slug: '002', qty_owned: 0, qty_wanted: 3 }],
    'overlapping increments do not lose each other');
});

test('an atomic add never disturbs owned copies on the same row', async () => {
  seed('002', 4, 0);
  await addWantedForItem('c1', { set: '002', foil: false }, 2);
  assert.deepEqual(ledger(), [{ variant_slug: '002', qty_owned: 4, qty_wanted: 2 }]);
});

/* ---------------- reading back ---------------- */

test('wantedItemsForCard reports every collector item, in canonical terms', async () => {
  seed(LEGACY_UNCATEGORISED, 0, 1);
  await setWantedForItem('c1', { set: '002', foil: false }, 2);
  await setWantedForItem('c1', { set: '002', foil: true }, 3);
  const m = await wantedItemsForCard('c1');
  assert.equal(m.get(UNCATEGORISED), 1, 'a legacy row is reported under its canonical name');
  assert.equal(m.get('002'), 2);
  assert.equal(m.get('002:f'), 3);
});

test('card-level totals still sum across every collector item', async () => {
  // qtyFor is the existing card-level read; per-item wants must not break it.
  await setWantedForItem('c1', { set: '001', foil: false }, 1);
  await setWantedForItem('c1', { set: '002', foil: false }, 2);
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
  sdb.run("INSERT OR REPLACE INTO cards(card_id,name,sets,variants) VALUES('c1','Reprinted','[{\"code\":\"001\"},{\"code\":\"002\"}]','[{\"slug\":\"001-c1-s\",\"set\":\"001\",\"finish\":\"Standard\"},{\"slug\":\"001-c1-f\",\"set\":\"001\",\"finish\":\"Foil\"},{\"slug\":\"002-c1-s\",\"set\":\"002\",\"finish\":\"Standard\"},{\"slug\":\"002-c1-f\",\"set\":\"002\",\"finish\":\"Foil\"}]');");
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
  sdb.run("INSERT OR REPLACE INTO cards(card_id,name,sets,variants) VALUES('c3','Both','[{\"code\":\"001\"}]','[{\"slug\":\"001-c3-s\",\"set\":\"001\",\"finish\":\"Standard\"},{\"slug\":\"001-c3-f\",\"set\":\"001\",\"finish\":\"Foil\"}]');");
  await setWantedForItem('c3', { set: '001', foil: false }, 1);
  await setWantedForItem('c3', { set: '001', foil: true }, 1);
  const wl = (await wishlistCards()).filter((r) => r.card_id === 'c3');
  assert.equal(wl.length, 2);
  assert.deepEqual(wl.map((r) => r.foil).sort(), [false, true]);
});

/* ---------------- one chain per card, across BOTH surfaces ---------------- */

test('two concurrent increments through queueWantWrite finish at 3, not 2', async () => {
  // THE LOST UPDATE, driven through the PRODUCTION helper both surfaces call. An earlier version
  // of this test reproduced the key by hand with enqueueWrite(cardWantKey(...)), which proved
  // the queue works and nothing about the callers - the third time on this branch a test
  // asserted my assumption instead of the code. If a surface stopped calling queueWantWrite,
  // this must fail, so it uses queueWantWrite directly.
  const { __resetCollectionWritesForTests } = await import('./collectionWrites.js');
  __resetCollectionWritesForTests();
  sdb.run("INSERT OR REPLACE INTO cards(card_id,name,sets,variants) VALUES('cRace','Solo','[{\"code\":\"004\"}]','[{\"slug\":\"004-cRace-s\",\"set\":\"004\",\"finish\":\"Standard\"}]');");
  seed('004', 0, 1, 'cRace');

  await Promise.all([
    queueWantWrite(PID, 'cRace', (pid) => addWantedForItem('cRace', { set: '004', foil: false }, 1, pid)),
    queueWantWrite(PID, 'cRace', (pid) => stepWantedForItem('cRace', { set: '004', foil: false }, 1, pid)),
  ]);

  assert.deepEqual(ledger('cRace'), [{ variant_slug: '004', qty_owned: 0, qty_wanted: 3 }],
    'both increments landed');
});

test('a queued want write commits under the PROFILE it was bound to, not the active one', async () => {
  // The isolation hole Codex found: pid was captured in the key but the writer re-read
  // activeProfileId() when it ran. The tolerant profile-switch timeout lets the active profile
  // become B while an A-bound write is parked - so the write must carry A, not read the clock.
  const { __resetCollectionWritesForTests } = await import('./collectionWrites.js');
  const { __setActiveIdForTests } = await import('./profileRepository.js');
  __resetCollectionWritesForTests();
  sdb.run("INSERT OR IGNORE INTO profiles(id,name,schema_version,created_at) VALUES('A','A',11,'x');");
  sdb.run("INSERT OR IGNORE INTO profiles(id,name,schema_version,created_at) VALUES('B','B',11,'x');");
  sdb.run("INSERT OR REPLACE INTO cards(card_id,name,sets,variants) VALUES('cBind','Solo','[{\"code\":\"004\"}]','[{\"slug\":\"004-cBind-s\",\"set\":\"004\",\"finish\":\"Standard\"}]');");

  __setActiveIdForTests('A');
  const gate = (() => { let release; const p = new Promise((r) => { release = r; }); return { p, release }; })();
  // A-bound write that waits, then runs - the window a switch could redirect it.
  const write = queueWantWrite('A', 'cBind', async (pid) => {
    await gate.p;
    return setWantedForItem('cBind', { set: '004', foil: false }, 1, pid);
  });
  __setActiveIdForTests('B');   // active profile switches while the write is parked
  gate.release();
  await write;
  __setActiveIdForTests('A');

  const a = ledger('cBind', 'A');
  const b = ledger('cBind', 'B');
  assert.deepEqual(a, [{ variant_slug: '004', qty_owned: 0, qty_wanted: 1 }], 'the edit landed in A');
  assert.deepEqual(b, [], 'nothing leaked into B');
});

test('COUNTERFACTUAL: bypassing the shared chain loses one of them', async () => {
  // Without this the test above proves only that two awaited calls work. Running the same pair
  // UNQUEUED must corrupt, or the chain is decoration.
  const { __resetCollectionWritesForTests } = await import('./collectionWrites.js');
  __resetCollectionWritesForTests();
  sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards;');
  seed('004', 0, 1, 'cRace');

  // stepWantedForItem reads, then writes an absolute. Interleaving an atomic add between its
  // read and its write is exactly what the queue prevents.
  const stepped = stepWantedForItem('cRace', { set: '004', foil: false }, 1, PID);
  await addWantedForItem('cRace', { set: '004', foil: false }, 1, PID);
  await stepped;

  assert.equal(ledger('cRace')[0].qty_wanted, 2,
    'unqueued, the absolute write clobbers the atomic add - 3 increments became 2');
});

/* ---------------- wishlist export: the collector-item grammar ---------------- */

test('wishlistExportText emits N Card [Set] [Foil] so a wishlist round-trips through the importer', async () => {
  __setActiveIdForTests(PID);
  sdb.run("INSERT OR REPLACE INTO cards(card_id,name,variants,sets) VALUES('lw','Lone Wolves',?,?);",
    [JSON.stringify([{ slug: '001-x-b-s', set: '001', finish: 'Standard' }, { slug: '001-x-b-f', set: '001', finish: 'Foil' }]),
      JSON.stringify([{ code: '001', name: 'Alpha' }])]);
  await setWantedForItem('lw', { set: '001', foil: true }, 1);
  assert.equal(await wishlistExportText(), '1 Lone Wolves [Alpha] [Foil]');
});

test('wishlistExportText emits a bare line for an uncategorised want (no printing to name)', async () => {
  __setActiveIdForTests(PID);
  sdb.run("INSERT OR REPLACE INTO cards(card_id,name,variants,sets) VALUES('uu','Unknown One','[]','[]');");
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('wu',?,'uu','uncategorised',0,2,'','x','x');", [PID]);
  assert.equal(await wishlistExportText(), '2 Unknown One');
});
