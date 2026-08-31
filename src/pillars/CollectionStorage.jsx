// STORAGE - where the cards physically are (docs/proposals/collection-storage.md, increment 3).
//
// PLACEMENT. Storage is the THIRD SEGMENT of My Collection - "put Storage under its own section in
// the pill nav and rearrange so we have ALL - SETS - STORAGE" (owner, 2026-08-18, amending the
// original "below the sets grid" ruling). It stays INSIDE My Collection and the chip row stays at
// three. All, Sets and Storage are three lenses on the same owned cards: every card flat, the sets
// the game defines, and the places you keep them in.
//
// Being a peer surface rather than a strip under the grid also removed a real defect: trailing the
// sets grid put these rows beneath the fixed bottom nav, where they could not be tapped at all.
//
// WHAT IT IS FOR. My Collection answers "what do I own". Storage answers "where is it". So a place
// never headlines an owned total - it headlines what is in it.
//
// NOT A FOLDER, per Q16. Four copies legitimately sit in three places at once, so there is no "move
// to folder" gesture: allocation is a stepper in the per-card ledger (increment 4) against a live
// remainder. Every row here therefore carries a quantity - without the number a card appearing in
// three places reads as duplication or a bug.
//
// Reused rather than rebuilt, per the proposal's inventory and Q21: AppBar's sub variant for the
// detail header (the same chassis list detail uses), OverflowMenu, SearchPill, SortRow with
// LIST_SORT_OPTIONS and stackComparator for arrange, ListRow, SectionLabel, Fab, BottomSheet,
// SET_LABEL for set names. New only where the proposal asked for something new: SwatchPicker.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  BottomSheet, SectionLabel, Loading, EmptyCta, SegTabs, ListRow, SortRow,
  BTN_GOLD, BTN_GHOST,
} from '../components/ui.jsx';
import AppBar from '../components/AppBar.jsx';
import CollectionSubHeader from '../components/CollectionSubHeader.jsx';
import CardArt from '../components/CardArt.jsx';
// The Lists card-row vocabulary, imported rather than respelled - see the row itself for why the
// row is mirrored while its pieces are shared.
import { GILT, GLOW, SET_PILL, FiledSeal } from '../components/CollectionCardViews.jsx';
import SearchPill from '../components/SearchPill.jsx';
import OverflowMenu, { MenuGlyph } from '../components/OverflowMenu.jsx';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import SwatchPicker from '../components/SwatchPicker.jsx';
import {
  listContainers, containerContents, createContainer, updateContainer, deleteContainer,
  reorderContainers, duplicateName, moveItemAllocation, bulkMoveAllocations, bulkFileFromUnfiled,
  storageWriteMessage, MAX_CONTAINER_NAME, MAX_CONTAINER_DESC,
} from '../store/storageDirectory.js';
import DragReorderList, { DragReorderRow } from '../components/DragReorderList.jsx';
import { reorderList } from '../store/reorderModel.js';
import { subscribeCollection } from '../store/ownedRepository.js';
import {
  CONTAINER_KINDS, CONTAINER_COLOURS, containerColourVar, UNFILED_NAME,
} from '../store/storageVocabulary.js';
import { parsePrinting } from '../store/printings.js';
import { printingArt } from '../store/printingRows.js';
import { SET_LABEL } from '../store/sets.js';
import { stackComparator, normaliseSort } from '../store/collectionFilter.js';
import { LIST_SORT_OPTIONS } from '../store/sortOptions.js';
import { toggleSort, flipSort, sortIndex } from '../components/sortStack.js';
import { StepBtn } from '../components/CollectionCardSheet.jsx';
import { registerBackConsumer } from '../back.js';
import { toast, confirmAction } from '../feedback.js';

/** Toast a Storage write failure in one voice, danger-toned, never leaking internals. */
const toastStorageError = (err) => { const m = storageWriteMessage(err); toast(m.text, { tone: m.tone }); };

// The shared sheet-input recipe (tokenised surface, 12-radius, 44px), matching Collection's inputs
// rather than a local rgba divergence.
const SHEET_INPUT = {
  width: '100%', height: 44, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12,
  background: 'var(--surface-well)', border: '1px solid var(--hair-22)',
  color: 'var(--ink-body)', font: "500 15px/1 var(--f-read)",
};
// Q7's fixed list, labelled as Q7 names them. "Deck", not "Deck box".
const KIND_LABEL = { binder: 'Binder', box: 'Box', deck: 'Deck', other: 'Other' };
const COLOUR_OPTIONS = CONTAINER_COLOURS.map((c) => ({
  value: c, label: c[0].toUpperCase() + c.slice(1), css: containerColourVar(c),
}));
/** The set NAME, never the slug. '001' is a storage key; "Alpha" is what a person calls it. */
const setName = (code) => (code ? (SET_LABEL[code] || code) : 'No set recorded');

