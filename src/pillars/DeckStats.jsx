// Deck Stats tab - Deckbuilder's full analysis suite (mana/power curves, composition,
// atlas supply/odds with 10k Monte-Carlo + turn stepper, spellbook odds), same
// data + calculations, reskinned to the flat "Manuscript" treatment: gold-headed
// sections on the page background, no panel cards. Chart key colours (elements,
// rarity, odds purple, donut segments) are canonical and untouched.
import React, { useEffect, useMemo, useState } from 'react';
import { getDeckCards } from '../store/deckRepository.js';
import { deckMatchCount } from '../store/playRepository.js';
import { deckBuildability, subscribeCollection } from '../store/ownedRepository.js';
import * as St from '../store/deckStats.js';
import { ThresholdPips, SegTabs, Loading } from '../components/ui.jsx';
import MissingSheet from '../components/MissingSheet.jsx';
import PillarLoading from '../components/PillarLoading.jsx';

const GOLD = '#cba75f', ROSE = '#c76d85', ROSE_VAL = '#e0899e', TEAL = '#63c9a3', GOLD_MET = '#e3c589';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Joint/threshold odds status tint (kept 3-tier like the original, mapped to the skin).
const oddsCol = (p) => (p >= 0.8 ? TEAL : p >= 0.5 ? GOLD : ROSE_VAL);

export default function DeckStats({ deck, rev, onReload, onOpenCodex, onChanged }) {
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
  // Elementalist provides 1 of EVERY element from game start (rules_text: an
  // additional (E)(F)(W)(A)); other avatars start at 0. Derived from the deck's
  // current avatar, so it resets automatically when the avatar is changed.
  const elementalist = deck.avatar_card_id === 'elementalist' || deck.avatar?.name === 'Elementalist';
  const base = elementalist ? 1 : 0;
  const manaCosts = useMemo(() => St.manaCurveData(sb), [zones]);
  const powerCosts = useMemo(() => St.powerCurveData(sb), [zones]);
  const manaBars = useMemo(() => St.curveBars(manaCosts), [manaCosts]);
  const powerBars = useMemo(() => St.curveBars(powerCosts), [powerCosts]);
  const odds = useMemo(() => atlasMode === 'odds' ? St.atlasOdds(sb, at, atlasTurn, 10000, base) : null,
    [zones, atlasMode, atlasTurn, base]); // 10k sims only when on the Odds tab / turn changes

  if (!zones) return <PillarLoading />;

  return (
    <div style={{ padding: '4px 0 12px' }}>
      {/* Buildability - a stat, so it leads the suite */}
      <Buildability deckId={deck.id} deckName={deck.name} rev={rev} onOpenCodex={onOpenCodex} onChanged={onChanged} />

      {/* Mana curve */}
      <Section title="Mana Curve" right={<span className="ds-hdr-stat">avg {St.avgCost(sb)}</span>}>
        {manaBars ? <><Curve data={manaBars} caption="mana" glow="rgba(220,184,111,.55)" /><Legend costs={manaCosts} /></>
          : <Empty text="Add spells to see the curve." />}
      </Section>

      {/* Composition */}
      <Section title="Composition" right={<Seg value={compMode} set={setCompMode} opts={[['element', 'Element'], ['rarity', 'Rarity']]} />}>
        <Composition sb={sb} mode={compMode} total={sbCount} />
      </Section>

      {/* Power curve */}
      <Section title="Power Curve">
        {powerBars ? <><Curve data={powerBars} caption="power" glow="rgba(199,154,208,.55)" /><Legend costs={powerCosts} /></>
          : <Empty text="Add minions to see the power curve." />}
      </Section>

      {/* Spellbook odds */}
      <Section title="Spellbook Odds">
        <SpellbookOdds sb={sb} />
      </Section>

      {/* Atlas */}
      <Section title="Atlas" right={<>
        <span style={{ font: "600 13px/1 var(--f-mono)", color: atCount >= 30 ? TEAL : ROSE_VAL, flexShrink: 0 }}>{atCount}/30+</span>
        <Seg value={atlasMode} set={setAtlasMode} opts={[['supply', 'Supply'], ['odds', 'Odds']]} />
      </>}>
        <Atlas sb={sb} at={at} atCount={atCount} mode={atlasMode} odds={odds} turn={atlasTurn} base={base} elementalist={elementalist} setTurn={(d) => setAtlasTurn((t) => Math.max(1, Math.min(10, t + d)))} />
      </Section>

      {/* Match record - DERIVED from matches (single source of truth). No manual
          steppers: to change it, log / edit / delete matches in Play. */}
      <Section title="Match Record">
        <div className="ds-record"><span className="ds-wl-w">{wl.w}</span><span className="ds-wl-sep" /><span className="ds-wl-l">{wl.l}</span></div>
        <div className="ds-record-line">
          {wl.w + wl.l ? `${Math.round(wl.w / (wl.w + wl.l) * 100)}% win rate over ${wl.w + wl.l} decided game${wl.w + wl.l === 1 ? '' : 's'}` : 'No games recorded yet'}
        </div>
        <div className="ds-record-help">
          {tracked ? `Tracked automatically from ${tracked} match${tracked === 1 ? '' : 'es'} piloted with this deck.`
            : 'Pilot this deck in Play - New Match, Quick Match, or Add Match - and its record fills in here.'}
        </div>
      </Section>
    </div>
  );
}

