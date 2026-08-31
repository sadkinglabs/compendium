// Deckbuilder data on the unified store: three zones
// (spellbook/atlas/collection), deck avatar, rarity copy-limits, stats, and the
// Curiosa/Markdown import-export remapped. All profile-scoped via activeProfileId().
import { query, run, tx } from './db.js';
import { getCatalog } from './catalogCache.js';
import { activeProfileId } from './profileRepository.js';
import { uuid, nowIso, slugify } from './ids.js';
import { RARITY_LIMITS, isUnlimited } from './playset.js';
import { computeCuriosaDiff, overLimitEntries } from './curiosaDiff.js';
import { applyMaybeboardBlock } from './maybeboardBlock.js';

export const ZONES = ['spellbook', 'atlas', 'collection'];
export { RARITY_LIMITS, isUnlimited };   // re-exported from the leaf playset module (unchanged public API)
export const EL_COLOR = { air: '#c4cdd6', earth: '#b35c33', fire: '#e0623f', water: '#4aa3d4' };   // app-wide: air grey, earth brown, fire red, water blue (mirrors tokens.css)

const jp = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

export function collectionMax(deck) {
  return deck?.avatar_card_id === 'dragonlord' ? 11 : 10;
}
export function copyLimit(card) {
  if (isUnlimited(card)) return 99;
  return RARITY_LIMITS[card?.rarity] ?? 4;
}
export function elementPips(thresholdsJson) {
  const th = jp(thresholdsJson, {});
  const out = [];
  for (const el of ['air', 'earth', 'fire', 'water']) if ((th[el] || 0) > 0) out.push({ el, c: EL_COLOR[el] });
  return out;
}

/** Avatar catalogue for the create-deck wizard - full fields for the preview
 *  panel (life/attack/type/rules), with an optional name filter. */
export async function listAvatarCards(q = '') {
  const rows = await query(
    'SELECT card_id, name, image_slug, elements, thresholds, life, attack, cost, type, sub_types, rarity, rules_text FROM cards WHERE is_avatar=1 ORDER BY name;'
  );
  const needle = q.trim().toLowerCase();
  const list = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  return list.map((c) => ({
    ...c,
    subTypes: jp(c.sub_types, []),
  }));
}

/* ---------------- deck CRUD ---------------- */

export async function listDecks() {
  const pid = activeProfileId();
  const decks = await query('SELECT * FROM decks WHERE profile_id=? ORDER BY starred DESC, lib_order ASC, name ASC;', [pid]);
  if (!decks.length) return decks;
  // Set-based enrichment: 3 fixed queries instead of ~3 per deck (was an N+1
  // fan-out on the search/Home/Decks hot paths). Zone counts + spellbook
  // thresholds + avatars are fetched in bulk and stitched in JS.
  const ids = decks.map((d) => d.id);
  const inClause = `(${ids.map(() => '?').join(',')})`;
  const [countRows, thRows, avatarRows] = await Promise.all([
    query(`SELECT deck_id, zone, SUM(quantity) n FROM deck_entries WHERE deck_id IN ${inClause} GROUP BY deck_id, zone;`, ids),
    query(`SELECT e.deck_id, c.thresholds FROM deck_entries e JOIN cards c ON c.card_id=e.card_id WHERE e.deck_id IN ${inClause} AND e.zone='spellbook';`, ids),
    (() => { const avIds = [...new Set(decks.map((d) => d.avatar_card_id).filter(Boolean))];
      return avIds.length ? query(`SELECT card_id, name, image_slug, elements, thresholds FROM cards WHERE card_id IN (${avIds.map(() => '?').join(',')});`, avIds) : Promise.resolve([]); })(),
  ]);
  const counts = {};                 // deckId → {spellbook,atlas,collection}
  for (const r of countRows) { (counts[r.deck_id] ||= { spellbook: 0, atlas: 0, collection: 0 })[r.zone] = r.n || 0; }
  const need = {};                   // deckId → {air,earth,fire,water} max threshold
  for (const r of thRows) { const th = jp(r.thresholds, {}); const m = (need[r.deck_id] ||= { air: 0, earth: 0, fire: 0, water: 0 }); for (const el of Object.keys(m)) m[el] = Math.max(m[el], th[el] || 0); }
  const avatars = {}; for (const a of avatarRows) avatars[a.card_id] = a;
  for (const d of decks) {
    const c = counts[d.id] || { spellbook: 0, atlas: 0, collection: 0 };
    d.spellbookCount = c.spellbook; d.atlasCount = c.atlas; d.collectionCount = c.collection;
    d.record = `${d.wins}–${d.losses}`;
    d.winPct = d.wins + d.losses > 0 ? Math.round((d.wins / (d.wins + d.losses)) * 100) : null;
    const n = need[d.id] || {};
    d.elems = Object.entries(n).filter(([, v]) => v > 0).map(([el]) => ({ el, c: EL_COLOR[el] }));
    d.avatar = d.avatar_card_id ? (avatars[d.avatar_card_id] || null) : null;
  }
  return decks;
}

export async function getDeck(id) {
  const pid = activeProfileId();
  const d = (await query('SELECT * FROM decks WHERE id=? AND profile_id=?;', [id, pid]))[0];
  if (!d) return null;
  d.avatar = d.avatar_card_id ? (await query('SELECT * FROM cards WHERE card_id=?;', [d.avatar_card_id]))[0] : null;
  d.elems = await deckElementPips(id);
  d.record = `${d.wins}–${d.losses}`;
  return d;
}

export async function createDeck(name, { archetype = '', avatarCardId = null } = {}) {
  const id = uuid();
  const ts = nowIso();
  const ord = ((await query('SELECT COALESCE(MAX(lib_order),0)+1 n FROM decks WHERE profile_id=?;', [activeProfileId()]))[0].n);
  await run(
    `INSERT INTO decks(id,profile_id,name,slug,archetype,avatar_card_id,wins,losses,starred,lib_order,created_at,updated_at)
     VALUES(?,?,?,?,?,?,0,0,0,?,?,?);`,
    [id, activeProfileId(), name, slugify(name), archetype, avatarCardId, ord, ts, ts]
  );
  return id;
}
export async function renameDeck(id, name) { await touch(id, 'name=?, slug=?', [name, slugify(name)]); await logHistory(id, `Renamed deck to ${name}`); }
export async function setCuriosaUrl(id, url) { await touch(id, 'curiosa_url=?', [url]); }
export async function setDeckNotes(id, notes) { await touch(id, 'notes=?', [notes]); }
export async function setAvatar(id, cardId) {
  await touch(id, 'avatar_card_id=?', [cardId]);
  const c = (await query('SELECT name FROM cards WHERE card_id=?;', [cardId]))[0];
  await logHistory(id, `Avatar changed to ${c?.name || cardId}`);
}
export async function toggleStar(id) {
  const d = (await query('SELECT starred FROM decks WHERE id=? AND profile_id=?;', [id, activeProfileId()]))[0];
  await touch(id, 'starred=?', [d?.starred ? 0 : 1]);
}
/**
 * Write the Library's manual order (long-press and drag - DESIGN_SYSTEM §Ordering, owner ruling
 * 2026-08-20). `lib_order` has existed since the schema was written but until now nothing ever set
 * it except insert-at-end, so every library was in creation order and could not be arranged.
 *
 * THE STARRED CLAMP, and why it is enforced HERE and not only in the gesture. `listDecks` orders by
 * `starred DESC, lib_order ASC, name ASC`, so a favourite outranks lib_order no matter what number
 * it carries. An arrangement that puts a plain deck above a favourite is therefore an order the
 * query CANNOT reproduce: it would be written, read back rearranged, and the drag would look like
 * it silently failed. The UI clamps each drag to the run of decks sharing its starred value; this
 * refuses the arrangement outright if that clamp is ever missing or wrong, because a UI guard alone
 * is not a data guarantee.
 *
 * REFUSES RATHER THAN PARTIALLY APPLIES, like `reorderContainers`: `orderedIds` must be exactly the
 * profile's decks - same members, no duplicates, nothing missing. A filtered list (the Library has a
 * search field) would otherwise renumber the matches and silently demote everything the query hid.
 *
 * NO BROADCAST, deliberately: nothing in this repository publishes deck changes and the Decks pillar
 * refreshes its own list after every write it makes. Inventing a subscription for one write would be
 * a new pattern with one consumer - the caller re-reads, as it does after rename, star and delete.
 */
