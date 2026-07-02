// Home / Dashboard data — customisable widget blocks (the Lexicum dashboard,
// re-homed) + cross-pillar data providers (Saved, Notes, Highlights, Collections,
// Stats, Resume, Errata, Random, and the new Decks/Duels widgets). Profile-scoped.
import { query, run, tx } from './db.js';
import { activeProfileId } from './profileRepository.js';
import { uuid, nowIso } from './ids.js';
import { listDecks } from './deckRepository.js';
import { listMatches, historyStats } from './playRepository.js';

// All widget kinds. The first five are the mockup defaults; the rest are the
// full Lexicum set (+ cross-pillar decks/duels). configurable -> shows a ⚙.
export const WIDGETS = [
  { kind: 'saved', title: 'Saved' },
  { kind: 'duels', title: 'Recent Matches' },
  { kind: 'random', title: 'Random Card' },
  { kind: 'notes', title: 'Notes & Rulings' },
  { kind: 'decks', title: 'Your Decks' },
  { kind: 'highlights', title: 'Highlights' },
  { kind: 'collections', title: 'Collections' },
  { kind: 'stats', title: 'At a Glance' },
  { kind: 'resume', title: 'Jump Back In' },
  { kind: 'errata', title: 'Errata' },
  { kind: 'randomArticle', title: 'Random Rule' },
  { kind: 'text', title: 'Note', configurable: true },
  { kind: 'collection', title: 'Collection', configurable: true },
  { kind: 'urls', title: 'Links', configurable: true },
];
export const widgetTitle = (k) => WIDGETS.find((w) => w.kind === k)?.title || k;
export const isConfigurable = (k) => !!WIDGETS.find((w) => w.kind === k)?.configurable;

const DEFAULTS = [
  ['saved', 'full'], ['duels', 'half'], ['random', 'half'], ['notes', 'full'], ['decks', 'half'],
];

/* ---------------- block CRUD ---------------- */

let seedingFor = null;   // guards default-seed against concurrent callers (StrictMode)

async function seedDefaults(pid) {
  const c = (await query('SELECT COUNT(*) c FROM dashboard_blocks WHERE profile_id=?;', [pid]))[0].c;
  if (c > 0) return;       // re-check inside the guard — never double-seed
  let i = 0;
  for (const [kind, width] of DEFAULTS) {
    await run('INSERT INTO dashboard_blocks(id,profile_id,type,width,config,sort_order,created_at) VALUES(?,?,?,?,?,?,?);',
      [uuid(), pid, kind, width, '{}', i++, nowIso()]);
  }
}

export async function listBlocks() {
  const pid = activeProfileId();
  let rows = await query('SELECT * FROM dashboard_blocks WHERE profile_id=? ORDER BY sort_order ASC;', [pid]);
  if (rows.length === 0) {
    if (!seedingFor) seedingFor = seedDefaults(pid).finally(() => { seedingFor = null; });
    await seedingFor;
    rows = await query('SELECT * FROM dashboard_blocks WHERE profile_id=? ORDER BY sort_order ASC;', [pid]);
  }
  return rows.map((r) => ({ ...r, config: safeParse(r.config) }));
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
  const blocks = safeParse(row.blocks) || [];
  const stmts = [['DELETE FROM dashboard_blocks WHERE profile_id=?;', [pid]]];
  blocks.forEach((b, i) => stmts.push([
    'INSERT INTO dashboard_blocks(id,profile_id,type,width,config,sort_order,created_at) VALUES(?,?,?,?,?,?,?);',
    [uuid(), pid, b.type, b.width || 'half', typeof b.config === 'string' ? b.config : JSON.stringify(b.config || {}), b.sort_order ?? i, nowIso()],
  ]));
  await tx(stmts);
}
export async function deleteLayout(id) { await run('DELETE FROM dashboard_layouts WHERE id=? AND profile_id=?;', [id, activeProfileId()]); }

export async function moveBlock(id, dir) {
  const blocks = await listBlocks();
  const i = blocks.findIndex((b) => b.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= blocks.length) return;
  const a = blocks[i], b = blocks[j];
  await run('UPDATE dashboard_blocks SET sort_order=? WHERE id=?;', [b.sort_order, a.id]);
  await run('UPDATE dashboard_blocks SET sort_order=? WHERE id=?;', [a.sort_order, b.id]);
}

/* ---------------- target resolution ---------------- */

