// The Storage pillar's reads and container lifecycle.
//
// The interesting case is DELETING a container, and it is interesting for a reason worth stating:
// copies cannot be nowhere, so a delete MOVES them to Unfiled rather than removing them. That move
// has to merge with whatever is already loose, because the unique index on
// (container_id, owned_card_id) forbids a card sitting in one place twice - and the row it would
// collide with is a row this very statement is moving. Get that wrong and either the delete fails
// outright or copies quietly double.
//
// Every test here asserts the equality afterwards, because the entire point of a container
// operation is that it changes WHERE copies are and never HOW MANY.
// Run: npm run test:query
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS } from './schema.js';
import { __setBackendForTests } from './db.js';
import { __setActiveIdForTests } from './profileRepository.js';
import { __resetCollectionWritesForTests } from './collectionWrites.js';
import {
  listContainers, containerContents, getContainer, createContainer, updateContainer,
  deleteContainer, unfiledId, MAX_CONTAINER_NAME, duplicateName, reorderContainers,
  itemStorage, setItemContainerQty, moveItemAllocation, bulkMoveAllocations, bulkFileFromUnfiled,
  cardStorageSummary, filedBySet, itemFiledAny,
} from './storageDirectory.js';
// The CONTENTS rows draw a card thumbnail, and these two are what the render site feeds with the
// row - so the read is only correct if they can resolve a printing's art from what it returns.
import { parsePrinting } from './printings.js';
import { printingArt } from './printingRows.js';

const require = createRequire(import.meta.url);
const PID = 'p1';
const UNFILED = 'u1';
let sdb;

const rows = (sql, params = []) => {
  const st = sdb.prepare(sql);
  try { if (params.length) st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); return r; } finally { st.free(); }
};
const broken = () => rows(`
  SELECT o.id, o.qty_owned, COALESCE((SELECT SUM(a.qty) FROM storage_allocations a WHERE a.owned_card_id=o.id),0) placed
    FROM owned_cards o WHERE o.profile_id=?;`, [PID])
  .filter((r) => Number(r.qty_owned) !== Number(r.placed))
  .map((r) => `${r.id}: owns ${r.qty_owned}, placed ${r.placed}`);
const at = (container, ownedId) => rows('SELECT qty FROM storage_allocations WHERE container_id=? AND owned_card_id=?;', [container, ownedId])[0]?.qty ?? null;

before(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  sdb = new SQL.Database();
  sdb.run('PRAGMA foreign_keys = ON;');
  __setBackendForTests({
    query: (s, p = []) => Promise.resolve(rows(s, p)),
    run: (s, p = []) => { sdb.run(s, p); return Promise.resolve(); },
    tx: (st) => { sdb.run('BEGIN;'); try { st.forEach(([s, p = []]) => sdb.run(s, p)); sdb.run('COMMIT;'); } catch (e) { sdb.run('ROLLBACK;'); throw e; } return Promise.resolve(); },
    exec: (s) => { sdb.run(s); return Promise.resolve(); },
    persist: () => Promise.resolve(),
  });
  for (const m of MIGRATIONS) sdb.run(m.sql);
  __setActiveIdForTests(PID);
});

beforeEach(() => {
  sdb.run('DELETE FROM storage_allocations; DELETE FROM storage_containers; DELETE FROM owned_cards; DELETE FROM profiles; DELETE FROM cards;');
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES(?,'Home',12,'T');", [PID]);
  sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at) VALUES(?,?,'unfiled','Unfiled','','gold',-1,1,'T','T');", [UNFILED, PID]);
  // Catalog rows carry the ART columns too, deliberately. A fixture with only name+sets cannot see a
  // read that fails to join what the list rows render - the same fixture blindness that cost this
  // feature increment 1. c1 has per-printing variant art in both finishes; c2 is a Site with none.
  sdb.run(`INSERT INTO cards(card_id,name,sets,is_site,image_slug,variants) VALUES('c1','Alpha Card','[{"code":"001"}]',0,'c1-default.webp',
    '[{"set":"001","finish":"Standard","image":"c1-001-s.webp"},{"set":"001","finish":"Foil","image":"c1-001-f.webp"}]');`);
  sdb.run(`INSERT INTO cards(card_id,name,sets,is_site,image_slug,variants) VALUES('c2','Beta Card','[{"code":"002"}]',1,'c2-default.webp','[]');`);
  __resetCollectionWritesForTests();
});

/** An owned row with its copies split between Unfiled and one named container. */
const seed = (id, cardId, slug, owned, { into = null, filed = 0 } = {}) => {
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,0,'','T','T');", [id, PID, cardId, slug, owned]);
  if (into && filed > 0) sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,?,?,'T','T');", [`${id}-f`, PID, into, id, filed]);
  const loose = owned - filed;
  if (loose > 0) sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,?,?,'T','T');", [`${id}-u`, PID, UNFILED, id, loose]);
};

/* ---------------- reads ---------------- */

test('the container list counts ITEMS and COPIES separately, because they answer different questions', async () => {
  const b = await createContainer({ name: 'Trade Binder', kind: 'binder', colour: 'jade' });
  seed('o1', 'c1', '001', 4, { into: b, filed: 3 });
  seed('o2', 'c2', '002', 2, { into: b, filed: 2 });
  const list = await listContainers();
  const binder = list.find((c) => c.id === b);
  assert.equal(binder.cards, 2, 'two different cards');
  assert.equal(binder.copies, 5, 'five sleeves used');
  assert.equal(list.find((c) => c.is_system).copies, 1, 'the one loose copy');
});

/* ---------------- the grid's filed-copies map ---------------- */
//
// It feeds the tile stepper's refusal prediction, so the only thing that makes it useful is that its
// key names the SAME collector item the step writes to. Every case below is about that.