export async function reorderDecks(orderedIds, pid = activeProfileId()) {
  const ids = [...(orderedIds || [])];
  const decks = await query('SELECT id, starred FROM decks WHERE profile_id=?;', [pid]);
  const starredOf = new Map(decks.map((d) => [d.id, d.starred ? 1 : 0]));
  const unique = new Set(ids);
  if (ids.length !== decks.length || unique.size !== ids.length || ids.some((id) => !starredOf.has(id))) {
    throw Object.assign(
      new Error('That ordering does not match your library any more - reopen the Library and try again.'),
      { name: 'InvalidDeckOrder' },
    );
  }
  // Favourites first, and contiguous. Checking the sequence rather than counting groups also
  // catches a favourite stranded in the middle of the plain decks.
  let sawPlain = false;
  for (const id of ids) {
    if (starredOf.get(id)) { if (sawPlain) throw Object.assign(new Error('Favourite decks always sort above the rest.'), { name: 'InvalidDeckOrder' }); }
    else sawPlain = true;
  }
  const ts = nowIso();
  // `AND profile_id=?` is unreachable given the membership check above and no test can kill it -
  // it is kept because every write in this module is scoped at the statement (invariant 2: a
  // caller-supplied id must not be able to bypass the profile boundary), not because it is live.
  await tx(ids.map((id, i) => ['UPDATE decks SET lib_order=?, updated_at=? WHERE id=? AND profile_id=?;', [i + 1, ts, id, pid]]));
}

// setRecord removed: a deck's W-L is derived solely from its matches (see
// playRepository.syncDeckRecord). There is no manual override any more.
export async function deleteDeck(id) {
  const pid = activeProfileId();
  // All three writes commit atomically: matches outlive their deck (keep their
  // history) but genuinely lose the link - NULL the deck_id so no stale pointer
  // to a gone deck lingers - the deck row goes, and any resume tile pointing at
  // it is cleared. One tx so a crash can't strand a half-deleted deck with a
  // stale record.
  await tx([
    ['UPDATE matches SET deck_id=NULL WHERE deck_id=? AND profile_id=?;', [id, pid]],
    ['DELETE FROM decks WHERE id=? AND profile_id=?;', [id, pid]],
    ['DELETE FROM resume WHERE profile_id=? AND target_type=? AND target_id=?;', [pid, 'deck', id]],
  ]);
}

export async function duplicateDeck(id) {
  const d = await getDeck(id);
  if (!d) return null;
  const nid = await createDeck(d.name + ' (copy)', { archetype: d.archetype, avatarCardId: d.avatar_card_id });
  const entries = await query('SELECT zone, card_id, quantity, variant_slug FROM deck_entries WHERE deck_id=?;', [id]);
  if (entries.length) {
    await tx(entries.map((e) => [
      'INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES(?,?,?,?,?,?);',
      [uuid(), nid, e.zone, e.card_id, e.quantity, e.variant_slug || ''],
    ]));
  }
  return nid;
}

// Card-level requirement of a deck, for Collection buildability. The maindeck
// (spellbook + atlas) PLUS the avatar (which lives on the deck row, not in
// deck_entries). The deck's own 'collection' zone is a maybeboard/sideboard and is
// deliberately EXCLUDED - counting it can demand more copies than any zone plays
// (and more than the rarity cap). Unresolved placeholder entries (card_id null) are
// reported, not silently dropped, so a deck with unknown cards is never falsely
// reported buildable. Returns { required: [{card_id, qty}], unresolved }.
export async function deckRequirements(deckId) {
  const pid = activeProfileId();
  const d = (await query('SELECT avatar_card_id FROM decks WHERE id=? AND profile_id=?;', [deckId, pid]))[0];
  const rows = await query(
    "SELECT card_id, SUM(quantity) q FROM deck_entries WHERE deck_id=? AND zone IN ('spellbook','atlas') GROUP BY card_id;",
    [deckId]
  );
  const required = [];
  let unresolved = 0;
  for (const r of rows) {
    if (r.card_id == null) unresolved += (r.q || 0);
    else required.push({ card_id: r.card_id, qty: r.q });
  }
  if (d?.avatar_card_id) required.push({ card_id: d.avatar_card_id, qty: 1 });
  return { required, unresolved };
}

// Batch form for the deck library: many decks in 2 queries (no N+1, per the
// listDecks lesson). Returns Map<deck_id, {required, unresolved}>.
export async function deckRequirementsBulk(deckIds) {
  const out = new Map();
  if (!deckIds.length) return out;
  for (const id of deckIds) out.set(id, { required: [], unresolved: 0 });
  const inC = `(${deckIds.map(() => '?').join(',')})`;
  const avatars = await query(`SELECT id, avatar_card_id FROM decks WHERE id IN ${inC};`, deckIds);
  const rows = await query(
    `SELECT deck_id, card_id, SUM(quantity) q FROM deck_entries WHERE deck_id IN ${inC} AND zone IN ('spellbook','atlas') GROUP BY deck_id, card_id;`,
    deckIds
  );
  for (const r of rows) {
    const e = out.get(r.deck_id); if (!e) continue;
    if (r.card_id == null) e.unresolved += (r.q || 0);
    else e.required.push({ card_id: r.card_id, qty: r.q });
  }
  for (const a of avatars) { if (a.avatar_card_id) out.get(a.id)?.required.push({ card_id: a.avatar_card_id, qty: 1 }); }
  return out;
}

export async function historyCount(deckId) {
  const r = await query('SELECT COUNT(*) n FROM deck_history WHERE deck_id=?;', [deckId]);
  return r[0]?.n || 0;
}
export async function getHistory(deckId) {
  return query('SELECT ts, text FROM deck_history WHERE deck_id=? ORDER BY ts DESC LIMIT 200;', [deckId]);
}
export async function clearHistory(deckId) {
  await run('DELETE FROM deck_history WHERE deck_id=?;', [deckId]);
}

async function touch(id, setExpr, params) {
  await run(`UPDATE decks SET ${setExpr}, updated_at=? WHERE id=? AND profile_id=?;`, [...params, nowIso(), id, activeProfileId()]);
}
// Deck log is capped per deck so it can't grow unbounded (every qty change logs
// a row) - the newest HISTORY_CAP survive; older rows are trimmed on write.
export const HISTORY_CAP = 300;
export const trimHistorySql = (deckId) => ['DELETE FROM deck_history WHERE deck_id=? AND id NOT IN (SELECT id FROM deck_history WHERE deck_id=? ORDER BY ts DESC, rowid DESC LIMIT ?);', [deckId, deckId, HISTORY_CAP]];

async function logHistory(deckId, text) {
  await run('INSERT INTO deck_history(id,deck_id,ts,text) VALUES(?,?,?,?);', [uuid(), deckId, nowIso(), text]);
  const [sql, params] = trimHistorySql(deckId);
  await run(sql, params);
}

/* ---------------- entries / zones ---------------- */

export async function zoneCounts(deckId) {
  const rows = await query('SELECT zone, SUM(quantity) n FROM deck_entries WHERE deck_id=? GROUP BY zone;', [deckId]);
  const out = { spellbook: 0, atlas: 0, collection: 0 };
  for (const r of rows) out[r.zone] = r.n || 0;
  return out;
}

