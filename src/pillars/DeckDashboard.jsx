// Current Deck dashboard (My Deck panel) — VERBATIM port of Arcanum's
// _heroHtml + spellbook/atlas/collection zone lists (templates/index.html
// L2164-2364). Avatar hero + stat bar, then three collapsible zone cards with
// grouped, cost/threshold-annotated rows. Random Hand / Notes / Stats to follow.
import React, { useEffect, useState } from 'react';
import { getDeck, getDeckCards, collectionMax, setDeckNotes, setCuriosaUrl, getHistory, listAvatarCards, setAvatar, changeQty } from '../store/deckRepository.js';
import DeckStats from './DeckStats.jsx';
import CardSheet from '../components/CardSheet.jsx';
import { Loading } from '../components/ui.jsx';
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

function Row({ e, rarityOn, onCardTap, editMode, onStep, stepDelay = 0 }) {
  const color = rarityOn ? (RARITY_COLOR[e.rarity] || 'var(--text)') : 'var(--text)';
  return (
    <div className="cc-sb-row" onClick={() => e.card_id && onCardTap?.(e.card_id)}>
      {editMode ? (
        <span className="cc-sb-step" style={{ animationDelay: stepDelay + 'ms' }} onClick={(ev) => ev.stopPropagation()}>
          <button className="cc-step-mini" onClick={() => onStep(e, -1)} aria-label="Remove one">−</button>
          <span className="cc-sb-qty" style={{ minWidth: 22, textAlign: 'center' }}>{e.quantity}</span>
          <button className="cc-step-mini" onClick={() => onStep(e, 1)} aria-label="Add one">+</button>
        </span>
      ) : (
        <span className="cc-sb-qty">{e.quantity}×</span>
      )}
      <span className="cc-sb-name" style={{ color }}>{e.name}</span>
      <ThreshDots th={e.thresholds} />
      {e.cost != null && <div className="cc-sb-coin">{e.cost}</div>}
    </div>
  );
}

function Zone({ title, count, need, groups, collapsed, onToggle, rarityOn, onCardTap, editMode, onStep }) {
  const cls = count >= need ? 'ok' : 'warn';
  let rowIx = 0;   // running index — steppers cascade in top to bottom
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
            {g.entries.map((e, i) => <Row key={e.name + i} e={e} rarityOn={rarityOn} onCardTap={onCardTap}
              editMode={editMode} onStep={onStep} stepDelay={Math.min(rowIx++ * 22, 260)} />)}
          </div>
        )) : <div className="cc-empty">No cards — tap ✎ Edit Deck, then the magnifier to search.</div>
      )}
    </div>
  );
}