test('filedBySet counts only what is in a NAMED place, keyed like ownedBySet', async () => {
  const binder = await createContainer({ name: 'Beta Binder', kind: 'binder' });
  seed('o1', 'c1', '001', 4, { into: binder, filed: 3 });
  seed('o2', 'c2', '002', 2);                       // entirely unfiled
  const m = await filedBySet();
  assert.deepEqual(m.get('c1|001'), { owned: 3, foil: 0 }, 'the three in the binder, not the loose one');
  assert.equal(m.get('c2|002'), undefined, 'a row with nothing filed is absent - the consumer reads that as zero');
});

test('filedBySet keeps the finishes apart, because they are separate owned rows', async () => {
  const binder = await createContainer({ name: 'Foils', kind: 'binder' });
  seed('o-std', 'c1', '001', 2, { into: binder, filed: 1 });
  seed('o-foil', 'c1', '001:f', 3, { into: binder, filed: 2 });
  assert.deepEqual((await filedBySet()).get('c1|001'), { owned: 1, foil: 2 },
    'one tile, two rows - a standard minus must not be predicted against the foil filing');
});

test('filedBySet sums a row filed across several places, and buckets a LEGACY key onto its tile', async () => {
  // printingSlugs discipline: a v10 row ('' / 'foil') and its canonical replacement are the same
  // collector item to every reader, so they must land on the same key the stepper builds - or the
  // prediction would describe a different row than the one the write lands on.
  const binder = await createContainer({ name: 'Binder', kind: 'binder' });
  const box = await createContainer({ name: 'Box', kind: 'box' });
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('o1',?,'c1','001',5,0,'','T','T');", [PID]);
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('a1',?,?,'o1',2,'T','T');", [PID, binder]);
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('a2',?,?,'o1',1,'T','T');", [PID, box]);
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('a3',?,?,'o1',2,'T','T');", [PID, UNFILED]);
  seed('o-legacy', 'c2', '', 2, { into: binder, filed: 2 });          // v10 uncategorised
  seed('o-canon', 'c2', 'uncategorised:f', 1, { into: box, filed: 1 });   // v11, foil
  const m = await filedBySet();
  assert.deepEqual(m.get('c1|001'), { owned: 3, foil: 0 }, 'two places summed, the loose copies excluded');
  assert.deepEqual(m.get('c2|'), { owned: 2, foil: 1 }, 'both schemas land on the Uncategorised tile');
});

test('filedBySet is scoped to the active profile', async () => {
  const binder = await createContainer({ name: 'Mine', kind: 'binder' });
  seed('o1', 'c1', '001', 2, { into: binder, filed: 2 });
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES('p2','Theirs',12,'T');");
  sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at) VALUES('p2b','p2','binder','Theirs','','gold',1,0,'T','T');");
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('p2o','p2','c1','001',9,0,'','T','T');");
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('p2a','p2','p2b','p2o',9,'T','T');");
  assert.deepEqual((await filedBySet()).get('c1|001'), { owned: 2, foil: 0 }, 'the other profile contributes nothing');
  assert.deepEqual((await filedBySet('p2')).get('c1|001'), { owned: 9, foil: 0 });
});

/* ---------------- the card sheet's filed mark ---------------- */
//
// One yes/no question about ONE (card, set), asked at a grain neither other read answers. The cases
// that matter are the ones where a cheaper implementation would lie: the finish the sheet is not
// showing, Unfiled, a drained allocation, and a legacy slug.

test('itemFiledAny is true when EITHER finish is filed - the sheet shows one finish at a time', async () => {
  const binder = await createContainer({ name: 'Foils', kind: 'binder' });
  seed('o-std', 'c1', '001', 2);                                   // standard, entirely unfiled
  seed('o-foil', 'c1', '001:f', 1, { into: binder, filed: 1 });
  assert.equal(await itemFiledAny('c1', '001'), true,
    'the foil is in a binder, so the collector item has filed copies whichever finish is on screen');
});

test('itemFiledAny is false for copies that are merely OWNED - Unfiled is not a filing', async () => {
  seed('o1', 'c1', '001', 3);
  assert.equal(await itemFiledAny('c1', '001'), false);
  assert.equal(await itemFiledAny('c1', '002'), false, 'a set the card has no copies in');
  assert.equal(await itemFiledAny('nope', '001'), false, 'an unknown card');
  assert.equal(await itemFiledAny('', '001'), false, 'no card at all is not a query');
});

test('itemFiledAny ignores a drained allocation - a zero-qty row is a place it is no longer in', async () => {
  const binder = await createContainer({ name: 'Binder', kind: 'binder' });
  seed('o1', 'c1', '001', 2, { into: binder, filed: 2 });
  assert.equal(await itemFiledAny('c1', '001'), true);
  await setItemContainerQty({ cardId: 'c1', variantSlug: '001', containerId: binder, qty: 0 });
  assert.equal(await itemFiledAny('c1', '001'), false, 'everything came back to Unfiled');
  assert.equal(rows('SELECT id FROM storage_allocations WHERE container_id=?;', [binder]).length, 0,
    'and the emptied allocation is deleted, not parked at zero - the schema CHECK forbids qty 0, '
    + 'which is why the read needs no zero-quantity guard of its own');
});