function PlaceGlyph({ colour, kind, size = 30 }) {
  const path = kind === 'unfiled' ? <><path d="M4 9h16v10H4z" /><path d="M7 5h10l3 4H4z" /><path d="M9 13h6" /></>
    : kind === 'binder' ? <><path d="M7 4h10v16H7z" /><path d="M10 4v16" /></>
    : kind === 'box' ? <><path d="M4 8h16v11H4z" /><path d="M3 5h18v4H3z" /></>
      : kind === 'deck' ? <><rect x="6" y="4" width="12" height="16" rx="2" /><path d="M9 8h6M9 12h6" /></>
        : <><path d="M4 7h16v13H4z" /><path d="M8 7V4h8v3" /></>;
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: 8, display: 'grid', placeItems: 'center',
      background: 'rgba(10,9,7,.7)', border: `1px solid ${containerColourVar(colour)}`,
      color: containerColourVar(colour),
    }}>
      <svg viewBox="0 0 24 24" width={size * .58} height={size * .58} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
    </span>
  );
}

// The pinned Unfiled card - the same gilt chassis the Wishlist wears on Lists, so the app has ONE
// grammar for "system-owned, always present, not one of yours": gold circle + display title + gold
// numeral under a PINNED rubric. Q13/Q15: always visible, always first, a stable destination - now
// visibly a different class, not the first of the user's places. No drag binding and no menu:
// Unfiled is not part of the user's order and is not the user's to rename or delete.
function PinnedPlaceCard({ place, onClick }) {
  return (
    <div onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ display: 'flex', gap: 14, alignItems: 'center', width: '100%', boxSizing: 'border-box', cursor: 'pointer', marginBottom: 22, padding: '16px 20px', borderRadius: 19, border: '1px solid rgba(227,197,137,.42)', background: 'linear-gradient(180deg, rgba(203,167,95,.07), rgba(203,167,95,.02))' }}>
      {/* The open tray, gold rather than a place colour: the pinned element is chrome, not one of
          the user's coloured shelves. Same glyph the row wore, drawn larger for the card. */}
      <span aria-hidden="true" style={{
        width: 54, height: 54, flex: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid rgba(203,167,95,.45)', background: 'rgba(203,167,95,.12)', color: 'var(--gold-leaf)',
      }}>
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9h16v10H4z" /><path d="M7 5h10l3 4H4z" /><path d="M9 13h6" />
        </svg>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ minWidth: 0, font: "700 21px/1.15 var(--f-display)", color: '#f4ecdc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.name}</span>
        </div>
        <div style={{ font: "400 14px/1.4 var(--f-read)", color: 'var(--ink-muted-warm)', marginTop: 6 }}>
          Cards you own that you have not filed yet
        </div>
      </div>
      <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>
        <span style={{ font: "600 24px/1 var(--f-display)", color: 'var(--gold-num)' }}>{place.copies}</span>
      </span>
    </div>
  );
}

/* ---------------- create / edit ---------------- */

