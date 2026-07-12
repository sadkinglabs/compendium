// Collection pillar - the card OWNERSHIP ledger. Overview (glance stats + how many
// decks are buildable + recently added) and Cards (search the catalog, one-tap +/-
// to record what you Own or Want). Rows are the binder-style LedgerRow/BinderTile;
// tapping a card opens the shared CollectionCardSheet (ownership steppers +
// Codex hand-off) lifted to the pillar root. Data layer is ownedRepository +
// compareEngine. Accent is ruby, chrome-only.
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getPool, getSets, getArtists, listDecks } from '../store/deckRepository.js';
import { parseQuery, cardMatchesQuery } from '../store/cardQuery.js';
import {
  ownedMap, collectionStats, recentlyAdded, setWanted, wishlistCards, wishlistExportText,
  ownedBySet, qtyForInSet, setOwnedInSet,
  deckBuildabilityBulk, subscribeCollection, importCollectionText, exportListText,
  listCardLists, createList, renameList, duplicateList, deleteList,
  setListEntry, listProgress, listProgressBulk, listCards, listThumbsBulk,
} from '../store/ownedRepository.js';
import { Chip, ChipRow, SectionLabel, SegTabs, IcList, IcGrid, Loading, BottomSheet, BTN_GOLD, BTN_GHOST } from '../components/ui.jsx';
import CollectionCardSheet from '../components/CollectionCardSheet.jsx';
import RefineSheet from '../components/RefineSheet.jsx';
import { LedgerRow, BinderTile, Frost, GILT, GILT_BRIGHT, GLOW, GLOW_BRIGHT } from '../components/CollectionCardViews.jsx';
import CardArt from '../components/CardArt.jsx';
import SearchPill from '../components/SearchPill.jsx';
import MissingSheet from '../components/MissingSheet.jsx';
import { serialChain, ownedChains } from '../components/ownedUi.js';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import { launchScanner } from '../cardScanner.js';
import { haptic } from '../native.js';
import { toast } from '../feedback.js';

// FAB menu-item glyphs (unsized - the fab-menu CSS sizes them), matching the
// Decks library FAB's icon language.
const CameraSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l1.5-2.2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.2" /></svg>;
const TextImportSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="14 3 14 9 20 9" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>;
const EditSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>;
const CopySvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
const TrashSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
const SeekSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.3" y2="16.3" /><line x1="8" y1="11" x2="14" y2="11" /></svg>;

// Where-you-left-off cache. App unmounts the whole pillar when a Codex detail
// opens ("Open in Codex" included), so this survives the round-trip: coming Back
// re-mounts Collection exactly as it was - same view, search, filter, open list,
// even the open card sheet. Module-level = session-scoped, deliberately not
// persisted (a fresh launch starts at Overview).
const session = { view: 'overview', listOpen: null, sheetCard: null, q: '', filter: 'all', sets: [], types: [], rarities: [], els: [] };

export default function Collection({ pillSlot, onOpen, onGoDecks, rev, onChanged }) {
  const [view, setView] = useState(session.view);       // overview | cards | lists
  const [listOpen, setListOpen] = useState(session.listOpen);  // a list row when its detail is open
  // Card-tap detail sheet, lifted to the pillar root so Overview, Cards and
  // ListDetail all share one instance (its ledger writes broadcast via
  // subscribeCollection, so each view refreshes itself).
  const [sheetCard, setSheetCard] = useState(session.sheetCard);
  const [editMode, setEditMode] = useState(false);   // My Collection edit mode: steppers + the + add FAB
  useEffect(() => { session.view = view; session.listOpen = listOpen; session.sheetCard = sheetCard; }, [view, listOpen, sheetCard]);
  const go = (v) => { setListOpen(null); setEditMode(false); setView(v); };
  const goAdd = () => { setListOpen(null); setView('cards'); setEditMode(true); };
  const pills = (
    <div style={{ padding: '0 20px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="cx-scroll" style={{ display: 'flex', gap: 8, flex: 1, minWidth: 0, overflowX: 'auto' }}>
        <Chip label="Overview" active={view === 'overview'} onClick={() => go('overview')} />
        <Chip label="My Collection" active={view === 'cards'} onClick={() => go('cards')} />
        <Chip label="Lists" active={view === 'lists'} onClick={() => go('lists')} />
      </div>
      {view === 'cards' && (
        <button onClick={() => setEditMode((e) => !e)} aria-pressed={editMode}
          style={{ flex: 'none', padding: '7px 15px', borderRadius: 18, cursor: 'pointer', font: "600 13px/1 var(--f-ui)", whiteSpace: 'nowrap',
            background: editMode ? 'linear-gradient(180deg, #d8b872, #b8954f)' : 'rgba(42,33,20,.5)', color: editMode ? '#1a1206' : '#e3c589', border: `1px solid ${editMode ? '#e3c589' : 'rgba(210,88,115,.5)'}` }}>
          {editMode ? 'Done' : '+ Add'}
        </button>
      )}
    </div>
  );
  return (
    <div style={{ padding: '4px 0 26px', animation: 'cxfade .2s ease' }}>
      {pillSlot ? createPortal(pills, pillSlot) : pills}
      {view === 'overview' ? (
        <Overview onGoCards={() => go('cards')} onAddCards={goAdd} onGoDecks={onGoDecks} onGoLists={() => go('lists')} onPeek={setSheetCard}
          onOpenCodex={(id, name) => onOpen('card', id, name)} rev={rev} />
      ) : view === 'cards' ? (
        <Cards onOpen={onOpen} onPeek={setSheetCard} editMode={editMode} onOpenCodex={(id, name) => onOpen('card', id, name)} />
      ) : listOpen ? (
        <ListDetail list={listOpen} onBack={() => setListOpen(null)} onOpen={onOpen} onPeek={setSheetCard} onChanged={onChanged} />
      ) : (
        <ListsIndex onOpenList={setListOpen} rev={rev} />
      )}
      {/* "Open in Codex" deliberately KEEPS the sheet open in state: the pillar
          unmounts for the Codex page, and Back should land right back on this
          sheet - that's where the user left. */}
      <CollectionCardSheet cardId={sheetCard} onClose={() => setSheetCard(null)}
        onOpenCodex={(id, name) => onOpen('card', id, name)} />
    </div>
  );
}

/* ---------------- Overview ---------------- */

function Tile({ label, value, sub, onClick }) {
  return (
    <button onClick={onClick} disabled={!onClick} style={{
      display: 'flex', flexDirection: 'column', gap: 3, padding: '13px 14px', textAlign: 'left',
      background: 'rgba(255,255,255,.02)', border: '1px solid var(--hair-12)', borderRadius: 12,
      cursor: onClick ? 'pointer' : 'default',
    }}>
      <span style={{ font: "700 22px/1 var(--f-mono)", color: 'var(--gold-leaf)' }}>{value}</span>
      <span style={{ font: "600 10px/1.2 var(--f-display)", letterSpacing: '.13em', color: 'var(--ink-muted)' }}>{label}</span>
      {sub && <span style={{ font: "400 10.5px/1.2 var(--f-ui)", color: 'var(--ink-faint)' }}>{sub}</span>}
    </button>
  );
}

// Bulk add via pasted text - the deck "Import from text" format ("4 Card Name"
// lines; headers ignored), imported into the OWNERSHIP ledger (adds copies on
// top of what's recorded, never overwrites).
function ImportTextSheet({ open, onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setText(''); setBusy(false); } }, [open]);
  const go = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await importCollectionText(text);
      toast(r.names
        ? `Added ${r.copies} cop${r.copies === 1 ? 'y' : 'ies'} of ${r.names} card${r.names === 1 ? '' : 's'}${r.unresolved ? ` · ${r.unresolved} unrecognised` : ''}`
        : 'No cards recognised in that text.', r.names ? undefined : { tone: 'danger' });
      if (r.names) onClose();
      else setBusy(false);
    } catch { toast("Couldn't import that text.", { tone: 'danger' }); setBusy(false); }
  };
  return (
    <BottomSheet open={open} title="IMPORT TO COLLECTION" onClose={onClose}>
      <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 12 }}>
        Paste a list of cards - one per line, like <span style={{ color: 'var(--ink-body)', fontFamily: 'var(--f-mono)' }}>4 Wild Boars</span>.
        Deck exports work too. Copies are ADDED to what you already own.
      </div>
      <textarea value={text} autoFocus onChange={(e) => setText(e.target.value)} rows={7}
        placeholder={'4 Wild Boars\n2 Abundance\n1 Grim Reaper…'}
        style={{ ...SHEET_INPUT, height: 'auto', padding: '11px 14px', resize: 'none', font: "400 13.5px/1.5 var(--f-mono)" }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={onClose} style={{ ...BTN_GHOST, flex: 1 }}>Cancel</button>
        <button onClick={go} disabled={!text.trim() || busy} style={{ ...BTN_GOLD, flex: 1, justifyContent: 'center', opacity: text.trim() && !busy ? 1 : 0.5 }}>
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
    </BottomSheet>
  );
}

