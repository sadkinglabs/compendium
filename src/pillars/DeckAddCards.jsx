// Scoped add-cards flow - pick a zone (Spellbook/Atlas/Collection), search,
// List ⇄ Card view, per-card +/- steppers (List) or tap-to-add (Card), and a
// Filters & Sort sheet built from catalogue values. Enforces rarity/zone limits.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getPool, getSets, getArtists, changeQty, parseCardQuery, cardMatchesQuery } from '../store/deckRepository.js';
import { ownedMap, subscribeCollection } from '../store/ownedRepository.js';
import { query } from '../store/db.js';
import CardArt from '../components/CardArt.jsx';
import CardSheet from '../components/CardSheet.jsx';
import { ChangeAvatarSheet } from './DeckDashboard.jsx';
import RefineSheet from '../components/RefineSheet.jsx';
import { Frost } from '../components/CollectionCardViews.jsx';
import { ThresholdPips, Chip, ChipRow, SectionLabel, SegTabs, IcList, IcGrid } from '../components/ui.jsx';
import { SwordIcon } from '../components/icons.jsx';
import { thresholdRuns } from '../store/cardArt.js';
import { haptic } from '../native.js';
import { toast } from '../feedback.js';

const RARITY_COLOR = { Ordinary: 'var(--ordinary)', Exceptional: 'var(--exceptional)', Elite: 'var(--elite)', Unique: 'var(--unique)' };
const TILE_GILT = 'linear-gradient(160deg, #e8cd92, rgba(203,167,95,.35) 45%, #c2a05a)';

