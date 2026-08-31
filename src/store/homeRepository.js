// Home / Dashboard data - customisable widget blocks (the Codex dashboard,
// re-homed) + cross-pillar data providers (Saved, Notes, Folios,
// Stats, Resume, Errata, Random, and the new Decks/Duels widgets). Profile-scoped.
import { query, run, tx } from './db.js';
import { activeProfileId } from './profileRepository.js';
import { uuid, nowIso } from './ids.js';
import { listDecks } from './deckRepository.js';
import { listMatches, historyStats } from './playRepository.js';
import { collectionStats, deckBuildabilityBulk } from './ownedRepository.js';
import {
  WIDGETS, widgetMeta, isStructural, isRollable, pillarOf,
  normalizeKind, isSupportedWidget, filterImportedBlocks,
} from './widgetRegistry.js';

// The widget catalogue and its pure helpers live in ./widgetRegistry.js (persistence-
// free, so they import cleanly into tests and profileTransfer). Re-exported here
// because the rest of the app imports them from homeRepository.
export { WIDGETS, widgetMeta, isStructural, isRollable, pillarOf, isSupportedWidget };

const DEFAULTS = [
  ['winRate', 'half'], ['deckSpotlight', 'half'],
  ['featuredCard', 'full'],
  ['recentMatches', 'half'], ['notes', 'half'],
];

/* ---------------- block CRUD ---------------- */

let seedingFor = null;   // guards default-seed against concurrent callers (StrictMode)

// A persistent, per-profile flag (in catalog_meta, which survives catalog
// re-seeds) marking that the starter dashboard has been laid down once. Without
// it we'd re-seed every time the block count hit 0 - so emptying the dashboard
// on purpose would silently repopulate it.
const seededKey = (pid) => `dash_seeded:${pid}`;
async function isSeeded(pid) { return (await query('SELECT 1 FROM catalog_meta WHERE key=?;', [seededKey(pid)])).length > 0; }
async function markSeeded(pid) { await run("INSERT OR REPLACE INTO catalog_meta(key,value) VALUES(?, '1');", [seededKey(pid)]); }

async function seedDefaults(pid) {
  const c = (await query('SELECT COUNT(*) c FROM dashboard_blocks WHERE profile_id=?;', [pid]))[0].c;
  if (c > 0) return;       // re-check inside the guard - never double-seed
  let i = 0;
  for (const [kind, width] of DEFAULTS) {
    await run('INSERT INTO dashboard_blocks(id,profile_id,type,width,config,sort_order,created_at) VALUES(?,?,?,?,?,?,?);',
      [uuid(), pid, kind, width, '{}', i++, nowIso()]);
  }
}

export async function listBlocks() {
  const pid = activeProfileId();
  let rows = await query('SELECT * FROM dashboard_blocks WHERE profile_id=? ORDER BY sort_order ASC;', [pid]);
  const seeded = await isSeeded(pid);
  // Seed the starter layout ONLY on genuine first run - an empty dashboard the
  // user cleared themselves is respected, not repopulated.
  if (rows.length === 0 && !seeded) {
    if (!seedingFor) seedingFor = seedDefaults(pid).finally(() => { seedingFor = null; });
    await seedingFor;
    rows = await query('SELECT * FROM dashboard_blocks WHERE profile_id=? ORDER BY sort_order ASC;', [pid]);
  }
  if (!seeded) await markSeeded(pid);   // flag on first load (covers pre-existing dashboards too)
  // Defence in depth: never hand the renderer a retired widget type, even if a row
  // slipped past the v10 migration.
  return filterImportedBlocks(rows.map((r) => ({ ...r, type: normalizeKind(r.type), config: safeParse(r.config) })));
}

export async function addBlock(kind) {
  const pid = activeProfileId();
  const max = (await query('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM dashboard_blocks WHERE profile_id=?;', [pid]))[0].n;
  await run('INSERT INTO dashboard_blocks(id,profile_id,type,width,config,sort_order,created_at) VALUES(?,?,?,?,?,?,?);',
    [uuid(), pid, kind, 'half', '{}', max, nowIso()]);
}
export async function removeBlock(id) { await run('DELETE FROM dashboard_blocks WHERE id=? AND profile_id=?;', [id, activeProfileId()]); }
export async function resizeBlock(id, width) { await run('UPDATE dashboard_blocks SET width=? WHERE id=? AND profile_id=?;', [width, id, activeProfileId()]); }
export async function setConfig(id, config) { await run('UPDATE dashboard_blocks SET config=? WHERE id=? AND profile_id=?;', [JSON.stringify(config), id, activeProfileId()]); }

