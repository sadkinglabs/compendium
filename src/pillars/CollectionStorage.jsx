// STORAGE - where the cards physically are (docs/proposals/collection-storage.md, increment 3).
//
// PLACEMENT, because I got it wrong twice. Storage is a SECTION INSIDE My Collection, rendered below
// the sets grid - the owner's ruling, agreed explicitly in preference to a fourth chip: "top section
// would be sets, and below you'd have Storage", and "it keeps the chip row at three". Sets are the
// containers the game gave you; places are the ones you made. Same cards, two organisations, one
// screen. There is no Storage tab and no Storage index surface.
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
import {
  BottomSheet, SectionLabel, Loading, SegTabs, ListRow, SortRow,
  BTN_GOLD, BTN_GHOST, BTN_DANGER,
} from '../components/ui.jsx';
import AppBar from '../components/AppBar.jsx';
import SearchPill from '../components/SearchPill.jsx';
import OverflowMenu, { MenuGlyph } from '../components/OverflowMenu.jsx';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import SwatchPicker from '../components/SwatchPicker.jsx';
import {
  listContainers, containerContents, createContainer, updateContainer, deleteContainer,
  moveContainer, duplicateName, MAX_CONTAINER_NAME, MAX_CONTAINER_DESC,
} from '../store/storageDirectory.js';
import { subscribeCollection } from '../store/ownedRepository.js';
import {
  CONTAINER_KINDS, CONTAINER_COLOURS, containerColourVar, UNFILED_NAME,
} from '../store/storageVocabulary.js';
import { parsePrinting } from '../store/printings.js';
import { SET_LABEL } from '../store/sets.js';
import { stackComparator, normaliseSort } from '../store/collectionFilter.js';
import { LIST_SORT_OPTIONS } from '../store/sortOptions.js';
import { toggleSort, flipSort, sortIndex } from '../components/sortStack.js';

const SHEET_INPUT = {
  width: '100%', padding: '12px 14px', borderRadius: 10, background: 'rgba(10,9,7,.6)',
  border: '1px solid var(--hair-22)', color: 'var(--ink-body)', font: "500 15px/1 var(--f-read)",
};
// Q7's fixed list, labelled as Q7 names them. "Deck", not "Deck box".
const KIND_LABEL = { binder: 'Binder', box: 'Box', deck: 'Deck', other: 'Other' };
const COLOUR_OPTIONS = CONTAINER_COLOURS.map((c) => ({
  value: c, label: c[0].toUpperCase() + c.slice(1), css: containerColourVar(c),
}));
/** The set NAME, never the slug. '001' is a storage key; "Alpha" is what a person calls it. */
const setName = (code) => (code ? (SET_LABEL[code] || code) : 'No set recorded');

function PlaceGlyph({ colour, size = 30 }) {
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: 8, display: 'grid', placeItems: 'center',
      background: 'rgba(10,9,7,.55)', border: `1px solid ${containerColourVar(colour)}`,
    }}>
      <span style={{ width: size * .4, height: size * .4, borderRadius: 3, background: containerColourVar(colour), opacity: .85 }} />
    </span>
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

// Q26: deleting a place returns copies to Unfiled with a confirmation stating the count. The words
// matter more than the pattern here - the whole model rests on the user believing no card is lost.
function DeletePlaceSheet({ open, place, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setBusy(false); }, [open]);
  const copies = Number(place?.copies) || 0;
  return (
    <BottomSheet open={open} title="DELETE PLACE" onClose={onClose}>
      <div style={{ font: "400 14px/1.6 var(--f-read)", color: 'var(--ink-body)', marginBottom: 8 }}>
        Delete “{place?.name}”?
      </div>
      <div style={{ font: "400 13px/1.6 var(--f-read)", color: 'var(--ink-muted)', marginBottom: 16 }}>
        {copies > 0
          ? <>The {copies} {copies === 1 ? 'copy' : 'copies'} inside {copies === 1 ? 'goes' : 'go'} back to {UNFILED_NAME}. You keep every card - {copies === 1 ? 'it stops' : 'they stop'} being filed here.</>
          : <>It is empty, so nothing moves.</>}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} disabled={busy} style={{ ...BTN_GHOST, flex: 1 }}>Keep it</button>
        <button disabled={busy} style={{ ...BTN_DANGER, flex: 1, justifyContent: 'center' }}
          onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
          {busy ? 'Deleting…' : 'Delete place'}
        </button>
      </div>
    </BottomSheet>
  );
}

