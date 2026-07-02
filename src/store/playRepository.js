// Play data — matches + persisted match log + history stats + per-profile
// settings (life/die/accent metal). All profile-scoped via activeProfileId().
import { query, run, tx } from './db.js';
import { activeProfileId } from './profileRepository.js';
import { uuid, nowIso } from './ids.js';

/* ---------------- settings ---------------- */

const DEFAULTS = {
  accent_metal: 'gilded', film_grain: 1, keep_awake: 0, immersive: 1,
  default_max_life: 20, die_type: 6, haptics: 1, rarity_colors: 0, theme: 'grimoire', persist_search: 0,
};

export async function getSettings() {
  const pid = activeProfileId();
  let row = (await query('SELECT * FROM settings WHERE profile_id=?;', [pid]))[0];
  if (!row) { await run('INSERT INTO settings(profile_id) VALUES(?);', [pid]); row = { ...DEFAULTS, profile_id: pid }; }
  return { ...DEFAULTS, ...row };
}

export async function setSetting(key, value) {
  const pid = activeProfileId();
  await run('INSERT OR IGNORE INTO settings(profile_id) VALUES(?);', [pid]);
  await run(`UPDATE settings SET ${key}=? WHERE profile_id=?;`, [value, pid]);
}

/* ---------------- matches + log ---------------- */

/** Persist a finished match and its full log in one transaction. When a deck
    was piloted (m.deckId), the deck's W–L ledger and history log update too —
    Play feeds Decks, no manual record-keeping. */
export async function recordMatch(m) {
  const pid = activeProfileId();
  const id = uuid();
  const winner = m.winner || 'draw';
  const stmts = [[
    `INSERT INTO matches(id,profile_id,played_at,mode,player_avatar,opponent_name,opponent_avatar,
       player_final_life,opponent_final_life,winner,duration_sec,notes,deck_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?);`,
    [id, pid, nowIso(), m.mode || 'full', m.playerAvatar || null, m.opponentName || null, m.opponentAvatar || null,
      m.playerFinalLife ?? null, m.opponentFinalLife ?? null, winner, m.durationSec || 0, m.notes || '', m.deckId || null],
  ]];
  for (const e of m.log || []) {
    stmts.push([
      'INSERT INTO match_log_entries(id,match_id,t,who,kind,delta,to_life,to_max) VALUES(?,?,?,?,?,?,?,?);',
      [uuid(), id, e.t, e.who, e.kind || 'life', e.delta ?? null, e.toLife ?? null, e.toMax ?? null],
    ]);
  }
  if (m.deckId) {
    if (winner === 'player') stmts.push(['UPDATE decks SET wins=wins+1, updated_at=? WHERE id=? AND profile_id=?;', [nowIso(), m.deckId, pid]]);
    else if (winner === 'opponent') stmts.push(['UPDATE decks SET losses=losses+1, updated_at=? WHERE id=? AND profile_id=?;', [nowIso(), m.deckId, pid]]);
    const outcome = winner === 'player' ? 'a win' : winner === 'opponent' ? 'a loss' : 'a draw';
    const vs = m.opponentName ? ` vs ${m.opponentName}` : '';
    stmts.push(['INSERT INTO deck_history(id,deck_id,ts,text) VALUES(?,?,?,?);',
      [uuid(), m.deckId, nowIso(), `Recorded ${outcome}${vs} (${m.playerFinalLife ?? '–'}–${m.opponentFinalLife ?? '–'})`]]);
  }
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
  await run('DELETE FROM matches WHERE id=? AND profile_id=?;', [id, activeProfileId()]);
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

export async function setMatchNote(matchId, notes) {
  await run('UPDATE matches SET notes=? WHERE id=? AND profile_id=?;', [notes, matchId, activeProfileId()]);
}

/** Edit a match's recordable fields (opponent, winner, final life, duration, notes). */
export async function updateMatch(matchId, f) {
  await run(
    `UPDATE matches SET opponent_name=?, winner=?, player_final_life=?, opponent_final_life=?, duration_sec=?, notes=?
     WHERE id=? AND profile_id=?;`,
    [f.opponent_name ?? null, f.winner, f.player_final_life, f.opponent_final_life, f.duration_sec ?? 0, f.notes ?? '', matchId, activeProfileId()]
  );
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
    timePlayedMin: Math.round(totalSec / 60),
    avgMin: total ? Math.round(totalSec / total / 60) : 0,
  };
}
