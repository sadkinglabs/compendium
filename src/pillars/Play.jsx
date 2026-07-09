// Play hub - compact New Match + Quick Match, the Match History digest
// (win-rate / W–L / streak / last-8 pips), and Recent Matches. Calm by design:
// the life counter and in-match log live inside an in-progress match, not here.
import React, { useEffect, useState } from 'react';
import { listMatches, getMatch, matchLog, updateMatch, deleteMatch, recentOpponents, addManualMatch, listAvatars } from '../store/playRepository.js';
import { listAvatarCards, listDecks } from '../store/deckRepository.js';
import { IconButton, Chip, ChipRow, Loading, BlankState, BTN_GOLD, BTN_GHOST } from '../components/ui.jsx';
import Sheet from '../components/Sheet.jsx';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import { toast, confirmAction } from '../feedback.js';
import { haptic } from '../native.js';
import '../theme/playhistory.css';

const BASE = import.meta.env.BASE_URL;

// "1h 25m" / "5m 21s" / "12s" - Vitarum's _fmtSpan (seconds precision under an hour).
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

export default function Play({ onStart, ongoing, onResume, onOpenDeck, rev, onChanged, onImport }) {
  const [matches, setMatches] = useState([]);
  const [avImg, setAvImg] = useState({});           // avatar name → image_slug
  const [oppFilter, setOppFilter] = useState(null);  // drill-in on one opponent
  const [collapsed, setCollapsed] = useState({ avatar: false, opponent: false });
  const [matchId, setMatchId] = useState(null);
  const [tick, setTick] = useState(0);
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);   // manual Add Match form
  useEffect(() => {
    let alive = true;
    // Single matches fetch - everything below is derived from it (was a second
    // full scan via historyStats plus JS re-aggregation of the same rows).
    Promise.all([listMatches(500), listAvatarCards()]).then(([m, avs]) => {
      if (!alive) return;
      setMatches(m);
      const map = {}; for (const a of avs) map[a.name] = a.image_slug; setAvImg(map);
    });
    return () => { alive = false; };
  }, [rev, tick]);
  // Refresh Play's own list AND bump the app-wide revision, so a match mutation
  // that moves a deck's derived record (add / edit / delete) is reflected live in
  // the Decks library and Home too - never a stale record across pillars.
  const refresh = () => { setTick((t) => t + 1); onChanged?.(); };
  useEffect(() => { setPage(1); }, [oppFilter]);   // restart paging when drilling in/out

  // Derived stats (client-side, mirroring Vitarum's renderHistory()). matches is
  // ordered newest-first, so the win streak is the leading run of player wins.
  const wins = matches.filter((m) => m.winner === 'player').length;
  const losses = matches.filter((m) => m.winner === 'opponent').length;
  const pct = wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0;
  let streak = 0; for (const m of matches) { if (m.winner === 'player') streak++; else break; }
  const totalSec = matches.reduce((a, m) => a + (m.duration_sec || 0), 0);

  const byAv = {};
  matches.forEach((m) => { const k = m.player_avatar; if (!k) return; (byAv[k] ||= { w: 0, l: 0 }); if (m.winner === 'player') byAv[k].w++; else if (m.winner === 'opponent') byAv[k].l++; });
  const avatarStats = Object.keys(byAv).map((k) => { const r = byAv[k]; const tot = r.w + r.l; return { name: k, img: avImg[k], pct: tot ? Math.round(r.w / tot * 100) : 0, record: `${r.w}–${r.l}`, w: r.w, tot }; }).filter((s) => s.tot > 0).sort((x, y) => y.w - x.w || y.pct - x.pct).slice(0, 6);
  const mostPlayed = avatarStats.slice().sort((a, b) => b.tot - a.tot)[0];

  const byOpp = {};
  matches.forEach((m) => { const o = (m.opponent_name || '').trim(); if (!o) return; (byOpp[o] ||= { w: 0, l: 0, t: 0 }); if (m.winner === 'player') byOpp[o].w++; else if (m.winner === 'opponent') byOpp[o].l++; else byOpp[o].t++; });
  const oppStats = Object.keys(byOpp).map((o) => { const r = byOpp[o]; const dec = r.w + r.l; return { name: o, pct: dec ? Math.round(r.w / dec * 100) : 0, record: `${r.w}–${r.l}`, w: r.w, games: r.w + r.l + r.t }; }).sort((x, y) => y.games - x.games || y.w - x.w).slice(0, 8);

  const shown = oppFilter ? matches.filter((m) => (m.opponent_name || '').trim() === oppFilter) : matches;
  const PAGE = 40;   // cap the rendered match-card DOM; reveal the rest on demand
  const visible = shown.slice(0, page * PAGE);
  const moreBtn = shown.length > visible.length && (
    <button onClick={() => setPage((p) => p + 1)} style={{ display: 'block', width: '100%', marginTop: 12, padding: '11px 0', borderRadius: 12, background: 'rgba(18,16,13,.85)', border: '1px solid rgba(220,184,111,.45)', color: 'var(--gold-leaf)', font: "600 13px/1 var(--f-ui)", cursor: 'pointer' }}>
      Show more ({shown.length - visible.length} older)
    </button>
  );
  const ring = `conic-gradient(#4db38a 0% ${pct}%, rgba(255,255,255,.07) ${pct}% 100%)`;
  const toggle = (k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));

  const matchSheet = <MatchSheet matchId={matchId} onClose={() => setMatchId(null)} onChanged={refresh} />;

  const cardActions = {
    onEdit: (id) => setMatchId(id),
    // Ripple-aware: if the match is piloted with a deck, say the record will move.
    onDelete: async (m) => {
      const linked = m.deck_id && m.deck_name;
      const body = linked
        ? `The match and its log are removed, and ${m.deck_name}'s record updates to match. This can’t be undone.`
        : 'The match and its log are removed. This can’t be undone.';
      if (await confirmAction({ title: 'Delete this match?', body, confirmLabel: 'Delete', danger: true })) { await deleteMatch(m.id); refresh(); toast('Match deleted'); }
    },
    onOpp: (name) => setOppFilter(name),
    onDeck: (id, name) => onOpenDeck?.(id, name),
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
        <BlankState hue="143,211,168" minHeight="46vh" title="No Matches Yet"
          body={<>Start a match to track life<br />and record the result.</>} />
      ) : oppFilter ? (
        <>
          <button onClick={() => setOppFilter(null)} style={{ background: 'none', border: 'none', color: 'var(--gold-leaf)', font: "600 13px/1 var(--f-ui)", cursor: 'pointer', marginBottom: 14 }}>‹ All matches</button>
          <div className="rec-section">vs {oppFilter}</div>
          {visible.map((m) => <MatchCard key={m.id} m={m} {...cardActions} />)}
          {moreBtn}
          {matchSheet}
        </>
      ) : (
        <>
          {/* hero - donut win-rate + record + streak */}
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
          {visible.map((m) => <MatchCard key={m.id} m={m} {...cardActions} />)}
          {moreBtn}
          {matchSheet}
        </>
      )}

      {/* The + is the single entry point: start a live match (New = tracked, with
          avatars & deck; Quick = counter only), or add to history (record by hand
          / import a shared result). Iconography distinguishes each. */}
      <Fab variant="lib" icon={<FabGlyph kind="add" />} label="Match menu" items={[
        { label: 'New Match', icon: NewMatchSvg, onClick: () => onStart('full') },
        { label: 'Quick Match', icon: QuickMatchSvg, onClick: () => onStart('quick') },
        { label: 'Add Match Record', icon: AddRecordSvg, onClick: () => setAddOpen(true) },
        { label: 'Import Shared Result', icon: QrImportSvg, onClick: () => onImport?.() },
      ]} />
      <AddMatchSheet open={addOpen}
        onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); refresh(); toast('Match added'); }} />
    </div>
  );
}

