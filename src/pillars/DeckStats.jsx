// Deck Stats tab — Arcanum's full analysis suite (mana/power curves, composition,
// atlas supply/odds with 10k Monte-Carlo + turn stepper, spellbook odds, random
// hand), ported faithfully and skinned to the grimoire palette.
import React, { useEffect, useMemo, useState } from 'react';
import { getDeckCards, setRecord } from '../store/deckRepository.js';
import * as St from '../store/deckStats.js';
import { ThresholdPips, IconButton } from '../components/ui.jsx';
import { cardImageUrl, cardFallbackArt } from '../store/cardArt.js';
import CardArt from '../components/CardArt.jsx';

export default function DeckStats({ deck, rev, onReload }) {
  const [zones, setZones] = useState(null);
  const [compMode, setCompMode] = useState('element');
  const [atlasMode, setAtlasMode] = useState('supply');
  const [atlasTurn, setAtlasTurn] = useState(5);
  const [wl, setWl] = useState({ w: deck.wins, l: deck.losses });

  useEffect(() => { let a = true; getDeckCards(deck.id).then((z) => a && setZones(z)); return () => { a = false; }; }, [deck.id, rev]);
  useEffect(() => { setWl({ w: deck.wins, l: deck.losses }); }, [deck.id, deck.wins, deck.losses]);
  async function saveRecord(w, l) { setWl({ w, l }); await setRecord(deck.id, w, l); onReload?.(); }

  const sb = zones?.spellbook || [], at = zones?.atlas || [];
  const sbCount = sb.reduce((s, e) => s + e.quantity, 0), atCount = at.reduce((s, e) => s + e.quantity, 0);
  const manaCosts = useMemo(() => St.manaCurveData(sb), [zones]);
  const powerCosts = useMemo(() => St.powerCurveData(sb), [zones]);
  const odds = useMemo(() => atlasMode === 'odds' ? St.atlasOdds(sb, at, atlasTurn, 10000) : null,
    [zones, atlasMode, atlasTurn]); // 10k sims only when on the Odds tab / turn changes

  if (!zones) return <div style={{ padding: 24, color: 'var(--ink-faint)' }}>…</div>;

  const avatarSlug = deck.avatar_card_id || '';
  const decided = deck.wins + deck.losses;

  return (
    <div style={{ padding: '12px 0 4px' }}>
      {/* mana curve */}
      <Card title="Mana Curve" right={<Avg spellbook={sb} />}>
        {Object.keys(manaCosts).length ? <><Svg html={St.curveSVG(manaCosts, { label: 'mana' })} /><Legend costs={manaCosts} /></>
          : <Empty text="Add spells to see the curve." />}
      </Card>

      {/* composition */}
      <Card title="Composition" right={<Toggle value={compMode} set={setCompMode} opts={[['element', 'Element'], ['rarity', 'Rarity']]} />}>
        <Composition sb={sb} mode={compMode} total={sbCount} />
      </Card>

      {/* power curve */}
      <Card title="Power Curve">
        {Object.keys(powerCosts).length ? <><Svg html={St.curveSVG(powerCosts, { num: '#c79ad0', border: 'rgba(199,154,208,.5)', label: 'power', peakGlow: 'rgba(199,154,208,.55)' })} /><Legend costs={powerCosts} /></>
          : <Empty text="Add minions to see the power curve." />}
      </Card>

      {/* spellbook odds */}
      <Card title="Spellbook Odds">
        <SpellbookOdds sb={sb} />
      </Card>

      {/* atlas */}
      <Card title="Atlas" right={<><span style={{ font: "500 11px/1 'IBM Plex Mono',monospace", color: '#6e6286', marginRight: 8 }}>{atCount}/30+</span><Toggle value={atlasMode} set={setAtlasMode} opts={[['supply', 'Supply'], ['odds', 'Odds']]} /></>}>
        <Atlas sb={sb} at={at} atCount={atCount} mode={atlasMode} odds={odds} turn={atlasTurn} setTurn={(d) => setAtlasTurn((t) => Math.max(1, Math.min(10, t + d)))} />
      </Card>

      {/* balance ledger (record) */}
      <Card title="Balance Ledger">
        <div className="cc-wl">
          <span className="cc-wl-w">{wl.w}</span><span className="cc-wl-sep">–</span><span className="cc-wl-l">{wl.l}</span>
        </div>
        <div style={{ textAlign: 'center', font: "italic 400 13px/1 'EB Garamond',serif", color: '#8a7ba6', marginBottom: 14 }}>
          {wl.w + wl.l ? `${Math.round(wl.w / (wl.w + wl.l) * 100)}% win rate over ${wl.w + wl.l} game${wl.w + wl.l === 1 ? '' : 's'}` : 'No games recorded yet'}
        </div>
        <div className="cc-steppers">
          <Stepper label="Victories" value={wl.w} kind="wins" onChange={(v) => saveRecord(v, wl.l)} />
          <Stepper label="Defeats" value={wl.l} kind="losses" onChange={(v) => saveRecord(wl.w, v)} />
        </div>
      </Card>
    </div>
  );
}