// One sheet for both. `existing` changes the copy and nothing else: per Q8 the KIND stays editable
// after creation, because cards move from a deck into a box constantly.
function PlaceSheet({ open, existing, onClose, onSubmit }) {
  const [name, setName_] = useState('');
  const [kind, setKind] = useState('binder');
  const [colour, setColour] = useState('gold');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState('');

  useEffect(() => {
    if (!open) return;
    setName_(existing?.name || '');
    setKind(existing?.kind || 'binder');
    setColour(existing?.colour || 'gold');
    setDesc(existing?.description || '');
    setBusy(false); setErr(''); setWarn('');
  }, [open, existing]);

  // Q9: a duplicate name is ALLOWED. So this WARNS and leaves the button live - two binders really
  // can both be called Beta, and the app is not the arbiter of what someone calls their own shelves.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const nm = name.trim();
      if (!nm) { if (alive) setWarn(''); return; }
      const dupe = await duplicateName(nm, { selfId: existing?.id || null });
      if (alive) setWarn(dupe ? `You already have a place called “${nm}”. That is allowed.` : '');
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [name, existing]);

  const go = async () => {
    const nm = name.trim();
    if (!nm || busy) return;
    setBusy(true); setErr('');
    try { await onSubmit({ name: nm, kind, colour, description: desc.trim() }); }
    catch (e) { setErr(e?.message || 'That did not work.'); setBusy(false); }
  };

  return (
    <BottomSheet open={open} title={existing ? 'EDIT PLACE' : 'NEW PLACE'} onClose={onClose}>
      <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 14 }}>
        {existing ? 'Renaming a place never moves what is inside it.'
          : 'A binder, a box, a deck - somewhere you actually keep cards.'}
      </div>
      <input value={name} autoFocus maxLength={MAX_CONTAINER_NAME}
        onChange={(e) => { setName_(e.target.value); setErr(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        placeholder="e.g. Trade binder" style={SHEET_INPUT} />

      {/* Q12: one short optional line. "Top shelf, spare room" is exactly what this feature is for. */}
      <input value={desc} maxLength={MAX_CONTAINER_DESC}
        onChange={(e) => setDesc(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        placeholder="Where is it? (optional)"
        style={{ ...SHEET_INPUT, marginTop: 10, font: "400 13.5px/1 var(--f-read)" }} />

      <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}>
        <SegTabs ariaLabel="What kind of place" value={kind} onChange={setKind}
          options={CONTAINER_KINDS.map((k) => ({ key: k, label: KIND_LABEL[k] }))} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '4px 0' }}>
        <span style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.14em', color: 'var(--ink-muted)' }}>COLOUR</span>
        <SwatchPicker label="Place colour" options={COLOUR_OPTIONS} value={colour} onChange={setColour} />
      </div>

      {warn && (
        <div style={{ font: "400 12.5px/1.45 var(--f-read)", color: 'var(--ink-muted-warm)', marginTop: 10 }}>{warn}</div>
      )}
      {err && (
        <div role="alert" style={{ font: "500 12.5px/1.45 var(--f-read)", color: 'var(--ink-danger, #e2777a)', marginTop: 10 }}>{err}</div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button onClick={onClose} disabled={busy} style={{ ...BTN_GHOST, flex: 1 }}>Cancel</button>
        <button onClick={go} disabled={!name.trim() || busy}
          style={{ ...BTN_GOLD, flex: 1, justifyContent: 'center', opacity: name.trim() && !busy ? 1 : 0.5 }}>
          {busy ? 'Saving…' : existing ? 'Save' : 'Create place'}
        </button>
      </div>
    </BottomSheet>
  );
}

/* ---------------- the section, below the sets grid ---------------- */

export function StorageIndex({ onOpenPlace, rev }) {
  const [places, setPlaces] = useState(null);
  const [create, setCreate] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => { const rows = await listContainers(); if (alive) setPlaces(rows); };
    run();
    const off = subscribeCollection(run);
    return () => { alive = false; off(); };
  }, [rev]);

  // Q15: Unfiled is pinned FIRST and visually distinct. `listContainers` already orders it first;
  // this only separates it for rendering - and, since the ordering gesture arrived, for dragging:
  // Unfiled is not part of the user's order, so it is not part of the draggable list at all.
  const unfiled = (places || []).find((p) => p.is_system) || null;
  const mine = useMemo(() => (places || []).filter((p) => !p.is_system), [places]);

  // LONG-PRESS AND DRAG to reorder (DESIGN_SYSTEM §Ordering, owner ruling 2026-08-20). Unfiled needs
  // no bounds clamp because it is never inside the draggable list: the list's indices ARE the user's
  // places, so there is no pinned row for a drag to reach or displace.
  //
  // OPTIMISTIC, then reconciled. The row is already where the finger left it when the write starts,
  // so the list must agree immediately or it would visibly snap back for the length of a transaction.
  // The write notifies the collection, so the subscription re-reads and confirms; a refusal toasts
  // and re-reads, which puts the truth back on screen rather than leaving a lie.
  const mineIds = useMemo(() => mine.map((p) => p.id), [mine]);
  const commitOrder = async (from, to) => {
    const next = reorderList(mine, from, to);
    if (next === mine) return;
    setPlaces(unfiled ? [unfiled, ...next] : next);
    try { await reorderContainers(next.map((p) => p.id)); }
    catch (err) { toastStorageError(err); setPlaces(await listContainers()); }
  };

  if (places == null) return <Loading />;

  const row = (p) => (
    <ListRow
      icon={<PlaceGlyph colour={p.colour} kind={p.kind} />}
      title={p.name}
      // Only the user's own places flow through here now: Unfiled wears the pinned card above.
      sub={[KIND_LABEL[p.kind] || 'Place', p.description || null, `${p.cards || 0} ${(p.cards || 0) === 1 ? 'card' : 'cards'}`].filter(Boolean).join(' · ')}
      // NO menu button here. ListRow is a clickable div, so a button nested inside it never gets
      // the tap - the row's own handler fires first and navigates. It was also the only row in the
      // app carrying an overflow: everywhere else that control lives in a HEADER.
      trailing={<span style={{ font: "600 15px/1 var(--f-mono)", color: 'var(--gold-leaf)' }}>{p.copies}</span>}
      onClick={() => onOpenPlace(p)} />
  );

  // The tally counts EVERY place a copy can be, Unfiled included - it is a place, it is always
  // there, and a count that silently omitted it would disagree with the list right beneath it.
  const shownPlaces = unfiled ? [unfiled, ...mine] : mine;
  const totalCopies = shownPlaces.reduce((n, p) => n + (Number(p.copies) || 0), 0);

  return (
    <div style={{ padding: '2px 20px' }}>
      {/* The SAME header chassis All and Sets use, not a bespoke headline. Storage is the third
          lens on My Collection, so it wears the same eyebrow/title/tally band its two peers do -
          the old "Every copy has a place." block was the only headline of its kind in the pillar.
          The explainer below it stays: it is the one thing a new user needs told. */}
      <CollectionSubHeader title="Storage"
        tally={`${shownPlaces.length} place${shownPlaces.length === 1 ? '' : 's'} · ${totalCopies} ${totalCopies === 1 ? 'copy' : 'copies'}`} />
      <div style={{ margin: '2px 0 18px' }}>
        <div style={{ maxWidth: 430, font: "400 13.5px/1.45 var(--f-read)", color: 'var(--ink-muted)' }}>
          Unfiled holds new copies. Make places that match your shelves, binders and boxes, then file each printing from its card sheet.
          {mine.length > 1 && ' Hold a place and drag it to change the order.'}
        </div>
      </div>
      {unfiled && (
        <>
          <SectionLabel label="PINNED" />
          <PinnedPlaceCard place={unfiled} onClick={() => onOpenPlace(unfiled)} />
        </>
      )}
      <SectionLabel label="YOUR PLACES" count={mine.length || undefined} />
      {/* Q30: empty with a prompt, not with starter containers nobody asked for. EmptyCta is the
          app's empty-state shape; the ACTION is the FAB below, because that is how every create in
          Collection works - an inline button here matched nothing else in the app. */}
      {mine.length > 0
        ? (
          <DragReorderList ids={mineIds} onReorder={commitOrder}>
            {mine.map((p) => <DragReorderRow key={p.id} id={p.id}>{row(p)}</DragReorderRow>)}
          </DragReorderList>
        )
        : <EmptyCta text="No named places yet. A place is a binder, a box, a deck - somewhere you actually keep cards." />}

      <Fab variant="lib" label="Make a place" icon={<FabGlyph kind="add" />} onClick={() => setCreate(true)} />
      <PlaceSheet open={create} onClose={() => setCreate(false)}
        onSubmit={async (fields) => { await createContainer(fields); setCreate(false); }} />
    </div>
  );
}