// One match card - Vitarum's _matchCardHTML, reordered: matchup line, then the
// opponent/deck pills on their own row, then the life/date meta. Actions are
// compact icon buttons (details · delete - details opens the sheet where the
// result, note and edit live; sharing was pruned).
function MatchCard({ m, onEdit, onDelete, onOpp, onDeck }) {
  const badgeCls = m.winner === 'player' ? 'win' : m.winner === 'opponent' ? 'loss' : 'draw';
  const badgeTxt = m.winner === 'player' ? 'W' : m.winner === 'opponent' ? 'L' : 'D';
  const d = new Date(m.played_at);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
  const time = isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const when = relTime(m.played_at);
  const pDD = m.player_final_life <= 0, eDD = m.opponent_final_life <= 0;
  const opp = (m.opponent_name || '').trim();
  const hasDeck = m.deck_id && m.deck_name;
  return (
    <div className="match-entry">
      <div className="match-entry-top">
        <span className={`match-badge ${badgeCls}`}>{badgeTxt}</span>
        {/* Matchup + result in ONE line: name then final life per side. */}
        <div className="match-matchup">
          <span className="match-you">{m.player_avatar || 'You'}{m.player_final_life != null && <span className={`match-life${pDD ? ' dd' : ''}`}>{m.player_final_life}</span>}</span>
          <span className="match-vs">vs</span>
          <span className="match-opp">{m.opponent_final_life != null && <span className={`match-life${eDD ? ' dd' : ''}`}>{m.opponent_final_life}</span>}{m.opponent_avatar || 'Opponent'}</span>
        </div>
        {when && <span className="match-when">{when}</span>}
      </div>
      <div className="match-pills">
        {opp && (
          <span className="match-opp-tag" onClick={() => onOpp(opp)} role="button" tabIndex={0}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg><span>{opp}</span>
          </span>
        )}
        {hasDeck ? (
          <span className="match-deck-tag" onClick={() => onDeck(m.deck_id, m.deck_name)} role="button" tabIndex={0} title="Open deck">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="13" height="17" rx="2" /><rect x="8" y="2" width="13" height="17" rx="2" /></svg><span>{m.deck_name}</span>
          </span>
        ) : (
          // No deck attributed - offer to link one (opens the details sheet's deck
          // picker). Makes the unattributed state legible and one tap to fix.
          <span className="match-deck-tag add" onClick={() => onEdit(m.id)} role="button" tabIndex={0} title="Attribute to a deck">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="13" height="17" rx="2" /><rect x="8" y="2" width="13" height="17" rx="2" /><line x1="14.5" y1="10.5" x2="14.5" y2="15.5" /><line x1="12" y1="13" x2="17" y2="13" /></svg><span>Add deck</span>
          </span>
        )}
      </div>
      {/* Meta row - just when + duration now (the result moved up into the
          matchup line); no duplicated life totals. */}
      <div className="match-meta">
        <span>{date}{time ? ', ' + time : ''}</span>
        {m.duration_sec ? <><span className="match-dot">·</span><span>{fmtSpan(m.duration_sec)}</span></> : null}
        <span className="match-meta-spring" />
        <span className="match-mini-group">
          <button className="match-mini-btn" onClick={() => onEdit(m.id)} title="Edit match" aria-label="Edit match">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          </button>
          <button className="match-mini-btn danger" onClick={() => onDelete(m)} title="Remove entry" aria-label="Remove entry">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
          </button>
        </span>
      </div>
      {m.notes ? <div className="match-notes-text">"{m.notes}"</div> : null}
    </div>
  );
}

