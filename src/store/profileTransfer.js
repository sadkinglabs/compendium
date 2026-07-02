// Profile export / import — a single self-describing JSON bundle (§4-E).
// Export gathers every profile-scoped row; import re-keys all ids and writes the
// bundle into a NEW profile in one transaction. Catalogue refs (card_id/rule_id)
// are preserved as-is. Forward-only: an older schemaVersion still imports.
import { query, tx } from './db.js';
import { activeProfileId, createProfile, switchProfile, renameProfile } from './profileRepository.js';
import { SCHEMA_VERSION } from './schema.js';
import { uuid, nowIso } from './ids.js';
import { saveTextFile } from '../native.js';

const inClause = (ids) => ids.length ? `(${ids.map(() => '?').join(',')})` : '(NULL)';

/** Build the portable bundle for a profile (defaults to the active one). */
export async function exportProfile(profileId = activeProfileId()) {
  const profile = (await query('SELECT * FROM profiles WHERE id=?;', [profileId]))[0];
  if (!profile) throw new Error('Profile not found.');

  const decks = await query('SELECT * FROM decks WHERE profile_id=?;', [profileId]);
  const collections = await query('SELECT * FROM collections WHERE profile_id=?;', [profileId]);
  const matches = await query('SELECT * FROM matches WHERE profile_id=?;', [profileId]);
  const deckIds = decks.map((d) => d.id);
  const colIds = collections.map((c) => c.id);
  const matchIds = matches.map((m) => m.id);

  return {
    app: 'compendium', schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(),
    profile: { name: profile.name, avatar: profile.avatar, accent: profile.accent },
    decks,
    deck_entries: await query(`SELECT * FROM deck_entries WHERE deck_id IN ${inClause(deckIds)};`, deckIds),
    deck_history: await query(`SELECT * FROM deck_history WHERE deck_id IN ${inClause(deckIds)};`, deckIds),
    saved: await query('SELECT * FROM saved WHERE profile_id=?;', [profileId]),
    notes: await query('SELECT * FROM notes WHERE profile_id=?;', [profileId]),
    highlights: await query('SELECT * FROM highlights WHERE profile_id=?;', [profileId]),
    collections,
    collection_items: await query(`SELECT * FROM collection_items WHERE collection_id IN ${inClause(colIds)};`, colIds),
    links: await query('SELECT * FROM links WHERE profile_id=?;', [profileId]),
    matches,
    match_log_entries: await query(`SELECT * FROM match_log_entries WHERE match_id IN ${inClause(matchIds)};`, matchIds),
    dashboard_blocks: await query('SELECT * FROM dashboard_blocks WHERE profile_id=?;', [profileId]),
    dashboard_layouts: await query('SELECT * FROM dashboard_layouts WHERE profile_id=?;', [profileId]),
    resume: (await query('SELECT * FROM resume WHERE profile_id=?;', [profileId]))[0] || null,
    settings: (await query('SELECT * FROM settings WHERE profile_id=?;', [profileId]))[0] || null,
  };
}

/** Duplicate a profile — the export/import round-trip re-keys every id, so the
 *  copy is fully independent of the original. Returns the new profileId. */
export async function duplicateProfile(profileId) {
  const bundle = await exportProfile(profileId);
  return importProfile(bundle, { name: `${bundle.profile?.name || 'Profile'} (copy)` });
}

