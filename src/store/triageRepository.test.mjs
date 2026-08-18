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
// Seeds a row AS THE BACKFILL LEAVES IT. Filing is a KEY move - the allocations follow the copies -
// so a source row with copies and no places has nothing to follow, and the equality assertion
// inside the transaction refuses to commit a move that would strand them.
const seed = (slug, owned = 0, wanted = 0, { cardId = 'c1', pid = PID, container = null } = {}) => {
  const id = `s-${pid}-${cardId}-${slug}`;
  sdb.run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
    [id, pid, cardId, slug, owned, wanted, '', '2026-01-01', '2026-01-01']);
  if (owned > 0) sdb.run('INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,?,?,?,?);',
    [`a-${id}`, pid, container || ('u-' + pid), id, owned, '2026-01-01', '2026-01-01']);
};

// Raises a count the way a real writer does: the copies move WITH it. A hand-written count change
// that leaves the places behind models a state v12 cannot reach, and the equality assertion inside
// the transaction - correctly - refuses to commit on top of it.
const setOwnedWithPlaces = (slug, qty, pid = PID, cardId = 'c1') => {
  sdb.run('UPDATE owned_cards SET qty_owned=? WHERE profile_id=? AND card_id=? AND variant_slug=?;', [qty, pid, cardId, slug]);
  const id = `s-${pid}-${cardId}-${slug}`;
  sdb.run('DELETE FROM storage_allocations WHERE owned_card_id=?;', [id]);
  if (qty > 0) sdb.run('INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,?,?,?,?);',
    [`a-${id}`, pid, 'u-' + pid, id, qty, 'x', 'x']);
};

/** Every owned row whose copies are not exactly accounted for by its places. */
const brokenTriageRows = (pid = PID) => rows(`
  SELECT o.id, o.qty_owned,
         COALESCE((SELECT SUM(a.qty) FROM storage_allocations a WHERE a.owned_card_id = o.id), 0) placed
    FROM owned_cards o WHERE o.profile_id = ?;`, [pid])
  .filter((r) => Number(r.qty_owned) !== Number(r.placed))
  .map((r) => `${r.id}: owns ${r.qty_owned}, placed ${r.placed}`);

const runTx = (st) => { sdb.run('BEGIN;'); try { for (const [s, p = []] of st) sdb.run(s, p); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } };

// Dependencies injected so the barrier can be swapped for a pass-through counterfactual.
const deps = (over = {}) => ({
  exclusive: (fn) => fn(),
  query: (s, p = []) => Promise.resolve(rows(s, p)),
  tx: (st) => { runTx(st); return Promise.resolve(); },
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
  // v12: every profile has an Unfiled container, plus a binder to prove filing SURVIVES triage.
  for (const id of ['p1', 'p2']) {
    sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,colour,is_system,created_at,updated_at) VALUES(?,?,'unfiled','Unfiled','gold',1,'x','x');", ['u-' + id, id]);
    sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,colour,is_system,created_at,updated_at) VALUES(?,?,'binder','Binder','ruby',0,'x','x');", ['b-' + id, id]);
  }
  // c1 is printed in Alpha and Beta. 999 is a real set code but not one of ITS sets.
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('c1','Reprinted','[{\"code\":\"001\"},{\"code\":\"002\"}]');");
  sdb.run("INSERT INTO cards(card_id,name,sets) VALUES('c9','Unknown to catalog','[]');");
});

beforeEach(() => { sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards;'); });

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
    sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards;');
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
  // Targets the READ-BACK by POSITION IN THE SEQUENCE, not by call number. Counting reads encoded
  // an assumption about how many the command happens to make, and it now reads the source places
  // before it writes - so `reads > 2` silently became a pre-write read, and the test was asserting
  // the unconfirmed contract for a failure that happens before the transaction instead of after.
  let written = false;
  const c = cmd({
    query: (s, p = []) => (written ? Promise.reject(new Error('read failed')) : Promise.resolve(rows(s, p))),
    tx: (st) => { runTx(st); written = true; return Promise.resolve(); },
  });
  const res = await c(planFor(asRows(), ['001', '002'], '002'));
  assert.equal(res.confirmed, false);
  assert.equal(res.moved, null, 'NULL, not zero and not the intent');
  assert.equal('attempted' in res, false,
    'NO quantity is exposed when unconfirmed - an "attempted" count is a number a caller can mistake for a result');
  assert.deepEqual(Object.keys(res).sort(), ['confirmed', 'moved'], 'the result surface is structurally minimal');
});