function Composition({ sb, mode, total }) {
  const { slices } = St.compositionData(sb, mode);
  const bars = St.typeBars(sb, mode);
  return (
    <div>
      <div className="cc-body-row">
        <div className="cc-donut-wrap" style={{ background: St.conicGradient(slices) }}>
          <div className="cc-donut-hole"><span className="cc-donut-num">{total}</span><span className="cc-donut-lbl">CARDS</span></div>
        </div>
        <div className="cc-bar-rows">
          {bars.length ? bars.map((b) => (
            <div key={b.label}>
              <div className="cc-bar-label-row"><span className="cc-bar-name">{b.label}</span><span className="cc-bar-count">{b.total}</span></div>
              <div className="cc-bar-track">{b.segs.map((s, i) => <div key={i} className="cc-bar-seg" style={{ width: s.pct + '%', background: s.color }} />)}</div>
            </div>
          )) : <span className="cc-stat-empty">No spellbook data</span>}
        </div>
      </div>
      <Swatches slices={slices} />
    </div>
  );
}

function Atlas({ sb, at, atCount, mode, odds, turn, setTurn }) {
  const { slices } = St.compositionData(at, 'element');
  const statusCol = (p) => p >= 0.8 ? 'var(--accent-jade)' : p >= 0.5 ? 'var(--gold-leaf)' : 'var(--el-fire)';
  const supply = St.supplyData(sb, at);
  return (
    <div className="cc-body-row">
      <div className="cc-donut-wrap" style={{ background: St.conicGradient(slices) }}>
        <div className="cc-donut-hole"><span className="cc-donut-num">{atCount}</span><span className="cc-donut-lbl">SITES</span></div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {mode === 'odds' ? (
          <>
            <div className="cc-odds-head">
              <div style={{ font: "italic 400 11px/1 'EB Garamond',serif", color: '#8a7ba6', marginBottom: 8 }}>Threshold odds</div>
              <div className="cc-turn-line">
                <button className="cc-turn-btn" onClick={() => setTurn(-1)} disabled={turn <= 1} aria-label="Earlier turn">−</button>
                <div className="cc-turn-pill"><span className="cc-turn-cap">Draw</span><span className="cc-turn-num">{turn}</span></div>
                <button className="cc-turn-btn" onClick={() => setTurn(1)} disabled={turn >= 10} aria-label="Later turn">+</button>
              </div>
            </div>
            {odds && odds.need.length ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: odds.need.length >= 2 ? 10 : 0 }}>
                  <span style={{ font: "700 26px/1 var(--f-display)", color: statusCol(odds.joint) }}>{Math.round(odds.joint * 100)}%</span>
                  <span style={{ font: "400 11px/1.3 var(--f-read)", color: 'var(--ink-muted)' }}>chance all your thresholds are met</span>
                </div>
                {odds.need.length >= 2 && odds.need.map((k) => (
                  <NeedRow key={k} el={k} text={`need ${odds.peak[k]}`} status={`${Math.round(odds.prob[k] * 100)}%`} color={statusCol(odds.prob[k])} />
                ))}
              </>
            ) : <Empty text="No thresholds required" />}
          </>
        ) : (
          supply.length ? supply.map((s) => (
            <NeedRow key={s.el} el={s.el} text={`need ${s.peak} · ${s.supply} sites`} status={s.status}
              color={s.status === 'ok' ? 'var(--accent-jade)' : s.status === 'tight' ? 'var(--gold-leaf)' : 'var(--el-fire)'} />
          )) : <Empty text="No thresholds required" />
        )}
      </div>
    </div>
  );
}

