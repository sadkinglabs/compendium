// Current Deck dashboard (My Deck panel) — VERBATIM port of Arcanum's
// _heroHtml + spellbook/atlas/collection zone lists (templates/index.html
// L2164-2364). Avatar hero + stat bar, then three collapsible zone cards with
// grouped, cost/threshold-annotated rows. Random Hand / Notes / Stats to follow.
import React, { useEffect, useState } from 'react';
import { getDeck, getDeckCards, collectionMax, setDeckNotes } from '../store/deckRepository.js';
import DeckStats from './DeckStats.jsx';
import CardSheet from '../components/CardSheet.jsx';
import '../theme/deckdash.css';

const BASE = import.meta.env.BASE_URL;
const RARITY_COLOR = { Ordinary: 'var(--ordinary)', Exceptional: 'var(--exceptional)', Elite: 'var(--elite)', Unique: 'var(--unique)' };
const SB_ORDER = ['Aura', 'Artifact', 'Minion', 'Magic'];
const SB_LABEL = { Aura: 'Auras', Artifact: 'Artifacts', Minion: 'Minions', Magic: 'Magics', Other: 'Other' };

const sum = (arr) => arr.reduce((s, e) => s + e.quantity, 0);

function ThreshDots({ th }) {
  if (!th) return null;
  const dots = [];
  ['air', 'earth', 'fire', 'water'].forEach((k) => { for (let i = 0; i < (th[k] || 0); i++) dots.push(`${k}-${i}`); });
  if (!dots.length) return null;
  return <div className="cc-thresh">{dots.map((d) => <img key={d} src={`${BASE}icons/${d.split('-')[0]}.png`} alt="" />)}</div>;
}

function Row({ e, rarityOn, onCardTap }) {
  const color = rarityOn ? (RARITY_COLOR[e.rarity] || 'var(--text)') : 'var(--text)';
  return (
    <div className="cc-sb-row" onClick={() => e.card_id && onCardTap?.(e.card_id)}>
      <span className="cc-sb-qty">{e.quantity}×</span>
      <span className="cc-sb-name" style={{ color }}>{e.name}</span>
      <ThreshDots th={e.thresholds} />
      {e.cost != null && <div className="cc-sb-coin">{e.cost}</div>}
    </div>
  );
}

function Zone({ title, count, need, groups, collapsed, onToggle, rarityOn, onCardTap }) {
  const cls = count >= need ? 'ok' : 'warn';
  return (
    <div className="chart-card cc-list">
      <div className="cc-hdr collapsible" onClick={onToggle}>
        <span className="cc-title">{title}</span>
        <span className={`cc-count ${cls}`}>{count}/{need === 10 || need === 11 ? need : `${need}+`}</span>
        <span className="cc-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        groups.some((g) => g.entries.length) ? groups.filter((g) => g.entries.length).map((g) => (
          <div key={g.label}>
            {g.label && <div className="cc-sb-group-label">{g.label} ({sum(g.entries)})</div>}
            {g.entries.map((e, i) => <Row key={e.name + i} e={e} rarityOn={rarityOn} onCardTap={onCardTap} />)}
          </div>
        )) : <div className="cc-empty">No cards — use “Add cards to deck”.</div>
      )}
    </div>
  );
}

// Random Hand — draws an opening hand from the deck pools (Arcanum's drawHand:
// 3 spells / 3 sites, ±1 for Spellslinger / Pathfinder avatars).
function HandCard({ zones, avatar, onCardTap }) {
  const [hand, setHand] = useState(null);
  function draw() {
    const subs = avatar?.subTypes || (() => { try { return JSON.parse(avatar?.sub_types || '[]'); } catch { return []; } })();
    const sbN = subs.some((s) => /spellslinger/i.test(s)) ? 4 : 3;
    const atN = subs.some((s) => /pathfinder/i.test(s)) ? 0 : 3;
    const cap = (q) => Math.max(0, Math.min(q | 0, 99));
    const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);
    const sbPool = zones.spellbook.flatMap((e) => Array(cap(e.quantity)).fill(e));
    const atPool = zones.atlas.flatMap((e) => Array(cap(e.quantity)).fill(e));
    setHand({ sb: shuffle(sbPool).slice(0, sbN), at: shuffle(atPool).slice(0, atN) });
  }
  const tile = (e, i, site) => (
    <div key={i} className="cc-hand-tile" style={{ aspectRatio: site ? '4.1 / 3' : '3 / 4.1', cursor: 'pointer' }} onClick={() => e.card_id && onCardTap?.(e.card_id)}>
      {e.image_slug && <img src={`${BASE}cards/${e.image_slug}`} loading="lazy" alt=""
        onError={(ev) => { ev.currentTarget.style.display = 'none'; }}
        style={site ? { position: 'absolute', top: '50%', left: '50%', width: 'calc(100% * 3 / 4.1)', height: 'calc(100% * 4.1 / 3)', objectFit: 'cover', transform: 'translate(-50%,-50%) rotate(90deg)' } : undefined} />}
    </div>
  );
  return (
    <div className="chart-card cc-list">
      <div className="cc-hdr">
        <span className="cc-title">Random Hand</span>
        <button className="cc-hand-draw-btn" onClick={draw}>{hand ? 'Redraw' : 'Draw'}</button>
      </div>
      {!hand ? <p className="cc-hand-empty">Press Draw to reveal a random opening hand.</p> : (
        <>
          {hand.sb.length > 0 && <><div className="cc-hand-section-lbl">Opening — Spells</div><div className="cc-hand-tiles">{hand.sb.map((e, i) => tile(e, i, false))}</div></>}
          {hand.at.length > 0 && <><div className="cc-hand-section-lbl">Opening — Sites</div><div className="cc-hand-tiles">{hand.at.map((e, i) => tile(e, i, true))}</div></>}
        </>
      )}
    </div>
  );
}