/* ---- saved layouts (named snapshots; loading replaces the live dashboard) ---- */
export async function saveLayout(name) {
  const pid = activeProfileId();
  const blocks = await query('SELECT type, width, config, sort_order FROM dashboard_blocks WHERE profile_id=? ORDER BY sort_order ASC;', [pid]);
  await run('INSERT INTO dashboard_layouts(id,profile_id,name,blocks,saved_at) VALUES(?,?,?,?,?);', [uuid(), pid, name, JSON.stringify(blocks), nowIso()]);
}
export async function listLayouts() {
  return query('SELECT id, name, saved_at FROM dashboard_layouts WHERE profile_id=? ORDER BY saved_at DESC;', [activeProfileId()]);
}
export async function loadLayout(id) {
  const pid = activeProfileId();
  const row = (await query('SELECT blocks FROM dashboard_layouts WHERE id=? AND profile_id=?;', [id, pid]))[0];
  if (!row) return;
  // Filter retired widget types out of the snapshot before applying it, so an old
  // saved layout can't re-create a block the app no longer renders.
  const blocks = filterImportedBlocks(safeParse(row.blocks) || []);
  const stmts = [['DELETE FROM dashboard_blocks WHERE profile_id=?;', [pid]]];
  blocks.forEach((b, i) => stmts.push([
    'INSERT INTO dashboard_blocks(id,profile_id,type,width,config,sort_order,created_at) VALUES(?,?,?,?,?,?,?);',
    [uuid(), pid, b.type, b.width || 'half', typeof b.config === 'string' ? b.config : JSON.stringify(b.config || {}), b.sort_order ?? i, nowIso()],
  ]));
  await tx(stmts);
}
export async function deleteLayout(id) { await run('DELETE FROM dashboard_layouts WHERE id=? AND profile_id=?;', [id, activeProfileId()]); }

/** Persist a full drag-reordered sequence of block ids (sort_order = index). */
export async function reorderBlocks(ids) {
  const pid = activeProfileId();
  await tx(ids.map((id, i) => ['UPDATE dashboard_blocks SET sort_order=? WHERE id=? AND profile_id=?;', [i, id, pid]]));
}

/* ---------------- target resolution ---------------- */

async function resolveTarget(type, id) {
  if (type === 'card') { const c = (await query('SELECT name,type,cost FROM cards WHERE card_id=?;', [id]))[0]; return c && { name: c.name, meta: `${c.type} · ${c.cost ?? 0}`, glyph: '◈' }; }
  if (type === 'rule') { const r = (await query('SELECT title FROM rules WHERE rule_id=?;', [id]))[0]; return r && { name: r.title, meta: 'Keyword', glyph: '§' }; }
  if (type === 'deck') { const d = (await query('SELECT name,archetype FROM decks WHERE id=?;', [id]))[0]; return d && { name: d.name, meta: d.archetype || 'Deck', glyph: '◆' }; }
  return null;
}

/** Batch form of resolveTarget: one IN query per target type present instead of
    one query per row. Returns a Map keyed `<type>:<id>`; missing/unknown targets
    are simply absent (callers skip them, exactly as resolveTarget's null did). */
async function resolveTargets(pairs) {
  const ids = (type) => [...new Set(pairs.filter((p) => p.type === type).map((p) => p.id))];
  const ph = (list) => list.map(() => '?').join(',');
  const map = new Map();
  const cardIds = ids('card'), ruleIds = ids('rule'), deckIds = ids('deck');
  if (cardIds.length) {
    for (const r of await query(`SELECT card_id,name,type,cost FROM cards WHERE card_id IN (${ph(cardIds)});`, cardIds))
      map.set('card:' + r.card_id, { name: r.name, meta: `${r.type} · ${r.cost ?? 0}`, glyph: '◈' });
  }
  if (ruleIds.length) {
    for (const r of await query(`SELECT rule_id,title FROM rules WHERE rule_id IN (${ph(ruleIds)});`, ruleIds))
      map.set('rule:' + r.rule_id, { name: r.title, meta: 'Keyword', glyph: '§' });
  }
  if (deckIds.length) {
    for (const d of await query(`SELECT id,name,archetype FROM decks WHERE id IN (${ph(deckIds)});`, deckIds))
      map.set('deck:' + d.id, { name: d.name, meta: d.archetype || 'Deck', glyph: '◆' });
  }
  return map;
}

