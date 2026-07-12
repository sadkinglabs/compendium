// Collection pillar - the card OWNERSHIP ledger. Overview (glance stats + how many
// decks are buildable + recently added) and Cards (search the catalog, one-tap +/-
// to record what you Own or Want). Rows are the binder-style LedgerRow/BinderTile;
// tapping a card opens the shared CollectionCardSheet (ownership steppers +
// Codex hand-off) lifted to the pillar root. Data layer is ownedRepository +
// compareEngine. Accent is ruby, chrome-only.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPool, getSets, getArtists, listDecks } from '../store/deckRepository.js';
import { parseQuery, cardMatchesQuery } from '../store/cardQuery.js';
import {
  ownWantMap, qtyFor, setOwned, setWanted, ownedMap, collectionStats, recentlyAdded,
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
        <ListDetail list={listOpen} onBack={() => setListOpen(null)} onOpen={onOpen} onPeek={setSheetCard} onGoCards={() => go('cards')} onChanged={onChanged} />
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
        <Tile label="WISHLIST" value={stats.wishlist} sub="cards you want" onClick={onGoCards} />
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
              onPeek={() => onPeek(c.card_id)} />
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
  // Sits sticky over the scrolling card list, so it needs the frosted-solid
  // backing (same as the Decks docked List/Stats toggle) to stay legible.
  return (
    <SegTabs ariaLabel="Card view" value={view} onChange={setView}
      options={[{ key: 'list', label: 'List', icon: <IcList /> }, { key: 'binder', label: 'Binder', icon: <IcGrid /> }]}
      style={{ background: 'rgba(11,11,13,.82)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: '0 4px 16px rgba(0,0,0,.45)' }} />
  );
}

const OWN_OPTS = [['all', 'All'], ['owned', 'Owned'], ['wishlist', 'Wishlist'], ['missing', 'Missing']];

const VIEW_KEY = 'cx-collection-view';
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
  const [ow, setOw] = useState(new Map());        // card_id -> {owned(reg), foil, wanted}
  const [setOpts, setSetOpts] = useState([]);
  useEffect(() => { getSets().then(setSetOpts); getArtists().then(setArtistOpts); }, []);

  // Steppers edit Owned - except under the Wishlist filter, where the visible
  // filter IS the mode and they edit Wanted.
  const field = own === 'wishlist' ? 'wanted' : 'owned';

  async function loadPool() {
    const parsed = parseQuery(q);
    const rows = await getPool({ q: parsed.name, els, types, rarities, sets, multi, thByEl, totalTh, costCmp, artist, sort });
    setPool(parsed.clauses.length ? rows.filter((c) => cardMatchesQuery(c, parsed)) : rows);
  }
  useEffect(() => { const t = setTimeout(loadPool, 130); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, sets, types, rarities, els, multi, thByEl, totalTh, costCmp, artist, sort]);
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
  // Memoised: re-scans the pool only when the pool, ownership map, or scope
  // change - not on every render (e.g. a sheet open or an unrelated state flip).
  const shown = useMemo(() => (pool || []).filter((c) => {
    const o = ow.get(c.card_id);
    const t = (o?.owned || 0) + (o?.foil || 0), w = o?.wanted || 0;
    if (own === 'owned') return t > 0;
    if (own === 'wishlist') return w > 0;
    if (own === 'missing') return t === 0;
    return true;
  }), [pool, ow, own]);

  const richComp = ['air', 'earth', 'fire', 'water'].filter((el) => thByEl[el].val != null).length + (totalTh.val != null ? 1 : 0) + (costCmp.val != null ? 1 : 0);
  const activeCount = (own !== 'all' ? 1 : 0) + sets.length + types.length + rarities.length + els.length + (multi ? 1 : 0) + (artist ? 1 : 0) + richComp + (sort.length ? 1 : 0);
  const clearAll = () => {
    setOwn('all'); setSets([]); setTypes([]); setRarities([]); setEls([]); setMulti(false); setArtist('');
    setThByEl({ air: { op: '>=', val: null }, earth: { op: '>=', val: null }, fire: { op: '>=', val: null }, water: { op: '>=', val: null } });
    setTotalTh({ op: '>=', val: null }); setCostCmp({ op: '>=', val: null }); setSort([]);
  };
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
      <RefineSheet open={filterOpen} onClose={() => setFilterOpen(false)} onClear={clearAll}
        eyebrow="FILTERS" activeCount={activeCount} ctaLabel={`Show ${shown.length} card${shown.length === 1 ? '' : 's'}`}
        summaryLead={own !== 'all' ? [OWN_LABEL[own]] : []}
        leadSections={(
          <div style={{ marginBottom: 22 }}>
            <SectionLabel label="OWNERSHIP" />
            <div role="group" aria-label="Ownership" style={{ display: 'inline-flex', border: '1px solid #4a3c22', borderRadius: 20, overflow: 'hidden' }}>
              {OWN_OPTS.map(([k, l]) => (
                <button key={k} onClick={() => setOwn(k)} aria-pressed={own === k}
                  style={{ padding: '8px 16px', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-display)', fontSize: 12.5, fontWeight: own === k ? 600 : 500, letterSpacing: '.08em', textTransform: 'uppercase', color: own === k ? '#d8c9a4' : '#8a8175', background: own === k ? 'rgba(42,33,20,.7)' : 'transparent', transition: 'background .16s, color .16s' }}>{l}</button>
              ))}
            </div>
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

function ListsIndex({ onOpenList, rev }) {
  const [lists, setLists] = useState(null);
  const [progress, setProgress] = useState(new Map());
  const [thumbs, setThumbs] = useState(new Map());
  const [create, setCreate] = useState(null);   // 'wanted' | 'custom' | null
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const all = await listCardLists();
      if (!alive) return;
      setLists(all);
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
function ListCardRow({ card, owned, target, isWanted, onStep, onPeek }) {
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

      {/* Frosted -/+ editing the GOAL (wanted qty). The WANT label marks this as
          goal-editing, distinct from the unlabeled owned-editing on the Cards tab. */}
      <span onClick={(e) => e.stopPropagation()} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Frost label={isWanted ? 'Want one fewer' : 'One fewer copy'} onClick={() => onStep(-1)}>−</Frost>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 30 }}>
          <span style={{ font: "600 8.5px/1 var(--f-display)", letterSpacing: '.18em', color: '#c76d85' }}>{isWanted ? 'WANT' : 'COPIES'}</span>
          <span style={{ font: "600 19px/1 var(--f-display)", color: '#efe7d8', marginTop: 4 }}>{target}</span>
        </span>
        <Frost label={isWanted ? 'Want one more' : 'One more copy'} onClick={() => onStep(1)}>+</Frost>
      </span>
    </div>
  );
}

function ListDetail({ list, onBack, onOpen, onPeek, onGoCards, onChanged }) {
  const isWanted = list.kind === 'wanted';
  const [meta, setMeta] = useState(list);
  const [loaded, setLoaded] = useState(false);     // initial listCards fetch done
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
    const rows = await listCards(list.id);
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
  const write = (cardId, next) => {
    chains.current[cardId] = (chains.current[cardId] || Promise.resolve())
      .then(() => setListEntry(list.id, cardId, next)).catch(() => {});
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
          <div style={{ font: "600 10.5px/1 var(--f-display)", letterSpacing: '.2em', color: '#c76d85', marginTop: 5 }}>{isWanted ? 'WANTED LIST' : 'CARD LIST'}</div>
        </div>
        {isWanted && totals.req > 0 && (
          <div style={{ flex: 'none', textAlign: 'right', lineHeight: 1 }}>
            <span style={{ font: "600 26px/1 var(--f-display)", color: totals.complete ? '#e3c589' : '#e0899e' }}>{totals.have}</span>
            <span style={{ font: "400 15px/1 var(--f-read)", color: '#8a8175' }}>/{totals.req}</span>
          </div>
        )}
      </div>

      {meta.description && <div style={{ font: "italic 400 15px/1.45 var(--f-read)", color: '#8a8175', margin: '0 2px 14px' }}>{meta.description}</div>}

      {/* Progress bar (wanted only): fills rose as the collection acquires copies,
          turning gold at 100%. "View missing ›" filters to what is still short. */}
      {isWanted && totals.req > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${totals.percent}%`, background: totals.complete ? '#e3c589' : '#e0899e', borderRadius: 3, transition: 'width .3s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ font: "400 12.5px/1 var(--f-read)", color: '#8a8175' }}>
              {totals.complete ? 'Every card collected' : `${totals.missing} missing`}
            </span>
            {totals.missing > 0 && (
              <button onClick={openMissing} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: "600 12.5px/1 var(--f-ui)", color: '#c76d85' }}>View missing ›</button>
            )}
          </div>
        </div>
      )}

      {/* Summary + hairline rows, or the empty state. Cards join a list from the
          card sheet's "Add to a list" - there is no inline search here anymore. */}
      {!loaded ? <Loading /> : listRows.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <div style={{ font: "italic 400 15px/1.6 var(--f-read)", color: '#8a8175', marginBottom: 10 }}>No cards yet.</div>
          <button onClick={onGoCards} style={{ background: 'none', border: 'none', cursor: 'pointer', font: "600 14px/1 var(--f-ui)", color: '#c76d85' }}>Browse the catalog ›</button>
        </div>
      ) : (
        <>
          <div style={{ font: "italic 400 13.5px/1.4 var(--f-read)", color: '#8a7a55', marginBottom: 6 }}>
            {totals.names} card{totals.names === 1 ? '' : 's'}{isWanted && totals.done > 0 ? ` · ${totals.done} complete` : ''}
          </div>
          {listRows.map((c) => (
            <ListCardRow key={c.card_id} card={c} owned={ownQty.get(c.card_id) || 0} target={targetOf(c.card_id)}
              isWanted={isWanted} onStep={(d) => step(c.card_id, d)} onPeek={() => onPeek(c.card_id)} />
          ))}
        </>
      )}

      {/* List actions live on the 3-dot FAB (matches the deck FAB spine). Delete
          routes through its OWN confirm sheet - destructive and undoable-never,
          so it is never one tap. */}
      <Fab variant="deck" label="List options" icon={<FabGlyph kind="dots" />} items={[
        { label: 'Add cards', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>, onClick: onGoCards },
        { label: 'Edit list', icon: EditSvg, onClick: () => setRename(true) },
        { label: 'Duplicate list', icon: CopySvg, onClick: async () => { await duplicateList(list.id); toast('List duplicated'); onBack(); } },
        { label: 'Export as text', icon: TextImportSvg, onClick: () => setExportOpen(true) },
        ...(isWanted ? [{ label: 'Get missing cards', icon: SeekSvg, onClick: openMissing }] : []),
        { label: 'Delete list', icon: TrashSvg, danger: true, onClick: () => setConfirmDel(true) },
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
