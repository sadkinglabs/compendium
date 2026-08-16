// Decks pillar - Library / My Deck toggle in the app's own chip style (matching
// Home/Codex), NOT a bespoke pager. Search isn't a tab: adding cards is an
// "Add cards to deck" action on My Deck that opens the existing add-cards flow.
// `deckOpen` (the loaded deck) is lifted to App so it survives that flow.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  listDecks, getDeck, toggleStar, renameDeck, duplicateDeck, deleteDeck,
  historyCount, clearHistory, exportMarkdown, exportCuriosa, getDeckCards,
  planDeckTextAdd, applyDeckAdds, setAvatar,
} from '../store/deckRepository.js';
import { activeProfileId } from '../store/profileRepository.js';
import { deckMatchCount } from '../store/playRepository.js';
import { DeckCard } from './Decks.jsx';
import { Chip, ChipRow, SegTabs, IcList, IcStats, Loading, useSwipe, BlankState } from '../components/ui.jsx';
import { ShuffleIcon } from '../components/icons.jsx';
import { ArtImg } from '../components/ArtImage.jsx';
import { haptic, shareLink } from '../native.js';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import SearchPill from '../components/SearchPill.jsx';
import DockLeft from '../components/DockLeft.jsx';
import Sheet from '../components/Sheet.jsx';
import QRCode from '../components/QRCode.jsx';
import { buildDeckShare } from '../store/deckShare.js';
import { launchScanner } from '../cardScanner.js';
import { toast, confirmAction } from '../feedback.js';
import DeckDashboard from './DeckDashboard.jsx';
import '../theme/deckpager.css';
import PillarLoading from '../components/PillarLoading.jsx';


// Library FAB menu iconography: build a deck (the app's stacked-cards glyph),
// import from a Curiosa URL (a link), or import from pasted text (a document).
const NewDeckSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="13" height="17" rx="2" /><rect x="8" y="2" width="13" height="17" rx="2" /></svg>;
const CuriosaSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l2.5-2.5a5 5 0 0 0-7.07-7.07l-1.4 1.4" /><path d="M14 11a5 5 0 0 0-7.07 0L4.43 13.5a5 5 0 0 0 7.07 7.07l1.4-1.4" /></svg>;
const TextImportSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="14 3 14 9 20 9" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>;
const QrSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><line x1="14" y1="14" x2="14" y2="17" /><line x1="17" y1="14" x2="21" y2="14" /><line x1="21" y1="17" x2="21" y2="21" /><line x1="14" y1="21" x2="17" y2="21" /></svg>;
const CameraSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l1.5-2.2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.2" /></svg>;

// The last deck list, kept across pillar mounts (module state, same pattern as artCache's
// memo) so the Library paints complete on the first frame - cards and (via the art memo)
// heroes together - instead of arriving in waves that resize the tiles. Stale-while-
// revalidate: the mount effect refreshes it silently. Profile-keyed, so a switch can
// never show another profile's library. (The buildability badge cache that lived beside
// this retired with the library badges - owner call 2026-08-14.)
let deckListCache = { pid: null, decks: null };

// The last Decks view, kept across pillar mounts: leaving the pillar from the
// LIBRARY returns to the Library, even while a deck stays open - parity with the
// app-wide nav/back behaviour (owner call 2026-08-14). `ref` is the deckOpen
// OBJECT the view belonged to: every explicit open (deck card, Home carousel,
// import, resume) creates a fresh object in App, so identity distinguishes a
// plain tab-return (same object - honour the memo) from a genuine open (new
// object - jump to My Deck), even when the deck id is unchanged.
let viewMemo = { view: null, ref: null };

// Library search text, kept across pillar mounts - parity with Collection, whose
// refine session already survives an unmount (the search-contract rule: pillar-level
// search state persists; sheet-level search resets). Profile-keyed like the deck
// list cache so a switch never shows another profile's query.
let libQMemo = { pid: null, q: '' };

