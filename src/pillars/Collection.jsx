// Collection pillar - the card OWNERSHIP ledger. Overview (glance stats + how many
// decks are buildable + recently added) and Cards (search the catalog, one-tap +/-
// to record what you Own or Want). Rows are the binder-style CollectionCardRow;
// tapping a card opens the shared CollectionCardSheet (ownership steppers +
// Codex hand-off) lifted to the pillar root. Data layer is ownedRepository +
// compareEngine. Accent is ruby, chrome-only.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPool, listDecks } from '../store/deckRepository.js';
import { parseQuery, cardMatchesQuery } from '../store/cardQuery.js';
import {
  ownWantMap, qtyFor, setOwned, setWanted, ownedMap, collectionStats, recentlyAdded,
  deckBuildabilityBulk, subscribeCollection,
  listCardLists, createList, renameList, duplicateList, deleteList,
  setListEntry, listProgress, listProgressBulk, listCards,
} from '../store/ownedRepository.js';
import { Chip, ChipRow, Loading, BottomSheet, BTN_GOLD, BTN_GHOST } from '../components/ui.jsx';
import CollectionCardRow from '../components/CollectionCardRow.jsx';
import CollectionCardSheet from '../components/CollectionCardSheet.jsx';
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

// Where-you-left-off cache. App unmounts the whole pillar when a Codex detail
// opens ("Open in Codex" included), so this survives the round-trip: coming Back
// re-mounts Collection exactly as it was - same view, search, filter, open list,
// even the open card sheet. Module-level = session-scoped, deliberately not
// persisted (a fresh launch starts at Overview).
const session = { view: 'overview', listOpen: null, sheetCard: null, q: '', filter: 'all' };

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
        <Overview onGoCards={() => go('cards')} onGoDecks={onGoDecks} onGoLists={() => go('lists')} onPeek={setSheetCard} rev={rev} />
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

