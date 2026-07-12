// Collection pillar data layer - the ownership LEDGER (owned_cards) + the two list
// kinds (card_lists / card_list_entries), plus every consumer of the pure
// compareEngine (deck buildability, wanted-list progress). Named ownedRepository
// (NOT "collection*") because the word is already taken by a deck zone and the
// Codex Marginalia tables. All writes are profile-scoped and route through a small
// revision counter so derived views (deck strips, list bars) refresh live.
//
// Variants: regular copies live on the variant_slug='' row, FOIL copies on the
// variant_slug='foil' row of the same card (foils are tracked as different copies,
// but a foil is still the card - every aggregate SUMs across variant rows, so
// stats/buildability/owned-filters count them together). The wishlist is
// variant-agnostic and lives on the '' row only.
import { query, run, tx } from './db.js';
import { activeProfileId } from './profileRepository.js';
import { uuid, nowIso } from './ids.js';
import { compareRequirements } from './compareEngine.js';
import { deckRequirements, deckRequirementsBulk, parseDeckText } from './deckRepository.js';

/* ---------------- freshness (in-memory revision) ---------------- */
let _rev = 0;
const _subs = new Set();
export function collectionRev() { return _rev; }
export function subscribeCollection(cb) { _subs.add(cb); return () => _subs.delete(cb); }
function bump() { _rev++; for (const cb of [..._subs]) { try { cb(_rev); } catch { /* ignore */ } } }

/* ---------------- ownership reads ---------------- */

// Map<card_id, totalOwned> - THE aggregation across printings, one indexed GROUP
// BY. Optionally narrowed to a set of card_ids. This is the only ownership read
// the engine ever needs; no caller aggregates itself.
export async function ownedMap(cardIds = null) {
  const pid = activeProfileId();
  let sql = 'SELECT card_id, SUM(qty_owned) t FROM owned_cards WHERE profile_id=?';
  const params = [pid];
  if (cardIds && cardIds.length) { sql += ` AND card_id IN (${cardIds.map(() => '?').join(',')})`; params.push(...cardIds); }
  sql += ' GROUP BY card_id HAVING t>0;';
  const rows = await query(sql, params);
  return new Map(rows.map((r) => [r.card_id, r.t]));
}

// Map<card_id, {owned, foil, wanted}> for decorating a search pool in one query.
// `owned` = REGULAR copies (the '' row); `foil` = the 'foil' row; total = owned+foil.
export async function ownWantMap() {
  const pid = activeProfileId();
  const rows = await query(
    `SELECT card_id,
            SUM(CASE WHEN variant_slug='foil' THEN 0 ELSE qty_owned END) o,
            SUM(CASE WHEN variant_slug='foil' THEN qty_owned ELSE 0 END) f,
            SUM(qty_wanted) w
     FROM owned_cards WHERE profile_id=? GROUP BY card_id;`, [pid]);
  return new Map(rows.map((r) => [r.card_id, { owned: r.o || 0, foil: r.f || 0, wanted: r.w || 0 }]));
}

// One card's ledger breakdown. `owned` = regular copies, `foil` = foil copies,
// `wanted` = wishlist (variant-agnostic). Same field names the write path takes.
export async function qtyFor(cardId) {
  const pid = activeProfileId();
  const r = (await query(
    `SELECT SUM(CASE WHEN variant_slug='foil' THEN 0 ELSE qty_owned END) o,
            SUM(CASE WHEN variant_slug='foil' THEN qty_owned ELSE 0 END) f,
            SUM(qty_wanted) w
     FROM owned_cards WHERE profile_id=? AND card_id=?;`, [pid, cardId]))[0];
  return { owned: r?.o || 0, foil: r?.f || 0, wanted: r?.w || 0 };
}

/* ---------------- ownership writes (upsert the '' row, delete at 0/0) ---------------- */

