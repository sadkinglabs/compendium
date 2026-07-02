// Play hub — compact New Match + Quick Match, the Match History digest
// (win-rate / W–L / streak / last-8 pips), and Recent Duels. Calm by design:
// the life counter and in-match log live inside an in-progress match, not here.
import React, { useEffect, useState } from 'react';
import { historyStats, listMatches, getMatch, matchLog, setMatchNote, updateMatch, deleteMatch, recentOpponents } from '../store/playRepository.js';
import { listAvatarCards } from '../store/deckRepository.js';
import { shareMatchSnapshot } from '../store/matchSnapshot.js';
import { BottomSheet, IconButton, Chip, ChipRow } from '../components/ui.jsx';
import '../theme/playhistory.css';

const BASE = import.meta.env.BASE_URL;

// "1h 25m" / "5m 21s" / "12s" — Vitarum's _fmtSpan (seconds precision under an hour).
function fmtSpan(secs) {
  secs = Math.max(0, Math.round(secs || 0));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function relTime(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60); if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60); if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24); if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30); return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

export default function Play({ onStart, ongoing, onResume, rev }) {
  const [stats, setStats] = useState(null);
  const [matches, setMatches] = useState([]);
  const [avImg, setAvImg] = useState({});           // avatar name → image_slug
  const [oppFilter, setOppFilter] = useState(null);  // drill-in on one opponent
  const [collapsed, setCollapsed] = useState({ avatar: false, opponent: false });
  const [matchId, setMatchId] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all([historyStats(), listMatches(500), listAvatarCards()]).then(([s, m, avs]) => {
      if (!alive) return;
      setStats(s); setMatches(m);
      const map = {}; for (const a of avs) map[a.name] = a.image_slug; setAvImg(map);
    });
    return () => { alive = false; };
  }, [rev, tick]);
  const refresh = () => setTick((t) => t + 1);

  // Derived stats (client-side, mirroring Vitarum's renderHistory()).
  const wins = matches.filter((m) => m.winner === 'player').length;
  const losses = matches.filter((m) => m.winner === 'opponent').length;
  const pct = stats?.winPct != null ? stats.winPct : (wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0);
  const streak = stats?.streak || 0;
  const totalSec = matches.reduce((a, m) => a + (m.duration_sec || 0), 0);

  const byAv = {};
  matches.forEach((m) => { const k = m.player_avatar; if (!k) return; (byAv[k] ||= { w: 0, l: 0 }); if (m.winner === 'player') byAv[k].w++; else if (m.winner === 'opponent') byAv[k].l++; });
  const avatarStats = Object.keys(byAv).map((k) => { const r = byAv[k]; const tot = r.w + r.l; return { name: k, img: avImg[k], pct: tot ? Math.round(r.w / tot * 100) : 0, record: `${r.w}–${r.l}`, w: r.w, tot }; }).filter((s) => s.tot > 0).sort((x, y) => y.w - x.w || y.pct - x.pct).slice(0, 6);
  const mostPlayed = avatarStats.slice().sort((a, b) => b.tot - a.tot)[0];

  const byOpp = {};
  matches.forEach((m) => { const o = (m.opponent_name || '').trim(); if (!o) return; (byOpp[o] ||= { w: 0, l: 0, t: 0 }); if (m.winner === 'player') byOpp[o].w++; else if (m.winner === 'opponent') byOpp[o].l++; else byOpp[o].t++; });
  const oppStats = Object.keys(byOpp).map((o) => { const r = byOpp[o]; const dec = r.w + r.l; return { name: o, pct: dec ? Math.round(r.w / dec * 100) : 0, record: `${r.w}–${r.l}`, w: r.w, games: r.w + r.l + r.t }; }).sort((x, y) => y.games - x.games || y.w - x.w).slice(0, 8);

  const shown = oppFilter ? matches.filter((m) => (m.opponent_name || '').trim() === oppFilter) : matches;
  const ring = `conic-gradient(#4db38a 0% ${pct}%, rgba(255,255,255,.07) ${pct}% 100%)`;
  const toggle = (k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));

  const matchSheet = <MatchSheet matchId={matchId} onClose={() => setMatchId(null)}
    onChanged={refresh} onH2H={(name) => { setMatchId(null); setOppFilter(name); }} />;

  const cardActions = {
    onNote: (id) => setMatchId(id),
    onEdit: (id) => setMatchId(id),
    onShare: async (id) => { try { await shareMatchSnapshot(id, { playerName: 'You' }); } catch (e) { alert('Could not build image: ' + e.message); } },
    onDelete: async (id) => { if (confirm('Delete this match?')) { await deleteMatch(id); refresh(); } },
    onOpp: (name) => setOppFilter(name),
  };

  return (
    <div className="mh" style={{ padding: '14px 20px 26px', animation: 'cxfade .2s ease' }}>
      {ongoing && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <button className="cx-return-btn" onClick={onResume}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polygon points="10 8 16 12 10 16 10 8" /></svg>
            Return to Match<span className="cx-live-dot" />
          </button>
        </div>
      )}
      {matches.length === 0 ? (
        <div style={{ font: "400 14px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', padding: '14px 0' }}>
          No matches yet. Start a match to track life and record the result.
        </div>
      ) : oppFilter ? (
        <>
          <button onClick={() => setOppFilter(null)} style={{ background: 'none', border: 'none', color: 'var(--gold-leaf)', font: "600 13px/1 var(--f-ui)", cursor: 'pointer', marginBottom: 14 }}>‹ All matches</button>
          <div className="rec-section">vs {oppFilter}</div>
          {shown.map((m) => <MatchCard key={m.id} m={m} {...cardActions} />)}
          {matchSheet}
        </>
      ) : (
        <>
          {/* hero — donut win-rate + record + streak */}
          <div className="rec-hero">
            {mostPlayed?.img && <img className="rec-hero-bg" src={`${BASE}cards/${mostPlayed.img}`} alt="" aria-hidden="true" />}
            <div className="rec-ring" style={{ background: ring }}>
              <div className="rec-ring-inner">
                <span className="rec-ring-pct">{pct}%</span>
                <span className="rec-ring-label">WIN RATE</span>
              </div>
            </div>
            <div className="rec-hero-right">
              <div className="rec-wl">{wins}<span className="sep">–</span>{losses}</div>
              <div className="rec-total">{matches.length} MATCH{matches.length === 1 ? '' : 'ES'} PLAYED</div>
              <span className={`rec-streak${streak > 0 ? '' : ' none'}`}>{streak > 0 ? `▲ ${streak} win streak` : 'No active streak'}</span>
            </div>
          </div>

          {/* time played / avg match */}
          <div className="rec-minis">
            <div className="rec-mini"><div className="rec-mini-val">{fmtSpan(totalSec)}</div><div className="rec-mini-label">TIME PLAYED</div></div>
            <div className="rec-mini"><div className="rec-mini-val">{fmtSpan(matches.length ? totalSec / matches.length : 0)}</div><div className="rec-mini-label">AVG MATCH</div></div>
          </div>

          {avatarStats.length > 0 && (
            <div className={`rec-collapse${collapsed.avatar ? ' collapsed' : ''}`}>
              <button className="rec-section rec-section-toggle" onClick={() => toggle('avatar')}>⬡ Wins by Avatar<span className="rec-chevron">▾</span></button>
              <div className="rec-bars">
                {avatarStats.map((s) => (
                  <div key={s.name} className="rec-bar">
                    <div className="rec-bar-art">{s.img && <img src={`${BASE}cards/${s.img}`} alt="" />}</div>
                    <span className="rec-bar-name">{s.name}</span>
                    <div className="rec-bar-track"><div className="rec-bar-fill" style={{ width: `${s.pct}%` }} /></div>
                    <span className="rec-bar-rec">{s.record}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {oppStats.length > 0 && (
            <div className={`rec-collapse${collapsed.opponent ? ' collapsed' : ''}`}>
              <button className="rec-section rec-section-toggle" onClick={() => toggle('opponent')}>⚔ Record by Opponent<span className="rec-chevron">▾</span></button>
              <div className="rec-bars">
                {oppStats.map((s) => (
                  <div key={s.name} className="rec-bar rec-bar-tap" onClick={() => setOppFilter(s.name)} role="button" tabIndex={0}>
                    <div className="rec-opp-badge">{s.name.charAt(0).toUpperCase()}</div>
                    <span className="rec-bar-name">{s.name}</span>
                    <div className="rec-bar-track"><div className="rec-bar-fill" style={{ width: `${s.pct}%` }} /></div>
                    <span className="rec-bar-rec">{s.record}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rec-section">Recent Matches</div>
          {shown.map((m) => <MatchCard key={m.id} m={m} {...cardActions} />)}
          {matchSheet}
        </>
      )}
    </div>
  );
}

// One match card — verbatim port of Vitarum's _matchCardHTML.
function MatchCard({ m, onNote, onEdit, onShare, onDelete, onOpp }) {
  const badgeCls = m.winner === 'player' ? 'win' : m.winner === 'opponent' ? 'loss' : 'draw';
  const badgeTxt = m.winner === 'player' ? 'W' : m.winner === 'opponent' ? 'L' : 'D';
  const d = new Date(m.played_at);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
  const time = isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const when = relTime(m.played_at);
  const pDD = m.player_final_life <= 0, eDD = m.opponent_final_life <= 0;
  const opp = (m.opponent_name || '').trim();
  return (
    <div className="match-entry">
      <div className="match-entry-top">
        <span className={`match-badge ${badgeCls}`}>{badgeTxt}</span>
        <div className="match-matchup">
          <span className="match-you">{m.player_avatar || 'You'}</span>
          <span className="match-vs">vs</span>
          <span className="match-opp">{m.opponent_avatar || 'Opponent'}</span>
        </div>
        {when && <span className="match-when">{when}</span>}
      </div>
      <div className="match-meta">
        {opp && (
          <span className="match-opp-tag" onClick={() => onOpp(opp)} role="button" tabIndex={0}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg>{opp}
          </span>
        )}
        <span><span className="lbl">You</span> <span className={`you-life${pDD ? ' dd' : ''}`}>{m.player_final_life}</span></span>
        <span className="match-dot">·</span>
        <span><span className="lbl">Opp</span> <span className={`opp-life${eDD ? ' dd' : ''}`}>{m.opponent_final_life}</span></span>
        <span className="match-dot">·</span>
        <span>{date}{time ? ', ' + time : ''}</span>
        {m.duration_sec ? <><span className="match-dot">·</span><span>{fmtSpan(m.duration_sec)}</span></> : null}
      </div>
      {m.notes ? <div className="match-notes-text">"{m.notes}"</div> : null}
      <div className="match-actions">
        <button className="match-action-btn" onClick={() => onNote(m.id)} title={m.notes ? 'Edit note' : 'Add note'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          <span>Note</span>
        </button>
        <div className="match-actions-right">
          <button className="match-action-btn" onClick={() => onEdit(m.id)} title="Edit entry" aria-label="Edit entry">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
          </button>
          <button className="match-action-btn" onClick={() => onShare(m.id)} title="Share entry" aria-label="Share entry">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
          </button>
          <button className="match-action-btn danger" onClick={() => onDelete(m.id)} title="Remove entry" aria-label="Remove entry">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function MatchSheet({ matchId, onClose, onChanged, onH2H }) {
  const [m, setM] = useState(null);
  const [log, setLog] = useState([]);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(null);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    if (!matchId) { setM(null); setEdit(false); return; }
    getMatch(matchId).then((mm) => { setM(mm); setF(mm ? { opponent_name: mm.opponent_name || '', winner: mm.winner, player_final_life: mm.player_final_life, opponent_final_life: mm.opponent_final_life, duration_sec: mm.duration_sec, notes: mm.notes || '' } : null); });
    matchLog(matchId).then(setLog);
    recentOpponents().then(setRecent);
  }, [matchId]);

  if (!matchId) return null;
  const title = m ? (m.winner === 'player' ? 'Victory' : m.winner === 'draw' ? 'Draw' : 'Defeat') : 'Match';
  async function save() { await updateMatch(matchId, f); onChanged(); setM(await getMatch(matchId)); setEdit(false); }
  async function saveNote(v) { setF((p) => ({ ...p, notes: v })); await setMatchNote(matchId, v); onChanged(); setM(await getMatch(matchId)); }
  async function del() { if (confirm('Delete this match?')) { await deleteMatch(matchId); onChanged(); onClose(); } }

  return (
    <BottomSheet open title={title.toUpperCase()} onClose={onClose}>
      {!m ? <div style={{ color: 'var(--ink-faint)' }}>…</div> : (
        <div>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ font: "700 28px/1 var(--f-display)", color: m.winner === 'player' ? 'var(--accent-jade)' : m.winner === 'draw' ? 'var(--ink-muted)' : '#c98f8f' }}>{m.player_final_life}–{m.opponent_final_life}</div>
            {(m.player_avatar || m.opponent_avatar) && <div style={{ font: "500 12px/1.2 var(--f-read)", color: 'var(--ink-muted)', marginTop: 6 }}>{m.player_avatar || 'You'} vs {m.opponent_avatar || 'Opponent'}</div>}
            <div style={{ font: "500 11px/1 var(--f-ui)", color: 'var(--ink-faint)', marginTop: 5 }}>{new Date(m.played_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{m.duration_sec ? ` · ${Math.round(m.duration_sec / 60)}m` : ''}</div>
          </div>

          {edit ? (
            <div style={{ marginBottom: 12 }}>
              <Lbl t="OPPONENT" />
              <input value={f.opponent_name} onChange={(e) => setF({ ...f, opponent_name: e.target.value })} placeholder="Their name…" style={inp} />
              {recent.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>{recent.map((r) => <span key={r} onClick={() => setF({ ...f, opponent_name: r })} style={chip}>{r}</span>)}</div>}
              <Lbl t="RESULT" />
              <ChipRow style={{ marginBottom: 12 }}>
                {[['player', 'You won'], ['opponent', 'Opponent won'], ['draw', 'Draw']].map(([k, l]) => <Chip key={k} label={l} active={f.winner === k} onClick={() => setF({ ...f, winner: k })} />)}
              </ChipRow>
              <Lbl t="FINAL LIFE" />
              <div style={{ display: 'flex', gap: 12 }}>
                <LifeStep label="You" v={f.player_final_life} set={(x) => setF({ ...f, player_final_life: x })} />
                <LifeStep label="Opp" v={f.opponent_final_life} set={(x) => setF({ ...f, opponent_final_life: x })} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button onClick={() => setEdit(false)} style={{ ...ghost, flex: 1 }}>Cancel</button>
                <button onClick={save} style={gold}>Save</button>
              </div>
            </div>
          ) : (
            <>
              <Lbl t="NOTE" />
              <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} onBlur={(e) => saveNote(e.target.value)} placeholder="Add a note about this match…"
                style={{ width: '100%', height: 60, resize: 'none', background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: 10, color: 'var(--ink-body)', font: "400 14px/1.45 var(--f-read)", marginBottom: 14 }} />

              {log.length > 0 && (
                <>
                  <Lbl t={`MATCH LOG · ${log.length}`} />
                  <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 14 }} className="cx-scroll">
                    {log.map((r) => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', borderBottom: '1px solid var(--hair-12)' }}>
                        <span style={{ width: 56, font: "500 10px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>{new Date(r.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                        <span style={{ flex: 1, font: "500 12px/1 var(--f-ui)", color: 'var(--ink-body)' }}>{r.who === 'player' ? 'You' : 'Opp'} {r.delta > 0 ? 'gained' : 'lost'} {Math.abs(r.delta)}</span>
                        <span style={{ font: "600 12px/1 var(--f-mono)", color: 'var(--accent-jade)' }}>♥ {r.to_life}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setEdit(true)} style={{ ...ghost, flex: 1 }}>✎ Edit</button>
                <button onClick={async () => { try { await shareMatchSnapshot(matchId, { playerName: 'You' }); } catch (e) { alert('Could not build image: ' + e.message); } }} style={{ ...ghost, flex: 1 }}>▦ Share</button>
                {m.opponent_name && <button onClick={() => onH2H(m.opponent_name)} style={{ ...ghost, flex: 1 }}>⚔ Record</button>}
                <button onClick={del} style={{ ...ghost, flex: 1, color: 'var(--destructive)', borderColor: 'rgba(168,88,74,.4)' }}>✕ Delete</button>
              </div>
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
const Lbl = ({ t }) => <div style={{ font: "600 10px/1 var(--f-ui)", letterSpacing: '.14em', color: 'var(--ink-muted)', margin: '2px 0 8px' }}>{t}</div>;
function LifeStep({ label, v, set }) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ font: "600 9px/1 var(--f-ui)", color: 'var(--ink-faint)', marginBottom: 6 }}>{label.toUpperCase()}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <IconButton glyph="−" tone="muted" size={26} onClick={() => set(Math.max(0, v - 1))} />
        <span style={{ font: "700 18px/1 var(--f-display)", color: 'var(--gold-leaf)', minWidth: 22 }}>{v}</span>
        <IconButton glyph="+" size={26} onClick={() => set(Math.min(20, v + 1))} />
      </div>
    </div>
  );
}
const inp = { width: '100%', height: 42, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)" };
const chip = { padding: '5px 11px', borderRadius: 16, border: '1px solid var(--hair-22)', font: "500 12px/1 var(--f-read)", color: 'var(--ink-status)', cursor: 'pointer' };
const ghost = { padding: '11px 0', borderRadius: 12, background: 'transparent', color: 'var(--ink-status)', font: "600 12px/1 var(--f-ui)", border: '1px solid var(--hair-22)', cursor: 'pointer' };
const gold = { padding: '11px 18px', borderRadius: 12, background: 'linear-gradient(180deg,#dcb86f,#c9a35a)', color: '#1a1410', font: "700 13px/1 var(--f-ui)", border: 'none', cursor: 'pointer', flex: 'none' };