test('itemFiledAny resolves BOTH schemas of the Uncategorised bucket, and stays in the profile', async () => {
  const binder = await createContainer({ name: 'Binder', kind: 'binder' });
  seed('o-legacy', 'c2', '', 2, { into: binder, filed: 2 });        // v10 key, not yet canonicalised
  assert.equal(await itemFiledAny('c2', ''), true, 'a legacy slug is the same collector item');

  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES('p2','Theirs',12,'T');");
  sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at) VALUES('p2b','p2','binder','Theirs','','gold',1,0,'T','T');");
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('p2o','p2','c1','001',9,0,'','T','T');");
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('p2a','p2','p2b','p2o',9,'T','T');");
  assert.equal(await itemFiledAny('c1', '001'), false, 'another profile filing it does not mark it here');
  assert.equal(await itemFiledAny('c1', '001', 'p2'), true);
});

test('the card ledger files copies from Unfiled and returns them without changing ownership', async () => {
  const binder = await createContainer({ name: 'Beta Binder', kind: 'binder' });
  seed('o1', 'c1', '001', 4);

  await setItemContainerQty({ cardId: 'c1', variantSlug: '001', containerId: binder, qty: 3 });
  assert.equal(at(binder, 'o1'), 3);
  assert.equal(at(UNFILED, 'o1'), 1);
  assert.deepEqual(broken(), []);

  await setItemContainerQty({ cardId: 'c1', variantSlug: '001', containerId: binder, qty: 1 });
  assert.equal(at(binder, 'o1'), 1);
  assert.equal(at(UNFILED, 'o1'), 3);
  assert.equal(rows("SELECT qty_owned FROM owned_cards WHERE id='o1';")[0].qty_owned, 4);
  assert.deepEqual(broken(), []);
});

test('queued absolute ledger updates derive their delta from the latest committed allocation', async () => {
  const binder = await createContainer({ name: 'Beta Binder', kind: 'binder' });
  seed('o1', 'c1', '001', 4);

  await Promise.all([
    setItemContainerQty({ cardId: 'c1', variantSlug: '001', containerId: binder, qty: 1 }),
    setItemContainerQty({ cardId: 'c1', variantSlug: '001', containerId: binder, qty: 2 }),
  ]);

  assert.equal(at(binder, 'o1'), 2);
  assert.equal(at(UNFILED, 'o1'), 2);
  assert.deepEqual(broken(), []);
});

test('acceptance: four Beta copies file 1 to a binder, 2 to a deck and 1 to a box', async () => {
  const binder = await createContainer({ name: 'Beta Binder', kind: 'binder' });
  const deck = await createContainer({ name: 'Whatever Deck', kind: 'deck' });
  const box = await createContainer({ name: 'Storage Box', kind: 'box' });
  seed('o1', 'c1', '002', 4);

  await setItemContainerQty({ cardId: 'c1', variantSlug: '002', containerId: binder, qty: 1 });
  await setItemContainerQty({ cardId: 'c1', variantSlug: '002', containerId: deck, qty: 2 });
  await setItemContainerQty({ cardId: 'c1', variantSlug: '002', containerId: box, qty: 1 });

  assert.deepEqual((await itemStorage('c1', '002')).places.map((p) => [p.name, p.qty]), [
    ['Unfiled', 0], ['Beta Binder', 1], ['Whatever Deck', 2], ['Storage Box', 1],
  ]);
  assert.deepEqual(broken(), []);
});

test('the card ledger refuses to file more copies than Unfiled holds', async () => {
  const binder = await createContainer({ name: 'Beta Binder' });
  const box = await createContainer({ name: 'Archive Box', kind: 'box' });
  seed('o1', 'c1', '001', 4, { into: binder, filed: 3 });
  await assert.rejects(
    setItemContainerQty({ cardId: 'c1', variantSlug: '001', containerId: box, qty: 2 }),
    (e) => e?.name === 'StorageConflict' && e.detail.available === 1,
  );
  assert.equal(at(box, 'o1'), null);
  assert.deepEqual(broken(), []);
});

test('a foil printing files independently of its non-foil twin', async () => {
  // The write key is derived from parsePrinting(slug), so '001' and '001:f' must serialize and file
  // on their own rows. Coverage this feature has lacked and its history warns about.
  const binder = await createContainer({ name: 'Foils', kind: 'binder' });
  seed('o-std', 'c1', '001', 2);
  seed('o-foil', 'c1', '001:f', 3);
  await setItemContainerQty({ cardId: 'c1', variantSlug: '001:f', containerId: binder, qty: 2 });
  assert.equal(at(binder, 'o-foil'), 2, 'the foil copies filed');
  assert.equal(at(UNFILED, 'o-foil'), 1);
  assert.equal(at(binder, 'o-std'), null, 'the non-foil twin was not touched');
  assert.equal(at(UNFILED, 'o-std'), 2);
  // ...and the reverse: filing the non-foil leaves the foil filing intact.
  await setItemContainerQty({ cardId: 'c1', variantSlug: '001', containerId: binder, qty: 1 });
  assert.equal(at(binder, 'o-std'), 1);
  assert.equal(at(binder, 'o-foil'), 2, 'still 2 foils, uncrossed');
  assert.deepEqual(broken(), []);
});

test('an uncategorised collector item files from the card ledger', async () => {
  const binder = await createContainer({ name: 'To Sort', kind: 'box' });
  seed('o1', 'c1', 'uncategorised', 2);
  await setItemContainerQty({ cardId: 'c1', variantSlug: 'uncategorised', containerId: binder, qty: 1 });
  assert.equal(at(binder, 'o1'), 1);
  assert.equal(at(UNFILED, 'o1'), 1);
  assert.deepEqual(broken(), []);
});