async function writeQty(cardId, { owned, wanted }) {
  const pid = activeProfileId();
  const now = nowIso();
  const cur = (await query('SELECT id, qty_owned, qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, '']))[0];
  const o = Math.max(0, owned != null ? owned : (cur?.qty_owned || 0));
  const w = Math.max(0, wanted != null ? wanted : (cur?.qty_wanted || 0));
  if (o === 0 && w === 0) {
    if (cur) await run('DELETE FROM owned_cards WHERE id=?;', [cur.id]);
  } else if (cur) {
    await run('UPDATE owned_cards SET qty_owned=?, qty_wanted=?, updated_at=? WHERE id=?;', [o, w, now, cur.id]);
  } else {
    await run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
      [uuid(), pid, cardId, '', o, w, '', now, now]);
  }
  bump();
}
export async function setOwned(cardId, qty) { return writeQty(cardId, { owned: qty }); }
export async function setWanted(cardId, qty) { return writeQty(cardId, { wanted: qty }); }
export async function stepOwned(cardId, delta) { const { owned } = await qtyFor(cardId); return setOwned(cardId, owned + delta); }
export async function stepWanted(cardId, delta) { const { wanted } = await qtyFor(cardId); return setWanted(cardId, wanted + delta); }

// Foil copies: the variant_slug='foil' row's qty_owned (wishlist never lives here).
// Same upsert/delete-at-0 shape as writeQty, on its own row.
export async function setFoil(cardId, qty) {
  const pid = activeProfileId();
  const now = nowIso();
  const q = Math.max(0, qty | 0);
  const cur = (await query('SELECT id FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, 'foil']))[0];
  if (q === 0) {
    if (cur) await run('DELETE FROM owned_cards WHERE id=?;', [cur.id]);
  } else if (cur) {
    await run('UPDATE owned_cards SET qty_owned=?, updated_at=? WHERE id=?;', [q, now, cur.id]);
  } else {
    await run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?);',
      [uuid(), pid, cardId, 'foil', q, '', now, now]);
  }
  bump();
}

/* ---------------- per-set ownership (My Collection) ----------------
   Alpha and Beta are physically distinct printings, so OWNED copies live on a
   per-set row: variant_slug = the numeric set code ("001" = Alpha regular,
   "001:f" = Alpha foil). The wishlist stays card-level on the '' row. Legacy
   card-level owned (scanner/import/old card sheet, written on '' / 'foil') has
   no set and surfaces under an "Unspecified" group ('' key) so nothing is lost.
   ownedMap() still SUMs every owned row, so deck buildability is unaffected. */
const SET_UNSPEC = '';   // group key for owned copies with no recorded set

function parseVslug(slug) {
  if (slug === 'foil') return { set: SET_UNSPEC, foil: true };   // legacy foil
  const foil = slug.endsWith(':f');
  return { set: foil ? slug.slice(0, -2) : slug, foil };          // '' stays unspecified
}
const vslug = (set, foil) => (foil ? set + ':f' : set);

// Map "cardId|set" -> { owned, foil } for the whole collection, grouped by printing.
export async function ownedBySet() {
  const pid = activeProfileId();
  const rows = await query('SELECT card_id, variant_slug, qty_owned FROM owned_cards WHERE profile_id=? AND qty_owned>0;', [pid]);
  const m = new Map();
  for (const r of rows) {
    const { set, foil } = parseVslug(r.variant_slug);
    const key = r.card_id + '|' + set;
    const cur = m.get(key) || { owned: 0, foil: 0 };
    cur[foil ? 'foil' : 'owned'] += r.qty_owned;
    m.set(key, cur);
  }
  return m;
}

// One (card, set) breakdown, for the optimistic-step re-read.
export async function qtyForInSet(cardId, set) {
  const pid = activeProfileId();
  const rows = await query('SELECT variant_slug, qty_owned FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug IN (?,?);', [pid, cardId, vslug(set, false), vslug(set, true)]);
  let owned = 0, foil = 0;
  for (const r of rows) { if (parseVslug(r.variant_slug).foil) foil += r.qty_owned; else owned += r.qty_owned; }
  return { owned, foil };
}

async function writeSetRow(cardId, set, foil, qty) {
  const pid = activeProfileId();
  const now = nowIso();
  const slug = vslug(set, foil);
  const q = Math.max(0, qty | 0);
  const cur = (await query('SELECT id FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, slug]))[0];
  if (q === 0) { if (cur) await run('DELETE FROM owned_cards WHERE id=?;', [cur.id]); }
  else if (cur) await run('UPDATE owned_cards SET qty_owned=?, updated_at=? WHERE id=?;', [q, now, cur.id]);
  else await run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?);', [uuid(), pid, cardId, slug, q, '', now, now]);
  bump();
}
export async function setOwnedInSet(cardId, set, qty) { return writeSetRow(cardId, set, false, qty); }
export async function setFoilInSet(cardId, set, qty) { return writeSetRow(cardId, set, true, qty); }

// Atomic +N to owned/wanted via a single upsert (no read-modify-write). For callers
// that can't serialize their writes - notably the scanner's rapid, independent
// scanAction events, where step*'s read-then-write would lose overlapping increments.
export async function addOwnedCopies(cardId, n = 1) { return addCopies(cardId, 'qty_owned', n); }
export async function addWantedCopies(cardId, n = 1) { return addCopies(cardId, 'qty_wanted', n); }
async function addCopies(cardId, col, n) {
  if (!cardId || !(n > 0)) return;
  const pid = activeProfileId();
  const now = nowIso();
  // col is an internal constant ('qty_owned' | 'qty_wanted'), never user input.
  await run(
    `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
     VALUES(?,?,?,?,?,?,'',?,?)
     ON CONFLICT(profile_id,card_id,variant_slug)
     DO UPDATE SET ${col}=${col}+excluded.${col}, updated_at=excluded.updated_at;`,
    [uuid(), pid, cardId, '', col === 'qty_owned' ? n : 0, col === 'qty_wanted' ? n : 0, now, now]
  );
  bump();
}

// Bulk text import: any "qty name" text (a deck export, a Curiosa list, a typed
// inventory) ADDS regular copies to the ledger. Reuses the deck text parser -
// zone headers are ignored (everything flattens into one add-list, the avatar
// line included; an avatar you own is a card you own). One tx, one bump.
// Returns { copies, names, unresolved }.
export async function importCollectionText(text) {
  const { avatar, zones } = parseDeckText(text);
  const lines = [...zones.spellbook, ...zones.atlas, ...zones.collection];
  if (avatar) lines.push({ name: avatar, qty: 1 });
  const pid = activeProfileId();
  const now = nowIso();
  const stmts = [];
  let unresolved = 0, copies = 0, names = 0;
  for (const { name, qty } of lines) {
    const n = Math.max(1, qty | 0);
    const c = (await query('SELECT card_id FROM cards WHERE lower(name)=? LIMIT 1;', [name.toLowerCase()]))[0];
    if (!c) { unresolved++; continue; }
    names++; copies += n;
    stmts.push([
      `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
       VALUES(?,?,?,?,?,0,'',?,?)
       ON CONFLICT(profile_id,card_id,variant_slug)
       DO UPDATE SET qty_owned=qty_owned+excluded.qty_owned, updated_at=excluded.updated_at;`,
      [uuid(), pid, c.card_id, '', n, now, now],
    ]);
  }
  if (stmts.length) await tx(stmts);
  bump();
  return { copies, names, unresolved };
}

// Add a shortfall to the general Wishlist. MAX (not +=) so re-running a deck's
// "add missing to wishlist" never inflates the want beyond the largest shortfall.
export async function addMissingToWishlist(lines) {
  const pid = activeProfileId();
  const now = nowIso();
  const stmts = [];
  for (const l of lines) {
    if (!l.card_id || !(l.missing > 0)) continue;
    stmts.push([
      `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
       VALUES(?,?,?,?,0,?,'',?,?)
       ON CONFLICT(profile_id,card_id,variant_slug)
       DO UPDATE SET qty_wanted=MAX(qty_wanted, excluded.qty_wanted), updated_at=excluded.updated_at;`,
      [uuid(), pid, l.card_id, '', l.missing, now, now],
    ]);
  }
  if (stmts.length) await tx(stmts);
  bump();
  return stmts.length;
}

/* ---------------- lists (one model, kind: 'wanted' | 'custom') ---------------- */

export async function listCardLists(kind = null) {
  const pid = activeProfileId();
  const rows = kind
    ? await query('SELECT * FROM card_lists WHERE profile_id=? AND kind=? ORDER BY sort_order ASC, name ASC;', [pid, kind])
    : await query('SELECT * FROM card_lists WHERE profile_id=? ORDER BY kind DESC, sort_order ASC, name ASC;', [pid]);
  if (!rows.length) return rows;
  const ids = rows.map((l) => l.id);
  const counts = await query(`SELECT list_id, COUNT(*) n FROM card_list_entries WHERE list_id IN (${ids.map(() => '?').join(',')}) GROUP BY list_id;`, ids);
  const byId = new Map(counts.map((c) => [c.list_id, c.n]));
  for (const l of rows) l.entryCount = byId.get(l.id) || 0;
  return rows;
}

export async function createList(kind, name, description = '') {
  const pid = activeProfileId();
  const id = uuid();
  const now = nowIso();
  await run('INSERT INTO card_lists(id,profile_id,kind,name,description,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?);',
    [id, pid, kind === 'wanted' ? 'wanted' : 'custom', name.trim() || 'Untitled', description || '', now, now]);
  bump();
  return id;
}
export async function renameList(listId, name, description) {
  const pid = activeProfileId();
  await run('UPDATE card_lists SET name=?, description=?, updated_at=? WHERE id=? AND profile_id=?;',
    [name.trim() || 'Untitled', description || '', nowIso(), listId, pid]);
  bump();
}
export async function deleteList(listId) {
  const pid = activeProfileId();
  await run('DELETE FROM card_lists WHERE id=? AND profile_id=?;', [listId, pid]);   // entries cascade
  bump();
}
export async function duplicateList(listId) {
  const pid = activeProfileId();
  const src = (await query('SELECT * FROM card_lists WHERE id=? AND profile_id=?;', [listId, pid]))[0];
  if (!src) return null;
  const nid = await createList(src.kind, `${src.name} (copy)`, src.description);
  const entries = await query('SELECT card_id, quantity, variant_slug FROM card_list_entries WHERE list_id=?;', [listId]);
  if (entries.length) {
    const now = nowIso();
    await tx(entries.map((e) => [
      'INSERT INTO card_list_entries(id,list_id,card_id,quantity,variant_slug,added_at) VALUES(?,?,?,?,?,?);',
      [uuid(), nid, e.card_id, e.quantity, e.variant_slug || '', now],
    ]));
  }
  bump();
  return nid;
}

export async function listEntries(listId) {
  return query('SELECT card_id, quantity FROM card_list_entries WHERE list_id=? ORDER BY added_at ASC;', [listId]);
}

// The first few cards' art per list, for the index's card-art "fan" (Map<listId,
// [{card_id, image_slug, is_site}]>, up to `perList`). One query for all lists,
// sliced in JS (the lists page has only a handful of lists).
export async function listThumbsBulk(listIds, perList = 3) {
  if (!listIds || !listIds.length) return new Map();
  const rows = await query(
    `SELECT e.list_id, c.card_id, c.image_slug, c.is_site
     FROM card_list_entries e JOIN cards c ON c.card_id=e.card_id
     WHERE e.list_id IN (${listIds.map(() => '?').join(',')})
     ORDER BY e.list_id, e.added_at ASC;`, listIds);
  const m = new Map();
  for (const r of rows) {
    const arr = m.get(r.list_id) || [];
    if (arr.length < perList) { arr.push(r); m.set(r.list_id, arr); }
  }
  return m;
}
// Set a card's quantity in a list (0 deletes). variant_slug='' in v1.
export async function setListEntry(listId, cardId, qty) {
  const q = Math.max(0, qty | 0);
  const cur = (await query('SELECT id FROM card_list_entries WHERE list_id=? AND card_id=? AND variant_slug=?;', [listId, cardId, '']))[0];
  if (q === 0) { if (cur) await run('DELETE FROM card_list_entries WHERE id=?;', [cur.id]); }
  else if (cur) await run('UPDATE card_list_entries SET quantity=? WHERE id=?;', [q, cur.id]);
  else await run('INSERT INTO card_list_entries(id,list_id,card_id,quantity,variant_slug,added_at) VALUES(?,?,?,?,?,?);', [uuid(), listId, cardId, q, '', nowIso()]);
  bump();
}
export async function stepListEntry(listId, cardId, delta) {
  const cur = (await query('SELECT quantity FROM card_list_entries WHERE list_id=? AND card_id=? AND variant_slug=?;', [listId, cardId, '']))[0];
  return setListEntry(listId, cardId, (cur?.quantity || 0) + delta);
}

// Card-level requirement of a list (mirrors deckRequirements shape).
async function listRequirements(listId) {
  const rows = await query('SELECT card_id, SUM(quantity) q FROM card_list_entries WHERE list_id=? GROUP BY card_id;', [listId]);
  return rows.map((r) => ({ card_id: r.card_id, qty: r.q }));
}

// A list's cards joined to the catalog (for the list detail view). quantity =
// target (wanted) or copies (custom).
export async function listCards(listId) {
  return query(
    `SELECT e.card_id, e.quantity, c.name, c.type, c.cost, c.attack, c.defence, c.elements, c.thresholds, c.image_slug, c.is_site, c.rarity, c.rules_text, c.sets
     FROM card_list_entries e JOIN cards c ON c.card_id=e.card_id WHERE e.list_id=? ORDER BY c.name;`,
    [listId]
  );
}

// The Wishlist: every card you want (qty_wanted>0), joined to the catalog, with
// its owned + wanted quantities. A virtual, un-deletable "list" backed by the
// ownership ledger (qty_wanted) rather than a card_lists row - so `quantity` here
// is the wanted goal, matching listCards' shape for a shared detail view.
export async function wishlistCards() {
  const pid = activeProfileId();
  return query(
    `SELECT o.card_id, SUM(o.qty_wanted) quantity, SUM(o.qty_owned) owned,
            c.name, c.type, c.cost, c.attack, c.defence, c.elements, c.thresholds, c.image_slug, c.is_site, c.rarity, c.rules_text, c.sets
     FROM owned_cards o JOIN cards c ON c.card_id=o.card_id
     WHERE o.profile_id=? GROUP BY o.card_id HAVING SUM(o.qty_wanted)>0 ORDER BY c.name;`,
    [pid]
  );
}

// Flat "qty name" text of a list - the Curiosa deck-export format, so it pastes
// straight into Curiosa, a deck's Import from text, or back into Collection's
// own bulk import.
export async function exportListText(listId) {
  const rows = await listCards(listId);
  return rows.map((r) => `${r.quantity} ${r.name}`).join('\n');
}

// Same flat export for the Wishlist (qty_wanted ledger) - take it to a shop.
export async function wishlistExportText() {
  const rows = await wishlistCards();
  return rows.map((r) => `${r.quantity} ${r.name}`).join('\n');
}

// Lists a card appears in (for card detail "Appears in").
export async function listsWithCard(cardId) {
  const pid = activeProfileId();
  return query(
    `SELECT l.id, l.name, l.kind, e.quantity FROM card_list_entries e JOIN card_lists l ON l.id=e.list_id
     WHERE e.card_id=? AND l.profile_id=? ORDER BY l.kind DESC, l.name ASC;`,
    [cardId, pid]
  );
}

/* ---------------- engine callers (the one primitive, everywhere) ---------------- */

export async function deckBuildability(deckId) {
  const { required, unresolved } = await deckRequirements(deckId);
  const owned = await ownedMap(required.map((r) => r.card_id));
  return compareRequirements(required, owned, unresolved);
}
// Deck library: all decks against ONE owned map (no N+1).
export async function deckBuildabilityBulk(deckIds) {
  const reqByDeck = await deckRequirementsBulk(deckIds);
  const owned = await ownedMap();   // full map once
  const out = new Map();
  for (const [id, { required, unresolved }] of reqByDeck) out.set(id, compareRequirements(required, owned, unresolved));
  return out;
}
export async function listProgress(listId) {
  const required = await listRequirements(listId);
  const owned = await ownedMap(required.map((r) => r.card_id));
  return compareRequirements(required, owned, 0);
}
export async function listProgressBulk(listIds) {
  const out = new Map();
  if (!listIds.length) return out;
  const owned = await ownedMap();   // full map once
  // One grouped query for all lists' requirements (no N+1, mirrors deckRequirementsBulk).
  const rows = await query(
    `SELECT list_id, card_id, SUM(quantity) q FROM card_list_entries
     WHERE list_id IN (${listIds.map(() => '?').join(',')}) GROUP BY list_id, card_id;`,
    listIds
  );
  const byList = new Map(listIds.map((id) => [id, []]));
  for (const r of rows) byList.get(r.list_id)?.push({ card_id: r.card_id, qty: r.q });
  for (const id of listIds) out.set(id, compareRequirements(byList.get(id), owned, 0));
  return out;
}

/* ---------------- dashboard stats ---------------- */

export async function collectionStats() {
  const pid = activeProfileId();
  const own = (await query('SELECT COALESCE(SUM(qty_owned),0) total, COUNT(DISTINCT CASE WHEN qty_owned>0 THEN card_id END) unique_cards, COALESCE(SUM(qty_wanted),0) wishlist FROM owned_cards WHERE profile_id=?;', [pid]))[0];
  return {
    owned: own?.total || 0,
    unique: own?.unique_cards || 0,
    wishlist: own?.wishlist || 0,
  };
}

// card_id -> name, for labelling engine output (missing lists) without the engine
// (which is pure) knowing about the catalog.
export async function cardNames(ids) {
  if (!ids || !ids.length) return new Map();
  const rows = await query(`SELECT card_id, name FROM cards WHERE card_id IN (${ids.map(() => '?').join(',')});`, ids);
  return new Map(rows.map((r) => [r.card_id, r.name]));
}

// Recently touched owned cards (for the Overview strip), joined to the catalog.
// Grouped by card so a card's regular + foil rows read as ONE entry, with the
// regular/foil split the binder row's pill rail renders (rules_text rides along
// for the playset check's any-number-of exemption).
export async function recentlyAdded(limit = 8) {
  const pid = activeProfileId();
  return query(
    `SELECT o.card_id,
            SUM(CASE WHEN o.variant_slug='foil' THEN 0 ELSE o.qty_owned END) qty_owned,
            SUM(CASE WHEN o.variant_slug='foil' THEN o.qty_owned ELSE 0 END) qty_foil,
            SUM(o.qty_wanted) qty_wanted,
            c.name, c.type, c.cost, c.elements, c.thresholds, c.image_slug, c.is_site, c.rarity, c.sets, c.rules_text
     FROM owned_cards o JOIN cards c ON c.card_id=o.card_id
     WHERE o.profile_id=?
     GROUP BY o.card_id HAVING SUM(o.qty_owned)>0
     ORDER BY MAX(o.updated_at) DESC LIMIT ?;`,
    [pid, limit]
  );
}