function Overview({ onGoCards, onGoDecks, onGoLists, onPeek, onOpenCodex, rev }) {
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [deckStat, setDeckStat] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [s, r, decks] = await Promise.all([collectionStats(), recentlyAdded(10), listDecks()]);
      if (!alive) return;
      setStats(s); setRecent(r);
      const reports = await deckBuildabilityBulk(decks.map((d) => d.id));
      let buildable = 0; for (const rep of reports.values()) if (rep.complete && rep.totalRequired > 0) buildable++;
      if (alive) setDeckStat({ buildable, total: decks.length });
    };
    load();
    const off = subscribeCollection(load);
    return () => { alive = false; off(); };
  }, [rev]);
  if (!stats) return <Loading />;
  return (
    <div style={{ padding: '2px 20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
        <Tile label="CARDS OWNED" value={stats.owned} onClick={onGoCards} />
        <Tile label="UNIQUE CARDS" value={stats.unique} onClick={onGoCards} />
        <Tile label="WISHLIST" value={stats.wishlist} sub="cards you want" onClick={onGoLists} />
        <Tile label="DECKS BUILDABLE" value={deckStat ? `${deckStat.buildable}/${deckStat.total}` : '-'} sub="from your collection" onClick={onGoDecks} />
      </div>

      {recent.length > 0 ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '4px 0 8px' }}>
            <span style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.16em', color: 'var(--accent-ruby)' }}>RECENTLY ADDED</span>
            <button onClick={onGoCards} style={{ background: 'none', border: 'none', color: 'var(--ink-muted)', font: "600 12px/1 var(--f-ui)", cursor: 'pointer' }}>All cards ›</button>
          </div>
          {recent.map((c) => (
            <LedgerRow key={c.card_id} card={c} owned={c.qty_owned} foil={c.qty_foil || 0} wanted={c.qty_wanted}
              onPeek={onPeek} />
          ))}
        </>
      ) : (
        <div style={{ padding: '40px 12px', textAlign: 'center' }}>
          <div style={{ font: "400 14.5px/1.6 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', marginBottom: 14 }}>
            Your collection is empty.<br />Add the cards you own to see if your decks are buildable.
          </div>
          <button onClick={onGoCards} style={{
            padding: '11px 20px', borderRadius: 22, cursor: 'pointer', font: "700 13px/1 var(--f-ui)",
            background: 'rgba(18,16,13,.85)', color: 'var(--accent-ruby)', border: '1px solid rgba(210,88,115,.5)',
          }}>Add cards ›</button>
        </div>
      )}

      {/* THE add surface: bulk paste or point the camera. */}
      <Fab variant="lib" label="Add to collection" icon={<FabGlyph kind="add" />} items={[
        { label: 'Add with camera', icon: CameraSvg, onClick: () => launchScanner({ onOpenCard: onOpenCodex, mode: 'collection' }) },
        { label: 'Import from text', icon: TextImportSvg, onClick: () => setImportOpen(true) },
      ]} />
      <ImportTextSheet open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

/* ---------------- Cards (dual-view collection browser) ---------------- */

// The sticky, centered List / Binder segmented control.
function ViewToggle({ view, setView }) {
  // Sits sticky over the scrolling card list, so it needs the frosted-solid
  // backing (same as the Decks docked List/Stats toggle) to stay legible.
  return (
    <SegTabs ariaLabel="Card view" value={view} onChange={setView}
      options={[{ key: 'list', label: 'List', icon: <IcList /> }, { key: 'binder', label: 'Binder', icon: <IcGrid /> }]}
      style={{ background: 'rgba(11,11,13,.82)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: '0 4px 16px rgba(0,0,0,.45)' }} />
  );
}

const VIEW_KEY = 'cx-collection-view';

// The pinned, un-deletable Wishlist is a VIRTUAL list (kind 'wishlist') backed by
// the owned_cards.qty_wanted ledger, not a card_lists row - this sentinel id keeps
// it distinct from real lists while sharing the ListDetail surface.
const WISHLIST_ID = '__wishlist__';
const wishlistRef = () => ({ id: WISHLIST_ID, kind: 'wishlist', name: 'Wishlist' });

// Curiosa's numeric set model (catalog v2). Labels + a fixed display order; the
// trailing '' bucket is legacy / set-unspecified owned rows (variant_slug ''|'foil').
const SET_LABEL = { '001': 'Alpha', '002': 'Beta', '004': 'Arthurian Legends', '005': 'Dragonlord', '006': 'Gothic', '999': 'Promotional', '': 'Unspecified' };
const SET_RANK = { '001': 0, '002': 1, '004': 2, '005': 3, '006': 4, '999': 5, '': 6 };
const setRank = (code) => (code in SET_RANK ? SET_RANK[code] : 5.5);

// My Collection ownership filter (multi-select). Empty = the mode default
// (read view = owned only, add view = everything).
const OWN_OPTS = [['owned', 'Owned'], ['unowned', 'Not owned'], ['wishlist', 'Wishlisted']];
const OWN_LABEL = { owned: 'Owned', unowned: 'Not owned', wishlist: 'Wishlisted' };

// Tappable set header - the canonical Manuscript rubric (gold Cinzel label, fade
// hairline, gold count) with a quiet chevron folding the group. Transparent, flat,
// exactly like the section rubrics everywhere else in the app.
function SetHeader({ name, owned, total, collapsed, onToggle }) {
  return (
    <button onClick={onToggle} aria-expanded={!collapsed}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0 8px', margin: '0 0 4px',
        background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer',
        font: "600 13px/1 var(--f-display)", letterSpacing: '.22em', textTransform: 'uppercase', color: '#cba75f' }}>
      <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,#4a3c22,transparent)' }} />
      <span style={{ flex: 'none', font: "600 15px/1 var(--f-display)", letterSpacing: 'normal', color: '#c9b487' }}>
        <span style={{ color: '#e3c589' }}>{owned}</span> / {total}
      </span>
      <span aria-hidden="true" style={{ flex: 'none', color: '#5c554b', display: 'inline-flex', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .2s' }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </span>
    </button>
  );
}

function Cards({ onOpen, onPeek, editMode, onOpenCodex }) {
  const [view, setView] = useState(() => { try { return localStorage.getItem(VIEW_KEY) === 'binder' ? 'binder' : 'list'; } catch { return 'list'; } });
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode */ } }, [view]);

  // editMode IS the add surface: reveal the WHOLE catalogue (owned + unowned) with
  // steppers so you can start adding immediately. Off = read-only owned collection.
  const [importOpen, setImportOpen] = useState(false);
  const showSteppers = editMode;

  const [q, setQ] = useState(session.q);
  const [sets, setSets] = useState(session.sets);
  const [types, setTypes] = useState(session.types);
  const [rarities, setRarities] = useState(session.rarities);
  const [els, setEls] = useState(session.els);
  useEffect(() => { session.q = q; session.sets = sets; session.types = types; session.rarities = rarities; session.els = els; }, [q, sets, types, rarities, els]);

  // Full rich filters - the shared Refine engine (Card Lists live in Collection,
  // so the comparator granularity earns its place for cube/draft/list building).
  const [multi, setMulti] = useState(false);
  const [thByEl, setThByEl] = useState(() => ({ air: { op: '>=', val: null }, earth: { op: '>=', val: null }, fire: { op: '>=', val: null }, water: { op: '>=', val: null } }));
  const [totalTh, setTotalTh] = useState({ op: '>=', val: null });
  const [costCmp, setCostCmp] = useState({ op: '>=', val: null });
  const [artist, setArtist] = useState('');
  const [sort, setSort] = useState([]);
  const [artistOpts, setArtistOpts] = useState([]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [pool, setPool] = useState(null);
  const [owBySet, setOwBySet] = useState(new Map());  // 'cardId|setCode' -> {owned, foil}
  const [wishSet, setWishSet] = useState(() => new Set());   // card_ids on the wishlist
  const [ownScope, setOwnScope] = useState([]);       // ownership filter: 'owned' | 'unowned' | 'wishlist'
  const ownActive = ownScope.length > 0;
  const toggleOwn = useCallback((v) => setOwnScope((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])), []);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleSet = useCallback((code) => setCollapsed((prev) => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; }), []);
  const [setOpts, setSetOpts] = useState([]);
  useEffect(() => { getSets().then(setSetOpts); getArtists().then(setArtistOpts); }, []);

  async function loadPool() {
    const parsed = parseQuery(q);
    const rows = await getPool({ q: parsed.name, els, types, rarities, sets, multi, thByEl, totalTh, costCmp, artist, sort });
    setPool(parsed.clauses.length ? rows.filter((c) => cardMatchesQuery(c, parsed)) : rows);
  }
  useEffect(() => { const t = setTimeout(loadPool, 130); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, sets, types, rarities, els, multi, thByEl, totalTh, costCmp, artist, sort]);
  const refreshOwnership = useCallback(async () => {
    const [obs, wl] = await Promise.all([ownedBySet(), wishlistCards()]);
    setOwBySet(obs);
    setWishSet(new Set(wl.map((r) => r.card_id)));
  }, []);
  useEffect(() => { refreshOwnership(); }, [refreshOwnership]);
  // Live-refresh with edits made elsewhere (the card sheet's own ledger), debounced
  // so our optimistic steps commit first (see the write path below).
  useEffect(() => {
    let t = null;
    const off = subscribeCollection(() => { clearTimeout(t); t = setTimeout(refreshOwnership, 250); });
    return () => { clearTimeout(t); off(); };
  }, [refreshOwnership]);

  // A stepper edits OWNED for ONE (card, set) printing - the only place owned
  // counts change. Optimistic off the cached map; the WRITE re-reads qtyForInSet
  // inside the app-wide per-(card,set) chain so overlapping steps can't clobber.
  const stepSet = useCallback((cardId, set, delta) => {
    const key = cardId + '|' + set;
    setOwBySet((prev) => {
      const cur = prev.get(key) || { owned: 0, foil: 0 };
      const next = { ...cur, owned: Math.max(0, cur.owned + delta) };
      const m = new Map(prev); m.set(key, next);
      return m;
    });
    serialChain(ownedChains, key, async () => {
      const cur = await qtyForInSet(cardId, set);
      return setOwnedInSet(cardId, set, Math.max(0, cur.owned + delta));
    });
  }, []);

  // Per-set ownership: expand every catalogue card into one row per set it was
  // printed in. Read view keeps only (card, set) pairs you own; add mode shows
  // every printing so anything is addable. Rows are grouped + collapsible by set.
  const setTotals = useMemo(() => {
    const t = new Map();
    for (const c of (pool || [])) for (const s of (c._sets || [])) if (s.code) t.set(s.code, (t.get(s.code) || 0) + 1);
    return t;
  }, [pool]);

  // True owned-per-set (all owned rows, independent of the row filter) - drives the
  // header's owned/total so it stays honest even under a "Not owned" filter.
  const ownedPerSet = useMemo(() => {
    const m = new Map();
    for (const [k, v] of owBySet) {
      if ((v.owned || 0) + (v.foil || 0) === 0) continue;
      const code = k.slice(k.lastIndexOf('|') + 1);
      m.set(code, (m.get(code) || 0) + 1);
    }
    return m;
  }, [owBySet]);

  const groups = useMemo(() => {
    const g = new Map();   // code -> { code, name, rows:[{card,set,owned,foil}] }
    const push = (code, name, row) => {
      let x = g.get(code);
      if (!x) { x = { code, name: name || SET_LABEL[code] || code, rows: [] }; g.set(code, x); }
      x.rows.push(row);
    };
    // Ownership filter: when set it decides what shows (owned / not-owned / wishlisted
    // union); when empty, fall back to the mode default (read = owned only, add = all).
    const matches = (isOwned, isWish) => {
      if (!ownActive) return editMode ? true : isOwned;
      return (ownScope.includes('owned') && isOwned)
        || (ownScope.includes('unowned') && !isOwned)
        || (ownScope.includes('wishlist') && isWish);
    };
    for (const c of (pool || [])) {
      const isWish = wishSet.has(c.card_id);
      for (const s of (c._sets || [])) {
        if (!s.code) continue;
        // The SET filter is per-PRINTING here: a card printed in both Alpha and Beta,
        // filtered to Beta, shows only its Beta row (not the Alpha one too).
        if (sets.length && !sets.includes(s.name)) continue;
        const oc = owBySet.get(c.card_id + '|' + s.code);
        const owned = oc?.owned || 0, foil = oc?.foil || 0;
        if (!matches(owned + foil > 0, isWish)) continue;
        push(s.code, s.name, { card: c, set: s.code, owned, foil });
      }
    }
    // Legacy / set-unspecified owned rows (variant_slug ''|'foil' -> empty set). These
    // are always owned, so they surface in the default read view or an owned/wishlist
    // filter - but never when the user has narrowed to specific SET(s), since '' is none.
    const wantLegacy = sets.length === 0 && (ownActive ? (ownScope.includes('owned') || ownScope.includes('wishlist')) : !editMode);
    if (wantLegacy) {
      const byId = new Map((pool || []).map((c) => [c.card_id, c]));
      for (const [k, v] of owBySet) {
        const i = k.lastIndexOf('|');
        if (k.slice(i + 1) !== '') continue;
        if ((v.owned || 0) + (v.foil || 0) === 0) continue;
        const card = byId.get(k.slice(0, i));
        if (!card) continue;
        if (ownActive && !(ownScope.includes('owned') || (ownScope.includes('wishlist') && wishSet.has(card.card_id)))) continue;
        push('', 'Unspecified', { card, set: '', owned: v.owned || 0, foil: v.foil || 0 });
      }
    }
    return [...g.values()].sort((a, b) => setRank(a.code) - setRank(b.code));
  }, [pool, owBySet, wishSet, editMode, ownScope, ownActive, sets]);

  const totalRows = useMemo(() => groups.reduce((n, gr) => n + gr.rows.length, 0), [groups]);

  const richComp = ['air', 'earth', 'fire', 'water'].filter((el) => thByEl[el].val != null).length + (totalTh.val != null ? 1 : 0) + (costCmp.val != null ? 1 : 0);
  const activeCount = ownScope.length + sets.length + types.length + rarities.length + els.length + (multi ? 1 : 0) + (artist ? 1 : 0) + richComp + (sort.length ? 1 : 0);
  const clearAll = () => {
    setOwnScope([]); setSets([]); setTypes([]); setRarities([]); setEls([]); setMulti(false); setArtist('');
    setThByEl({ air: { op: '>=', val: null }, earth: { op: '>=', val: null }, fire: { op: '>=', val: null }, water: { op: '>=', val: null } });
    setTotalTh({ op: '>=', val: null }); setCostCmp({ op: '>=', val: null }); setSort([]);
  };

  return (
    <div style={{ padding: '0 20px 150px' }}>
      {/* Sticky centered view toggle - never scrolls away. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 6, display: 'flex', justifyContent: 'center', padding: '6px 0 12px', background: 'transparent' }}>
        <ViewToggle view={view} setView={setView} />
      </div>

      {pool == null ? <Loading /> : (
        <>
          <div style={{ font: "400 11.5px/1 var(--f-ui)", color: 'var(--ink-faint)', textAlign: 'right', margin: '0 2px 8px' }}>
            {totalRows} card{totalRows === 1 ? '' : 's'}{totalRows > 250 ? ' · showing 250' : ''}
          </div>
          {totalRows === 0 ? (
            <div style={{ padding: '48px 0', textAlign: 'center', whiteSpace: 'pre-line', font: "400 15px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>
              {editMode ? 'No cards match those filters.'
                : (activeCount || q) ? 'No owned cards match those filters.'
                  : 'Your collection is empty.\nTap + Add to record what you own.'}
            </div>
          ) : (() => {
            // Render groups in set order, budgeting 250 rows total across all
            // open groups so a huge add-mode catalogue stays responsive.
            let budget = 250;
            return groups.map((grp) => {
              const isOpen = !collapsed.has(grp.code);
              const ownedCount = ownedPerSet.get(grp.code) || 0;
              const total = setTotals.get(grp.code) || grp.rows.length;
              const rows = isOpen ? grp.rows.slice(0, budget) : [];
              budget -= rows.length;
              return (
                <div key={grp.code || 'unspec'}>
                  <SetHeader name={grp.name} owned={ownedCount} total={total} collapsed={!isOpen} onToggle={() => toggleSet(grp.code)} />
                  {isOpen && (view === 'binder' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                      {rows.map((r) => (
                        <BinderTile key={r.card.card_id + '|' + r.set} card={r.card} set={r.set} owned={r.owned} foil={r.foil}
                          onStep={showSteppers ? stepSet : undefined} onPeek={onPeek} />
                      ))}
                    </div>
                  ) : (
                    rows.map((r) => (
                      <LedgerRow key={r.card.card_id + '|' + r.set} card={r.card} set={r.set} setLabel={grp.name}
                        owned={r.owned} foil={r.foil} value={r.owned + r.foil}
                        onStep={showSteppers ? stepSet : undefined} onPeek={onPeek} />
                    ))
                  ))}
                </div>
              );
            });
          })()}
        </>
      )}

      {/* Bottom search - the one shared dock pill (portals beside the FAB). */}
      <SearchPill value={q} onChange={setQ} onClear={() => setQ('')} placeholder={editMode ? 'Search the library…' : 'Search your collection…'} ariaLabel="Search cards" />

      {/* Filter is its own FAB and never moves - the docked spot beside the search
          bar, in BOTH modes. Adding by search happens naturally in that bar, so in
          edit mode a SECOND FAB rises above it with just the tools search can't do:
          camera + text import. The one place in the app with two stacked FABs. */}
      <Fab variant="deck" label="Filter cards" icon={<FabGlyph kind="filters" />} badge={activeCount} onClick={() => setFilterOpen(true)} />
      {editMode && (
        <Fab variant="lib" label="Add tools" icon={<FabGlyph kind="add" />} className="fab-stacked" items={[
          { label: 'Add with camera', icon: CameraSvg, onClick: () => launchScanner({ onOpenCard: onOpenCodex, mode: 'collection' }) },
          { label: 'Import from text', icon: TextImportSvg, onClick: () => setImportOpen(true) },
        ]} />
      )}
      <ImportTextSheet open={importOpen} onClose={() => setImportOpen(false)} />

      <RefineSheet open={filterOpen} onClose={() => setFilterOpen(false)} onClear={clearAll}
        eyebrow="FILTERS" activeCount={activeCount} ctaLabel={`Show ${totalRows} card${totalRows === 1 ? '' : 's'}`}
        summaryLead={ownScope.map((s) => OWN_LABEL[s])}
        leadSections={(
          <div style={{ marginBottom: 22 }}>
            <SectionLabel label="OWNERSHIP" count={ownScope.length || undefined} />
            <ChipRow>
              {OWN_OPTS.map(([k, l]) => <Chip key={k} label={l} active={ownScope.includes(k)} onClick={() => toggleOwn(k)} />)}
            </ChipRow>
          </div>
        )}
        els={els} setEls={setEls} multi={multi} setMulti={setMulti}
        types={types} setTypes={setTypes} rarities={rarities} setRarities={setRarities}
        sets={sets} setSets={setSets} setOpts={setOpts}
        thByEl={thByEl} setThByEl={setThByEl} totalTh={totalTh} setTotalTh={setTotalTh} costCmp={costCmp} setCostCmp={setCostCmp}
        artist={artist} setArtist={setArtist} artistOpts={artistOpts}
        sort={sort} setSort={setSort} />
    </div>
  );
}