/* ---- Mana / Power curve (element-stacked HTML bars) ---- */
function Curve({ data, caption, glow }) {
  const PLOT = 118;
  return (
    <div>
      <div className="ds-curve-plot">
        {data.cols.map((col) => (
          <div key={col.cost} className="ds-col">
            {col.total > 0 && <span className="ds-col-count" style={col.isPeak ? { color: '#f4ecdc', textShadow: `0 0 10px ${glow}` } : undefined}>{col.total}</span>}
            <div className="ds-bar">
              {col.segs.map((s, i) => {
                const first = i === 0, last = i === col.segs.length - 1;
                return <div key={s.el} style={{
                  width: '100%', height: (s.frac * PLOT).toFixed(1) + 'px',
                  background: `linear-gradient(180deg, ${s.grad[0]}, ${s.grad[1]})`,
                  borderRadius: `${last ? 5 : 0}px ${last ? 5 : 0}px ${first ? 2 : 0}px ${first ? 2 : 0}px`,
                  boxShadow: last && col.isPeak ? `0 0 12px ${glow}` : undefined,
                }} />;
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="ds-curve-x">{data.cols.map((c) => <span key={c.cost} className="ds-x-lbl">{c.label}</span>)}</div>
      <div className="ds-curve-cap">{caption}</div>
    </div>
  );
}

function Composition({ sb, mode, total }) {
  const { slices } = St.compositionData(sb, mode);
  const bars = St.typeBars(sb, mode);
  return (
    <div>
      <div className="ds-comp">
        <Donut slices={slices} num={total} label="CARDS" />
        <div className="ds-typebars">
          {bars.length ? bars.map((b) => (
            <div key={b.label}>
              <div className="ds-typebar-hd"><span className="ds-typebar-name">{b.label}</span><span className="ds-typebar-count">{b.total}</span></div>
              <div className="ds-typebar-track">{b.segs.map((s, i) => <div key={i} style={{ width: s.pct + '%', height: '100%', background: s.color }} />)}</div>
            </div>
          )) : <Empty text="No spellbook data" />}
        </div>
      </div>
      <Swatches slices={slices} />
    </div>
  );
}

function Atlas({ sb, at, atCount, mode, odds, turn, base = 0, elementalist = false, setTurn }) {
  const { slices } = St.compositionData(at, 'element');
  const supply = St.supplyData(sb, at, base);
  return (
    <div className="ds-comp">
      <Donut slices={slices} num={atCount} label="SITES" />
      <div style={{ flex: 1, minWidth: 0 }}>
        {mode === 'odds' ? (
          <>
            <div className="ds-odds-head">
              <div className="ds-odds-caption">Threshold odds</div>
              <div className="cc-turn-line">
                <button className="cc-turn-btn" onClick={() => setTurn(-1)} disabled={turn <= 1} aria-label="Earlier turn">−</button>
                <div className="cc-turn-pill"><span className="cc-turn-cap">Draw</span><span className="cc-turn-num">{turn}</span></div>
                <button className="cc-turn-btn" onClick={() => setTurn(1)} disabled={turn >= 10} aria-label="Later turn">+</button>
              </div>
            </div>
            {odds && odds.need.length ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 10px' }}>
                  <span style={{ font: "700 26px/1 var(--f-display)", color: oddsCol(odds.joint), flex: 'none' }}>{Math.round(odds.joint * 100)}%</span>
                  <span style={{ font: "400 12.5px/1.35 var(--f-read)", color: '#8a8175', minWidth: 0 }}>Chance threshold needs are met</span>
                </div>
                {odds.need.length >= 2 && odds.need.map((k) => (
                  <ThreshRow key={k} el={k} text={`need ${odds.peak[k]}`}
                    status={<span style={{ font: "600 13px/1 var(--f-display)", color: oddsCol(odds.prob[k]) }}>{Math.round(odds.prob[k] * 100)}%</span>} />
                ))}
              </>
            ) : <Empty text="No thresholds required" />}
          </>
        ) : (
          supply.length ? supply.map((s) => <ThreshRow key={s.el} el={s.el} text={`need ${s.peak} · ${s.supply} sites`} status={<OkStatus ok={s.status === 'ok'} />} />)
            : <Empty text="No thresholds required" />
        )}
        {elementalist && <div className="ds-note">Elementalist: +1 of each element from game start is counted.</div>}
      </div>
    </div>
  );
}

function SpellbookOdds({ sb }) {
  const { rows } = St.spellbookOdds(sb);
  if (!rows.length) return <Empty text="Add spells to see draw odds." />;
  return (
    <>
      <div className="ds-odds-intro">Odds your next spell is a…</div>
      {rows.map((r) => (
        <div key={r.label} className="ds-odds-row">
          <span className="ds-odds-lbl">{r.label}<span className="ds-odds-cnt">{r.count}</span></span>
          <div className="ds-oddsbar-track"><div className="ds-oddsbar-fill" style={{ width: r.pct + '%' }} /></div>
          <span className="ds-odds-pct">{r.pct}%</span>
        </div>
      ))}
    </>
  );
}

// Buildability - can this deck be built from the Collection? A read-only compare
// via the shared engine; recomputes on the collection revision so recording owned
// cards flips it live. Header tally + progress bar; tap to see the missing list.
function Buildability({ deckId, deckName, rev, onOpenCodex, onChanged }) {
  const [rep, setRep] = useState(null);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => deckBuildability(deckId).then((r) => alive && setRep(r));
    load();
    const off = subscribeCollection(load);
    return () => { alive = false; off(); };
  }, [deckId, rev]);
  // Reserve the section's real height while the compare loads, so the rest of the
  // Stats suite doesn't jump when the result arrives (the widget leads the suite;
  // it used to render null then pop in at the top, shoving every section down).
  if (rep === null) {
    return (
      <section className="ds-sec" aria-busy="true">
        <div className="ds-hdr">
          <span className="ds-hdr-name">Buildability</span><span className="ds-hdr-rule" />
          <span style={{ font: "600 22px/1 var(--f-display)", color: '#5c554b' }}>–</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.06)' }} />
        <div style={{ font: "400 12.5px/1 var(--f-read)", color: '#5c554b', marginTop: 8 }}>Checking your collection…</div>
      </section>
    );
  }
  if (rep.totalRequired === 0) return null;
  const canView = rep.totalMissing > 0, complete = rep.complete;
  return (
    <section className="ds-sec">
      <div className="ds-hdr">
        <span className="ds-hdr-name">Buildability</span>
        <span className="ds-hdr-rule" />
        <span style={{ flexShrink: 0, lineHeight: 1 }}>
          <span style={{ font: "600 22px/1 var(--f-display)", color: complete ? GOLD_MET : ROSE_VAL }}>{rep.totalHave}</span>
          <span style={{ font: "400 14px/1 var(--f-read)", color: '#8a8175' }}>/{rep.totalRequired}</span>
        </span>
      </div>
      <div onClick={() => canView && setSheet(true)} style={{ cursor: canView ? 'pointer' : 'default' }}>
        <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${rep.percent}%`, background: complete ? GOLD_MET : ROSE_VAL, borderRadius: 3, transition: 'width .3s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span style={{ font: "400 12.5px/1 var(--f-read)", color: '#8a8175' }}>
            {complete ? 'Every card owned' : `${rep.totalMissing} missing${rep.unresolved > 0 ? ` · ${rep.unresolved} unrecognised` : ''}`}
          </span>
          {canView && <span style={{ font: "600 12.5px/1 var(--f-ui)", color: ROSE }}>View missing ›</span>}
        </div>
      </div>
      <MissingSheet open={sheet} report={rep} title={deckName ? `Missing for ${deckName}` : 'Missing cards'}
        listName={deckName ? `Missing for ${deckName}` : 'Missing cards'}
        onOpenCard={onOpenCodex} onClose={() => setSheet(false)} onChanged={onChanged} />
    </section>
  );
}

/* ---- shared bits ---- */
const Section = ({ title, right, children }) => (
  <section className="ds-sec">
    <div className="ds-hdr"><span className="ds-hdr-name">{title}</span><span className="ds-hdr-rule" />{right}</div>
    {children}
  </section>
);
const Seg = ({ value, set, opts }) => (
  <SegTabs value={value} onChange={set} options={opts.map(([k, l]) => ({ key: k, label: l }))} />
);
const Donut = ({ slices, num, label }) => (
  <div className="ds-donut" style={{ background: St.conicGradient(slices) }}>
    <div className="ds-donut-hole"><span className="ds-donut-num">{num}</span><span className="ds-donut-lbl">{label}</span></div>
  </div>
);
const Legend = ({ costs }) => (
  <div className="ds-legend">
    {St.curveLegend(costs).map((l) => <span key={l.el} className="ds-legend-item"><span className="ds-legend-dot" style={{ background: l.color }} />{l.el}</span>)}
  </div>
);
const Swatches = ({ slices }) => slices.length ? (
  <div className="ds-legend">
    {slices.map((s) => <span key={s.label} className="ds-legend-item"><span className="ds-legend-dot" style={{ background: s.color }} />{s.label}</span>)}
  </div>
) : null;
const ThreshRow = ({ el, text, status }) => (
  <div className="ds-thresh-row">
    <ThresholdPips runs={[{ el, c: St.EL_CHART[cap(el)] }]} size={16} />
    <span className="ds-thresh-text">{text}</span>
    <span className="ds-thresh-status">{status}</span>
  </div>
);
const OkStatus = ({ ok }) => (
  <>
    <span className="ds-status-dot" style={{ background: ok ? TEAL : ROSE_VAL }} />
    <span style={{ font: "600 10.5px/1 var(--f-display)", letterSpacing: '.14em', color: ok ? TEAL : ROSE_VAL }}>{ok ? 'OK' : 'SHORT'}</span>
  </>
);
const Empty = ({ text }) => <div className="ds-empty">{text}</div>;