function SpellbookOdds({ sb }) {
  const { rows } = St.spellbookOdds(sb);
  if (!rows.length) return <Empty text="Add spells to see draw odds." />;
  return (
    <>
      <div style={{ font: "italic 400 11px/1 'EB Garamond',serif", color: '#8a7ba6', marginBottom: 10 }}>Odds your next spell is a…</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ width: 78, font: "500 12px/1 'Hanken Grotesk',sans-serif", color: '#c9bfdc' }}>{r.label}<span style={{ color: '#8a7ba6', marginLeft: 5 }}>{r.count}</span></span>
          <div className="cc-bar-track" style={{ flex: 1 }}><div className="cc-bar-fill" style={{ width: r.pct + '%' }} /></div>
          <span style={{ width: 34, textAlign: 'right', font: "600 12px/1 'IBM Plex Mono',monospace", color: '#c79af0' }}>{r.pct}%</span>
        </div>
      ))}
    </>
  );
}

function Hand({ hand, setHand }) {
  if (!hand) return <div style={{ font: "400 13px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', padding: '4px 0' }}>Press Draw to reveal a random opening hand.</div>;
  const drawNext = (kind) => {
    const pool = kind === 'site' ? hand.restAt : hand.rest;
    if (!pool.length) return;
    const card = pool[0];
    setHand({ ...hand, rest: kind === 'spell' ? hand.rest.slice(1) : hand.rest, restAt: kind === 'site' ? hand.restAt.slice(1) : hand.restAt, drawn: kind === 'spell' ? [...hand.drawn, card] : hand.drawn, drawnAt: kind === 'site' ? [...hand.drawnAt, card] : hand.drawnAt });
  };
  const section = (label, cards, landscape) => cards.length > 0 && (
    <div style={{ marginBottom: 10 }}>
      <div style={{ font: "600 9px/1 var(--f-ui)", letterSpacing: '.14em', color: 'var(--ink-muted)', marginBottom: 7 }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: landscape ? '1fr 1fr' : '1fr 1fr 1fr', gap: 7 }}>{cards.map((e, i) => <HandTile key={i} entry={e} landscape={landscape} />)}</div>
    </div>
  );
  return (
    <div>
      {section('OPENING · SPELLS', hand.sb, false)}
      {section('OPENING · SITES', hand.at, true)}
      {section('DRAWN SPELLS', hand.drawn, false)}
      {section('DRAWN SITES', hand.drawnAt, true)}
      {(hand.rest.length > 0 || hand.restAt.length > 0) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
          {hand.rest.length > 0 && <button onClick={() => drawNext('spell')} style={drawNextBtn}>↧ Draw spell</button>}
          {hand.restAt.length > 0 && <button onClick={() => drawNext('site')} style={drawNextBtn}>↧ Draw site</button>}
          <span style={{ font: "400 11px/1 var(--f-ui)", color: 'var(--ink-faint)' }}>{hand.rest.length} spells · {hand.restAt.length} sites left</span>
        </div>
      )}
    </div>
  );
}

function HandTile({ entry, landscape }) {
  const [broken, setBroken] = useState(false);
  const url = cardImageUrl(entry);
  if (landscape) {
    return (
      <div style={{ position: 'relative', aspectRatio: '4.1/3', borderRadius: 8, overflow: 'hidden', background: cardFallbackArt(entry), border: '1px solid var(--hair-16)' }}>
        {url && !broken && <img src={url} alt={entry.name} onError={() => setBroken(true)} style={{ position: 'absolute', top: '50%', left: '50%', width: 'calc(100% * 3 / 4.1)', height: 'calc(100% * 4.1 / 3)', objectFit: 'cover', transform: 'translate(-50%,-50%) rotate(90deg)' }} />}
      </div>
    );
  }
  return <CardArt card={entry} radius={8} />;
}