/* ---------------- Lists (Wanted goals + custom Card Lists) ---------------- */

const SHEET_INPUT = {
  width: '100%', height: 44, boxSizing: 'border-box', background: 'var(--surface-well)',
  border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px',
  color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)",
};

function Section({ title, hint, onAdd, children }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 5px' }}>
        <span style={{ font: "600 14px/1 var(--f-display)", letterSpacing: '.22em', color: '#c76d85', textTransform: 'uppercase' }}>{title}</span>
        <button onClick={onAdd} style={{ background: 'none', border: 'none', color: '#e3c589', font: "600 16px/1 var(--f-display)", cursor: 'pointer', padding: '2px 0' }}>+ New</button>
      </div>
      {hint && <div style={{ font: "italic 400 15.5px/1.4 var(--f-read)", color: '#8a8175', marginBottom: 14 }}>{hint}</div>}
      {children}
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ padding: '6px 0 4px', font: "italic 400 15px/1.5 var(--f-read)", color: '#8a8175' }}>{text}</div>;
}

// Export a list as flat "qty name" text - the Curiosa deck-export format, so it
// round-trips into Curiosa, Decks > Import from text, or Collection's own bulk
// import on another profile/device.
function ExportListSheet({ open, fetchText, listName, onClose }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    if (!open || !fetchText) return;
    let alive = true;
    setText(null);
    Promise.resolve(fetchText()).then((t) => alive && setText(t));
    return () => { alive = false; };
  }, [open, fetchText]);
  async function copy() {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
    catch { toast('Copy failed', { tone: 'danger' }); }
  }
  return (
    <BottomSheet open={open} title="EXPORT LIST" onClose={onClose}>
      <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 12 }}>
        “{listName}” as plain text - pastes into Curiosa, a deck’s Import from text, or another Collection.
      </div>
      {text == null ? <Loading /> : (
        <textarea readOnly value={text || 'This list is empty.'} rows={8} onFocus={(e) => e.target.select()}
          style={{ ...SHEET_INPUT, height: 'auto', padding: '11px 14px', resize: 'none', font: "400 13.5px/1.5 var(--f-mono)" }} />
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={onClose} style={{ ...BTN_GHOST, flex: 1 }}>Close</button>
        <button onClick={copy} disabled={!text} style={{ ...BTN_GOLD, flex: 1, justifyContent: 'center', opacity: text ? 1 : 0.5 }}>Copy to clipboard</button>
      </div>
    </BottomSheet>
  );
}

// A held-hand fan of the list's first 3 cards (50px 5:7, rotated, overlapping);
// the top card gets a gold edge. Empty list -> a single dashed empty sleeve.
function ListFan({ cards = [] }) {
  const ROT = [-8, 2, 10];
  const LEFT = [0, 17, 34];
  const shown = cards.slice(0, 3);
  return (
    <div style={{ position: 'relative', width: 88, height: 84, flex: 'none' }} aria-hidden="true">
      {shown.length === 0 ? (
        <div style={{ position: 'absolute', left: 19, bottom: 7, width: 50, aspectRatio: '5 / 7', borderRadius: 6, border: '1px dashed rgba(203,167,95,.22)' }} />
      ) : shown.map((c, i) => {
        const isTop = i === shown.length - 1;
        return (
          <div key={c.card_id + i} style={{
            position: 'absolute', left: LEFT[i], bottom: 7, width: 50, zIndex: i,
            transformOrigin: '50% 100%', transform: `rotate(${ROT[i]}deg)`,
            borderRadius: 6, overflow: 'hidden', boxShadow: '0 4px 10px rgba(0,0,0,.5)',
            border: `1px solid ${isTop ? 'rgba(227,197,137,.6)' : 'rgba(255,255,255,.1)'}`,
          }}>
            <CardArt card={c} radius={5} aspect="5/7" />
          </div>
        );
      })}
    </div>
  );
}

// A list card: a fan of its cards on the left, name + tally on the right, and -
// for wanted lists - a progress bar with a "N missing / View missing" footer or a
// COMPLETE chip. Flat (no gradients); the tally + bar carry the old percentage.
function ListRowCard({ list, progress, thumbs, onClick, onViewMissing }) {
  const wanted = list.kind === 'wanted';
  const p = wanted ? progress : null;
  const hasBar = !!p && p.totalRequired > 0;
  const complete = hasBar && p.complete;
  const border = complete ? 'rgba(227,197,137,.45)' : wanted ? 'rgba(199,109,133,.32)' : 'rgba(203,167,95,.2)';
  const bg = complete ? 'rgba(203,167,95,.05)' : wanted ? 'rgba(199,109,133,.04)' : 'rgba(203,167,95,.03)';
  const barFill = complete ? '#e3c589' : '#e0899e';

  return (
    <div onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ display: 'flex', gap: 14, alignItems: 'center', width: '100%', boxSizing: 'border-box', cursor: 'pointer', marginBottom: 12, padding: '16px 20px', borderRadius: 19, border: `1px solid ${border}`, background: bg }}>
      <ListFan cards={thumbs} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title + tally. */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ minWidth: 0, font: "700 21px/1.15 var(--f-display)", color: complete ? '#f4ecdc' : '#efe7d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</span>
          {wanted ? (
            <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>
              <span style={{ font: "600 24px/1 var(--f-display)", color: complete ? '#e3c589' : '#e0899e' }}>{p ? p.totalHave : 0}</span>
              <span style={{ font: "400 15px/1 var(--f-read)", color: '#8a8175' }}>/{p ? p.totalRequired : 0}</span>
            </span>
          ) : (
            <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>
              <span style={{ font: "600 22px/1 var(--f-display)", color: '#efe7d8' }}>{list.entryCount}</span>
              <span style={{ font: "400 14px/1 var(--f-read)", color: '#8a8175' }}> card{list.entryCount === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>

        {/* Card list: description. */}
        {!wanted && list.description ? (
          <div style={{ font: "400 15px/1.4 var(--f-read)", color: '#8a8175', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.description}</div>
        ) : null}

        {/* Wanted: progress bar + footer. */}
        {wanted && hasBar && (
          <>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.06)', overflow: 'hidden', marginTop: 12 }}>
              <div style={{ height: '100%', width: `${p.percent}%`, background: barFill, borderRadius: 3, transition: 'width .3s ease' }} />
            </div>
            {complete ? (
              <div style={{ marginTop: 11 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 11, background: 'rgba(99,201,163,.1)', border: '1px solid rgba(99,201,163,.35)' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#63c9a3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  <span style={{ font: "600 9.5px/1 var(--f-display)", letterSpacing: '.14em', color: '#63c9a3' }}>COMPLETE</span>
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 9 }}>
                <span style={{ font: "400 13px/1 var(--f-read)", color: '#8a8175' }}>{p.totalMissing} missing</span>
                <button onClick={(e) => { e.stopPropagation(); onViewMissing?.(); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', font: "600 13px/1 var(--f-ui)", color: '#c76d85', padding: 0 }}>View missing ›</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ListNameSheet({ open, title, kind, initialName = '', initialDesc = '', submitLabel = 'Create', onClose, onSubmit }) {
  const [name, setName] = useState(initialName);
  const [desc, setDesc] = useState(initialDesc);
  useEffect(() => { if (open) { setName(initialName); setDesc(initialDesc); } /* eslint-disable-next-line */ }, [open]);
  const go = () => { const nm = name.trim(); if (!nm) return; onSubmit(nm, desc.trim()); };
  const hint = kind === 'wanted'
    ? 'A named goal - Collection tracks how close you are as you record the cards you own.'
    : kind === 'custom' ? 'A custom grouping - a trade binder, a cube, cards to sell.' : '';
  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      {hint && <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 14 }}>{hint}</div>}
      <input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        placeholder={kind === 'wanted' ? 'e.g. Beta staples I still need' : 'Name your list…'} style={SHEET_INPUT} />
      <input value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        placeholder="Description (optional)…" style={{ ...SHEET_INPUT, marginTop: 10, font: "400 13.5px/1 var(--f-read)" }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={onClose} style={{ ...BTN_GHOST, flex: 1 }}>Cancel</button>
        <button onClick={go} disabled={!name.trim()} style={{ ...BTN_GOLD, flex: 1, justifyContent: 'center', opacity: name.trim() ? 1 : 0.5 }}>{submitLabel}</button>
      </div>
    </BottomSheet>
  );
}

// In-list add picker: a searchable catalogue (rich token search, e:water set:beta)
// where each row carries a +Add / stepper reflecting how many are already on this
// list (or the Wishlist). Two ways to add: tap a row's +Add for single, precise
// edits (commits live through onStep(card, delta)), or hit Select to enter
// multi-select - tap rows to check them, then one "Add N" bar commits them all at
// +1. Shared by every list and the Wishlist.
function AddCardsSheet({ open, onClose, title, hint, membership, onStep }) {
  const [q, setQ] = useState('');
  const [pool, setPool] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Map());   // card_id -> full card row (kept for the batch commit)
  useEffect(() => { if (open) { setQ(''); setPool(null); setSelectMode(false); setSelected(new Map()); } }, [open]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(async () => {
      const parsed = parseQuery(q);
      const rows = await getPool({ q: parsed.name });
      const filtered = parsed.clauses.length ? rows.filter((c) => cardMatchesQuery(c, parsed)) : rows;
      if (alive) setPool(filtered);
    }, 130);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open]);

  const toggleSel = (c) => setSelected((prev) => { const m = new Map(prev); m.has(c.card_id) ? m.delete(c.card_id) : m.set(c.card_id, c); return m; });
  const commit = () => {
    const cards = [...selected.values()];
    if (!cards.length) return;
    haptic('light');
    for (const c of cards) onStep(c, 1);   // distinct ids; each serialises on its own chain
    toast(`Added ${cards.length} card${cards.length === 1 ? '' : 's'}`);
    setSelected(new Map());
    setSelectMode(false);
  };

  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      {hint && !selectMode && <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 12 }}>{hint}</div>}
      <input value={q} autoFocus onChange={(e) => setQ(e.target.value)}
        placeholder="Search the library - e:water set:beta…" style={{ ...SHEET_INPUT, height: 46 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '12px 2px 2px' }}>
        <span style={{ font: "italic 400 12.5px/1.4 var(--f-read)", color: '#8a7a55' }}>
          {selectMode ? `${selected.size} selected`
            : pool == null ? 'Searching…' : `${pool.length} card${pool.length === 1 ? '' : 's'}${pool.length > 200 ? ' · showing 200' : ''}`}
        </span>
        <button onClick={() => { setSelectMode((s) => !s); setSelected(new Map()); }} aria-pressed={selectMode}
          style={{ flex: 'none', padding: '6px 14px', borderRadius: 16, cursor: 'pointer', font: "600 12.5px/1 var(--f-ui)", whiteSpace: 'nowrap',
            background: selectMode ? 'rgba(210,88,115,.16)' : 'rgba(42,33,20,.5)', color: selectMode ? '#f0c8ce' : '#e3c589', border: `1px solid ${selectMode ? 'rgba(210,88,115,.5)' : 'rgba(210,88,115,.5)'}` }}>
          {selectMode ? 'Cancel' : 'Select'}
        </button>
      </div>
      {pool == null ? <Loading /> : pool.slice(0, 200).map((c) => {
        const inList = membership.get(c.card_id) || 0;
        const setName = listSetName(c);
        const isSel = selected.has(c.card_id);
        return (
          <div key={c.card_id} onClick={selectMode ? () => toggleSel(c) : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--hair-12)', cursor: selectMode ? 'pointer' : 'default' }}>
            <span style={{ width: 42, flex: 'none' }}><CardArt card={c} radius={6} aspect="5/7" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "600 15px/1.2 var(--f-read)", color: inList > 0 ? '#f4ecdc' : '#efe7d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                {setName && <span style={listSetPill}>{setName}</span>}
                {inList > 0 && <span style={{ font: "600 10.5px/1 var(--f-mono)", color: '#e3c589' }}>on list ×{inList}</span>}
              </div>
            </div>
            {selectMode ? (
              <span aria-hidden="true" style={{ flex: 'none', width: 26, height: 26, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: isSel ? 'linear-gradient(180deg, #d8b872, #b8954f)' : 'transparent', border: `1px solid ${isSel ? '#e3c589' : 'rgba(203,167,95,.4)'}` }}>
                {isSel && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#1a1206" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
              </span>
            ) : inList > 0 ? (
              <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center' }}>
                <Frost label="One fewer" onClick={() => onStep(c, -1)}>−</Frost>
                <span style={{ minWidth: 22, textAlign: 'center', font: "600 16px/1 var(--f-display)", color: '#efe7d8' }}>{inList}</span>
                <Frost label="One more" onClick={() => onStep(c, 1)}>+</Frost>
              </span>
            ) : (
              <button onClick={() => onStep(c, 1)} aria-label={`Add ${c.name}`}
                style={{ flex: 'none', minHeight: 40, padding: '0 15px', borderRadius: 999, cursor: 'pointer', font: "600 12.5px/1 var(--f-display)", letterSpacing: '.04em', color: '#f0c8ce', background: 'rgba(224,169,177,.12)', border: '1px solid rgba(224,169,177,.28)' }}>+ Add</button>
            )}
          </div>
        );
      })}
      {/* Running batch bar - sticks to the sheet's scroll floor while you check rows. */}
      {selectMode && selected.size > 0 && (
        <div style={{ position: 'sticky', bottom: 0, marginTop: 8, padding: '12px 0 2px', background: 'linear-gradient(0deg, #0b0806 68%, transparent)' }}>
          <button onClick={commit} style={{ ...BTN_GOLD, width: '100%', justifyContent: 'center' }}>
            Add {selected.size} card{selected.size === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

// The pinned Wishlist row - a distinct gold-framed card above the user's own
// lists, showing its want-tally and a fan of the first few wanted cards. Always
// present, never renamed or deleted; taps into the shared ListDetail surface.
function WishlistCard({ summary, onClick }) {
  const empty = !summary || summary.count === 0;
  return (
    <div onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ display: 'flex', gap: 14, alignItems: 'center', width: '100%', boxSizing: 'border-box', cursor: 'pointer', marginBottom: 22, padding: '16px 20px', borderRadius: 19, border: '1px solid rgba(227,197,137,.42)', background: 'linear-gradient(180deg, rgba(203,167,95,.07), rgba(203,167,95,.02))' }}>
      <ListFan cards={summary?.thumbs || []} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#e3c589" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
          <span style={{ minWidth: 0, font: "700 21px/1.15 var(--f-display)", color: '#f4ecdc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Wishlist</span>
        </div>
        <div style={{ font: "400 14px/1.4 var(--f-read)", color: '#8a8175', marginTop: 6 }}>
          {empty ? 'Cards you want - add from any card or here' : `${summary.count} card${summary.count === 1 ? '' : 's'} wanted`}
        </div>
      </div>
      {!empty && (
        <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>
          <span style={{ font: "600 24px/1 var(--f-display)", color: '#e3c589' }}>{summary.total}</span>
        </span>
      )}
    </div>
  );
}

function ListsIndex({ onOpenList, rev }) {
  const [lists, setLists] = useState(null);
  const [progress, setProgress] = useState(new Map());
  const [thumbs, setThumbs] = useState(new Map());
  const [wl, setWl] = useState(null);            // pinned Wishlist summary
  const [create, setCreate] = useState(null);   // 'wanted' | 'custom' | null
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [all, wlRows] = await Promise.all([listCardLists(), wishlistCards()]);
      if (!alive) return;
      setLists(all);
      setWl({ count: wlRows.length, total: wlRows.reduce((n, r) => n + (r.quantity || 0), 0), thumbs: wlRows.slice(0, 3) });
      const wantedIds = all.filter((l) => l.kind === 'wanted').map((l) => l.id);
      const [pr, th] = await Promise.all([
        wantedIds.length ? listProgressBulk(wantedIds) : new Map(),
        all.length ? listThumbsBulk(all.map((l) => l.id)) : new Map(),
      ]);
      if (alive) { setProgress(pr); setThumbs(th); }
    };
    load();
    const off = subscribeCollection(load);
    return () => { alive = false; off(); };
  }, [rev]);

  if (lists == null) return <Loading />;
  const wanted = lists.filter((l) => l.kind === 'wanted');
  const custom = lists.filter((l) => l.kind === 'custom');
  const card = (l) => (
    <ListRowCard key={l.id} list={l} progress={progress.get(l.id)} thumbs={thumbs.get(l.id)}
      onClick={() => onOpenList(l)} onViewMissing={() => onOpenList({ ...l, openMissing: true })} />
  );
  return (
    <div style={{ padding: '2px 20px' }}>
      <WishlistCard summary={wl} onClick={() => onOpenList(wishlistRef())} />
      <Section title="Wanted Lists" hint="Named goals - Collection tracks your progress as you acquire cards." onAdd={() => setCreate('wanted')}>
        {wanted.length ? wanted.map(card) : <Empty text="No wanted lists yet - set a goal and watch it fill in." />}
      </Section>
      <Section title="Card Lists" hint="Custom groupings - a trade binder, a cube, cards to sell." onAdd={() => setCreate('custom')}>
        {custom.length ? custom.map(card) : <Empty text="No card lists yet." />}
      </Section>
      <ListNameSheet open={!!create} kind={create}
        title={create === 'wanted' ? 'NEW WANTED LIST' : 'NEW CARD LIST'} submitLabel="Create list"
        onClose={() => setCreate(null)}
        onSubmit={async (nm, desc) => {
          const kind = create;
          const id = await createList(kind, nm, desc);
          setCreate(null);
          onOpenList({ id, kind, name: nm, description: desc, entryCount: 0 });
        }} />
    </div>
  );
}

// The list-detail set pill (quiet gold capsule, matches the binder rail).
const listSetPill = {
  display: 'inline-block', font: "600 9.5px/1 var(--f-display)", letterSpacing: '.1em',
  textTransform: 'uppercase', color: 'var(--gold-leaf)', padding: '4px 9px',
  borderRadius: 999, border: '1px solid var(--hair-16)', background: 'rgba(10,9,7,.5)',
};
function listSetName(card) {
  try { const s = JSON.parse(card?.sets || '[]'); return (Array.isArray(s) && s[0]?.name) || null; }
  catch { return null; }
}

// One card on a list detail. A full-width hairline row (never a rounded card): a
// gilt-framed 5:7 thumb that lights up as you own copies toward the goal, the
// name + set, ONE status line ("X of Y wanted", or a teal COMPLETE once met), and
// frosted -/+ steppers that edit the GOAL - the wanted quantity. The owned count
// is read-only, derived live from the collection, so the row fills in on its own
// as you acquire cards. Custom lists reuse the row with a "COPIES" stepper.
function ListCardRow({ card, owned, target, isWanted, editable, onStep, onPeek }) {
  const goalMet = isWanted && target > 0 && owned >= target;
  const ownedAny = owned >= 1;
  const setName = listSetName(card);
  return (
    <div
      onClick={onPeek} className="cx-row"
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', margin: '0 -20px',
        borderBottom: '1px solid rgba(74,60,34,.3)', cursor: 'pointer',
        background: goalMet ? 'linear-gradient(90deg, rgba(203,167,95,.05), transparent 70%)' : 'none',
      }}
    >
      {/* 5:7 thumb: gilt frame brightens as owned reaches the goal; dark + dimmed
          when you own none, so the list visibly fills in as the collection grows. */}
      <span style={{
        width: 64, flex: 'none', position: 'relative', borderRadius: 9,
        padding: ownedAny ? 1 : 0,
        background: ownedAny ? (goalMet ? GILT_BRIGHT : GILT) : 'none',
        boxShadow: ownedAny ? (goalMet ? GLOW_BRIGHT : GLOW) : 'none',
      }}>
        <span style={{ display: 'block', position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
          <CardArt card={card} radius={8} aspect="5/7" />
          {!ownedAny && <span style={{ position: 'absolute', inset: 0, background: 'rgba(6,5,5,.62)' }} />}
        </span>
        {goalMet && (
          <span title={`${owned} owned`} style={{
            position: 'absolute', bottom: -6, right: -6, minWidth: 21, height: 21, padding: '0 6px',
            borderRadius: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            font: "700 12px/1 var(--f-display)", color: '#1a1206',
            background: 'linear-gradient(180deg, #d8b872, #b8954f)', border: '1px solid rgba(16,10,3,.4)',
            boxShadow: '0 1px 4px rgba(0,0,0,.5)',
          }}>×{owned}</span>
        )}
      </span>

      {/* Name / set + ONE status line. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          font: "600 18px/1.2 var(--f-read)", color: goalMet ? '#f4ecdc' : '#efe7d8',
        }}>{card.name}</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 7 }}>
          {setName && <span style={listSetPill}>{setName}</span>}
          {goalMet ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#63c9a3', flex: 'none' }} />
              <span style={{ font: "600 10.5px/1 var(--f-display)", letterSpacing: '.16em', color: '#63c9a3' }}>COMPLETE</span>
            </span>
          ) : isWanted ? (
            <span>
              <span style={{ font: "600 15px/1 var(--f-display)", color: '#e0899e' }}>{owned}</span>
              <span style={{ font: "400 12.5px/1 var(--f-read)", color: '#8a8175' }}> of {target} wanted</span>
            </span>
          ) : (
            <span>
              <span style={{ font: "600 15px/1 var(--f-display)", color: ownedAny ? '#e3c589' : '#8a8175' }}>{owned}</span>
              <span style={{ font: "400 12.5px/1 var(--f-read)", color: '#8a8175' }}> owned</span>
            </span>
          )}
        </span>
      </div>

      {/* Right rail. Edit mode: frosted -/+ on the GOAL (wanted qty / copies) - the
          WANT/COPIES label marks it as goal-editing, distinct from the unlabeled
          owned-editing on the Cards tab. Read mode: the same figure, static. */}
      {editable ? (
        <span onClick={(e) => e.stopPropagation()} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Frost label={isWanted ? 'Want one fewer' : 'One fewer copy'} onClick={() => onStep(-1)}>−</Frost>
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 30 }}>
            <span style={{ font: "600 8.5px/1 var(--f-display)", letterSpacing: '.18em', color: '#c76d85' }}>{isWanted ? 'WANT' : 'COPIES'}</span>
            <span style={{ font: "600 19px/1 var(--f-display)", color: '#efe7d8', marginTop: 4 }}>{target}</span>
          </span>
          <Frost label={isWanted ? 'Want one more' : 'One more copy'} onClick={() => onStep(1)}>+</Frost>
        </span>
      ) : (
        <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 44 }}>
          <span style={{ font: "600 8.5px/1 var(--f-display)", letterSpacing: '.18em', color: '#8a7a55' }}>{isWanted ? 'WANT' : 'COPIES'}</span>
          <span style={{ font: "600 19px/1 var(--f-display)", color: '#c9bfa8', marginTop: 4 }}>{target}</span>
        </span>
      )}
    </div>
  );
}

