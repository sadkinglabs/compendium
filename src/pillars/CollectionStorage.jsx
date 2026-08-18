// STORAGE - where the cards physically are (docs/proposals/collection-storage.md, increment 3).
//
// Its own file rather than more of Collection.jsx, which is already past 2,400 lines. Two surfaces:
// the index of places, and one place's contents.
//
// WHAT THIS SURFACE IS FOR, stated once because it governs every decision below. My Collection
// answers "what do I own". Storage answers "where is it". Those are different questions, so this
// screen never shows an owned total as its headline number - it shows what is in each place, and
// the two only coincide for a user who has never filed anything.
//
// Reuse per the proposal's inventory: ListRow / SectionLabel / Fab / OverflowMenu / BottomSheet /
// BTN_* from the shared UI, SwatchPicker as a new general primitive, and the container vocabulary
// from storageVocabulary. Nothing here writes SQL - storageDirectory owns that.
import { useEffect, useState, useCallback } from 'react';
import {
  BottomSheet, SectionLabel, Loading, BlankState, SegTabs, ListRow,
  BTN_GOLD, BTN_GHOST, BTN_DANGER,
} from '../components/ui.jsx';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import OverflowMenu, { MenuGlyph } from '../components/OverflowMenu.jsx';
import SwatchPicker from '../components/SwatchPicker.jsx';
import {
  listContainers, containerContents, createContainer, updateContainer, deleteContainer,
  MAX_CONTAINER_NAME,
} from '../store/storageDirectory.js';
import { subscribeCollection } from '../store/ownedRepository.js';
import {
  CONTAINER_KINDS, CONTAINER_COLOURS, containerColourVar, UNFILED_NAME,
} from '../store/storageVocabulary.js';
import { parsePrinting } from '../store/printings.js';

const SHEET_INPUT = {
  width: '100%', padding: '12px 14px', borderRadius: 10, background: 'rgba(10,9,7,.6)',
  border: '1px solid var(--hair-22)', color: 'var(--ink-body)', font: "500 15px/1 var(--f-read)",
};
const KIND_LABEL = { binder: 'Binder', box: 'Box', deck: 'Deck box', other: 'Other' };
const COLOUR_OPTIONS = CONTAINER_COLOURS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1), css: containerColourVar(c) }));

/* ---------------- create / edit ---------------- */