async function resolveTarget(type, id) {
  if (type === 'card') { const c = (await query('SELECT name,type,cost FROM cards WHERE card_id=?;', [id]))[0]; return c && { name: c.name, meta: `${c.type} · ${c.cost ?? 0}`, glyph: '◈' }; }
  if (type === 'rule') { const r = (await query('SELECT title FROM rules WHERE rule_id=?;', [id]))[0]; return r && { name: r.title, meta: 'Keyword', glyph: '§' }; }
  if (type === 'deck') { const d = (await query('SELECT name,archetype FROM decks WHERE id=?;', [id]))[0]; return d && { name: d.name, meta: d.archetype || 'Deck', glyph: '◆' }; }
  return null;
}

/* ---------------- per-widget data ---------------- */

export async function widgetData(block) {
  const pid = activeProfileId();
  const k = block.type;
  if (k === 'saved') {
    const rows = await query('SELECT target_type,target_id FROM saved WHERE profile_id=? ORDER BY created_at DESC LIMIT 50;', [pid]);
    const items = [];
    for (const r of rows) { const t = await resolveTarget(r.target_type, r.target_id); if (t) items.push({ ...t, type: r.target_type, id: r.target_id }); }
    return { count: items.length, items, empty: 'Star a rule, card, or deck to pin it here.' };
  }
  if (k === 'notes') {
    const rows = await query('SELECT n.body, n.target_type, n.target_id FROM notes n WHERE n.profile_id=? ORDER BY n.updated_at DESC LIMIT 6;', [pid]);
    const count = (await query('SELECT COUNT(*) c FROM notes WHERE profile_id=?;', [pid]))[0].c;
    const items = [];
    for (const r of rows) { const t = await resolveTarget(r.target_type, r.target_id); items.push({ body: r.body, on: t?.name || '', type: r.target_type, id: r.target_id }); }
    return { count, items, quotes: true, empty: 'No marginalia yet.' };
  }
  if (k === 'highlights') {
    const rows = await query('SELECT text, comment, target_type, target_id FROM highlights WHERE profile_id=? ORDER BY created_at DESC LIMIT 6;', [pid]);
    const count = (await query('SELECT COUNT(*) c FROM highlights WHERE profile_id=?;', [pid]))[0].c;
    return { count, items: rows.map((r) => ({ body: r.text, on: r.comment, type: r.target_type, id: r.target_id })), quotes: true, empty: 'No highlights yet.' };
  }
  if (k === 'collections') {
    const cols = await query('SELECT id,name FROM collections WHERE profile_id=? ORDER BY created_at DESC;', [pid]);
    for (const c of cols) c.n = (await query('SELECT COUNT(*) n FROM collection_items WHERE collection_id=?;', [c.id]))[0].n;
    return { count: cols.length, items: cols.map((c) => ({ name: c.name, meta: `${c.n} item${c.n === 1 ? '' : 's'}`, glyph: '❧' })), empty: 'No collections yet.' };
  }
  if (k === 'collection') {
    const cid = block.config?.collectionId;
    if (!cid) return { count: 0, items: [], empty: 'Open Edit ⚙ to choose a collection.' };
    const name = (await query('SELECT name FROM collections WHERE id=?;', [cid]))[0]?.name;
    const rows = await query('SELECT target_type,target_id FROM collection_items WHERE collection_id=? LIMIT 50;', [cid]);
    const items = [];
    for (const r of rows) { const t = await resolveTarget(r.target_type, r.target_id); if (t) items.push({ ...t, type: r.target_type, id: r.target_id }); }
    return { title: name, count: items.length, items, empty: 'Empty collection.' };
  }
  if (k === 'stats') {
    const one = async (t) => (await query(`SELECT COUNT(*) c FROM ${t} WHERE profile_id=?;`, [pid]))[0].c;
    return { stats: [['Saved', await one('saved')], ['Notes', await one('notes')], ['Highlights', await one('highlights')], ['Collections', await one('collections')]] };
  }
  if (k === 'resume') {
    const r = (await query('SELECT * FROM resume WHERE profile_id=?;', [pid]))[0];
    return r ? { resume: { type: r.target_type, id: r.target_id, title: r.title } } : { empty: 'Open a rule, card, or deck and it lands here.' };
  }
  if (k === 'errata') {
    const rows = await query("SELECT card_id,name FROM cards WHERE rules_text LIKE 'UPDATED%' ORDER BY name LIMIT 50;");
    return { count: rows.length, items: rows.map((r) => ({ name: r.name, meta: 'Errata', glyph: '◈', type: 'card', id: r.card_id })), empty: 'No errata.' };
  }
  if (k === 'random' || k === 'randomArticle') {
    const tbl = k === 'random' ? 'cards' : 'rules';
    const idCol = k === 'random' ? 'card_id' : 'rule_id';
    const nameCol = k === 'random' ? 'name' : 'title';
    const n = (await query(`SELECT COUNT(*) c FROM ${tbl}${k === 'randomArticle' ? ' WHERE parent_id IS NULL' : ''};`))[0].c;
    const off = Math.floor(Math.random() * Math.max(1, n));
    const row = (await query(`SELECT ${idCol} id, ${nameCol} name FROM ${tbl}${k === 'randomArticle' ? ' WHERE parent_id IS NULL' : ''} LIMIT 1 OFFSET ?;`, [off]))[0];
    return { random: row ? { name: row.name, type: k === 'random' ? 'card' : 'rule', id: row.id } : null };
  }
  if (k === 'decks') {
    const decks = await listDecks();
    return { count: decks.length, items: decks.slice(0, 6).map((d) => ({ name: d.name, meta: d.archetype || d.record, glyph: '◆', type: 'deck', id: d.id })), empty: 'No decks yet.' };
  }
  if (k === 'duels') {
    const ms = await listMatches(6); const s = await historyStats();
    return { count: s.total, record: `${s.wins}–${s.losses}`, items: ms.map((m) => ({ name: m.opponent_name ? `vs. ${m.opponent_name}` : 'Match', won: m.winner === 'player', draw: m.winner === 'draw', score: `${m.player_final_life}–${m.opponent_final_life}` })), empty: 'No matches yet.' };
  }
  if (k === 'text') return { text: block.config?.text || '' };
  if (k === 'urls') return { links: block.config?.links || [] };
  return {};
}