/* ---------------- per-widget data ---------------- */

// `ctx` is a per-dashboard-load cache so widgets that need the same expensive
// source share ONE fetch: Deck Spotlight + Your Decks + Card Collection all want
// listDecks() (3 queries + enrichment each), so without this a 3-widget board ran
// it three times. Pass the same ctx object to every widgetData() call in a load.
const _decks = (ctx) => (ctx.decks ||= listDecks());

export async function widgetData(block, ctx = {}) {
  const pid = activeProfileId();
  const k = normalizeKind(block.type);

  if (k === 'title' || k === 'separator') return {};

  if (k === 'winRate') {
    const s = await historyStats();
    return { winPct: s.winPct, wins: s.wins, losses: s.losses, total: s.total, streak: s.streak, last8: s.last8, empty: 'No matches yet.' };
  }
  if (k === 'recentMatches') {
    const ms = await listMatches(6); const s = await historyStats();
    return { count: s.total, items: ms.map((m) => ({ name: m.opponent_name ? `vs. ${m.opponent_name}` : 'Match', won: m.winner === 'player', draw: m.winner === 'draw', score: `${m.player_final_life}–${m.opponent_final_life}` })), empty: 'No matches yet.' };
  }
  if (k === 'nemesis') {
    const rows = await query("SELECT opponent_name, winner FROM matches WHERE profile_id=? AND opponent_name IS NOT NULL AND opponent_name!='';", [pid]);
    const map = {};
    for (const r of rows) { const m = (map[r.opponent_name] ||= { name: r.opponent_name, w: 0, l: 0, g: 0 }); m.g++; if (r.winner === 'player') m.w++; else if (r.winner === 'opponent') m.l++; }
    const items = Object.values(map).sort((a, b) => b.g - a.g).slice(0, 6);
    return { count: items.length, items, empty: 'Play named opponents to build rivalries.' };
  }
  if (k === 'deckSpotlight') {
    const decks = await _decks(ctx);
    if (!decks.length) return { empty: 'No decks yet - build one in Decks.' };
    const pick = decks.find((d) => d.starred) || [...decks].sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses))[0];
    return { spotlight: { id: pick.id, name: pick.name, image: pick.avatar?.image_slug || null, record: pick.record, winPct: pick.winPct, elems: pick.elems || [] } };
  }
  if (k === 'yourDecks') {
    const decks = await _decks(ctx);
    return { count: decks.length, decks: decks.slice(0, 8).map((d) => ({ id: d.id, name: d.name, image: d.avatar?.image_slug || null, record: d.record })), empty: 'No decks yet - build one in Decks.' };
  }
  if (k === 'collectionStats') {
    const [s, decks] = await Promise.all([collectionStats(), _decks(ctx)]);
    const reports = await deckBuildabilityBulk(decks.map((d) => d.id));
    let buildable = 0; for (const rep of reports.values()) if (rep.complete && rep.totalRequired > 0) buildable++;
    return { owned: s.owned, unique: s.unique, wishlist: s.wishlist, buildable, decks: decks.length, empty: 'No cards owned yet.' };
  }
  if (k === 'featuredCard' || k === 'cardOfDay') {
    const n = (await query('SELECT COUNT(*) c FROM cards;'))[0].c;
    const off = k === 'cardOfDay' ? (Math.floor(Date.now() / 86400000) % Math.max(1, n)) : Math.floor(Math.random() * Math.max(1, n));
    const row = (await query('SELECT card_id,name,type,cost,image_slug,rarity FROM cards LIMIT 1 OFFSET ?;', [off]))[0];
    return { card: row ? { id: row.card_id, name: row.name, type: row.type, cost: row.cost, image: row.image_slug, rarity: row.rarity } : null, empty: 'No cards in the catalogue.' };
  }
  if (k === 'randomRule') {
    const n = (await query('SELECT COUNT(*) c FROM rules WHERE parent_id IS NULL;'))[0].c;
    const off = Math.floor(Math.random() * Math.max(1, n));
    const row = (await query('SELECT rule_id id, title FROM rules WHERE parent_id IS NULL LIMIT 1 OFFSET ?;', [off]))[0];
    return { rule: row ? { id: row.id, name: row.title } : null, empty: '-' };
  }
  if (k === 'pinned') {
    const rows = await query('SELECT target_type,target_id FROM saved WHERE profile_id=? ORDER BY created_at DESC LIMIT 50;', [pid]);
    const resolved = await resolveTargets(rows.map((r) => ({ type: r.target_type, id: r.target_id })));
    const items = [];
    for (const r of rows) { const t = resolved.get(r.target_type + ':' + r.target_id); if (t) items.push({ ...t, type: r.target_type, id: r.target_id }); }
    return { count: items.length, items, empty: 'Bookmark a rule, card, or deck to keep it here.' };
  }
  if (k === 'notes') {
    const rows = await query('SELECT body, target_type, target_id FROM notes WHERE profile_id=? ORDER BY updated_at DESC LIMIT 6;', [pid]);
    const count = (await query('SELECT COUNT(*) c FROM notes WHERE profile_id=?;', [pid]))[0].c;
    const resolved = await resolveTargets(rows.map((r) => ({ type: r.target_type, id: r.target_id })));
    const items = rows.map((r) => { const t = resolved.get(r.target_type + ':' + r.target_id); return { body: r.body, on: t?.name || '', type: r.target_type, id: r.target_id }; });
    return { count, items, quotes: true, empty: 'No marginalia yet.' };
  }
  // Folios - the user-facing name. The tables keep their v1 names
  // collections/collection_items; the rename is deferred (see codexRepository).
  if (k === 'folios') {
    const folios = await query('SELECT id,name FROM collections WHERE profile_id=? ORDER BY created_at DESC;', [pid]);
    if (folios.length) {
      const counts = await query(`SELECT collection_id, COUNT(*) n FROM collection_items WHERE collection_id IN (${folios.map(() => '?').join(',')}) GROUP BY collection_id;`, folios.map((f) => f.id));
      const byId = new Map(counts.map((r) => [r.collection_id, r.n]));
      for (const f of folios) f.n = byId.get(f.id) || 0;
    }
    return { count: folios.length, items: folios.map((f) => ({ name: f.name, meta: `${f.n} item${f.n === 1 ? '' : 's'}`, iconType: 'folio' })), empty: 'No folios yet.' };
  }
  if (k === 'note') return { text: block.config?.text || '' };
  if (k === 'links') return { links: block.config?.links || [] };
  return {};
}