// One sheet for both, because "name it, say what it is, pick a colour" is the same three questions
// whether the place is new or being corrected. `existing` switches the copy and locks the kind - a
// binder that becomes a box is a different physical object, and renaming is not that.
function PlaceSheet({ open, existing, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('binder');
  const [colour, setColour] = useState('gold');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(existing?.name || '');
    setKind(existing?.kind || 'binder');
    setColour(existing?.colour || 'gold');
    setBusy(false); setErr('');
  }, [open, existing]);

  // Awaited and locked, so a double-tap cannot create two places. The repository refuses a
  // duplicate name, and that refusal is shown HERE rather than as a toast the sheet outlives.
  const go = async () => {
    const nm = name.trim();
    if (!nm || busy) return;
    setBusy(true); setErr('');
    try { await onSubmit({ name: nm, kind, colour }); } catch (e) { setErr(e?.message || 'That did not work.'); setBusy(false); }
  };

  return (
    <BottomSheet open={open} title={existing ? 'EDIT PLACE' : 'NEW PLACE'} onClose={onClose}>
      <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 14 }}>
        {existing ? 'Renaming a place never moves what is inside it.'
          : 'A binder, a box, a deck box - somewhere you actually keep cards.'}
      </div>
      <input value={name} autoFocus maxLength={MAX_CONTAINER_NAME}
        onChange={(e) => { setName(e.target.value); setErr(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        placeholder="e.g. Trade binder" style={SHEET_INPUT} />

      {!existing && (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}>
          <SegTabs ariaLabel="What kind of place" value={kind} onChange={setKind}
            options={CONTAINER_KINDS.map((k) => ({ key: k, label: KIND_LABEL[k] }))} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '14px 0 4px' }}>
        <span style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.14em', color: 'var(--ink-muted)' }}>COLOUR</span>
        <SwatchPicker label="Place colour" options={COLOUR_OPTIONS} value={colour} onChange={setColour} />
      </div>

      {err && (
        <div role="alert" style={{ font: "500 12.5px/1.45 var(--f-read)", color: 'var(--ink-danger, #e2777a)', marginTop: 10 }}>
          {err}
        </div>
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

// Deleting a place is not deleting cards, and the confirmation has to say so in those words - the
// whole model rests on the user believing it, and a generic "are you sure" earns no such belief.
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
          ? <>The {copies} {copies === 1 ? 'copy' : 'copies'} inside {copies === 1 ? 'moves' : 'move'} to {UNFILED_NAME}. You keep every card - they just stop being filed here.</>
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

/* ---------------- the index of places ---------------- */

export function StorageIndex({ onOpenPlace, rev }) {
  const [places, setPlaces] = useState(null);
  const [create, setCreate] = useState(false);

  const load = useCallback(async () => setPlaces(await listContainers()), []);
  useEffect(() => {
    let alive = true;
    const run = async () => { const rows = await listContainers(); if (alive) setPlaces(rows); };
    run();
    const off = subscribeCollection(run);
    return () => { alive = false; off(); };
  }, [rev]);

  if (places == null) return <Loading />;

  const unfiled = places.find((p) => p.is_system);
  const mine = places.filter((p) => !p.is_system);
  const filed = mine.reduce((n, p) => n + (Number(p.copies) || 0), 0);

  const row = (p) => (
    <ListRow
      key={p.id}
      icon={<PlaceGlyph colour={p.colour} />}
      title={p.name}
      sub={p.is_system
        ? 'Cards you own that are not filed anywhere'
        : `${KIND_LABEL[p.kind] || 'Place'}${p.cards ? ` · ${p.cards} ${p.cards === 1 ? 'card' : 'cards'}` : ''}`}
      trailing={<span style={{ font: "600 15px/1 var(--f-mono)", color: 'var(--gold-leaf)' }}>{p.copies}</span>}
      onClick={() => onOpenPlace(p)} />
  );

  return (
    <div style={{ padding: '2px 20px' }}>
      {mine.length === 0 ? (
        // Q30's zero state. It leads with what the feature is FOR rather than with the absence of
        // data, because "no places yet" explains nothing to someone who has not met the idea.
        <BlankState
          title="Nothing is filed yet"
          body={`Every copy you own is in ${UNFILED_NAME}. Make a place - a binder, a box - and Storage will remember which cards live where.`}
          action={<button onClick={() => setCreate(true)} style={{ ...BTN_GOLD }}>Make a place</button>} />
      ) : (
        <>
          <SectionLabel label="PLACES" count={mine.length} />
          {mine.map(row)}
        </>
      )}

      {unfiled && (
        <>
          <SectionLabel label="LOOSE" />
          {row(unfiled)}
          <div style={{ font: "400 12px/1.5 var(--f-read)", color: 'var(--ink-faint)', margin: '8px 2px 0' }}>
            {filed > 0
              ? `${filed} filed · ${unfiled.copies} loose`
              : `Everything you own is loose. That is a perfectly good way to keep cards.`}
          </div>
        </>
      )}

      <Fab variant="lib" label="Make a place" icon={<FabGlyph kind="add" />} onClick={() => setCreate(true)} />
      <PlaceSheet open={create} onClose={() => setCreate(false)}
        onSubmit={async (fields) => { await createContainer(fields); setCreate(false); await load(); }} />
    </div>
  );
}

function PlaceGlyph({ colour }) {
  return (
    <span aria-hidden="true" style={{
      width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center',
      background: 'rgba(10,9,7,.55)', border: `1px solid ${containerColourVar(colour)}`,
    }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: containerColourVar(colour), opacity: .85 }} />
    </span>
  );
}

/* ---------------- one place's contents ---------------- */

export function StorageDetail({ place, onBack, onPeek, onChanged }) {
  const [meta, setMeta] = useState(place);
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  // The place was deleted from under us - another surface, or a profile switch. Leaving rather than
  // rendering a header for something that no longer exists.
  useEffect(() => { if (meta === null) onBack(); }, [meta, onBack]);
  if (rows == null || !meta) return <Loading />;

  const copies = rows.reduce((n, r) => n + (Number(r.qty) || 0), 0);

  return (
    <div style={{ padding: '2px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0 14px' }}>
        <button onClick={onBack} aria-label="Back to places" style={{
          background: 'none', border: 'none', color: 'var(--ink-muted)', cursor: 'pointer',
          font: "600 13px/1 var(--f-ui)", padding: '8px 4px',
        }}>‹ Places</button>
        <div style={{ flex: 1 }} />
        {!meta.is_system && (
          <OverflowMenu label={`Actions for ${meta.name}`} items={[
            { label: 'Rename or recolour', icon: <MenuGlyph kind="edit" />, onClick: () => setEdit(true) },
            { label: 'Delete place', icon: <MenuGlyph kind="trash" />, tone: 'danger', onClick: () => setConfirmDelete(true) },
          ]} />
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <PlaceGlyph colour={meta.colour} />
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "600 19px/1.2 var(--f-display)", color: 'var(--ink-body)' }}>{meta.name}</div>
          <div style={{ font: "400 12.5px/1.4 var(--f-read)", color: 'var(--ink-muted)' }}>
            {meta.is_system ? 'Not filed anywhere' : KIND_LABEL[meta.kind] || 'Place'}
            {' · '}{rows.length} {rows.length === 1 ? 'card' : 'cards'} · {copies} {copies === 1 ? 'copy' : 'copies'}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: '38px 12px', textAlign: 'center', font: "400 14px/1.6 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>
          {meta.is_system
            ? 'Nothing loose - every copy you own is filed somewhere.'
            : 'Nothing filed here yet.'}
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {rows.map((r) => {
            const { set, foil } = parsePrinting(r.variant_slug);
            return (
              <ListRow
                key={r.alloc_id}
                title={r.name || r.card_id}
                sub={`${set ? set : 'No set'}${foil ? ' · Foil' : ''}`}
                // "3 of your 5" - the number here is what is IN THIS PLACE, and the owned total is
                // context. Showing only one of them is what makes a container view confusing.
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
          })}
        </div>
      )}

      <PlaceSheet open={edit} existing={meta} onClose={() => setEdit(false)}
        onSubmit={async (fields) => {
          await updateContainer(meta.id, { name: fields.name, colour: fields.colour });
          setEdit(false); await load(); onChanged?.();
        }} />
      <DeletePlaceSheet open={confirmDelete} place={{ ...meta, copies }} onClose={() => setConfirmDelete(false)}
        onConfirm={async () => { await deleteContainer(meta.id); setConfirmDelete(false); onChanged?.(); onBack(); }} />
    </div>
  );
}
