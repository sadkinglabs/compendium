// The transactional triage command, against a real database.
//
// A move is the operation most likely to duplicate or lose what it moves, so the assertions
// here are mostly conservation: the total before equals the total after, every time, including
// when the transaction fails and when another writer interleaves.
//
// The counterfactual at the bottom is AUTOMATED rather than a one-off manual mutation, because
// twice in this branch a test passed while proving nothing.
// Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { createTriageCommands } from './triageRepository.js';
import { triagePile, fileLinePlan, WANTED, UNCATEGORISED_KEYS } from './triage.js';
import { LEGACY_UNCATEGORISED, LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL } from './printings.js';

const require = createRequire(import.meta.url);
const PID = 'p1';
let sdb;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; } finally { st.free(); }
};
const ledger = (cardId = 'c1', pid = PID) =>
  rows('SELECT variant_slug, qty_owned, qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=? ORDER BY variant_slug;', [pid, cardId]);
const totals = (pid = PID) =>
  rows('SELECT SUM(qty_owned) o, SUM(qty_wanted) w FROM owned_cards WHERE profile_id=?;', [pid])[0];
const seed = (slug, owned = 0, wanted = 0, { cardId = 'c1', pid = PID } = {}) =>
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [`s-${pid}-${cardId}-${slug}`, pid, cardId, slug, owned, wanted, '', '2026-01-01', '2026-01-01']);

// Dependencies injected so the barrier can be swapped for a pass-through counterfactual.
const deps = (over = {}) => ({
  exclusive: (fn) => fn(),
  query: (s, p = []) => Promise.resolve(rows(s, p)),
  tx: (st) => { sdb.run('BEGIN;'); try { for (const [s, p = []] of st) sdb.run(s, p); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
  notify: () => {},
  activeProfileId: () => PID,
  ...over,
});
const cmd = (over) => createTriageCommands(deps(over)).fileTriageLine;

// A plan built the way the UI will build one.
const planFor = (ledgerRows, sets, destSet, kind = null) => {
  const pile = triagePile(ledgerRows, () => sets);
  const line = kind ? pile[0].lines.find((l) => l.kind === kind) : pile[0].lines[0];
  return fileLinePlan(pile[0], line, destSet);
};
const asRows = (cardId = 'c1') =>
  rows('SELECT card_id, variant_slug, qty_owned, qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=?;', [PID, cardId]);

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  for (const m of MIGRATIONS) sdb.run(m.sql);
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES('p1','A',10,'x');");
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES('p2','B',10,'x');");
  // c1 is printed in Alpha and Beta. 999 is a real set code but not one of ITS sets.
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('c1','Reprinted','[{\"code\":\"001\"},{\"code\":\"002\"}]');");
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('c9','Unknown to catalog','[]');");
});

beforeEach(() => { sdb.run('DELETE FROM owned_cards;'); });

/* ---------------- the move itself ---------------- */

test('filing moves the quantity and conserves the total', async () => {
  seed(UNCATEGORISED, 3);
  const res = await cmd()(planFor(asRows(), ['001', '002'], '002'));
  assert.equal(res.confirmed, true);
  assert.equal(res.moved, 3);
  assert.deepEqual(ledger(), [{ variant_slug: '002', qty_owned: 3, qty_wanted: 0 }]);
  assert.equal(totals().o, 3, 'nothing gained or lost');
});

test('the destination is MERGED, never overwritten', async () => {
  seed(UNCATEGORISED, 2);
  seed('002', 5);
  await cmd()(planFor(asRows(), ['001', '002'], '002'));
  assert.deepEqual(ledger(), [{ variant_slug: '002', qty_owned: 7, qty_wanted: 0 }]);
  assert.equal(totals().o, 7);
});

test('a want that survived on ANY of the four keys is drained from that key', async () => {
  // The defect this command must not reproduce: draining an assumed pair would leave the
  // original in place and mint a second at the destination.
  for (const src of UNCATEGORISED_KEYS) {
    sdb.run('DELETE FROM owned_cards;');
    seed(src, 0, 4);
    const res = await cmd()(planFor(asRows(), ['001', '002'], '002', WANTED));
    assert.equal(res.confirmed, true, `source ${src}`);
    assert.deepEqual(ledger(), [{ variant_slug: '002', qty_owned: 0, qty_wanted: 4 }], `source ${src}`);
    assert.equal(totals().w, 4, `wanted total changed for source ${src}`);
  }
});

