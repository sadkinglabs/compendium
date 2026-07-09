// Decks data - Arcanum's model rebuilt on the unified store: three zones
// (spellbook/atlas/collection), deck avatar, rarity copy-limits, stats, and the
// Curiosa/Markdown import-export remapped. All profile-scoped via activeProfileId().
import { query, run, tx } from './db.js';
import { activeProfileId } from './profileRepository.js';
import { uuid, nowIso, slugify } from './ids.js';

export const ZONES = ['spellbook', 'atlas', 'collection'];
export const RARITY_LIMITS = { Ordinary: 4, Exceptional: 3, Elite: 2, Unique: 1 };
export const EL_COLOR = { air: '#67b6c4', earth: '#b35c33', fire: '#d2645a', water: '#5b87d6' };   // earth = rust, not tan (too close to gold)

const jp = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

export function collectionMax(deck) {
  return deck?.avatar_card_id === 'dragonlord' ? 11 : 10;
}
export function isUnlimited(card) {
  return /any number of/i.test(card?.rules_text || '');
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
 *  panel (life/attack/type/rules). Optional name filter. Mirrors Arcanum's
 *  fetchAvatars(). */
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
      const deck = await getDeck(deckId);
      if (counts.collection + delta > collectionMax(deck)) return { ok: false, reason: `Collection limit ${collectionMax(deck)}.` };
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

/** Full per-zone entries joined with catalog data - the shape Arcanum's stats
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
const _els = (c) => jp(c.elements, []).filter((x) => x && x.toLowerCase() !== 'none');
const _totalTh = (th) => (th.air || 0) + (th.earth || 0) + (th.fire || 0) + (th.water || 0);

/** Distinct set names / artists for the Refine sheet's Set + Artist filters. */
export async function getSets() {
  const rows = await query('SELECT sets FROM cards WHERE sets IS NOT NULL;');
  const s = new Set();
  for (const r of rows) for (const x of jp(r.sets, [])) if (x?.name) s.add(x.name);
  return [...s].sort();
}
export async function getArtists() {
  const rows = await query('SELECT variants FROM cards WHERE variants IS NOT NULL;');
  const s = new Set();
  for (const r of rows) for (const v of jp(r.variants, [])) if (v?.artist) s.add(v.artist);
  return [...s].sort();
}

/* ── Card query grammar ──
   Moved to ./cardQuery.js (pure, DB-free, unit-tested under `node --test`) and
   re-exported here so existing deckRepository importers keep working. See
   cardQuery.js for the full token grammar (name:/t:/r:/kw:/el:/e:/attack>/cost/
   th:/set:/rarity + the Codex-only has:/is: scope channel). */
export { parseQuery, parseCardQuery, cardMatchesQuery } from './cardQuery.js';

// Full card-pool query mirroring Arcanum's Refine filters: element (+multi),
// type, rarity, set, per-element & total threshold comparators, mana comparator,
// artist, and name/mana/element sort.
export async function getPool({
  q = '', els = [], types = [], rarities = [], sets = [], multi = false,
  thByEl = {}, totalTh = null, costCmp = null, artist = '', sort = [],
} = {}) {
  let sql = 'SELECT card_id, name, type, sub_types, cost, rarity, elements, thresholds, sets, variants, image_slug, is_site, rules_text, attack, defence, life FROM cards';
  const where = [], params = [];
  if (q) { where.push('lower(name) LIKE ?'); params.push(`%${q.toLowerCase()}%`); }
  if (types.length) { where.push(`type IN (${types.map(() => '?').join(',')})`); params.push(...types); }
  if (rarities.length) { where.push(`rarity IN (${rarities.map(() => '?').join(',')})`); params.push(...rarities); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  let rows = await query(sql + ';', params);

  if (els.length) rows = rows.filter((c) => { const th = jp(c.thresholds, {}); return els.some((e) => (th[e] || 0) > 0); });
  if (multi) rows = rows.filter((c) => _els(c).length > 1);
  if (sets.length) rows = rows.filter((c) => jp(c.sets, []).some((s) => sets.includes(s.name)));
  if (artist) rows = rows.filter((c) => jp(c.variants, []).some((v) => v.artist === artist));
  for (const el of ['air', 'earth', 'fire', 'water']) {
    const f = thByEl[el]; if (f && f.val != null) rows = rows.filter((c) => _cmp(jp(c.thresholds, {})[el] || 0, f.op, f.val));
  }
  if (totalTh && totalTh.val != null) rows = rows.filter((c) => _cmp(_totalTh(jp(c.thresholds, {})), totalTh.op, totalTh.val));
  if (costCmp && costCmp.val != null) rows = rows.filter((c) => _cmp(c.cost ?? 0, costCmp.op, costCmp.val));

  // Multi-key sort in priority order (Arcanum: tap to add, ↑/↓ per key).
  const KEY = {
    name: (c) => c.name.toLowerCase(),
    cost: (c) => c.cost ?? 0,
    element: (c) => (_els(c)[0] || 'zzz').toLowerCase(),
    th: (c) => _totalTh(jp(c.thresholds, {})),
  };
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

export async function exportMarkdown(deckId) {
  const d = await getDeck(deckId);
  const lines = [`# ${d.name}`];
  if (d.avatar) lines.push('', '## Avatar', `- 1× ${d.avatar.name}`);
  for (const zone of ZONES) {
    const groups = await zoneGroups(deckId, zone);
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

/** Parse Arcanum/Curiosa-style text into {avatar, zones:{zone:[{name,qty}]}}. */
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

/* ---- Curiosa-URL import (ported from Arcanum) ---- */

// Only a real device build can bypass CORS with CapacitorHttp. On web (incl. the
// dev preview), Capacitor's web shim would do a CORS-blocked direct fetch, so we
// must route through the Vite proxy instead.
function nativeHttp() {
  if (typeof window === 'undefined') return null;
  const isNative = window.Capacitor?.isNativePlatform?.() === true;
  return isNative ? (window.CapacitorHttp || window.Capacitor?.Plugins?.CapacitorHttp || null) : null;
}

// One tRPC query. Native: CapacitorHttp (bypasses CORS). Web: the Vite dev proxy
// at /curiosa (which injects the spoofed Origin/Referer). Returns the unwrapped json.
async function curiosaQuery(proc, id) {
  const input = encodeURIComponent(JSON.stringify({ 0: { json: { id } } }));
  const path = `/api/trpc/${proc}?batch=1&input=${input}`;
  const http = nativeHttp();
  let data;
  if (http) {
    const headers = { Origin: 'https://curiosa.io', Referer: `https://curiosa.io/decks/${id}`, 'User-Agent': 'Mozilla/5.0' };
    data = (await http.get({ url: 'https://curiosa.io' + path, headers })).data;
  } else {
    const res = await fetch('/curiosa' + path);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  }
  return data[0].result.data.json;
}

const resolveCardId = async (name) =>
  (await query('SELECT card_id FROM cards WHERE lower(name)=? LIMIT 1;', [String(name || '').toLowerCase()]))[0]?.card_id || null;

/** Import a Curiosa deck URL into a NEW deck. Maps Spell→spellbook, Site→atlas,
 *  sideboard→collection (verbatim Arcanum). Unresolved cards → warnings (kept as
 *  placeholders so nothing is lost). Returns { id, name, warnings }. */
export async function importCuriosaUrl(rawUrl) {
  const m = /\/decks\/([a-z0-9]+)/i.exec(rawUrl || '');
  const id = m ? m[1] : (/^[a-z0-9]{16,}$/i.test(rawUrl || '') ? rawUrl : null);
  if (!id) throw new Error('Could not find a Curiosa deck id in that URL.');

  const meta = await curiosaQuery('deck.getById', id);
  const main = await curiosaQuery('deck.getDecklistById', id);
  let side = [];
  try { side = await curiosaQuery('deck.getSideboardById', id); } catch { /* no sideboard */ }

  const warnings = [];
  const avName = meta?.avatars?.[0]?.card?.name || null;
  const avatarId = avName ? await resolveCardId(avName) : null;
  if (avName && !avatarId) warnings.push(avName);

  const name = (meta?.name || 'Imported Deck').trim();
  const deckId = await createDeck(name, { avatarCardId: avatarId });

  const stmts = [];
  const add = async (arr, zone, cat) => {
    for (const e of arr || []) {
      if (cat && (e.card?.category) !== cat) continue;
      const nm = e.card?.name;
      const cid = await resolveCardId(nm);
      if (!cid && nm) warnings.push(nm);
      stmts.push(['INSERT INTO deck_entries(id,deck_id,zone,card_id,quantity,variant_slug) VALUES(?,?,?,?,?,?);',
        [uuid(), deckId, zone, cid, e.quantity || 1, '']]);
    }
  };
  await add(main, 'spellbook', 'Spell');
  await add(main, 'atlas', 'Site');
  await add(side, 'collection', null);
  if (stmts.length) await tx(stmts);

  await touch(deckId, 'curiosa_url=?', [`https://curiosa.io/decks/${id}`]);
  await logHistory(deckId, 'Imported from Curiosa');
  return { id: deckId, name, warnings: [...new Set(warnings)] };
}

/** Import parsed text into a NEW deck for the active profile. Unresolved cards
 *  are kept as placeholders (card_id null) so nothing silently disappears. */
export async function importFromText(text, deckName) {
  const { avatar, zones } = parseDeckText(text);
  let avatarId = null;
  if (avatar) avatarId = (await query('SELECT card_id FROM cards WHERE lower(name)=? LIMIT 1;', [avatar.toLowerCase()]))[0]?.card_id || null;
  const id = await createDeck(deckName || 'Imported deck', { avatarCardId: avatarId });
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
