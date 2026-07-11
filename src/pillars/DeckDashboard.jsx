// Current Deck dashboard (My Deck panel) - VERBATIM port of Arcanum's
// _heroHtml + spellbook/atlas/collection zone lists (templates/index.html
// L2164-2364). Avatar hero + stat bar, then three collapsible zone cards with
// grouped, cost/threshold-annotated rows. Random Hand / Notes / Stats to follow.
import React, { useEffect, useRef, useState } from 'react';
import { getDeck, getDeckCards, collectionMax, copyLimit, setDeckNotes, setCuriosaUrl, getHistory, listAvatarCards, setAvatar, changeQty } from '../store/deckRepository.js';
import DeckStats from './DeckStats.jsx';
import CardSheet from '../components/CardSheet.jsx';
import { Loading } from '../components/ui.jsx';
import { XSvg } from '../components/CreateDeckWizard.jsx';
import { safeHref } from '../util.js';
import { haptic } from '../native.js';
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
  return <div className="mf-thresh">{dots.map((d) => <img key={d} src={`${BASE}icons/${d.split('-')[0]}.png`} alt="" />)}</div>;
}

function Row({ e, rarityOn, onCardTap, editMode, onStep, stepDelay = 0 }) {
  const color = rarityOn ? (RARITY_COLOR[e.rarity] || undefined) : undefined;
  return (
    <div className="mf-row" onClick={() => e.card_id && onCardTap?.(e.card_id)}>
      {editMode ? (
        <span className="mf-step" style={{ animationDelay: stepDelay + 'ms' }} onClick={(ev) => ev.stopPropagation()}>
          <button className="mf-step-btn" onClick={() => onStep(e, -1)} aria-label="Remove one">−</button>
          <span className="mf-step-qty">{e.quantity}</span>
          <button className="mf-step-btn" onClick={() => onStep(e, 1)} aria-label="Add one">+</button>
        </span>
      ) : (
        <span className="mf-row-qty">{e.quantity}×</span>
      )}
      <span className="mf-row-name" style={color ? { color } : undefined}>{e.name}</span>
      <ThreshDots th={e.thresholds} />
      {e.cost != null && <span className="mf-cost" title={`Mana cost ${e.cost}`}>{e.cost}</span>}
    </div>
  );
}

function Zone({ title, count, need, needLabel, groups, collapsed, onToggle, rarityOn, onCardTap, editMode, onStep }) {
  const cls = count >= need ? 'ok' : 'short';
  let rowIx = 0;   // running index - steppers cascade in top to bottom
  return (
    <div className="mf-sec">
      <div className="mf-sec-hdr" onClick={onToggle}>
        <span className="mf-sec-name">{title}</span>
        <span className={`mf-sec-tally ${cls}`}>{count}/{needLabel}</span>
        <span className="mf-sec-rule" />
        <span className="mf-sec-chev">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        groups.some((g) => g.entries.length) ? groups.filter((g) => g.entries.length).map((g) => (
          <div key={g.label}>
            {g.label && (
              <div className="mf-grp">
                <span className="mf-grp-name">{g.label}</span>
                <span className="mf-grp-count">{sum(g.entries)}</span>
                <span className="mf-grp-rule" />
              </div>
            )}
            {g.entries.map((e, i) => <Row key={e.name + i} e={e} rarityOn={rarityOn} onCardTap={onCardTap}
              editMode={editMode} onStep={onStep} stepDelay={Math.min(rowIx++ * 22, 260)} />)}
          </div>
        )) : <div className="mf-empty">No cards - tap ✎ Edit Deck, then the magnifier to search.</div>
      )}
    </div>
  );
}