// Match sheet is EDIT-ONLY now (the old read-only "details" recap duplicated the
// card, which already shows the result). Opens straight in edit; all fields incl.
// notes live under this one window. Head-to-head nav lives on the card's
// opponent pill, so it isn't repeated here.
function MatchSheet({ matchId, onClose, onChanged }) {
  const [m, setM] = useState(null);
  const [log, setLog] = useState([]);
  const [f, setF] = useState(null);
  const [recent, setRecent] = useState([]);
  const [decks, setDecks] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!matchId) { setM(null); setF(null); return; }
    getMatch(matchId).then((mm) => { setLoaded(true); setM(mm); setF(mm ? { opponent_name: mm.opponent_name || '', winner: mm.winner, player_final_life: mm.player_final_life, opponent_final_life: mm.opponent_final_life, duration_sec: mm.duration_sec, notes: mm.notes || '', deck_id: mm.deck_id || null } : null); }).catch(() => { setLoaded(true); setM(null); });
    matchLog(matchId).then(setLog);
    recentOpponents().then(setRecent);
    listDecks().then(setDecks);
  }, [matchId]);

  if (!matchId) return null;
  async function save() { await updateMatch(matchId, f); onChanged(); onClose(); toast('Match updated'); }
  async function del() {
    const linked = m?.deck_id && m?.deck_name;
    const body = linked
      ? `The match and its log are removed, and ${m.deck_name}'s record updates to match. This can’t be undone.`
      : 'The match and its log are removed. This can’t be undone.';
    if (await confirmAction({ title: 'Delete this match?', body, confirmLabel: 'Delete', danger: true })) { await deleteMatch(matchId); onChanged(); onClose(); toast('Match deleted'); }
  }

  return (
    <Sheet open title="Edit match" onClose={onClose}>
      {!loaded ? <Loading />
        : !m || !f ? <div style={{ padding: '26px 20px', textAlign: 'center', color: 'var(--ink-muted)', fontStyle: 'italic' }}>This match is no longer available.</div> : (
        <div style={{ padding: '0 20px' }}>
          <div style={{ marginBottom: 22 }}>
            <Lbl t="FINAL LIFE" />
            <div style={{ display: 'flex', gap: 14 }}>
              <LifeStep label="You" v={f.player_final_life} set={(x) => setF({ ...f, player_final_life: x })} />
              <LifeStep label="Opp" v={f.opponent_final_life} set={(x) => setF({ ...f, opponent_final_life: x })} />
            </div>
          </div>
          <div style={{ marginBottom: 22 }}>
            <Lbl t="RESULT" />
            <ChipRow>
              {[['player', 'You won'], ['opponent', 'Opponent won'], ['draw', 'Draw']].map(([k, l]) => <Chip key={k} label={l} active={f.winner === k} onClick={() => setF({ ...f, winner: k })} />)}
            </ChipRow>
          </div>
          <div style={{ marginBottom: 22 }}>
            <Lbl t="OPPONENT" />
            <input value={f.opponent_name} onChange={(e) => setF({ ...f, opponent_name: e.target.value })} placeholder="Their name…" style={inp} />
            {recent.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>{recent.map((r) => <span key={r} onClick={() => setF({ ...f, opponent_name: r })} style={chip}>{r}</span>)}</div>}
          </div>
          {decks.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <DeckPicker decks={decks} value={f.deck_id} onChange={(id) => setF({ ...f, deck_id: id })} />
            </div>
          )}
          <div style={{ marginBottom: 22 }}>
            <Lbl t="NOTE" />
            <textarea value={f.notes} maxLength={200} onChange={(e) => setF({ ...f, notes: e.target.value.slice(0, 200) })} placeholder="Add a note about this match…"
              style={{ width: '100%', height: 100, resize: 'none', background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: 12, color: 'var(--ink-body)', font: "400 14px/1.5 var(--f-read)" }} />
            <div style={{ textAlign: 'right', font: "500 10px/1 var(--f-ui)", color: 'var(--ink-faint)', margin: '5px 2px 0' }}>{(f.notes || '').length}/200</div>
          </div>
          {log.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <Lbl t={`MATCH LOG · ${log.length}`} />
              <div style={{ maxHeight: 150, overflowY: 'auto' }} className="cx-scroll">
                {log.map((r) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', borderBottom: '1px solid var(--hair-12)' }}>
                    <span style={{ width: 56, font: "500 10px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>{new Date(r.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                    <span style={{ flex: 1, font: "500 12px/1 var(--f-ui)", color: 'var(--ink-body)' }}>{r.who === 'player' ? 'You' : 'Opp'} {r.delta > 0 ? 'gained' : 'lost'} {Math.abs(r.delta)}</span>
                    <span style={{ font: "600 12px/1 var(--f-mono)", color: 'var(--accent-jade)' }}>{r.to_life}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button onClick={del} style={{ ...ghost, flex: 1, color: 'var(--destructive)', borderColor: 'rgba(168,88,74,.4)' }}>Delete</button>
            <button onClick={save} style={{ ...gold, flex: 2 }}>Save changes</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// Deck picker built for scale (a user could have 50+ decks): the current pick +
// Clear up top, a search that filters to matches, and RECENT deck pills by
// default so the common case is one tap. Only shows search once the collection
// outgrows the pill row.
function DeckPicker({ decks, value, onChange }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const selected = decks.find((d) => d.id === value) || null;
  const recent = [...decks].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, 6);
  const results = needle ? decks.filter((d) => d.name.toLowerCase().includes(needle)).slice(0, 14) : recent;
  const chipOn = { ...chip, borderColor: 'rgba(220,184,111,.6)', color: 'var(--gold-head)' };
  const searchable = decks.length > 6;
  return (
    <div>
      <Lbl t="PILOTED DECK" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ flex: 1, minWidth: 0, font: "600 14px/1.2 var(--f-read)", color: selected ? 'var(--gold-head)' : 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected ? selected.name : 'No deck attributed'}</span>
        {selected && <button onClick={() => onChange(null)} style={{ ...ghost, flex: 'none', padding: '7px 13px', font: "600 11px/1 var(--f-ui)" }}>Clear</button>}
      </div>
      {searchable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 42, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 12px', marginBottom: 10 }}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.3" y2="16.3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your decks…" autoComplete="off"
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--ink-body)', font: "400 14px/1 var(--f-read)" }} />
        </div>
      )}
      {searchable && !needle && <div style={{ font: "600 9px/1 var(--f-ui)", letterSpacing: '.14em', color: 'var(--ink-faint)', margin: '2px 0 8px' }}>RECENT</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {results.map((d) => <span key={d.id} onClick={() => onChange(d.id)} style={value === d.id ? chipOn : chip}>{d.name}</span>)}
        {needle && !results.length && <span style={{ font: "italic 400 13px/1.4 var(--f-read)", color: 'var(--ink-faint)' }}>No decks match “{q}”.</span>}
      </div>
    </div>
  );
}
// Manual Add Match - Vitarum's Add Match form ported to the Arcanum Sheet.
function AddMatchSheet({ open, onClose, onSaved }) {
  const blank = () => { const now = new Date(); return { winner: 'player', pLife: 20, eLife: 0, opponent: '', date: localDay(now), time: localTime(now), pAvatar: '', eAvatar: '', deckId: '' }; };
  const [f, setF] = useState(blank);
  const [recent, setRecent] = useState([]);
  const [avatars, setAvatars] = useState([]);
  const [decks, setDecks] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(blank()); setBusy(false);
    recentOpponents().then(setRecent);
    listAvatars().then((a) => setAvatars(a.map((x) => x.name)));
    listDecks().then(setDecks);
  }, [open]);
  if (!open) return null;

  // Picking a piloted deck fills your avatar from the deck's own (still editable).
  function pickDeck(id) {
    const d = decks.find((x) => x.id === id);
    setF((prev) => ({ ...prev, deckId: id, pAvatar: id && d?.avatar?.name ? d.avatar.name : prev.pAvatar }));
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const playedAt = f.date ? new Date(`${f.date}T${f.time || '00:00'}`).toISOString() : new Date().toISOString();
      await addManualMatch({
        winner: f.winner, playerFinalLife: f.pLife, opponentFinalLife: f.eLife,
        opponentName: f.opponent.trim() || null, playedAt,
        playerAvatar: f.pAvatar || null, opponentAvatar: f.eAvatar || null,
        deckId: f.deckId || null,
      });
      haptic('medium');
      onSaved();
    } catch (e) { setBusy(false); toast('Could not add match: ' + e.message, { tone: 'danger' }); }
  }

  const avSelect = (val, set, placeholder) => (
    <select value={val} onChange={(e) => set(e.target.value)} style={{ ...sel, flex: 1 }}>
      <option value="">{placeholder}</option>
      {avatars.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );

  return (
    <Sheet open title="Add Match Record" onClose={onClose}>
      <div style={{ padding: '0 16px' }}>
        <Lbl t="RESULT" />
        <ChipRow style={{ marginBottom: 14 }}>
          {[['player', 'You won'], ['opponent', 'Opponent won'], ['draw', 'Draw']].map(([k, l]) => <Chip key={k} label={l} active={f.winner === k} onClick={() => setF({ ...f, winner: k })} />)}
        </ChipRow>
        <Lbl t="FINAL LIFE" />
        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <LifeStep label="You" v={f.pLife} set={(x) => setF({ ...f, pLife: x })} />
          <LifeStep label="Opp" v={f.eLife} set={(x) => setF({ ...f, eLife: x })} />
        </div>
        {decks.length > 0 && (
          <>
            <Lbl t="DECK PILOTED (optional)" />
            <select value={f.deckId} onChange={(e) => pickDeck(e.target.value)} style={{ ...sel, marginBottom: 14 }}>
              <option value="">No deck</option>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </>
        )}
        <Lbl t="AVATARS (optional)" />
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {avSelect(f.pAvatar, (v) => setF({ ...f, pAvatar: v }), 'Your avatar')}
          {avSelect(f.eAvatar, (v) => setF({ ...f, eAvatar: v }), 'Opponent avatar')}
        </div>
        <Lbl t="OPPONENT" />
        <input value={f.opponent} onChange={(e) => setF({ ...f, opponent: e.target.value })} placeholder="Their name…" style={inp} />
        {recent.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 0' }}>{recent.map((r) => <span key={r} onClick={() => setF({ ...f, opponent: r })} style={chip}>{r}</span>)}</div>}
        <Lbl t="WHEN" />
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input type="date" value={f.date} max={localDay(new Date())} onChange={(e) => setF({ ...f, date: e.target.value })} style={{ ...inp, flex: 1 }} />
          <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} style={{ ...inp, flex: 'none', width: 120 }} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ ...ghost, flex: 1 }}>Cancel</button>
          <button onClick={save} disabled={busy} style={{ ...gold, flex: 1, opacity: busy ? 0.6 : 1 }}>{busy ? 'Adding…' : 'Add Match'}</button>
        </div>
      </div>
    </Sheet>
  );
}

