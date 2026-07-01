// Life counter — VERBATIM visual/motion port of Vitarum's counter screen.
// DOM structure, class names and animation constants are copied from Vitarum's
// index.html. The numerals + roll-off + bump are driven IMPERATIVELY (refs +
// classList, exactly like the reference) so React never overwrites the animation
// mid-flight; the numeral element's JSX className is a constant, so React sets it
// once and never touches it again.
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../theme/counter.css';
import { BottomSheet, IconButton } from '../components/ui.jsx';
import { recentOpponents } from '../store/playRepository.js';
import { haptic, setKeepAwake } from '../native.js';

const BASE = import.meta.env.BASE_URL;
const LOG_GAP_MS = 1200;

export default function LifeCounter({ settings, mode, players = {}, onEnd, onExit }) {
  const start = Math.min(20, settings.default_max_life || 20); // Sorcery: life ≤ 20
  const quick = mode === 'quick';
  const skin = settings.accent_metal && settings.accent_metal !== 'gilded' ? settings.accent_metal : undefined;

  const pRef = useRef({ life: start, max: start });
  const eRef = useRef({ life: start, max: start });
  const [, force] = useState(0);            // re-render for dd-pill / status badge / max
  const [deltas, setDeltas] = useState([]);
  const [rollPhase, setRollPhase] = useState('armed');   // 'armed' | 'rolling' | 'result' | null
  const [flip, setFlip] = useState(0);
  const [catcher, setCatcher] = useState(false);
  const [fabP, setFabP] = useState(false);
  const [fabE, setFabE] = useState(false);
  const [sheet, setSheet] = useState(null);              // 'log'|'dice'|'maxP'|'maxE'|'end'
  const [dice, setDice] = useState({ type: settings.die_type || 6, value: null });
  const [oppName, setOppName] = useState('');
  const [recent, setRecent] = useState([]);
  const [log, setLog] = useState([]);

  const pNumRef = useRef(null), eNumRef = useRef(null);
  const startedAt = useRef(Date.now());
  const lastLog = useRef(null);
  const deltaId = useRef(0);
  const timers = useRef([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // ── numeral rendering (imperative, mirrors renderLife) ──
  function setNum(el, life) {
    if (!el) return;
    const dd = life <= 0;
    el.textContent = dd ? 'DD' : String(life);
    el.classList.toggle('dd', dd);
    el.classList.toggle('dd-pulse', dd);
  }
  function renderLife() { setNum(pNumRef.current, pRef.current.life); setNum(eNumRef.current, eRef.current.life); }

  useEffect(() => {
    renderLife();
    recentOpponents().then(setRecent);
    if (settings.keep_awake) setKeepAwake(true);
    if (!settings.film_grain) document.body.classList.add('grain-off');
    armRollOff();
    return () => { clearTimers(); document.body.classList.remove('roll-active', 'grain-off'); setKeepAwake(false); };
    // eslint-disable-next-line
  }, []);

  // body.roll-active while the roll-off pill is up (hides FABs, locks tap zones — verbatim)
  useEffect(() => {
    document.body.classList.toggle('roll-active', rollPhase != null);
  }, [rollPhase]);

  // ── life change (verbatim changeLife) ──
  function appendLog(who, delta, toLife) {
    const now = Date.now();
    setLog((prev) => {
      const last = prev[prev.length - 1];
      if (last && lastLog.current && last.who === who && Math.sign(last.delta) === Math.sign(delta) && now - lastLog.current <= LOG_GAP_MS) {
        lastLog.current = now; return [...prev.slice(0, -1), { ...last, delta: last.delta + delta, toLife }];
      }
      lastLog.current = now; return [...prev, { t: new Date().toISOString(), who, kind: 'life', delta, toLife }];
    });
  }
  function showDelta(who, delta) {
    const id = ++deltaId.current;
    setDeltas((d) => [...d, { id, who, delta }]);
    setTimeout(() => setDeltas((d) => d.filter((x) => x.id !== id)), 1000);
  }
  function bump(who, delta) {                       // pop the numeral (remove → reflow → add restarts it)
    const el = who === 'player' ? pNumRef.current : eNumRef.current;
    if (!el) return;
    el.classList.remove('bump-up', 'bump-down');
    void el.offsetWidth;
    el.classList.add(delta > 0 ? 'bump-up' : 'bump-down');
  }
  function change(who, delta) {
    const cur = who === 'player' ? pRef.current : eRef.current;
    if (cur.life <= 0 && delta < 0) { end(who === 'player' ? 'opponent' : 'player'); return; }
    const next = Math.min(cur.max, cur.life + delta);
    if (next === cur.life) return;
    const nl = { ...cur, life: next };
    (who === 'player' ? pRef : eRef).current = nl;
    (who === 'player' ? pNumRef : eNumRef).current && setNum(who === 'player' ? pNumRef.current : eNumRef.current, next);
    appendLog(who, delta, next);
    showDelta(who, delta);
    bump(who, delta);
    haptic('light');
    force((n) => n + 1);   // update dd-pill visibility
  }
  function setMax(who, max) {
    const cur = who === 'player' ? pRef.current : eRef.current;
    const nl = { life: Math.min(cur.life, max), max };
    (who === 'player' ? pRef : eRef).current = nl;
    setNum(who === 'player' ? pNumRef.current : eNumRef.current, nl.life);
    setSheet(null); force((n) => n + 1);
  }
  function reset() {
    pRef.current = { life: start, max: start }; eRef.current = { life: start, max: start };
    setLog([]); lastLog.current = null; renderLife(); setSheet(null); setFabP(false); setFabE(false);
    armRollOff(); force((n) => n + 1);
  }

  // ── turn-order roll-off (verbatim constants) ──
  function _clearRoll() {
    clearTimers();
    pNumRef.current?.classList.remove('roll-win', 'roll-lose');
    eNumRef.current?.classList.remove('roll-win', 'roll-lose');
  }
  function armRollOff() {
    _clearRoll(); setCatcher(false); setFlip(0); setRollPhase('armed');
  }
  function startRollOff() {
    if (rollPhase !== 'armed') return;              // ignore taps once rolling
    setRollPhase('rolling'); _clearRoll();
    const pEl = pNumRef.current, eEl = eNumRef.current;
    const d20 = () => 1 + Math.floor(Math.random() * 20);
    let pVal = d20(), eVal = d20();
    while (eVal === pVal) eVal = d20();             // reroll ties
    const winner = pVal > eVal ? 'player' : 'enemy';
    const total = 16 + Math.floor(Math.random() * 8); // 16–23 spins
    let step = 0;
    const tick = () => {
      if (step >= total) {
        pEl.textContent = pVal; eEl.textContent = eVal;
        haptic('medium');
        timers.current.push(setTimeout(() => _rollDone(winner), 360));
        return;
      }
      pEl.textContent = d20(); eEl.textContent = d20();
      step++;
      const delay = 45 + Math.pow(step / total, 2.7) * 520;   // decelerating spin
      if (delay > 170) haptic('light');
      timers.current.push(setTimeout(tick, delay));
    };
    tick();
  }
  function _rollDone(winner) {
    pNumRef.current?.classList.add(winner === 'player' ? 'roll-win' : 'roll-lose');
    eNumRef.current?.classList.add(winner === 'enemy' ? 'roll-win' : 'roll-lose');
    setFlip(winner === 'player' ? 0 : 180);         // flip result toward the winner
    timers.current.push(setTimeout(() => { setRollPhase('result'); setCatcher(true); }, 650));
  }
  function finishRollOff() {
    setCatcher(false); setRollPhase(null); _clearRoll();
    startedAt.current = Date.now();                 // roll-off doesn't count toward match length
    renderLife();
  }

  function end(winner) {
    const p = pRef.current, e = eRef.current;
    const w = winner || (p.life <= 0 ? 'opponent' : e.life <= 0 ? 'player' : p.life === e.life ? 'draw' : p.life > e.life ? 'player' : 'opponent');
    onEnd({
      mode, winner: w, playerFinalLife: p.life, opponentFinalLife: e.life,
      durationSec: Math.round((Date.now() - startedAt.current) / 1000), log,
      playerAvatar: players.you?.name || null, opponentAvatar: players.opp?.name || null,
      opponentName: oppName.trim() || null,
    });
  }

  const pImg = players.you ? `${BASE}cards/${players.you.image_slug}` : '';
  const eImg = players.opp ? `${BASE}cards/${players.opp.image_slug}` : '';
  const p = pRef.current, e = eRef.current;

  return (
    <div id="counter-screen" className={`vc-root${quick ? ' quick' : ''}`} data-skin={skin}>
      {/* Enemy half (rotated 180° for across-table reading) */}
      <div className="counter-half enemy-half" id="enemy-half">
        <img className="half-bg" id="enemy-bg" src={eImg} alt="" />
        <div className="half-gradient" />
        <div className="half-grain" />
        <div className="life-display">
          <div className="life-number" id="enemy-life-num" ref={eNumRef} role="status" aria-live="polite" />
          <div className={`dd-pill${rollPhase == null && e.life <= 0 ? ' show' : ''}`} onClick={() => setSheet('end')} role="button" aria-label="End match - opponent at Death's Door">
            <div className="dd-pill-body">{DDSvg}End Match</div>
          </div>
        </div>
        {e.max < 20 && <div className="status-badges"><div className="status-badge maxlife">{HeartSvg}{e.max}</div></div>}
        <div className="tap-zone tap-plus" onClick={() => change('opponent', +1)} role="button" aria-label="Increase opponent's life" />
        <div className="tap-zone tap-minus" onClick={() => change('opponent', -1)} role="button" aria-label="Decrease opponent's life" />
        {/* Opponent FAB (rotates with the half) */}
        <div className={`opponent-fab-wrap${fabE ? ' open' : ''}`} id="opponent-fab">
          <div className="fab-menu">
            <button onClick={() => { setFabE(false); setSheet('dice'); }}>{DiceSvg}Roll a Die</button>
            <button onClick={() => { setFabE(false); setSheet('maxE'); }}>{HeartSvg}Change Max Life</button>
          </div>
          <button className="fab" onClick={(ev) => { ev.stopPropagation(); setFabE((v) => !v); }} aria-label="Opponent options">{DotsSvg}</button>
        </div>
      </div>

      <div className="counter-divider" />

      {/* Player half */}
      <div className="counter-half player-half" id="player-half">
        <img className="half-bg" id="player-bg" src={pImg} alt="" />
        <div className="half-gradient" />
        <div className="half-grain" />
        <div className="life-display">
          <div className="life-number" id="player-life-num" ref={pNumRef} role="status" aria-live="polite" />
          <div className={`dd-pill${rollPhase == null && p.life <= 0 ? ' show' : ''}`} onClick={() => setSheet('end')} role="button" aria-label="End match - you are at Death's Door">
            <div className="dd-pill-body">{DDSvg}End Match</div>
          </div>
        </div>
        {p.max < 20 && <div className="status-badges"><div className="status-badge maxlife">{HeartSvg}{p.max}</div></div>}
        <div className="tap-zone tap-plus" onClick={() => change('player', +1)} role="button" aria-label="Increase your life" />
        <div className="tap-zone tap-minus" onClick={() => change('player', -1)} role="button" aria-label="Decrease your life" />
      </div>

      {/* floating deltas rendered INTO the correct half (so the enemy rotation applies) */}
      {deltas.map((d) => {
        const host = document.getElementById(d.who === 'player' ? 'player-half' : 'enemy-half');
        return host ? createPortal(
          <div key={d.id} className={`life-delta ${d.delta > 0 ? 'plus' : 'minus'}`}>{d.delta > 0 ? `+${d.delta}` : `${d.delta}`}</div>,
          host, String(d.id),
        ) : null;
      })}

      {/* Player FAB (fixed, bottom-right) */}
      <div className={`fab-wrap${fabP ? ' open' : ''}`} id="counter-fab">
        <div className="fab-menu">
          <button onClick={() => { setFabP(false); setSheet('log'); }}>{LogSvg}Match Log</button>
          <button onClick={() => { setFabP(false); setSheet('dice'); }}>{DiceSvg}Roll a Die</button>
          <button onClick={() => { setFabP(false); setSheet('maxP'); }}>{HeartSvg}Change Max Life</button>
          <button onClick={() => { setFabP(false); reset(); }}>{ResetSvg}Reset Match</button>
          <button onClick={() => { setFabP(false); setSheet('end'); }}>{FlagSvg}End Match</button>
          <button onClick={() => { setFabP(false); onExit(); }}>{HomeSvg}Home</button>
        </div>
        <button className="fab" onClick={(ev) => { ev.stopPropagation(); setFabP((v) => !v); }} aria-label="Options">{DotsSvg}</button>
      </div>

      {/* Morphing turn-order pill + tap catcher */}
      <div id="roll-pill" className={rollPhase === 'armed' ? 'show armed' : rollPhase === 'result' ? 'show result' : ''}
        onClick={rollPhase === 'armed' ? startRollOff : undefined} role="button" aria-label="Roll for turn order">
        <div id="roll-pill-body" style={{ '--flip': flip + 'deg' }}>
          <span className="roll-pill-go"><span className="rp-glyph">⬡</span><span className="rp-label">Roll for Turn</span></span>
          <span className="roll-pill-pick"><span className="rp-main">Your pick</span><span className="rp-hint">Tap to start</span></span>
        </div>
      </div>
      <div id="roll-tap-catcher" className={catcher ? 'show' : ''} onClick={finishRollOff} role="button" aria-label="Start match" />

      {/* sheets (secondary) */}
      <MatchLogSheet open={sheet === 'log'} log={log} onClose={() => setSheet(null)} />
      <MaxLifeSheet open={sheet === 'maxP'} value={p.max} onClose={() => setSheet(null)} onSet={(v) => setMax('player', v)} />
      <MaxLifeSheet open={sheet === 'maxE'} value={e.max} onClose={() => setSheet(null)} onSet={(v) => setMax('opponent', v)} />
      <DiceSheet open={sheet === 'dice'} dice={dice} setDice={setDice} onRoll={() => setDice((x) => ({ ...x, value: 1 + Math.floor(Math.random() * x.type) }))} onClose={() => setSheet(null)} />
      <EndSheet open={sheet === 'end'} onClose={() => setSheet(null)} onPlayer={() => end('player')} onOpp={() => end('opponent')} onAuto={() => end(null)}
        oppName={oppName} setOppName={setOppName} recent={recent} />
    </div>
  );
}

/* ── sheets (Compendium bottom-sheet style; not part of the verbatim counter) ── */
function MatchLogSheet({ open, log, onClose }) {
  const rows = [...log].reverse();
  return (
    <BottomSheet open={open} title="MATCH LOG" onClose={onClose}>
      {rows.length === 0 ? <div style={{ font: "400 13.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', textAlign: 'center', padding: 12 }}>No life changes yet.</div>
        : rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: '1px solid var(--hair-12)' }}>
            <span style={{ font: "500 11px/1 var(--f-mono)", color: 'var(--ink-faint)', width: 66 }}>{new Date(r.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            <span style={{ flex: 1, font: "600 13px/1 var(--f-ui)", color: 'var(--ink-body)' }}>{r.who === 'player' ? 'You' : 'Opponent'} {r.delta > 0 ? 'gained' : 'lost'} {Math.abs(r.delta)}</span>
            <span style={{ font: "600 13px/1 var(--f-mono)", color: 'var(--accent-jade)' }}>♥ {r.toLife}</span>
          </div>
        ))}
    </BottomSheet>
  );
}
function MaxLifeSheet({ open, value, onClose, onSet }) {
  const [v, setV] = useState(value);
  useEffect(() => { if (open) setV(value); }, [open, value]);
  return (
    <BottomSheet open={open} title="MAX LIFE" onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, margin: '6px 0 18px' }}>
        <IconButton glyph="−" tone="muted" size={36} onClick={() => setV((x) => Math.max(1, x - 1))} />
        <span style={{ font: "700 34px/1 var(--f-display)", color: 'var(--gold-leaf)', minWidth: 56, textAlign: 'center' }}>{v}</span>
        <IconButton glyph="+" size={36} onClick={() => setV((x) => Math.min(20, x + 1))} />
      </div>
      <button onClick={() => onSet(v)} style={goldBtn}>Set max life</button>
    </BottomSheet>
  );
}
function DiceSheet({ open, dice, setDice, onRoll, onClose }) {
  return (
    <BottomSheet open={open} title="ROLL A DIE" onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        {[4, 6, 8, 10, 12, 20].map((d) => (
          <button key={d} onClick={() => setDice((x) => ({ ...x, type: d, value: null }))} style={{ width: 46, height: 46, borderRadius: 10, border: `1px solid ${dice.type === d ? 'var(--gold-leaf)' : 'var(--hair-22)'}`, background: dice.type === d ? 'rgba(207,154,74,.16)' : 'transparent', color: dice.type === d ? 'var(--gold-leaf)' : 'var(--ink-status)', font: "600 13px/1 var(--f-ui)", cursor: 'pointer' }}>d{d}</button>
        ))}
      </div>
      {dice.value != null && <div style={{ textAlign: 'center', font: "700 44px/1 var(--f-display)", color: 'var(--gold-leaf)', marginBottom: 14 }}>{dice.value}</div>}
      <button onClick={onRoll} style={goldBtn}>Roll d{dice.type}</button>
    </BottomSheet>
  );
}
function EndSheet({ open, onClose, onPlayer, onOpp, onAuto, oppName, setOppName, recent }) {
  const item = (label, fn, accent) => (
    <div onClick={fn} className="cx-row" style={{ textAlign: 'center', padding: '14px 0', borderRadius: 12, border: `1px solid ${accent || 'var(--hair-22)'}`, color: accent || 'var(--ink-body)', font: "600 14px/1 var(--f-ui)", cursor: 'pointer', marginBottom: 10 }}>{label}</div>
  );
  return (
    <BottomSheet open={open} title="END MATCH" onClose={onClose}>
      <div style={{ font: "600 10px/1 var(--f-ui)", letterSpacing: '.14em', color: 'var(--ink-muted)', marginBottom: 8 }}>OPPONENT (OPTIONAL)</div>
      <input value={oppName} onChange={(e) => setOppName(e.target.value)} placeholder="Their name…"
        style={{ width: '100%', height: 42, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)", marginBottom: 8 }} />
      {recent.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {recent.map((r) => <span key={r} onClick={() => setOppName(r)} style={{ padding: '5px 11px', borderRadius: 16, border: '1px solid var(--hair-22)', font: "500 12px/1 var(--f-read)", color: 'var(--ink-status)', cursor: 'pointer' }}>{r}</span>)}
        </div>
      )}
      {item('You won', onPlayer, 'var(--accent-jade)')}
      {item('Opponent won', onOpp)}
      {item('Use current life totals', onAuto)}
    </BottomSheet>
  );
}
const goldBtn = { width: '100%', padding: '13px 0', borderRadius: 12, background: 'linear-gradient(180deg,#dcb86f,#c9a35a)', color: '#1a1410', font: "700 14px/1 var(--f-ui)", border: 'none', cursor: 'pointer' };