export default function DecksPager({ onNew, onImport, onImportMatch, onAddCards, deckOpen, onOpenDeck, onOpenCodex, onChanged, editMode, onEditMode, rev, pillSlot }) {
  const [view, setView] = useState(() =>
    deckOpen ? ((viewMemo.ref === deckOpen && viewMemo.view) || 'mydeck') : 'library');
  const [statTab, setStatTab] = useState('list');   // My Deck inner: list | stats
  const setEditMode = onEditMode;   // lifted to App so it survives the add-cards flow
  const [decks, setDecks] = useState(() => {
    try { return activeProfileId() === deckListCache.pid ? deckListCache.decks : null; }
    catch { return null; }
  });
  const [libQ, setLibQ] = useState(() => {
    try { return activeProfileId() === libQMemo.pid ? libQMemo.q : ''; } catch { return ''; }
  });
  useEffect(() => { try { libQMemo = { pid: activeProfileId(), q: libQ }; } catch { /* pre-boot */ } }, [libQ]);
  // Deck-actions FAB state (Deckbuilder's #deck-fab menu).
  const [meta, setMeta] = useState(null);            // loaded deck (for star state)
  const [rarityOn, setRarityOn] = useState(false);   // Rarity-colours toggle
  const [exportOpen, setExportOpen] = useState(false);
  const [spreadOpen, setSpreadOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [textAddOpen, setTextAddOpen] = useState(false);
  // Route through the app-wide toast() host (one toast system) - kept as `flash`
  // so the many call sites + the onToast/flash props don't have to change.
  const flash = (msg, ms) => toast(msg, ms ? { ms } : {});


  async function refresh() {
    const d = await listDecks();
    try { deckListCache = { pid: activeProfileId(), decks: d }; } catch { /* pre-init: not cached */ }
    setDecks(d);
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [rev]);
  // Remember the view (and the deckOpen object it belonged to) across pillar mounts.
  useEffect(() => { viewMemo = { view, ref: deckOpen ?? null }; }, [view, deckOpen]);
  // Opening/creating/importing a deck (deckOpen changes id) jumps to My Deck;
  // the user can still toggle back to Library freely afterward. A pillar-return
  // REMOUNT is not an open - the guard below skips it, so the remembered view
  // survives (pre-fix, this effect forced My Deck on every return). editMode is
  // only dropped on a genuine id change - NOT on the remount after the add-cards
  // flow (which is why editMode lives in App, not here).
  const prevIdRef = useRef(deckOpen?.id);
  useEffect(() => {
    if (prevIdRef.current === deckOpen?.id) return;
    if (deckOpen) { setView('mydeck'); setStatTab('list'); }
    else setView('library');   // closing the deck (incl. hardware back) returns to the Library list
    setEditMode(false);
    prevIdRef.current = deckOpen?.id;
    // eslint-disable-next-line
  }, [deckOpen?.id]);
  // Leaving the deck (or its list view) always exits edit mode.
  useEffect(() => { if (view !== 'mydeck' || statTab !== 'list') setEditMode(false); }, [view, statTab]);
  // Keep the loaded-deck meta (name, starred) fresh for the FAB menu.
  useEffect(() => { let a = true; if (deckOpen) getDeck(deckOpen.id).then((d) => a && setMeta(d)); else setMeta(null); return () => { a = false; }; }, [deckOpen?.id, rev]);

  function openDeck(d) { onOpenDeck({ id: d.id, name: d.name }); setView('mydeck'); }

  /* ── Deck-actions FAB handlers (Deckbuilder #deck-fab behaviour) ── */
  async function actFavourite() {
    await toggleStar(deckOpen.id);
    const d = await getDeck(deckOpen.id); setMeta(d);
    flash(d.starred ? 'Favourited' : 'Unfavourited');
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
    // The poster renderer (canvas + wrap/glyph code) is a cold path - load on tap.
    try { const { shareDeckPoster } = await import('../store/deckPoster.js'); await shareDeckPoster(deckOpen.id); flash('Image ready'); }
    catch (e) { flash('Poster failed: ' + (e?.message || String(e)), 8000); }
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
  // Return true when the pager consumes the swipe (paged an inner view); at an edge
  // return falsy so the gesture bubbles up to the app-level cross-pillar swipe.
  const swipe = useSwipe(
    () => {   // swipe left - deeper into the deck
      if (view === 'library' && deckOpen) { setView('mydeck'); haptic('light'); return true; }
      if (view === 'mydeck' && deckOpen && statTab === 'list') { setStatTab('stats'); haptic('light'); return true; }
      return false;
    },
    () => {   // swipe right - back out
      if (view === 'mydeck' && statTab === 'stats') { setStatTab('list'); haptic('light'); return true; }
      if (view === 'mydeck') { setView('library'); haptic('light'); return true; }
      return false;
    }
  );

  // Top segmented control -> shared header slot (App.pillSlot), wrapped in .cx-decks so
  // its scoped styles (dp-topbar/dp-add-pill) still apply outside the pager. Padding
  // is overridden to match the other pillars' hoisted pill rows.
  const topbar = (
    <div className="dp-topbar" style={{ padding: '0 20px 10px' }}>
      <ChipRow>
        <Chip label="Library" active={view === 'library'} onClick={() => setView('library')} />
        <Chip label="My Deck" active={view === 'mydeck'} onClick={() => setView('mydeck')} />
      </ChipRow>
      <div className="dp-topbar-spacer" />
      {view === 'mydeck' && deckOpen && (
        <Chip label={editMode ? 'Done' : 'Edit Deck'} active={editMode} onClick={() => { setStatTab('list'); setEditMode((v) => !v); }} />
      )}
    </div>
  );
  return (
    <div className="cx-decks dpager" {...swipe}>
      {/* The portal lands outside this subtree, so the scope has to travel with it -
          the pill's styling is defined under `.cx-decks` like the rest. */}
      {pillSlot ? createPortal(<div className="cx-decks">{topbar}</div>, pillSlot) : topbar}

      {view === 'library' ? (
        <div className="dp-view">
          <div className="dpage-scroll">
            {decks == null ? <PillarLoading />
              : libList.length === 0 ? (
                <BlankState hue="160,140,192" title={decks.length === 0 ? 'No Decks Yet' : 'No matches'}
                  body={decks.length === 0 ? <>Build or import a deck<br />to start your collection.</> : null} />
              ) : libList.map((d) => <DeckCard key={d.id} deck={d} onClick={() => openDeck(d)} />)}
          </div>
          <SearchPill value={libQ} onChange={setLibQ} onClear={() => setLibQ('')} placeholder="Search decks…" />
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
              {/* List/Stats toggle - docked in the shared bottom dock beside the
                  My Deck FAB (steps aside while editing). */}
              <DockLeft>
                <div className={`deck-pip-bar${editMode ? ' hidden' : ''}`}>
                  <SegTabs ariaLabel="Deck view" value={statTab} onChange={setStatTab}
                    options={[{ key: 'list', label: 'List', icon: <IcList size={14} /> }, { key: 'stats', label: 'Stats', icon: <IcStats size={14} /> }]}
                    style={{ background: 'rgba(11,11,13,.82)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: '0 4px 16px rgba(0,0,0,.45)' }} />
                </div>
              </DockLeft>
            </>
          ) : (
            <BlankState hue="160,140,192" title="No Deck Open" body={<>Choose a deck from your Library<br />to start building.</>} />
          )}
        </div>
      )}

      {/* Per-view FAB */}
      {view === 'library' && (
        <Fab variant="lib" icon={<FabGlyph kind="add" />} label="New deck options" items={[
          { label: 'New Deck', icon: NewDeckSvg, onClick: onNew },
          { label: 'Import from QR', icon: QrSvg, onClick: () => launchScanner({
            onOpenDeck: (id, name) => { onChanged?.(); onOpenDeck({ id, name }); },
            onOpenCard: onOpenCodex, onImportMatch,
          }) },
          { label: 'Import from Curiosa', icon: CuriosaSvg, onClick: () => onImport('url') },
          { label: 'Import from text', icon: TextImportSvg, onClick: () => onImport('text') },
        ]} />
      )}
      {view === 'mydeck' && deckOpen && (
        editMode ? (
          // Edit mode = two stacked FABs. Bottom: the magnifying glass (search the
          // whole library, the current function). Top: a + that rises above it with
          // the bulk-add tools search can't do - scan a card, or paste a list.
          <>
            <Fab key="search" variant="deck" icon={<FabGlyph kind="search" />}
              label="Search all cards" onClick={onAddCards} />
            <Fab key="add" variant="lib" icon={<FabGlyph kind="add" />} className="fab-stacked" label="Add tools" items={[
              { label: 'Add with scanner', icon: CameraSvg, onClick: () => launchScanner({ mode: 'deck', deckId: deckOpen.id, deckName: deckOpen.name || '', onOpenCard: onOpenCodex, onChanged }) },
              { label: 'Add from text', icon: TextImportSvg, onClick: () => setTextAddOpen(true) },
            ]} />
          </>
        ) : (
          <Fab key="menu" variant="deck" icon={<FabGlyph kind="dots" />}
            label="Deck actions" items={deckFabItems} />
        )
      )}

      <ExportSheet open={exportOpen} deckId={deckOpen?.id} onClose={() => setExportOpen(false)} flash={flash} />
      <DeckTextAddSheet open={textAddOpen} deckId={deckOpen?.id} onClose={() => setTextAddOpen(false)} onChanged={onChanged} />
      <DeckSpreadSheet open={spreadOpen} deckId={deckOpen?.id} onClose={() => setSpreadOpen(false)} />
      <RenameSheet open={renameOpen} initial={deckOpen?.name || ''} onClose={() => setRenameOpen(false)} onSave={actRename} />
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
          style={{ flex: 1, height: 44, background: 'rgba(42,33,20,.5)', border: '1px solid #4a3c22', borderRadius: 12, padding: '0 14px', color: '#efe7d8', font: "400 15px/1 var(--f-read)" }} />
        <button onClick={() => onSave(name)}
          style={{ padding: '0 18px', borderRadius: 12, background: 'rgba(18,16,13,.85)', color: '#dcb86f', font: "700 13px/1 var(--f-ui)", border: '1px solid rgba(220,184,111,.45)', cursor: 'pointer' }}>Save</button>
      </div>
    </Sheet>
  );
}

// Add from text - paste a "qty name" list, REVIEW it (a dry-run that resolves each
// line, home-zones it, and caps by the rarity limit), then confirm. The confirmation
// shows exactly what will be added, what was already at its limit, and what wasn't
// recognised - nothing is written until "Add".
function DeckTextAddSheet({ open, deckId, onClose, onChanged }) {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState(null);   // { adds, atLimit, unknown }
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setText(''); setPlan(null); setBusy(false); } }, [open]);

  const review = async () => {
    if (!text.trim() || !deckId || busy) return;
    setBusy(true);
    try { setPlan(await planDeckTextAdd(deckId, text)); }
    catch { toast("Couldn't read that list.", { tone: 'danger' }); }
    setBusy(false);
  };
  const canCommit = !!(plan && (plan.adds.length || plan.avatar));
  const commit = async () => {
    if (!canCommit || busy) return;
    setBusy(true);
    try {
      const n = plan.adds.length ? await applyDeckAdds(deckId, plan.adds) : 0;
      // An avatar in the paste swaps the deck's avatar (it's not a deck card).
      if (plan.avatar) await setAvatar(deckId, plan.avatar.cardId);
      const parts = [];
      if (n) parts.push(`Added ${n} card${n === 1 ? '' : 's'}`);
      if (plan.avatar) parts.push(`avatar → ${plan.avatar.name}`);
      toast(parts.join(' · ') || 'Done');
      onChanged?.();
      onClose();
    } catch { toast("Couldn't apply that.", { tone: 'danger' }); setBusy(false); }
  };
  const totalAdd = plan ? plan.adds.reduce((s, a) => s + a.addQty, 0) : 0;

  const input = { width: '100%', boxSizing: 'border-box', background: 'rgba(42,33,20,.5)', border: '1px solid #4a3c22', borderRadius: 12, padding: '11px 14px', color: '#efe7d8', font: "400 13.5px/1.5 var(--f-mono)", resize: 'none' };
  const ghost = { flex: 1, padding: '13px 0', borderRadius: 12, background: 'transparent', border: '1px solid #4a3c22', color: '#d8c9a4', font: "600 13px/1 var(--f-display)", cursor: 'pointer' };
  const gold = { flex: 1.4, padding: '13px 0', borderRadius: 12, background: 'linear-gradient(180deg,#d8b872,#b8954f)', border: '1px solid #e3c589', color: '#1a1206', font: "700 13px/1 var(--f-display)", cursor: 'pointer' };
  const Section = ({ label, color, children }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ font: "600 10.5px/1 var(--f-display)", letterSpacing: '.18em', color, textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
  const Line = ({ name, note, dim }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderBottom: '1px solid rgba(74,60,34,.3)' }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: "400 14.5px/1.3 var(--f-read)", color: dim ? '#8a8175' : '#d8cebb' }}>{name}</span>
      <span style={{ flex: 'none', font: "600 12.5px/1 var(--f-mono)", color: dim ? '#8a8175' : '#cba75f' }}>{note}</span>
    </div>
  );

  return (
    <Sheet open={open} title="Add from text" onClose={onClose}>
      <div style={{ padding: '0 16px 8px' }}>
        {!plan ? (
          <>
            <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: '#8a8175', marginBottom: 12 }}>
              Paste a list - one per line, like <span style={{ color: '#d8cebb', fontFamily: 'var(--f-mono)' }}>4 Wild Boars</span>. Sites go to Atlas, everything else to Spellbook; rarity limits are respected.
            </div>
            <textarea value={text} autoFocus onChange={(e) => setText(e.target.value)} rows={8}
              placeholder={'4 Wild Boars\n2 Sea Serpent\n1 Avatar of Fire…'} style={input} />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={onClose} style={ghost}>Cancel</button>
              <button onClick={review} disabled={!text.trim() || busy} style={{ ...gold, opacity: text.trim() && !busy ? 1 : 0.5 }}>{busy ? 'Reading…' : 'Review'}</button>
            </div>
          </>
        ) : (
          <>
            {plan.avatar && (
              <Section label="Set avatar" color="#c79ad0">
                <Line name={plan.avatar.name} note="→ avatar" />
              </Section>
            )}
            {plan.adds.length > 0 ? (
              <Section label={`Adding · ${totalAdd}`} color="#8fd3a8">
                {plan.adds.map((a) => <Line key={a.cardId} name={a.name} note={a.capped ? `+${a.addQty} · of ${a.requested}, cap ${a.limit}` : `+${a.addQty}`} />)}
              </Section>
            ) : !plan.avatar ? (
              <div style={{ font: "italic 400 14px/1.5 var(--f-read)", color: '#8a8175', margin: '4px 0 14px' }}>Nothing new to add - it's all at its limit or unrecognised.</div>
            ) : null}
            {plan.atLimit.length > 0 && (
              <Section label="Already at limit" color="#c9a86a">
                {plan.atLimit.map((a) => <Line key={a.name} dim name={a.name} note={`${a.already}/${a.limit}`} />)}
              </Section>
            )}
            {plan.unknown.length > 0 && (
              <Section label="Not recognised" color="#c98f8f">
                {plan.unknown.map((u, i) => <Line key={u.name + i} dim name={u.name} note={`${u.qty}×`} />)}
              </Section>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button onClick={() => setPlan(null)} style={ghost}>Back</button>
              <button onClick={commit} disabled={!canCommit || busy} style={{ ...gold, opacity: canCommit && !busy ? 1 : 0.5 }}>{busy ? 'Applying…' : totalAdd > 0 ? `Add ${totalAdd} card${totalAdd === 1 ? '' : 's'}${plan.avatar ? ' + avatar' : ''}` : 'Set avatar'}</button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

// Export - Deckbuilder's #export-sheet: Markdown (readable) / Curiosa (flat) toggle
// with a copy-to-clipboard action.
function ExportSheet({ open, deckId, onClose, flash }) {
  const [fmt, setFmt] = useState('markdown');   // markdown | curiosa | compendium
  const [text, setText] = useState('');
  const [share, setShare] = useState(null);     // { link, cards } for the Compendium QR
  useEffect(() => {
    if (!open || !deckId) return;
    let a = true;
    if (fmt === 'compendium') {
      setShare(null);
      buildDeckShare(deckId).then((s) => a && setShare(s)).catch(() => a && setShare({ link: '', cards: 0 }));
    } else {
      (fmt === 'curiosa' ? exportCuriosa(deckId) : exportMarkdown(deckId)).then((t) => a && setText(t));
    }
    return () => { a = false; };
  }, [open, deckId, fmt]);
  const copyable = fmt === 'compendium' ? share?.link : text;
  async function copy() {
    if (!copyable) return;
    try { await navigator.clipboard.writeText(copyable); flash?.('Copied to clipboard'); }
    catch { flash?.('Copy failed'); }
  }
  async function doShare() {
    if (!share?.link) return;
    const r = await shareLink({ title: 'Sorcery deck', text: share.link, dialogTitle: 'Share deck' });
    if (r === 'copied') flash?.('Link copied');
  }
  const footer = fmt === 'compendium'
    ? <button className="es-copy-btn" onClick={doShare} disabled={!share?.link}>Share link</button>
    : <button className="es-copy-btn" onClick={copy}>Copy to clipboard</button>;
  return (
    <Sheet open={open} title="Export Deck" onClose={onClose} footer={footer} bodyClass="cx-decks">
      <div className="es-format-row">
        <div className="es-format-wrap">
          <button className={`es-format-btn${fmt === 'markdown' ? ' on' : ''}`} onClick={() => setFmt('markdown')}>Markdown</button>
          <button className={`es-format-btn${fmt === 'curiosa' ? ' on' : ''}`} onClick={() => setFmt('curiosa')}>Curiosa</button>
          <button className={`es-format-btn${fmt === 'compendium' ? ' on' : ''}`} onClick={() => setFmt('compendium')}>Compendium</button>
        </div>
      </div>
      {fmt === 'compendium' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '10px 0 6px' }}>
          {share?.link
            ? <>
                <QRCode text={share.link} size={224} />
                <div style={{ font: "400 13px/1.55 var(--f-read)", color: 'var(--ink-muted)', textAlign: 'center', maxWidth: 300 }}>
                  Have a friend scan this in Compendium - <b style={{ color: 'var(--ink-body)' }}>Decks › + › Import from QR</b> - or send them the link. {share.cards} card{share.cards === 1 ? '' : 's'}.
                </div>
                <button onClick={copy} style={{ background: 'none', border: 'none', color: 'var(--gold-leaf)', font: "600 13px/1 var(--f-ui)", cursor: 'pointer', padding: 4 }}>Copy link</button>
              </>
            : <div className="es-hint" style={{ padding: '30px 0' }}>{share ? 'This deck has no cards to share yet.' : 'Building share code…'}</div>}
        </div>
      ) : (
        <>
          <div className="es-hint">{fmt === 'curiosa' ? 'Flat “qty name” list for curiosa.io import.' : 'Readable list grouped by zone and type.'}</div>
          <textarea className="es-area" readOnly value={text} onFocus={(e) => e.target.select()} />
        </>
      )}
    </Sheet>
  );
}