test('an unconfirmed result STILL broadcasts, because persisted state may have changed', async () => {
  seed(UNCATEGORISED, 3);
  let fired = 0, written = false;
  const c = cmd({
    query: (s, p = []) => (written ? Promise.reject(new Error('x')) : Promise.resolve(rows(s, p))),
    tx: (st) => { runTx(st); written = true; return Promise.resolve(); },
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
  sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards;');       // it vanished between render and tap
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
  setOwnedWithPlaces(UNCATEGORISED, 3);

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
  setOwnedWithPlaces(UNCATEGORISED, 5);

  // Emulate the broken behaviour: move the plan's remembered quantity, zero the source.
  sdb.run('BEGIN;');
  sdb.run('UPDATE owned_cards SET qty_owned=0 WHERE profile_id=? AND card_id=? AND variant_slug=?;', [PID, 'c1', UNCATEGORISED]);
  sdb.run('DELETE FROM storage_allocations;');   // the broken version strands them; that is the point
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('x',?,?,?,?,0,'','x','x');",
    [PID, 'c1', '002', stalePlan.qty]);
  sdb.run('COMMIT;');
  assert.equal(totals().o, 2, 'the broken version LOSES three copies - 5 became 2');

  // And the real command, on the same starting state.
  sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards;');
  seed(UNCATEGORISED, 2);
  const plan2 = planFor(asRows(), ['001', '002'], '002');
  setOwnedWithPlaces(UNCATEGORISED, 5);
  await cmd()(plan2);
  assert.equal(totals().o, 5, 'the real command conserves all five');
});

test('COUNTERFACTUAL: a pass-through barrier makes one file FAIL; the real barrier makes it a no-op', async () => {
  // A RENDEZVOUS, not a timeout. The previous version slept 5ms and then asserted
  // `unguarded >= 6` - which the CORRECT answer also satisfies, so it could pass without the
  // race ever occurring. A sensitivity test that passes when the thing it tests has vanished
  // is worse than no test: it reports safety it never measured.
  //
  // WHAT THIS ARM USED TO ASSERT, and why it changed. It asserted that an unbarriered race
  // corrupts six copies into twelve. Under v12 it no longer can: the second file re-parents
  // source places that the first one already moved, finds none, and its own equality assertion
  // - inside its transaction - refuses the commit. The copies cannot double because the ledger
  // will not let them. So the corruption became a LOUD FAILURE, and this test now asserts that
  // instead. It is a stronger outcome, but it is a different one, and rewriting the assertion
  // to match reality is only honest if the test still distinguishes the two arms - which it
  // does: unguarded, exactly one of the two files is refused; guarded, NEITHER is.
  const rendezvous = (n) => {
    let arrived = 0, release;
    const all = new Promise((r) => { release = r; });
    return async () => { if (++arrived >= n) release(); await all; };
  };

  const seedSix = () => { sdb.run('DELETE FROM storage_allocations; DELETE FROM owned_cards;'); seed(UNCATEGORISED, 6); };

  /* ---- pass-through barrier: both read 6 before either writes ---- */
  seedSix();
  const plan = planFor(asRows(), ['001', '002'], '002');
  const meet = rendezvous(2);
  const racing = cmd({
    exclusive: (fn) => fn(),
    query: async (sql, p = []) => {
      const out = rows(sql, p);
      // Hold on the authoritative ledger read - the one the barrier exists to serialise.
      if (sql.includes('variant_slug IN') && sql.includes('qty_owned')) await meet();
      return out;
    },
  });
  const outcomes = await Promise.allSettled([racing(plan), racing(plan)]);
  assert.equal(outcomes.filter((o) => o.status === 'rejected').length, 1,
    'both readers saw 6 and both tried to move 6; the ledger refused the second rather than doubling the copies');
  assert.equal(totals().o, 6, 'six copies stayed six - the refusal is what kept them');
  assert.deepEqual(brokenTriageRows(), [], 'and the refused write left nothing half-applied');

  /* ---- the real barrier: the second read happens after the first commit ---- */
  const { withExclusiveCollectionWrites, __resetCollectionWritesForTests } = await import('./collectionWrites.js');
  __resetCollectionWritesForTests();
  seedSix();
  const plan2 = planFor(asRows(), ['001', '002'], '002');
  const guarded = cmd({ exclusive: withExclusiveCollectionWrites });
  const guardedOutcomes = await Promise.allSettled([guarded(plan2), guarded(plan2)]);
  assert.equal(guardedOutcomes.filter((o) => o.status === 'rejected').length, 0,
    'with the barrier neither file fails - serialising them is what turns the second into a no-op');

  assert.equal(totals().o, 6, 'exactly six - the second file found the pile already drained and was a no-op');
  assert.deepEqual(brokenTriageRows(), []);
  assert.deepEqual(ledger(), [{ variant_slug: '002', qty_owned: 6, qty_wanted: 0 }]);
});

/* ---------------- finish is enforced by the command, not by the plan ---------------- */

test('foil ownership cannot be filed into a NON-foil destination', async () => {
  // A stale or forged plan asking for it would silently change what the user owns. The command
  // derives its sources from the line's own finish, so a non-foil file simply never looks at
  // the foil rows.
  seed(UNCATEGORISED_FOIL, 3);
  const plan = planFor(asRows(), ['001', '002'], '002');   // an OWNED_FOIL line
  // Refused outright rather than quietly moving nothing: the plan names a foil source while
  // asking for a non-foil destination, and that contradiction is a bug worth surfacing.
  await assert.rejects(() => cmd()({ ...plan, to: { set: '002', foil: false } }), /does not belong to a non-foil/);
  assert.deepEqual(ledger(), [{ variant_slug: UNCATEGORISED_FOIL, qty_owned: 3, qty_wanted: 0 }],
    'the foil copies stayed foil, and stayed in the pile');
});

test('non-foil ownership cannot be filed into a FOIL destination', async () => {
  seed(UNCATEGORISED, 3);
  const plan = planFor(asRows(), ['001', '002'], '002');
  await assert.rejects(() => cmd()({ ...plan, to: { set: '002', foil: true } }), /does not belong to a foil/);
  assert.deepEqual(ledger(), [{ variant_slug: UNCATEGORISED, qty_owned: 3, qty_wanted: 0 }]);
});

test('a want can never be filed as foil', async () => {
  seed(UNCATEGORISED, 0, 4);
  const plan = planFor(asRows(), ['001', '002'], '002', WANTED);
  await assert.rejects(() => cmd()({ ...plan, to: { set: '002', foil: true } }), /wants are non-foil/);
  assert.equal(ledger()[0].qty_wanted, 4, 'the want is untouched');
});

test('to.foil must be a real boolean - "false" does not become true', async () => {
  // `!!"false"` is true. Coercion here would flip a non-foil destination to foil.
  seed(UNCATEGORISED, 2);
  const plan = planFor(asRows(), ['001', '002'], '002');
  for (const bad of ['false', 'true', 1, 0, null, undefined, {}]) {
    await assert.rejects(() => cmd()({ ...plan, to: { set: '002', foil: bad } }), /must be a boolean/, String(bad));
  }
  assert.deepEqual(ledger(), [{ variant_slug: UNCATEGORISED, qty_owned: 2, qty_wanted: 0 }]);
});

test('a source that appeared AFTER the render is still drained', async () => {
  // fromSlugs is UI provenance. If it decided what gets drained, copies added between render
  // and tap would be stranded in the pile with no indication anything was left behind.
  seed(UNCATEGORISED, 2);
  const plan = planFor(asRows(), ['001', '002'], '002');
  assert.deepEqual(plan.fromSlugs, [UNCATEGORISED], 'the plan only knows about the canonical row');
  seed(LEGACY_UNCATEGORISED, 5);                       // a legacy row appears afterwards

  const res = await cmd()(plan);
  assert.equal(res.moved, 7, 'both rows drained, not just the one the plan remembered');
  assert.deepEqual(ledger(), [{ variant_slug: '002', qty_owned: 7, qty_wanted: 0 }]);
});

test('a plan naming a source of the WRONG finish is refused outright', async () => {
  seed(UNCATEGORISED, 2);
  const plan = planFor(asRows(), ['001', '002'], '002');
  await assert.rejects(
    () => cmd()({ ...plan, fromSlugs: [UNCATEGORISED_FOIL] }),
    /does not belong to a non-foil/,
  );
});