// The bulk bar, portaled into the shared bottom-dock slot exactly as the All and Sets grids'
// SelectionBar is - same `cx-search-pill` chrome, same round cancel, same gold pill actions - so
// selection feels identical wherever it happens. Only the actions are Storage's own: file the
// selection into another place, or send it back to Unfiled. Entry and the running count / select-all
// live on the header pill, matching those grids; this bar is cancel + actions, nothing else.
function StorageSelectBar({ count, canUnfile, onCancel, onFile, onUnfile }) {
  const [slot, setSlot] = useState(() => (typeof document !== 'undefined' ? document.getElementById('cx-dock-search') : null));
  useEffect(() => { if (!slot) setSlot(document.getElementById('cx-dock-search')); });
  if (!slot) return null;
  const on = count > 0;
  const btn = {
    flex: 1, minWidth: 0, minHeight: 44, padding: '0 8px', borderRadius: 18, whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis', border: '1px solid rgba(203,167,95,.45)',
    background: 'rgba(42,33,20,.55)', color: 'var(--gold-leaf)', font: "600 12px/1 var(--f-ui)",
    cursor: on ? 'pointer' : 'default', opacity: on ? 1 : 0.4,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
  return createPortal(
    <div className="cx-search-pill" style={{ gap: 7 }}>
      <button onClick={onCancel} aria-label="Cancel selection" style={{ flex: 'none', width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--hair-40)', background: 'transparent', color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
      <button onClick={() => on && onFile()} disabled={!on} style={btn}>File in…</button>
      {canUnfile && <button onClick={() => on && onUnfile()} disabled={!on} style={btn}>Unfile</button>}
    </div>,
    slot,
  );
}

// The destination picker BOTH File gestures open - one row's copies, or the whole selection.
//
// REBUILT after being lost from the working tree: the two call sites in StorageDetail survived an
// edit that took the component with it, and the diff should read honestly about that. The cost is
// worth recording, because nothing caught it. `<FileCopiesSheet/>` compiles to
// `jsx(FileCopiesSheet, …)`, so a missing component is a free identifier - Rollup cannot resolve
// it, treats it as a global, and emits the name into the bundle intact while every real local is
// mangled. The build stays green, every gate stays green, and the FIRST RENDER of any place throws
// ReferenceError. Nothing in this app catches a render error, so React unmounts the root and the
// screen goes black. That was build 293, tapping Unfiled. `check:source` now guards the class.
//
// ONE component for both modes, because they differ in exactly one thing: how many copies move. A
// single row can move part of its stack, so it gets the stepper. A bulk selection moves WHOLE
// allocations - that is what bulkMoveAllocations does - so a quantity control there would be a
// control that lies, and bulk passes `null` rather than a number nobody reads.
//
// It CLOSES ITSELF on success and STAYS OPEN on failure, because every call site hands it an onFile
// that writes and toasts but never dismisses, and moveItemAllocation can refuse with a
// StorageConflict. A refused move has to leave the user looking at the picker they were using with
// the reason in a danger toast, not at a surface that dismissed as though the copies had moved.
//
// THE BULK SENTENCE NAMES ITS SOURCE. It used to say "all copies of N selected cards", which was
// true only while the sole bulk caller was a place moving what IT held. The Collection grid files
// what is UNFILED, so the same words would have promised to move copies already sitting in a binder.
// Rather than a second sentence per caller, the one sentence says which place the copies come out of
// - `source` is already the prop that decides that, and it reads correctly at every call site.
export function FileCopiesSheet({ open, source, places, row = null, selectedCount = 0, loading = false, onClose, onFile }) {
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(null);   // id of the destination whose write is in flight
  // Reset on OPEN, the AddCopiesSheet pattern - a sheet reopened after a refusal must not still be
  // holding the last attempt's quantity or a stuck busy flag.
  useEffect(() => { if (open) { setQty(1); setBusy(null); } }, [open]);

  // The bulk call site passes `selectedCount` and no `row`; the single-row call site the reverse.
  // Keyed on the row rather than the count, so the sheet can never land in single-row mode with no
  // row to file - at both call sites the two readings agree.
  const bulk = !row;
  // `row.qty` is what is in THIS place, and this place is what the move takes from - so it is the
  // ceiling. Offering more than the source holds could only reach a StorageConflict.
  const max = Math.max(1, Number(row?.qty) || 1);
  // Never offer the place the copies are already in.
  const destinations = (places || []).filter((p) => p.id !== source?.id);

  const go = async (destination) => {
    if (busy != null) return;
    setBusy(destination.id);
    try { await onFile(destination, bulk ? null : qty); onClose(); }
    catch (err) { toastStorageError(err); setBusy(null); }
  };

  return (
    <BottomSheet open={open} title={bulk ? 'FILE SELECTED' : 'FILE COPIES'} onClose={onClose}>
      <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 14 }}>
        {bulk
          ? `Choose where to file the copies of ${selectedCount} selected card${selectedCount === 1 ? '' : 's'}${source?.name ? ` that are in ${source.name}` : ''}.`
          : <>Choose where to file <strong style={{ color: 'var(--ink-body)' }}>{row.name || row.card_id}</strong>, out of {source?.name}. You still own every copy - only where they are changes.</>}
      </div>

      {!bulk && max > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, marginBottom: 18 }}>
          <StepBtn dir={-1} disabled={busy != null || qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))} />
          <span style={{ font: "500 34px/1 var(--f-display)", color: '#efe7d8', minWidth: 48, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{qty}</span>
          <StepBtn dir={1} disabled={busy != null || qty >= max} onClick={() => setQty((n) => Math.min(max, n + 1))} />
        </div>
      )}

      {/* The place rows are StorageIndex's own row - ListRow + PlaceGlyph, which is where
          containerColourVar is already applied - rather than a second way to draw a place. */}
      {/* `loading` exists for the grid caller, which reads its places only when the sheet opens: for
          those few milliseconds "there is nowhere to file these" would be a claim about the user's
          collection rather than about a query that has not answered yet. */}
      {loading
        ? <Loading />
        : destinations.length === 0
          ? <EmptyCta pad="18px 12px" size={13.5} text="There is nowhere else to file these yet. Make a place first." />
          : destinations.map((p) => (
            <ListRow key={p.id}
              icon={<PlaceGlyph colour={p.colour} kind={p.kind} />}
              title={p.name}
              sub={p.is_system
                ? 'Owned, but not filed anywhere'
                : [KIND_LABEL[p.kind] || 'Place', p.description || null].filter(Boolean).join(' · ')}
              trailing={busy === p.id
                ? <span style={{ flex: 'none', font: "500 11.5px/1 var(--f-ui)", color: 'var(--ink-muted)' }}>Filing…</span>
                : undefined}
              onClick={() => go(p)} />
          ))}
    </BottomSheet>
  );
}