test('M1: a legacy v10 uncategorised row resolves under the canonical slug and files (backstop keys on the real row)', async () => {
  // The card sheet passes canonicalPrinting(...) = 'uncategorised'; a row still on the v10 empty key
  // must resolve, file, and have its equality asserted on the row that actually holds the copies -
  // not vacuously on a non-existent canonical row.
  const binder = await createContainer({ name: 'Legacy Sort', kind: 'box' });
  seed('o1', 'c1', '', 2);
  const view = await itemStorage('c1', 'uncategorised');
  assert.equal(view.ownedId, 'o1', 'the legacy row resolved');
  assert.equal(view.ownedSlug, '', 'and its real slug is threaded downstream');
  await setItemContainerQty({ cardId: 'c1', variantSlug: 'uncategorised', containerId: binder, qty: 1 });
  assert.equal(at(binder, 'o1'), 1);
  assert.equal(at(UNFILED, 'o1'), 1);
  assert.deepEqual(broken(), []);
});

test('direct filing moves a chosen quantity between named places in one transaction', async () => {
  const binder = await createContainer({ name: 'Binder' });
  const box = await createContainer({ name: 'Box', kind: 'box' });
  seed('o1', 'c1', '001', 4, { into: binder, filed: 3 });
  await moveItemAllocation({ cardId: 'c1', variantSlug: '001', fromContainerId: binder, toContainerId: box, qty: 2 });
  assert.equal(at(binder, 'o1'), 1);
  assert.equal(at(box, 'o1'), 2);
  assert.equal(at(UNFILED, 'o1'), 1);
  assert.deepEqual(broken(), []);
});

test('bulk filing moves every selected source allocation and preserves unselected rows', async () => {
  const binder = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 4);
  seed('o2', 'c2', '002', 2);
  const res = await bulkMoveAllocations({ fromContainerId: UNFILED, toContainerId: binder, ownedCardIds: ['o1'] });
  assert.deepEqual(res, { items: 1, copies: 4, movedIds: ['o1'] },
    'movedIds names the rows that actually moved, read inside the lock - the only authority on which '
    + 'parts of a selection had anything to move');
  assert.equal(at(binder, 'o1'), 4);
  assert.equal(at(UNFILED, 'o1'), null);
  assert.equal(at(UNFILED, 'o2'), 2);
  assert.deepEqual(broken(), []);
});

test('bulk filing reports only the rows it MOVED, not the ones it was asked about', async () => {
  // A selected row with nothing in the source is not an error and not a move - it must not appear in
  // movedIds, or the caller's "how many of your picks had nothing to file" becomes a lie.
  const binder = await createContainer({ name: 'Binder' });
  const box = await createContainer({ name: 'Box', kind: 'box' });
  seed('o1', 'c1', '001', 2);                            // unfiled
  seed('o2', 'c2', '002', 2, { into: box, filed: 2 });   // nothing unfiled
  const res = await bulkMoveAllocations({ fromContainerId: UNFILED, toContainerId: binder, ownedCardIds: ['o1', 'o2'] });
  assert.deepEqual(res, { items: 1, copies: 2, movedIds: ['o1'] });
  assert.equal(at(box, 'o2'), 2, 'the row filed elsewhere was not raided');
  assert.deepEqual(broken(), []);
});

/* ---------------- the GRID-side bulk File: card+set selection -> unfiled copies ---------------- */

test('a grid selection files BOTH finishes of the picked printing, because a tile stands for both', async () => {
  // The grids select card + set; an allocation belongs to card + set + FINISH. Filing only the
  // standard row would move half of what the tile stands for and show the user no sign of it.
  const binder = await createContainer({ name: 'Beta Binder', kind: 'binder' });
  seed('o-std', 'c1', '001', 2);
  seed('o-foil', 'c1', '001:f', 3);
  const res = await bulkFileFromUnfiled({ items: [{ cardId: 'c1', set: '001' }], toContainerId: binder });
  assert.deepEqual(res, { items: 2, copies: 5, selected: 1, filed: 1 },
    'two collector items, five copies - but ONE card asked for and ONE card filed');
  assert.equal(at(binder, 'o-std'), 2);
  assert.equal(at(binder, 'o-foil'), 3);
  assert.equal(at(UNFILED, 'o-std'), null);
  assert.equal(at(UNFILED, 'o-foil'), null);
  assert.deepEqual(broken(), []);
});

test('a grid selection files only the UNFILED copies and leaves what is already filed where it is', async () => {
  const binder = await createContainer({ name: 'Binder' });
  const box = await createContainer({ name: 'Box', kind: 'box' });
  seed('o1', 'c1', '001', 5, { into: box, filed: 3 });   // 3 in the box, 2 loose
  await bulkFileFromUnfiled({ items: [{ cardId: 'c1', set: '001' }], toContainerId: binder });
  assert.equal(at(box, 'o1'), 3, 'the box keeps its copies - filing from the grid is not a round-up');
  assert.equal(at(binder, 'o1'), 2);
  assert.equal(at(UNFILED, 'o1'), null);
  assert.deepEqual(broken(), []);
});

test('cards with nothing unfiled DROP OUT, and the return says how many did', async () => {
  const binder = await createContainer({ name: 'Binder' });
  const box = await createContainer({ name: 'Box', kind: 'box' });
  seed('o1', 'c1', '001', 2);                            // loose - will file
  seed('o2', 'c2', '002', 3, { into: box, filed: 3 });   // fully filed elsewhere - nothing to take
  const res = await bulkFileFromUnfiled({
    items: [{ cardId: 'c1', set: '001' }, { cardId: 'c2', set: '002' }, { cardId: 'c2', set: '001' }],
    toContainerId: binder,
  });
  assert.deepEqual(res, { items: 1, copies: 2, selected: 3, filed: 1 },
    'three picked, one contributed - so two had nothing unfiled, including one that is not owned at all');
  assert.equal(at(binder, 'o1'), 2);
  assert.equal(at(box, 'o2'), 3);
  assert.deepEqual(broken(), []);
});