// Random Hand — draws an opening hand from the deck pools (Arcanum's drawHand:
// 3 spells / 3 sites, ±1 for Spellslinger / Pathfinder avatars), then keeps the
// rest of each pool so you can "Draw spell" / "Draw site" one card at a time.
function HandCard({ zones, avatar, onCardTap }) {
  const [hand, setHand] = useState(null);
  const cap = (q) => Math.max(0, Math.min(q | 0, 99));
  const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
  function draw() {
    const subs = avatar?.subTypes || (() => { try { return JSON.parse(avatar?.sub_types || '[]'); } catch { return []; } })();
    const sbN = subs.some((s) => /spellslinger/i.test(s)) ? 4 : 3;
    const atN = subs.some((s) => /pathfinder/i.test(s)) ? 0 : 3;
    const sbPool = shuffle(zones.spellbook.flatMap((e) => Array(cap(e.quantity)).fill(e)));
    const atPool = shuffle(zones.atlas.flatMap((e) => Array(cap(e.quantity)).fill(e)));
    setHand({ sb: sbPool.slice(0, sbN), at: atPool.slice(0, atN), rest: sbPool.slice(sbN), restAt: atPool.slice(atN), drawn: [], drawnAt: [] });
  }
  function drawNext(kind) {
    setHand((h) => {
      if (!h) return h;
      if (kind === 'spell') return h.rest.length ? { ...h, drawn: [...h.drawn, h.rest[0]], rest: h.rest.slice(1) } : h;
      return h.restAt.length ? { ...h, drawnAt: [...h.drawnAt, h.restAt[0]], restAt: h.restAt.slice(1) } : h;
    });
  }
  const tile = (e, i, site) => (
    <div key={i} className="cc-hand-tile" style={{ aspectRatio: site ? '4.1 / 3' : '3 / 4.1', cursor: 'pointer' }} onClick={() => e.card_id && onCardTap?.(e.card_id)}>
      {e.image_slug && <img src={`${BASE}cards/${e.image_slug}`} loading="lazy" alt=""
        onError={(ev) => { ev.currentTarget.style.display = 'none'; }}
        style={site ? { position: 'absolute', top: '50%', left: '50%', width: 'calc(100% * 3 / 4.1)', height: 'calc(100% * 4.1 / 3)', objectFit: 'cover', transform: 'translate(-50%,-50%) rotate(90deg)' } : undefined} />}
    </div>
  );
  const sect = (label, cards, site) => cards.length > 0 && (
    <><div className="cc-hand-section-lbl">{label}</div><div className="cc-hand-tiles">{cards.map((e, i) => tile(e, i, site))}</div></>
  );
  return (
    <div className="chart-card cc-list">
      <div className="cc-hdr">
        <span className="cc-title">Random Hand</span>
        <button className="cc-hand-draw-btn" onClick={draw}>{hand ? 'Redraw' : 'Draw'}</button>
      </div>
      {!hand ? <p className="cc-hand-empty">Press Draw to reveal a random opening hand.</p> : (
        <>
          {sect('Opening — Spells', hand.sb, false)}
          {sect('Opening — Sites', hand.at, true)}
          {sect('Drawn Spells', hand.drawn, false)}
          {sect('Drawn Sites', hand.drawnAt, true)}
          {(hand.rest.length > 0 || hand.restAt.length > 0) && (
            <div className="cc-hand-draw-more">
              {hand.rest.length > 0 && <button className="cc-hand-more-btn" onClick={() => drawNext('spell')}>↧ Draw spell</button>}
              {hand.restAt.length > 0 && <button className="cc-hand-more-btn" onClick={() => drawNext('site')}>↧ Draw site</button>}
              <span className="cc-hand-left">{hand.rest.length} spells · {hand.restAt.length} sites left</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Curiosa URL — autopopulated on import, always editable (Arcanum curiosaCard).
function CuriosaUrlCard({ deckId, initial }) {
  const [url, setUrl] = useState(initial || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  useEffect(() => { setUrl(initial || ''); setEditing(false); }, [deckId, initial]);
  const hasUrl = url.trim().length > 0;
  async function save() { const v = draft.trim(); setUrl(v); setEditing(false); await setCuriosaUrl(deckId, v); }
  return (
    <div className="chart-card" style={{ margin: '0 12px 12px' }}>
      <div className="chart-card-header">
        <h3>Curiosa URL</h3>
        {!editing && <button className="cc-card-edit-btn" onClick={() => { setDraft(url); setEditing(true); }}>{hasUrl ? 'Edit' : '＋ Add'}</button>}
      </div>
      <div style={{ padding: '10px 12px 12px' }}>
        {editing ? (
          <>
            <input type="url" className="cc-url-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://curiosa.io/decks/…" autoFocus />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button className="cc-url-btn" onClick={() => setEditing(false)}>Cancel</button>
              <button className="cc-url-btn primary" onClick={save}>Save</button>
            </div>
          </>
        ) : hasUrl ? (
          <a className="cc-url-link" href={url} target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            <span>{url.replace(/^https?:\/\//, '')}</span>
          </a>
        ) : (
          <div className="cc-url-empty">No URL saved — tap ＋ Add to link this deck on Curiosa.</div>
        )}
      </div>
    </div>
  );
}

// Deck Log — collapsible activity history (Arcanum historyCard).
function DeckLogCard({ deckId, rev }) {
  const [rows, setRows] = useState(null);
  const [openLog, setOpenLog] = useState(false);
  useEffect(() => { let a = true; getHistory(deckId).then((r) => a && setRows(r)); return () => { a = false; }; }, [deckId, rev]);
  const n = rows?.length || 0;
  const fmt = (ts) => { try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ts; } };
  return (
    <div className="chart-card" style={{ margin: '0 12px 12px' }}>
      <div className="chart-card-header" style={{ cursor: 'pointer' }} onClick={() => setOpenLog((v) => !v)}>
        <h3>Deck Log {n > 0 && <span style={{ color: '#6e6286', fontWeight: 400 }}>({n})</span>}</h3>
        <button className="cc-log-toggle">{openLog ? '▲ Hide' : '▼ Show'}</button>
      </div>
      {openLog && (
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {n ? rows.map((e, i) => (
            <div key={i} className="cc-log-row"><span className="cc-log-ts">{fmt(e.ts)}</span><span>{e.text}</span></div>
          )) : <div className="cc-log-empty">No changes recorded yet.</div>}
        </div>
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

// Change Avatar — reuses the create-wizard's avatar grid (Arcanum #onboard step 2)
// as a modal; on Save it rewrites the deck's avatar so the hero + library art update.
function ChangeAvatarSheet({ deckId, current, onClose, onSaved }) {
  const [avatars, setAvatars] = useState([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  useEffect(() => { const t = setTimeout(() => listAvatarCards(q).then(setAvatars), q ? 250 : 0); return () => clearTimeout(t); }, [q]);
  const meta = (c) => { const p = []; if (c.life != null) p.push(`♥${c.life}`); if (c.attack != null) p.push(`⚔${c.attack}`); const s = (c.subTypes || []).join(' · ') || c.rarity || ''; if (s) p.push(s); return p.join(' · '); };
  async function save() { if (!sel) return; await setAvatar(deckId, sel.card_id); onSaved?.(); onClose(); }
  return (
    <div className="arc ob-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ob-inner" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="ob-header"><h2>Change Avatar</h2><button className="sheet-close" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="ob-step2">
          <div className="ob-search-pill-wrap">
            <div className={`ob-search-pill${q ? ' has-text' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search avatars…" autoComplete="off" />
              {q && <button className="search-clear-btn" onClick={() => setQ('')} aria-label="Clear">✕</button>}
            </div>
          </div>
          {sel && (
            <div className="ob-preview">
              <div className="ob-preview-name">{sel.name}</div>
              <div className="ob-preview-stats">
                {sel.life != null && <span className="ob-preview-stat"><span className="label">HP</span><span>{sel.life}</span></span>}
                {sel.attack != null && <span className="ob-preview-stat"><span className="label">ATK</span><span>{sel.attack}</span></span>}
              </div>
              <div className="ob-preview-type">{(sel.subTypes || []).join(' · ') || sel.rarity || ''}</div>
              <div className="ob-preview-rules">{sel.rules_text || ''}</div>
            </div>
          )}
          <div className="ob-avatar-list">
            <div className="ob-avatar-grid">
              {avatars.map((c) => (
                <div key={c.card_id} className={`ob-av-card${(sel ? sel.card_id === c.card_id : current === c.card_id) ? ' selected' : ''}`} onClick={() => setSel(c)}>
                  {c.image_slug && <img src={`${BASE}cards/${c.image_slug}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} alt="" />}
                  <div className="ob-av-card-grad" />
                  <div className="ob-av-card-info">
                    <div className="ob-av-card-name">{c.name}</div>
                    <div className="ob-av-card-meta">{meta(c)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="ob-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn primary${!sel ? ' disabled' : ''}`} disabled={!sel} onClick={save} style={{ flex: 1 }}>Save Avatar ✓</button>
        </div>
      </div>
    </div>
  );
}

export default function DeckDashboard({ deckId, rev, statTab = 'list', rarityOn = false, editMode = false, onToast, onChanged, onOpenCodex }) {
  const [deck, setDeck] = useState(null);
  const [zones, setZones] = useState({ spellbook: [], atlas: [], collection: [] });
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [sheetCardId, setSheetCardId] = useState(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [localRev, setLocalRev] = useState(0);   // quick-edit reloads without touching app rev
  useEffect(() => {
    let alive = true;
    Promise.all([getDeck(deckId), getDeckCards(deckId)]).then(([d, z]) => { if (alive) { setDeck(d); setZones(z); } });
    return () => { alive = false; };
  }, [deckId, rev, localRev]);
  const toggle = (z) => setCollapsed((s) => { const n = new Set(s); n.has(z) ? n.delete(z) : n.add(z); return n; });

  if (!deck) return <Loading />;

  const sb = sum(zones.spellbook), at = sum(zones.atlas), co = sum(zones.collection);
  const coMax = collectionMax(deck);
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

  // Quick-edit stepper (edit mode) — same changeQty machinery as the CardSheet,
  // so rarity copy-limits and the collection cap hold; rejections toast.
  const stepRow = (zone) => async (e, delta) => {
    if (e.quantity + delta < 0) return;
    const res = await changeQty(deckId, zone, e, delta);
    if (!res.ok) { onToast?.(res.reason || 'Not allowed'); return; }
    setLocalRev((r) => r + 1);
  };

  return (
    <div>
      {/* Hero */}
      <div className="avatar-hero">
        {deck.avatar?.image_slug && <img className="avatar-hero-img" src={`${BASE}cards/${deck.avatar.image_slug}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} alt="" />}
        <div className="avatar-hero-gradient" />
        <div className="avatar-hero-content">
          <div className="hero-deck-name">{deck.name}</div>
          <div className="hero-avatar-row">
            {deck.avatar?.name
              ? <span className="hero-avatar-name" onClick={() => setAvatarOpen(true)} title="Change avatar">{deck.avatar.name}</span>
              : <span className="hero-avatar-name" onClick={() => setAvatarOpen(true)} title="Choose avatar">＋ Set avatar</span>}
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
        <DeckStats deck={deck} rev={rev} onReload={() => { setLocalRev((r) => r + 1); onChanged?.(); }} />
      ) : (
        <div style={{ paddingTop: 12 }}>
          <Zone title="Spellbook" count={sb} need={60} groups={sbGroups} collapsed={collapsed.has('spellbook')} onToggle={() => toggle('spellbook')} rarityOn={rarityOn} onCardTap={setSheetCardId} editMode={editMode} onStep={stepRow('spellbook')} />
          <Zone title="Atlas" count={at} need={30} groups={atGroups} collapsed={collapsed.has('atlas')} onToggle={() => toggle('atlas')} rarityOn={rarityOn} onCardTap={setSheetCardId} editMode={editMode} onStep={stepRow('atlas')} />
          <Zone title="Collection" count={co} need={coMax} groups={coGroups} collapsed={collapsed.has('collection')} onToggle={() => toggle('collection')} rarityOn={rarityOn} onCardTap={setSheetCardId} editMode={editMode} onStep={stepRow('collection')} />
          <HandCard zones={zones} avatar={deck.avatar} onCardTap={setSheetCardId} />
          <NotesCard deckId={deckId} initial={deck.notes} />
          <CuriosaUrlCard deckId={deckId} initial={deck.curiosa_url} />
          <DeckLogCard deckId={deckId} rev={rev + localRev} />
        </div>
      )}

      <CardSheet cardId={sheetCardId} deckId={deckId} onChange={() => setLocalRev((r) => r + 1)} onClose={() => setSheetCardId(null)} onOpenCodex={onOpenCodex} />
      {avatarOpen && (
        <ChangeAvatarSheet deckId={deckId} current={deck.avatar_card_id} onClose={() => setAvatarOpen(false)}
          onSaved={() => { setLocalRev((r) => r + 1); onChanged?.(); }} />
      )}
    </div>
  );
}