/* ---------------- the section, below the sets grid ---------------- */

export function StorageSection({ onOpenPlace, rev }) {
  const [places, setPlaces] = useState(null);
  const [create, setCreate] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => { const rows = await listContainers(); if (alive) setPlaces(rows); };
    run();
    const off = subscribeCollection(run);
    return () => { alive = false; off(); };
  }, [rev]);

  if (places == null) return null;   // the sets grid above is already rendered; do not flash a spinner

  // Q15: Unfiled is pinned FIRST and visually distinct. `listContainers` already orders it first;
  // this only separates it for rendering.
  const unfiled = places.find((p) => p.is_system);
  const mine = places.filter((p) => !p.is_system);

  const row = (p, i) => (
    <ListRow
      key={p.id}
      icon={<PlaceGlyph colour={p.colour} />}
      title={p.name}
      sub={p.is_system
        ? 'Cards you own that you have not filed yet'
        : [KIND_LABEL[p.kind] || 'Place', p.description || null, p.cards ? `${p.cards} ${p.cards === 1 ? 'card' : 'cards'}` : null].filter(Boolean).join(' · ')}
      trailing={
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ font: "600 15px/1 var(--f-mono)", color: 'var(--gold-leaf)' }}>{p.copies}</span>
          {/* Q10: ordering is the user's, so it has to be changeable. Buttons rather than drag: they
              are reachable by keyboard and by anyone who cannot hold a long press steady. */}
          {!p.is_system && mine.length > 1 && (
            <OverflowMenu label={`Move ${p.name}`} items={[
              i > 0 ? { label: 'Move up', icon: <MenuGlyph kind="up" />, onClick: () => moveContainer(p.id, 'up') } : null,
              i < mine.length - 1 ? { label: 'Move down', icon: <MenuGlyph kind="down" />, onClick: () => moveContainer(p.id, 'down') } : null,
            ]} />
          )}
        </span>
      }
      onClick={() => onOpenPlace(p)} />
  );

  return (
    // KNOWN DEFECT, build 282, NOT yet fixed by this padding. Driving the release APK shows the
    // last rows of this section sitting UNDER the fixed bottom nav: Unfiled reports bounds at
    // y=2850 on a 2992-tall screen with the nav starting near 2806, and the page will not scroll
    // any further - so a tap at the row's own centre lands on the nav's Home button instead.
    //
    // The padding below is the deck pager's clearance idiom and it did NOT move the row, which
    // rules out the obvious cause: #cx-pillar-scroll already carries nav-h + 92px of its own
    // padding (App.jsx S.body), so the clearance exists and something else is capping the scroll.
    // Left in place because it is correct in principle, and labelled because it is not sufficient.
    // Opening a place therefore remains UNVERIFIED on device.
    <div style={{ marginTop: 26, paddingBottom: 'calc(var(--nav-h) + env(safe-area-inset-bottom) + 28px)' }}>
      <SectionLabel label="STORAGE" count={mine.length || undefined} />
      {/* Q13/Q15: always visible, always first, so it is a stable destination rather than something
          that appears and vanishes. */}
      {unfiled && row(unfiled, -1)}
      {mine.length > 0 ? mine.map(row) : (
        // Q30: empty with a prompt, not with starter containers nobody asked for.
        <div style={{ padding: '18px 14px', textAlign: 'center' }}>
          <div style={{ font: "400 13.5px/1.6 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', marginBottom: 12 }}>
            Nothing is filed yet. Make a place - a binder, a box - and Compendium will remember which
            cards live where.
          </div>
          <button onClick={() => setCreate(true)} style={{ ...BTN_GOLD }}>Make a place</button>
        </div>
      )}
      {mine.length > 0 && (
        <button onClick={() => setCreate(true)} style={{
          ...BTN_GHOST, width: '100%', marginTop: 12, font: "600 13px/1 var(--f-ui)",
        }}>+ Make a place</button>
      )}
      <PlaceSheet open={create} onClose={() => setCreate(false)}
        onSubmit={async (fields) => { await createContainer(fields); setCreate(false); }} />
    </div>
  );
}

/* ---------------- one place, on the list-detail chassis ---------------- */

export function StorageDetail({ place, onBack, onPeek, onChanged }) {
  const [meta, setMeta] = useState(place);
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [q, setQ] = useState('');
  // Q21: search and arrange, the same chassis and the same vocabulary as list detail, so the
  // stacked sort comes for free rather than being reinvented here.
  const [arrange, setArrange] = useState(() => normaliseSort([]));
  const [arrangeOpen, setArrangeOpen] = useState(false);

  const load = useCallback(async () => {
    const [all, contents] = await Promise.all([listContainers(), containerContents(place.id)]);
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

  return (
    <div style={{ padding: '2px 20px' }}>
      {/* The SAME header chassis list detail uses - sub AppBar with a back label, an eyebrow, the
          title and a trailing overflow. Q21 said same chassis; this is it. */}
      <AppBar variant="sub" sticky announce
        onBack={onBack} backLabel="Back to My Collection"
        eyebrow={meta.is_system ? UNFILED_NAME.toUpperCase() : (KIND_LABEL[meta.kind] || 'Place')}
        eyebrowColor={containerColourVar(meta.colour)}
        title={meta.name}
        trailing={<>
          <div style={{ flex: 'none', textAlign: 'right', lineHeight: 1 }}>
            <span style={{ font: "600 26px/1 var(--f-display)", color: 'var(--gold-num)' }}>{copies}</span>
            <span style={{ font: "400 13px/1 var(--f-read)", color: 'var(--ink-muted-warm)' }}>
              {copies === 1 ? ' copy' : ' copies'}
            </span>
          </div>
          {/* Unfiled is not the user's to rename or delete, so it gets no management menu. */}
          {!meta.is_system && (
            <OverflowMenu label="Place actions" items={[
              { label: 'Edit place', icon: <MenuGlyph kind="edit" />, onClick: () => setEdit(true) },
              { label: 'Delete place', icon: <MenuGlyph kind="delete" />, danger: true, onClick: () => setConfirmDelete(true) },
            ]} />
          )}
        </>} />

      {meta.description && (
        <div style={{ font: "italic 400 15px/1.45 var(--f-read)", color: 'var(--ink-muted-warm)', margin: '0 2px 14px' }}>
          {meta.description}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <SearchPill value={q} onChange={setQ} placeholder={`Search ${meta.name}…`} />
          <button onClick={() => setArrangeOpen(true)} style={{ ...BTN_GHOST, flex: 'none', padding: '10px 14px' }}>
            Arrange
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ padding: '38px 12px', textAlign: 'center', font: "400 14px/1.6 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>
          {meta.is_system
            ? 'Nothing here - every copy you own is filed somewhere.'
            : 'Nothing filed here yet.'}
        </div>
      ) : shown.length === 0 ? (
        <div style={{ padding: '28px 12px', textAlign: 'center', font: "400 14px/1.6 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>
          Nothing in {meta.name} matches “{q}”.
        </div>
      ) : (
        shown.map((r) => {
          const { set, foil } = parsePrinting(r.variant_slug);
          return (
            <ListRow
              key={r.alloc_id}
              title={r.name || r.card_id}
              // The set NAME. '001' is a storage key, not something to show a person.
              sub={`${setName(set)}${foil ? ' · Foil' : ''}`}
              // What is in THIS place, with the owned total as context - "3 of your 5". A container
              // view that shows only one of the two numbers is what makes it confusing.
              trailing={
                <span style={{ font: "600 14px/1 var(--f-mono)", color: 'var(--gold-leaf)' }}>
                  {r.qty}
                  {r.qty_owned > r.qty && (
                    <span style={{ font: "500 11px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>{` /${r.qty_owned}`}</span>
                  )}
                </span>
              }
              onClick={() => onPeek?.(r.card_id, set, foil)} />
          );
        })
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
      <DeletePlaceSheet open={confirmDelete} place={{ ...meta, copies }} onClose={() => setConfirmDelete(false)}
        onConfirm={async () => { await deleteContainer(meta.id); setConfirmDelete(false); onChanged?.(); onBack(); }} />
    </div>
  );
}
