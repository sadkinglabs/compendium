// Play data - matches + persisted match log + history stats + per-profile
// settings (life/die/comforts). All profile-scoped via activeProfileId().
import { query, run, tx } from './db.js';
import { activeProfileId } from './profileRepository.js';
import { trimHistorySql } from './deckRepository.js';
import { uuid, nowIso } from './ids.js';

/* ---------------- settings ---------------- */

const DEFAULTS = {
  film_grain: 1, keep_awake: 1, immersive: 1,   // keep_awake mirrors the schema default (v5)
  default_max_life: 20, die_type: 6, haptics: 1, rarity_colors: 0, theme: 'grimoire', persist_search: 0,
  font_scale: 1, high_contrast: 0, reduced_motion: 0,
};

export async function getSettings() {
  const pid = activeProfileId();
  let row = (await query('SELECT * FROM settings WHERE profile_id=?;', [pid]))[0];
  if (!row) { await run('INSERT INTO settings(profile_id) VALUES(?);', [pid]); row = { ...DEFAULTS, profile_id: pid }; }
  return { ...DEFAULTS, ...row };
}

// SQLite can't bind an identifier, so the column name is interpolated - it MUST
// be whitelisted against known settings columns (never trust a caller's key).
const SETTING_COLS = new Set(Object.keys(DEFAULTS));

export async function setSetting(key, value) {
  if (!SETTING_COLS.has(key)) throw new Error(`Unknown setting: ${key}`);
  const pid = activeProfileId();
  await run('INSERT OR IGNORE INTO settings(profile_id) VALUES(?);', [pid]);
  await run(`UPDATE settings SET ${key}=? WHERE profile_id=?;`, [value, pid]);
}

/* ---------------- matches + log ---------------- */

/** Persist a finished match and its full log in one transaction. When a deck
    was piloted (m.deckId), the deck's W–L ledger and history log update too -
    Play feeds Decks, no manual record-keeping. */
export async function recordMatch(m) {
  const pid = activeProfileId();
  const id = uuid();
  const winner = m.winner || 'draw';
  // The piloted deck may have been deleted mid-match. deck_history has an
  // ON DELETE CASCADE FK, so writing a history row for a gone deck would throw
  // and roll back the WHOLE match record. Resolve existence first: keep the
  // deck_id link only if the deck still exists (LEFT JOIN yields NULL name
  // otherwise), and skip the ledger/history writes.
  const deckId = m.deckId || null;
  const deckLives = deckId ? (await query('SELECT 1 FROM decks WHERE id=? AND profile_id=?;', [deckId, pid])).length > 0 : false;
  const stmts = [[
    `INSERT INTO matches(id,profile_id,played_at,mode,player_avatar,opponent_name,opponent_avatar,
       player_final_life,opponent_final_life,winner,duration_sec,notes,deck_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?);`,
    [id, pid, nowIso(), m.mode || 'full', m.playerAvatar || null, m.opponentName || null, m.opponentAvatar || null,
      m.playerFinalLife ?? null, m.opponentFinalLife ?? null, winner, m.durationSec || 0, m.notes || '', deckId],
  ]];
  for (const e of m.log || []) {
    stmts.push([
      'INSERT INTO match_log_entries(id,match_id,t,who,kind,delta,to_life,to_max) VALUES(?,?,?,?,?,?,?,?);',
      [uuid(), id, e.t, e.who, e.kind || 'life', e.delta ?? null, e.toLife ?? null, e.toMax ?? null],
    ]);
  }
  if (deckLives) {
    // No increment - the record is recomputed from matches IN THIS SAME tx, so
    // there is exactly one writer of wins/losses and the match + record commit
    // atomically together (no crash window between them).
    const outcome = winner === 'player' ? 'a win' : winner === 'opponent' ? 'a loss' : 'a draw';
    const vs = m.opponentName ? ` vs ${m.opponentName}` : '';
    stmts.push(['INSERT INTO deck_history(id,deck_id,ts,text) VALUES(?,?,?,?);',
      [uuid(), deckId, nowIso(), `Recorded ${outcome}${vs} (${m.playerFinalLife ?? '–'}–${m.opponentFinalLife ?? '–'})`]]);
    stmts.push(trimHistorySql(deckId));   // keep the deck log bounded
    stmts.push(syncDeckRecordStmt(deckId, pid));   // record = COUNT(matches), atomic with the insert
  }
  await tx(stmts);
  return id;
}

/** Manual history entry (Vitarum's Add Match) - a match that wasn't tracked
    live. No log; may optionally be pinned to a piloted deck, whose W–L ledger
    then re-syncs (same rule as live-recorded and edited matches). */
export async function addManualMatch(m) {
  const pid = activeProfileId();
  const id = uuid();
  const stmts = [[
    `INSERT INTO matches(id,profile_id,played_at,mode,player_avatar,opponent_name,opponent_avatar,
       player_final_life,opponent_final_life,winner,duration_sec,notes,deck_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?);`,
    [id, pid, m.playedAt || nowIso(), 'full', m.playerAvatar || null, m.opponentName || null, m.opponentAvatar || null,
      m.playerFinalLife ?? null, m.opponentFinalLife ?? null, m.winner || 'draw', m.durationSec || 0, m.notes || '', m.deckId || null],
  ], syncDeckRecordStmt(m.deckId, pid)].filter(Boolean);   // insert + record recompute, atomic
  await tx(stmts);
  return id;
}

export async function listMatches(limit = 50) {
  return query(
    `SELECT m.*, d.name deck_name FROM matches m
     LEFT JOIN decks d ON d.id = m.deck_id AND d.profile_id = m.profile_id
     WHERE m.profile_id=? ORDER BY m.played_at DESC LIMIT ?;`,
    [activeProfileId(), limit]
  );
}