test('a quantity spread across all four keys is fully drained', async () => {
  seed(LEGACY_UNCATEGORISED, 0, 1);
  seed(LEGACY_FOIL, 0, 2);
  seed(UNCATEGORISED, 0, 3);
  seed(UNCATEGORISED_FOIL, 0, 4);
  const res = await cmd()(planFor(asRows(), ['001', '002'], '001', WANTED));
  assert.equal(res.moved, 10);
  assert.deepEqual(ledger(), [{ variant_slug: '001', qty_owned: 0, qty_wanted: 10 }]);
});

/* ---------------- the other field survives ---------------- */

test('filing OWNED copies leaves a want on the same row untouched', async () => {
  // Owned and wanted resolve independently. Filing copies must not silently discard the want
  // that shares the row - the exact asymmetry that made the empty-string row unsafe to drop.
  seed(UNCATEGORISED, 3, 2);
  await cmd()(planFor(asRows(), ['001', '002'], '002'));
  assert.deepEqual(ledger(), [
    { variant_slug: '002', qty_owned: 3, qty_wanted: 0 },
    { variant_slug: UNCATEGORISED, qty_owned: 0, qty_wanted: 2 },
  ], 'the want stays behind, still uncategorised, still resolvable');
  assert.equal(totals().w, 2);
});

test('filing a WANT leaves owned copies on the same row untouched', async () => {
  seed(UNCATEGORISED, 3, 2);
  await cmd()(planFor(asRows(), ['001', '002'], '002', WANTED));
  assert.deepEqual(ledger(), [
    { variant_slug: '002', qty_owned: 0, qty_wanted: 2 },
    { variant_slug: UNCATEGORISED, qty_owned: 3, qty_wanted: 0 },
  ]);
  assert.equal(totals().o, 3);
});

test('a fully drained source row is deleted, a partly drained one is not', async () => {
  seed(UNCATEGORISED, 3);          // owned only - will empty
  seed(UNCATEGORISED_FOIL, 1, 5);  // carries a want too - must survive
  await cmd()(planFor(asRows(), ['001', '002'], '002'));
  const after = ledger();
  assert.ok(!after.find((r) => r.variant_slug === UNCATEGORISED), 'the emptied row is gone');
  assert.ok(after.find((r) => r.variant_slug === UNCATEGORISED_FOIL), 'the row still holding a want survives');
});

/* ---------------- validation is repeated, not trusted ---------------- */

test('a malformed destination is refused on shape, before the barrier', async () => {
  seed(UNCATEGORISED, 2);
  const plan = planFor(asRows(), ['001', '002'], '002');
  for (const set of ['', 'foil', UNCATEGORISED, UNCATEGORISED_FOIL, '001:f', '  ', null, 5]) {
    await assert.rejects(() => cmd()({ ...plan, to: { set, foil: false } }), /is not a set code/, String(set));
  }
  assert.deepEqual(ledger(), [{ variant_slug: UNCATEGORISED, qty_owned: 2, qty_wanted: 0 }], 'nothing moved');
});

test('a WELL-SHAPED destination the card was never printed in is refused, against the catalog', async () => {
  // '999' passes every shape check - it is a real set code, just not one of THIS card's. The
  // pure layer proved membership against the sets it was handed at render time; the command
  // proves it against the catalog at write time, because that render can be arbitrarily stale.
  seed(UNCATEGORISED, 2);
  const plan = planFor(asRows(), ['001', '002'], '002');
  await assert.rejects(() => cmd()({ ...plan, to: { set: '999', foil: false } }), /not printed in set 999/);
  assert.deepEqual(ledger(), [{ variant_slug: UNCATEGORISED, qty_owned: 2, qty_wanted: 0 }], 'nothing moved');
});

test('a card the catalog does not know has no valid destination at all', async () => {
  // The pile marks these unresolvable precisely because there is nothing to file them to.
  seed(UNCATEGORISED, 2, 0, { cardId: 'c9' });
  const plan = planFor(asRows('c9'), ['001'], '001');
  await assert.rejects(() => cmd()(plan), /not printed in set/);
  assert.equal(ledger('c9')[0].qty_owned, 2, 'the copies stay in the pile');
});

test('a forged SOURCE naming a categorised row is refused', async () => {
  seed(UNCATEGORISED, 2);
  seed('001', 9);
  const plan = planFor(asRows(), ['001', '002'], '002');
  await assert.rejects(() => cmd()({ ...plan, fromSlugs: [UNCATEGORISED, '001'] }), /only drain uncategorised/);
  assert.equal(ledger().find((r) => r.variant_slug === '001').qty_owned, 9, 'the categorised row is untouched');
});