export default function DeckAddCards({ deckId, q, setQ, filterOpen, setFilterOpen, onChanged, registerCount }) {
  const [view, setView] = useState('list');
  const [rarityOn, setRarityOn] = useState(false);   // colour card names by rarity (Refine toggle)
  const [quickAdd, setQuickAdd] = useState(false);   // inline +/- steppers on list rows (Refine toggle, off by default)
  const [attackOn, setAttackOn] = useState(false);   // show the attack chip on list rows (Refine toggle)
  const [sort, setSort] = useState([]);   // [{key,dir}] priority list (Deckbuilder multi-sort)
  const [els, setEls] = useState([]);
  const [types, setTypes] = useState([]);
  const [rarities, setRarities] = useState([]);
  const [sets, setSets] = useState([]);
  const [multi, setMulti] = useState(false);
  const [thByEl, setThByEl] = useState(() => ({ air: { op: '>=', val: null }, earth: { op: '>=', val: null }, fire: { op: '>=', val: null }, water: { op: '>=', val: null } }));
  const [totalTh, setTotalTh] = useState({ op: '>=', val: null });
  const [costCmp, setCostCmp] = useState({ op: '>=', val: null });
  const [powerCmp, setPowerCmp] = useState({ op: '>=', val: null });
  const [artist, setArtist] = useState('');
  const [ownedOnly, setOwnedOnly] = useState(false);   // filter to cards in My Collection
  const [ownedSet, setOwnedSet] = useState(() => new Set());
  const [setOpts, setSetOpts] = useState([]);
  const [artistOpts, setArtistOpts] = useState([]);
  const [pool, setPool] = useState([]);
  const [qtys, setQtys] = useState({});   // card_id -> total qty across all zones (in-deck badge)
  const qtysRef = useRef({});             // live mirror - rapid taps read this, never a stale closure
  const stepChains = useRef({});          // card_id -> promise chain serialising its DB writes
  const [sheetCardId, setSheetCardId] = useState(null);
  const [avatarOpen, setAvatarOpen] = useState(false);   // Change-avatar from an avatar's card sheet (owner ask)
  const [ignoredScopes, setIgnoredScopes] = useState([]);   // has:/is: are Codex-only - swallowed here, surfaced as a note

  // Gate: the Refine sheet must not open before its Set/Artist options resolve, or
  // those sections mount mid-slide and hitch the open animation (see open= below).
  const [optsLoaded, setOptsLoaded] = useState(false);
  useEffect(() => { Promise.all([getSets().then(setSetOpts), getArtists().then(setArtistOpts)]).then(() => setOptsLoaded(true)); }, []);

  async function loadPool() {
    // Curiosa-style search syntax: bare words narrow by name in SQL; every
    // field token (t:/r:/attack>2/el:ae/…) becomes a clause applied to the
    // pool AFTER the Refine sheet's chips, so the two stack. has:/is: scope
    // tokens are Codex-only; here they're swallowed (never poison the needle)
    // and reported so the user knows they had no effect.
    const parsed = parseCardQuery(q);
    setIgnoredScopes([...parsed.scopes.has.map((v) => `has:${v}`), ...parsed.scopes.is.map((v) => `is:${v}`)]);
    let rows = await getPool({ q: parsed.name, els, types, rarities, sets, multi, thByEl, totalTh, costCmp, powerCmp, artist, sort });
    if (ownedOnly) rows = rows.filter((c) => ownedSet.has(c.card_id));   // only cards in My Collection
    setPool(parsed.clauses.length ? rows.filter((c) => cardMatchesQuery(c, parsed)) : rows);
  }
  async function loadQtys() {
    const rows = await query('SELECT card_id, SUM(quantity) n FROM deck_entries WHERE deck_id=? GROUP BY card_id;', [deckId]);
    const m = {}; for (const r of rows) m[r.card_id] = r.n;
    qtysRef.current = m; setQtys(m);
  }
  useEffect(() => { const t = setTimeout(loadPool, 120); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, els, types, rarities, sets, multi, thByEl, totalTh, costCmp, powerCmp, artist, sort, ownedOnly, ownedSet]);
  useEffect(() => { loadQtys(); /* eslint-disable-next-line */ }, [deckId]);
  // Owned card_ids for the "In my collection" filter; refreshes live with the ledger.
  useEffect(() => {
    const load = () => ownedMap().then((m) => setOwnedSet(new Set(m.keys())));
    load();
    const off = subscribeCollection(load);
    return off;
  }, []);
  const nComp = ['air', 'earth', 'fire', 'water'].filter((el) => thByEl[el].val != null).length + (totalTh.val != null ? 1 : 0) + (costCmp.val != null ? 1 : 0) + (powerCmp.val != null ? 1 : 0);
  const activeCount = els.length + types.length + rarities.length + sets.length + (multi ? 1 : 0) + (artist ? 1 : 0) + (ownedOnly ? 1 : 0) + nComp + (sort.length ? 1 : 0);
  useEffect(() => { registerCount?.(activeCount); }, [activeCount, registerCount]);

  function clearAll() {
    setEls([]); setTypes([]); setRarities([]); setSets([]); setMulti(false); setArtist('');
    setThByEl({ air: { op: '>=', val: null }, earth: { op: '>=', val: null }, fire: { op: '>=', val: null }, water: { op: '>=', val: null } });
    setTotalTh({ op: '>=', val: null }); setCostCmp({ op: '>=', val: null }); setPowerCmp({ op: '>=', val: null }); setOwnedOnly(false); setSort([]);
  }

  const afterChange = () => { loadQtys(); onChanged?.(); };

  // Inline quick-add - optimistic, routes to the card's home zone (Atlas for
  // sites, else Spellbook), same limits/toasts as the CardSheet. Rapid taps are
  // safe: the count reads a live ref (not a render closure) and each card's DB
  // writes run through a serialising promise chain - two concurrent changeQty
  // calls once both saw "no entry" and each INSERTed a duplicate row.
  // `step` and `setSheetCardId` are passed to every EditorRow/EditorTile; keeping
  // them referentially stable (step via useCallback + refs for the render-varying
  // deps) is what lets React.memo skip re-rendering all 250 rows when only the
  // search text changes (App re-renders on each keystroke; the pool doesn't).
  const onChangedRef = useRef(onChanged); onChangedRef.current = onChanged;
  const loadQtysRef = useRef(null); loadQtysRef.current = loadQtys;
  const step = useCallback((c, delta) => {
    const id = c.card_id;
    const zone = c.is_site ? 'atlas' : 'spellbook';
    const cur = qtysRef.current[id] || 0;
    if (cur + delta < 0) return;
    haptic('light');
    qtysRef.current = { ...qtysRef.current, [id]: cur + delta };
    setQtys(qtysRef.current);
    stepChains.current[id] = (stepChains.current[id] || Promise.resolve()).then(async () => {
      const res = await changeQty(deckId, zone, c, delta);
      if (!res.ok) { await loadQtysRef.current(); toast(res.reason || 'Not allowed'); return; }
      onChangedRef.current?.();
    }).catch(() => loadQtysRef.current());
  }, [deckId]);

  return (
    <div className="cx-decks" style={{ padding: '4px 20px 26px', animation: 'cxDeckRise .32s cubic-bezier(.2,.9,.3,1)' }}>
      {/* View toggle - the shared gothic segmented pill, centred; cards auto-route by type. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <SegTabs ariaLabel="Card view" value={view} onChange={setView}
          options={[{ key: 'list', label: 'List', icon: <IcList /> }, { key: 'grid', label: 'Card', icon: <IcGrid /> }]} />
      </div>

      <div style={{ font: "italic 400 13.5px/1.4 var(--f-read)", color: '#8a7a55', marginBottom: 12 }}>
        {pool.length} cards
        {ignoredScopes.length > 0 && (
          <span style={{ opacity: .82 }}> · {ignoredScopes.join(' ')} {ignoredScopes.length > 1 ? 'are Codex filters' : 'is a Codex filter'} - ignored here</span>
        )}
      </div>

      {/* No cap: the whole pool renders. content-visibility on the rows/tiles keeps
          off-screen ones free, so the full library stays smooth without windowing.

          The shared page/section transition (tokens.css .cx-surface-enter), KEYED on the
          segment so List <-> Card arrives exactly like every other surface swap in the app.
          The screen's own entrance (cxDeckRise on the root) is the drill push and stays. */}
      <div key={view} className="cx-surface-enter">
      {view === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
          {pool.map((c) => (
            <EditorTile key={c.card_id} card={c} qty={qtys[c.card_id] || 0} quickAdd={quickAdd}
              onStep={step} onOpen={setSheetCardId} />
          ))}
        </div>
      ) : (
        <div>
          {pool.map((c) => (
            <EditorRow key={c.card_id} card={c} qty={qtys[c.card_id] || 0} quickAdd={quickAdd} rarityOn={rarityOn} attackOn={attackOn}
              onStep={step} onOpen={setSheetCardId} />
          ))}
        </div>
      )}
      </div>

      <CardSheet cardId={sheetCardId} deckId={deckId} onClose={() => setSheetCardId(null)} onChange={afterChange}
        onChangeAvatar={() => setAvatarOpen(true)} />
      {avatarOpen && (
        <ChangeAvatarSheet deckId={deckId} onClose={() => setAvatarOpen(false)}
          onSaved={() => { setAvatarOpen(false); afterChange(); }} />
      )}

      <RefineSheet open={filterOpen && optsLoaded} onClose={() => setFilterOpen(false)} onClear={clearAll}
        eyebrow="REFINE" activeCount={activeCount} ctaLabel={`Show ${pool.length} card${pool.length === 1 ? '' : 's'}`}
        els={els} setEls={setEls} multi={multi} setMulti={setMulti}
        types={types} setTypes={setTypes} rarities={rarities} setRarities={setRarities}
        sets={sets} setSets={setSets} setOpts={setOpts}
        thByEl={thByEl} setThByEl={setThByEl} totalTh={totalTh} setTotalTh={setTotalTh} costCmp={costCmp} setCostCmp={setCostCmp} powerCmp={powerCmp} setPowerCmp={setPowerCmp}
        artist={artist} setArtist={setArtist} artistOpts={artistOpts}
        sort={sort} setSort={setSort}
        summaryLead={ownedOnly ? ['In my collection'] : []}
        leadSections={(
          <div style={{ marginBottom: 22 }}>
            <SectionLabel label="COLLECTION" />
            <ChipRow>
              <Chip label="In my collection" active={ownedOnly} onClick={() => setOwnedOnly((v) => !v)} />
            </ChipRow>
          </div>
        )}
        trailSections={(
          <div style={{ marginBottom: 22 }}>
            <SectionLabel label="LIST DISPLAY" />
            <ChipRow>
              <Chip label="Quick add" active={quickAdd} onClick={() => setQuickAdd(!quickAdd)} />
              <Chip label="Rarity colours" active={rarityOn} onClick={() => setRarityOn(!rarityOn)} />
              <Chip label="Attack stats" active={attackOn} onClick={() => setAttackOn(!attackOn)} />
            </ChipRow>
          </div>
        )} />
    </div>
  );
}