// Import a shared result (opponent's QR / deep link). The payload arrives ALREADY
// mirrored to this player's side, so they just confirm and attribute their own
// deck; it lands as a manual match. Rendered at App level so a deep link can open
// it from any tab.
export function ImportMatchSheet({ payload, onClose, onSaved }) {
  const [f, setF] = useState(null);
  const [decks, setDecks] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!payload) { setF(null); return; }
    setF({
      winner: payload.winner || 'draw',
      player_final_life: payload.playerFinalLife ?? 20,
      opponent_final_life: payload.opponentFinalLife ?? 0,
      opponent_name: payload.opponentName || '',
      player_avatar: payload.playerAvatar || null,
      opponent_avatar: payload.opponentAvatar || null,
      deck_id: null,
      playedAt: payload.playedAt || null,
      durationSec: payload.durationSec || 0,
    });
    setBusy(false);
    listDecks().then(setDecks);
  }, [payload]);
  if (!payload || !f) return null;
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await addManualMatch({
        winner: f.winner, playerFinalLife: f.player_final_life, opponentFinalLife: f.opponent_final_life,
        opponentName: f.opponent_name.trim() || null, playedAt: f.playedAt || undefined,
        playerAvatar: f.player_avatar || null, opponentAvatar: f.opponent_avatar || null,
        durationSec: f.durationSec, deckId: f.deck_id || null,
      });
      haptic('medium'); onSaved();
    } catch (e) { setBusy(false); toast('Could not import: ' + e.message, { tone: 'danger' }); }
  }
  return (
    <Sheet open title="Import result" onClose={onClose}>
      <div style={{ padding: '0 20px' }}>
        <div style={{ font: "italic 400 13px/1.5 'EB Garamond',Georgia,serif", color: 'var(--ink-muted)', marginBottom: 16 }}>
          Shared by <span style={{ fontStyle: 'normal', color: 'var(--gold-head)' }}>{payload.opponentName || 'your opponent'}</span>. Confirm the result and attribute your own deck.
        </div>
        <div style={{ marginBottom: 22 }}>
          <Lbl t="RESULT" />
          <ChipRow>{[['player', 'You won'], ['opponent', 'Opponent won'], ['draw', 'Draw']].map(([k, l]) => <Chip key={k} label={l} active={f.winner === k} onClick={() => setF({ ...f, winner: k })} />)}</ChipRow>
        </div>
        <div style={{ marginBottom: 22 }}>
          <Lbl t="FINAL LIFE" />
          <div style={{ display: 'flex', gap: 14 }}>
            <LifeStep label="You" v={f.player_final_life} set={(x) => setF({ ...f, player_final_life: x })} />
            <LifeStep label="Opp" v={f.opponent_final_life} set={(x) => setF({ ...f, opponent_final_life: x })} />
          </div>
        </div>
        <div style={{ marginBottom: 22 }}>
          <Lbl t="OPPONENT" />
          <input value={f.opponent_name} onChange={(e) => setF({ ...f, opponent_name: e.target.value })} placeholder="Their name…" style={inp} />
        </div>
        {decks.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <DeckPicker decks={decks} value={f.deck_id} onChange={(id) => setF({ ...f, deck_id: id })} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button onClick={onClose} style={{ ...ghost, flex: 1 }}>Cancel</button>
          <button onClick={save} disabled={busy} style={{ ...gold, flex: 2, opacity: busy ? 0.6 : 1 }}>{busy ? 'Importing…' : 'Import match'}</button>
        </div>
      </div>
    </Sheet>
  );
}
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localTime = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

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
// Styled <select> - the input chassis + our own gold chevron instead of the
// native picker arrow; colorScheme keeps the dropdown list dark on device.
const sel = {
  ...inp, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer', colorScheme: 'dark',
  padding: '0 34px 0 14px',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a99878' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 13px center',
};
const chip = { padding: '5px 11px', borderRadius: 16, border: '1px solid var(--hair-22)', font: "500 12px/1 var(--f-read)", color: 'var(--ink-status)', cursor: 'pointer' };
const ghost = { ...BTN_GHOST, padding: '11px 0', font: "600 12px/1 var(--f-ui)" };
const gold = { ...BTN_GOLD, padding: '11px 18px' };

// FAB menu iconography - a plus-in-square (record a match by hand) vs a QR
// (import one an opponent shared).
// New Match = full tracked duel (brand diamond). Quick Match = counter only, fast (bolt).
const NewMatchSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 22 12 12 22 2 12" /></svg>;
const QuickMatchSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;
const AddRecordSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>;
const QrImportSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v.01M14 21h.01M17 21h.01M21 17v4" /></svg>;