/* ---------------- resume + overview ---------------- */

export async function setResume(type, id, title) {
  await run('INSERT OR REPLACE INTO resume(profile_id,target_type,target_id,title,at) VALUES(?,?,?,?,?);',
    [activeProfileId(), type, id, title, nowIso()]);
}

// Overview = the welcome screen: key stats (doorways into every pillar) +
// tightly CAPPED sections. Caps are hard — libraries, marginalia and match
// history can grow huge; Overview always shows a digest and redirects to the
// pillar where the items actually live.
const OV_DECKS = 8, OV_NOTES = 3, OV_DUELS = 3;

export async function overview() {
  const pid = activeProfileId();
  const resume = (await query('SELECT * FROM resume WHERE profile_id=?;', [pid]))[0] || null;
  const allDecks = await listDecks();
  const stats = await historyStats();
  const duelItems = (await listMatches(OV_DUELS)).map((m) => ({
    name: m.opponent_name ? `vs. ${m.opponent_name}` : (m.player_avatar ? `${m.player_avatar} vs ${m.opponent_avatar || 'Opponent'}` : 'Match'),
    deck: m.deck_name || null,
    won: m.winner === 'player', draw: m.winner === 'draw',
    score: `${m.player_final_life}–${m.opponent_final_life}`,
  }));
  const cnt = async (t) => (await query(`SELECT COUNT(*) c FROM ${t} WHERE profile_id=?;`, [pid]))[0].c;
  const [savedN, notesN, hlN, linksN] = await Promise.all([cnt('saved'), cnt('notes'), cnt('highlights'), cnt('links')]);
  const noteRows = await query('SELECT body,target_type,target_id FROM notes WHERE profile_id=? ORDER BY updated_at DESC LIMIT ?;', [pid, OV_NOTES]);
  const notes = [];
  for (const r of noteRows) { const t = await resolveTarget(r.target_type, r.target_id); notes.push({ body: r.body, on: t?.name || '', type: r.target_type, id: r.target_id }); }
  return {
    resume,
    glance: {
      decks: allDecks.length,
      duels: stats.total,
      winPct: stats.winPct,           // null until a game is decided
      saved: savedN,
      marginalia: notesN + hlN + linksN,
    },
    decks: { total: allDecks.length, items: allDecks.slice(0, OV_DECKS) },
    duels: { stats, items: duelItems },
    notes: { count: notesN, items: notes },
  };
}

function safeParse(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }
