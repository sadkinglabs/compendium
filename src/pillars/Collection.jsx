// Collection pillar - the card OWNERSHIP ledger. Overview (glance stats + how many
// decks are buildable + recently added) and Cards (search the catalog, one-tap +/-
// to record what you Own or Want). Rows are the binder-style CollectionCardRow;
// tapping a card opens the shared CollectionCardSheet (ownership steppers +
// Codex hand-off) lifted to the pillar root. Data layer is ownedRepository +
// compareEngine. Accent is ruby, chrome-only.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPool, getSets, listDecks } from '../store/deckRepository.js';
import { parseQuery, cardMatchesQuery } from '../store/cardQuery.js';
import {
  ownWantMap, qtyFor, setOwned, setWanted, ownedMap, collectionStats, recentlyAdded,
  deckBuildabilityBulk, subscribeCollection, importCollectionText, exportListText,
  listCardLists, createList, renameList, duplicateList, deleteList,
  setListEntry, listProgress, listProgressBulk, listCards,
} from '../store/ownedRepository.js';
import { Chip, ChipRow, Loading, BottomSheet, BTN_GOLD, BTN_GHOST } from '../components/ui.jsx';
import CollectionCardRow from '../components/CollectionCardRow.jsx';
import CollectionCardSheet from '../components/CollectionCardSheet.jsx';
import { LedgerRow, BinderTile } from '../components/CollectionCardViews.jsx';
import GothicSheet from '../components/GothicSheet.jsx';
import SearchPill from '../components/SearchPill.jsx';
import MissingSheet from '../components/MissingSheet.jsx';
import { serialChain, ownedChains } from '../components/ownedUi.js';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import { launchScanner } from '../cardScanner.js';
import { toast } from '../feedback.js';

// Chip recipe shared by the row's right-edge indicators (wishlist count, foil
// count, owned-of-target) - quiet mono capsule, content stays ink not ruby.
const chipStyle = (color = 'var(--ink-faint)') => ({
  font: "600 11px/1 var(--f-mono)", color, padding: '4px 7px',
  border: '1px solid var(--hair-12)', borderRadius: 999,
});

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
  useEffect(() => { session.view = view; session.listOpen = listOpen; session.sheetCard = sheetCard; }, [view, listOpen, sheetCard]);
  const go = (v) => { setListOpen(null); setView(v); };
  const pills = (
    <div style={{ padding: '0 20px 10px' }}>
      <ChipRow>
        <Chip label="Overview" active={view === 'overview'} onClick={() => go('overview')} />
        <Chip label="Cards" active={view === 'cards'} onClick={() => go('cards')} />
        <Chip label="Lists" active={view === 'lists'} onClick={() => go('lists')} />
      </ChipRow>
    </div>
  );
  return (
    <div style={{ padding: '4px 0 26px', animation: 'cxfade .2s ease' }}>
      {pillSlot ? createPortal(pills, pillSlot) : pills}
      {view === 'overview' ? (
        <Overview onGoCards={() => go('cards')} onGoDecks={onGoDecks} onGoLists={() => go('lists')} onPeek={setSheetCard}
          onOpenCodex={(id, name) => onOpen('card', id, name)} rev={rev} />
      ) : view === 'cards' ? (
        <Cards onOpen={onOpen} onPeek={setSheetCard} />
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

function Overview({ onGoCards, onGoDecks, onPeek, onOpenCodex, rev }) {
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [ow, setOw] = useState(new Map());   // optimistic owned/foil/wanted for the recent rows
  const [deckStat, setDeckStat] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [s, r, decks] = await Promise.all([collectionStats(), recentlyAdded(10), listDecks()]);
      if (!alive) return;
      setStats(s); setRecent(r);
      setOw(new Map(r.map((c) => [c.card_id, { owned: c.qty_owned, foil: c.qty_foil || 0, wanted: c.qty_wanted }])));
      const reports = await deckBuildabilityBulk(decks.map((d) => d.id));
      let buildable = 0; for (const rep of reports.values()) if (rep.complete && rep.totalRequired > 0) buildable++;
      if (alive) setDeckStat({ buildable, total: decks.length });
    };
    load();
    const off = subscribeCollection(load);
    return () => { alive = false; off(); };
  }, [rev]);

  // Same write path as the Cards list: optimistic paint off the cached map, the
  // write re-reads qtyFor inside the app-wide per-card chain so it can't clobber.
  function step(cardId, delta) {
    setOw((prev) => {
      const cur = prev.get(cardId) || { owned: 0, foil: 0, wanted: 0 };
      const m = new Map(prev); m.set(cardId, { ...cur, owned: Math.max(0, cur.owned + delta) });
      return m;
    });
    serialChain(ownedChains, cardId, async () => {
      const cur = await qtyFor(cardId);
      return setOwned(cardId, Math.max(0, cur.owned + delta));
    });
  }
  if (!stats) return <Loading />;
  return (
    <div style={{ padding: '2px 20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
        <Tile label="CARDS OWNED" value={stats.owned} onClick={onGoCards} />
        <Tile label="UNIQUE CARDS" value={stats.unique} onClick={onGoCards} />
        <Tile label="WISHLIST" value={stats.wishlist} sub="cards you want" onClick={onGoCards} />
        <Tile label="DECKS BUILDABLE" value={deckStat ? `${deckStat.buildable}/${deckStat.total}` : '-'} sub="from your collection" onClick={onGoDecks} />
      </div>

      {recent.length > 0 ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '4px 0 8px' }}>
            <span style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.16em', color: 'var(--accent-ruby)' }}>RECENTLY ADDED</span>
            <button onClick={onGoCards} style={{ background: 'none', border: 'none', color: 'var(--ink-muted)', font: "600 12px/1 var(--f-ui)", cursor: 'pointer' }}>All cards ›</button>
          </div>
          {recent.map((c) => {
            const o = ow.get(c.card_id) || { owned: c.qty_owned, foil: c.qty_foil || 0, wanted: c.qty_wanted };
            return (
              <LedgerRow key={c.card_id} card={c} owned={o.owned} foil={o.foil} wanted={o.wanted} value={o.owned}
                onStep={(d) => step(c.card_id, d)} onPeek={() => onPeek(c.card_id)} />
            );
          })}
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
        { label: 'Add with camera', icon: CameraSvg, onClick: () => launchScanner({ onOpenCard: onOpenCodex }) },
        { label: 'Import from text', icon: TextImportSvg, onClick: () => setImportOpen(true) },
      ]} />
      <ImportTextSheet open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

/* ---------------- Cards (dual-view collection browser) ---------------- */

// The sticky, centered List / Binder segmented control.
function ViewToggle({ view, setView }) {
  const seg = (v, label, icon) => (
    <button onClick={() => setView(v)} aria-pressed={view === v} aria-label={label}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 62, height: 34, borderRadius: 16, border: 'none', cursor: 'pointer', background: view === v ? '#2a2114' : 'transparent', color: view === v ? '#d8c9a4' : '#8a8175', transition: 'background .16s, color .16s' }}>
      {icon}
    </button>
  );
  return (
    <div role="group" aria-label="Card view" style={{ display: 'inline-flex', padding: 3, gap: 2, borderRadius: 20, background: 'rgba(10,10,12,.55)', border: '1px solid #4a3c22', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', boxShadow: '0 6px 18px rgba(0,0,0,.4)' }}>
      {seg('list', 'List view', <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></svg>)}
      {seg('binder', 'Binder view', <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>)}
    </div>
  );
}

const TYPE_OPTS = ['Minion', 'Aura', 'Magic', 'Artifact', 'Site'];
const RARITY_OPTS = ['Ordinary', 'Exceptional', 'Elite', 'Unique'];
const EL_OPTS = [['air', 'Air'], ['earth', 'Earth'], ['fire', 'Fire'], ['water', 'Water']];
const OWN_OPTS = [['all', 'All'], ['owned', 'Owned'], ['wishlist', 'Wishlist'], ['missing', 'Missing']];

// All filters in one gothic sheet (same chrome as the card detail sheet). A
// compact summary + clear-all sit under the header.
function FiltersSheet({ open, onClose, own, setOwn, sets, setSets, types, setTypes, rarities, setRarities, els, setEls, setOpts, activeCount, summary, onClear }) {
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const Group = ({ title, children }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ font: "600 10px/1 var(--f-display)", letterSpacing: '.16em', color: '#cba75f', marginBottom: 9 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>
    </div>
  );
  return (
    <GothicSheet open={open} onClose={onClose} label="Filters">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ font: "600 13px/1 var(--f-display)", letterSpacing: '.24em', color: '#cba75f' }}>FILTERS</span>
        {activeCount > 0 && <button onClick={onClear} style={{ background: 'none', border: 'none', color: 'var(--ink-muted)', font: "600 12px/1 var(--f-ui)", cursor: 'pointer' }}>Clear all</button>}
      </div>
      <div style={{ font: "400 12.5px/1.4 var(--f-read)", color: activeCount > 0 ? 'var(--ink-status)' : 'var(--ink-faint)', minHeight: 16, marginBottom: 16 }}>{activeCount > 0 ? summary : 'All cards'}</div>
      <Group title="OWNERSHIP">{OWN_OPTS.map(([k, l]) => <Chip key={k} label={l} active={own === k} onClick={() => setOwn(k)} />)}</Group>
      <Group title="TYPE">{TYPE_OPTS.map((t) => <Chip key={t} label={t} active={types.includes(t)} onClick={() => toggle(types, setTypes, t)} />)}</Group>
      <Group title="RARITY">{RARITY_OPTS.map((r) => <Chip key={r} label={r} active={rarities.includes(r)} onClick={() => toggle(rarities, setRarities, r)} />)}</Group>
      <Group title="ELEMENT">{EL_OPTS.map(([k, l]) => <Chip key={k} label={l} active={els.includes(k)} onClick={() => toggle(els, setEls, k)} />)}</Group>
      {setOpts.length > 0 && <Group title="SET">{setOpts.map((s) => <Chip key={s} label={s} active={sets.includes(s)} onClick={() => toggle(sets, setSets, s)} />)}</Group>}
      <button onClick={onClose} style={{ width: '100%', marginTop: 8, padding: '14px 0', borderRadius: 16, cursor: 'pointer', font: "600 14px/1 var(--f-display)", color: '#1a1206', background: 'linear-gradient(180deg, #d8b872, #b8954f)', border: '1px solid #e3c589', boxShadow: '0 6px 20px rgba(203,167,95,.22)' }}>Show results</button>
    </GothicSheet>
  );
}

