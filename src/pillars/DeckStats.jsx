// Deck Stats tab - Arcanum's full analysis suite (mana/power curves, composition,
// atlas supply/odds with 10k Monte-Carlo + turn stepper, spellbook odds, random
// hand), ported faithfully and skinned to the grimoire palette.
import React, { useEffect, useMemo, useState } from 'react';
import { getDeckCards } from '../store/deckRepository.js';
import { deckMatchCount } from '../store/playRepository.js';
import * as St from '../store/deckStats.js';
import { ThresholdPips, Loading } from '../components/ui.jsx';

export default function DeckStats({ deck, rev, onReload }) {
  const [zones, setZones] = useState(null);
  const [compMode, setCompMode] = useState('element');
  const [atlasMode, setAtlasMode] = useState('supply');
  const [atlasTurn, setAtlasTurn] = useState(3);   // players draw 3 sites at the start of a match
  // Record is DERIVED from matches now (read-only). `tracked` = all linked
  // matches incl. draws, for the "from N matches" provenance line.
  const wl = { w: deck.wins, l: deck.losses };
  const [tracked, setTracked] = useState(null);

  useEffect(() => { let a = true; getDeckCards(deck.id).then((z) => a && setZones(z)); return () => { a = false; }; }, [deck.id, rev]);
  useEffect(() => { let a = true; deckMatchCount(deck.id).then((n) => a && setTracked(n)); return () => { a = false; }; }, [deck.id, deck.wins, deck.losses, rev]);

  const sb = zones?.spellbook || [], at = zones?.atlas || [];
  const sbCount = sb.reduce((s, e) => s + e.quantity, 0), atCount = at.reduce((s, e) => s + e.quantity, 0);
  const manaCosts = useMemo(() => St.manaCurveData(sb), [zones]);
  const powerCosts = useMemo(() => St.powerCurveData(sb), [zones]);
  const odds = useMemo(() => atlasMode === 'odds' ? St.atlasOdds(sb, at, atlasTurn, 10000) : null,
    [zones, atlasMode, atlasTurn]); // 10k sims only when on the Odds tab / turn changes

  if (!zones) return <Loading />;

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

      {/* Match record - DERIVED from matches (single source of truth). No manual
          steppers: to change it, log / edit / delete matches in Play. */}
      <Card title="Match Record">
        <div className="cc-wl">
          <span className="cc-wl-w">{wl.w}</span><span className="cc-wl-sep">–</span><span className="cc-wl-l">{wl.l}</span>
        </div>
        <div style={{ textAlign: 'center', font: "italic 400 13px/1 'EB Garamond',serif", color: '#8a7ba6', marginBottom: 8 }}>
          {wl.w + wl.l ? `${Math.round(wl.w / (wl.w + wl.l) * 100)}% win rate over ${wl.w + wl.l} decided game${wl.w + wl.l === 1 ? '' : 's'}` : 'No games recorded yet'}
        </div>
        <div style={{ textAlign: 'center', font: "400 11px/1.4 var(--f-ui)", color: 'var(--faint)', padding: '0 20px 6px' }}>
          {tracked ? `Tracked automatically from ${tracked} match${tracked === 1 ? '' : 'es'} piloted with this deck.`
            : 'Pilot this deck in Play - New Match, Quick Match, or Add Match - and its record fills in here.'}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: odds.need.length >= 2 ? 10 : 0 }}>
                  <span style={{ font: "700 26px/1 var(--f-display)", color: statusCol(odds.joint), flex: 'none' }}>{Math.round(odds.joint * 100)}%</span>
                  <span style={{ font: "400 11px/1.35 var(--f-read)", color: 'var(--ink-muted)', minWidth: 0 }}>Chance threshold needs are met</span>
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

/* ---- small bits - Arcanum .cc-stat skin ---- */
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
const Empty = ({ text }) => <div className="cc-stat-empty">{text}</div>;