export async function deckQty(deckId, zone, cardId) {
  const r = await query('SELECT quantity FROM deck_entries WHERE deck_id=? AND zone=? AND card_id=?;', [deckId, zone, cardId]);
  return r[0]?.quantity || 0;
}

/** Quantity of a card across ALL zones (for rarity-limit enforcement). */
export async function totalQty(deckId, cardId) {
  const r = await query('SELECT SUM(quantity) n FROM deck_entries WHERE deck_id=? AND card_id=?;', [deckId, cardId]);
  return r[0]?.n || 0;
}

/** Which of the active profile's decks run this card (Codex "In your decks").
    One row per deck·zone, plus decks where it's the avatar. */
export async function decksWithCard(cardId) {
  const pid = activeProfileId();
  const rows = await query(
    `SELECT d.id, d.name, e.zone, e.quantity FROM deck_entries e
     JOIN decks d ON d.id = e.deck_id
     WHERE d.profile_id=? AND e.card_id=? AND e.quantity>0
     ORDER BY d.name, e.zone;`,
    [pid, cardId]
  );
  const avatars = await query(
    'SELECT id, name FROM decks WHERE profile_id=? AND avatar_card_id=? ORDER BY name;',
    [pid, cardId]
  );
  return [
    ...avatars.map((d) => ({ id: d.id, name: d.name, zone: 'avatar', quantity: 1 })),
    ...rows,
  ];
}

/** Change a card's quantity in a zone; enforces rarity copy-limit and collection cap. */
export async function changeQty(deckId, zone, card, delta) {
  if (delta > 0) {
    const total = await totalQty(deckId, card.card_id);
    if (total + delta > copyLimit(card)) return { ok: false, reason: `Max ${copyLimit(card)} copies (${card.rarity}).` };
    if (zone === 'collection') {
      const counts = await zoneCounts(deckId);
      // collectionMax only needs avatar_card_id (dragonlord => 11); avoid a full
      // getDeck (SELECT * + avatar row + element-pip JOIN) on every collection tap.
      const av = (await query('SELECT avatar_card_id FROM decks WHERE id=?;', [deckId]))[0];
      if (counts.collection + delta > collectionMax(av)) return { ok: false, reason: `Collection limit ${collectionMax(av)}.` };
    }
  }
  const cur = await deckQty(deckId, zone, card.card_id);
  const next = cur + delta;
  if (next <= 0) {
    await run('DELETE FROM deck_entries WHERE deck_id=? AND zone=? AND card_id=?;', [deckId, zone, card.card_id]);
  } else if (cur === 0) {
    await run('INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES(?,?,?,?,?,?);', [uuid(), deckId, zone, card.card_id, next, '']);
  } else {
    await run('UPDATE deck_entries SET quantity=? WHERE deck_id=? AND zone=? AND card_id=?;', [next, deckId, zone, card.card_id]);
  }
  await touch(deckId, 'name=name', []); // bump updated_at
  const zLabel = zone === 'atlas' ? 'Atlas' : zone === 'collection' ? 'Collection' : 'Spellbook';
  await logHistory(deckId, delta > 0 ? `Added ${delta}× ${card.name} to ${zLabel}` : `Removed ${-delta}× ${card.name} from ${zLabel}`);
  return { ok: true };
}

/** Entries of a zone joined with catalog card data, grouped by type, cost-sorted. */
export async function zoneGroups(deckId, zone) {
  const rows = await query(
    `SELECT e.quantity, c.* FROM deck_entries e JOIN cards c ON c.card_id=e.card_id
     WHERE e.deck_id=? AND e.zone=?;`, [deckId, zone]
  );
  const order = ['Avatar', 'Minion', 'Aura', 'Magic', 'Artifact', 'Site'];
  const byType = {};
  for (const r of rows) (byType[r.type] = byType[r.type] || []).push(r);
  return order.filter((t) => byType[t]).map((t) => ({
    label: t.toUpperCase() + 'S',
    count: byType[t].reduce((a, c) => a + c.quantity, 0),
    cards: byType[t].sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0)).map((c) => ({
      card_id: c.card_id, name: c.name, qty: c.quantity, cost: c.cost,
      thr: elementPips(c.thresholds), image_slug: c.image_slug, elements: c.elements, thresholds: c.thresholds,
    })),
  }));
}

async function deckElementPips(deckId) {
  const rows = await query(
    `SELECT c.thresholds FROM deck_entries e JOIN cards c ON c.card_id=e.card_id
     WHERE e.deck_id=? AND e.zone='spellbook';`, [deckId]
  );
  const need = { air: 0, earth: 0, fire: 0, water: 0 };
  for (const r of rows) { const th = jp(r.thresholds, {}); for (const el of Object.keys(need)) need[el] = Math.max(need[el], th[el] || 0); }
  return Object.entries(need).filter(([, v]) => v > 0).map(([el]) => ({ el, c: EL_COLOR[el] }));
}

/** Full per-zone entries joined with catalog data - the shape deck analysis
 *  functions expect (cost, attack, type, rarity, elements[], thresholds{}). */
export async function getDeckCards(deckId) {
  const rows = await query(
    `SELECT e.zone, e.quantity, c.card_id, c.name, c.cost, c.attack, c.type, c.rarity, c.elements, c.thresholds, c.image_slug, c.is_site, c.rules_text
     FROM deck_entries e JOIN cards c ON c.card_id=e.card_id WHERE e.deck_id=?;`, [deckId]
  );
  const zones = { spellbook: [], atlas: [], collection: [] };
  for (const r of rows) {
    (zones[r.zone] || (zones[r.zone] = [])).push({
      card_id: r.card_id, name: r.name, quantity: r.quantity, cost: r.cost, attack: r.attack, type: r.type, rarity: r.rarity,
      elements: jp(r.elements, []), thresholds: jp(r.thresholds, {}), image_slug: r.image_slug, is_site: r.is_site,
      rules_text: r.rules_text,   // copyLimit's "any number of" check needs it
    });
  }
  return zones;
}

/* ---------------- stats ---------------- */


/* ---------------- add-flow pool ---------------- */

const _cmp = (a, op, b) => op === '=' ? a === b : op === '<=' ? a <= b : a >= b;

/** Distinct set names / artists for the Refine sheet's Set + Artist filters.
 *  Both derive from the immutable catalog, so they read the parsed cache. */
export async function getSets() {
  const s = new Set();
  for (const c of await getCatalog()) for (const x of c._sets) if (x?.name) s.add(x.name);
  return [...s].sort();
}
export async function getArtists() {
  const s = new Set();
  for (const c of await getCatalog()) for (const v of c._variants) if (v?.artist) s.add(v.artist);
  return [...s].sort();
}

/* ── Card query grammar ──
   Moved to ./cardQuery.js (pure, DB-free, unit-tested under `node --test`) and
   re-exported here so existing deckRepository importers keep working. See
   cardQuery.js for the full token grammar (name:/t:/r:/kw:/el:/e:/attack>/cost/
   th:/set:/rarity + the Codex-only has:/is: scope channel). */
export { parseQuery, parseCardQuery, cardMatchesQuery } from './cardQuery.js';

// Full card-pool query for deckbuilder filters: element (+multi),
// type, rarity, set, per-element & total threshold comparators, mana comparator,
// artist, and name/mana/element sort.
// Power = a card's attack points; when it also has a defence, the two are averaged
// (rounded down). No attack -> no power (excluded from a power filter).
export function cardPower(c) {
  const a = c.attack, d = c.defence;
  if (a == null) return null;
  return d != null ? Math.floor((a + d) / 2) : a;
}