/** Import a bundle into a brand-new profile. Returns the new profileId. */
export async function importProfile(bundle, { name } = {}) {
  if (!bundle || bundle.app !== 'compendium') throw new Error('Not a Compendium profile file.');
  const pname = name || `${bundle.profile?.name || 'Imported'} (imported)`;
  const { id: pid } = await createProfile(pname, { accent: bundle.profile?.accent || 'gold' });

  // id remaps (old -> new), so two imports never collide.
  const deckMap = new Map(), colMap = new Map(), matchMap = new Map();
  for (const d of bundle.decks || []) deckMap.set(d.id, uuid());
  for (const c of bundle.collections || []) colMap.set(c.id, uuid());
  for (const m of bundle.matches || []) matchMap.set(m.id, uuid());

  const stmts = [];
  const ins = (table, cols, vals) => stmts.push([`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')});`, vals]);

  for (const d of bundle.decks || [])
    ins('decks', ['id', 'profile_id', 'name', 'slug', 'archetype', 'avatar_card_id', 'avatar_slug', 'cover_slug', 'notes', 'curiosa_url', 'wins', 'losses', 'starred', 'lib_order', 'created_at', 'updated_at'],
      [deckMap.get(d.id), pid, d.name, d.slug, d.archetype, d.avatar_card_id, d.avatar_slug, d.cover_slug, d.notes, d.curiosa_url, d.wins, d.losses, d.starred, d.lib_order, d.created_at, d.updated_at]);
  for (const e of bundle.deck_entries || [])
    ins('deck_entries', ['id', 'deck_id', 'zone', 'card_id', 'quantity', 'variant_slug'], [uuid(), deckMap.get(e.deck_id), e.zone, e.card_id, e.quantity, e.variant_slug]);
  for (const h of bundle.deck_history || [])
    ins('deck_history', ['id', 'deck_id', 'ts', 'text'], [uuid(), deckMap.get(h.deck_id), h.ts, h.text]);
  for (const r of bundle.saved || [])
    ins('saved', ['id', 'profile_id', 'target_type', 'target_id', 'created_at'], [uuid(), pid, r.target_type, r.target_id, r.created_at]);
  for (const n of bundle.notes || [])
    ins('notes', ['id', 'profile_id', 'target_type', 'target_id', 'body', 'created_at', 'updated_at'], [uuid(), pid, n.target_type, n.target_id, n.body, n.created_at, n.updated_at]);
  for (const h of bundle.highlights || [])
    ins('highlights', ['id', 'profile_id', 'target_type', 'target_id', 'text', 'comment', 'created_at'], [uuid(), pid, h.target_type, h.target_id, h.text, h.comment, h.created_at]);
  for (const c of bundle.collections || [])
    ins('collections', ['id', 'profile_id', 'name', 'created_at'], [colMap.get(c.id), pid, c.name, c.created_at]);
  for (const ci of bundle.collection_items || [])
    ins('collection_items', ['id', 'collection_id', 'target_type', 'target_id', 'added_at'], [uuid(), colMap.get(ci.collection_id), ci.target_type, ci.target_id, ci.added_at]);
  for (const l of bundle.links || [])
    ins('links', ['id', 'profile_id', 'kind', 'a_type', 'a_id', 'b_type', 'b_id', 'description', 'created_at', 'updated_at'], [uuid(), pid, l.kind, l.a_type, l.a_id, l.b_type, l.b_id, l.description, l.created_at, l.updated_at]);
  for (const m of bundle.matches || [])
    ins('matches', ['id', 'profile_id', 'played_at', 'mode', 'player_avatar', 'opponent_name', 'opponent_avatar', 'player_final_life', 'opponent_final_life', 'winner', 'duration_sec', 'notes', 'deck_id'],
      [matchMap.get(m.id), pid, m.played_at, m.mode, m.player_avatar, m.opponent_name, m.opponent_avatar, m.player_final_life, m.opponent_final_life, m.winner, m.duration_sec, m.notes,
        m.deck_id ? (deckMap.get(m.deck_id) || null) : null]);   // piloted deck follows the re-keyed deck
  for (const e of bundle.match_log_entries || [])
    ins('match_log_entries', ['id', 'match_id', 't', 'who', 'kind', 'delta', 'to_life', 'to_max'], [uuid(), matchMap.get(e.match_id), e.t, e.who, e.kind, e.delta, e.to_life, e.to_max]);
  for (const b of bundle.dashboard_blocks || [])
    ins('dashboard_blocks', ['id', 'profile_id', 'type', 'width', 'config', 'sort_order', 'created_at'], [uuid(), pid, b.type, b.width, b.config, b.sort_order, b.created_at]);
  for (const l of bundle.dashboard_layouts || [])
    ins('dashboard_layouts', ['id', 'profile_id', 'name', 'blocks', 'saved_at'], [uuid(), pid, l.name, l.blocks, l.saved_at]);
  if (bundle.resume)
    stmts.push(['INSERT OR REPLACE INTO resume(profile_id,target_type,target_id,title,at) VALUES(?,?,?,?,?);', [pid, bundle.resume.target_type, bundle.resume.target_id, bundle.resume.title, bundle.resume.at]]);
  if (bundle.settings) {
    const s = bundle.settings;
    stmts.push(['UPDATE settings SET accent_metal=?,film_grain=?,keep_awake=?,immersive=?,default_max_life=?,die_type=?,haptics=?,rarity_colors=?,theme=?,persist_search=? WHERE profile_id=?;',
      [s.accent_metal, s.film_grain, s.keep_awake, s.immersive, s.default_max_life, s.die_type, s.haptics, s.rarity_colors, s.theme, s.persist_search, pid]]);
  }

  if (stmts.length) await tx(stmts);
  return pid;
}

/* ---- web file helpers (native build swaps in Filesystem + Share) ---- */

export async function exportToFile(profileId) {
  const bundle = await exportProfile(profileId);
  const safe = (bundle.profile?.name || 'profile').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  await saveTextFile(`compendium-${safe}.json`, JSON.stringify(bundle, null, 2), 'application/json');
  return bundle;
}

export function pickAndImport() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const text = await file.text();
        const pid = await importProfile(JSON.parse(text));
        resolve(pid);
      } catch (e) { reject(e); }
    };
    input.click();
  });
}

export { renameProfile, switchProfile };