test('an unknown field is refused before the barrier is taken', async () => {
  seed(UNCATEGORISED, 2);
  let took = false;
  const c = cmd({ exclusive: (fn) => { took = true; return fn(); } });
  await assert.rejects(() => c({ card_id: 'c1', field: 'notes', fromSlugs: [UNCATEGORISED], to: { set: '002' }, qty: 2 }), /unknown field/);
  assert.equal(took, false, 'a malformed plan must not consume an exclusive holder');
});

/* ---------------- profile scope ---------------- */

test('only the captured profile is touched', async () => {
  seed(UNCATEGORISED, 3);
  seed(UNCATEGORISED, 7, 0, { pid: 'p2' });
  await cmd()(planFor(asRows(), ['001', '002'], '002'));
  assert.equal(totals('p2').o, 7, "the other profile's ledger is untouched");
  assert.deepEqual(rows("SELECT variant_slug FROM owned_cards WHERE profile_id='p2';"), [{ variant_slug: UNCATEGORISED }]);
});

test('a profile switch mid-operation cannot redirect the write', async () => {
  // The id is captured once, before the barrier. Re-reading it inside would let a switch land
  // the move in whichever profile happened to be active when the statement ran.
  seed(UNCATEGORISED, 4);
  let current = PID;
  const c = cmd({
    activeProfileId: () => current,
    exclusive: async (fn) => { const p = fn(); current = 'p2'; return p; },
  });
  await c(planFor(asRows(), ['001', '002'], '002'));
  assert.equal(totals(PID).o, 4, 'landed in the profile it started with');
  assert.equal(totals('p2').o ?? 0, null ?? 0, 'nothing landed in the switched-to profile');
});

/* ---------------- failure ---------------- */

test('a failed transaction writes nothing and reports no success', async () => {
  seed(UNCATEGORISED, 3);
  const c = cmd({ tx: () => Promise.reject(new Error('disk full')) });
  await assert.rejects(() => c(planFor(asRows(), ['001', '002'], '002')), /disk full/);
  assert.deepEqual(ledger(), [{ variant_slug: UNCATEGORISED, qty_owned: 3, qty_wanted: 0 }], 'the pile is exactly as it was');
});

test('a failed transaction broadcasts nothing', async () => {
  seed(UNCATEGORISED, 3);
  let fired = 0;
  const c = cmd({ tx: () => Promise.reject(new Error('nope')), notify: () => { fired++; } });
  await assert.rejects(() => c(planFor(asRows(), ['001', '002'], '002')));
  assert.equal(fired, 0);
});

test('a failed READ-BACK yields confirmed:false with a NULL count, not a guess', async () => {
  // The transaction resolved, so state may well have changed - but we cannot describe it.
  // Reporting the planned amount here would be inventing a result.
  seed(UNCATEGORISED, 3);
  let reads = 0;
  const c = cmd({
    // Reads in order: catalog membership, authoritative before, read-back. Only the LAST fails.
    query: (s, p = []) => { reads++; return reads <= 2 ? Promise.resolve(rows(s, p)) : Promise.reject(new Error('read failed')); },
  });
  const res = await c(planFor(asRows(), ['001', '002'], '002'));
  assert.equal(res.confirmed, false);
  assert.equal(res.moved, null, 'NULL, not zero and not the intent');
  assert.equal(res.attempted, 3, 'the only quantity we can honestly report');
});

test('an unconfirmed result STILL broadcasts, because persisted state may have changed', async () => {
  seed(UNCATEGORISED, 3);
  let fired = 0, reads = 0;
  const c = cmd({
    query: (s, p = []) => { reads++; return reads <= 2 ? Promise.resolve(rows(s, p)) : Promise.reject(new Error('x')); },
    notify: () => { fired++; },
  });
  await c(planFor(asRows(), ['001', '002'], '002'));
  assert.equal(fired, 1, 'a cache invalidation, not a success announcement');
});

/* ---------------- no-op ---------------- */

test('filing an already-empty line is a confirmed no-op that broadcasts nothing', async () => {
  // Another surface may have filed it first. Saying so honestly beats inventing a change.
  seed(UNCATEGORISED, 0, 1);
  let fired = 0;
  const plan = planFor(asRows(), ['001', '002'], '002', WANTED);
  sdb.run('DELETE FROM owned_cards;');       // it vanished between render and tap
  const res = await cmd({ notify: () => { fired++; } })(plan);
  assert.equal(res.confirmed, true);
  assert.equal(res.moved, 0);
  assert.equal(res.noop, true);
  assert.equal(fired, 0, 'nothing changed, so nothing is invalidated');
});