test('a selection whose every pick is already filed moves nothing and touches nothing', async () => {
  const binder = await createContainer({ name: 'Binder' });
  const box = await createContainer({ name: 'Box', kind: 'box' });
  seed('o1', 'c1', '001', 2, { into: box, filed: 2 });
  const before = rows('SELECT id, container_id, qty FROM storage_allocations ORDER BY id;');
  const res = await bulkFileFromUnfiled({ items: [{ cardId: 'c1', set: '001' }], toContainerId: binder });
  assert.deepEqual(res, { items: 0, copies: 0, selected: 1, filed: 0 });
  assert.deepEqual(rows('SELECT id, container_id, qty FROM storage_allocations ORDER BY id;'), before);
  assert.deepEqual(broken(), []);
});

test('legacy v10 rows file from the grid, in BOTH finishes, under the uncategorised bucket', async () => {
  // A half-converted ledger holds '' and 'foil' beside 'uncategorised' / 'uncategorised:f'. All four
  // are the same bucket to the grid, so an exact-slug read would file the migrated rows and silently
  // skip the rest - the resolution must name every slug the pair can be sitting on.
  const box = await createContainer({ name: 'To Sort', kind: 'box' });
  seed('o-legacy', 'c1', '', 2);
  seed('o-legacy-f', 'c1', 'foil', 1);
  seed('o-v11', 'c2', 'uncategorised', 3);
  seed('o-v11-f', 'c2', 'uncategorised:f', 1);
  const res = await bulkFileFromUnfiled({
    items: [{ cardId: 'c1', set: '' }, { cardId: 'c2', set: null }],   // null and '' are one bucket
    toContainerId: box,
  });
  assert.deepEqual(res, { items: 4, copies: 7, selected: 2, filed: 2 });
  assert.equal(at(box, 'o-legacy'), 2);
  assert.equal(at(box, 'o-legacy-f'), 1);
  assert.equal(at(box, 'o-v11'), 3);
  assert.equal(at(box, 'o-v11-f'), 1);
  assert.deepEqual(broken(), []);
});

test('resolution files the pairs PICKED, never the cross product of the cards and the sets', async () => {
  // `card_id IN (…) AND variant_slug IN (…)` matches printings nobody selected: pick Alpha of one
  // card and Beta of another, and the query also offers Beta of the first. Filing that would move
  // copies the user never chose, in a bulk action where they would not notice.
  const binder = await createContainer({ name: 'Binder' });
  seed('o1a', 'c1', '001', 2);   // picked
  seed('o1b', 'c1', '002', 5);   // NOT picked, but inside the cross product
  seed('o2', 'c2', '002', 3);    // picked
  const res = await bulkFileFromUnfiled({
    items: [{ cardId: 'c1', set: '001' }, { cardId: 'c2', set: '002' }],
    toContainerId: binder,
  });
  assert.deepEqual(res, { items: 2, copies: 5, selected: 2, filed: 2 });
  assert.equal(at(binder, 'o1a'), 2);
  assert.equal(at(binder, 'o2'), 3);
  assert.equal(at(binder, 'o1b'), null, 'the unpicked printing stayed put');
  assert.equal(at(UNFILED, 'o1b'), 5);
  assert.deepEqual(broken(), []);
});

test('duplicate picks are collapsed, so a repeated tile cannot inflate the reported total', async () => {
  const binder = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 2);
  const res = await bulkFileFromUnfiled({
    items: [{ cardId: 'c1', set: '001' }, { cardId: 'c1', set: '001' }, { cardId: null, set: '001' }],
    toContainerId: binder,
  });
  assert.deepEqual(res, { items: 1, copies: 2, selected: 1, filed: 1 });
  assert.deepEqual(broken(), []);
});

test('two spellings of the SAME tile are one pick, so neither invents a skipped card', async () => {
  // The bucket is not the key: '' is the UI's uncategorised bucket and 'uncategorised' is the row it
  // is stored under. Both name the same tile. Counting them as two picks that file one card would
  // report "1 card had nothing unfiled" about a card that has just been filed - a lie assembled out
  // of two spellings, which is exactly how this pair has gone wrong in this codebase before. So both
  // the pick and the moved row are reduced to a bucket by the same function.
  const box = await createContainer({ name: 'To Sort', kind: 'box' });
  seed('o1', 'c1', 'uncategorised', 2);
  const res = await bulkFileFromUnfiled({
    items: [{ cardId: 'c1', set: '' }, { cardId: 'c1', set: 'uncategorised' }],
    toContainerId: box,
  });
  assert.deepEqual(res, { items: 1, copies: 2, selected: 1, filed: 1 },
    'ONE tile asked for and ONE filed - not two asked for and one skipped');
  assert.equal(at(box, 'o1'), 2);
  assert.deepEqual(broken(), []);
});

test('a destination that no longer exists refuses the whole grid File rather than half-applying it', async () => {
  // The grid resolves owned rows OUTSIDE the lock; only the mover checks the containers, inside it.
  // So this proves the resolution layer surfaces that refusal rather than swallowing it into a
  // cheerful zero - a refused write must never paint as "nothing to file".
  const binder = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 2);
  seed('o2', 'c2', '002', 3);
  await deleteContainer(binder);
  await assert.rejects(
    bulkFileFromUnfiled({ items: [{ cardId: 'c1', set: '001' }, { cardId: 'c2', set: '002' }], toContainerId: binder }),
    { name: 'InvalidAllocation' },
  );
  assert.equal(at(UNFILED, 'o1'), 2, 'nothing moved');
  assert.equal(at(UNFILED, 'o2'), 3);
  assert.deepEqual(broken(), []);
});

