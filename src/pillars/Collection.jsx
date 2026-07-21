// Collection pillar - the card OWNERSHIP ledger. Overview (glance stats + how many
// decks are buildable + recently added) and Cards (search the catalog, one-tap +/-
// to record what you Own or Want). Sets are browsed as card tiles (BinderTile); LedgerRow
// still backs Overview's recently-added strip;
// tapping a card opens the shared CollectionCardSheet (ownership steppers +
// Codex hand-off) lifted to the pillar root. Data layer is ownedRepository +
// compareEngine. Accent is ruby, chrome-only.
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getPool, getArtists, listDecks, resolveCardList } from '../store/deckRepository.js';
import { parseQuery, cardMatchesQuery } from '../store/cardQuery.js';
import { isTokenCard } from '../store/tokens.js';
import { resetCollectionSessionFor, collectionSession } from './collectionSession.js';
import { collectionSurface } from './collectionRoute.js';
import { triagePile, pendingCount } from '../store/triage.js';
import { wantTarget } from '../store/wantIntent.js';
import { canonicalPrinting, UNCATEGORISED } from '../store/printings.js';
import WantPrintingSheet from '../components/WantPrintingSheet.jsx';
import TriageSheet from '../components/TriageSheet.jsx';
import { groupCards } from '../store/collectionGrouping.js';
import { ownershipOf, countsTowardCompletion } from '../store/ownership.js';
import { soleSetName, UNCATEGORISED_LABEL } from '../store/printings.js';
import OverflowMenu from '../components/OverflowMenu.jsx';
import {
  ownedMap, collectionStats, recentlyAdded, setWanted, wishlistCards, wishlistExportText,
  uncategorisedRows, cardSetsFor,
  ownedBySet, qtyForInSet, setOwnedInSet,
  deckBuildabilityBulk, subscribeCollection, previewCollectionText, importCollectionResolved, exportListText,
  listCardLists, createList, renameList, duplicateList, deleteList,
  setListEntry, stepWanted, stepListEntry, ownedRowKey, listRowKey, queueWantWrite,
  stepWantedForItem, setWantedForItem,
  listProgress, listProgressBulk, listCards, listThumbsBulk,
} from '../store/ownedRepository.js';
import { SET_LABEL, SET_RANK } from '../store/sets.js';
import { groupCollection } from '../store/collectionGroups.js';
import { planCollectionImport, buildImportItems, importTallies } from '../store/importPlan.js';
import { goalTotals, goalRowState, listRowsNeedLedgerRefresh, canApplyExternalRows } from '../store/listGoalModel.js';
import { Chip, ChipRow, SectionLabel, SegTabs, Loading, BottomSheet, BTN_GOLD, BTN_GHOST } from '../components/ui.jsx';
import CollectionCardSheet from '../components/CollectionCardSheet.jsx';
import RefineSheet from '../components/RefineSheet.jsx';
import { LedgerRow, BinderTile, Frost, GILT, GILT_BRIGHT, GLOW, GLOW_BRIGHT } from '../components/CollectionCardViews.jsx';
import CardArt from '../components/CardArt.jsx';
import SearchPill from '../components/SearchPill.jsx';
import MissingSheet from '../components/MissingSheet.jsx';
import { enqueueWrite } from '../store/collectionWrites.js';
import { createOwnedStepGrid } from '../store/ownedStepGrid.js';
import { activeProfileId } from '../store/profileRepository.js';
import { createGoalDrain } from './collectionGoalDrain.js';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import Ring from '../components/Ring.jsx';
import SetsHome from './SetsHome.jsx';
import { launchScanner } from '../cardScanner.js';
import { haptic } from '../native.js';
import { toast } from '../feedback.js';

// FAB menu-item glyphs (unsized - the fab-menu CSS sizes them), matching the
// Decks library FAB's icon language.
const TextImportSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="14 3 14 9 20 9" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>;
const EditSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>;
const CopySvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
const TrashSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
const SeekSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.3" y2="16.3" /><line x1="8" y1="11" x2="14" y2="11" /></svg>;

// Where-you-left-off cache. The app unmounts the whole pillar when a Codex detail opens
// (e.g. the scanner handing off a recognised card), so this survives the round-trip: coming
// Back re-mounts Collection exactly as it was - same view, search, filter, open list,
// even the open card sheet. Module-level = session-scoped, deliberately not
// persisted (a fresh launch starts at Overview).
// The grouping vocabulary offered inside a set. Alphabetical is the resting state; the other
// two section the grid rather than reorder it.
const GROUP_OPTS = [['none', 'A to Z'], ['element', 'Element'], ['rarity', 'Rarity']];