/* ---------------- picker previews ---------------- */

// Representative mock data shaped exactly like widgetData(), used to render the
// live widget previews in the Add-a-widget sheet. Art widgets carry NO image -
// previews render a neutral placeholder card shape, never real card art.
export function sampleData(kind) {
  const k = normalizeKind(kind);
  switch (k) {
    case 'winRate': return { winPct: 68, wins: 17, losses: 8, total: 25, streak: 3, last8: ['W', 'W', 'L', 'W', 'D', 'W', 'L', 'W'] };
    case 'recentMatches': return { items: [{ name: 'vs. Alex', won: true, score: '20–4' }, { name: 'vs. Sam', won: false, score: '0–13' }, { name: 'vs. Robin', won: true, score: '20–9' }] };
    case 'nemesis': return { items: [{ name: 'Alex', w: 4, l: 1, g: 5 }, { name: 'Sam', w: 1, l: 3, g: 4 }, { name: 'Robin', w: 2, l: 2, g: 4 }] };
    case 'deckSpotlight': return { spotlight: { name: 'Aggro Flare', image: null, record: '12–5', winPct: 71, elems: [{ el: 'fire' }, { el: 'earth' }] } };
    case 'yourDecks': return { decks: [{ name: 'Aggro Flare', image: null, record: '12–5' }, { name: 'Tide Control', image: null, record: '8–6' }, { name: 'Stone Wall', image: null, record: '5–3' }] };
    case 'featuredCard': return { card: { name: 'Avatar of Fire', type: 'Avatar', cost: 0, image: null, rarity: 'Elite' } };
    case 'cardOfDay': return { card: { name: 'Wildfire', type: 'Magic', cost: 3, image: null } };
    case 'notes': return { quotes: true, items: [{ body: 'Rush lets a minion attack the turn it enters play.', on: 'Rush' }, { body: 'Genesis triggers when the card enters.', on: 'Genesis' }] };
    case 'folios': return { items: [{ name: 'Fire staples', meta: '12 items', iconType: 'folio' }, { name: 'Want list', meta: '5 items', iconType: 'folio' }] };
    case 'collectionStats': return { owned: 342, unique: 168, wishlist: 12, buildable: 3, decks: 5 };
    case 'randomRule': return { rule: { name: 'Deathrite' } };
    case 'pinned': return { items: [{ name: 'Sparkmage', meta: 'Card', type: 'card' }, { name: 'Charge', meta: 'Keyword', type: 'rule' }, { name: 'Aggro Flare', meta: 'Deck', type: 'deck' }] };
    case 'note': return { text: 'Playtest: side in extra removal vs aggro. Watch the water matchup.' };
    case 'links': return { links: [{ label: 'SorceryTCG deck', url: 'https://sorcerytcg.com' }, { label: 'Rules PDF', url: 'https://sorcerytcg.com' }] };
    case 'title': return { text: 'My Layout' };
    case 'separator': return {};
    default: return {};
  }
}