test('an empty grid selection is a no-op, not a query and not a write', async () => {
  const binder = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 2);
  assert.deepEqual(await bulkFileFromUnfiled({ items: [], toContainerId: binder }),
    { items: 0, copies: 0, selected: 0, filed: 0 });
  assert.deepEqual(await bulkFileFromUnfiled({ items: [{ cardId: 'c1', set: '001' }], toContainerId: null }),
    { items: 0, copies: 0, selected: 1, filed: 0 });
  assert.equal(at(UNFILED, 'o1'), 2);
  assert.deepEqual(broken(), []);
});

test('the grid File keeps the equality it is not allowed to break, across finishes and places', async () => {
  // The invariant this whole feature rests on: a place is WHERE copies are, never HOW MANY. The move
  // asserts qty_owned = SUM(allocations) inside its own transaction; this proves the resolution layer
  // feeds it rows for which that still holds afterwards, over a mixed fixture.
  const binder = await createContainer({ name: 'Binder' });
  const box = await createContainer({ name: 'Box', kind: 'box' });
  seed('o1', 'c1', '001', 5, { into: box, filed: 1 });
  seed('o2', 'c1', '001:f', 2);
  seed('o3', 'c2', '002', 4, { into: box, filed: 4 });
  seed('o4', 'c2', 'uncategorised', 3);
  const ownedBefore = rows('SELECT id, qty_owned FROM owned_cards ORDER BY id;');
  await bulkFileFromUnfiled({
    items: [{ cardId: 'c1', set: '001' }, { cardId: 'c2', set: '002' }, { cardId: 'c2', set: '' }],
    toContainerId: binder,
  });
  assert.deepEqual(rows('SELECT id, qty_owned FROM owned_cards ORDER BY id;'), ownedBefore,
    'filing moved copies and changed nothing about what is owned');
  assert.deepEqual(broken(), []);
  assert.equal(at(binder, 'o1'), 4);
  assert.equal(at(binder, 'o2'), 2);
  assert.equal(at(binder, 'o4'), 3);
  assert.equal(at(box, 'o3'), 4, 'c2/002 had nothing unfiled, so its filed copies stayed');
  assert.equal(at(binder, 'o3'), null);
});

test('the grid File leaves another profile’s identical printing alone', async () => {
  // Isolation here is defended TWICE, and this asserts the outcome rather than either mechanism: the
  // resolution below is profile-scoped, and the mover's source read is scoped again to this profile's
  // Unfiled container. Deleting either scope alone still passes - said plainly so a later reader does
  // not mistake this for proof that the resolution query is the thing holding the line.
  const binder = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 2);
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES('p2','Other',12,'T');");
  sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at) VALUES('u2','p2','unfiled','Unfiled','','gold',-1,1,'T','T');");
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('o-other','p2','c1','001',9,0,'','T','T');");
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('a-other','p2','u2','o-other',9,'T','T');");
  const res = await bulkFileFromUnfiled({ items: [{ cardId: 'c1', set: '001' }], toContainerId: binder });
  assert.deepEqual(res, { items: 1, copies: 2, selected: 1, filed: 1 }, 'only this profile’s two copies');
  assert.equal(at('u2', 'o-other'), 9, 'the other profile’s copies stayed where they were');
  assert.equal(at(binder, 'o-other'), null, 'and none of them landed in this profile’s place');
});

test('item and Codex storage reads stay profile scoped and report physical quantities', async () => {
  const binder = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 4, { into: binder, filed: 3 });
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES('p2','Other',12,'T');");
  sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at) VALUES('u2','p2','unfiled','Unfiled','','gold',-1,1,'T','T');");
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('o-other','p2','c1','001',9,0,'','T','T');");
  sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES('a-other','p2','u2','o-other',9,'T','T');");
  const ledger = await itemStorage('c1', '001');
  assert.equal(ledger.total, 4);
  assert.deepEqual(ledger.places.map((p) => [p.name, p.qty]), [['Unfiled', 1], ['Binder', 3]]);
  assert.deepEqual((await cardStorageSummary('c1')).map((p) => [p.name, p.qty]), [['Unfiled', 1], ['Binder', 3]]);
});

test('Unfiled sorts first and an empty container still appears', async () => {
  await createContainer({ name: 'Zed Box', kind: 'box' });
  await createContainer({ name: 'Alpha Binder', kind: 'binder' });
  const list = await listContainers();
  assert.equal(list[0].name, 'Unfiled', 'the system place is always first');
  assert.deepEqual(list.slice(1).map((c) => c.name), ['Zed Box', 'Alpha Binder'],
    'then creation order, NOT alphabetical - a rename must not resequence the list under the user');
  assert.equal(list[1].copies, 0, 'an empty container is still a place that exists');
});

test('container contents report the quantity IN THIS PLACE, alongside the owned total', async () => {
  const b = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 5, { into: b, filed: 2 });
  const [row] = await containerContents(b);
  assert.equal(row.qty, 2, 'what is in the binder');
  assert.equal(row.qty_owned, 5, 'and what they own in total');
  assert.equal(row.name, 'Alpha Card', 'joined to the catalog so a row can render itself');
});

test('container contents carry the art fields, so a row can draw its OWN printing', async () => {
  // A place's rows show a card thumbnail, resolved at the render site from these columns. `variants`
  // is the one that earns its place: the row is a collector item, so a foil Alpha copy must wear the
  // Alpha foil face, not the card's default - otherwise the picture contradicts the set name printed
  // beside it. `is_site` only chooses the crop, and `elements` (already selected) feeds the
  // deterministic gradient when there is no art at all.
  const b = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001:f', 2, { into: b, filed: 2 });
  seed('o2', 'c2', '002', 1, { into: b, filed: 1 });
  const [alpha, beta] = await containerContents(b);
  assert.equal(alpha.image_slug, 'c1-default.webp', 'the card default rides along as the last resort');
  assert.equal(alpha.is_site, 0);
  const { set, foil } = parsePrinting(alpha.variant_slug);
  assert.equal(printingArt(alpha, set, foil), 'c1-001-f.webp', 'the row resolves ITS printing’s art');
  assert.equal(beta.is_site, 1, 'a Site is flagged, so the thumb rotates rather than zooms');
  assert.equal(printingArt(beta, '002', false), 'c2-default.webp', 'no variant art for the set - the default face');
});