// One catalogue row in the editor's List view - a dense text ledger, no thumb.
// Quantity + frosted steppers sit on the LEFT (deck-builder convention); the
// right carries the PNG threshold icons, the mana cost (purple), and the attack
// chip (only when the attack toggle is on). In-deck rows glow gold + wash.
const EditorRow = React.memo(function EditorRow({ card, qty, quickAdd, rarityOn, attackOn, onStep, onOpen }) {
  const inDeck = qty > 0;
  const runs = thresholdRuns(card);
  const nameColor = rarityOn ? (RARITY_COLOR[card.rarity] || '#d8cebb') : (inDeck ? '#f4ecdc' : '#d8cebb');
  return (
    <div onClick={() => onOpen(card.card_id)} className="cx-row" style={{
      display: 'flex', alignItems: 'center', gap: 12, margin: '0 -20px', padding: '13px 20px',
      borderBottom: '1px solid rgba(74,60,34,.3)', cursor: 'pointer',
      background: inDeck ? 'linear-gradient(90deg, rgba(203,167,95,.05), transparent 70%)' : 'none',
      contentVisibility: 'auto', containIntrinsicSize: 'auto 52px',
    }}>
      {quickAdd ? (
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', flex: 'none' }}>
          <Frost label="Remove one" onClick={() => onStep(card, -1)} disabled={qty === 0}>−</Frost>
          <span style={{ minWidth: 30, textAlign: 'center', font: "600 17px/1 var(--f-display)", color: inDeck ? '#e3c589' : '#5c554b' }}>{inDeck ? `${qty}×` : '-'}</span>
          <Frost label="Add one" onClick={() => onStep(card, 1)}>+</Frost>
        </span>
      ) : (inDeck && <span style={{ flex: 'none', minWidth: 34, font: "600 17px/1 var(--f-display)", color: '#e3c589' }}>{qty}×</span>)}
      <span style={{ flex: 1, minWidth: 0, font: "600 17px/1.2 var(--f-read)", color: nameColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.name}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        {runs.length > 0 && <ThresholdPips runs={runs} size={12} />}
        {card.cost != null && <span title="Mana cost" style={{ font: "600 14px/1 var(--f-display)", color: '#c9a8e8' }}>{card.cost}</span>}
        {attackOn && card.attack != null && (
          <span title="Attack" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: "600 12px/1 var(--f-mono)", color: '#a99a80', border: '1px solid rgba(74,60,34,.7)', borderRadius: 9, padding: '2px 7px' }}><SwordIcon width={11} height={11} />{card.attack}</span>
        )}
      </span>
    </div>
  );
});