const VIEW_KEY = 'cx-collection-view';
const EL_LABEL = { air: 'Air', earth: 'Earth', fire: 'Fire', water: 'Water' };
const OWN_LABEL = { owned: 'Owned', wishlist: 'Wishlist', missing: 'Missing' };

function Cards({ onOpen, onPeek }) {
  const [view, setView] = useState(() => { try { return localStorage.getItem(VIEW_KEY) === 'binder' ? 'binder' : 'list'; } catch { return 'list'; } });
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode */ } }, [view]);

  const [q, setQ] = useState(session.q);
  const [own, setOwn] = useState(session.filter);           // all | owned | wishlist | missing
  const [sets, setSets] = useState(session.sets);
  const [types, setTypes] = useState(session.types);
  const [rarities, setRarities] = useState(session.rarities);
  const [els, setEls] = useState(session.els);
  useEffect(() => { session.q = q; session.filter = own; session.sets = sets; session.types = types; session.rarities = rarities; session.els = els; }, [q, own, sets, types, rarities, els]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [pool, setPool] = useState(null);
  const [ow, setOw] = useState(new Map());        // card_id -> {owned(reg), foil, wanted}
  const [setOpts, setSetOpts] = useState([]);
  useEffect(() => { getSets().then(setSetOpts); }, []);

  // Steppers edit Owned - except under the Wishlist filter, where the visible
  // filter IS the mode and they edit Wanted.
  const field = own === 'wishlist' ? 'wanted' : 'owned';

  async function loadPool() {
    const parsed = parseQuery(q);
    const rows = await getPool({ q: parsed.name, sets, types, rarities, els });
    setPool(parsed.clauses.length ? rows.filter((c) => cardMatchesQuery(c, parsed)) : rows);
  }
  useEffect(() => { const t = setTimeout(loadPool, 130); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, sets, types, rarities, els]);
  useEffect(() => { ownWantMap().then(setOw); }, []);
  // Live-refresh with edits made elsewhere (the card sheet's own ledger), debounced
  // so our optimistic steps commit first (see the write path below).
  useEffect(() => {
    let t = null;
    const off = subscribeCollection(() => { clearTimeout(t); t = setTimeout(() => ownWantMap().then(setOw), 250); });
    return () => { clearTimeout(t); off(); };
  }, []);

  const val = (id, key) => (ow.get(id)?.[key] || 0);
  function step(cardId, delta) {
    // Optimistic off the cached map; the WRITE re-reads qtyFor inside the app-wide
    // per-card chain, so a sheet edit can't be clobbered by a stale absolute write.
    setOw((prev) => {
      const cur = prev.get(cardId) || { owned: 0, foil: 0, wanted: 0 };
      const next = { ...cur, [field]: Math.max(0, (cur[field] || 0) + delta) };
      const m = new Map(prev); m.set(cardId, next);
      return m;
    });
    serialChain(ownedChains, cardId, async () => {
      const cur = await qtyFor(cardId);
      const write = Math.max(0, (cur[field] || 0) + delta);
      return field === 'owned' ? setOwned(cardId, write) : setWanted(cardId, write);
    });
  }

  // Ownership post-filter (total = regular + foil: a foil-only card is owned).
  const shown = (pool || []).filter((c) => {
    const t = val(c.card_id, 'owned') + val(c.card_id, 'foil'), w = val(c.card_id, 'wanted');
    if (own === 'owned') return t > 0;
    if (own === 'wishlist') return w > 0;
    if (own === 'missing') return t === 0;
    return true;
  });

  const activeCount = (own !== 'all' ? 1 : 0) + sets.length + types.length + rarities.length + els.length;
  const summary = [OWN_LABEL[own], ...sets, ...rarities, ...types, ...els.map((e) => EL_LABEL[e])].filter(Boolean).join(' · ');
  const clearAll = () => { setOwn('all'); setSets([]); setTypes([]); setRarities([]); setEls([]); };
  const cardProps = (c) => ({ owned: val(c.card_id, 'owned'), foil: val(c.card_id, 'foil'), wanted: val(c.card_id, 'wanted') });

  return (
    <div style={{ padding: '0 20px 150px' }}>
      {/* Sticky centered view toggle - never scrolls away. Transparent band: cards
          just scroll up past the frosted-glass toggle and clip under the header. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 6, display: 'flex', justifyContent: 'center', padding: '6px 0 12px', background: 'transparent' }}>
        <ViewToggle view={view} setView={setView} />
      </div>

      {pool == null ? <Loading /> : (
        <>
          <div style={{ font: "400 11.5px/1 var(--f-ui)", color: 'var(--ink-faint)', textAlign: 'right', margin: '0 2px 8px' }}>
            {shown.length} cards{shown.length > 250 ? ' · showing 250' : ''}
          </div>
          {shown.length === 0 ? (
            <div style={{ padding: '48px 0', textAlign: 'center', font: "400 15px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>
              No cards match{activeCount || q ? ' those filters' : ''}.
            </div>
          ) : view === 'binder' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {shown.slice(0, 250).map((c) => (
                <BinderTile key={c.card_id} card={c} {...cardProps(c)} onStep={(d) => step(c.card_id, d)} onPeek={() => onPeek(c.card_id)} />
              ))}
            </div>
          ) : (
            shown.slice(0, 250).map((c) => (
              <LedgerRow key={c.card_id} card={c} {...cardProps(c)} value={own === 'wishlist' ? val(c.card_id, 'wanted') : val(c.card_id, 'owned')}
                onStep={(d) => step(c.card_id, d)} onPeek={() => onPeek(c.card_id)} />
            ))
          )}
        </>
      )}

      {/* Bottom search - the one shared dock pill (portals beside the FAB). */}
      <SearchPill value={q} onChange={setQ} onClear={() => setQ('')} placeholder="Search cards…" ariaLabel="Search your collection" />

      <Fab variant="deck" label="Filter cards" icon={<FabGlyph kind="filters" />} badge={activeCount} onClick={() => setFilterOpen(true)} />
      <FiltersSheet open={filterOpen} onClose={() => setFilterOpen(false)}
        own={own} setOwn={setOwn} sets={sets} setSets={setSets} types={types} setTypes={setTypes}
        rarities={rarities} setRarities={setRarities} els={els} setEls={setEls} setOpts={setOpts}
        activeCount={activeCount} summary={summary} onClear={clearAll} />
    </div>
  );
}