/* ── icons (from Vitarum's counter DOM) ── */
const s = { width: 17, height: 17, opacity: .8 };
const DotsSvg = <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }} aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>;
const DiceSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><rect x="2" y="2" width="20" height="20" rx="4" /><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="8" cy="16" r="1.2" fill="currentColor" stroke="none" /><circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /></svg>;
const HeartSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" /></svg>;
const DDSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.2C7.6 3.2 4.5 6.5 4.5 10.5c0 2.6 1.3 4.6 2.6 5.8.3.3.4.6.4 1v1.4c0 .8.6 1.5 1.5 1.5h1.1c.5 0 .9-.4.9-.9v-1c0-.3.2-.5.5-.5h.9c.3 0 .5.2.5.5v1c0 .5.4.9.9.9h1.1c.8 0 1.5-.7 1.5-1.5v-1.4c0-.4.1-.7.4-1 1.3-1.2 2.6-3.2 2.6-5.8 0-4-3.1-7.3-7.5-7.3z" /><ellipse cx="9" cy="10.6" rx="1.7" ry="2.1" fill="currentColor" stroke="none" /><ellipse cx="15" cy="10.6" rx="1.7" ry="2.1" fill="currentColor" stroke="none" /></svg>;
const LogSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>;
const ResetSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>;
const FlagSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>;
const HomeSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>;