/**
 * The GRID-side bulk File, packaged so a Collection grid can drop it in and know nothing about places.
 *
 * WHY IT LIVES HERE and not in Collection.jsx: the grids own a selection of CARDS. Which places
 * exist, that Unfiled is the source, that Unfiled must therefore not appear among the destinations,
 * how a refusal is worded - all of that is Storage's vocabulary, and putting it in the pillar that
 * owns it keeps two grids from each growing their own copy of it. Collection.jsx gains one element
 * and one boolean.
 *
 * `source` is the Unfiled row, which does two jobs at once: `FileCopiesSheet` filters the source out
 * of its own destination list, and the bulk sentence names it, so the picker says the copies come
 * out of Unfiled rather than promising to move everything the user owns.
 *
 * The grid keeps exactly ONE decision - whether the selection survives - because the selection is
 * the grid's state. `onFiled` hands it the result to decide on, which is also why the rule ("keep it
 * when nothing moved, so the user can adjust") stays readable at the call site instead of hiding in
 * here.
 */
export function FileSelectionSheet({ open, selected, onClose, onFiled }) {
  const [places, setPlaces] = useState(null);   // null = not read yet, which is NOT "no places"
  // Read on OPEN rather than on mount: this sheet is mounted with the grid and used rarely, so a
  // container query on every visit to All Cards would be a cost paid by everyone for the few.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    listContainers().then((all) => { if (alive) setPlaces(all); }).catch(() => { if (alive) setPlaces([]); });
    return () => { alive = false; };
  }, [open]);

  const unfiled = (places || []).find((p) => p.is_system) || null;
  const count = selected?.size || 0;

  return (
    <FileCopiesSheet open={open} source={unfiled} places={places || []} selectedCount={count}
      loading={open && places == null} onClose={onClose}
      onFile={async (destination) => {
        const items = [...(selected?.values() || [])]
          .filter((s) => s?.card?.card_id)
          .map((s) => ({ cardId: s.card.card_id, set: s.set }));
        const r = await bulkFileFromUnfiled({ items, toContainerId: destination.id });
        // Only ever claim what moved. A selection can legitimately contain cards whose every copy is
        // already filed somewhere; that is not a failure, so it is not a danger tone - but it is also
        // not "filed", so the count that reads as success has to be the copies, never the selection.
        if (r.copies > 0) {
          const skipped = Math.max(0, r.selected - r.filed);
          toast(`${r.copies} ${r.copies === 1 ? 'copy' : 'copies'} filed in ${destination.name}`
            + (skipped > 0 ? ` - ${skipped} card${skipped === 1 ? ' had' : 's had'} nothing unfiled` : ''));
        } else {
          toast('Nothing to file - those cards have no unfiled copies.');
        }
        onFiled?.(r);
      }} />
  );
}