/* ---------------- Lists (Wanted goals + custom Card Lists) ---------------- */

const iconBtn = {
  width: 34, height: 34, flex: 'none', borderRadius: 10, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  font: "600 21px/1 var(--f-ui)", color: 'var(--ink-status)',
  background: 'rgba(255,255,255,.03)', border: '1px solid var(--hair-22)',
};
const SHEET_INPUT = {
  width: '100%', height: 44, boxSizing: 'border-box', background: 'var(--surface-well)',
  border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px',
  color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)",
};

function Section({ title, hint, onAdd, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 4px' }}>
        <span style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.16em', color: 'var(--accent-ruby)' }}>{title}</span>
        <button onClick={onAdd} style={{ background: 'none', border: 'none', color: 'var(--gold-leaf)', font: "700 12px/1 var(--f-ui)", cursor: 'pointer', padding: '2px 0' }}>+ New</button>
      </div>
      {hint && <div style={{ font: "italic 400 12px/1.4 'EB Garamond',serif", color: 'var(--ink-faint)', marginBottom: 10 }}>{hint}</div>}
      {children}
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ padding: '14px 0 6px', font: "400 13.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>{text}</div>;
}

// Export a list as flat "qty name" text - the Curiosa deck-export format, so it
// round-trips into Curiosa, Decks > Import from text, or Collection's own bulk
// import on another profile/device.
function ExportListSheet({ open, listId, listName, onClose }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    if (!open || !listId) return;
    let alive = true;
    setText(null);
    exportListText(listId).then((t) => alive && setText(t));
    return () => { alive = false; };
  }, [open, listId]);
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