export async function matchLog(matchId) {
  return query('SELECT * FROM match_log_entries WHERE match_id=? ORDER BY t DESC;', [matchId]);
}

export async function deleteMatch(id) {
  const pid = activeProfileId();
  // Delete the match AND recompute its deck's record in one atomic tx - the
  // deleted win/loss comes off the ledger in the same commit.
  const deckId = (await query('SELECT deck_id FROM matches WHERE id=? AND profile_id=?;', [id, pid]))[0]?.deck_id;
  await tx([['DELETE FROM matches WHERE id=? AND profile_id=?;', [id, pid]], syncDeckRecordStmt(deckId, pid)].filter(Boolean));
}

/** Avatar cards from the shared catalog (for the You/Opponent picker). */
export async function listAvatars() {
  return query('SELECT card_id, name, image_slug, elements, thresholds FROM cards WHERE is_avatar=1 ORDER BY name;');
}

/** Recent distinct opponent names for autocomplete chips. */
export async function recentOpponents() {
  const rows = await query(
    "SELECT opponent_name FROM matches WHERE profile_id=? AND opponent_name IS NOT NULL AND opponent_name!='' ORDER BY played_at DESC;",
    [activeProfileId()]
  );
  const seen = [];
  for (const r of rows) if (!seen.includes(r.opponent_name)) seen.push(r.opponent_name);
  return seen.slice(0, 10);
}

export async function getMatch(matchId) {
  return (await query(
    `SELECT m.*, d.name deck_name FROM matches m
     LEFT JOIN decks d ON d.id = m.deck_id AND d.profile_id = m.profile_id
     WHERE m.id=? AND m.profile_id=?;`,
    [matchId, activeProfileId()]
  ))[0] || null;
}

/** The SINGLE writer of a deck's W–L: recompute it straight from the matches
    table, the one source of truth. Returned as a [sql, params] STATEMENT (not
    executed) so callers fold it into the SAME tx() as the match mutation - one
    atomic commit covers both, so a crash/quota-error can never leave a match
    written but the record un-recomputed. `null` deckId → null (filtered out). */
function syncDeckRecordStmt(deckId, pid) {
  if (!deckId) return null;
  return [
    `UPDATE decks SET
       wins   = (SELECT COUNT(*) FROM matches WHERE deck_id=? AND profile_id=? AND winner='player'),
       losses = (SELECT COUNT(*) FROM matches WHERE deck_id=? AND profile_id=? AND winner='opponent'),
       updated_at=?
     WHERE id=? AND profile_id=?;`,
    [deckId, pid, deckId, pid, nowIso(), deckId, pid],
  ];
}

/** Count of ALL matches piloted with a deck (wins + losses + draws) - the
    "tracked from N matches" provenance line, and the ripple warning on delete. */
export async function deckMatchCount(deckId) {
  if (!deckId) return 0;
  return (await query('SELECT COUNT(*) c FROM matches WHERE deck_id=? AND profile_id=?;', [deckId, activeProfileId()]))[0].c;
}

/** Edit a match's recordable fields (opponent, winner, final life, piloted deck,
    notes). Changing the winner or the piloted deck re-syncs the affected decks'
    W–L ledgers so the record on the deck stays honest. A deck that no longer
    exists is dropped to null (matches outlive their decks). */
export async function updateMatch(matchId, f) {
  const pid = activeProfileId();
  const oldDeck = (await query('SELECT deck_id FROM matches WHERE id=? AND profile_id=?;', [matchId, pid]))[0]?.deck_id || null;
  let newDeck = f.deck_id || null;
  if (newDeck && !(await query('SELECT 1 FROM decks WHERE id=? AND profile_id=?;', [newDeck, pid])).length) newDeck = null;
  // Update the match AND recompute both affected decks in one atomic tx.
  const stmts = [[
    `UPDATE matches SET opponent_name=?, winner=?, player_final_life=?, opponent_final_life=?, duration_sec=?, notes=?, deck_id=?
     WHERE id=? AND profile_id=?;`,
    [f.opponent_name ?? null, f.winner, f.player_final_life, f.opponent_final_life, f.duration_sec ?? 0, f.notes ?? '', newDeck, matchId, pid],
  ]];
  stmts.push(syncDeckRecordStmt(oldDeck, pid));
  if (newDeck && newDeck !== oldDeck) stmts.push(syncDeckRecordStmt(newDeck, pid));
  await tx(stmts.filter(Boolean));
}

/** Aggregate history stats from the active profile's matches. */
export async function historyStats() {
  const ms = await query('SELECT winner, duration_sec, played_at FROM matches WHERE profile_id=? ORDER BY played_at DESC;', [activeProfileId()]);
  const total = ms.length;
  const wins = ms.filter((m) => m.winner === 'player').length;
  const losses = ms.filter((m) => m.winner === 'opponent').length;
  const decided = wins + losses;
  let streak = 0;
  for (const m of ms) { if (m.winner === 'player') streak++; else break; }
  const last8 = ms.slice(0, 8).map((m) => m.winner === 'player' ? 'W' : m.winner === 'opponent' ? 'L' : 'D');
  const totalSec = ms.reduce((a, m) => a + (m.duration_sec || 0), 0);
  return {
    total, wins, losses,
    winPct: decided ? Math.round((wins / decided) * 100) : null,
    streak, last8,
    totalSec,
    timePlayedMin: Math.round(totalSec / 60),
    avgMin: total ? Math.round(totalSec / total / 60) : 0,
  };
}