function NotesCard({ deckId, initial }) {
  const [notes, setNotes] = useState(initial || '');
  useEffect(() => { setNotes(initial || ''); }, [deckId]); // eslint-disable-line
  return (
    <div className="chart-card" style={{ margin: '0 12px 12px' }}>
      <div className="chart-card-header"><h3>Notes</h3></div>
      <div style={{ padding: '10px 12px 12px' }}>
        <textarea className="cc-notes-area" value={notes} onChange={(e) => setNotes(e.target.value)}
          onBlur={() => setDeckNotes(deckId, notes)} placeholder="Strategy notes, sideboard ideas, matchup tips…" />
      </div>
    </div>
  );
}

export default function DeckDashboard({ deckId, rev, statTab = 'list' }) {
  const [deck, setDeck] = useState(null);
  const [zones, setZones] = useState({ spellbook: [], atlas: [], collection: [] });
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [sheetCardId, setSheetCardId] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all([getDeck(deckId), getDeckCards(deckId)]).then(([d, z]) => { if (alive) { setDeck(d); setZones(z); } });
    return () => { alive = false; };
  }, [deckId, rev]);
  const toggle = (z) => setCollapsed((s) => { const n = new Set(s); n.has(z) ? n.delete(z) : n.add(z); return n; });

  if (!deck) return <div style={{ color: 'var(--muted)', padding: '20px' }}>…</div>;

  const sb = sum(zones.spellbook), at = sum(zones.atlas), co = sum(zones.collection);
  const coMax = collectionMax(deck);
  const rarityOn = false;
  // Deck colour identity = elements the spellbook needs a threshold of.
  const els = ['air', 'earth', 'fire', 'water'].filter((el) => zones.spellbook.some((e) => (e.thresholds?.[el] || 0) > 0));

  // Spellbook grouped by type (Aura/Artifact/Minion/Magic/Other), sorted by cost.
  const sbGroups = [...SB_ORDER, 'Other'].map((cat) => ({
    label: SB_LABEL[cat] || cat,
    entries: zones.spellbook.filter((e) => (SB_ORDER.find((c) => (e.type || '').includes(c)) || 'Other') === cat).sort((a, b) => (a.cost ?? 999) - (b.cost ?? 999)),
  }));
  // Atlas grouped by element.
  const EL_ORDER = ['Air', 'Earth', 'Fire', 'Water', 'Multi', 'Neutral'];
  const atGroups = EL_ORDER.map((el) => ({
    label: el,
    entries: zones.atlas.filter((e) => {
      const es = (e.elements || []).filter((x) => x && x.toLowerCase() !== 'none');
      const key = !es.length ? 'Neutral' : es.length > 1 ? 'Multi' : es[0].charAt(0).toUpperCase() + es[0].slice(1).toLowerCase();
      return key === el;
    }).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const coGroups = [{ label: '', entries: zones.collection.slice().sort((a, b) => a.name.localeCompare(b.name)) }];

  const statColor = (ok) => ok ? 'var(--success)' : 'var(--warn)';

  return (
    <div>
      {/* Hero */}
      <div className="avatar-hero">
        {deck.avatar?.image_slug && <img className="avatar-hero-img" src={`${BASE}cards/${deck.avatar.image_slug}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} alt="" />}
        <div className="avatar-hero-gradient" />
        <div className="avatar-hero-content">
          <div className="hero-deck-name">{deck.name}</div>
          <div className="hero-avatar-row">
            {deck.avatar?.name && <span className="hero-avatar-name">{deck.avatar.name}</span>}
            {deck.avatar?.name && els.length > 0 && <span className="hero-avatar-sep">·</span>}
            {els.map((el) => <img key={el} src={`${BASE}icons/${el}.png`} style={{ width: 16, height: 16, flexShrink: 0 }} alt={el} />)}
          </div>
          <div className="hero-stat-bar">
            <span className="hero-stat-item" style={{ color: statColor(sb >= 60) }}>Spellbook {sb}/60+</span>
            <span className="hero-stat-divider" />
            <span className="hero-stat-item" style={{ color: statColor(at >= 30) }}>Atlas {at}/30+</span>
            <span className="hero-stat-divider" />
            <span className="hero-stat-item" style={{ color: statColor(co === coMax) }}>Coll {co}/{coMax}</span>
          </div>
        </div>
      </div>

      {/* List zones / hand / notes, or the Stats analysis suite */}
      {statTab === 'stats' ? (
        <DeckStats deck={deck} rev={rev} />
      ) : (
        <div style={{ paddingTop: 12 }}>
          <Zone title="Spellbook" count={sb} need={60} groups={sbGroups} collapsed={collapsed.has('spellbook')} onToggle={() => toggle('spellbook')} rarityOn={rarityOn} onCardTap={setSheetCardId} />
          <Zone title="Atlas" count={at} need={30} groups={atGroups} collapsed={collapsed.has('atlas')} onToggle={() => toggle('atlas')} rarityOn={rarityOn} onCardTap={setSheetCardId} />
          <Zone title="Collection" count={co} need={coMax} groups={coGroups} collapsed={collapsed.has('collection')} onToggle={() => toggle('collection')} rarityOn={rarityOn} onCardTap={setSheetCardId} />
          <HandCard zones={zones} avatar={deck.avatar} onCardTap={setSheetCardId} />
          <NotesCard deckId={deckId} initial={deck.notes} />
        </div>
      )}

      <CardSheet cardId={sheetCardId} onClose={() => setSheetCardId(null)} />
    </div>
  );
}