function ListRowCard({ list, progress, onClick }) {
  const p = list.kind === 'wanted' ? progress : null;
  const hasBar = p && p.totalRequired > 0;
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left', marginBottom: 10, cursor: 'pointer',
      background: 'rgba(255,255,255,.02)', border: '1px solid var(--hair-12)', borderRadius: 12, padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ minWidth: 0, font: "600 15px/1.2 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</span>
        {hasBar
          ? <span style={{ flex: 'none', font: "700 12px/1 var(--f-mono)", color: p.complete ? 'var(--accent-jade)' : 'var(--accent-ruby)' }}>{p.complete ? '✓' : `${p.percent}%`}</span>
          : <span style={{ flex: 'none', font: "600 11px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>{list.entryCount} card{list.entryCount === 1 ? '' : 's'}</span>}
      </div>
      {hasBar && (
        <>
          <div style={{ height: 5, borderRadius: 3, background: 'var(--hair-12)', overflow: 'hidden', margin: '9px 0 6px' }}>
            <div style={{ height: '100%', width: `${p.percent}%`, background: p.complete ? 'var(--accent-jade)' : 'var(--accent-ruby)', borderRadius: 3, transition: 'width .3s ease' }} />
          </div>
          <span style={{ font: "400 11px/1 var(--f-ui)", color: 'var(--ink-muted)' }}>own {p.totalHave} of {p.totalRequired}{p.totalMissing > 0 ? ` · missing ${p.totalMissing}` : ''}</span>
        </>
      )}
      {list.description ? <div style={{ marginTop: hasBar ? 6 : 4, font: "400 12px/1.4 var(--f-read)", color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.description}</div> : null}
    </button>
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

function ListsIndex({ onOpenList, rev }) {
  const [lists, setLists] = useState(null);
  const [progress, setProgress] = useState(new Map());
  const [create, setCreate] = useState(null);   // 'wanted' | 'custom' | null
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const all = await listCardLists();
      if (!alive) return;
      setLists(all);
      const wantedIds = all.filter((l) => l.kind === 'wanted').map((l) => l.id);
      const pr = wantedIds.length ? await listProgressBulk(wantedIds) : new Map();
      if (alive) setProgress(pr);
    };
    load();
    const off = subscribeCollection(load);
    return () => { alive = false; off(); };
  }, [rev]);

  if (lists == null) return <Loading />;
  const wanted = lists.filter((l) => l.kind === 'wanted');
  const custom = lists.filter((l) => l.kind === 'custom');
  return (
    <div style={{ padding: '2px 20px' }}>
      <Section title="WANTED LISTS" hint="Named goals - Collection tracks your progress as you acquire cards." onAdd={() => setCreate('wanted')}>
        {wanted.length
          ? wanted.map((l) => <ListRowCard key={l.id} list={l} progress={progress.get(l.id)} onClick={() => onOpenList(l)} />)
          : <Empty text="No wanted lists yet - set a goal and watch it fill in." />}
      </Section>
      <Section title="CARD LISTS" hint="Custom groupings - a trade binder, a cube, cards to sell." onAdd={() => setCreate('custom')}>
        {custom.length
          ? custom.map((l) => <ListRowCard key={l.id} list={l} onClick={() => onOpenList(l)} />)
          : <Empty text="No card lists yet." />}
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

function ListDetail({ list, onBack, onOpen, onPeek, onChanged }) {
  const isWanted = list.kind === 'wanted';
  const [meta, setMeta] = useState(list);
  const [loaded, setLoaded] = useState(false);     // initial listCards fetch done
  const [ownQty, setOwnQty] = useState(new Map()); // card_id -> owned qty
  const [qty, setQty] = useState(new Map());       // card_id -> target qty (optimistic)
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [rename, setRename] = useState(false);
  const [missing, setMissing] = useState(null);    // report for MissingSheet
  const chains = useRef({});
  const cardIndex = useRef(new Map());             // card_id -> full card row (seen via list or search)

  const indexCards = (rows) => { for (const c of rows) cardIndex.current.set(c.card_id, c); };
  const mergeOwned = (m) => setOwnQty((prev) => { const n = new Map(prev); for (const [k, v] of m) n.set(k, v); return n; });
  const load = async () => {
    setLoaded(false);
    const rows = await listCards(list.id);
    indexCards(rows);
    setQty(new Map(rows.map((r) => [r.card_id, r.quantity])));
    mergeOwned(await ownedMap(rows.map((r) => r.card_id)));
    setLoaded(true);
  };
  useEffect(() => {
    setQ(''); setResults(null);
    load();
    const off = subscribeCollection(() => ownedMap().then(setOwnQty));
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id]);

  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    const t = setTimeout(async () => {
      const parsed = parseQuery(q);
      const rows = await getPool({ q: parsed.name });
      const filtered = (parsed.clauses.length ? rows.filter((c) => cardMatchesQuery(c, parsed)) : rows).slice(0, 60);
      indexCards(filtered);
      setResults(filtered);
      mergeOwned(await ownedMap(filtered.map((c) => c.card_id)));
    }, 130);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // the list's current cards, derived from the live target map + the card index
  // (so cards added via search appear immediately, without a re-fetch race).
  const listRows = useMemo(() => {
    const out = [];
    for (const [id, t] of qty) { if (t > 0) { const c = cardIndex.current.get(id); if (c) out.push(c); } }
    out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty]);

  const targetOf = (id) => qty.get(id) || 0;
  function step(cardId, delta) {
    // haptic lives in CollectionCardRow's stepper - don't double-buzz here.
    setQty((prev) => {
      const next = Math.max(0, (prev.get(cardId) || 0) + delta);
      const m = new Map(prev);
      if (next === 0) m.delete(cardId); else m.set(cardId, next);
      chains.current[cardId] = (chains.current[cardId] || Promise.resolve())
        .then(() => setListEntry(list.id, cardId, next)).catch(() => {});
      return m;
    });
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

  const rows = q.trim() ? results : listRows;
  const loading = q.trim() ? results == null : !loaded;

  const renderRow = (c) => {
    const t = targetOf(c.card_id);
    const own = ownQty.get(c.card_id) || 0;
    const enough = isWanted && t > 0 && own >= t;
    const chip = isWanted && t > 0
      ? <span title="Owned / target" style={chipStyle(enough ? 'var(--accent-jade)' : 'var(--ink-faint)')}>{enough ? '✓' : `${Math.min(own, t)}/${t}`}</span>
      : null;
    // `own` is the TOTAL from ownedMap (regular + foil) - it feeds the badge and
    // the playset jewel; the ♡/✦ split isn't loaded here (the sheet has it).
    return (
      <CollectionCardRow key={c.card_id} card={c} owned={own} dim={own === 0} chip={chip}
        stepper={{ value: t, onStep: (d) => step(c.card_id, d) }}
        onClick={() => onPeek(c.card_id)} />
    );
  };

  return (
    <div style={{ padding: '0 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <button onClick={onBack} aria-label="Back to lists" style={iconBtn}>‹</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ font: "700 18px/1.15 var(--f-display)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.name}</div>
          <div style={{ font: "600 9.5px/1 var(--f-display)", letterSpacing: '.16em', color: 'var(--accent-ruby)', marginTop: 4 }}>{isWanted ? 'WANTED LIST' : 'CARD LIST'}</div>
        </div>
      </div>
      {meta.description ? <div style={{ font: "400 12.5px/1.45 var(--f-read)", color: 'var(--ink-faint)', margin: '0 2px 12px' }}>{meta.description}</div> : <div style={{ height: 6 }} />}

      {isWanted && totals.req > 0 && (
        <div className="chart-card" style={{ marginBottom: 14, cursor: totals.missing > 0 ? 'pointer' : 'default' }} onClick={() => totals.missing > 0 && openMissing()}>
          <div className="chart-card-header">
            <h3>Progress</h3>
            <span style={{ font: "700 13px/1 var(--f-mono)", color: totals.complete ? 'var(--accent-jade)' : 'var(--ink-body)' }}>{totals.complete ? '✓ Complete' : `${totals.have}/${totals.req}`}</span>
          </div>
          <div style={{ padding: '2px 14px 14px' }}>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--hair-12)', overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', width: `${totals.percent}%`, background: totals.complete ? 'var(--accent-jade)' : 'var(--accent-ruby)', borderRadius: 3, transition: 'width .3s ease' }} />
            </div>
            <div style={{ font: "400 12.5px/1.45 var(--f-ui)", color: 'var(--ink-muted)' }}>
              {totals.complete
                ? 'You own every card on this list.'
                : <>You own {totals.have} of {totals.req} · <span style={{ color: 'var(--accent-ruby)' }}>missing {totals.missing}</span> - tap for list</>}
            </div>
          </div>
        </div>
      )}

      <div className="cx-search-pill" style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add cards - search the catalog…" aria-label="Add cards to this list"
          style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)", flex: 1 }} />
      </div>

      {loading ? <Loading /> : (rows || []).length === 0 ? (
        <div style={{ padding: '34px 0', textAlign: 'center', whiteSpace: 'pre-line', font: "400 14.5px/1.6 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>
          {q.trim() ? 'No cards match.' : 'This list is empty.\nSearch above to add cards.'}
        </div>
      ) : (
        <>
          {!q.trim() && <div style={{ font: "italic 400 12px/1.4 'EB Garamond',serif", color: 'var(--ink-muted)', marginBottom: 8 }}>{totals.names} card{totals.names === 1 ? '' : 's'}{isWanted ? ` · ${totals.done} complete` : ''}</div>}
          {rows.map((c) => renderRow(c))}
        </>
      )}

      {/* List actions live on the 3-dot FAB (matches the deck FAB spine). Delete
          routes through its OWN confirm sheet - destructive and undoable-never,
          so it is never one tap. */}
      <Fab variant="deck" label="List options" icon={<FabGlyph kind="dots" />} items={[
        { label: 'Edit list', icon: EditSvg, onClick: () => setRename(true) },
        { label: 'Duplicate list', icon: CopySvg, onClick: async () => { await duplicateList(list.id); toast('List duplicated'); onBack(); } },
        { label: 'Export as text', icon: TextImportSvg, onClick: () => setExportOpen(true) },
        ...(isWanted ? [{ label: 'Get missing cards', icon: SeekSvg, onClick: openMissing }] : []),
        { label: 'Delete list', icon: TrashSvg, danger: true, onClick: () => setConfirmDel(true) },
      ]} />

      <BottomSheet open={confirmDel} title="DELETE LIST" onClose={() => setConfirmDel(false)}>
        <div style={{ font: "400 14px/1.5 var(--f-read)", color: 'var(--ink-body)', textAlign: 'center', marginBottom: 16 }}>
          Delete “{meta.name}”{totals.names > 0 ? ` and its ${totals.names} card${totals.names === 1 ? '' : 's'}` : ''}? This can’t be undone.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setConfirmDel(false)} style={{ ...BTN_GHOST, flex: 1 }}>Cancel</button>
          <button onClick={async () => { await deleteList(list.id); toast('List deleted'); onBack(); }} style={{ ...BTN_GHOST, flex: 1, color: 'var(--destructive)', borderColor: 'rgba(168,88,74,.5)' }}>Delete</button>
        </div>
      </BottomSheet>

      <ExportListSheet open={exportOpen} listId={list.id} listName={meta.name} onClose={() => setExportOpen(false)} />

      <ListNameSheet open={rename} kind={isWanted ? 'wanted' : 'custom'} title="RENAME LIST"
        initialName={meta.name} initialDesc={meta.description || ''} submitLabel="Save"
        onClose={() => setRename(false)}
        onSubmit={async (nm, desc) => { await renameList(list.id, nm, desc); setMeta((m) => ({ ...m, name: nm, description: desc })); setRename(false); }} />

      <MissingSheet open={!!missing} report={missing} title={`Missing for ${meta.name}`}
        onOpenCard={(id) => onOpen('card', id)} onClose={() => setMissing(null)} onChanged={() => onChanged?.()} />
    </div>
  );
}
