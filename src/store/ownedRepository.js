// Collection pillar data layer - the ownership LEDGER (owned_cards) + the two list
// kinds (card_lists / card_list_entries), plus every consumer of the pure
// compareEngine (deck buildability, wanted-list progress). Named ownedRepository
// (NOT "collection*") because the word is already taken by a deck zone and the
// Codex Marginalia tables. All writes are profile-scoped and route through a small
// revision counter so derived views (deck strips, list bars) refresh live.
//
// v1 scope note: printings/foil have NO catalog data (cards.variants ships []), so
// every write uses variant_slug=''. The column stays for forward-readiness; there
// is intentionally no printing UI. Buildability aggregates by card_id regardless.
import { query, run, tx } from './db.js';
import { activeProfileId } from './profileRepository.js';
import { uuid, nowIso } from './ids.js';
import { compareRequirements } from './compareEngine.js';
import { deckRequirements, deckRequirementsBulk } from './deckRepository.js';

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

// Map<card_id, {owned, wanted}> for decorating a search pool in one query.
export async function ownWantMap() {
  const pid = activeProfileId();
  const rows = await query('SELECT card_id, SUM(qty_owned) o, SUM(qty_wanted) w FROM owned_cards WHERE profile_id=? GROUP BY card_id;', [pid]);
  return new Map(rows.map((r) => [r.card_id, { owned: r.o || 0, wanted: r.w || 0 }]));
}

export async function qtyFor(cardId) {
  const pid = activeProfileId();
  const r = (await query('SELECT SUM(qty_owned) o, SUM(qty_wanted) w FROM owned_cards WHERE profile_id=? AND card_id=?;', [pid, cardId]))[0];
  return { owned: r?.o || 0, wanted: r?.w || 0 };
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
export async function setListKind(listId, kind) {
  const pid = activeProfileId();
  await run('UPDATE card_lists SET kind=?, updated_at=? WHERE id=? AND profile_id=?;', [kind === 'wanted' ? 'wanted' : 'custom', nowIso(), listId, pid]);
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
    `SELECT e.card_id, e.quantity, c.name, c.type, c.cost, c.attack, c.defence, c.elements, c.thresholds, c.image_slug, c.is_site, c.rarity, c.rules_text
     FROM card_list_entries e JOIN cards c ON c.card_id=e.card_id WHERE e.list_id=? ORDER BY c.name;`,
    [listId]
  );
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
  const owned = await ownedMap();
  const out = new Map();
  for (const id of listIds) {
    const required = await listRequirements(id);
    out.set(id, compareRequirements(required, owned, 0));
  }
  return out;
}

/* ---------------- dashboard stats ---------------- */

export async function collectionStats() {
  const pid = activeProfileId();
  const own = (await query('SELECT COALESCE(SUM(qty_owned),0) total, COUNT(DISTINCT CASE WHEN qty_owned>0 THEN card_id END) unique_cards, COALESCE(SUM(qty_wanted),0) wishlist FROM owned_cards WHERE profile_id=?;', [pid]))[0];
  const lists = await query('SELECT kind, COUNT(*) n FROM card_lists WHERE profile_id=? GROUP BY kind;', [pid]);
  const byKind = new Map(lists.map((l) => [l.kind, l.n]));
  return {
    owned: own?.total || 0,
    unique: own?.unique_cards || 0,
    wishlist: own?.wishlist || 0,
    wantedLists: byKind.get('wanted') || 0,
    customLists: byKind.get('custom') || 0,
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
export async function recentlyAdded(limit = 8) {
  const pid = activeProfileId();
  return query(
    `SELECT o.card_id, o.qty_owned, o.qty_wanted, c.name, c.type, c.cost, c.elements, c.thresholds, c.image_slug, c.is_site, c.rarity
     FROM owned_cards o JOIN cards c ON c.card_id=o.card_id
     WHERE o.profile_id=? AND o.qty_owned>0 ORDER BY o.updated_at DESC LIMIT ?;`,
    [pid, limit]
  );
}
