// Decks pillar - Library / My Deck toggle in the app's own chip style (matching
// Home/Codex), NOT a bespoke pager. Search isn't a tab: adding cards is an
// "Add cards to deck" action on My Deck that opens the existing add-cards flow.
// `deckOpen` (the loaded deck) is lifted to App so it survives that flow.
import React, { useEffect, useRef, useState } from 'react';
import {
  listDecks, getDeck, toggleStar, renameDeck, duplicateDeck, deleteDeck,
  historyCount, clearHistory, exportMarkdown, exportCuriosa, getDeckCards,
} from '../store/deckRepository.js';
import { deckMatchCount } from '../store/playRepository.js';
import { shareDeckPoster } from '../store/deckPoster.js';
import { DeckCard } from './Decks.jsx';
import { Chip, ChipRow, Loading, useSwipe, BlankState } from '../components/ui.jsx';
import { haptic } from '../native.js';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import Sheet from '../components/Sheet.jsx';
import { confirmAction } from '../feedback.js';
import DeckDashboard from './DeckDashboard.jsx';
import '../theme/deckpager.css';

const BASE = import.meta.env.BASE_URL;

export default function DecksPager({ onNew, onImport, onAddCards, deckOpen, onOpenDeck, onOpenCodex, onChanged, editMode, onEditMode, rev }) {
  const [view, setView] = useState(deckOpen ? 'mydeck' : 'library');
  const [statTab, setStatTab] = useState('list');   // My Deck inner: list | stats
  const setEditMode = onEditMode;   // lifted to App so it survives the add-cards flow
  const [decks, setDecks] = useState(null);
  const [libQ, setLibQ] = useState('');
  // Deck-actions FAB state (Arcanum's #deck-fab menu).
  const [meta, setMeta] = useState(null);            // loaded deck (for star state)
  const [rarityOn, setRarityOn] = useState(false);   // Rarity-colours toggle
  const [exportOpen, setExportOpen] = useState(false);
  const [spreadOpen, setSpreadOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [toast, setToast] = useState('');
  const toastT = useRef();
  function flash(msg, ms = 1900) { setToast(msg); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(''), ms); }

  async function refresh() { setDecks(await listDecks()); }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [rev]);
  // Opening/creating/importing a deck (deckOpen changes id) jumps to My Deck;
  // the user can still toggle back to Library freely afterward. editMode is only
  // dropped on a genuine id change - NOT on the remount after the add-cards flow
  // (which is why editMode lives in App, not here).
  const prevIdRef = useRef(deckOpen?.id);
  useEffect(() => {
    if (deckOpen) { setView('mydeck'); setStatTab('list'); }
    if (prevIdRef.current !== deckOpen?.id) { setEditMode(false); prevIdRef.current = deckOpen?.id; }
    // eslint-disable-next-line
  }, [deckOpen?.id]);
  // Leaving the deck (or its list view) always exits edit mode.
  useEffect(() => { if (view !== 'mydeck' || statTab !== 'list') setEditMode(false); }, [view, statTab]);
  // Keep the loaded-deck meta (name, starred) fresh for the FAB menu.
  useEffect(() => { let a = true; if (deckOpen) getDeck(deckOpen.id).then((d) => a && setMeta(d)); else setMeta(null); return () => { a = false; }; }, [deckOpen?.id, rev]);

  function openDeck(d) { onOpenDeck({ id: d.id, name: d.name }); setView('mydeck'); }

  /* ── Deck-actions FAB handlers (verbatim Arcanum #deck-fab behaviour) ── */
  async function actFavourite() {
    await toggleStar(deckOpen.id);
    const d = await getDeck(deckOpen.id); setMeta(d);
    flash(d.starred ? '★ Favourited' : '☆ Unfavourited');
    refresh();   // library re-sorts starred-first
  }
  async function actRename(name) {
    const n = (name || '').trim();
    setRenameOpen(false);
    if (!n || n === deckOpen.name) return;
    await renameDeck(deckOpen.id, n);
    onOpenDeck({ id: deckOpen.id, name: n });
    refresh(); onChanged?.(); flash('Deck renamed');   // onChanged bumps app rev → dashboard hero reloads
  }
  async function actDuplicate() {
    const nid = await duplicateDeck(deckOpen.id);
    if (!nid) return;
    const d = await getDeck(nid);
    refresh(); onOpenDeck({ id: nid, name: d.name });
    flash(`Duplicated as “${d.name}”`);
  }
  async function actShareImage() {
    flash('Building image…', 8000);
    try { await shareDeckPoster(deckOpen.id); flash('Image ready'); }
    catch { flash('Could not build image'); }
  }
  async function actClearLog() {
    const n = await historyCount(deckOpen.id);
    if (!n) { flash('Log is already empty'); return; }
    if (!(await confirmAction({ title: 'Clear deck log?', body: `This removes all ${n} log entr${n === 1 ? 'y' : 'ies'}. This can’t be undone.`, confirmLabel: 'Clear log', danger: true }))) return;
    await clearHistory(deckOpen.id); flash('Deck log cleared');
  }
  async function actDelete() {
    // Ripple-aware: matches outlive their deck (they keep their history, just
    // lose the deck link), so say so up front.
    const n = await deckMatchCount(deckOpen.id);
    const body = n
      ? `The deck and its log are removed for good. Its ${n} match${n === 1 ? '' : 'es'} stay in your history but lose the deck link. This can’t be undone.`
      : 'The deck and its log are removed for good. This can’t be undone.';
    if (!(await confirmAction({ title: `Delete “${deckOpen.name}”?`, body, confirmLabel: 'Delete deck', danger: true }))) return;
    await deleteDeck(deckOpen.id);
    onOpenDeck(null); setView('library'); refresh(); flash('Deck deleted');
  }
  const deckFabItems = [
    { label: 'Favourite', keepOpen: true, state: meta?.starred ? '★' : '☆', onClick: actFavourite },
    { label: 'Rarity colours', keepOpen: true, state: rarityOn ? '✓' : '✕', onClick: () => setRarityOn((v) => !v) },
    { label: 'Deck Spread', onClick: () => setSpreadOpen(true) },
    { label: 'Rename', onClick: () => setRenameOpen(true) },
    { label: 'Duplicate', onClick: actDuplicate },
    { label: 'Export', onClick: () => setExportOpen(true) },
    { label: 'Share as image', onClick: actShareImage },
    { label: 'Clear log', onClick: actClearLog },
    { label: 'Delete Deck', danger: true, onClick: actDelete },
  ];

  const libList = (decks || []).filter((d) => !libQ
    || d.name.toLowerCase().includes(libQ.toLowerCase())
    || (d.avatar?.name || '').toLowerCase().includes(libQ.toLowerCase()));

  // Native feel: swipe across the Library ⇄ My Deck (List ⇄ Stats) chain.
  const swipe = useSwipe(
    () => {   // swipe left - deeper into the deck
      if (view === 'library' && deckOpen) { setView('mydeck'); haptic('light'); }
      else if (view === 'mydeck' && deckOpen && statTab === 'list') { setStatTab('stats'); haptic('light'); }
    },
    () => {   // swipe right - back out
      if (view === 'mydeck' && statTab === 'stats') { setStatTab('list'); haptic('light'); }
      else if (view === 'mydeck') { setView('library'); haptic('light'); }
    }
  );

  return (
    <div className="arc dpager" {...swipe}>
      <div className="dp-topbar">
        <ChipRow>
          <Chip label="Library" active={view === 'library'} onClick={() => setView('library')} />
          <Chip label="My Deck" active={view === 'mydeck'} onClick={() => setView('mydeck')} />
        </ChipRow>
        <div className="dp-topbar-spacer" />
        {view === 'mydeck' && deckOpen && statTab === 'list' && (
          <button className={`dp-add-pill${editMode ? ' on' : ''}`} onClick={() => setEditMode((v) => !v)}>
            {editMode ? '✓ Done' : '✎ Edit Deck'}
          </button>
        )}
      </div>

      {view === 'library' ? (
        <div className="dp-view">
          <div className="dpage-scroll">
            {decks == null ? <Loading />
              : libList.length === 0 ? (
                <BlankState hue="160,110,220" title={decks.length === 0 ? 'No Decks Yet' : 'No matches'}
                  body={decks.length === 0 ? <>Build or import a deck<br />to start your collection.</> : null} />
              ) : libList.map((d) => <DeckCard key={d.id} deck={d} onClick={() => openDeck(d)} />)}
          </div>
          <div className="pill-bar-outer">
            <div className={`bottom-pill-bar${libQ ? ' has-text' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input type="search" value={libQ} onChange={(e) => setLibQ(e.target.value)} placeholder="Search decks…" autoComplete="off" />
            </div>
          </div>
        </div>
      ) : (
        <div className="dp-view">
          {deckOpen ? (
            <>
              <div className="dpage-scroll">
                <DeckDashboard deckId={deckOpen.id} rev={rev} statTab={statTab} rarityOn={rarityOn}
                  editMode={editMode} onToast={flash} onChanged={onChanged} onOpenCodex={onOpenCodex}
                  onMissing={() => { onOpenDeck(null); setView('library'); refresh(); }} />
              </div>
              {/* List/Stats pip bar steps aside while editing - edit mode owns the floor. */}
              <div className={`deck-pip-bar${editMode ? ' hidden' : ''}`}>
                <div className="pip-seg" onClick={() => setStatTab('list')}>
                  <span className={`pip-dot${statTab === 'list' ? ' active' : ''}`} />
                  <span className={`pip-seg-label${statTab === 'list' ? ' active' : ''}`}>List</span>
                </div>
                <span className="pip-divider" />
                <div className="pip-seg" onClick={() => setStatTab('stats')}>
                  <span className={`pip-seg-label${statTab === 'stats' ? ' active' : ''}`}>Stats</span>
                  <span className={`pip-dot${statTab === 'stats' ? ' active' : ''}`} />
                </div>
              </div>
            </>
          ) : (
            <BlankState hue="160,110,220" title="No Deck Open" body={<>Choose a deck from your Library<br />to start building.</>} />
          )}
        </div>
      )}

      {/* Per-view FAB */}
      {view === 'library' && (
        <Fab variant="lib" icon={<FabGlyph kind="add" />} label="New deck options" items={[
          { label: 'New Deck', onClick: onNew },
          { label: 'Import from Curiosa', onClick: () => onImport('url') },
          { label: 'Import from text', onClick: () => onImport('text') },
        ]} />
      )}
      {view === 'mydeck' && deckOpen && (
        editMode ? (
          // Edit mode: the FAB becomes a magnifying glass - the doorway to the
          // full searchable card list. The key forces a remount so the spin-in
          // (now built into Fab) replays on the role change.
          <Fab key="search" variant="deck" icon={<FabGlyph kind="search" />}
            label="Search all cards" onClick={onAddCards} />
        ) : (
          <Fab key="menu" variant="deck" icon={<FabGlyph kind="dots" />}
            label="Deck actions" items={deckFabItems} />
        )
      )}

      <ExportSheet open={exportOpen} deckId={deckOpen?.id} onClose={() => setExportOpen(false)} flash={flash} />
      <DeckSpreadSheet open={spreadOpen} deckId={deckOpen?.id} onClose={() => setSpreadOpen(false)} />
      <RenameSheet open={renameOpen} initial={deckOpen?.name || ''} onClose={() => setRenameOpen(false)} onSave={actRename} />
      <div className={`arc a-toast${toast ? ' show' : ''}`}>{toast}</div>
    </div>
  );
}

// Rename - small a-sheet with a single field (replaces the native prompt()).
function RenameSheet({ open, initial, onClose, onSave }) {
  const [name, setName] = useState(initial);
  useEffect(() => { if (open) setName(initial); }, [open, initial]);
  return (
    <Sheet open={open} title="Rename Deck" onClose={onClose}>
      <div style={{ padding: '0 16px', display: 'flex', gap: 10 }}>
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSave(name); }}
          style={{ flex: 1, height: 44, background: 'rgba(11,7,20,.7)', border: '1px solid rgba(160,110,220,.25)', borderRadius: 12, padding: '0 14px', color: 'var(--text)', font: "400 15px/1 'EB Garamond',Georgia,serif" }} />
        <button onClick={() => onSave(name)}
          style={{ padding: '0 18px', borderRadius: 12, background: 'rgba(18,16,13,.85)', color: '#dcb86f', font: "700 13px/1 'Hanken Grotesk',sans-serif", border: '1px solid rgba(220,184,111,.45)', cursor: 'pointer' }}>Save</button>
      </div>
    </Sheet>
  );
}

// Export - Arcanum's #export-sheet: Markdown (readable) / Curiosa (flat) toggle
// with a copy-to-clipboard action.
function ExportSheet({ open, deckId, onClose, flash }) {
  const [fmt, setFmt] = useState('markdown');
  const [text, setText] = useState('');
  useEffect(() => {
    if (!open || !deckId) return;
    let a = true;
    (fmt === 'curiosa' ? exportCuriosa(deckId) : exportMarkdown(deckId)).then((t) => a && setText(t));
    return () => { a = false; };
  }, [open, deckId, fmt]);
  async function copy() {
    try { await navigator.clipboard.writeText(text); flash?.('Copied to clipboard'); }
    catch { flash?.('Copy failed'); }
  }
  return (
    <Sheet open={open} title="Export Deck" onClose={onClose}
      footer={<button className="es-copy-btn" onClick={copy}>Copy to clipboard</button>}>
      <div className="es-format-row">
        <div className="es-format-wrap">
          <button className={`es-format-btn${fmt === 'markdown' ? ' on' : ''}`} onClick={() => setFmt('markdown')}>Markdown</button>
          <button className={`es-format-btn${fmt === 'curiosa' ? ' on' : ''}`} onClick={() => setFmt('curiosa')}>Curiosa</button>
        </div>
      </div>
      <div className="es-hint">{fmt === 'curiosa' ? 'Flat “qty name” list for curiosa.io import.' : 'Readable list grouped by zone and type.'}</div>
      <textarea className="es-area" readOnly value={text} onFocus={(e) => e.target.select()} />
    </Sheet>
  );
}

// Deck Spread - Arcanum's #deckcards-sheet: one tile per distinct card (×N badge
// for extra copies), grouped by zone. Deck = ordered; Shuffle = shuffled WITHIN
// each zone (Spellbook & Atlas stay separate sections).
function DeckSpreadSheet({ open, deckId, onClose }) {
  const [zones, setZones] = useState(null);
  const [shuf, setShuf] = useState(null);   // null = Deck (ordered); else shuffled entry arrays
  useEffect(() => {
    if (!open || !deckId) return;
    setShuf(null); setZones(null);
    let a = true; getDeckCards(deckId).then((z) => a && setZones(z));
    return () => { a = false; };
  }, [open, deckId]);

  const sortEntries = (l, byCost) => [...(l || [])].sort((a, b) =>
    byCost ? (a.cost ?? 999) - (b.cost ?? 999) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  const shuffleArr = (l) => { const a = [...(l || [])]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function doShuffle() {
    setShuf({ spellbook: shuffleArr(zones.spellbook), atlas: shuffleArr(zones.atlas), collection: shuffleArr(zones.collection) });
  }

  const tile = (e, i) => (
    <div key={e.card_id + '-' + i} className="ds-tile" style={{ aspectRatio: e.is_site ? '4.1 / 3' : '3 / 4.1' }}>
      {e.image_slug && <img src={`${BASE}cards/${e.image_slug}`} loading="lazy" alt=""
        onError={(ev) => { ev.currentTarget.style.display = 'none'; }}
        style={e.is_site ? { position: 'absolute', top: '50%', left: '50%', width: 'calc(100% * 3 / 4.1)', height: 'calc(100% * 4.1 / 3)', objectFit: 'cover', transform: 'translate(-50%,-50%) rotate(90deg)' } : undefined} />}
      {e.quantity > 1 && <span className="ds-qty">×{e.quantity}</span>}
    </div>
  );
  const section = (label, list) => list && list.length > 0 && (
    <div key={label}>
      <div className="ds-lbl">{label} ({list.reduce((s, e) => s + e.quantity, 0)})</div>
      <div className="ds-grid">{list.map(tile)}</div>
    </div>
  );

  const src = shuf || (zones ? {
    spellbook: sortEntries(zones.spellbook, true),
    atlas: sortEntries(zones.atlas, false),
    collection: sortEntries(zones.collection, false),
  } : null);
  const empty = src && (src.spellbook.length + src.atlas.length + src.collection.length === 0);

  return (
    <Sheet open={open} title="Deck Spread" onClose={onClose}
      footer={
        <div className="ds-toggle-wrap">
          <button className={`ds-view-btn${!shuf ? ' on' : ''}`} onClick={() => setShuf(null)}>Deck</button>
          <button className={`ds-view-btn${shuf ? ' on' : ''}`} onClick={doShuffle}>⤨ Shuffle</button>
        </div>
      }>
      {!src ? <Loading />
        : empty ? <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--muted)', fontStyle: 'italic' }}>No cards in this deck yet.</div>
          : <>{section('Spellbook', src.spellbook)}{section('Atlas', src.atlas)}{section('Collection', src.collection)}</>}
    </Sheet>
  );
}