/**
 * The deck pool's sort comparator registry, keyed the same way DECK_SORT_OPTIONS is
 * (docs/proposals/arrange-stacked-sort.md). Extractors read fields precomputed on the cached row,
 * so the comparator does no parsing or allocation.
 *
 * Kept next to the pool it orders rather than beside the List's registry: the two surfaces sort
 * different row shapes, so one parameterised registry would add indirection without adding
 * safety. What they DO share is the option vocabulary and the tap reducer.
 *
 * DECK_SORT_COMPARATOR_KEYS is exported for the exhaustiveness gate, which fails if an option
 * ever ships without a comparator or a comparator without an option.
 */
const DECK_SORT_KEY = {
  name: (c) => c._nameLc,
  cost: (c) => c.cost ?? 0,
  element: (c) => c._el0,
  th: (c) => c._totalTh,
};
export const DECK_SORT_COMPARATOR_KEYS = Object.freeze(Object.keys(DECK_SORT_KEY));

export async function getPool({
  q = '', els = [], types = [], rarities = [], sets = [], multi = false,
  thByEl = {}, totalTh = null, costCmp = null, powerCmp = null, artist = '', sort = [],
} = {}) {
  const all = await getCatalog();   // parsed once; rows carry _th/_els/_sets/etc.
  const ql = q ? q.toLowerCase() : null;
  const typeSet = types.length ? new Set(types) : null;
  const raritySet = rarities.length ? new Set(rarities) : null;
  const setSet = sets.length ? new Set(sets) : null;
  const elCmps = [];   // active per-element threshold comparators
  for (const el of ['air', 'earth', 'fire', 'water']) { const f = thByEl[el]; if (f && f.val != null) elCmps.push([el, f.op, f.val]); }

  // One pass over the cache, reading pre-parsed fields (no JSON.parse per row).
  // .filter() returns a fresh array, so the sort below never mutates the cache.
  const rows = all.filter((c) => {
    if (ql && !c._nameLc.includes(ql)) return false;
    if (typeSet && !typeSet.has(c.type)) return false;
    if (raritySet && !raritySet.has(c.rarity)) return false;
    if (els.length && !els.some((e) => (c._th[e] || 0) > 0)) return false;
    if (multi && c._elsF.length <= 1) return false;
    if (setSet && !c._sets.some((s) => setSet.has(s.name))) return false;
    if (artist && !c._variants.some((v) => v.artist === artist)) return false;
    for (const [el, op, val] of elCmps) if (!_cmp(c._th[el] || 0, op, val)) return false;
    if (totalTh && totalTh.val != null && !_cmp(c._totalTh, totalTh.op, totalTh.val)) return false;
    if (costCmp && costCmp.val != null && !_cmp(c.cost ?? 0, costCmp.op, costCmp.val)) return false;
    if (powerCmp && powerCmp.val != null) { const p = cardPower(c); if (p == null || !_cmp(p, powerCmp.op, powerCmp.val)) return false; }
    return true;
  });

  // Multi-key sort in priority order (tap to add, ↑/↓ per key). Keys are
  // precomputed on the cached row, so the comparator does no parsing/allocation.
  const KEY = DECK_SORT_KEY;
  const cmp = (k, a, b) => { const x = KEY[k](a), y = KEY[k](b); return typeof x === 'number' ? x - y : String(x).localeCompare(String(y)); };
  const list = sort.length ? sort : [{ key: 'name', dir: 'asc' }];
  rows.sort((a, b) => {
    for (const { key, dir } of list) { const d = cmp(key, a, b); if (d !== 0) return dir === 'desc' ? -d : d; }
    return a.name.localeCompare(b.name);
  });
  return rows;
}

/* ---------------- import / export ---------------- */

const TYPE_GROUPS = ['Avatar', 'Minion', 'Aura', 'Magic', 'Artifact', 'Site'];

// Text-export type order (owner ruling 2026-08-15): Avatar, Aura, Artifact,
// Minion, Magic - then Atlas (sites) and Collection follow as zones. EXPORT
// ONLY: zoneGroups' own order also drives the on-screen deck list, which
// deliberately keeps its shipped arrangement.
const EXPORT_TYPE_ORDER = ['AVATARS', 'AURAS', 'ARTIFACTS', 'MINIONS', 'MAGICS', 'SITES'];
const exportOrdered = (groups) => [...groups].sort(
  (a, b) => EXPORT_TYPE_ORDER.indexOf(a.label) - EXPORT_TYPE_ORDER.indexOf(b.label),
);

export async function exportMarkdown(deckId) {
  const d = await getDeck(deckId);
  const lines = [`# ${d.name}`];
  if (d.avatar) lines.push('', '## Avatar', `- 1× ${d.avatar.name}`);
  for (const zone of ZONES) {
    const groups = exportOrdered(await zoneGroups(deckId, zone));
    if (!groups.length) continue;
    lines.push('', `## ${zone[0].toUpperCase() + zone.slice(1)}`);
    for (const g of groups) {
      lines.push(`### ${g.label[0] + g.label.slice(1).toLowerCase()}`);
      for (const c of g.cards) lines.push(`- ${c.qty}× ${c.name}`);
    }
  }
  return lines.join('\n');
}

// Curiosa.io import format: no deck name, no headers, no avatar, no collection -
// just a flat "qty name" list of Spellbook + Atlas (any header breaks Curiosa's importer).
export async function exportCuriosa(deckId) {
  const out = [];
  for (const zone of ['spellbook', 'atlas']) {
    const groups = await zoneGroups(deckId, zone);
    for (const g of groups) for (const c of g.cards) out.push(`${c.qty} ${c.name}`);
  }
  return out.join('\n');
}