export default function Collection({ pillSlot, onOpen, onGoDecks, rev, onChanged }) {
  // Reconcile the cache with the ACTIVE profile before reading a single field from it. Done
  // in the initialiser rather than an effect so no render ever sees another profile's state.
  const [boundSession] = useState(() => resetCollectionSessionFor(activeProfileId()));
  const [view, setView] = useState(boundSession.view);       // overview | cards | lists
  const [listOpen, setListOpen] = useState(boundSession.listOpen);  // a list row when its detail is open
  // Card-tap detail sheet, lifted to the pillar root so Overview, Cards and
  // ListDetail all share one instance (its ledger writes broadcast via
  // subscribeCollection, so each view refreshes itself).
  const [sheetCard, setSheetCard] = useState(boundSession.sheetCard);
  const [sheetSet, setSheetSet] = useState(boundSession.sheetSet);   // the PRINTING (set code) the sheet is scoped to, if any
  // No edit mode: adding is a PLACE, not a mode. Steppers are permanent on every row and the
  // card sheet is always editable - you record what you own wherever a card appears.
  // Sets-are-home: My Collection lands on the sets-completion grid (SetsHome). Tapping a
  // plate drills into that set's ledger/binder (setDrill = its code). drillInfo carries the
  // opened set's completion snapshot so the drill header's Ring total stays honest (owned
  // stays live from the ledger; total is the full-catalog figure).
  const [setDrill, setSetDrill] = useState(boundSession.setDrill);
  const [drillInfo, setDrillInfo] = useState(null);
  const openSet = useCallback((code, info) => { setSetDrill(code); setDrillInfo(info || null); }, []);
  const closeSet = useCallback(() => { setSetDrill(null); setDrillInfo(null); }, []);
  useEffect(() => { collectionSession().view = view; collectionSession().listOpen = listOpen; collectionSession().sheetCard = sheetCard; collectionSession().sheetSet = sheetSet; collectionSession().setDrill = setDrill; }, [view, listOpen, sheetCard, sheetSet, setDrill]);
  // Open the card sheet, optionally scoped to a printing (a set code). '' / undefined
  // = name-level. Stable so the memoized rows don't re-render.
  const peek = useCallback((cardId, set) => { setSheetCard(cardId || null); setSheetSet(set || null); }, []);
  const go = (v) => { setListOpen(null); setSetDrill(null); setDrillInfo(null); setView(v); };
  const goAdd = () => go('cards');   // adding starts by choosing a set; the steppers are always live
  const pills = (
    <div style={{ padding: '0 20px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="cx-scroll" style={{ display: 'flex', gap: 8, flex: 1, minWidth: 0, overflowX: 'auto' }}>
        <Chip label="Overview" active={view === 'overview'} onClick={() => go('overview')} />
        <Chip label="My Collection" active={view === 'cards'} onClick={() => go('cards')} />
        <Chip label="Lists" active={view === 'lists'} onClick={() => go('lists')} />
      </div>
    </div>
  );
  const surface = collectionSurface({ view, setDrill, listOpen });

  return (
    <div style={{ padding: '4px 0 26px', animation: 'cxfade .2s ease' }}>
      {pillSlot ? createPortal(pills, pillSlot) : pills}
      {/* WHICH surface is a pure decision (collectionRoute.js), characterized by tests before
          this file was split. It carries two rules that a nested ternary made easy to lose:
          a stale `setDrill` must not resurrect the drill from another view, and likewise
          `listOpen`. Both are real states - the nav cache survives an unmount. */}
      {surface === 'overview' && (
        <Overview onGoCards={() => go('cards')} onAddCards={goAdd} onGoDecks={onGoDecks} onGoLists={() => go('lists')} onPeek={peek}
          onOpenCodex={(id, name) => onOpen('card', id, name)} rev={rev} />
      )}
      {surface === 'setDrill' && (
        <Cards onOpen={onOpen} onPeek={peek} onOpenCodex={(id, name) => onOpen('card', id, name)}
          setDrill={setDrill} drillInfo={drillInfo} onBack={closeSet} />
      )}
      {surface === 'setsHome' && (
        <>
          <SetsHome onOpenSet={openSet} rev={rev} />
          {/* Same gesture as Overview and the set drill: the camera glyph means "get cards
              in", everywhere in this pillar. */}
          <Fab variant="lib" label="Scan cards" icon={<FabGlyph kind="camera" />}
            onClick={() => launchScanner({ onOpenCard: (id, name) => onOpen('card', id, name), mode: 'collection' })} />
        </>
      )}
      {surface === 'listDetail' && (
        <ListDetail list={listOpen} onBack={() => setListOpen(null)} onOpen={onOpen} onPeek={peek} onChanged={onChanged} />
      )}
      {surface === 'listsIndex' && <ListsIndex onOpenList={setListOpen} rev={rev} />}
      {/* The sheet's open card is KEPT in state across a pillar unmount (a Codex hand-off
          from the scanner), so Back lands right back on this sheet - where the user left. */}
      <CollectionCardSheet cardId={sheetCard} set={sheetSet} onClose={() => { setSheetCard(null); setSheetSet(null); }} editable />
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
// lines; headers ignored), imintegrated into the OWNERSHIP ledger (adds copies on
// top of what's recorded, never overwrites).
// Two steps: PASTE a "qty name" list, then REVIEW - single-set cards file to their
// one set automatically; reprinted (multi-set) cards get a set toggle (default
// Unspecified, so nothing is mis-filed); unrecognised names are listed and skipped.
// Confirm writes each line into its chosen set in one transaction.
function ImportTextSheet({ open, onClose }) {
  const [step, setStep] = useState('paste');     // 'paste' | 'review'
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);  // { single, multi, unresolved }
  const [choice, setChoice] = useState({});      // card_id -> setCode ('' = Unspecified)
  useEffect(() => { if (open) { setStep('paste'); setText(''); setBusy(false); setPreview(null); setChoice({}); } }, [open]);

  const review = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const { items, unresolved } = await previewCollectionText(text);
      if (!items.length) { toast('No cards recognised in that text.', { tone: 'danger' }); setBusy(false); return; }
      const { single, multi, unresolved: bad, choiceDefaults } = planCollectionImport({ items, unresolved });
      setChoice(choiceDefaults); setPreview({ single, multi, unresolved: bad }); setStep('review'); setBusy(false);
    } catch { toast("Couldn't read that text.", { tone: 'danger' }); setBusy(false); }
  };

  const confirm = async () => {
    if (busy || !preview) return;
    setBusy(true);
    try {
      const items = buildImportItems(preview, choice);
      const r = await importCollectionResolved(items);
      toast(`Added ${r.copies} cop${r.copies === 1 ? 'y' : 'ies'} of ${r.names} card${r.names === 1 ? '' : 's'}`);
      onClose();
    } catch { toast("Couldn't import.", { tone: 'danger' }); setBusy(false); }
  };

  const { nSingle, nMulti, nBad, totalCopies } = preview ? importTallies(preview) : { nSingle: 0, nMulti: 0, nBad: 0, totalCopies: 0 };
  const sectionHead = (color, label) => <div style={{ font: "600 10px/1 var(--f-display)", letterSpacing: '.16em', color, margin: '2px 0 8px' }}>{label}</div>;

  return (
    <BottomSheet open={open} title="IMPORT TO COLLECTION" onClose={onClose}>
      {step === 'paste' ? (
        <>
          <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 12 }}>
            Paste a list of cards - one per line, like <span style={{ color: 'var(--ink-body)', fontFamily: 'var(--f-mono)' }}>4 Wild Boars</span>.
            Deck exports work too. Copies are ADDED to what you already own.
          </div>
          <textarea value={text} autoFocus onChange={(e) => setText(e.target.value)} rows={7}
            placeholder={'4 Wild Boars\n2 Abundance\n1 Grim Reaper…'}
            style={{ ...SHEET_INPUT, height: 'auto', padding: '11px 14px', resize: 'none', font: "400 13.5px/1.5 var(--f-mono)" }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={onClose} style={{ ...BTN_GHOST, flex: 1 }}>Cancel</button>
            <button onClick={review} disabled={!text.trim() || busy} style={{ ...BTN_GOLD, flex: 1, justifyContent: 'center', opacity: text.trim() && !busy ? 1 : 0.5 }}>
              {busy ? 'Reading…' : 'Review'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 12 }}>
            {totalCopies} cop{totalCopies === 1 ? 'y' : 'ies'} across {nSingle + nMulti} card{nSingle + nMulti === 1 ? '' : 's'}.{nMulti > 0 ? ' Pick a set for the reprinted cards.' : ''}
          </div>
          <div style={{ maxHeight: '46vh', overflowY: 'auto' }} className="cx-scroll">
            {nMulti > 0 && (
              <div style={{ marginBottom: nSingle || nBad ? 16 : 0 }}>
                {sectionHead('var(--gold-leaf)', 'CHOOSE A SET')}
                {preview.multi.map((i) => (
                  <div key={i.card_id} style={{ padding: '10px 0', borderBottom: '1px solid var(--hair-12)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                      <span style={{ flex: 1, minWidth: 0, font: "600 14px/1.2 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
                      <span style={{ flex: 'none', font: "700 13px/1 var(--f-mono)", color: 'var(--gold-leaf)' }}>×{i.qty}</span>
                    </div>
                    <div style={{ maxWidth: '100%', overflowX: 'auto', padding: 1 }}>
                      <SegTabs ariaLabel={`Set for ${i.name}`}
                        value={choice[i.card_id] === '' ? '__unspec__' : choice[i.card_id]}
                        onChange={(k) => setChoice((m) => ({ ...m, [i.card_id]: k === '__unspec__' ? '' : k }))}
                        options={[...i.sets.map((s) => ({ key: s.code, label: s.name })), { key: '__unspec__', label: UNCATEGORISED_LABEL }]} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {nSingle > 0 && (
              <div style={{ marginBottom: nBad ? 16 : 0 }}>
                {sectionHead('var(--ink-muted)', `FILES AUTOMATICALLY · ${nSingle}`)}
                {preview.single.map((i) => (
                  <div key={i.card_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--hair-12)' }}>
                    <span style={{ flex: 1, minWidth: 0, font: "500 13px/1.2 var(--f-read)", color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
                    <span style={{ flex: 'none', font: "500 11px/1 var(--f-display)", letterSpacing: '.06em', textTransform: 'uppercase', color: '#c9b487' }}>{i.sets[0].name}</span>
                    <span style={{ flex: 'none', font: "700 12px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>×{i.qty}</span>
                  </div>
                ))}
              </div>
            )}
            {nBad > 0 && (
              <div>
                {sectionHead('var(--destructive)', `SKIPPED · NOT RECOGNISED · ${nBad}`)}
                {preview.unresolved.map((name, idx) => (
                  <div key={idx} style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', padding: '3px 0' }}>{name}</div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={() => setStep('paste')} disabled={busy} style={{ ...BTN_GHOST, flex: 1 }}>‹ Back</button>
            <button onClick={confirm} disabled={busy} style={{ ...BTN_GOLD, flex: 1.2, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
              {busy ? 'Importing…' : `Import ${totalCopies}`}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

// Bulk-add to a card list: paste a "qty name" list (a deck export, or the copy
// from the buildability widget), review recognised vs not, then add. Copies are
// ADDED via the caller's onApply, so it works for the wishlist too.
function ListBulkAddSheet({ open, onClose, onApply, listName }) {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setText(''); setPlan(null); setBusy(false); } }, [open]);
  const review = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { setPlan(await resolveCardList(text)); } catch { toast("Couldn't read that list.", { tone: 'danger' }); }
    setBusy(false);
  };
  const apply = () => { if (!plan?.adds.length) return; onApply(plan.adds); onClose(); };
  const totalQ = plan ? plan.adds.reduce((s, a) => s + a.qty, 0) : 0;
  const Section = ({ label, color, children }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ font: "600 10.5px/1 var(--f-display)", letterSpacing: '.18em', color, textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
  const Line = ({ name, note, dim }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderBottom: '1px solid rgba(74,60,34,.3)' }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: "400 14.5px/1.3 var(--f-read)", color: dim ? 'var(--ink-muted-warm)' : '#d8cebb' }}>{name}</span>
      <span style={{ flex: 'none', font: "600 12.5px/1 var(--f-mono)", color: dim ? 'var(--ink-muted-warm)' : '#cba75f' }}>{note}</span>
    </div>
  );
  return (
    <BottomSheet open={open} title="ADD FROM TEXT" onClose={onClose}>
      {!plan ? (
        <>
          <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 12 }}>
            Paste a list - one per line, like <span style={{ color: 'var(--ink-body)', fontFamily: 'var(--f-mono)' }}>4 Wild Boars</span>. Deck &amp; buildability exports work too. Copies are added to {listName}.
          </div>
          <textarea value={text} autoFocus onChange={(e) => setText(e.target.value)} rows={7}
            placeholder={'4 Wild Boars\n2 Abundance\n1 Grim Reaper…'}
            style={{ ...SHEET_INPUT, height: 'auto', padding: '11px 14px', resize: 'none', font: "400 13.5px/1.5 var(--f-mono)" }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={onClose} style={{ ...BTN_GHOST, flex: 1 }}>Cancel</button>
            <button onClick={review} disabled={!text.trim() || busy} style={{ ...BTN_GOLD, flex: 1, justifyContent: 'center', opacity: text.trim() && !busy ? 1 : 0.5 }}>{busy ? 'Reading…' : 'Review'}</button>
          </div>
        </>
      ) : (
        <>
          {plan.adds.length > 0 ? (
            <Section label={`Adding · ${totalQ}`} color="#8fd3a8">
              {plan.adds.map((a) => <Line key={a.card.card_id} name={a.card.name} note={`${a.qty}×`} />)}
            </Section>
          ) : (
            <div style={{ font: "italic 400 14px/1.5 var(--f-read)", color: 'var(--ink-muted-warm)', margin: '4px 0 14px', textAlign: 'center' }}>Nothing recognised in that text.</div>
          )}
          {plan.unknown.length > 0 && (
            <Section label="Not recognised" color="#c98f8f">
              {plan.unknown.map((u, i) => <Line key={u.name + i} dim name={u.name} note={`${u.qty}×`} />)}
            </Section>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button onClick={() => setPlan(null)} style={{ ...BTN_GHOST, flex: 1 }}>Back</button>
            <button onClick={apply} disabled={!plan.adds.length} style={{ ...BTN_GOLD, flex: 1, justifyContent: 'center', opacity: plan.adds.length ? 1 : 0.5 }}>Add {totalQ} card{totalQ === 1 ? '' : 's'}</button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

function Overview({ onGoCards, onGoDecks, onGoLists, onPeek, onOpenCodex, rev }) {
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [deckStat, setDeckStat] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  // THE TO BE CATEGORISED PILE.
  //
  // It lives in Overview because the pile is a standing state of the collection rather than a
  // step in a flow. Read here and passed down, so the sheet owns no query of its own and one
  // re-read serves both the entry row and the sheet.
  const [pile, setPile] = useState([]);
  const [triageOpen, setTriageOpen] = useState(false);
  const loadPile = React.useCallback(async () => {
    const rows = await uncategorisedRows();
    if (!rows.length) { setPile([]); return; }
    const ids = [...new Set(rows.map((r) => r.card_id))];
    const sets = await cardSetsFor(ids);
    setPile(triagePile(rows, (id) => sets.get(id) || []));
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [s, r, decks] = await Promise.all([collectionStats(), recentlyAdded(10), listDecks()]);
      if (!alive) return;
      setStats(s); setRecent(r);
      loadPile();
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
      {/* The FAB is the camera and nothing else, so the typed import lives here. Text import
          is deliberately NOT set-scoped: a paste spanning many sets must stay one paste. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <OverflowMenu label="Collection actions" items={[
          { label: 'Import from text', icon: TextImportSvg, onClick: () => setImportOpen(true) },
        ]} />
      </div>
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
          {recent.map((c) => {
            // Label the row with the printing you actually own (owned_slug), not
            // sets[0] - which mislabelled every Beta (and later) reprint as Alpha.
            const code = (!c.owned_slug || c.owned_slug === 'foil') ? '' : String(c.owned_slug).split(':')[0];
            return (
              <LedgerRow key={c.card_id} card={c} set={code} setLabel={SET_LABEL[code] || code}
                owned={c.qty_owned} foil={c.qty_foil || 0} wanted={c.qty_wanted} onPeek={onPeek} />
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

      {/* Scan. One tap, no menu - the camera glyph teaches that cards get in by pointing the
          phone at them. Typed import moved to the header overflow above. */}
      <Fab variant="lib" label="Scan cards" icon={<FabGlyph kind="camera" />}
        onClick={() => launchScanner({ onOpenCard: onOpenCodex, mode: 'collection' })} />
      {/* HONEST BUT QUIET, per the ruling: the count sits on the entry itself rather than as a
          standing badge. A user with 300 uncategorised imports does not want a permanent 300 on
          their home screen. An empty pile shows no row at all. */}
      {pendingCount(pile) > 0 && (
        <button
          onClick={() => setTriageOpen(true)}
          className="cx-row"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            width: '100%', marginTop: 14, padding: '13px 14px', borderRadius: 10,
            background: 'rgba(18,16,13,.85)', border: '1px solid var(--hair-16)',
            cursor: 'pointer', textAlign: 'left',
          }}>
          <span style={{ font: "500 14px/1.25 var(--f-read)", color: 'var(--ink-body)' }}>
            To Be Categorised
          </span>
          <span style={{ font: "600 12px/1 var(--f-mono)", color: 'var(--gold-leaf)' }}>
            {pendingCount(pile)}
          </span>
        </button>
      )}

      <TriageSheet
        open={triageOpen}
        pile={pile}
        onClose={() => setTriageOpen(false)}
        onChanged={loadPile}
        onOpenCard={onPeek} />

      <ImportTextSheet open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

/* ---------------- Cards (per-set card browser) ---------------- */

// The pinned, un-deletable Wishlist is a VIRTUAL list (kind 'wishlist') backed by
// the owned_cards.qty_wanted ledger, not a card_lists row - this sentinel id keeps
// it distinct from real lists while sharing the ListDetail surface.
const WISHLIST_ID = '__wishlist__';
const wishlistRef = () => ({ id: WISHLIST_ID, kind: 'wishlist', name: 'Wishlist' });

// Curiosa's numeric set model (catalog v2). Labels + a fixed display order; the
// trailing '' bucket is legacy / set-unspecified owned rows (variant_slug ''|'foil').
const setRank = (code) => (code in SET_RANK ? SET_RANK[code] : 5.5);

// My Collection ownership filter (multi-select). Empty = the mode default
// (read view = owned only, add view = everything).
// Three ownership states plus the independent wishlist axis - see store/ownership.js.
// "Not owned" is gone deliberately: it had to call a foil-only card unowned, which is false.
// The chips are multi-select, so "what do I still need in non-foil" is Foil only + Missing.
const OWN_OPTS = [['regular', 'Owned'], ['foilOnly', 'Foil only'], ['missing', 'Missing'], ['wishlist', 'Wishlisted']];
const OWN_LABEL = { regular: 'Owned', foilOnly: 'Foil only', missing: 'Missing', wishlist: 'Wishlisted' };

// Cards is the PER-SET drill (the parent shows SetsHome until a plate is tapped). It scopes
// the shared catalog/search/filter machinery to `setDrill`, adds a back + set-completion
// header, and carries a permanent stepper on every tile.
function Cards({ onOpen, onPeek, onOpenCodex, setDrill, drillInfo, onBack }) {
  // Adding is a PLACE: the set's whole checklist is here and every tile carries a live
  // stepper. Card view only - completion is a visual loop, so the empty sleeves ARE the
  // information. Ownership narrowing lives solely in the filter sheet (see ownScope): an
  // always-on inline lens both duplicated it and made a card you just added vanish.

  // Declared FIRST because everything below reads it, including hook dependency arrays -
  // which are evaluated during render, so a `const` declared further down would still be in
  // its temporal dead zone. It depends only on props, so there is nothing to wait for.
  const drillName = drillInfo?.name || SET_LABEL[setDrill] || setDrill;

  const [exportOpen, setExportOpen] = useState(false);
  // The canonical, UNFILTERED roster for this set - loaded once per drill. The grid comes
  // from the filtered pool; the completion denominator and the "missing" export come from
  // here, so neither can be moved by a filter the user happens to have on.
  const [roster, setRoster] = useState(null);

  const [q, setQ] = useState(collectionSession().q);
  const [types, setTypes] = useState(collectionSession().types);
  const [rarities, setRarities] = useState(collectionSession().rarities);
  const [els, setEls] = useState(collectionSession().els);
  // Grouping, NOT sorting. Collection is always alphabetical; what varies is whether the
  // grid is one list or sectioned by element/rarity.
  const [groupBy, setGroupBy] = useState(collectionSession().groupBy || 'none');
  // No collectionSession().sets: the drill is pinned to its own set, so there is no cross-set selection
  // left to remember. Restoring one was what let a stale Alpha filter empty the Beta grid.
  useEffect(() => { collectionSession().q = q; collectionSession().types = types; collectionSession().rarities = rarities; collectionSession().els = els; collectionSession().groupBy = groupBy; }, [q, types, rarities, els, groupBy]);

  // Full rich filters - the shared Refine engine (Card Lists live in Collection,
  // so the comparator granularity earns its place for cube/draft/list building).
  const [multi, setMulti] = useState(false);
  const [thByEl, setThByEl] = useState(() => ({ air: { op: '>=', val: null }, earth: { op: '>=', val: null }, fire: { op: '>=', val: null }, water: { op: '>=', val: null } }));
  const [totalTh, setTotalTh] = useState({ op: '>=', val: null });
  const [costCmp, setCostCmp] = useState({ op: '>=', val: null });
  const [powerCmp, setPowerCmp] = useState({ op: '>=', val: null });
  const [artist, setArtist] = useState('');
  const [artistOpts, setArtistOpts] = useState([]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [pool, setPool] = useState(null);
  const [owBySet, setOwBySet] = useState(new Map());  // 'cardId|setCode' -> {owned, foil}
  // Per-row add status straight from the binding: {pending, ok, error, displayed}. `ok` moves
  // only on a RECONCILED success - authoritative read back, no failed write - so the tile can
  // distinguish "tap registered" from "actually persisted".
  const [addStatus, setAddStatus] = useState(new Map());
  const owRef = useRef(owBySet);                     // synchronous mirror, for seeding a row's controller
  owRef.current = owBySet;
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const [wishSet, setWishSet] = useState(() => new Set());   // card_ids on the wishlist
  const [ownScope, setOwnScope] = useState([]);       // ownership filter: 'owned' | 'unowned' | 'wishlist'
  const ownActive = ownScope.length > 0;
  const toggleOwn = useCallback((v) => setOwnScope((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])), []);
  // Gate: the Refine sheet must not open before its Set/Artist options resolve, or
  // those sections mount mid-slide and hitch the open animation (see open= below).
  const [optsLoaded, setOptsLoaded] = useState(false);
  // Only the artist list is still needed: the Sets facet left the drill with the set-scope
  // fix, and waiting on getSets() meant an irrelevant query could reject and leave an
  // otherwise-usable drill with no filters at all.
  useEffect(() => { getArtists().then(setArtistOpts).finally(() => setOptsLoaded(true)); }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await getPool({ sets: [drillName] });
      if (alive) setRoster(rows.filter((c) => !isTokenCard(c)));   // tokens are not collected
    })();
    return () => { alive = false; };
  }, [drillName]);

  async function loadPool() {
    const parsed = parseQuery(q);
    // The uncategorised bucket is an ownership state, not a printed set - keep it out of the
    // catalog pool query (it would match no card and empty the pool); grouping applies it.
    // PINNED to the drilled set. This component IS the per-set drill, so a cross-set filter
    // is not a narrowing - it is a contradiction. Selecting Alpha inside Beta used to put
    // Alpha in the pool while the renderer still asked for Beta, emptying the grid.
    const rows = await getPool({ q: parsed.name, els, types, rarities, sets: [drillName], multi, thByEl, totalTh, costCmp, powerCmp, artist });
    const real = rows.filter((c) => !isTokenCard(c));   // tokens aren't collected
    setPool(parsed.clauses.length ? real.filter((c) => cardMatchesQuery(c, parsed)) : real);
  }
  useEffect(() => { const t = setTimeout(loadPool, 130); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, types, rarities, els, multi, thByEl, totalTh, costCmp, powerCmp, artist]);
  const refreshOwnership = useCallback(async () => {
    const [obs, wl] = await Promise.all([ownedBySet(), wishlistCards()]);
    // Reconcile the bulk read against rows the grid is editing: keep the optimistic value for
    // anything still writing, and re-seed settled rows from the truth (which is what confirms
    // a row whose own post-write read had failed).
    const grid = gridRef.current;
    if (grid) {
      for (const key of grid.keys()) {
        if (grid.pending(key) > 0) {
          const st = grid.state(key);
          obs.set(key, { ...(obs.get(key) || { owned: 0, foil: 0 }), owned: st.displayed });
        } else {
          grid.reseed(key, obs.get(key)?.owned || 0);
        }
      }
    }
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

  // A stepper edits OWNED for ONE (card, set) printing. This goes through the SAME
  // provisional/confirmed contract as the card sheet - a tap shows immediately, the row
  // reconciles against the store when its write chain drains, and a rejected write restores
  // the true count and tells the user. Controllers are created lazily per TAPPED row, so a
  // ~780-tile set costs nothing until you actually edit something.
  const gridRef = useRef(null);
  if (gridRef.current === null) {
    const split = (key) => { const i = key.lastIndexOf('|'); return [key.slice(0, i), key.slice(i + 1)]; };
    gridRef.current = createOwnedStepGrid({
      read: async (key) => { const [cardId, set] = split(key); return (await qtyForInSet(cardId, set)).owned; },
      write: (key, delta) => {
        const [cardId, set] = split(key);
        // Bound to the profile captured at tap time and re-read inside its turn, so a profile
        // switch can't redirect it and overlapping steps can't clobber.
        const pid = activeProfileId();
        return enqueueWrite(ownedRowKey(pid, cardId, set, false), async () => {
          const cur = await qtyForInSet(cardId, set, pid);
          return setOwnedInSet(cardId, set, Math.max(0, cur.owned + delta), pid);
        });
      },
      notify: (reason) => toast(
        reason === 'unconfirmed' ? "Saved, but couldn't refresh - reopen to confirm"
          : reason === 'save-failed-unresolved' ? "Couldn't save, and couldn't check - reopen to confirm"
            : "Couldn't save; count restored", { tone: 'danger' }),
      isAlive: () => aliveRef.current,
      onChange: (key, status) => {
        setOwBySet((prev) => {
          const m = new Map(prev);
          m.set(key, { ...(m.get(key) || { owned: 0, foil: 0 }), owned: status.displayed });
          return m;
        });
        // `status.ok` is the controller's RECONCILED-success counter. Success is never
        // inferred from pending going false: that is emitted before reconcile runs, so it is
        // briefly true even when the write rejected or the read is about to fail.
        setAddStatus((prev) => new Map(prev).set(key, status));
      },
    });
  }
  const stepSet = useCallback((cardId, set, delta) => {
    const key = cardId + '|' + set;
    gridRef.current.step(key, owRef.current.get(key)?.owned || 0, delta);
  }, []);

  // Per-set ownership: expand every catalogue card into one row per set it was
  // True owned-per-set (independent of the row filter) - drives the drill header's
  // owned/total. Non-foil only, matching set completion (foil-only cards don't count).
  const ownedPerSet = useMemo(() => {
    const m = new Map();
    for (const [k, v] of owBySet) {
      if (!countsTowardCompletion(ownershipOf(v.owned, v.foil))) continue;   // one shared definition
      const code = k.slice(k.lastIndexOf('|') + 1);
      m.set(code, (m.get(code) || 0) + 1);
    }
    return m;
  }, [owBySet]);

  const groups = useMemo(() => groupCollection({
    pool, owBySet, wishSet, sets: [drillName], viewMode: 'all', ownScope, ownActive, setLabel: SET_LABEL, setRank,
  }), [pool, owBySet, wishSet, ownScope, ownActive, drillName]);

  // Scope to the drilled set. The pool/search/filter machinery is unchanged; we render
  // only the drilled set's group. Header owned is LIVE (from the ledger map); the total is
  // the full-catalog figure from drillInfo (falls back to the filtered pool's set total on
  // a cold session restore, which is exact when no filter is active).
  const drillGroup = useMemo(() => groups.find((g) => g.code === setDrill) || null, [groups, setDrill]);
  const drillRows = drillGroup ? drillGroup.rows : [];
  const totalRows = drillRows.length;
  const drillOwned = ownedPerSet.get(setDrill) || 0;
  // The denominator is IMMUTABLE for the set: it comes from the canonical roster, never from
  // the filtered pool. It used to fall back to the filtered set total whenever drillInfo was
  // absent - which is exactly what happens on a session restore - so returning to a filtered
  // drill could render a header like "402 / 50".
  const drillTotal = roster ? roster.length : (drillInfo?.totalCollectible ?? 0);
  const drillPct = drillTotal ? drillOwned / drillTotal : 0;
  // Everything in the set you do NOT hold in non-foil - missing outright, or foil-only.
  // Filter-independent by construction: it reads the roster, not the grid.
  const missingInSet = useMemo(() => (roster || []).filter((c) => {
    const oc = owBySet.get(c.card_id + '|' + setDrill);
    return ownershipOf(oc?.owned, oc?.foil) !== 'regular';
  }), [roster, owBySet, setDrill]);

  const richComp = ['air', 'earth', 'fire', 'water'].filter((el) => thByEl[el].val != null).length + (totalTh.val != null ? 1 : 0) + (costCmp.val != null ? 1 : 0) + (powerCmp.val != null ? 1 : 0);
  const activeCount = ownScope.length + types.length + rarities.length + els.length + (multi ? 1 : 0) + (artist ? 1 : 0) + richComp;   // no sets facet in a set drill; grouping is an arrangement, not a filter
  const clearAll = () => {
    setOwnScope([]); setTypes([]); setRarities([]); setEls([]); setMulti(false); setArtist('');
    setThByEl({ air: { op: '>=', val: null }, earth: { op: '>=', val: null }, fire: { op: '>=', val: null }, water: { op: '>=', val: null } });
    setTotalTh({ op: '>=', val: null }); setCostCmp({ op: '>=', val: null }); setPowerCmp({ op: '>=', val: null });
    // Clear resets FILTERS only. Grouping is an arrangement, not a filter - it hides nothing,
    // it is not counted in activeCount, and silently undoing it here would surprise someone
    // who grouped by rarity and then cleared a type filter.
  };

  return (
    <div style={{ padding: '0 20px 150px' }}>
      {/* Sticky drill header: back + set-completion Ring + owned/total. It needs an OPAQUE
          backing - the card grid scrolls underneath it, and over a transparent header the
          title and ring became unreadable. Bled to the screen edges (negative margin against
          the container's 20px padding) so nothing shows through at the sides. */}
      <div style={{
        // marginTop cancels the pillar root's 4px top padding: without it the header sat 4px
        // below the scrollport and visibly slid those 4px before pinning.
        position: 'sticky', top: 0, zIndex: 6, margin: '-4px -20px 0', padding: '8px 20px 12px',
        background: 'rgba(10,8,5,.94)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--hair-12)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button onClick={onBack} aria-label="Back to sets" style={{
            width: 44, height: 44, margin: -5, flex: 'none', borderRadius: '50%', cursor: 'pointer',   // >=44px touch floor; negative margin keeps the header layout
            border: '1px solid var(--hair-40)', background: 'transparent', color: 'var(--gold-leaf)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <Ring value={drillPct} size={34} stroke={4} color="var(--accent-ruby)" showPct={false} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "700 15px/1.1 var(--f-display)", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-head)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{drillName}</div>
            <div style={{ font: "400 11.5px/1 var(--f-mono)", color: 'var(--ink-muted)', marginTop: 3 }}>{drillOwned} / {drillTotal}</div>
          </div>
          <OverflowMenu label="Set actions" items={[
            { label: 'Export missing as text', icon: TextImportSvg, onClick: () => setExportOpen(true) },
          ]} />
        </div>
      </div>

      {pool == null ? <Loading /> : (
        <>
          <div style={{ font: "400 11.5px/1 var(--f-ui)", color: 'var(--ink-faint)', textAlign: 'right', margin: '0 2px 8px' }}>
            {totalRows} card{totalRows === 1 ? '' : 's'}
          </div>
          {totalRows === 0 ? (
            <div style={{ padding: '48px 0', textAlign: 'center', font: "400 15px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>
              {(activeCount || q) ? 'No cards match those filters.' : `${drillName} has no cards yet.`}
            </div>
          ) : (
            // Card view only, 2 up: at 3 the quick-add button crowded the card name. No cap:
            // every card renders - off-screen tiles are skipped by the
            // browser (content-visibility on the tile), so a full set stays smooth without a
            // virtualization lib. minmax(0,1fr), NOT 1fr: a content-visibility tile reports
            // min-content width, which inflated 1fr tracks; pin the min to 0.
            // Sections, not a reordered flat list. With grouping off this is one unlabelled
            // section, so the grid has a single code path either way.
            groupCards(drillRows, groupBy, (r) => r.card).map((section) => (
              <div key={section.key}>
                {section.label && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 2px 10px' }}>
                    <span style={{ font: "700 11.5px/1 var(--f-display)", letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-head)' }}>{section.label}</span>
                    <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(74,60,34,.6), transparent)' }} />
                    <span style={{ font: "400 11px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>{section.cards.length}</span>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: section.label ? 0 : 12 }}>
                  {section.cards.map((r) => (
                    <BinderTile key={r.card.card_id + '|' + r.set} card={r.card} set={r.set} setLabel={drillName}
                      owned={r.owned} foil={r.foil} onStep={stepSet} onPeek={onPeek}
                      addStatus={addStatus.get(r.card.card_id + '|' + r.set)} />
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}

      {/* Bottom search - the one shared dock pill (portals beside the FAB). */}
      <SearchPill value={q} onChange={setQ} onClear={() => setQ('')} placeholder={`Search ${drillName}…`} ariaLabel="Search cards" />

      {/* Filter FAB - the docked spot beside the search bar. Above it, the ADD tools
          (camera + text) search can't do. They are ALWAYS available now: adding is a place,
          not a mode, so there is no add surface to toggle into. The ownership lens that used
          to occupy this slot in read mode is now inline in the header. */}
      <Fab variant="deck" label="Filter cards" icon={<FabGlyph kind="filters" />} badge={activeCount} onClick={() => setFilterOpen(true)} />
      {/* Scan, one tap. Typed import is NOT here on purpose: a paste spanning many sets must
          stay one paste, so it lives on Collection > Overview rather than inside a set where
          it would imply the set scopes it. */}
      <Fab variant="lib" label="Scan cards" className="fab-stacked" icon={<FabGlyph kind="camera" />}
        onClick={() => launchScanner({ onOpenCard: onOpenCodex, mode: 'collection' })} />
      {/* A buy list for the WHOLE set, never the filtered view: selecting "Owned" must not
          turn "Export missing" into an empty file. Missing means no non-foil copy - the same
          definition as the header tally and as set completion. */}
      <ExportListSheet open={exportOpen} listName={`${drillName} - missing`}
        fetchText={async () => missingInSet.map((c) => `1 ${c.name}`).join('\n')}
        onClose={() => setExportOpen(false)} />

      <RefineSheet open={filterOpen && optsLoaded} onClose={() => setFilterOpen(false)} onClear={clearAll}
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
        thByEl={thByEl} setThByEl={setThByEl} totalTh={totalTh} setTotalTh={setTotalTh} costCmp={costCmp} setCostCmp={setCostCmp} powerCmp={powerCmp} setPowerCmp={setPowerCmp}
        artist={artist} setArtist={setArtist} artistOpts={artistOpts}
        groupBy={groupBy} setGroupBy={setGroupBy} groupOpts={GROUP_OPTS} />
    </div>
  );
}

/* ---------------- Lists (Wanted goals + custom Card Lists) ---------------- */

const SHEET_INPUT = {
  width: '100%', height: 44, boxSizing: 'border-box', background: 'var(--surface-well)',
  border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px',
  color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)",
};

// Section header for the lists index. Creation lives on the FAB now, not here: one
// obvious "+" beats a button per section, and it matches every other pillar.
function Section({ title, hint, children }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 5px' }}>
        <span style={{ font: "600 14px/1 var(--f-display)", letterSpacing: '.22em', color: 'var(--accent-ruby)', textTransform: 'uppercase' }}>{title}</span>
      </div>
      {hint && <div style={{ font: "italic 400 15.5px/1.4 var(--f-read)", color: 'var(--ink-muted-warm)', marginBottom: 14 }}>{hint}</div>}
      {children}
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ padding: '6px 0 4px', font: "italic 400 15px/1.5 var(--f-read)", color: 'var(--ink-muted-warm)' }}>{text}</div>;
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

  return (
    <div onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ display: 'flex', gap: 14, alignItems: 'center', width: '100%', boxSizing: 'border-box', cursor: 'pointer', marginBottom: 12, padding: '16px 20px', borderRadius: 19, border: `1px solid ${border}`, background: bg }}>
      {/* Custom grammar: fanned thumbs (what's IN the grouping). Tracked lists get no fan -
          their grammar is the completion bar below, so the two never read alike. */}
      {!wanted && <ListFan cards={thumbs} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title + tally. */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ minWidth: 0, font: "700 21px/1.15 var(--f-display)", color: complete ? '#f4ecdc' : 'var(--ink-head)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</span>
          {wanted ? (
            <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>
              <span style={{ font: "600 24px/1 var(--f-display)", color: complete ? 'var(--gold-num)' : 'var(--accent-ruby)' }}>{p ? p.totalHave : 0}</span>
              <span style={{ font: "400 15px/1 var(--f-read)", color: 'var(--ink-muted-warm)' }}>/{p ? p.totalRequired : 0}</span>
            </span>
          ) : (
            <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>
              <span style={{ font: "600 22px/1 var(--f-display)", color: 'var(--ink-head)' }}>{list.entryCount}</span>
              <span style={{ font: "400 14px/1 var(--f-read)", color: 'var(--ink-muted-warm)' }}> card{list.entryCount === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>

        {/* Card list: description. */}
        {!wanted && list.description ? (
          <div style={{ font: "400 15px/1.4 var(--f-read)", color: 'var(--ink-muted-warm)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.description}</div>
        ) : null}

        {/* Wanted: progress bar + footer. */}
        {wanted && hasBar && (
          <>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--track-neutral)', overflow: 'hidden', marginTop: 12 }}>
              <div style={{ height: '100%', width: `${p.percent}%`, background: 'var(--completion-fill)', borderRadius: 3, transition: 'width .3s ease' }} />
            </div>
            {complete ? (
              <div style={{ marginTop: 11 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 11, background: 'rgba(var(--jade-rgb),.1)', border: '1px solid rgba(var(--jade-rgb),.35)' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent-jade)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  <span style={{ font: "600 9.5px/1 var(--f-display)", letterSpacing: '.14em', color: 'var(--accent-jade)' }}>COMPLETE</span>
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 9 }}>
                <span style={{ font: "400 13px/1 var(--f-read)", color: 'var(--ink-muted-warm)' }}>{p.totalMissing} missing</span>
                <button onClick={(e) => { e.stopPropagation(); onViewMissing?.(); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', font: "600 13px/1 var(--f-ui)", color: 'var(--accent-ruby)', padding: 0 }}>View missing ›</button>
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
      const rows = (await getPool({ q: parsed.name })).filter((c) => !isTokenCard(c));
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
  // Select-all across the CURRENT (searched/filtered) result set - the whole point
  // of bulk import: "water beta -> Select all -> Add". Toggles to Deselect all.
  const shown = pool || [];
  const allSelected = shown.length > 0 && shown.every((c) => selected.has(c.card_id));
  const toggleAll = () => { haptic('light'); setSelected(allSelected ? new Map() : new Map(shown.map((c) => [c.card_id, c]))); };

  const pillBase = { flex: 'none', padding: '7px 15px', borderRadius: 16, cursor: 'pointer', font: "600 12.5px/1 var(--f-ui)", whiteSpace: 'nowrap' };
  const pillGold = { ...pillBase, background: 'rgba(42,33,20,.5)', color: 'var(--gold-num)', border: '1px solid rgba(203,167,95,.45)' };
  const pillRose = { ...pillBase, background: 'rgba(210,88,115,.16)', color: '#f0c8ce', border: '1px solid rgba(210,88,115,.5)' };

  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      {hint && !selectMode && <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 12 }}>{hint}</div>}
      <input value={q} autoFocus onChange={(e) => setQ(e.target.value)}
        placeholder="Search the library - e:water set:beta…" style={{ ...SHEET_INPUT, height: 46 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '12px 2px 2px' }}>
        {!selectMode ? (
          <>
            <span style={{ font: "italic 400 12.5px/1.4 var(--f-read)", color: '#8a7a55' }}>
              {pool == null ? 'Searching…' : `${shown.length} card${shown.length === 1 ? '' : 's'}`}
            </span>
            <button onClick={() => { setSelectMode(true); setSelected(new Map()); }} style={pillGold}>Select</button>
          </>
        ) : (
          <>
            {/* Cancel takes the count's spot on the LEFT; the Select button transforms
                in place on the RIGHT into "Select all · N ⇄ Deselect all · N" - the
                count rides on it, so no separate count is needed. One-tap bulk import. */}
            <button onClick={() => { setSelectMode(false); setSelected(new Map()); }} style={pillRose}>Cancel</button>
            <button onClick={toggleAll} disabled={!shown.length} style={{ ...pillGold, opacity: shown.length ? 1 : 0.5 }}>
              {allSelected ? 'Deselect all' : 'Select all'} · {shown.length}
            </button>
          </>
        )}
      </div>
      {pool == null ? <Loading /> : shown.map((c, i) => {
        const inList = membership.get(c.card_id) || 0;
        const setName = listSetName(c);
        const isSel = selected.has(c.card_id);
        return (
          <div key={c.card_id} onClick={selectMode ? () => toggleSel(c) : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--hair-12)', cursor: selectMode ? 'pointer' : 'default', contentVisibility: 'auto', containIntrinsicSize: 'auto 62px' }}>
            <span style={{ width: 42, flex: 'none' }}><CardArt card={c} radius={6} aspect="5/7" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "600 15px/1.2 var(--f-read)", color: inList > 0 ? '#f4ecdc' : 'var(--ink-head)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                {setName && <span style={listSetPill}>{setName}</span>}
                {inList > 0 && <span style={{ font: "600 10.5px/1 var(--f-mono)", color: 'var(--gold-num)' }}>on list ×{inList}</span>}
              </div>
            </div>
            {selectMode ? (
              // The switch slides in from the right when Select mode turns on (staggered
              // by row for a gentle "apparition"); reduced-motion opts out via the class.
              <span aria-hidden="true" className="cx-sel-switch" style={{ flex: 'none', width: 26, height: 26, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: isSel ? 'linear-gradient(180deg, #d8b872, #b8954f)' : 'transparent', border: `1px solid ${isSel ? 'var(--gold-num)' : 'rgba(203,167,95,.4)'}`,
                animation: 'cxSelIn .24s cubic-bezier(.2,.9,.3,1) both', animationDelay: `${Math.min(i, 14) * 16}ms` }}>
                {isSel && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#1a1206" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
              </span>
            ) : inList > 0 ? (
              <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center' }}>
                <Frost label="One fewer" onClick={() => onStep(c, -1)}>−</Frost>
                <span style={{ minWidth: 22, textAlign: 'center', font: "600 16px/1 var(--f-display)", color: 'var(--ink-head)' }}>{inList}</span>
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
      {/* Pinned grammar: a single ruby heart. No fan and no bar - the Wishlist is the one
          list that is a STATE ("wanted"), not a goal or a grouping. (A star would collide
          with the Promotional set sigil.) */}
      <span aria-hidden="true" style={{
        width: 54, height: 54, flex: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid rgba(var(--ruby-rgb),.4)', background: 'rgba(var(--ruby-rgb),.08)',
      }}>
        <svg viewBox="0 0 24 24" width="23" height="23" fill="var(--accent-ruby)" stroke="var(--accent-ruby)" strokeWidth="1.4" strokeLinejoin="round">
          <path d="M20.8 8.6c0 4.5-8.8 10.2-8.8 10.2S3.2 13.1 3.2 8.6a4.6 4.6 0 0 1 8.8-1.8 4.6 4.6 0 0 1 8.8 1.8z" />
        </svg>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ minWidth: 0, font: "700 21px/1.15 var(--f-display)", color: '#f4ecdc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Wishlist</span>
        </div>
        <div style={{ font: "400 14px/1.4 var(--f-read)", color: 'var(--ink-muted-warm)', marginTop: 6 }}>
          {empty ? 'Cards you want - tap the heart on any card to add it' : `card${summary.count === 1 ? '' : 's'} you want`}
        </div>
      </div>
      {!empty && (
        <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>
          <span style={{ font: "600 24px/1 var(--f-display)", color: 'var(--gold-num)' }}>{summary.count}</span>
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
      setWl({ count: wlRows.length, thumbs: wlRows.slice(0, 3) });
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
      <Section title="Wanted Lists" hint="Named goals - Collection tracks your progress as you acquire cards.">
        {wanted.length ? wanted.map(card) : <Empty text="No wanted lists yet - set a goal and watch it fill in." />}
      </Section>
      <Section title="Card Lists" hint="Custom groupings - a trade binder, a cube, cards to sell.">
        {custom.length ? custom.map(card) : <Empty text="No card lists yet." />}
      </Section>
      <Fab variant="lib" label="New list" icon={<FabGlyph kind="add" />} items={[
        { label: 'New wanted list', onClick: () => setCreate('wanted') },
        { label: 'New card list', onClick: () => setCreate('custom') },
      ]} />
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
// The set pill shows a set only when the card has exactly ONE printing - never an array
// index. See soleSetName in store/printings.js for the bug this replaced.
const listSetName = (card) => soleSetName(card?.sets);

// One card on a list detail. A full-width hairline row (never a rounded card): a
// gilt-framed 5:7 thumb that lights up as you own copies toward the goal, the
// name + set, ONE status line ("X of Y wanted", or a teal COMPLETE once met), and
// frosted -/+ steppers that edit the GOAL - the wanted quantity. The owned count
// is read-only, derived live from the collection, so the row fills in on its own
// as you acquire cards. Custom lists reuse the row with a "COPIES" stepper.
function ListCardRow({ card, owned, target, isWanted, editable, onStep, onPeek, printing = null }) {
  const { goalMet, ownedAny } = goalRowState({ owned, target, isWanted });
  // A wishlist row states the collector item it wants. `listSetName` is the old name-level
  // fallback, which only ever showed a set when the card had exactly one - it cannot tell two
  // wants of one card apart, which is precisely what this row now has to do.
  const setName = printing ?? listSetName(card);
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
          font: "600 18px/1.2 var(--f-read)", color: goalMet ? '#f4ecdc' : 'var(--ink-head)',
        }}>{card.name}</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 7 }}>
          {setName && <span style={listSetPill}>{setName}</span>}
          {goalMet ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-jade)', flex: 'none' }} />
              <span style={{ font: "600 10.5px/1 var(--f-display)", letterSpacing: '.16em', color: 'var(--accent-jade)' }}>COMPLETE</span>
            </span>
          ) : isWanted ? (
            <span>
              <span style={{ font: "600 15px/1 var(--f-display)", color: 'var(--accent-ruby)' }}>{owned}</span>
              <span style={{ font: "400 12.5px/1 var(--f-read)", color: 'var(--ink-muted-warm)' }}> of {target} wanted</span>
            </span>
          ) : (
            <span>
              <span style={{ font: "600 15px/1 var(--f-display)", color: ownedAny ? 'var(--gold-num)' : 'var(--ink-muted-warm)' }}>{owned}</span>
              <span style={{ font: "400 12.5px/1 var(--f-read)", color: 'var(--ink-muted-warm)' }}> owned</span>
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
            <span style={{ font: "600 8.5px/1 var(--f-display)", letterSpacing: '.18em', color: 'var(--accent-ruby)' }}>{isWanted ? 'WANT' : 'COPIES'}</span>
            <span style={{ font: "600 19px/1 var(--f-display)", color: 'var(--ink-head)', marginTop: 4 }}>{target}</span>
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
  const [bulkOpen, setBulkOpen] = useState(false); // paste-a-list bulk add
  const [ownQty, setOwnQty] = useState(new Map()); // keyed like the goal map: item for the Wishlist, card for lists
  const [addPick, setAddPick] = useState([]);      // FIFO of reprints still awaiting a printing choice
  const [qty, setQty] = useState(new Map());       // card_id -> goal qty (optimistic)
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [rename, setRename] = useState(false);
  const [missing, setMissing] = useState(null);    // report for MissingSheet
  const [removeCard, setRemoveCard] = useState(null); // card pending removal confirm
  // ROW IDENTITY. The Wishlist is per COLLECTOR ITEM now, so two rows can share a card_id -
  // an Alpha want and a Beta want are different things to display and to edit. Custom lists
  // stay card-grain, which is correct: a list entry is about the card, not a copy of it.
  const rowKey = (r) => (isWishlist ? (r.item_id ?? `${r.card_id}|`) : r.card_id);
  const cardIndex = useRef(new Map());             // rowKey -> full row
  const qtyRef = useRef(new Map());                // SYNCHRONOUS mirror of `qty` - rapid taps read this, never the stale render closure
  const drainRef = useRef(null);                   // per-open-list goal drain: reconciles from the repo after writes settle
  const goalGenRef = useRef(0);                    // bumped per LOCAL goal edit; guards a slow external refresh

  // Install an authoritative goal snapshot into the synchronous mirror + visible state
  // (used by the initial load AND the drain reconcile).
  const installGoals = (rows) => {
    for (const c of rows) cardIndex.current.set(rowKey(c), c);
    const m = new Map(rows.map((r) => [rowKey(r), r.quantity]));
    qtyRef.current = m; setQty(m);
  };
  const load = async () => {
    setLoaded(false);
    // Wishlist rows come from the qty_wanted ledger (quantity aliased to wanted);
    // regular lists from card_list_entries. Both carry `quantity` = the goal.
    const rows = isWishlist ? await wishlistCards() : await listCards(list.id);
    installGoals(rows);
    setOwnQty(await ownershipFor(rows));
    setLoaded(true);
  };
  useEffect(() => {
    let cancelled = false;
    // Per-open-list drain: when goal writes settle, reconcile from the repo - but ONLY if
    // no newer tap has begun (version guard, in collectionGoalDrain) and this list is still
    // open (the cancel guard), so a slow reconcile can't regress a fresh optimistic edit.
    drainRef.current = createGoalDrain({
      read: () => (isWishlist ? wishlistCards() : listCards(list.id)),
      apply: (rows) => { installGoals(rows); ownershipFor(rows).then(setOwnQty); },
      isAlive: () => !cancelled,
    });
    load();
    // Arriving via a "View missing ›" tap on the index opens straight to the list.
    if (list.openMissing) listProgress(list.id).then(setMissing);
    // Owned counts are read-only here: they redraw live as the collection grows.
    const off = subscribeCollection(() => {
      ownedMap().then(setOwnQty);
      // ...and the WISHLIST's rows are themselves the qty_wanted ledger, so an external
      // toggle (the card sheet's heart, opened over this very list) changes membership, not
      // just owned counts. Without this the sheet said "not wishlisted" while the list
      // beneath it still showed the card until reopened.
      if (listRowsNeedLedgerRefresh({ isWishlist, pendingGoalWrites: drainRef.current?.pending() || 0 })) {
        const genAtStart = goalGenRef.current;
        wishlistCards().then((rows) => {
          ownershipFor(rows).then(setOwnQty);
          // Re-check AFTER the await: a local edit may have begun while this read was in
          // flight, and applying the older snapshot would overwrite the newer optimistic state.
          if (canApplyExternalRows({ cancelled, pendingGoalWrites: drainRef.current?.pending() || 0, genAtStart, genNow: goalGenRef.current })) {
            installGoals(rows);
          }
        });
      }
    });
    return () => { cancelled = true; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id]);

  const listRows = useMemo(() => {
    const out = [];
    for (const [id, t] of qty) { if (t > 0) { const c = cardIndex.current.get(id); if (c) out.push(c); } }
    // Name first, then printing, so a card's items sit together in a stable order rather than
    // swapping places between renders.
    out.sort((a, b) => (a.name || '').localeCompare(b.name || '')
      || String(a.variant_slug || '').localeCompare(String(b.variant_slug || '')));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty]);

  const targetOf = (id) => qty.get(id) || 0;
  // What a wishlist row is FOR - the set and finish it wants. Without this the surface stores
  // per item while showing the user nothing to tell two rows of one card apart.
  const printingLabel = (r) => {
    if (!r?.set) return UNCATEGORISED_LABEL;
    return `${SET_LABEL[r.set] || r.set}${r.foil ? ' · Foil' : ''}`;
  };
  // Persist a goal DELTA on the store-layer queue, bound to the captured profile and
  // keyed per persisted row: a real list writes its card_list_entries row, while the Wishlist
  // uses a CARD-level want chain, because its target row is resolved at write time and cannot
  // be named up front. Keying it on a guessed row meant this surface and the card sheet could
  // serialize edits to the same want on different chains. Removal is an EXPLICIT serialized clear (set-to-0), not a delta, so it wins
  // under optimistic-vs-authoritative drift.
  // Writes name the exact collector item the row represents, so an edit can never land on a
  // sibling printing and never has to ask which one was meant - the row already knows.
  const itemOf = (key) => {
    const r = cardIndex.current.get(key);
    return r ? { cardId: r.card_id, set: r.set, foil: !!r.foil } : { cardId: key, set: null, foil: false };
  };
  const persist = (key, delta) => {
    if (!delta) return Promise.resolve();
    const pid = activeProfileId();
    if (!isWishlist) return enqueueWrite(listRowKey(pid, list.id, key), () => stepListEntry(list.id, key, delta, pid));
    const { cardId, set, foil } = itemOf(key);
    // ONE chain per card, whichever item is edited - bound through queueWantWrite so this
    // surface cannot pick a different key from the card sheet. A row on a real set steps THAT
    // item; an uncategorised row (a migration leftover) has no set to name, so it goes through
    // the card-level writer, which resolves to the row that actually holds the want.
    return queueWantWrite(pid, cardId, () => (
      set ? stepWantedForItem(cardId, { set, foil }, delta, pid) : stepWanted(cardId, delta, pid)
    ));
  };
  const clearEntry = (key) => {
    const pid = activeProfileId();
    if (!isWishlist) return enqueueWrite(listRowKey(pid, list.id, key), () => setListEntry(list.id, key, 0, pid));
    const { cardId, set, foil } = itemOf(key);
    return queueWantWrite(pid, cardId, () => (
      set ? setWantedForItem(cardId, { set, foil }, 0, pid) : setWanted(cardId, 0, pid)
    ));
  };
  // Mutate the SYNCHRONOUS goal mirror and the visible state together, so rapid taps
  // accumulate off qtyRef instead of a stale render closure. Reconciliation from the repo
  // (once writes settle, guarded against regressing a newer edit) lives in the per-list drain.
  // Every LOCAL goal edit bumps a generation, so an external refresh that started earlier can
  // tell on arrival that it is now stale (see canApplyExternalRows).
  // Ownership keyed the SAME way as the goal map, or the comparison silently finds nothing.
  //
  // Wishlist goals are per collector item, so ownership must be too - and it must be that
  // item's own count. Owning an Alpha copy does not satisfy a Beta want, and a non-foil copy
  // does not satisfy a foil want: they are different collector items, which is the premise of
  // the whole schema change. Custom lists stay card-level, where a card-level sum is right.
  const ownershipFor = async (rows) => (
    isWishlist
      ? new Map(rows.map((r) => [rowKey(r), r.owned || 0]))
      : await ownedMap(rows.map((r) => r.card_id))
  );

  const applyGoal = (mutate) => { goalGenRef.current += 1; const m = new Map(qtyRef.current); mutate(m); qtyRef.current = m; setQty(m); };
  const track = (p) => drainRef.current?.track(p);
  // The in-list picker's add/step - stashes the full card row so a brand-new card
  // renders immediately, and (unlike the row stepper) a step to 0 just removes it,
  // no confirm, since you're actively curating.
  // ADDING RESOLVES THE COLLECTOR ITEM FIRST.
  //
  // It used to key optimistic state on card_id while existing Wishlist rows are keyed by item,
  // so adding a reprint created a phantom card-keyed row and then called the card-level writer -
  // which throws NeedsPrintingChoice when there is no want to resolve to. Resolution happens
  // before any state is touched, so the picker opens instead of a write failing.
  const addStep = (card, delta, item = null) => {
    if (!isWishlist) {
      const id = card.card_id;
      cardIndex.current.set(id, card);
      const next = Math.max(0, (qtyRef.current.get(id) || 0) + delta);
      haptic('light');
      applyGoal((m) => { if (next <= 0) m.delete(id); else m.set(id, next); });
      track(persist(id, delta));
      return;
    }

    const codes = (() => { try { return (JSON.parse(card.sets || '[]') || []).map((x) => x?.code).filter(Boolean); } catch { return []; } })();
    let target = item;
    if (!target) {
      // An existing unambiguous want is the obvious target: stepping what is already there
      // beats asking about a decision the user has already made.
      // Reused for ANY delta, not just removals. Pressing + on a card the user already wants
      // exactly one printing of should step THAT printing - asking again would make them
      // re-answer a question they have already answered, and would then create a second row.
      const mine = [...qtyRef.current.keys()].filter((k) => String(k).startsWith(`${card.card_id}|`));
      if (mine.length === 1) {
        const r = cardIndex.current.get(mine[0]);
        if (r) target = { set: r.set, foil: !!r.foil };
      }
      if (!target) {
        const t = wantTarget(codes, { set: null });
        // QUEUED, not assigned. A multi-select can contain several reprints, and overwriting a
        // pending question with the next one silently dropped the first card.
        if (t.kind === 'ask') { setAddPick((q) => [...q, { card, codes }]); return; }
        if (t.kind === 'unknown') { toast('The catalog does not list a printing for this card', { tone: 'warn' }); return; }
        target = t.item;
      }
    }

    const slug = target.set ? canonicalPrinting(target.set, !!target.foil) : UNCATEGORISED;
    const id = `${card.card_id}|${slug}`;
    cardIndex.current.set(id, { ...card, item_id: id, variant_slug: slug, set: target.set, foil: !!target.foil });
    const next = Math.max(0, (qtyRef.current.get(id) || 0) + delta);
    haptic('light');
    applyGoal((m) => { if (next <= 0) m.delete(id); else m.set(id, next); });
    track(persist(id, delta));
  };
  // Steppers edit the GOAL (wanted qty), never the owned count. The goal floors at
  // 1; a step past it removes the card from the list, and that always confirms.
  function step(cardId, delta) {
    const cur = qtyRef.current.get(cardId) || 0;
    if (delta < 0 && cur <= 1) {
      const c = cardIndex.current.get(cardId);
      setRemoveCard({ card_id: cardId, name: c?.name || 'this card' });
      return;
    }
    haptic('light');
    const next = Math.max(1, cur + delta);
    applyGoal((m) => m.set(cardId, next));
    track(persist(cardId, delta));
  }
  function removeEntry(cardId) {
    setRemoveCard(null);
    haptic('light');
    applyGoal((m) => m.delete(cardId));
    track(clearEntry(cardId));
  }

  const totals = useMemo(() => goalTotals(qty, ownQty), [qty, ownQty]);

  // AddCardsSheet asks "is this card already in the list", which is a CARD question. Handing it
  // the item-keyed goal map meant every membership check missed, so an already-wanted reprint
  // looked absent.
  const cardMembership = useMemo(() => {
    if (!isWishlist) return qty;
    const m = new Map();
    for (const [k, v] of qty) {
      const cardId = String(k).split('|')[0];
      m.set(cardId, (m.get(cardId) || 0) + v);
    }
    return m;
  }, [qty, isWishlist]);

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
          <div style={{ font: "700 22px/1.1 var(--f-display)", color: 'var(--ink-head)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.name}</div>
          <div style={{ font: "600 10.5px/1 var(--f-display)", letterSpacing: '.2em', color: 'var(--accent-ruby)', marginTop: 5 }}>{isWishlist ? 'WISHLIST' : isWanted ? 'WANTED LIST' : 'CARD LIST'}</div>
        </div>
        {showProgress && totals.req > 0 && (
          <div style={{ flex: 'none', textAlign: 'right', lineHeight: 1 }}>
            <span style={{ font: "600 26px/1 var(--f-display)", color: totals.complete ? 'var(--gold-num)' : 'var(--accent-ruby)' }}>{totals.have}</span>
            <span style={{ font: "400 15px/1 var(--f-read)", color: 'var(--ink-muted-warm)' }}>/{totals.req}</span>
          </div>
        )}
        {/* Delete routes through its OWN confirm sheet - destructive and never undoable, so
            it is never one tap. The Wishlist is virtual and fixed: no rename, duplicate or
            delete, and OverflowMenu drops the null entries. */}
        <OverflowMenu label="List actions" items={[
          { label: 'Add from text', icon: TextImportSvg, onClick: () => setBulkOpen(true) },
          isWishlist ? null : { label: 'Edit list', icon: EditSvg, onClick: () => setRename(true) },
          isWishlist ? null : { label: 'Duplicate list', icon: CopySvg, onClick: async () => { await duplicateList(list.id); toast('List duplicated'); onBack(); } },
          { label: 'Export as text', icon: TextImportSvg, onClick: () => setExportOpen(true) },
          isWanted ? { label: 'Get missing cards', icon: SeekSvg, onClick: openMissing } : null,
          isWishlist ? null : { label: 'Delete list', icon: TrashSvg, danger: true, onClick: () => setConfirmDel(true) },
        ]} />
      </div>

      {meta.description && <div style={{ font: "italic 400 15px/1.45 var(--f-read)", color: 'var(--ink-muted-warm)', margin: '0 2px 14px' }}>{meta.description}</div>}

      {/* Progress bar (wanted only): fills rose as the collection acquires copies,
          turning gold at 100%. "View missing ›" filters to what is still short. */}
      {showProgress && totals.req > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--track-neutral)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${totals.percent}%`, background: 'var(--completion-fill)', borderRadius: 3, transition: 'width .3s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ font: "400 12.5px/1 var(--f-read)", color: 'var(--ink-muted-warm)' }}>
              {totals.complete ? 'Every card collected' : `${totals.missing} missing`}
            </span>
            {isWanted && totals.missing > 0 && (
              <button onClick={openMissing} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: "600 12.5px/1 var(--f-ui)", color: 'var(--accent-ruby)' }}>View missing ›</button>
            )}
          </div>
        </div>
      )}

      {/* Summary + hairline rows, or the empty state. Read-first: steppers hide
          until Edit; cards join via the in-list "Add cards" picker. */}
      {!loaded ? <Loading /> : listRows.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <div style={{ font: "italic 400 15px/1.6 var(--f-read)", color: 'var(--ink-muted-warm)', marginBottom: 10 }}>
            {isWishlist ? 'Nothing on your wishlist yet.' : 'No cards yet.'}
          </div>
          <button onClick={() => setAddOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', font: "600 14px/1 var(--f-ui)", color: 'var(--accent-ruby)' }}>Add cards ›</button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
            <span style={{ font: "italic 400 13.5px/1.4 var(--f-read)", color: '#8a7a55' }}>
              {totals.names} card{totals.names === 1 ? '' : 's'}{isWanted && totals.done > 0 ? ` · ${totals.done} complete` : ''}
            </span>
            <button onClick={() => setEditing((e) => !e)} aria-pressed={editing}
              style={{ flex: 'none', padding: '6px 14px', borderRadius: 16, cursor: 'pointer', font: "600 12.5px/1 var(--f-ui)", whiteSpace: 'nowrap',
                background: editing ? 'linear-gradient(180deg, #d8b872, #b8954f)' : 'rgba(42,33,20,.5)', color: editing ? '#1a1206' : 'var(--gold-num)', border: `1px solid ${editing ? 'var(--gold-num)' : 'rgba(210,88,115,.5)'}` }}>
              {editing ? 'Done' : 'Edit'}
            </button>
          </div>
          {listRows.map((c) => (
            // Keyed and stepped by ROW identity, not card_id: two wishlist rows can share a
            // card, and a card_id key would collapse them in React and send both edits to one.
            <ListCardRow key={rowKey(c)} card={c} owned={ownQty.get(rowKey(c)) || 0} target={targetOf(rowKey(c))}
              printing={isWishlist ? printingLabel(c) : null}
              isWanted={showProgress} editable={editing} onStep={(d) => step(rowKey(c), d)} onPeek={() => onPeek(c.card_id)} />
          ))}
        </>
      )}

      {/* Adding cards is the primary action, so it gets the FAB. Everything else is
          list-level chrome and lives in the header overflow.

          It is NOT a camera FAB, despite the set drill's being one. launchScanner has only
          'collection' and 'deck' modes - scanning here would silently add to the collection
          rather than to this list, which is worse than not offering it. When the scanner
          learns a list mode this becomes a camera and "Add cards" joins the overflow. */}
      <Fab variant="lib" label="Add cards to this list" icon={<FabGlyph kind="add" />}
        onClick={() => setAddOpen(true)} />

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
        membership={cardMembership} onStep={addStep} />

      {/* The picker, reached when adding a reprint the user has no existing want for. */}
      <WantPrintingSheet
        open={addPick.length > 0}
        cardId={addPick[0]?.card?.card_id}
        cardName={addPick[0]?.card?.name}
        setCodes={addPick[0]?.codes || []}
        onPick={(item) => { const p = addPick[0]; setAddPick((q) => q.slice(1)); if (p) addStep(p.card, 1, item); }}
        /* Skipping one card must not abandon the rest of the batch. */
        onClose={() => setAddPick((q) => q.slice(1))} />

      <ListBulkAddSheet open={bulkOpen} onClose={() => setBulkOpen(false)} listName={meta.name}
        onApply={(adds) => {
          // ADD each resolved qty onto the list in one state write; persist each as a
          // DELTA (a.qty) on the queue so overlapping/bulk adds accumulate correctly.
          haptic('light');
          // ADD FROM TEXT, routed through the same resolution as every other add.
          //
          // It used to write optimistic state under card_id and call the card-level persist
          // path, so an ambiguous reprint was announced as added and then failed - the surface
          // said one thing and the ledger did another. addStep resolves the collector item
          // first, files what it can, and queues the reprints it cannot for the picker.
          if (isWishlist) {
            for (const a of adds) addStep(a.card, a.qty);
            return;
          }
          const m = new Map(qtyRef.current);
          for (const a of adds) { cardIndex.current.set(a.card.card_id, a.card); m.set(a.card.card_id, (m.get(a.card.card_id) || 0) + a.qty); track(persist(a.card.card_id, a.qty)); }
          qtyRef.current = m; setQty(m);
          const copies = adds.reduce((s, a) => s + a.qty, 0);
          toast(`Added ${copies} cop${copies === 1 ? 'y' : 'ies'} to ${meta.name}`);
        }} />

      <MissingSheet open={!!missing} report={missing} title={`Missing for ${meta.name}`}
        onOpenCard={(id) => onOpen('card', id)} onClose={() => setMissing(null)} onChanged={() => onChanged?.()} />
    </div>
  );
}