/* ---------------- one place, on the list-detail chassis ---------------- */

export function StorageDetail({ place, onBack, onPeek, onChanged }) {
  const [meta, setMeta] = useState(place);
  const [places, setPlaces] = useState([]);
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(false);
  const [q, setQ] = useState('');
  // Q21: search and arrange, the same chassis and the same vocabulary as list detail, so the
  // stacked sort comes for free rather than being reinvented here.
  const [arrange, setArrange] = useState(() => normaliseSort([]));
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [fileRow, setFileRow] = useState(null);
  const [bulkFileOpen, setBulkFileOpen] = useState(false);

  const load = useCallback(async () => {
    const [all, contents] = await Promise.all([listContainers(), containerContents(place.id)]);
    setPlaces(all);
    setMeta(all.find((c) => c.id === place.id) || null);
    setRows(contents);
  }, [place.id]);

  useEffect(() => {
    let alive = true;
    const run = async () => { if (alive) await load(); };
    run();
    const off = subscribeCollection(run);
    return () => { alive = false; off(); };
  }, [load]);

  // Deleted from under us - another surface, or a profile switch. Leave rather than render a header
  // for something that no longer exists.
  useEffect(() => { if (meta === null) onBack(); }, [meta, onBack]);
  useEffect(() => {
    if (!selecting) return undefined;
    return registerBackConsumer(() => { setSelecting(false); setSelected(new Set()); return true; });
  }, [selecting]);

  const toggleSelected = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const shown = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    const matched = needle
      ? rows.filter((r) => String(r.name || r.card_id).toLowerCase().includes(needle)
        || setName(parsePrinting(r.variant_slug).set).toLowerCase().includes(needle))
      : rows;
    const cmp = stackComparator(arrange, { identityOf: (r) => `${r.card_id}|${r.variant_slug}` });
    return [...matched].sort(cmp);
  }, [rows, q, arrange]);

  if (rows == null || !meta) return <Loading />;
  const copies = rows.reduce((n, r) => n + (Number(r.qty) || 0), 0);
  // Bulk select is only worth offering when there is somewhere for a File to go. Unfiled always
  // exists, so any user place already has a target; Unfiled itself needs at least one user place.
  const canBulk = rows.length > 0 && places.length > 1;
  const allSelected = shown.length > 0 && shown.every((r) => selected.has(r.owned_id));
  // The same header pill the All and Sets grids use to enter selection and, once in it, to
  // select-all / deselect-all. `MenuGlyph kind="select"`, gold-on-brown, 44px tall.
  const selectPill = (label, onClick) => (
    <button onClick={onClick} aria-label={label} style={{
      flex: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 14px',
      borderRadius: 16, cursor: 'pointer', whiteSpace: 'nowrap', font: "600 12.5px/1 var(--f-ui)",
      color: 'var(--gold-num)', background: 'rgba(42,33,20,.5)', border: '1px solid rgba(203,167,95,.45)',
    }}>
      <MenuGlyph kind="select" />{label}
    </button>
  );
  const enterSelect = () => { setSelecting(true); setSelected(new Set()); };
  const cancelSelect = () => { setSelecting(false); setSelected(new Set()); };
  const unfileSelected = async () => {
    const unfiled = places.find((p) => p.is_system);
    if (!unfiled || !selected.size) return;
    try {
      const result = await bulkMoveAllocations({ fromContainerId: meta.id, toContainerId: unfiled.id, ownedCardIds: [...selected] });
      cancelSelect();
      // Only claim success for copies that actually moved - a bulk that found nothing must not toast
      // "0 copies returned" as if it did something.
      if (result.copies > 0) toast(`${result.copies} ${result.copies === 1 ? 'copy' : 'copies'} returned to ${UNFILED_NAME}`);
    } catch (err) { toastStorageError(err); }
  };

  return (
    <div style={{ padding: '2px 20px' }}>
      {/* The SAME header chassis list detail uses - sub AppBar with a back label, an eyebrow, the
          title and a trailing overflow. Q21 said same chassis; this is it. */}
      <AppBar variant="sub" sticky announce
        onBack={onBack} backLabel="Back to My Collection"
        // Class over instance: the eyebrow names what KIND of thing this is and the title names
        // which one, so Unfiled reads PINNED / Unfiled rather than the same word twice. AppBar's
        // sub variant upper-cases the eyebrow itself, so this is written like the KIND_LABELs.
        eyebrow={meta.is_system ? 'Pinned' : (KIND_LABEL[meta.kind] || 'Place')}
        eyebrowColor={containerColourVar(meta.colour)}
        title={meta.name}
        // The copies count is a QUIET SUBTITLE, not a headline. AppBar already owns a subtitle slot
        // (`meta`) and All/Sets state their tally in it, so a place states its own the same way
        // rather than keeping the big gold numeral that made the count compete with the name.
        meta={`${copies} ${copies === 1 ? 'copy' : 'copies'}`}
        trailing={selecting ? (
          <>
            <span style={{ flex: 'none', font: "600 13px/1 var(--f-ui)", color: 'var(--gold-num)' }}>{selected.size} selected</span>
            {selectPill(allSelected ? 'Deselect all' : 'Select all',
              () => setSelected(allSelected ? new Set() : new Set(shown.map((r) => r.owned_id))))}
          </>
        ) : (
          <>
            {/* Bulk select enters here and drives the bottom dock bar - the same header-pill + dock
                flow the All and Sets grids use, not a bespoke inline bar. */}
            {canBulk && selectPill('Select', enterSelect)}
            {/* Unfiled is not the user's to rename or delete, so it gets no management menu. */}
            {!meta.is_system && (
              // Q10's manual ordering is NOT in here. "Move earlier / Move later" was condemned by
              // the owner (2026-08-20): a menu is where you manage a thing, not where you arrange a
              // list. Ordering is now long-press and drag on the Storage index itself, so the menu
              // is back to the two actions that really are about this one place.
              <OverflowMenu label="Place actions" items={[
                { label: 'Edit place', icon: <MenuGlyph kind="edit" />, onClick: () => setEdit(true) },
                { label: 'Delete place', icon: <MenuGlyph kind="delete" />, danger: true, onClick: async () => {
                  // Q26 copy, through the app-wide centered destructive dialog (DESIGN_SYSTEM §6), not
                  // a second bottom sheet. The words matter: the model rests on the user believing no
                  // card is lost.
                  const body = copies > 0
                    ? `The ${copies} ${copies === 1 ? 'copy' : 'copies'} inside ${copies === 1 ? 'goes' : 'go'} back to ${UNFILED_NAME}. You keep every card - ${copies === 1 ? 'it stops' : 'they stop'} being filed here.`
                    : 'It is empty, so nothing moves.';
                  if (await confirmAction({ title: `Delete “${meta.name}”?`, body, confirmLabel: 'Delete place', danger: true })) {
                    await deleteContainer(meta.id); onChanged?.(); onBack();
                  }
                } },
              ]} />
            )}
          </>
        )} />

      {meta.description && (
        <div style={{ font: "italic 400 15px/1.45 var(--f-read)", color: 'var(--ink-muted-warm)', margin: '0 2px 14px' }}>
          {meta.description}
        </div>
      )}

      {/* Search shares the bottom dock slot with the select bar, so it steps aside during selection -
          exactly as it does on the All and Sets grids. */}
      {rows.length > 0 && !selecting && (
        <div style={{ marginBottom: 12 }}>
          <SearchPill value={q} onChange={setQ} placeholder={`Search ${meta.name}…`} />
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyCta pad="38px 12px" size={14} text={meta.is_system
          ? 'Nothing here - every copy you own is filed somewhere.'
          : 'Nothing filed here yet.'} />
      ) : shown.length === 0 ? (
        <EmptyCta pad="28px 12px" size={14} text={`Nothing in ${meta.name} matches “${q}”.`} />
      ) : (
        shown.map((r) => {
          const { set, foil } = parsePrinting(r.variant_slug);
          const checked = selected.has(r.owned_id);
          // A row is a collector item, so its thumb wears THIS printing's art - the same face the
          // card sheet shows when the row is tapped, not the card's default illustration. The rest of
          // the row object (name, elements, is_site) is already the card's, so it doubles as the art
          // subject; `printingArt` degrades to the default slug, then to null, on its own.
          const art = { ...r, image_slug: printingArt(r, set, foil) };
          return (
            // THE LISTS CARD ROW, not a third species of card row (owner ruling, 2026-08-20). The
            // geometry is mirrored from ListCardRow rather than extracted: that row lives in
            // Collection.jsx, which imports THIS module, so a shared shell would have to move to a
            // third file - and the two rows share no state at all (one edits a goal and a heart, one
            // states where copies are). What IS shared is imported: the gilt frame, its glow and the
            // set pill all come from CollectionCardViews, so the pieces cannot drift.
            // Always framed and never dimmed: everything in a place is, by definition, owned.
            <div key={r.alloc_id} className="cx-row"
              style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 -20px', padding: '0 20px',
                borderBottom: '1px solid rgba(74,60,34,.3)',
                background: checked ? 'linear-gradient(90deg, rgba(203,167,95,.09), transparent)' : 'none',
                contentVisibility: 'auto', containIntrinsicSize: 'auto 120px' }}>
              <button type="button" aria-pressed={selecting ? checked : undefined}
                onClick={() => selecting ? toggleSelected(r.owned_id) : onPeek?.(r.card_id, set, foil)}
                style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 0', border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                {/* A ROUND check disc, the BinderTile tick exactly - selection controls are circles
                    app-wide (owner ruling, 2026-08-20); this row wore the app's last rounded square. */}
                {selecting && (
                  <span aria-hidden="true" style={{ width: 24, height: 24, flex: 'none', borderRadius: '50%', display: 'grid', placeItems: 'center',
                    border: `1.5px solid ${checked ? 'var(--gold-leaf)' : 'var(--hair-40)'}`,
                    background: checked ? 'var(--gold-leaf)' : 'transparent' }}>
                    {checked && (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#1a1206" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                  </span>
                )}
                {/* The 64px 5:7 gilt-framed thumb. The thumb follows the checkbox rather than
                    replacing it: the All and Sets grids keep their art visible while selecting. */}
                <span style={{ width: 64, flex: 'none', position: 'relative', borderRadius: 9, padding: 1, background: GILT, boxShadow: GLOW }}>
                  <span style={{ display: 'block', borderRadius: 8, overflow: 'hidden' }}>
                    <CardArt card={art} radius={8} aspect="5/7" />
                  </span>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    font: "600 18px/1.2 var(--f-read)", color: 'var(--ink-head)' }}>{r.name || r.card_id}</span>
                  <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 7 }}>
                    <span style={SET_PILL}>{setName(set)}</span>
                    {foil && <span title="Foil printing" style={{ font: "600 10.5px/1 var(--f-mono)", color: '#e3c589' }}>✦ Foil</span>}
                    {/* HERE, then owned. A place answers "where is it", so the number that belongs to
                        this place is the strong one and the owned total is the context around it. */}
                    <span>
                      <span style={{ font: "600 15px/1 var(--f-display)", color: 'var(--gold-num)' }}>{r.qty} here</span>
                      <span style={{ font: "400 12.5px/1 var(--f-read)", color: 'var(--ink-muted-warm)' }}> of {r.qty_owned} owned</span>
                    </span>
                  </span>
                </span>
              </button>
              {/* ONE trailing control. The old "return one to Unfiled" minus is gone as redundant by
                  design, not as a lost feature: Unfiled is a destination in the picker below, with a
                  stepper, so "return one" is this same button and one tap further. */}
              {!selecting && places.some((p) => p.id !== meta.id) && (
                <button onClick={() => setFileRow(r)}
                  aria-label={`File ${r.name || r.card_id} somewhere else`}
                  style={{ flex: 'none', width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--hair-40)',
                    background: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <FiledSeal size={19} />
                </button>
              )}
            </div>
          );
        })
      )}

      {/* Arrange opens from a FAB with the filter glyph, which is how EVERY refine entry in
          Collection opens - the set drill, All cards, and list detail all ship this exact control.
          It was an inline ghost button, invented here and matching nothing. */}
      {rows.length > 0 && !selecting && (
        <Fab variant="deck" label={`Arrange ${meta.name}`} icon={<FabGlyph kind="filters" />}
          onClick={() => setArrangeOpen(true)} active={arrangeOpen} badge={arrange.length} />
      )}

      {/* The shared arrange vocabulary, not a bespoke sort. When "group by location" arrives it is
          one more entry in the registry rather than new code in here. */}
      <BottomSheet open={arrangeOpen} title="ARRANGE" onClose={() => setArrangeOpen(false)}>
        <div style={{ font: "italic 400 12.5px/1.4 var(--f-read)", color: '#8a8175', margin: '10px 0 4px' }}>
          Tap to add - order sets priority.
        </div>
        {LIST_SORT_OPTIONS.map((option) => {
          const i = sortIndex(arrange, option.key);
          return (
            <SortRow key={option.key} label={option.label} index={i} total={arrange.length}
              dir={i >= 0 ? arrange[i].dir : option.defaultDir}
              onToggle={() => setArrange((a) => toggleSort(a, option))}
              onFlip={() => setArrange((a) => flipSort(a, option.key))} />
          );
        })}
      </BottomSheet>

      <PlaceSheet open={edit} existing={meta} onClose={() => setEdit(false)}
        onSubmit={async (fields) => {
          await updateContainer(meta.id, fields);
          setEdit(false); await load(); onChanged?.();
        }} />
      <FileCopiesSheet open={!!fileRow} source={meta} places={places} row={fileRow}
        onClose={() => setFileRow(null)}
        onFile={async (destination, qty) => {
          await moveItemAllocation({
            cardId: fileRow.card_id, variantSlug: fileRow.variant_slug,
            fromContainerId: meta.id, toContainerId: destination.id, qty,
          });
          toast(`${qty} ${qty === 1 ? 'copy' : 'copies'} filed in ${destination.name}`);
        }} />
      {selecting && (
        <StorageSelectBar count={selected.size} canUnfile={!meta.is_system}
          onCancel={cancelSelect} onFile={() => setBulkFileOpen(true)} onUnfile={unfileSelected} />
      )}

      <FileCopiesSheet open={bulkFileOpen} source={meta} places={places} selectedCount={selected.size}
        onClose={() => setBulkFileOpen(false)}
        onFile={async (destination) => {
          const result = await bulkMoveAllocations({ fromContainerId: meta.id, toContainerId: destination.id, ownedCardIds: [...selected] });
          setSelecting(false); setSelected(new Set());
          if (result.copies > 0) toast(`${result.copies} ${result.copies === 1 ? 'copy' : 'copies'} filed in ${destination.name}`);
        }} />
    </div>
  );
}