// Deck Spread - Deckbuilder's #deckcards-sheet: one tile per distinct card (×N badge
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
  const shuffleArr = (l) => {
    // Expand each entry into `quantity` independent single copies FIRST, so 3-of a
    // card shuffles as three separate cards that can land anywhere - not one bundle.
    const a = [];
    for (const e of (l || [])) { const n = Math.max(1, e.quantity || 1); for (let k = 0; k < n; k++) a.push({ ...e, quantity: 1 }); }
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  function doShuffle() {
    setShuf({ spellbook: shuffleArr(zones.spellbook), atlas: shuffleArr(zones.atlas), collection: shuffleArr(zones.collection) });
  }

  const tile = (e, i) => (
    <div key={e.card_id + '-' + i} className="ds-tile" style={{ aspectRatio: e.is_site ? '4.1 / 3' : '3 / 4.1' }}>
      {e.image_slug && <ArtImg artKey={e.image_slug} loading="lazy" alt=""
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
    <Sheet open={open} title="Deck Spread" onClose={onClose} bodyClass="cx-decks"
      footer={
        <div className="ds-toggle-wrap">
          <button className={`ds-view-btn${!shuf ? ' on' : ''}`} onClick={() => setShuf(null)}>Deck</button>
          <button className={`ds-view-btn${shuf ? ' on' : ''}`} onClick={doShuffle} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><ShuffleIcon width={13} height={13} />Shuffle</button>
        </div>
      }>
      {!src ? <Loading />
        : empty ? <div style={{ padding: '30px 16px', textAlign: 'center', color: '#8a8175', fontStyle: 'italic' }}>No cards in this deck yet.</div>
          : <>{section('Spellbook', src.spellbook)}{section('Atlas', src.atlas)}{section('Collection', src.collection)}</>}
    </Sheet>
  );
}