/* ---------------- resume + overview ---------------- */

export async function setResume(type, id, title) {
  await run('INSERT OR REPLACE INTO resume(profile_id,target_type,target_id,title,at) VALUES(?,?,?,?,?);',
    [activeProfileId(), type, id, title, nowIso()]);
}

// Overview = the welcome screen: key stats (doorways into every pillar) +
// tightly CAPPED sections. Caps are hard - libraries, marginalia and match
// history can grow huge; Overview always shows a digest and redirects to the
// pillar where the items actually live.
const OV_DECKS = 8, OV_NOTES = 3, OV_DUELS = 3, OV_BOOKMARKS = 4;

export async function overview() {
  const pid = activeProfileId();
  let resume = (await query('SELECT * FROM resume WHERE profile_id=?;', [pid]))[0] || null;
  // Drop a resume target that no longer exists (e.g. deck was deleted) - a dead
  // "Jump back in" tile would otherwise open a deck that can never load.
  if (resume && !(await resolveTarget(resume.target_type, resume.target_id))) {
    await run('DELETE FROM resume WHERE profile_id=?;', [pid]);
    resume = null;
  }
  const allDecks = await listDecks();
  const stats = await historyStats();
  const duelItems = (await listMatches(OV_DUELS)).map((m) => ({
    name: m.opponent_name ? `vs. ${m.opponent_name}` : (m.player_avatar ? `${m.player_avatar} vs ${m.opponent_avatar || 'Opponent'}` : 'Match'),
    deck: m.deck_name || null,
    won: m.winner === 'player', draw: m.winner === 'draw',
    score: `${m.player_final_life}–${m.opponent_final_life}`,
  }));
  const cnt = async (t) => (await query(`SELECT COUNT(*) c FROM ${t} WHERE profile_id=?;`, [pid]))[0].c;
  // `collections` is the folios table under its v1 name - the MARGINALIA glance
  // counts folios alongside notes and links, so a folios-only reader is not told 0.
  const [savedN, notesN, linksN, foliosN] = await Promise.all([cnt('saved'), cnt('notes'), cnt('links'), cnt('collections')]);
  // Total copies owned (not distinct cards) - the "Cards collected" glance figure.
  const cardsCollected = (await query('SELECT COALESCE(SUM(qty_owned),0) n FROM owned_cards WHERE profile_id=?;', [pid]))[0].n;
  const noteRows = await query('SELECT body,target_type,target_id FROM notes WHERE profile_id=? ORDER BY updated_at DESC LIMIT ?;', [pid, OV_NOTES]);
  const bmRows = await query('SELECT target_type,target_id FROM saved WHERE profile_id=? ORDER BY created_at DESC LIMIT ?;', [pid, OV_BOOKMARKS]);
  // Resolve note + bookmark targets with the batch helper (one query per kind)
  // instead of resolveTarget() per row.
  const resolved = await resolveTargets([...noteRows, ...bmRows].map((r) => ({ type: r.target_type, id: r.target_id })));
  const at = (r) => resolved.get(r.target_type + ':' + r.target_id);
  const notes = noteRows.map((r) => { const t = at(r); return { body: r.body, on: t?.name || '', type: r.target_type, id: r.target_id }; });
  const bookmarks = [];
  for (const r of bmRows) { const t = at(r); if (t) bookmarks.push({ name: t.name, meta: t.meta, type: r.target_type, id: r.target_id }); }
  return {
    resume,
    glance: {
      decks: allDecks.length,
      duels: stats.total,
      winPct: stats.winPct,           // null until a game is decided
      saved: savedN,
      marginalia: notesN + linksN + foliosN,
      cardsCollected,
    },
    decks: { total: allDecks.length, items: allDecks.slice(0, OV_DECKS) },
    duels: { stats, items: duelItems },
    bookmarks: { count: savedN, items: bookmarks },
    notes: { count: notesN, items: notes },
  };
}

function safeParse(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }
