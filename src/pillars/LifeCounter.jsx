// Life counter - VERBATIM visual/motion port of Vitarum's counter screen, plus
// its full-screen end-match modal and centered secondary modals (Dice / Max Life
// / Match Log). Supports RESUME: a match can be minimized (leave to check a Codex
// rule) and returned to, preserving life totals, log and banked elapsed time.
// Numerals + roll-off + bump are driven IMPERATIVELY (refs + classList) so React
// never overwrites the animation mid-flight.
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../theme/counter.css';
import { recentOpponents, setSetting } from '../store/playRepository.js';
import { buildMatchShare } from '../store/matchShare.js';
import QRCode from '../components/QRCode.jsx';
import { haptic, setKeepAwake, setImmersive, shareLink } from '../native.js';
import { registerBackConsumer } from '../back.js';

const BASE = import.meta.env.BASE_URL;
const LOG_GAP_MS = 1200;
const ROLL_DISMISS_TAPS = 5;   // life taps after which the armed roll offer retires itself

function fmtDur(secs) {
  secs = Math.max(0, Math.round(secs || 0));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
// Digital clock face for the match strip - "12:05" / "1:23:45" (Vitarum _tickClock).
function fmtClock(secs) {
  secs = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export default function LifeCounter({ settings, mode, players = {}, deck = null, resume = null, onMinimize, onRecord, onExit, onNewMatch, registerApi }) {
  const start = Math.min(20, settings.default_max_life || 20); // Sorcery: life ≤ 20
  const quick = mode === 'quick';

  const pRef = useRef(resume ? { life: resume.pLife, max: resume.pMax } : { life: start, max: start });
  const eRef = useRef(resume ? { life: resume.eLife, max: resume.eMax } : { life: start, max: start });
  const [, force] = useState(0);            // re-render for dd-pill / status badge / max
  const [deltas, setDeltas] = useState([]);
  const [rollPhase, setRollPhase] = useState(resume ? null : 'armed');   // 'armed'|'rolling'|'result'|null
  const [resultLeft, setResultLeft] = useState(4);   // seconds left on the "Your pick" pill
  const [flip, setFlip] = useState(0);
  const [fabP, setFabP] = useState(false);
  const [fabE, setFabE] = useState(false);
  const [sheet, setSheet] = useState(null);              // 'log'|'dice'|'maxP'|'maxE'|'tweaks'
  // Tweaks - Vitarum's counter-local comforts (keep awake / hide status bar /
  // film grain). Persisted per profile, applied live to the running match.
  const [tw, setTw] = useState({ keep_awake: !!settings.keep_awake, immersive: !!settings.immersive, film_grain: settings.film_grain !== 0 });
  const [dice, setDice] = useState({ type: settings.die_type || 6, value: null });
  const [oppName, setOppName] = useState(resume?.oppName || '');
  const [recent, setRecent] = useState([]);
  const [log, setLog] = useState(resume?.log || []);
  const [endInfo, setEndInfo] = useState(null);          // { winner, pLife, eLife, durationSec, recorded }
  const [confirm, setConfirm] = useState(null);          // { label, action } - in-world discard confirm
  const [clockOn, setClockOn] = useState(resume?.clockOn ?? false);   // match clock; persists across minimize/resume

  const pNumRef = useRef(null), eNumRef = useRef(null);
  const startedAt = useRef(Date.now());
  const elapsedBase = useRef(resume?.elapsedSec || 0);   // banked elapsed from prior segments
  const lastLog = useRef(null);
  const deltaId = useRef(0);
  const lifeTaps = useRef(0);   // successful life taps since the roll offer armed
  const activeDelta = useRef({ player: null, enemy: null });   // {id,sign} of the live (still-counting) delta bubble per side
  const deltaTimers = useRef({ player: null, enemy: null });   // per-side "you've stopped tapping" release timers
  const timers = useRef([]);
  const recordingRef = useRef(false);   // in-flight guard for Record (blocks double-tap)
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // Once recorded, a match stays recorded across minimize/resume so it can't be
  // saved twice (double W/L). Seeded from the resumed snapshot.
  const recordedRef = useRef(!!resume?.recorded);
  const elapsedSec = () => Math.round(elapsedBase.current + (Date.now() - startedAt.current) / 1000);
  function buildSnapshot() {
    return {
      v: 1, mode, settings, you: players.you || null, opp: players.opp || null, deck,
      pLife: pRef.current.life, pMax: pRef.current.max, eLife: eRef.current.life, eMax: eRef.current.max,
      log, elapsedSec: elapsedSec(), oppName, recorded: recordedRef.current, clockOn,
    };
  }
  const snapRef = useRef();
  snapRef.current = buildSnapshot;
  function minimize() { onMinimize?.(snapRef.current()); }
  // Refs mirror the modal layers so the (mount-time) hardware-back handler can
  // read current state. Hardware back must peel the topmost layer - NOT jump
  // straight to minimize, which would hide an open (possibly already-recorded)
  // end screen and let it be resumed + recorded a second time.
  const endRef = useRef(null); endRef.current = endInfo;
  const sheetRef = useRef(null); sheetRef.current = sheet;
  const fabRef = useRef(false); fabRef.current = fabP || fabE;
  const confirmRef = useRef(null); confirmRef.current = confirm;
  function closeTopmost() {
    if (confirmRef.current) { setConfirm(null); return; }
    if (endRef.current) { setEndInfo(null); return; }
    if (sheetRef.current) { setSheet(null); return; }
    if (fabRef.current) { setFabP(false); setFabE(false); return; }
    minimize();
  }

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
    if (settings.immersive) setImmersive(true);
    if (!settings.film_grain) document.body.classList.add('grain-off');
    if (!resume) armRollOff();                 // resumed matches already rolled for turn order
    registerApi?.({ minimize: () => onMinimize?.(snapRef.current()), closeTopmost });
    // The Web Wake Lock auto-releases when the app is backgrounded and does NOT
    // re-acquire on return - and the OS restores the status bar. Re-assert both
    // when the match returns to the foreground (the resume flow makes this common).
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (settings.keep_awake) setKeepAwake(true);
      if (settings.immersive) setImmersive(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimers(); clearTimeout(deltaTimers.current.player); clearTimeout(deltaTimers.current.enemy); document.removeEventListener('visibilitychange', onVisible); document.body.classList.remove('roll-active', 'grain-off'); setKeepAwake(false); setImmersive(false); registerApi?.(null); };
    // eslint-disable-next-line
  }, []);

  // Tweaks toggle - persists to the profile's settings AND applies immediately.
  function setTweak(key, on) {
    setTw((t) => ({ ...t, [key]: on }));
    setSetting(key, on ? 1 : 0).catch(() => {});
    if (key === 'keep_awake') setKeepAwake(on);
    if (key === 'immersive') setImmersive(on);
    if (key === 'film_grain') document.body.classList.toggle('grain-off', !on);
    haptic('light');
  }

  // The roll-off is OPTIONAL and never blocks *starting* the match (the armed
  // pill just floats as an offer - armed = fully interactive: tap life, open
  // menus, leave). But once you commit to rolling, the counter stays locked
  // through the spin AND the 4s result countdown: the life numerals are borrowed
  // to tumble the dice, and a stray tap the instant the winner lands is confusing
  // - it drops the reveal and edits life before you've read it. So block taps /
  // FABs for the whole 'rolling' + 'result' window; they free up when it finishes.
  useEffect(() => { document.body.classList.toggle('roll-active', rollPhase === 'rolling' || rollPhase === 'result'); }, [rollPhase]);

  // Match clock - re-render once a second while it's showing (elapsedSec() reads
  // live). Stops once the match is decided; CSS hides it during the roll-off.
  useEffect(() => {
    if (!clockOn || endInfo) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [clockOn, endInfo]);

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
  // Release the live bubble for a side: mark it floating (CSS .released) and bin
  // it once the rise animation is done.
  function releaseDelta(who) {
    const active = activeDelta.current[who];
    if (!active) return;
    activeDelta.current[who] = null;
    clearTimeout(deltaTimers.current[who]);
    setDeltas((list) => list.map((x) => (x.id === active.id ? { ...x, released: true } : x)));
    timers.current.push(setTimeout(() => setDeltas((list) => list.filter((x) => x.id !== active.id)), 850));
  }
  // The floating badge coalesces exactly like the match log: successive taps on
  // the same side in the same direction fold into one bubble that counts up in
  // place (+1, +2, +3...). When you stop tapping (LOG_GAP_MS of quiet) that
  // running total floats away. A direction flip retires the old bubble first.
  function showDelta(who, delta) {
    const sign = Math.sign(delta);
    const active = activeDelta.current[who];
    if (active && active.sign === sign) {
      setDeltas((list) => list.map((x) => (x.id === active.id ? { ...x, delta: x.delta + delta } : x)));
    } else {
      if (active) releaseDelta(who);
      const id = ++deltaId.current;
      activeDelta.current[who] = { id, sign };
      setDeltas((list) => [...list, { id, who, delta, released: false }]);
    }
    clearTimeout(deltaTimers.current[who]);
    deltaTimers.current[who] = setTimeout(() => releaseDelta(who), LOG_GAP_MS);
  }
  function bump(who, delta) {
    const el = who === 'player' ? pNumRef.current : eNumRef.current;
    if (!el) return;
    el.classList.remove('bump-up', 'bump-down');
    void el.offsetWidth;
    el.classList.add(delta > 0 ? 'bump-up' : 'bump-down');
  }
  function change(who, delta) {
    // A tap while a FAB menu is open just dismisses it - never a stray life edit.
    if (fabP || fabE) { setFabP(false); setFabE(false); haptic('light'); return; }
    const cur = who === 'player' ? pRef.current : eRef.current;
    if (cur.life <= 0 && delta < 0) { triggerEnd(who === 'player' ? 'opponent' : 'player'); return; }
    const next = Math.min(cur.max, cur.life + delta);
    if (next === cur.life) return;
    const nl = { ...cur, life: next };
    (who === 'player' ? pRef : eRef).current = nl;
    setNum(who === 'player' ? pNumRef.current : eNumRef.current, next);
    appendLog(who, delta, next);
    showDelta(who, delta);
    bump(who, delta);
    haptic('light');
    force((n) => n + 1);
    // Once the player has clearly settled into tracking life, retire the centre
    // roll offer (with a fade) so it can never sit in the way of a fast tap.
    if (rollPhase === 'armed' && ++lifeTaps.current >= ROLL_DISMISS_TAPS) fadeOutRoll();
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
    setLog([]); lastLog.current = null; setEndInfo(null);
    setDeltas([]); activeDelta.current = { player: null, enemy: null };
    clearTimeout(deltaTimers.current.player); clearTimeout(deltaTimers.current.enemy);
    elapsedBase.current = 0; startedAt.current = Date.now();
    recordedRef.current = false;   // a fresh game (Go Again / Reset) can be recorded anew
    renderLife(); setSheet(null); setFabP(false); setFabE(false);
    armRollOff(); force((n) => n + 1);
  }

  // ── turn-order roll-off (verbatim constants) ──
  function _clearRoll() {
    clearTimers();
    pNumRef.current?.classList.remove('roll-win', 'roll-lose');
    eNumRef.current?.classList.remove('roll-win', 'roll-lose');
  }
  function armRollOff() { _clearRoll(); setFlip(0); lifeTaps.current = 0; setRollPhase('armed'); }
  function startRollOff() {
    if (rollPhase !== 'armed') return;
    setRollPhase('rolling'); _clearRoll();
    const pEl = pNumRef.current, eEl = eNumRef.current;
    const d20 = () => 1 + Math.floor(Math.random() * 20);
    let pVal = d20(), eVal = d20();
    while (eVal === pVal) eVal = d20();
    const winner = pVal > eVal ? 'player' : 'enemy';
    const total = 10 + Math.floor(Math.random() * 6);   // ~1s shorter tumble than Vitarum's 16-23 ticks
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
      const delay = 45 + Math.pow(step / total, 2.7) * 520;
      if (delay > 170) haptic('light');
      timers.current.push(setTimeout(tick, delay));
    };
    tick();
  }
  function _rollDone(winner) {
    pNumRef.current?.classList.add(winner === 'player' ? 'roll-win' : 'roll-lose');
    eNumRef.current?.classList.add(winner === 'enemy' ? 'roll-win' : 'roll-lose');
    setFlip(winner === 'player' ? 0 : 180);
    // Reveal the result and HOLD it: the rolled dice faces + win/lose highlight
    // stay on the numerals through the whole 4s countdown (locked by roll-active +
    // the .roll-lock catcher, so nothing can touch them). Only finishRollOff()
    // swaps the real life totals back, once the countdown ends - so the result
    // never jumps to the life total early.
    timers.current.push(setTimeout(() => { setRollPhase('result'); setResultLeft(4); }, 650));
    for (let i = 1; i <= 3; i++) timers.current.push(setTimeout(() => setResultLeft(4 - i), 650 + i * 1000));
    timers.current.push(setTimeout(() => finishRollOff(), 650 + 4000));
  }
  function finishRollOff() {
    setRollPhase(null); _clearRoll();
    renderLife();   // restore the real life totals over the tumbled dice faces
  }
  // Retire the armed offer with a soft upward fade - whether waved off by the X
  // or auto-retired once the player is clearly just tracking life. Falls back to
  // an instant clear if the node has already gone.
  function fadeOutRoll() {
    const pill = typeof document !== 'undefined' && document.getElementById('roll-pill');
    if (!pill) { _clearRoll(); setRollPhase(null); renderLife(); return; }
    pill.classList.add('roll-exit');
    timers.current.push(setTimeout(() => {
      pill.classList.remove('roll-exit'); _clearRoll(); setRollPhase(null); renderLife();
    }, 340));
  }
  // Waving the roll away without rolling - it's an offer, not a gate.
  function dismissRollOff() { haptic('light'); fadeOutRoll(); }

  // ── end match → full-screen decision modal (Vitarum) ──
  function triggerEnd(winner) {
    const p = pRef.current, e = eRef.current;
    const w = winner || (p.life <= 0 ? 'opponent' : e.life <= 0 ? 'player' : p.life === e.life ? 'draw' : p.life > e.life ? 'player' : 'opponent');
    setFabP(false); setFabE(false); setSheet(null);
    setEndInfo({ winner: w, pLife: p.life, eLife: e.life, durationSec: elapsedSec(), recorded: recordedRef.current });
  }
  async function recordFromEnd() {
    if (recordedRef.current || recordingRef.current) return;   // already saved / in-flight - no double record
    recordingRef.current = true;
    const r = endInfo;
    const result = {
      mode, winner: r.winner, playerFinalLife: r.pLife, opponentFinalLife: r.eLife,
      durationSec: r.durationSec, log,
      playerAvatar: players.you?.name || null, opponentAvatar: players.opp?.name || null,
      opponentName: oppName.trim() || null, deckId: deck?.id || null,
    };
    try { await onRecord?.(result); recordedRef.current = true; setEndInfo((x) => ({ ...x, recorded: true })); haptic('medium'); }
    finally { recordingRef.current = false; }
  }
  const needConfirm = () => !quick && endInfo && !endInfo.recorded;
  // In-world confirm (Vitarum centered modal) instead of a native dialog -
  // gated behind needConfirm so a recorded match skips straight through.
  function guarded(label, action) {
    if (needConfirm()) setConfirm({ label, action });
    else action();
  }
  function newFromEnd() {
    if (quick) { reset(); return; }                                  // Go Again = fresh quick match
    guarded('New match without recording? This match won’t be saved.', () => onNewMatch?.(mode));
  }
  function resetFromEnd() {
    guarded('Reset without recording? This match won’t be saved.', () => reset());
  }
  function exitFromEnd() {
    guarded('Exit without recording the match?', () => onExit?.());
  }

  const pImg = players.you ? `${BASE}cards/${players.you.image_slug}` : '';
  const eImg = players.opp ? `${BASE}cards/${players.opp.image_slug}` : '';
  const p = pRef.current, e = eRef.current;

  return (
    <div id="counter-screen" className={`vc-root${quick ? ' quick' : ''}`}>
      {/* Enemy half (rotated 180° for across-table reading) */}
      <div className="counter-half enemy-half" id="enemy-half">
        <img className="half-bg" id="enemy-bg" src={eImg} alt="" />
        <div className="half-gradient" />
        <div className="half-grain" />
        <div className="life-display">
          <div className="life-number" id="enemy-life-num" ref={eNumRef} role="status" aria-live="polite" />
          <div className={`dd-pill${rollPhase == null && e.life <= 0 ? ' show' : ''}`} onClick={() => triggerEnd(null)} role="button" aria-label="End match - opponent at Death's Door">
            <div className="dd-pill-body">{DDSvg}End Match</div>
          </div>
        </div>
        {e.max < 20 && <div className="status-badges"><div className="status-badge maxlife">{HeartSvg}{e.max}</div></div>}
        <div className="tap-zone tap-plus" onClick={() => change('opponent', +1)} role="button" aria-label="Increase opponent's life" />
        <div className="tap-zone tap-minus" onClick={() => change('opponent', -1)} role="button" aria-label="Decrease opponent's life" />
        <div className={`opponent-fab-wrap${fabE ? ' open' : ''}`} id="opponent-fab">
          <div className="fab-menu">
            <button onClick={() => { setFabE(false); setSheet('diceE'); }}>{DiceSvg}Roll a Die</button>
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
          <div className={`dd-pill${rollPhase == null && p.life <= 0 ? ' show' : ''}`} onClick={() => triggerEnd(null)} role="button" aria-label="End match - you are at Death's Door">
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
        // The badge swells as the streak grows - +8% per point over the first,
        // capped at 1.6x so a huge swing stays readable, not screen-filling.
        const mag = Math.min(1 + (Math.abs(d.delta) - 1) * 0.08, 1.6);
        return host ? createPortal(
          <div key={d.id} className={`life-delta ${d.delta > 0 ? 'plus' : 'minus'}${d.released ? ' released' : ''}`} style={{ '--dmag': mag }}>
            <span key={d.delta} className="life-delta-num">{d.delta > 0 ? `+${d.delta}` : `${d.delta}`}</span>
          </div>,
          host, String(d.id),
        ) : null;
      })}

      {/* Player FAB (fixed, bottom-right) */}
      <div className={`fab-wrap${fabP ? ' open' : ''}`} id="counter-fab">
        <div className="fab-menu">
          {/* Go Home = minimise (match stays resumable) - the only exit for users
              without Android gesture/back navigation. */}
          <button onClick={() => { setFabP(false); minimize(); }}>{ExitSvg}Go Home</button>
          <button onClick={() => { setFabP(false); setSheet('tweaks'); }}>{TweaksSvg}Tweaks</button>
          <button onClick={() => { setClockOn((v) => !v); haptic('light'); }}>{ClockSvg}Show Clock<span className="fab-state">{clockOn ? 'on' : 'off'}</span></button>
          <button onClick={() => { setFabP(false); setSheet('maxP'); }}>{HeartSvg}Change Max Life</button>
          <button onClick={() => { setFabP(false); setSheet('dice'); }}>{DiceSvg}Roll a Die</button>
          <button onClick={() => { setFabP(false); setSheet('log'); }}>{LogSvg}Match Log</button>
          <button onClick={() => { setFabP(false); if (log.length) setConfirm({ label: 'Reset the match? Life totals and log will be cleared.', action: reset }); else reset(); }}>{ResetSvg}Reset Match</button>
          <button style={{ color: 'var(--crimson)' }} onClick={() => { setFabP(false); triggerEnd(null); }}>{FlagSvg}End Match</button>
        </div>
        <button className="fab" onClick={(ev) => { ev.stopPropagation(); setFabP((v) => !v); }} aria-label="Options">{DotsSvg}</button>
      </div>

      {/* Match clock - vertical strip on the left edge, readable by both players.
          CSS hides it during the roll-off (body.roll-active). */}
      {clockOn && <div id="match-clock">{fmtClock(elapsedSec())}</div>}

      {/* Hard lock: while the roll spins AND through the 4s result countdown, a
          full-screen catcher swallows every tap so the reveal is never dropped by
          an eager tap. The counter only goes live again once the countdown ends. */}
      {(rollPhase === 'rolling' || rollPhase === 'result') && (
        <div className="roll-lock" aria-hidden="true"
          onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
          onPointerDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); }} />
      )}

      {/* Optional turn-order roll. Floats over the live counter as an offer:
          tap it to roll, or dismiss it with the X - it never blocks the match. */}
      <div id="roll-pill" className={rollPhase === 'armed' ? 'show armed' : rollPhase === 'result' ? 'show result' : ''}
        onClick={rollPhase === 'armed' ? startRollOff : undefined} role="button" aria-label="Roll for turn order">
        <div id="roll-pill-body" style={{ '--flip': flip + 'deg' }}>
          <span className="roll-pill-go">{RollHexSvg}<span className="rp-label">Roll for Turn</span></span>
          <span className="roll-pill-pick"><span className="rp-main">Your pick</span><span className="rp-hint">Play begins in {resultLeft}</span></span>
        </div>
        {rollPhase === 'armed' && (
          <button className="roll-pill-dismiss" onClick={(ev) => { ev.stopPropagation(); dismissRollOff(); }} aria-label="Dismiss the turn roll">{CloseSvg}</button>
        )}
      </div>

      {/* secondary modals (Vitarum centered .modal-box) */}
      <MatchLogModal open={sheet === 'log'} log={log} onClose={() => setSheet(null)} />
      <MaxLifeModal open={sheet === 'maxP'} who="player" value={p.max} onClose={() => setSheet(null)} onSet={(v) => setMax('player', v)} />
      <MaxLifeModal open={sheet === 'maxE'} who="opponent" rotated value={e.max} onClose={() => setSheet(null)} onSet={(v) => setMax('opponent', v)} />
      <DiceModal open={sheet === 'dice'} dice={dice} setDice={setDice} onClose={() => setSheet(null)} />
      {/* opponent-launched dice: rotated 180deg to face the opponent's half */}
      <DiceModal open={sheet === 'diceE'} rotated dice={dice} setDice={setDice} onClose={() => setSheet(null)} />
      <TweaksModal open={sheet === 'tweaks'} tw={tw} onToggle={setTweak} onClose={() => setSheet(null)} />
      {/* full-screen end-of-match decision modal */}
      {endInfo && (
        <EndModal info={endInfo} quick={quick} players={players} oppName={oppName} setOppName={setOppName} recent={recent}
          onRecord={recordFromEnd} onNew={newFromEnd} onReset={resetFromEnd} onExit={exitFromEnd} onClose={() => setEndInfo(null)} />
      )}

      {/* "Hold on" confirm - rendered AFTER the end modal AND on a higher layer
          (#confirm-overlay): it can be summoned FROM the end screen, so it must
          always paint above it, whatever the DOM order becomes. */}
      {confirm && (
        <VModal id="confirm-overlay" title="Hold on" onClose={() => setConfirm(null)}
          actions={<>
            <button className="modal-btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="modal-btn danger" onClick={() => { const a = confirm.action; setConfirm(null); a?.(); }}>Discard</button>
          </>}>
          <div style={{ padding: '18px 22px 4px', textAlign: 'center', font: "400 15px/1.5 var(--f-read)", color: 'var(--muted)' }}>{confirm.label}</div>
        </VModal>
      )}
    </div>
  );
}

/* ── Vitarum centered modal shell ── */
function VModal({ id, title, subtitle, onClose, children, actions, rotated }) {
  return (
    <div className="vc-modal-overlay" id={id} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal-box${rotated ? ' rotated' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">{CloseSvg}</button>
          <div className="modal-title">{title}</div>
          {subtitle && <div className="modal-subtitle">{subtitle}</div>}
        </div>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

// Tweaks - the counter's own comforts, back where Vitarum kept them.
function TweaksModal({ open, tw, onToggle, onClose }) {
  if (!open) return null;
  const rows = [
    ['keep_awake', 'Keep screen on', 'The screen never sleeps mid-duel'],
    ['immersive', 'Hide status bar', 'Full-bleed match (on device)'],
    ['film_grain', 'Film grain', 'Painterly texture over the portraits'],
  ];
  return (
    <VModal title="Tweaks" subtitle="Comforts for the table" onClose={onClose}
      actions={<button className="modal-btn" onClick={onClose}>Done</button>}>
      <div className="tw-list">
        {rows.map(([k, label, hint]) => (
          <div key={k} className="tw-row" onClick={() => onToggle(k, !tw[k])} role="switch" aria-checked={!!tw[k]}>
            <div className="tw-copy">
              <div className="tw-label">{label}</div>
              <div className="tw-hint">{hint}</div>
            </div>
            <div className={`tw-switch${tw[k] ? ' on' : ''}`}><span className="tw-knob" /></div>
          </div>
        ))}
      </div>
    </VModal>
  );
}

function MatchLogModal({ open, log, onClose }) {
  if (!open) return null;
  const rows = [...log].reverse();
  return (
    <VModal title="Match Log" subtitle="A record of life given and taken" onClose={onClose}
      actions={<button className="modal-btn" onClick={onClose}>Close</button>}>
      <div className="log-divider"><span><svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true"><rect x="8" y="8" width="8" height="8" transform="rotate(45 12 12)" /></svg></span></div>
      <div className="log-list">
        {rows.length === 0 ? <div className="log-empty">No life changes yet.</div>
          : rows.map((r, i) => (
            <div key={i} className={`log-row ${r.who === 'player' ? 'you' : 'opp'}`}>
              <span className="log-time">{new Date(r.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              <span className="log-text"><span className="log-who">{r.who === 'player' ? 'You' : 'Opponent'}</span> {r.delta > 0 ? 'gained' : 'lost'} <span className={`log-amt ${r.delta > 0 ? 'gain' : 'loss'}`}>{Math.abs(r.delta)}</span></span>
              <span className="log-life">{HeartMiniSvg}{r.toLife}</span>
            </div>
          ))}
      </div>
    </VModal>
  );
}

function MaxLifeModal({ open, who, value, onClose, onSet, rotated }) {
  const [v, setV] = useState(value);
  useEffect(() => { if (open) setV(value); }, [open, value]);
  if (!open) return null;
  return (
    <VModal title="Max Life" rotated={rotated} subtitle={who === 'player' ? 'Your life cap' : "Opponent's life cap"} onClose={onClose}
      actions={<button className="modal-btn primary" onClick={() => onSet(v)}>Set Max Life</button>}>
      <div className="maxlife-stepper">
        <button className="maxlife-btn" onClick={() => setV((x) => Math.max(1, x - 1))} aria-label="Decrease">−</button>
        <div className="maxlife-value">{v}</div>
        <button className="maxlife-btn" onClick={() => setV((x) => Math.min(20, x + 1))} aria-label="Increase">+</button>
      </div>
      <div className="maxlife-hint">20 is the highest. Lower it when an effect stops you healing to full.</div>
    </VModal>
  );
}

function DiceModal({ open, dice, setDice, onClose, rotated }) {
  const [landed, setLanded] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [display, setDisplay] = useState(null);   // the number tumbling mid-roll
  const iv = useRef(null);
  const stop = () => { if (iv.current) { clearInterval(iv.current); iv.current = null; } };
  useEffect(() => stop, []);                        // clear on unmount
  useEffect(() => { if (!open) { stop(); setRolling(false); } }, [open]);
  if (!open) return null;
  // Vitarum's rollDie, tightened: ~7-11 ticks at 60ms, cycling faces, then land.
  // Honour reduced motion by settling immediately.
  function roll() {
    if (rolling) return;
    stop();
    if (document.body.classList.contains('reduce-motion')) {
      const result = 1 + Math.floor(Math.random() * dice.type);
      setDice((x) => ({ ...x, value: result })); setDisplay(result);
      setLanded((n) => n + 1); haptic('heavy');
      return;
    }
    setRolling(true); setDice((x) => ({ ...x, value: null }));
    let ticks = 0;
    const total = 7 + Math.floor(Math.random() * 5);   // ~1s shorter than Vitarum's 18-25 ticks
    iv.current = setInterval(() => {
      setDisplay(Math.ceil(Math.random() * dice.type));
      if (++ticks >= total) {
        stop();
        const result = Math.ceil(Math.random() * dice.type);
        setDisplay(result); setDice((x) => ({ ...x, value: result }));
        setRolling(false); setLanded((n) => n + 1); haptic('heavy');
      }
    }, 60);
  }
  const shown = rolling ? (display ?? '–') : (dice.value ?? '–');
  const label = rolling ? `Rolling d${dice.type}…`
    : dice.value != null
      ? (dice.value === dice.type ? 'Maximum roll!' : dice.value === 1 ? 'Critical fail' : `on a d${dice.type}`)
      : 'Select a die and roll';
  return (
    <VModal title="Roll a Die" rotated={rotated} subtitle="Choose your die, then roll" onClose={onClose}
      actions={<button className="modal-btn primary" onClick={roll} disabled={rolling}>{rolling ? 'Rolling…' : 'Roll!'}</button>}>
      <div className="dice-type-row">
        {[4, 6, 8, 10, 12, 20].map((d) => (
          <button key={d} className={`die-btn${dice.type === d ? ' active' : ''}`} disabled={rolling} onClick={() => { setDice({ type: d, value: null }); setDisplay(null); }}>d{d}</button>
        ))}
      </div>
      <div className="dice-result-area">
        <div className={`dice-number${rolling ? ' rolling' : dice.value != null ? ' landed' : ''}`} key={rolling ? 'roll' : landed}>{shown}</div>
        <div className="dice-label">{label}</div>
      </div>
    </VModal>
  );
}

function EndModal({ info, quick, players, oppName, setOppName, recent, onRecord, onNew, onReset, onExit, onClose }) {
  const { winner, pLife, eLife, durationSec, recorded } = info;
  const [shareLink, setShareLink] = useState(null);
  const [sharing, setSharing] = useState(false);
  async function openShare() {
    if (sharing) return; setSharing(true);
    try {
      const { link } = await buildMatchShare({
        winner, pLife, eLife, durationSec, playedAt: new Date().toISOString(),
        youAvatarName: players.you?.name || null, oppAvatarName: players.opp?.name || null,
      });
      setShareLink(link);
    } finally { setSharing(false); }
  }
  const pWin = winner === 'player', eWin = winner === 'opponent', draw = winner === 'draw';
  const title = quick
    ? (pWin ? 'You Win' : eWin ? 'Opponent Wins' : 'Draw')
    : (pWin ? 'Victory!' : eWin ? 'Defeat' : 'Match Over');
  const winnerName = draw ? 'Draw' : quick
    ? (pWin ? 'You' : 'Opponent')
    : (pWin ? (players.you?.name || 'You') : (players.opp?.name || 'Opponent'));
  const dur = fmtDur(durationSec);
  const pBorder = pWin ? '#4db38a' : eWin ? '#e0786a' : 'rgba(255,255,255,.1)';
  const eBorder = eWin ? '#4db38a' : pWin ? '#e0786a' : 'rgba(255,255,255,.1)';
  const lifeText = (v, lost) => v > 0 ? String(v) : (lost ? '0' : 'DD');
  return (
    <div className={`vc-modal-overlay${quick ? ' quick' : ''}`} id="end-overlay">
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">{CloseSvg}</button>
          <div className="modal-title">{title}</div>
          <div className="end-result-label">Winner</div>
          <div className="end-winner">{winnerName}</div>
        </div>
        <div className="end-result">
          <div className="end-life-row">
            <div className="end-life-pill end-player" style={{ borderColor: pBorder }}>
              <div className="end-life-pill-art">{players.you?.image_slug && <img src={`${BASE}cards/${players.you.image_slug}`} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}</div>
              <div className="end-life-pill-info"><div className="end-life-label">{quick ? 'You' : (players.you?.name || 'You')}</div><div className={`end-life-val${pLife <= 0 ? ' dd' : ''}`}>{lifeText(pLife, eWin)}</div></div>
            </div>
            <div className="end-life-pill end-enemy" style={{ borderColor: eBorder }}>
              <div className="end-life-pill-art">{players.opp?.image_slug && <img src={`${BASE}cards/${players.opp.image_slug}`} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}</div>
              <div className="end-life-pill-info"><div className="end-life-label">{quick ? 'Opponent' : (players.opp?.name || 'Opponent')}</div><div className={`end-life-val${eLife <= 0 ? ' dd' : ''}`}>{lifeText(eLife, pWin)}</div></div>
            </div>
          </div>
          {dur && <div className="end-duration-row">{ClockSvg}<span>{dur}</span></div>}
        </div>
        {/* Hand this match to the opponent's device - a QR that mirrors the
            result to their side (no deck). Works fully offline. */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0 6px' }}>
          <button onClick={openShare} disabled={sharing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(var(--sk),.4)', color: 'rgb(var(--sk))', font: "700 12px/1 var(--f-ui)", letterSpacing: '.04em', cursor: 'pointer' }}>
            {ShareSvg}{sharing ? 'Preparing…' : 'Share to opponent'}
          </button>
        </div>
        {shareLink && <ShareQRModal link={shareLink} onClose={() => setShareLink(null)} />}
        {!quick && (
          <div className="end-opp-field">
            <div className="end-opp-label">Opponent (optional)</div>
            <input className="end-opp-input" value={oppName} onChange={(e) => setOppName(e.target.value)} placeholder="Their name…" disabled={recorded} />
            {!recorded && recent.length > 0 && (
              <div className="end-opp-recent">{recent.map((r) => <button key={r} className="end-opp-chip" onClick={() => setOppName(r)}>{r}</button>)}</div>
            )}
          </div>
        )}
        <div className="modal-actions">
          {!quick && <button className={`modal-btn${recorded ? ' recorded' : ' primary'}`} disabled={recorded} onClick={onRecord}>{recorded ? CheckSvg : CheckSvg}<span>{recorded ? 'Match Recorded' : 'Record Match'}</span></button>}
          <button className={`modal-btn${quick ? ' primary' : ''}`} onClick={onNew}>{PlusSvg}<span>{quick ? 'Go Again' : 'New Match'}</span></button>
          <button className="modal-btn" onClick={onReset}>{ResetSvg}<span>{recorded && !quick ? 'Go Again' : 'Reset Match'}</span></button>
          <button className="modal-btn" onClick={onExit}>{ExitSvg}<span>Exit Match</span></button>
        </div>
      </div>
    </div>
  );
}

// Share-result QR (over the end screen, z140). The opponent scans it to import
// the match mirrored to their side.
function ShareQRModal({ link, onClose }) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  // Hardware BACK closes just the QR modal, not the whole end screen behind it.
  useEffect(() => registerBackConsumer(() => { onClose(); return true; }), [onClose]);
  const flashCopied = () => { setCopied(true); clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 1600); };
  const copy = async () => { try { await navigator.clipboard.writeText(link); flashCopied(); haptic('light'); } catch { /* clipboard blocked */ } };
  // One-tap into WhatsApp/Messages/Discord via the OS share sheet; if the target
  // has no share sheet (older desktop web) it falls back to a copy.
  const share = async () => {
    haptic('light');
    const res = await shareLink({ title: 'Compendium match', text: `Save our match in Compendium:\n${link}`, dialogTitle: 'Share result' });
    if (res === 'copied') flashCopied();
  };
  return (
    <div className="vc-modal-overlay" id="share-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">{CloseSvg}</button>
          <div className="modal-title">Share Result</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 22px 18px', gap: 15 }}>
          <QRCode text={link} size={224} />
          <div style={{ font: "400 13px/1.55 var(--f-read)", color: 'var(--muted)', textAlign: 'center', maxWidth: 280 }}>
            Have your opponent scan this with their camera, or send them the link. They attribute their own deck.
          </div>
          <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 280 }}>
            <button className="modal-btn primary" onClick={share} style={{ flex: 2 }}>{ShareSvg}<span>Send link</span></button>
            <button className="modal-btn" onClick={copy} style={{ flex: 1 }}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── icons ── */
const s = { width: 17, height: 17, opacity: .8 };
const ShareSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }} aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="10.7" x2="15.4" y2="6.3" /><line x1="8.6" y1="13.3" x2="15.4" y2="17.7" /></svg>;
const DotsSvg = <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }} aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>;
const DiceSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><rect x="2" y="2" width="20" height="20" rx="4" /><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="8" cy="16" r="1.2" fill="currentColor" stroke="none" /><circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /></svg>;
const HeartSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" /></svg>;
const HeartMiniSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" /></svg>;
const DDSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.2C7.6 3.2 4.5 6.5 4.5 10.5c0 2.6 1.3 4.6 2.6 5.8.3.3.4.6.4 1v1.4c0 .8.6 1.5 1.5 1.5h1.1c.5 0 .9-.4.9-.9v-1c0-.3.2-.5.5-.5h.9c.3 0 .5.2.5.5v1c0 .5.4.9.9.9h1.1c.8 0 1.5-.7 1.5-1.5v-1.4c0-.4.1-.7.4-1 1.3-1.2 2.6-3.2 2.6-5.8 0-4-3.1-7.3-7.5-7.3z" /><ellipse cx="9" cy="10.6" rx="1.7" ry="2.1" fill="currentColor" stroke="none" /><ellipse cx="15" cy="10.6" rx="1.7" ry="2.1" fill="currentColor" stroke="none" /></svg>;
const LogSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>;
const ResetSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>;
const FlagSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>;
const TweaksSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={s}><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none" /><circle cx="15" cy="17" r="2.2" fill="currentColor" stroke="none" /></svg>;
const ClockSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 15" /></svg>;
const CheckSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>;
const PlusSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12l7-7 7 7" /></svg>;
const ExitSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>;
// Roll-pill glyphs: a hex die (turn roll) and a close X (dismiss the offer).
const RollHexSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" style={{ width: 16, height: 16 }} aria-hidden="true"><path d="M12 2.6 20.5 7v10L12 21.4 3.5 17V7z" /><path d="M12 2.6V21.4M3.5 7l8.5 5 8.5-5" /></svg>;
const CloseSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>;