function Overview({ onGoCards, onGoDecks, onPeek, rev }) {
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [deckStat, setDeckStat] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [s, r, decks] = await Promise.all([collectionStats(), recentlyAdded(6), listDecks()]);
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
        <Tile label="DECKS BUILDABLE" value={deckStat ? `${deckStat.buildable}/${deckStat.total}` : '—'} sub="from your collection" onClick={onGoDecks} />
      </div>

      {recent.length > 0 ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '4px 0 8px' }}>
            <span style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.16em', color: 'var(--accent-ruby)' }}>RECENTLY ADDED</span>
            <button onClick={onGoCards} style={{ background: 'none', border: 'none', color: 'var(--ink-muted)', font: "600 12px/1 var(--f-ui)", cursor: 'pointer' }}>All cards ›</button>
          </div>
          {recent.map((c) => (
            <CollectionCardRow key={c.card_id} card={c} badge={c.qty_owned} onClick={() => onPeek(c.card_id)} />
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
    </div>
  );
}

/* ---------------- Cards (record owned / wanted) ---------------- */

function Cards({ onOpen, onPeek }) {
  const [q, setQ] = useState(session.q);
  const [filter, setFilter] = useState(session.filter);   // all | owned | wishlist | missing
  useEffect(() => { session.q = q; session.filter = filter; }, [q, filter]);
  const [pool, setPool] = useState(null);
  const [ow, setOw] = useState(new Map());         // card_id -> {owned(reg), foil, wanted} (optimistic)
  // No mode toggle: steppers always edit Owned - except in the Wishlist filter,
  // where the visible filter IS the mode and they edit Wanted.
  const field = filter === 'wishlist' ? 'wanted' : 'owned';

  async function loadPool() {
    const parsed = parseQuery(q);
    const rows = await getPool({ q: parsed.name });
    const list = parsed.clauses.length ? rows.filter((c) => cardMatchesQuery(c, parsed)) : rows;
    setPool(list);
  }
  useEffect(() => { const t = setTimeout(loadPool, 130); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);
  useEffect(() => { ownWantMap().then(setOw); }, []);
  // Keep the list live with edits made elsewhere (the shared card sheet writes
  // via its own ledger hook). Debounced 250ms so our own optimistic steps get
  // their serialChain writes committed before the re-read; simple, and worst
  // case the refresh lands on the same values we already show.
  useEffect(() => {
    let t = null;
    const off = subscribeCollection(() => {
      clearTimeout(t);
      t = setTimeout(() => ownWantMap().then(setOw), 250);
    });
    return () => { clearTimeout(t); off(); };
  }, []);

  const val = (id, key) => (ow.get(id)?.[key] || 0);
  function step(cardId, delta) {
    // Optimistic UI off the cached ow map; the WRITE never trusts that map. It
    // queues on the app-wide per-card ownedChains and re-reads qtyFor inside its
    // turn, so an edit made in the shared card sheet (its own optimistic ledger)
    // can't be reverted by an absolute write off our debounced/stale cache.
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

  const FILTERS = [['all', 'All'], ['owned', 'Owned'], ['wishlist', 'Wishlist'], ['missing', 'Missing']];
  // Owned/Missing judge by TOTAL copies (regular + foil): a foil-only card is
  // still a card you own.
  const shown = (pool || []).filter((c) => {
    const t = val(c.card_id, 'owned') + val(c.card_id, 'foil'), w = val(c.card_id, 'wanted');
    if (filter === 'owned') return t > 0;
    if (filter === 'wishlist') return w > 0;
    if (filter === 'missing') return t === 0;
    return true;
  });

  return (
    <div style={{ padding: '0 20px' }}>
      <div className="cx-search-pill" style={{ marginBottom: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cards…" aria-label="Search your collection"
          style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)", flex: 1 }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <ChipRow>
          {FILTERS.map(([k, label]) => <Chip key={k} label={label} active={filter === k} onClick={() => setFilter(k)} />)}
        </ChipRow>
      </div>

      {pool == null ? <Loading /> : shown.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', font: "400 15px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>
          {filter === 'all' ? 'No cards match.' : `No ${filter} cards${q ? ' match' : ' yet'}.`}
        </div>
      ) : (
        <>
          <div style={{ font: "400 11.5px/1 var(--f-ui)", color: 'var(--ink-faint)', textAlign: 'right', margin: '2px 2px 6px' }}>
            {shown.length} cards{shown.length > 250 ? ' · showing 250 — refine' : ''}
          </div>
          {shown.slice(0, 250).map((c) => {
            const o = val(c.card_id, 'owned'), f = val(c.card_id, 'foil'), w = val(c.card_id, 'wanted');
            const wishlist = filter === 'wishlist';
            // Steppers edit REGULAR copies; foils are edited in the card sheet
            // (their own row) and read here as a quiet ✦ chip.
            const chips = [];
            if (f > 0) chips.push(<span key="f" title="Foil copies" style={chipStyle('var(--gold-head)')}>✦ {f}</span>);
            if (!wishlist && w > 0) chips.push(<span key="w" title="On your wishlist" style={chipStyle()}>♡ {w}</span>);
            if (wishlist && o + f > 0) chips.push(<span key="o" title="Copies owned" style={chipStyle()}>own {o + f}</span>);
            return (
              <CollectionCardRow key={c.card_id} card={c} dim={o + f === 0 && !wishlist} chip={chips.length ? chips : null}
                stepper={{ value: wishlist ? w : o, onStep: (d) => step(c.card_id, d) }}
                onClick={() => onPeek(c.card_id)} />
            );
          })}
        </>
      )}

      <Fab variant="lib" label="Scan cards" icon={<FabGlyph kind="camera" />}
        onClick={() => launchScanner({ onOpenCard: (id, name) => onOpen('card', id, name) })} />
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

function MenuRow({ label, tone, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', width: '100%', alignItems: 'center', padding: '13px 6px', textAlign: 'left',
      background: 'none', border: 'none', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer',
      font: "600 15px/1 var(--f-read)", color: tone === 'danger' ? 'var(--destructive)' : 'var(--ink-body)',
    }}>{label}</button>
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
    ? 'A named goal — Collection tracks how close you are as you record the cards you own.'
    : kind === 'custom' ? 'A custom grouping — a trade binder, a cube, cards to sell.' : '';
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
      <Section title="WANTED LISTS" hint="Named goals — Collection tracks your progress as you acquire cards." onAdd={() => setCreate('wanted')}>
        {wanted.length
          ? wanted.map((l) => <ListRowCard key={l.id} list={l} progress={progress.get(l.id)} onClick={() => onOpenList(l)} />)
          : <Empty text="No wanted lists yet — set a goal and watch it fill in." />}
      </Section>
      <Section title="CARD LISTS" hint="Custom groupings — a trade binder, a cube, cards to sell." onAdd={() => setCreate('custom')}>
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
  const [menuOpen, setMenuOpen] = useState(false);
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
    return (
      <CollectionCardRow key={c.card_id} card={c} dim={own === 0} chip={chip}
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
        <button onClick={() => setMenuOpen(true)} aria-label="List options" style={iconBtn}>⋯</button>
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
                : <>You own {totals.have} of {totals.req} · <span style={{ color: 'var(--accent-ruby)' }}>missing {totals.missing}</span> — tap for list</>}
            </div>
          </div>
        </div>
      )}

      <div className="cx-search-pill" style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add cards — search the catalog…" aria-label="Add cards to this list"
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

      <BottomSheet open={menuOpen} title={isWanted ? 'WANTED LIST' : 'CARD LIST'} onClose={() => { setMenuOpen(false); setConfirmDel(false); }}>
        {confirmDel ? (
          <>
            <div style={{ font: "400 14px/1.5 var(--f-read)", color: 'var(--ink-body)', textAlign: 'center', marginBottom: 16 }}>Delete “{meta.name}”? This can’t be undone.</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmDel(false)} style={{ ...BTN_GHOST, flex: 1 }}>Cancel</button>
              <button onClick={async () => { await deleteList(list.id); toast('List deleted'); onBack(); }} style={{ ...BTN_GHOST, flex: 1, color: 'var(--destructive)', borderColor: 'rgba(168,88,74,.5)' }}>Delete</button>
            </div>
          </>
        ) : (
          <>
            <MenuRow label="Rename / edit description" onClick={() => { setMenuOpen(false); setRename(true); }} />
            <MenuRow label="Duplicate list" onClick={async () => { setMenuOpen(false); await duplicateList(list.id); toast('List duplicated'); onBack(); }} />
            {isWanted && <MenuRow label="Get missing cards" onClick={() => { setMenuOpen(false); openMissing(); }} />}
            <MenuRow label="Delete list" tone="danger" onClick={() => setConfirmDel(true)} />
          </>
        )}
      </BottomSheet>

      <ListNameSheet open={rename} kind={isWanted ? 'wanted' : 'custom'} title="RENAME LIST"
        initialName={meta.name} initialDesc={meta.description || ''} submitLabel="Save"
        onClose={() => setRename(false)}
        onSubmit={async (nm, desc) => { await renameList(list.id, nm, desc); setMeta((m) => ({ ...m, name: nm, description: desc })); setRename(false); }} />

      <MissingSheet open={!!missing} report={missing} title={`Missing for ${meta.name}`}
        onOpenCard={(id) => onOpen('card', id)} onClose={() => setMissing(null)} onChanged={() => onChanged?.()} />
    </div>
  );
}