/* ---------------- naming ---------------- */

test('a blank name is refused, and so is impersonating Unfiled', async () => {
  await assert.rejects(() => createContainer({ name: '   ' }), { name: 'InvalidContainer' });
  await assert.rejects(() => createContainer({ name: 'unfiled' }), { name: 'InvalidContainer' },
    'case-insensitively - two places called Unfiled is indistinguishable in every later surface');
});

test('Q9: a duplicate name is ALLOWED, and reported so a surface can warn', async () => {
  // "Must container names be unique? No, but warn on exact duplicate." Two binders really can both
  // be called Beta, and refusing puts a wall in front of a legitimate thing.
  const a = await createContainer({ name: 'Binder' });
  const b = await createContainer({ name: 'binder' });
  assert.notEqual(a, b, 'both exist');
  assert.equal(await duplicateName('BINDER'), true, 'case-insensitively, for the warning');
  assert.equal(await duplicateName('Binder', { selfId: a }), true, 'the OTHER one still collides');
  assert.equal(await duplicateName('Box'), false);
  await updateContainer(a, { name: 'Binder', colour: 'ruby' });
  assert.equal((await getContainer(a)).colour, 'ruby');
});

test('Q8: the kind changes after creation - cards move from a deck into a box', async () => {
  const a = await createContainer({ name: 'Shelf', kind: 'deck' });
  await updateContainer(a, { kind: 'box' });
  assert.equal((await getContainer(a)).kind, 'box');
  await assert.rejects(() => updateContainer(a, { kind: 'unfiled' }), { name: 'InvalidContainer' },
    'the system kind is still not a user choice');
});

test('Q12: the description line round-trips', async () => {
  const a = await createContainer({ name: 'Shelf', description: 'Top shelf, spare room' });
  assert.equal((await getContainer(a)).description, 'Top shelf, spare room');
  await updateContainer(a, { description: '' });
  assert.equal((await getContainer(a)).description, '');
});

/* ---------------- manual order (Q10) ---------------- */
//
// The gesture is long-press and drag (DESIGN_SYSTEM §Ordering, owner ruling 2026-08-20), so the
// write takes a WHOLE arrangement. The old one-step `moveContainer` swap went with the menu items
// it existed for. What these tests protect is the property the drag depends on: the order the user
// let go of is the order `listContainers` returns, for THIS profile, or nothing was written at all.

const userOrder = async (pid) => (await listContainers(pid)).filter((x) => !x.is_system).map((x) => x.name);

test('Q10: a dropped arrangement is what the list reads back, with Unfiled still pinned first', async () => {
  const a = await createContainer({ name: 'A' });
  const b = await createContainer({ name: 'B' });
  const c = await createContainer({ name: 'C' });
  assert.deepEqual(await userOrder(), ['A', 'B', 'C']);
  await reorderContainers([c, a, b]);
  assert.deepEqual(await userOrder(), ['C', 'A', 'B']);
  await reorderContainers([b, c, a]);
  assert.deepEqual(await userOrder(), ['B', 'C', 'A']);
  // Unfiled is not in the ordering and never becomes part of it - it stays at -1, ahead of the
  // 1-based positions the write assigns.
  const list = await listContainers();
  assert.equal(list[0].is_system, 1, 'still first');
  assert.equal(list[0].sort_order, -1);
  assert.deepEqual(list.filter((x) => !x.is_system).map((x) => x.sort_order), [1, 2, 3]);
});

test('reordering REPAIRS places that were created sharing a sort_order', async () => {
  // Two rows can carry the same order (an older build, an import). The one-step swap this replaces
  // needed a special case for that; a whole-order renumber simply fixes it.
  const a = await createContainer({ name: 'A' });
  const b = await createContainer({ name: 'B' });
  sdb.run('UPDATE storage_containers SET sort_order=5 WHERE is_system=0;');
  await reorderContainers([b, a]);
  assert.deepEqual(await userOrder(), ['B', 'A']);
  assert.deepEqual((await listContainers()).filter((x) => !x.is_system).map((x) => x.sort_order), [1, 2]);
});

test('the id set must match EXACTLY - a short, padded or duplicated order writes nothing', async () => {
  const a = await createContainer({ name: 'A' });
  const b = await createContainer({ name: 'B' });
  const c = await createContainer({ name: 'C' });
  const before = await userOrder();
  const refuses = async (ids, why) => {
    await assert.rejects(() => reorderContainers(ids), { name: 'InvalidContainer' }, why);
    assert.deepEqual(await userOrder(), before, 'and nothing partial was written');
  };
  await refuses([c, a], 'a filtered or stale list would silently demote the place it omitted');
  await refuses([c, a, b, 'ghost'], 'an id this profile does not own');
  await refuses([c, c, a], 'a duplicate cannot describe a position for every place');
  await refuses([], 'an empty order is not "leave it alone"');
  await refuses([c, a, b, b], 'right length by accident, wrong membership');
  // Unfiled is not the user's to place, so naming it is a mismatch rather than a special case.
  await refuses([await unfiledId(), a, b], 'the system place is not part of the user order');
});