// One catalogue tile in the editor's Card view - the art IS the row. In-deck: a
// gilt gradient frame + glow + a gold ×N chip top-left. Quick-add on: a frosted
// stepper dock centred on the bottom edge; otherwise tapping opens the preview.
const EditorTile = React.memo(function EditorTile({ card, qty, quickAdd, onStep, onOpen }) {
  const inDeck = qty > 0;
  const dockBtn = (glyph, onClick, disabled, aria) => (
    <button aria-label={aria} disabled={disabled} onClick={onClick} style={{
      width: 30, height: 30, borderRadius: '50%', flex: 'none', padding: 0,
      border: '1px solid rgba(224,169,177,.28)', background: 'rgba(224,169,177,.12)', color: '#f0c8ce',
      font: "600 17px/1 var(--f-ui)", display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
    }}>{glyph}</button>
  );
  return (
    <div onClick={() => onOpen(card.card_id)} style={{
      position: 'relative', padding: 1, borderRadius: 14, cursor: 'pointer',
      background: inDeck ? TILE_GILT : 'rgba(255,255,255,.1)',
      boxShadow: inDeck ? '0 0 16px rgba(203,167,95,.25)' : 'none',
      contentVisibility: 'auto', containIntrinsicSize: 'auto 240px',
    }}>
      <div style={{ position: 'relative', borderRadius: 13, overflow: 'hidden' }}>
        <CardArt card={card} radius={13} aspect="5/7" />
        {inDeck && (
          <span style={{ position: 'absolute', top: 8, left: 8, font: "700 13px/1 var(--f-display)", color: '#e3c589', background: 'rgba(10,9,8,.88)', border: '1px solid rgba(203,167,95,.5)', borderRadius: 12, padding: '3px 8px' }}>×{qty}</span>
        )}
        {quickAdd && (
          <span onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 2, borderRadius: 22, background: 'rgba(10,9,8,.85)', border: `1px solid ${inDeck ? 'rgba(224,169,177,.28)' : 'rgba(224,169,177,.18)'}` }}>
            {dockBtn('−', () => onStep(card, -1), qty === 0, 'Remove one')}
            <span style={{ minWidth: 22, textAlign: 'center', font: "600 17px/1 var(--f-display)", color: inDeck ? '#efe7d8' : '#8a8175' }}>{qty}</span>
            {dockBtn('+', () => onStep(card, 1), false, 'Add one')}
          </span>
        )}
      </div>
    </div>
  );
});