/* ---- small bits — Arcanum .cc-stat skin ---- */
const Card = ({ title, right, children }) => (
  <div className="chart-card cc-stat">
    <div className="cc-hdr"><span className="cc-title">{title}</span>{right}</div>
    {children}
  </div>
);
const Svg = ({ html }) => <div dangerouslySetInnerHTML={{ __html: html }} />;
const Legend = ({ costs }) => (
  <div className="cc-key">
    {St.curveLegend(costs).map((l) => <span key={l.el} className="cc-key-item"><span className="cc-key-dot" style={{ background: l.color }} />{l.el}</span>)}
  </div>
);
const Swatches = ({ slices }) => slices.length ? (
  <div className="cc-key">
    {slices.map((s) => <span key={s.label} className="cc-key-item"><span className="cc-key-dot" style={{ background: s.color, borderRadius: '50%' }} />{s.label}</span>)}
  </div>
) : null;
const NeedRow = ({ el, text, status, color }) => (
  <div className="cc-need-row">
    <ThresholdPips runs={[{ el, c: St.EL_CHART[el[0].toUpperCase() + el.slice(1)] }]} size={16} />
    <span style={{ flex: 1, font: "400 12px/1 'EB Garamond',serif", color: '#c9bfdc' }}>{text}</span>
    <span style={{ font: "600 12px/1 'Hanken Grotesk',sans-serif", color }}>{status}</span>
  </div>
);
const Avg = ({ spellbook }) => <span className="cc-avg">avg {St.avgCost(spellbook)}</span>;
const Toggle = ({ value, set, opts }) => (
  <div className="cc-toggle-pill">
    {opts.map(([k, l]) => <button key={k} className={`cc-toggle-seg${value === k ? ' on' : ''}`} onClick={() => set(k)}>{l}</button>)}
  </div>
);
const Stat = ({ label, value, sub, ok }) => (
  <div className="chart-card cc-stat" style={{ flex: 1, margin: 0, textAlign: 'center', padding: '13px 4px' }}>
    <div style={{ font: "700 21px/1 'Cinzel',serif", color: ok === false ? '#e0907c' : '#8fd3a8' }}>{value}</div>
    <div style={{ font: "600 9px/1 'Hanken Grotesk',sans-serif", letterSpacing: '.1em', color: '#7a6e96', marginTop: 7 }}>{label} <span style={{ color: '#9a8cae' }}>{sub}</span></div>
  </div>
);
function Stepper({ label, value, kind, onChange }) {
  return (
    <div className={`cc-stepper-card ${kind}`}>
      <div className={`cc-stepper-cap ${kind}`}>{label}</div>
      <div className="cc-stepper-btns">
        <button className="cc-step-btn cc-step-minus" onClick={() => onChange(Math.max(0, value - 1))}>−</button>
        <span className={`cc-step-num ${kind}`}>{value}</span>
        <button className={`cc-step-btn cc-step-plus-${kind === 'wins' ? 'w' : 'l'}`} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}
const Empty = ({ text }) => <div className="cc-stat-empty">{text}</div>;
const drawBtn = { padding: '7px 15px', borderRadius: 13, border: '1px solid rgba(157,106,214,.4)', background: 'rgba(157,106,214,.14)', color: '#c9a9f0', font: "600 12px/1 'Hanken Grotesk',sans-serif", cursor: 'pointer' };
const drawNextBtn = { padding: '6px 14px', borderRadius: 10, border: '1px solid rgba(157,106,214,.3)', background: 'rgba(157,106,214,.1)', color: '#c9a9f0', font: "600 11px/1 'Hanken Grotesk',sans-serif", cursor: 'pointer' };