/** Parse Compendium/Curiosa deck text into {avatar, zones:{zone:[{name,qty}]}}. */
export function parseDeckText(text) {
  const zoneFor = (h) => /atlas/i.test(h) ? 'atlas' : /side|collection/i.test(h) ? 'collection' : /avatar/i.test(h) ? 'avatar' : /spell/i.test(h) ? 'spellbook' : null;
  let zone = 'spellbook', avatar = null;
  const zones = { spellbook: [], atlas: [], collection: [] };
  for (let raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const hdr = line.replace(/^#+\s*/, '').replace(/^\/\/\s*/, '');
    if (/^(#|\/\/)/.test(line) || /^(avatar|spellbook|atlas|sideboard|collection)$/i.test(hdr)) {
      const z = zoneFor(hdr); if (z) { zone = z; continue; }
    }
    if (/^###/.test(line)) continue; // type subgroup header
    const m = line.match(/^[-*]?\s*(\d+)\s*[x×]?\s+(.+)$/i);
    if (!m) continue;
    const qty = parseInt(m[1], 10); const name = m[2].trim();
    if (zone === 'avatar') { avatar = name; continue; }
    zones[zone].push({ name, qty });
  }
  return { avatar, zones };
}

// Dry-run a pasted "qty name" list against an EXISTING deck: resolve each line,
// place it in its home zone (sites -> Atlas, else Spellbook), and cap by the rarity
// copy limit given what's already in the deck. Nothing is written - returns a plan
// { adds, atLimit, unknown } for a confirmation step (see applyDeckAdds).
export async function planDeckTextAdd(deckId, text) {
  const { avatar, zones } = parseDeckText(text);
  const cat = await getCatalog();
  const byName = new Map(cat.map((c) => [c._nameLc, c]));
  const lc = (s) => String(s || '').toLowerCase().trim();
  // Avatars aren't deck cards - an avatar in the paste SWAPS the deck's avatar, so
  // pull any out of the card adds. Source: an explicit `## Avatar` line, or any card
  // line that resolves to an avatar (people paste them into the bare list). The
  // explicit Avatar line wins; otherwise the first avatar-resolving line.
  let avatarCard = null;
  if (avatar) { const a = byName.get(lc(avatar)); if (a?.is_avatar) avatarCard = a; }
  const merged = new Map();   // card_id -> { card, requested } (dedupe repeated lines)
  const unknown = [];
  for (const { name, qty } of [...zones.spellbook, ...zones.atlas, ...zones.collection]) {
    const card = byName.get(lc(name));
    if (!card) { unknown.push({ name, qty }); continue; }
    if (card.is_avatar) { if (!avatarCard) avatarCard = card; continue; }   // avatar, not a deck entry
    const cur = merged.get(card.card_id) || { card, requested: 0 };
    cur.requested += Math.max(0, qty | 0);
    merged.set(card.card_id, cur);
  }
  const adds = [], atLimit = [];
  for (const { card, requested } of merged.values()) {
    if (requested <= 0) continue;
    const zone = card.is_site ? 'atlas' : 'spellbook';
    const already = await totalQty(deckId, card.card_id);
    const limit = copyLimit(card);
    const room = Math.max(0, limit - already);
    const addQty = Math.min(requested, room);
    const entry = { cardId: card.card_id, name: card.name, rarity: card.rarity, rulesText: card.rules_text, zone, requested, already, limit };
    if (addQty > 0) adds.push({ ...entry, addQty, capped: addQty < requested });
    else atLimit.push(entry);
  }
  return { avatar: avatarCard ? { cardId: avatarCard.card_id, name: avatarCard.name } : null, adds, atLimit, unknown };
}

// Commit a confirmed plan's adds. changeQty re-checks the limit, so a stale plan
// can never over-fill. Returns the total copies actually written.
export async function applyDeckAdds(deckId, adds) {
  let added = 0;
  for (const a of adds || []) {
    const res = await changeQty(deckId, a.zone, { card_id: a.cardId, name: a.name, rarity: a.rarity, rules_text: a.rulesText }, a.addQty);
    if (res.ok) added += a.addQty;
  }
  return added;
}

// Add a scanner-recognised card to a deck: files it in its home zone and lets
// changeQty enforce the rarity copy limit (returns {ok,reason} - a limit hit is
// surfaced by the caller). Used by the deck-mode scanner.
export async function addScannedToDeck(deckId, cardId, qty = 1) {
  const cat = await getCatalog();
  const card = cat.find((c) => c.card_id === cardId);
  if (!card) return { ok: false, reason: 'Unknown card' };
  return changeQty(deckId, card.is_site ? 'atlas' : 'spellbook', card, Math.max(1, qty | 0));
}

/* ---- SorceryTCG URL import ---- */

// The platform behind these functions moved from curiosa.io to sorcerytcg.com
// (August 2026); curiosa.io 308-redirects there and keeps the same deck ids. The
// internal names, the `decks.curiosa_url` column and the `/curiosa` proxy key are
// deliberately unchanged - renaming them would migrate stored data for cosmetics.
// Endpoint knowledge is confined to curiosaQuery + fetchRemoteDeck, so a future
// re-point is two functions. NOTE: api.sorcerytcg.com is a separate, paused
// deployment - never call it. Card image URLs in the payload are never read
// either; art comes from our own catalog/R2.

// Only a real device build can bypass CORS with CapacitorHttp. On web (incl. the
// dev preview), Capacitor's web shim would do a CORS-blocked direct fetch, so we
// must route through the Vite proxy instead.
function nativeHttp() {
  if (typeof window === 'undefined') return null;
  const isNative = window.Capacitor?.isNativePlatform?.() === true;
  return isNative ? (window.CapacitorHttp || window.Capacitor?.Plugins?.CapacitorHttp || null) : null;
}

// One tRPC query. Native: CapacitorHttp (bypasses CORS). Web: the Vite dev proxy
// at /curiosa (which points at sorcerytcg.com and injects the spoofed
// Origin/Referer). Returns the unwrapped json.
async function curiosaQuery(proc, id) {
  const input = encodeURIComponent(JSON.stringify({ 0: { json: { id, collectionTracking: false } } }));
  const path = `/api/trpc/${proc}?batch=1&input=${input}`;
  const http = nativeHttp();
  let data;
  if (http) {
    const headers = { Origin: 'https://sorcerytcg.com', Referer: `https://sorcerytcg.com/decks/${id}`, 'User-Agent': 'Mozilla/5.0' };
    const resp = await http.get({ url: 'https://sorcerytcg.com' + path, headers });
    // CapacitorHttp resolves on any status - classify here or a 404 surfaces as
    // a TypeError deep in the unwrap below.
    if (resp.status && (resp.status < 200 || resp.status >= 300)) throw new Error('HTTP ' + resp.status);
    data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
  } else {
    const res = await fetch('/curiosa' + path);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  }
  // tRPC can also report failure as HTTP 200 with a per-item error body.
  const item = Array.isArray(data) ? data[0] : null;
  if (item?.error) throw new Error('HTTP ' + (item.error?.json?.data?.httpStatus || 500));
  const json = item?.result?.data?.json;
  if (json === undefined) throw new Error("Couldn't read SorceryTCG's response.");
  return json;
}

/** Boards a deck entry may declare. An unknown one aborts the read (see below). */
const REMOTE_BOARDS = new Set(['Avatar', 'Main', 'Collection', 'Maybeboard']);
/** Main-board card category -> our zone. A Map, so no prototype key can resolve. */
const MAIN_ZONE = new Map([['Spell', 'spellbook'], ['Site', 'atlas']]);

/**
 * Read one deck from SorceryTCG and normalise it to
 * `{ name, avatarName, entries: [{zone, name, qty}], maybeboard: [{name, qty}] }`,
 * or null when there is no such deck (deleted or private - each caller phrases
 * that for its own surface).
 *
 * FAIL CLOSED, and that is the point of the function. A row this reader skipped
 * would simply be absent from the target list, and an absent row reads as a
 * REMOVAL on sync - upstream shape drift would quietly delete cards from a local
 * deck. So anything unexpected aborts the WHOLE read: a non-array decklist, an
 * entry with no object card, a card with no usable name, a quantity that is not a
 * finite count, a board outside the four known values, or a Main-board card whose
 * category is neither Spell nor Site.
 *
 * The avatar is a decklist entry with board "Avatar" (there is no meta.avatars
 * list any more), and a card's category now lives at `card.engine.category`.
 */
async function fetchRemoteDeck(id) {
  const deck = await curiosaQuery('deck.get', id);
  if (!deck) return null;
  const bad = () => new Error("Couldn't read SorceryTCG's response.");
  if (!Array.isArray(deck.decklist)) throw bad();

  const entries = [];
  const maybeboard = [];
  let avatarName = null;
  for (const e of deck.decklist) {
    const card = e && typeof e === 'object' ? e.card : null;
    if (!card || typeof card !== 'object') throw bad();
    const name = card.name;
    if (typeof name !== 'string' || !name.trim()) throw bad();
    if (e.quantity != null && !(Number.isFinite(e.quantity) && e.quantity >= 0)) throw bad();
    if (!REMOTE_BOARDS.has(e.board)) throw bad();
    const qty = Math.max(1, e.quantity | 0);   // nullish and 0 both become 1 copy
    if (e.board === 'Avatar') { avatarName ??= name; continue; }        // first one wins
    if (e.board === 'Maybeboard') { maybeboard.push({ name, qty }); continue; }   // names verbatim: no catalog resolution
    if (e.board === 'Collection') { entries.push({ zone: 'collection', name, qty }); continue; }
    const zone = MAIN_ZONE.get(card.engine?.category);
    if (!zone) throw bad();
    entries.push({ zone, name, qty });
  }
  return { name: typeof deck.name === 'string' ? deck.name : '', avatarName, entries, maybeboard };
}

/** The user-facing message for a failed remote read. Shared by import and sync so
 *  the two sheets say the same thing about the same failure. The parse-failure
 *  branch matches on a MARKER inside the message, so this regex and the string
 *  thrown above must change together. */
function classifyFetchError(e) {
  const msg = String(e?.message || '');
  const code = /HTTP (\d+)/.exec(msg)?.[1];
  if (code && +code >= 400 && +code < 500) return 'SorceryTCG has no deck at this link any more - it may be deleted or private.';
  if (code) return `SorceryTCG returned an error (HTTP ${code}). Try again later.`;
  if (/SorceryTCG's response/.test(msg)) return "Couldn't read SorceryTCG's response.";
  return "Couldn't reach SorceryTCG - check your connection.";
}

const resolveCardId = async (name) =>
  (await query('SELECT card_id FROM cards WHERE lower(name)=? LIMIT 1;', [String(name || '').toLowerCase()]))[0]?.card_id || null;

/** Import a SorceryTCG deck URL into a NEW deck. fetchRemoteDeck has already
 *  placed every row in its zone (Main/Spell→spellbook, Main/Site→atlas,
 *  Collection→collection); the remote Maybeboard, which our schema has no zone
 *  for, is written into the deck's notes as the managed block. Unresolved cards →
 *  warnings, kept as placeholder rows so nothing is lost. Returns
 *  { id, name, warnings }. */
export async function importCuriosaUrl(rawUrl) {
  const id = curiosaIdFrom(rawUrl);
  if (!id) throw new Error('Could not find a SorceryTCG deck id in that URL.');

  let remote;
  try { remote = await fetchRemoteDeck(id); }
  catch (e) { throw new Error(classifyFetchError(e)); }
  // A deleted or private deck may answer with a null deck rather than a 404
  // (a dead id 404s, but private decks are unprobed). Without this check such a
  // URL would import as an empty deck.
  if (!remote) throw new Error('SorceryTCG has no deck at this URL - it may be deleted or private.');

  const warnings = [];
  const avName = remote.avatarName;
  const avatarId = avName ? await resolveCardId(avName) : null;
  if (avName && !avatarId) warnings.push(avName);

  const name = await uniqueDeckName(remote.name || 'Imported Deck');
  const deckId = await createDeck(name, { avatarCardId: avatarId });

  const stmts = [];
  for (const e of remote.entries) {
    const cid = await resolveCardId(e.name);
    if (!cid) warnings.push(e.name);
    stmts.push(['INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES(?,?,?,?,?,?);',
      [uuid(), deckId, e.zone, cid, e.qty, '']]);
  }
  // The Maybeboard block rides the SAME transaction as the entries (constitution:
  // transactional user-data operations) - a crash can't leave a deck whose notes
  // claim cards its zones never got.
  if (remote.maybeboard.length) {
    stmts.push(['UPDATE decks SET notes=? WHERE id=? AND profile_id=?;',
      [applyMaybeboardBlock('', remote.maybeboard), deckId, activeProfileId()]]);
  }
  if (stmts.length) await tx(stmts);

  await touch(deckId, 'curiosa_url=?', [`https://sorcerytcg.com/decks/${id}`]);
  await logHistory(deckId, 'Imported from SorceryTCG');
  return { id: deckId, name, warnings: [...new Set(warnings)] };
}

/* ---- SorceryTCG re-sync (docs/proposals/curiosa-resync.md) ---- */

/** Deck id from a sorcerytcg.com (or legacy curiosa.io) URL or a bare id; null
 *  when neither matches. Host-agnostic on purpose: the platform move kept deck
 *  ids, so URLs saved against the old host still resolve. */
function curiosaIdFrom(raw) {
  const m = /\/decks\/([a-z0-9]+)/i.exec(raw || '');
  return m ? m[1] : (/^[a-z0-9]{16,}$/i.test(raw || '') ? raw : null);
}

// A sync failure whose message is written for the user - `.friendly` marks it
// safe to toast verbatim; anything else gets a generic message in the UI.
function syncError(message) { const e = new Error(message); e.friendly = true; return e; }

/** Read-only sync plan: fetch the deck's saved SorceryTCG URL and diff the remote
 *  list against the local entries. Writes NOTHING. Remote names the catalog
 *  can't resolve go to `unknown` (shown, never applied - anonymous placeholder
 *  rows can't be reconciled on a later sync); existing placeholder rows are
 *  counted and left alone. The remote Maybeboard is compared against the managed
 *  block in the deck's notes, so the sheet can say whether confirming will touch
 *  them. Returns { diff, remoteTarget, unknown, overLimit, placeholderCount,
 *  duplicateGroups, remoteName, maybeboardChanged }. */
export async function planCuriosaSync(deckId) {
  const deck = (await query('SELECT name, notes, curiosa_url, avatar_card_id FROM decks WHERE id=? AND profile_id=?;', [deckId, activeProfileId()]))[0];
  if (!deck) throw syncError('This deck no longer exists.');
  const id = curiosaIdFrom(deck.curiosa_url);
  if (!id) throw syncError("The saved link isn't a SorceryTCG deck URL.");

  // One request carries the whole deck, so the property the old three-call read
  // had to defend by hand - a failed read must never masquerade as an
  // authoritative empty list, or confirming would delete the local Collection -
  // is now structural: fetchRemoteDeck either validates every row or throws.
  let remote;
  try { remote = await fetchRemoteDeck(id); }
  catch (e) { throw syncError(classifyFetchError(e)); }
  // A deleted or private deck may answer with a null deck rather than a 404.
  // Without this check an absent deck reads as an EMPTY deck and the diff
  // proposes removing every card in the local one.
  if (!remote) throw syncError('SorceryTCG has no deck at this link any more - it may be deleted or private.');

  const cat = await getCatalog();
  const byName = new Map(cat.map((c) => [c._nameLc, c]));
  const lc = (s) => String(s || '').toLowerCase().trim();

  const unknown = [];
  const remoteEntries = [];
  const limitByCardId = new Map();
  for (const { zone, name, qty } of remote.entries) {
    const card = byName.get(lc(name));
    if (!card) { unknown.push({ name, qty, zone }); continue; }
    limitByCardId.set(card.card_id, copyLimit(card));
    remoteEntries.push({ zone, cardId: card.card_id, name: card.name, qty });
  }

  const avName = remote.avatarName;
  const avCard = avName ? byName.get(lc(avName)) : null;
  if (avName && !avCard) unknown.push({ name: avName, qty: 1, zone: 'avatar' });
  const remoteAvatar = avCard ? { cardId: avCard.card_id, name: avCard.name } : null;

  const rows = await query('SELECT e.zone, e.card_id, e.quantity, c.name FROM deck_entries e LEFT JOIN cards c ON c.card_id=e.card_id WHERE e.deck_id=?;', [deckId]);
  const current = rows.filter((r) => r.card_id).map((r) => ({ zone: r.zone, cardId: r.card_id, qty: r.quantity, name: r.name }));
  const placeholderCount = rows.length - current.length;
  // Duplicate (zone, card) rows: the commit collapses them, so the plan must see
  // them too - or a duplicate-only sync reads as "already in sync" and the
  // cleanup never gets offered (Codex review 2026-08-14).
  const rowsPerKey = new Map();
  let duplicateGroups = 0;
  for (const r of current) {
    const k = `${r.zone}|${r.cardId}`;
    const n = (rowsPerKey.get(k) || 0) + 1;
    rowsPerKey.set(k, n);
    if (n === 2) duplicateGroups++;
  }

  // Name follows the remote (owner amendment 2026-08-14: versioned upstream names
  // flow through). The EFFECTIVE name is resolved here, profile-unique via the
  // app-wide dedup rule (excluding this deck) - so a "(1)" suffix that lands back
  // on the current name reads as in-sync rather than proposing the same rename forever.
  let effectiveName = null;
  const remoteNameRaw = String(remote.name || '').trim();
  if (remoteNameRaw && remoteNameRaw !== deck.name) {
    const candidate = await uniqueDeckName(remoteNameRaw, deckId);
    if (candidate !== deck.name) effectiveName = candidate;
  }

  const diff = computeCuriosaDiff(current, remoteEntries, deck.avatar_card_id, remoteAvatar, { fromName: deck.name, toName: effectiveName });
  // Copy-limit breaches in the INCOMING list. Written verbatim (one-way sync,
  // consistent with import; owner decision 2026-08-14) - surfaced, not enforced.
  const overLimit = overLimitEntries(remoteEntries, (id) => limitByCardId.get(id));
  // Does confirming rewrite the managed Maybeboard block? Asked of the same
  // function the commit will run, so "no change" here means the commit really is
  // a no-op - the block's deterministic render is what makes that true.
  const maybeboardChanged = applyMaybeboardBlock(deck.notes, remote.maybeboard) !== (deck.notes || '');
  // remoteTarget carries the RAW upstream name; the suffixed effective name is
  // display-only (diff.name). Commit re-dedups the raw name against fresh state,
  // so a collision that disappears between plan and commit settles in ONE sync
  // (Codex review 2026-08-14).
  return { diff, remoteTarget: { avatar: remoteAvatar, entries: remoteEntries, rawName: remoteNameRaw || null, maybeboard: remote.maybeboard }, unknown, overLimit, placeholderCount, duplicateGroups, remoteName: remoteNameRaw || null, maybeboardChanged };
}

/** Apply a sync plan's remote target. Re-reads current entries and re-diffs, so
 *  a plan gone stale (deck edited behind the open sheet) still converges on the
 *  remote list - and re-running an applied plan is a no-op. Everything commits
 *  in ONE tx() (constitution: transactional user-data operations): quantity
 *  updates keep each row's variant_slug, duplicate rows for one (zone, card)
 *  collapse into the first, placeholder rows (card_id null) are untouched, and
 *  the history entry + trim ride the same transaction. The deck name follows the
 *  remote (re-deduped here against fresh state, excluding this deck). Notes are
 *  touched ONLY inside the managed Maybeboard block, and only when the target
 *  actually carries a `maybeboard` array - a target without that field (an older
 *  plan, or any caller that never asked for one) leaves notes alone entirely.
 *  Returns { applied, adds, removes, changes, avatarChanged, maybeboardChanged, renamedTo }. */
export async function commitCuriosaSync(deckId, remoteTarget) {
  const pid = activeProfileId();
  const deck = (await query('SELECT name, notes, avatar_card_id FROM decks WHERE id=? AND profile_id=?;', [deckId, pid]))[0];
  if (!deck) throw syncError('This deck no longer exists.');

  const rows = await query('SELECT id, zone, card_id, quantity FROM deck_entries WHERE deck_id=?;', [deckId]);
  const groups = new Map();                   // zone|card_id -> rows (resolved only)
  for (const r of rows) {
    if (!r.card_id) continue;
    const k = `${r.zone}|${r.card_id}`;
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  const target = new Map();                   // zone|card_id -> qty (remote, aggregated)
  for (const e of remoteTarget?.entries || []) {
    if (!e?.cardId || !e?.zone) continue;
    const k = `${e.zone}|${e.cardId}`;
    target.set(k, (target.get(k) || 0) + Math.max(1, e.qty | 0));
  }

  const stmts = [];
  let adds = 0, removes = 0, changes = 0, duplicates = 0;
  for (const [k, qty] of target) {
    const g = groups.get(k);
    if (!g) {
      const [zone, cardId] = k.split('|');
      stmts.push(['INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES(?,?,?,?,?,?);', [uuid(), deckId, zone, cardId, qty, '']]);
      adds++;
      continue;
    }
    const total = g.reduce((n, r) => n + (r.quantity || 0), 0);
    if (g.length > 1) duplicates++;   // counted so duplicate-only cleanup still applies (Codex review 2026-08-14)
    for (const extra of g.slice(1)) stmts.push(['DELETE FROM deck_entries WHERE id=?;', [extra.id]]);
    if (total !== qty || g.length > 1) stmts.push(['UPDATE deck_entries SET quantity=? WHERE id=?;', [qty, g[0].id]]);
    if (total !== qty) changes++;
  }
  for (const [k, g] of groups) {
    if (target.has(k)) continue;
    for (const r of g) stmts.push(['DELETE FROM deck_entries WHERE id=?;', [r.id]]);
    removes++;
  }

  const toAvatar = remoteTarget?.avatar?.cardId || null;
  const avatarChanged = !!(toAvatar && toAvatar !== deck.avatar_card_id);

  // Rename resolves from the RAW upstream name against fresh state (Codex review
  // 2026-08-14: re-dedupping the plan's suffixed name kept the "(1)" even after
  // the colliding sibling disappeared, taking two syncs to settle). A dedup that
  // lands back on the current name is no change at all.
  const rawName = String(remoteTarget?.rawName ?? remoteTarget?.name ?? '').trim();
  let toName = null;
  if (rawName && rawName !== deck.name) {
    const candidate = await uniqueDeckName(rawName, deckId);
    if (candidate !== deck.name) toName = candidate;
  }
  const nameChanged = !!toName;

  // Notes surgery only when the target carries a maybeboard array: a missing
  // field means "this caller has nothing to say about notes", not "empty".
  // applyMaybeboardBlock copies every byte outside the managed block through, so
  // the user's own notes cannot be reworded, reordered or lost here.
  let nextNotes = null;
  if (Array.isArray(remoteTarget?.maybeboard)) nextNotes = applyMaybeboardBlock(deck.notes, remoteTarget.maybeboard);
  const notesChanged = nextNotes !== null && nextNotes !== (deck.notes || '');

  if (!adds && !removes && !changes && !duplicates && !avatarChanged && !nameChanged && !notesChanged) {
    return { applied: false, adds, removes, changes, duplicates, avatarChanged, maybeboardChanged: false, renamedTo: null };
  }

  const ts = nowIso();
  const sets = ['updated_at=?'];
  const setParams = [ts];
  if (nameChanged) { sets.unshift('name=?', 'slug=?'); setParams.unshift(toName, slugify(toName)); }
  if (avatarChanged) { sets.unshift('avatar_card_id=?'); setParams.unshift(toAvatar); }
  // Joins the deck row's ONE update rather than opening a second transaction:
  // notes and entries must land together or not at all.
  if (notesChanged) { sets.unshift('notes=?'); setParams.unshift(nextNotes); }
  stmts.push([`UPDATE decks SET ${sets.join(', ')} WHERE id=? AND profile_id=?;`, [...setParams, deckId, pid]]);
  const parts = [];
  if (adds) parts.push(`+${adds}`);
  if (removes) parts.push(`-${removes}`);
  if (changes) parts.push(`~${changes}`);
  if (duplicates) parts.push(`tidied ${duplicates} duplicate${duplicates === 1 ? '' : 's'}`);
  if (avatarChanged) parts.push('avatar');
  if (notesChanged) parts.push('maybeboard');
  if (nameChanged) parts.push(`renamed to ${toName}`);
  stmts.push(['INSERT INTO deck_history(id,deck_id,ts,text) VALUES(?,?,?,?);', [uuid(), deckId, ts, `Synced from SorceryTCG (${parts.join(' / ')})`]]);
  stmts.push(trimHistorySql(deckId));
  await tx(stmts);
  return { applied: true, adds, removes, changes, duplicates, avatarChanged, maybeboardChanged: notesChanged, renamedTo: nameChanged ? toName : null };
}

/** Deck-log breadcrumb for an "already in sync" check, so the log shows when
 *  SorceryTCG was last polled even when nothing changed. Profile-guarded INSERT …
 *  SELECT in one tx (Codex review 2026-08-14): a deck outside the active profile
 *  matches no row, so nothing is inserted - the repository boundary refuses the
 *  cross-profile write instead of trusting the caller's deck id. */
export async function logCuriosaChecked(deckId) {
  await tx([
    ['INSERT INTO deck_history(id,deck_id,ts,text) SELECT ?, id, ?, ? FROM decks WHERE id=? AND profile_id=?;',
      [uuid(), nowIso(), 'Checked SorceryTCG - already in sync', deckId, activeProfileId()]],
    trimHistorySql(deckId),
  ]);
}

/** Import parsed text into a NEW deck for the active profile. Unresolved cards
 *  are kept as placeholders (card_id null) so nothing silently disappears. */
export async function importFromText(text, deckName) {
  const { avatar, zones } = parseDeckText(text);
  let avatarId = null;
  if (avatar) avatarId = (await query('SELECT card_id FROM cards WHERE lower(name)=? LIMIT 1;', [avatar.toLowerCase()]))[0]?.card_id || null;
  const id = await createDeck(await uniqueDeckName(deckName || 'Imported deck'), { avatarCardId: avatarId });
  const stmts = [];
  let unresolved = 0;
  for (const zone of ZONES) {
    for (const { name, qty } of zones[zone]) {
      const c = (await query('SELECT card_id FROM cards WHERE lower(name)=? LIMIT 1;', [name.toLowerCase()]))[0];
      if (!c) unresolved++;
      stmts.push(['INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES(?,?,?,?,?,?);',
        [uuid(), id, zone, c?.card_id || null, qty, '']]);
    }
  }
  if (stmts.length) await tx(stmts);
  await logHistory(id, `Imported (${unresolved} unresolved)`);
  return { id, unresolved };
}

// Dry-run a pasted deck list for a NEW deck: resolve the avatar + each card line,
// merge by card_id, cap by the rarity copy limit (empty deck -> already 0), and
// report the unrecognised lines. Writes nothing - returns a plan for a confirm
// step (see commitImportText). Mirrors planDeckTextAdd so the review UI is shared.
export async function planImportText(text, deckName) {
  const { avatar, zones } = parseDeckText(text);
  const cat = await getCatalog();
  const byName = new Map(cat.map((c) => [c._nameLc, c]));
  const lc = (s) => String(s || '').toLowerCase().trim();
  let avatarPlan = null;
  if (avatar) { const a = byName.get(lc(avatar)); avatarPlan = { name: avatar, cardId: a?.card_id || null, resolved: !!a }; }
  const merged = new Map();   // card_id -> { card, zone, requested }
  const unknown = [];
  for (const zone of ZONES) {
    for (const { name, qty } of zones[zone]) {
      const card = byName.get(lc(name));
      if (!card) { unknown.push({ name, qty }); continue; }
      const cur = merged.get(card.card_id) || { card, zone, requested: 0 };
      cur.requested += Math.max(0, qty | 0);
      merged.set(card.card_id, cur);
    }
  }
  const adds = [];
  for (const { card, zone, requested } of merged.values()) {
    if (requested <= 0) continue;
    const limit = copyLimit(card);
    const addQty = Math.min(requested, limit);   // new deck: nothing already in it
    adds.push({ cardId: card.card_id, name: card.name, rarity: card.rarity, rulesText: card.rules_text, zone, requested, limit, addQty, capped: addQty < requested });
  }
  return { deckName: (deckName || '').trim() || null, avatar: avatarPlan, adds, unknown };
}

// Commit a confirmed import plan: create the deck (with the resolved avatar) and
// file its adds via applyDeckAdds (changeQty re-checks limits). Unrecognised lines
// were surfaced in the plan and are intentionally dropped. Returns { id, name, added }.
export async function commitImportText(plan, deckName) {
  const name = await uniqueDeckName(deckName || plan?.deckName || 'Imported deck');
  const id = await createDeck(name, { avatarCardId: plan?.avatar?.cardId || null });
  const added = await applyDeckAdds(id, plan?.adds || []);
  await logHistory(id, `Imported ${added} card${added === 1 ? '' : 's'} from text`);
  return { id, name, added };
}

// Resolve a pasted "qty name" list to catalogue rows for a card LIST (no zones,
// no rarity caps - a list just tallies cards). Merges duplicate lines by card and
// reports unrecognised names. Returns { adds:[{card, qty}], unknown:[{name,qty}] }.
export async function resolveCardList(text) {
  const { zones } = parseDeckText(text);
  const cat = await getCatalog();
  const byName = new Map(cat.map((c) => [c._nameLc, c]));
  const merged = new Map();
  const unknown = [];
  for (const zone of ZONES) {
    for (const { name, qty } of zones[zone]) {
      const card = byName.get(String(name).toLowerCase().trim());
      if (!card) { unknown.push({ name, qty }); continue; }
      const cur = merged.get(card.card_id) || { card, qty: 0 };
      cur.qty += Math.max(0, qty | 0);
      merged.set(card.card_id, cur);
    }
  }
  return { adds: [...merged.values()].filter((a) => a.qty > 0), unknown };
}

/** A deck name unique within the active profile. If `base` already exists (case-
 *  insensitively), appends " (1)", " (2)", … - so importing a deck whose name you already
 *  have never silently creates two identically-named decks. `excludeId` skips one deck's
 *  own row, for renames (a deck never collides with itself). */
async function uniqueDeckName(base, excludeId = null) {
  const name = (base || 'Shared deck').trim() || 'Shared deck';
  const rows = excludeId
    ? await query('SELECT name FROM decks WHERE profile_id=? AND id<>?;', [activeProfileId(), excludeId])
    : await query('SELECT name FROM decks WHERE profile_id=?;', [activeProfileId()]);
  const taken = new Set(rows.map((r) => (r.name || '').trim().toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 1; ; i += 1) {
    const candidate = `${name} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Import a shared-deck payload (from a QR / compendium://deck link) into a NEW deck.
 *  Card ids are used directly; any this catalog doesn't know are dropped (a version
 *  mismatch degrades gracefully). The name is de-duplicated ([uniqueDeckName]) so
 *  re-importing a deck you already have becomes "Name (1)" rather than a silent twin.
 *  Returns { id, name, missing }. */
export async function importDeckShare(payload) {
  if (!payload || !Array.isArray(payload.s)) throw new Error('That isn\'t a valid shared deck.');
  const name = await uniqueDeckName(payload.n || 'Shared deck');
  const spell = payload.s || [];
  const atlas = payload.t || [];
  const ids = [...new Set([payload.a, ...spell.map(([c]) => c), ...atlas.map(([c]) => c)].filter(Boolean))];
  const known = new Set(ids.length
    ? (await query(`SELECT card_id FROM cards WHERE card_id IN (${ids.map(() => '?').join(',')});`, ids)).map((r) => r.card_id)
    : []);
  const avatarId = payload.a && known.has(payload.a) ? payload.a : null;
  const id = await createDeck(name, { avatarCardId: avatarId });
  const stmts = [];
  let missing = 0;
  const add = (arr, zone) => {
    for (const [cid, qty] of arr) {
      if (!cid || !known.has(cid)) { missing++; continue; }
      stmts.push(['INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES(?,?,?,?,?,?);',
        [uuid(), id, zone, cid, Math.max(1, qty | 0), '']]);
    }
  };
  add(spell, 'spellbook');
  add(atlas, 'atlas');
  if (stmts.length) await tx(stmts);
  await logHistory(id, missing ? `Imported from QR (${missing} unknown card${missing === 1 ? '' : 's'})` : 'Imported from a shared deck');
  return { id, name, missing };
}