// Random Hand ("Dealt") - draws an opening hand from the deck pools (Arcanum's
// drawHand: 3 spells / 3 sites, ±1 for Spellslinger / Pathfinder avatars), then
// keeps the rest so you can "Draw spell" / "Draw site" one at a time until the
// whole deck is in hand. Cards are laid out as an overlapping held-hand fan that
// wraps to more fan rows as the hand grows; the newest single-drawn card wears a
// gilt frame + DRAWN tab. Each card keeps a stable seeded tilt (stored in state)
// so re-renders never reshuffle the fan.
function HandCard({ zones, avatar, onCardTap }) {
  const [hand, setHand] = useState(null);
  const [shake, setShake] = useState(null);   // 'spell' | 'site' - empty-pile nudge
  const [leaving, setLeaving] = useState(false); // Redraw sweep-out in progress
  const seq = useRef(0);
  const fanRef = useRef(null);
  const [fanW, setFanW] = useState(0);   // measured fan width - drives row breaks
  useEffect(() => {
    const el = fanRef.current;
    if (!el) return;
    setFanW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setFanW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hand?.dealKey]);
  const cap = (q) => Math.max(0, Math.min(q | 0, 99));
  const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
  const spellRot = () => Math.round((Math.random() * 19 - 9) * 10) / 10;   // -9..+10
  const siteRot = () => Math.round((Math.random() * 3 - 1.5) * 10) / 10;   // -1.5..+1.5
  const mk = (e, drawn, rotFn) => ({ e, id: seq.current++, rot: rotFn(), drawn });

  function build() {
    const subs = avatar?.subTypes || (() => { try { return JSON.parse(avatar?.sub_types || '[]'); } catch { return []; } })();
    const sbN = subs.some((s) => /spellslinger/i.test(s)) ? 4 : 3;
    const atN = subs.some((s) => /pathfinder/i.test(s)) ? 0 : 3;
    const sbPool = shuffle(zones.spellbook.flatMap((e) => Array(cap(e.quantity)).fill(e)));
    const atPool = shuffle(zones.atlas.flatMap((e) => Array(cap(e.quantity)).fill(e)));
    setHand((h) => ({
      spells: sbPool.slice(0, sbN).map((e) => mk(e, false, spellRot)),
      sites: atPool.slice(0, atN).map((e) => mk(e, false, siteRot)),
      rest: sbPool.slice(sbN), restAt: atPool.slice(atN), newest: null, dealKey: (h?.dealKey || 0) + 1,
    }));
    setLeaving(false);
  }
  // First deal is instant; a Redraw sweeps the current hand down-and-out first,
  // then deals the new one once the sweep (250ms + a small per-card stagger) ends.
  function draw() {
    if (!hand) return build();
    setLeaving(true);
    const n = hand.spells.length + hand.sites.length;
    setTimeout(build, 250 + Math.min(n, 12) * 30);
  }
  function bump(kind) { setShake(kind); setTimeout(() => setShake((s) => (s === kind ? null : s)), 420); }
  function drawNext(kind) {
    if (kind === 'spell' && !hand?.rest.length) return bump('spell');
    if (kind === 'site' && !hand?.restAt.length) return bump('site');
    setHand((h) => {
      if (!h) return h;
      if (kind === 'spell') { const c = mk(h.rest[0], true, spellRot); return { ...h, spells: [...h.spells, c], rest: h.rest.slice(1), newest: c.id }; }
      const c = mk(h.restAt[0], true, siteRot); return { ...h, sites: [...h.sites, c], restAt: h.restAt.slice(1), newest: c.id };
    });
  }
  // Fan overlap tightens with hand size: a comfortable spread up to 3, then the
  // held-hand closes as more cards join; 8+ just wraps to new fan rows.
  // Overlap tightens aggressively so the hand stacks (only ~22px of each buried
  // card shows) long before it needs a second row - the last draw stays on top,
  // fully visible.
  const overlap = (n) => (n <= 3 ? -8 : -(112 - Math.max(22, 92 - (n - 3) * 12)));

  const card = (c, i, site) => (
    <div key={c.id} className={`dealt-card${site ? ' site' : ''}${c.id === hand.newest ? ' newest' : ''}${leaving ? ' leaving' : ''}`}
      style={{ '--rot': c.rot + 'deg', animationDelay: (leaving ? i * 30 : c.drawn ? 0 : i * 70) + 'ms' }}
      onClick={() => c.e.card_id && onCardTap?.(c.e.card_id)}>
      {c.e.image_slug && <img src={`${BASE}cards/${c.e.image_slug}`} loading="lazy" alt=""
        onError={(ev) => { ev.currentTarget.style.display = 'none'; }} />}
      <span className="dealt-frame" aria-hidden="true" />
      {!site && <span className="dealt-tab">DRAWN</span>}
    </div>
  );

  const group = (label, cards) => {
    if (!cards.length) return null;
    const open = cards.filter((c) => !c.drawn).length, drawnN = cards.length - open;
    const site = label === 'SITES';
    const sub = <div className="dealt-sub"><span className="dealt-sub-name">{label}</span><span className="dealt-sub-count">{open} opening{drawnN ? ` · ${drawnN} drawn` : ''}</span></div>;
    if (site) {
      return <div className="dealt-group">{sub}<div className="dealt-strip">{cards.map((c, i) => card(c, i, true))}</div></div>;
    }
    // Break the spell fan into rows that fit the measured width, so every row's
    // lead card sits at margin 0 (centred, never shoved off-edge). The cards stay
    // a flat, stably-keyed list - only the break markers move - so widening the
    // fan never remounts (and re-animates) a card.
    const n = cards.length, rev = 112 + overlap(n);
    const per = fanW ? Math.max(1, Math.floor((fanW - 12 - 112) / rev) + 1) : n;
    return (
      <div className="dealt-group">{sub}
        <div className="dealt-fan" ref={fanRef} style={{ '--ov': overlap(n) + 'px' }}>
          {cards.map((c, i) => (
            <React.Fragment key={c.id}>
              {i > 0 && i % per === 0 && <i className="dealt-break" aria-hidden="true" />}
              {card(c, i, false)}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="dealt">
      <div className="dealt-hdr">
        <span className="mf-sec-name">Random Hand</span>
        <span className="mf-sec-rule" />
        <button className="dealt-pill" onClick={draw}>↻ {hand ? 'Redraw' : 'Deal'}</button>
      </div>
      {!hand ? (
        <p className="dealt-empty">Press Deal to reveal a random opening hand.</p>
      ) : (
        <>
          <div className="dealt-scroll" key={hand.dealKey}>
            {group('SPELLS', hand.spells)}
            {group('SITES', hand.sites)}
          </div>
          <div className="dealt-actions">
            <button className={`dealt-pill wide${hand.rest.length ? '' : ' empty'}${shake === 'spell' ? ' shake' : ''}`} onClick={() => drawNext('spell')}>⤓ Draw spell</button>
            <button className={`dealt-pill wide${hand.restAt.length ? '' : ' empty'}${shake === 'site' ? ' shake' : ''}`} onClick={() => drawNext('site')}>⤓ Draw site</button>
          </div>
          <div className="dealt-tally">
            <span className="dealt-num" key={'s' + hand.rest.length}>{hand.rest.length}</span>
            <span className="dealt-lbl">spells</span>
            <span className="dealt-tally-sep" />
            <span className="dealt-num" key={'a' + hand.restAt.length}>{hand.restAt.length}</span>
            <span className="dealt-lbl">sites left</span>
          </div>
        </>
      )}
    </div>
  );
}

// Curiosa URL - autopopulated on import, always editable (Arcanum curiosaCard).
function CuriosaUrlCard({ deckId, initial }) {
  const [url, setUrl] = useState(initial || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  useEffect(() => { setUrl(initial || ''); setEditing(false); }, [deckId, initial]);
  const hasUrl = url.trim().length > 0;
  async function save() { const v = draft.trim(); setUrl(v); setEditing(false); await setCuriosaUrl(deckId, v); }
  return (
    <div className="mx-sec">
      <div className="mx-hdr">
        <span className="mf-sec-name">Curiosa URL</span>
        <span className="mf-sec-rule" />
        {!editing && <button className="dealt-pill" onClick={() => { setDraft(url); setEditing(true); }}>{hasUrl ? '✎ Edit' : '＋ Add'}</button>}
      </div>
      {editing ? (
        <>
          <input type="url" className="mx-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://curiosa.io/decks/…" autoFocus />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button className="dealt-pill" onClick={() => setEditing(false)}>Cancel</button>
            <button className="dealt-pill" onClick={save}>Save</button>
          </div>
        </>
      ) : hasUrl && safeHref(url) ? (
        <a className="mx-link" href={safeHref(url)} target="_blank" rel="noreferrer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          <span>{url.replace(/^https?:\/\//, '')}</span>
        </a>
      ) : hasUrl ? (
        <div className="mx-empty">Saved link isn’t a valid web URL.</div>
      ) : (
        <div className="mx-empty">No URL saved - tap ＋ Add to link this deck on Curiosa.</div>
      )}
    </div>
  );
}

// Deck Log - collapsible activity history (Arcanum historyCard).
function DeckLogCard({ deckId, rev }) {
  const [rows, setRows] = useState(null);
  const [openLog, setOpenLog] = useState(false);
  useEffect(() => { let a = true; getHistory(deckId).then((r) => a && setRows(r)); return () => { a = false; }; }, [deckId, rev]);
  const n = rows?.length || 0;
  const fmt = (ts) => { try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ts; } };
  return (
    <div className="mx-sec">
      <div className="mx-hdr" style={{ cursor: 'pointer' }} onClick={() => setOpenLog((v) => !v)}>
        <span className="mf-sec-name">Deck Log</span>
        {n > 0 && <span className="mx-count">{n}</span>}
        <span className="mf-sec-rule" />
        <button className="dealt-pill">{openLog ? 'Hide' : 'Show'}</button>
      </div>
      {openLog && (
        <div className="mx-log">
          {n ? rows.map((e, i) => (
            <div key={i} className="mx-log-row"><span className="mx-log-ts">{fmt(e.ts)}</span><span>{e.text}</span></div>
          )) : <div className="mx-empty" style={{ textAlign: 'center', padding: '10px 0' }}>No changes recorded yet.</div>}
        </div>
      )}
    </div>
  );
}

function NotesCard({ deckId, initial }) {
  const [notes, setNotes] = useState(initial || '');
  useEffect(() => { setNotes(initial || ''); }, [deckId]); // eslint-disable-line
  return (
    <div className="mx-sec">
      <div className="mx-hdr">
        <span className="mf-sec-name">Notes</span>
        <span className="mf-sec-rule" />
      </div>
      <textarea className="mx-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
        onBlur={() => setDeckNotes(deckId, notes)} placeholder="Strategy notes, sideboard ideas, matchup tips…" />
    </div>
  );
}

// Change Avatar - reuses the create-wizard's avatar grid (Arcanum #onboard step 2)
// as a modal; on Save it rewrites the deck's avatar so the hero + library art update.
function ChangeAvatarSheet({ deckId, current, onClose, onSaved }) {
  const [avatars, setAvatars] = useState([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  useEffect(() => { const t = setTimeout(() => listAvatarCards(q).then(setAvatars), q ? 250 : 0); return () => clearTimeout(t); }, [q]);
  const meta = (c) => { const p = []; if (c.life != null) p.push(`${c.life} HP`); if (c.attack != null) p.push(`${c.attack} ATK`); const s = (c.subTypes || []).join(' · ') || c.rarity || ''; if (s) p.push(s); return p.join(' · '); };
  async function save() { if (!sel) return; await setAvatar(deckId, sel.card_id); onSaved?.(); onClose(); }
  return (
    <div className="arc ob-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ob-inner" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="ob-header"><h2>Change Avatar</h2><button className="sheet-close" onClick={onClose} aria-label="Close">{XSvg}</button></div>
        <div className="ob-step2">
          <div className="ob-search-pill-wrap">
            <div className={`ob-search-pill${q ? ' has-text' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search avatars…" autoComplete="off" />
              {q && <button className="search-clear-btn" onClick={() => setQ('')} aria-label="Clear">{XSvg}</button>}
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
          <button className={`btn primary${!sel ? ' disabled' : ''}`} disabled={!sel} onClick={save} style={{ flex: 1 }}>Save Avatar</button>
        </div>
      </div>
    </div>
  );
}


export default function DeckDashboard({ deckId, rev, statTab = 'list', rarityOn = false, editMode = false, onToast, onChanged, onOpenCodex, onMissing }) {
  const [deck, setDeck] = useState(null);
  const [loaded, setLoaded] = useState(false);   // distinguishes "loading" from "gone"
  const [zones, setZones] = useState({ spellbook: [], atlas: [], collection: [] });
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [sheetCardId, setSheetCardId] = useState(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [localRev, setLocalRev] = useState(0);   // quick-edit reloads without touching app rev
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    Promise.all([getDeck(deckId), getDeckCards(deckId)]).then(([d, z]) => { if (alive) { setDeck(d); setZones(z); setLoaded(true); } });
    return () => { alive = false; };
  }, [deckId, rev, localRev]);
  // Leaving edit mode reloads from the store, which returns only qty>0 rows - this
  // is what clears the 0-qty ghost cards kept visible during editing.
  const wasEditing = React.useRef(editMode);
  useEffect(() => { if (wasEditing.current && !editMode) setLocalRev((r) => r + 1); wasEditing.current = editMode; }, [editMode]);
  const toggle = (z) => setCollapsed((s) => { const n = new Set(s); n.has(z) ? n.delete(z) : n.add(z); return n; });

  if (!deck) return loaded ? (
    // The deck resolved to nothing - deleted, or a stale resume/link target.
    // Offer an escape instead of spinning forever.
    <div style={{ minHeight: '48vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 32, gap: 16 }}>
      <div style={{ font: "600 17px/1.3 'Cinzel',Georgia,serif", color: '#dcb86f' }}>This deck no longer exists</div>
      <div style={{ font: "400 14px/1.5 'EB Garamond',Georgia,serif", color: '#9a8cae' }}>It may have been deleted or belongs to another profile.</div>
      {onMissing && <button onClick={onMissing} style={{ padding: '11px 22px', borderRadius: 14, background: 'rgba(18,16,13,.85)', border: '1px solid rgba(220,184,111,.45)', color: '#dcb86f', font: "600 13px/1 'Hanken Grotesk',sans-serif", cursor: 'pointer' }}>Open Library</button>}
    </div>
  ) : <Loading />;

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

  // Quick-edit stepper (edit mode) - OPTIMISTIC, like the CardSheet: the row
  // (and the hero counts derived from zones) update instantly; changeQty then
  // enforces rarity copy-limits / collection cap in the background, and a
  // rejection toasts + resyncs from the store (authoritative revert).
  const stepRow = (zone) => async (e, delta) => {
    // Clamp an add to the legal room BEFORE the optimistic paint, so the count never
    // overshoots the cap and snaps back (no flicker). copyLimit is a total across zones.
    let d = delta;
    if (delta > 0) {
      const totalCopies = ['spellbook', 'atlas', 'collection'].reduce((n, z) => n + (zones[z].find((x) => x.card_id === e.card_id)?.quantity || 0), 0);
      let room = copyLimit(e) - totalCopies;
      if (zone === 'collection') room = Math.min(room, coMax - co);
      d = Math.min(delta, Math.max(0, room));
      if (d === 0) { haptic('light'); onToast?.(zone === 'collection' && co >= coMax ? `Collection limit ${coMax}` : `Max ${copyLimit(e)} copies`); return; }
    }
    if (e.quantity + d < 0) return;
    haptic('light');
    setZones((z) => ({
      ...z,
      [zone]: z[zone]
        .map((x) => x.card_id === e.card_id ? { ...x, quantity: x.quantity + d } : x)
        // Keep a card that hits 0 visible WHILE editing (easy misclick recovery); the
        // reload on "Done" (editMode -> false effect) drops the 0-qty ghosts.
        .filter((x) => editMode ? true : x.quantity > 0),
    }));
    const res = await changeQty(deckId, zone, e, d);
    if (!res.ok) { onToast?.(res.reason || 'Not allowed'); setLocalRev((r) => r + 1); return; }
    const nq = e.quantity + d;
    onToast?.(d > 0 ? `Added ${e.name}` : (nq <= 0 ? `Removed ${e.name}` : `${e.name} · ${nq} left`));
  };

  return (
    <div>
      {/* Hero plate - framed card: gilt-edged art with a bottom scrim under the
          deck name, then the archetype eyebrow + threshold icons + per-section
          tally (teal when a requirement is met, rose when short). */}
      <div className="mf-hero">
        <div className="mf-hero-inner">
          <div className="mf-hero-card">
            <div className="mf-hero-art">
              {deck.avatar?.image_slug && <img src={`${BASE}cards/${deck.avatar.image_slug}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} alt="" />}
              <div className="mf-hero-scrim" />
              <div className="mf-hero-name">{deck.name}</div>
            </div>
            <div className="mf-hero-body">
              <div className="mf-hero-meta">
                <button className="mf-hero-arch" onClick={() => setAvatarOpen(true)} title={deck.avatar?.name ? 'Change avatar' : 'Choose avatar'}>
                  {deck.avatar?.name || '＋ Set avatar'}
                </button>
                {els.length > 0 && <span className="mf-hero-sep" />}
                {els.map((el) => <img key={el} className="mf-hero-el" src={`${BASE}icons/${el}.png`} alt={el} />)}
              </div>
              <div className="mf-hero-tally">
                <span className="mf-tally-item">Spellbook <span className={`mf-tally-val ${sb >= 60 ? 'ok' : 'short'}`}>{sb}/60+</span></span>
                <span className="mf-tally-item">Atlas <span className={`mf-tally-val ${at >= 30 ? 'ok' : 'short'}`}>{at}/30+</span></span>
                <span className="mf-tally-item">Coll <span className={`mf-tally-val ${co === coMax ? 'ok' : 'short'}`}>{co}/{coMax}</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* List zones / hand / notes, or the Stats analysis suite (Buildability leads
          the Stats suite - it's a stat, not on the List page). */}
      {statTab === 'stats' ? (
        <DeckStats deck={deck} rev={rev} onReload={() => { setLocalRev((r) => r + 1); onChanged?.(); }}
          onOpenCodex={onOpenCodex} onChanged={onChanged} />
      ) : (
        <div style={{ paddingTop: 4 }}>
          <Zone title="Spellbook" count={sb} need={60} needLabel="60+" groups={sbGroups} collapsed={collapsed.has('spellbook')} onToggle={() => toggle('spellbook')} rarityOn={rarityOn} onCardTap={setSheetCardId} editMode={editMode} onStep={stepRow('spellbook')} />
          <Zone title="Atlas" count={at} need={30} needLabel="30+" groups={atGroups} collapsed={collapsed.has('atlas')} onToggle={() => toggle('atlas')} rarityOn={rarityOn} onCardTap={setSheetCardId} editMode={editMode} onStep={stepRow('atlas')} />
          <Zone title="Collection" count={co} need={coMax} needLabel={String(coMax)} groups={coGroups} collapsed={collapsed.has('collection')} onToggle={() => toggle('collection')} rarityOn={rarityOn} onCardTap={setSheetCardId} editMode={editMode} onStep={stepRow('collection')} />
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