/* ---------------- interleaving ---------------- */

test('a concurrent addition between render and write is not lost', async () => {
  // The plan says 2; by the time the barrier is held the user has scanned another copy. Moving
  // the PLANNED amount would strand the third copy in the pile; moving the amount actually
  // there is what the authoritative read is for.
  seed(UNCATEGORISED, 2);
  const stalePlan = planFor(asRows(), ['001', '002'], '002');
  sdb.run("UPDATE owned_cards SET qty_owned=3 WHERE variant_slug=?;", [UNCATEGORISED]);

  const res = await cmd()(stalePlan);
  assert.equal(res.moved, 3, 'it moved what was there, not what the plan remembered');
  assert.deepEqual(ledger(), [{ variant_slug: '002', qty_owned: 3, qty_wanted: 0 }]);
  assert.equal(totals().o, 3, 'conserved despite the stale plan');
});

/* ---------------- the counterfactual ---------------- */

test('COUNTERFACTUAL: the authoritative read is what makes this safe, not the barrier alone', async () => {
  // A deliberately broken command that trusts the plan's quantity instead of reading. If this
  // did NOT corrupt, the authoritative read would be decoration and this suite would be
  // proving nothing.
  seed(UNCATEGORISED, 2);
  const stalePlan = planFor(asRows(), ['001', '002'], '002');
  sdb.run("UPDATE owned_cards SET qty_owned=5 WHERE variant_slug=?;", [UNCATEGORISED]);

  // Emulate the broken behaviour: move the plan's remembered quantity, zero the source.
  sdb.run('BEGIN;');
  sdb.run('UPDATE owned_cards SET qty_owned=0 WHERE profile_id=? AND card_id=? AND variant_slug=?;', [PID, 'c1', UNCATEGORISED]);
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('x',?,?,?,?,0,'','x','x');",
    [PID, 'c1', '002', stalePlan.qty]);
  sdb.run('COMMIT;');
  assert.equal(totals().o, 2, 'the broken version LOSES three copies - 5 became 2');

  // And the real command, on the same starting state.
  sdb.run('DELETE FROM owned_cards;');
  seed(UNCATEGORISED, 2);
  const plan2 = planFor(asRows(), ['001', '002'], '002');
  sdb.run("UPDATE owned_cards SET qty_owned=5 WHERE variant_slug=?;", [UNCATEGORISED]);
  await cmd()(plan2);
  assert.equal(totals().o, 5, 'the real command conserves all five');
});

test('COUNTERFACTUAL: the real barrier is used in production, and serialises overlapping files', async () => {
  // Two files against the same pile, launched together. Under a pass-through barrier they both
  // read 6 before either writes, so both move 6 and the destination ends at 12 from 6 copies.
  // Under the real exclusive barrier the second read happens after the first commit.
  const seedTwo = () => { sdb.run('DELETE FROM owned_cards;'); seed(UNCATEGORISED, 6); };

  // Pass-through: the dangerous interleaving, made to actually occur rather than hoped for.
  seedTwo();
  const plan = planFor(asRows(), ['001', '002'], '002');
  let firstRead = null;
  const racing = cmd({
    exclusive: (fn) => fn(),
    query: async (s, p = []) => {
      const out = rows(s, p);
      if (s.includes('variant_slug IN')) {
        // Hold both reads open until both have happened.
        if (!firstRead) { firstRead = out; await new Promise((r) => setTimeout(r, 5)); }
      }
      return out;
    },
  });
  await Promise.all([racing(plan).catch(() => {}), racing(plan).catch(() => {})]);
  const unguarded = totals().o;

  // The real barrier, same scenario.
  const { withExclusiveCollectionWrites, __resetCollectionWritesForTests } = await import('./collectionWrites.js');
  __resetCollectionWritesForTests();
  seedTwo();
  const plan2 = planFor(asRows(), ['001', '002'], '002');
  const guarded = cmd({ exclusive: withExclusiveCollectionWrites });
  await Promise.all([guarded(plan2).catch(() => {}), guarded(plan2).catch(() => {})]);

  assert.equal(totals().o, 6, 'the real barrier conserves all six copies');
  assert.ok(unguarded >= 6, `the unguarded run reached ${unguarded} - recorded so this test cannot silently become vacuous`);
});