test('reordering one profile leaves another profile’s order untouched', async () => {
  sdb.run("INSERT INTO profiles(id,name,schema_version,created_at) VALUES('p2','Theirs',12,'T');");
  sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at) VALUES('u2','p2','unfiled','Unfiled','','gold',-1,1,'T','T');");
  sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at) VALUES('t1','p2','binder','T1','','gold',1,0,'T','T');");
  sdb.run("INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at) VALUES('t2','p2','binder','T2','','gold',2,0,'T','T');");
  const a = await createContainer({ name: 'A' });
  const b = await createContainer({ name: 'B' });
  await reorderContainers([b, a]);
  assert.deepEqual(await userOrder(), ['B', 'A']);
  assert.deepEqual(await userOrder('p2'), ['T1', 'T2'], 'the other profile never moved');
  // And an id from the other profile cannot be smuggled in through the UI's ordering.
  await assert.rejects(() => reorderContainers([b, a, 't1']), { name: 'InvalidContainer' });
  assert.deepEqual(await userOrder('p2'), ['T1', 'T2']);
  // The other profile's own reorder is scoped to it and does not touch this one.
  await reorderContainers(['t2', 't1'], 'p2');
  assert.deepEqual(await userOrder('p2'), ['T2', 'T1']);
  assert.deepEqual(await userOrder(), ['B', 'A'], 'still ours');
});

test('names are trimmed and bounded; unknown kinds and colours are rejected outright', async () => {
  const id = await createContainer({ name: `  ${'x'.repeat(200)}  ` });
  assert.equal((await getContainer(id)).name.length, MAX_CONTAINER_NAME);
  await assert.rejects(() => createContainer({ name: 'A', kind: 'unfiled' }), { name: 'InvalidContainer' },
    'the system kind is not a user choice');
  await assert.rejects(() => createContainer({ name: 'B', colour: 'rgb(1,2,3)' }), { name: 'InvalidContainer' },
    'colour is written to the DB and ends up in a CSS custom property');
});

test('Unfiled cannot be renamed or deleted', async () => {
  const u = await unfiledId();
  await assert.rejects(() => updateContainer(u, { name: 'Loose' }), { name: 'InvalidContainer' });
  await assert.rejects(() => deleteContainer(u), { name: 'InvalidContainer' });
  assert.equal((await getContainer(u)).name, 'Unfiled');
});

/* ---------------- deletion: copies move, they never vanish ---------------- */

test('deleting a container moves its copies to Unfiled', async () => {
  const b = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 3, { into: b, filed: 3 });   // nothing loose
  await deleteContainer(b);
  assert.deepEqual(broken(), []);
  assert.equal(at(UNFILED, 'o1'), 3, 'the copies are loose now, not gone');
  assert.equal((await listContainers()).length, 1);
});

test('deleting MERGES with copies already loose, rather than colliding with them', async () => {
  // The unique index forbids one card in one place twice, and the row the move would collide with
  // is a row the same statement is moving. This is the case that breaks a naive re-parent.
  const b = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 5, { into: b, filed: 2 });   // 2 filed, 3 loose
  await deleteContainer(b);
  assert.deepEqual(broken(), []);
  assert.equal(at(UNFILED, 'o1'), 5, 'merged into one row of five');
  assert.equal(rows("SELECT id FROM storage_allocations WHERE owned_card_id='o1';").length, 1, 'one place, not two');
});

test('a mixed container - some cards loose, some not - merges only what needs it', async () => {
  const b = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 4, { into: b, filed: 1 });   // also loose
  seed('o2', 'c2', '002', 2, { into: b, filed: 2 });   // filed ONLY here
  await deleteContainer(b);
  assert.deepEqual(broken(), []);
  assert.equal(at(UNFILED, 'o1'), 4);
  assert.equal(at(UNFILED, 'o2'), 2, 'the wholesale re-parent picked up the un-merged one');
  assert.equal(rows('SELECT id FROM storage_allocations;').length, 2);
});

test('deleting an EMPTY container touches no allocation at all', async () => {
  const b = await createContainer({ name: 'Empty' });
  seed('o1', 'c1', '001', 2);
  const before = rows('SELECT id, container_id, qty FROM storage_allocations ORDER BY id;');
  await deleteContainer(b);
  assert.deepEqual(rows('SELECT id, container_id, qty FROM storage_allocations ORDER BY id;'), before);
  assert.deepEqual(broken(), []);
});

test('deleting one container leaves copies in the OTHER container alone', async () => {
  const a = await createContainer({ name: 'A' });
  const b = await createContainer({ name: 'B' });
  sdb.run("INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES('o1',?,'c1','001',6,0,'','T','T');", [PID]);
  for (const [cid, q, n] of [[a, 2, 'a'], [b, 3, 'b'], [UNFILED, 1, 'u']]) {
    sdb.run("INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at) VALUES(?,?,?,'o1',?,'T','T');", [`x-${n}`, PID, cid, q]);
  }
  await deleteContainer(a);
  assert.deepEqual(broken(), []);
  assert.equal(at(b, 'o1'), 3, 'B is untouched');
  assert.equal(at(UNFILED, 'o1'), 3, 'A’s two joined the one already loose');
});

test('deleting a container never changes what the user OWNS', async () => {
  const b = await createContainer({ name: 'Binder' });
  seed('o1', 'c1', '001', 5, { into: b, filed: 2 });
  seed('o2', 'c2', '002', 3, { into: b, filed: 3 });
  const ownedBefore = rows('SELECT id, qty_owned FROM owned_cards ORDER BY id;');
  await deleteContainer(b);
  assert.deepEqual(rows('SELECT id, qty_owned FROM owned_cards ORDER BY id;'), ownedBefore,
    'a container is where copies are, never how many there are');
  assert.deepEqual(broken(), []);
});