function ListDetail({ list, onBack, onOpen, onPeek, onChanged }) {
  const isWishlist = list.kind === 'wishlist';   // the virtual, un-deletable Wishlist (qty_wanted ledger)
  const isWanted = list.kind === 'wanted';
  const showProgress = isWanted || isWishlist;   // owned-vs-goal bar + "X of Y wanted" figure
  const [meta, setMeta] = useState(list);
  const [loaded, setLoaded] = useState(false);     // initial fetch done
  const [editing, setEditing] = useState(false);   // read-first: steppers appear only in edit mode
  const [addOpen, setAddOpen] = useState(false);   // in-list add picker
  const [ownQty, setOwnQty] = useState(new Map()); // card_id -> owned qty (live)
  const [qty, setQty] = useState(new Map());       // card_id -> goal qty (optimistic)
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [rename, setRename] = useState(false);
  const [missing, setMissing] = useState(null);    // report for MissingSheet
  const [removeCard, setRemoveCard] = useState(null); // card pending removal confirm
  const chains = useRef({});
  const cardIndex = useRef(new Map());             // card_id -> full card row

  const load = async () => {
    setLoaded(false);
    // Wishlist rows come from the qty_wanted ledger (quantity aliased to wanted);
    // regular lists from card_list_entries. Both carry `quantity` = the goal.
    const rows = isWishlist ? await wishlistCards() : await listCards(list.id);
    for (const c of rows) cardIndex.current.set(c.card_id, c);
    setQty(new Map(rows.map((r) => [r.card_id, r.quantity])));
    setOwnQty(await ownedMap(rows.map((r) => r.card_id)));
    setLoaded(true);
  };
  useEffect(() => {
    load();
    // Arriving via a "View missing ›" tap on the index opens straight to the list.
    if (list.openMissing) listProgress(list.id).then(setMissing);
    // Owned counts are read-only here: they redraw live as the collection grows.
    const off = subscribeCollection(() => ownedMap().then(setOwnQty));
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id]);

  const listRows = useMemo(() => {
    const out = [];
    for (const [id, t] of qty) { if (t > 0) { const c = cardIndex.current.get(id); if (c) out.push(c); } }
    out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty]);

  const targetOf = (id) => qty.get(id) || 0;
  // Wishlist writes the ownership ledger's qty_wanted; a real list writes its entry.
  const write = (cardId, next) => {
    chains.current[cardId] = (chains.current[cardId] || Promise.resolve())
      .then(() => (isWishlist ? setWanted(cardId, next) : setListEntry(list.id, cardId, next))).catch(() => {});
  };
  // The in-list picker's add/step - stashes the full card row so a brand-new card
  // renders immediately, and (unlike the row stepper) a step to 0 just removes it,
  // no confirm, since you're actively curating.
  const addStep = (card, delta) => {
    const id = card.card_id;
    cardIndex.current.set(id, card);
    const next = Math.max(0, (qty.get(id) || 0) + delta);
    haptic('light');
    setQty((prev) => { const m = new Map(prev); if (next <= 0) m.delete(id); else m.set(id, next); return m; });
    write(id, next);
  };
  // Steppers edit the GOAL (wanted qty), never the owned count. The goal floors at
  // 1; a step past it removes the card from the list, and that always confirms.
  function step(cardId, delta) {
    const cur = qty.get(cardId) || 0;
    if (delta < 0 && cur <= 1) {
      const c = cardIndex.current.get(cardId);
      setRemoveCard({ card_id: cardId, name: c?.name || 'this card' });
      return;
    }
    haptic('light');
    const next = Math.max(1, cur + delta);
    setQty((prev) => { const m = new Map(prev); m.set(cardId, next); return m; });
    write(cardId, next);
  }
  function removeEntry(cardId) {
    setRemoveCard(null);
    haptic('light');
    setQty((prev) => { const m = new Map(prev); m.delete(cardId); return m; });
    write(cardId, 0);
  }

  const totals = useMemo(() => {
    let req = 0, have = 0, names = 0, done = 0;
    for (const [id, t] of qty) {
      if (t <= 0) continue;
      names++; req += t;
      const h = Math.min(ownQty.get(id) || 0, t);
      have += h; if (h >= t) done++;
    }
    return { req, have, names, done, missing: req - have, percent: req ? Math.round((have / req) * 100) : 0, complete: req > 0 && have >= req };
  }, [qty, ownQty]);

  const openMissing = async () => setMissing(await listProgress(list.id));
  const exportText = useCallback(() => (isWishlist ? wishlistExportText() : exportListText(list.id)), [isWishlist, list.id]);

  return (
    <div style={{ padding: '0 20px' }}>
      {/* Header: frosted back + name/eyebrow + a live owned/goal tally. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 4, marginBottom: 14 }}>
        <button onClick={onBack} aria-label="Back to lists" style={{
          width: 38, height: 38, flex: 'none', borderRadius: '50%', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          font: "400 22px/1 var(--f-ui)", color: '#d3a8af',
          background: 'rgba(224,169,177,.07)', border: '1px solid rgba(224,169,177,.22)',
        }}>‹</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ font: "700 22px/1.1 var(--f-display)", color: '#efe7d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.name}</div>
          <div style={{ font: "600 10.5px/1 var(--f-display)", letterSpacing: '.2em', color: '#c76d85', marginTop: 5 }}>{isWishlist ? 'WISHLIST' : isWanted ? 'WANTED LIST' : 'CARD LIST'}</div>
        </div>
        {showProgress && totals.req > 0 && (
          <div style={{ flex: 'none', textAlign: 'right', lineHeight: 1 }}>
            <span style={{ font: "600 26px/1 var(--f-display)", color: totals.complete ? '#e3c589' : '#e0899e' }}>{totals.have}</span>
            <span style={{ font: "400 15px/1 var(--f-read)", color: '#8a8175' }}>/{totals.req}</span>
          </div>
        )}
      </div>

      {meta.description && <div style={{ font: "italic 400 15px/1.45 var(--f-read)", color: '#8a8175', margin: '0 2px 14px' }}>{meta.description}</div>}

      {/* Progress bar (wanted only): fills rose as the collection acquires copies,
          turning gold at 100%. "View missing ›" filters to what is still short. */}
      {showProgress && totals.req > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${totals.percent}%`, background: totals.complete ? '#e3c589' : '#e0899e', borderRadius: 3, transition: 'width .3s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ font: "400 12.5px/1 var(--f-read)", color: '#8a8175' }}>
              {totals.complete ? 'Every card collected' : `${totals.missing} missing`}
            </span>
            {isWanted && totals.missing > 0 && (
              <button onClick={openMissing} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: "600 12.5px/1 var(--f-ui)", color: '#c76d85' }}>View missing ›</button>
            )}
          </div>
        </div>
      )}

      {/* Summary + hairline rows, or the empty state. Read-first: steppers hide
          until Edit; cards join via the in-list "Add cards" picker. */}
      {!loaded ? <Loading /> : listRows.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <div style={{ font: "italic 400 15px/1.6 var(--f-read)", color: '#8a8175', marginBottom: 10 }}>
            {isWishlist ? 'Nothing on your wishlist yet.' : 'No cards yet.'}
          </div>
          <button onClick={() => setAddOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', font: "600 14px/1 var(--f-ui)", color: '#c76d85' }}>Add cards ›</button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
            <span style={{ font: "italic 400 13.5px/1.4 var(--f-read)", color: '#8a7a55' }}>
              {totals.names} card{totals.names === 1 ? '' : 's'}{isWanted && totals.done > 0 ? ` · ${totals.done} complete` : ''}
            </span>
            <button onClick={() => setEditing((e) => !e)} aria-pressed={editing}
              style={{ flex: 'none', padding: '6px 14px', borderRadius: 16, cursor: 'pointer', font: "600 12.5px/1 var(--f-ui)", whiteSpace: 'nowrap',
                background: editing ? 'linear-gradient(180deg, #d8b872, #b8954f)' : 'rgba(42,33,20,.5)', color: editing ? '#1a1206' : '#e3c589', border: `1px solid ${editing ? '#e3c589' : 'rgba(210,88,115,.5)'}` }}>
              {editing ? 'Done' : 'Edit'}
            </button>
          </div>
          {listRows.map((c) => (
            <ListCardRow key={c.card_id} card={c} owned={ownQty.get(c.card_id) || 0} target={targetOf(c.card_id)}
              isWanted={showProgress} editable={editing} onStep={(d) => step(c.card_id, d)} onPeek={() => onPeek(c.card_id)} />
          ))}
        </>
      )}

      {/* List actions live on the 3-dot FAB (matches the deck FAB spine). Delete
          routes through its OWN confirm sheet - destructive and undoable-never,
          so it is never one tap. */}
      <Fab variant="deck" label="List options" icon={<FabGlyph kind="dots" />} items={[
        { label: 'Add cards', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>, onClick: () => setAddOpen(true) },
        // The Wishlist is virtual + fixed: no rename, duplicate, or delete.
        ...(isWishlist ? [] : [
          { label: 'Edit list', icon: EditSvg, onClick: () => setRename(true) },
          { label: 'Duplicate list', icon: CopySvg, onClick: async () => { await duplicateList(list.id); toast('List duplicated'); onBack(); } },
        ]),
        { label: 'Export as text', icon: TextImportSvg, onClick: () => setExportOpen(true) },
        ...(isWanted ? [{ label: 'Get missing cards', icon: SeekSvg, onClick: openMissing }] : []),
        ...(isWishlist ? [] : [{ label: 'Delete list', icon: TrashSvg, danger: true, onClick: () => setConfirmDel(true) }]),
      ]} />

      <BottomSheet open={!!removeCard} title="REMOVE CARD" onClose={() => setRemoveCard(null)}>
        <div style={{ font: "400 14px/1.5 var(--f-read)", color: 'var(--ink-body)', textAlign: 'center', marginBottom: 16 }}>
          Remove “{removeCard?.name}” from {meta.name}?
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setRemoveCard(null)} style={{ ...BTN_GHOST, flex: 1 }}>Cancel</button>
          <button onClick={() => removeEntry(removeCard.card_id)} style={{ ...BTN_GHOST, flex: 1, color: 'var(--destructive)', borderColor: 'rgba(168,88,74,.5)' }}>Remove</button>
        </div>
      </BottomSheet>

      <BottomSheet open={confirmDel} title="DELETE LIST" onClose={() => setConfirmDel(false)}>
        <div style={{ font: "400 14px/1.5 var(--f-read)", color: 'var(--ink-body)', textAlign: 'center', marginBottom: 16 }}>
          Delete “{meta.name}”{totals.names > 0 ? ` and its ${totals.names} card${totals.names === 1 ? '' : 's'}` : ''}? This can’t be undone.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setConfirmDel(false)} style={{ ...BTN_GHOST, flex: 1 }}>Cancel</button>
          <button onClick={async () => { await deleteList(list.id); toast('List deleted'); onBack(); }} style={{ ...BTN_GHOST, flex: 1, color: 'var(--destructive)', borderColor: 'rgba(168,88,74,.5)' }}>Delete</button>
        </div>
      </BottomSheet>

      <ExportListSheet open={exportOpen} fetchText={exportText} listName={meta.name} onClose={() => setExportOpen(false)} />

      <ListNameSheet open={rename} kind={isWanted ? 'wanted' : 'custom'} title="RENAME LIST"
        initialName={meta.name} initialDesc={meta.description || ''} submitLabel="Save"
        onClose={() => setRename(false)}
        onSubmit={async (nm, desc) => { await renameList(list.id, nm, desc); setMeta((m) => ({ ...m, name: nm, description: desc })); setRename(false); }} />

      <AddCardsSheet open={addOpen} onClose={() => setAddOpen(false)}
        title={isWishlist ? 'ADD TO WISHLIST' : 'ADD CARDS'}
        hint={isWishlist ? 'Search the library and tap + to add cards you want.' : `Search the library and tap + to add to ${meta.name}.`}
        membership={qty} onStep={addStep} />

      <MissingSheet open={!!missing} report={missing} title={`Missing for ${meta.name}`}
        onOpenCard={(id) => onOpen('card', id)} onClose={() => setMissing(null)} onChanged={() => onChanged?.()} />
    </div>
  );
}
