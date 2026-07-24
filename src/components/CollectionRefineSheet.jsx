// The COLLECTION Refine sheet - a two-page (Filters | Sort) surface tuned to how you browse a
// collection, not how you build a deck. It shares the GothicSheet chassis and the shared refine
// primitives (Chip, PipChip, CmpRow) with the deckbuilder's RefineSheet, but its axes differ: the
// deck's threshold/mana/power comparators are gone, and it adds the ownership-derived axes only a
// collection has - Ownership, Finish scope, Playset, and an Owned-amount comparator - plus a Sort
// page. Pure presentation: every axis is driven by props from the Collection drill.
import React, { useState, useEffect } from 'react';
import GothicSheet from './GothicSheet.jsx';
import { SectionLabel, Chip, ChipRow, BTN_GHOST, SegTabs } from './ui.jsx';
import { EYEBROW } from './CollectionCardSheet.jsx';
import { PipChip, CmpRow, RARITY_DOT } from './RefineSheet.jsx';
import { OWN_STATES, FINISHES, PLAYSET_KEYS, SORT_KEYS } from '../store/collectionFilter.js';

const EL = [['air', 'Air'], ['earth', 'Earth'], ['fire', 'Fire'], ['water', 'Water']];
const EL_LABEL = { air: 'Air', earth: 'Earth', fire: 'Fire', water: 'Water' };
// Collection type vocabulary - INCLUDES Avatars (the deck sheet omits them). Keys are the catalog's
// stored `type` strings; getPool matches them exactly.
const TYPES = [['Aura', 'Auras'], ['Artifact', 'Artifacts'], ['Minion', 'Minions'], ['Magic', 'Magics'], ['Site', 'Sites'], ['Avatar', 'Avatars']];
const RAR = [['Ordinary', 'Ordinary'], ['Exceptional', 'Exceptional'], ['Elite', 'Elite'], ['Unique', 'Unique']];
const GILT = 'linear-gradient(180deg, #d8b872, #b8954f)';
const cnt = (n) => n || undefined;

export default function CollectionRefineSheet({
  open, onClose, onClear, scope = 'set', activeCount = 0, ctaLabel = 'Show results',
  els, setEls, multi, setMulti, types, setTypes, rarities, setRarities, artist, setArtist, artistOpts = [],
  states, setStates, finishes, setFinishes, playset, setPlayset, ownedCmp, setOwnedCmp,
  sort, setSort, groupBy = 'none', setGroupBy, groupOpts = [],
}) {
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const [tab, setTab] = useState('filters');
  useEffect(() => { if (open) setTab('filters'); }, [open]);   // reopen on Filters
  const grouped = !!setGroupBy && groupBy && groupBy !== 'none';
  const sortActive = (sort && sort !== 'name-asc') || grouped;

  // Summary hero: the active refinement written as a manuscript line.
  const labels = [];
  states.forEach((s) => labels.push(OWN_STATES.find(([k]) => k === s)?.[1] || s));
  finishes.forEach((f) => labels.push(FINISHES.find(([k]) => k === f)?.[1] || f));
  playset.forEach((p) => labels.push(PLAYSET_KEYS.find(([k]) => k === p)?.[1] || p));
  els.forEach((k) => labels.push(EL_LABEL[k]));
  if (multi) labels.push('Multi');
  types.forEach((t) => labels.push(TYPES.find(([k]) => k === t)?.[1] || t));
  rarities.forEach((r) => labels.push(r));
  if (ownedCmp?.val != null) labels.push('Qty');
  if (artist) labels.push(artist);
  const shown = labels.length > 4 ? [...labels.slice(0, 3), `+${labels.length - 3} more`] : labels;

  const group = (label, count, children) => (
    <div style={{ marginBottom: 22 }}>
      <SectionLabel label={label} count={cnt(count)} />
      <ChipRow>{children}</ChipRow>
    </div>
  );

  return (
    <GothicSheet open={open} onClose={onClose} label="Refine">
      <div style={{ ...EYEBROW, marginTop: 2 }}>REFINE</div>
      <div style={{ textAlign: 'center', marginTop: 10, minHeight: 18, padding: '0 8px' }}>
        {labels.length === 0
          ? <span style={{ font: "italic 400 13.5px/1.4 var(--f-read)", color: 'var(--ink-faint)' }}>{scope === 'all' ? 'Every collector item' : 'All cards in this set'}</span>
          : <span style={{ font: "400 13.5px/1.4 var(--f-read)", color: 'var(--ink-status)' }}><span style={{ font: "600 15px/1 var(--f-display)", color: '#c9b487' }}>{activeCount}</span> <span style={{ fontStyle: 'italic' }}>active &middot; {shown.join(' · ')}</span></span>}
      </div>
      <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, #4a3c22 30%, #4a3c22 70%, transparent)', margin: '18px 0 20px' }} />

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
        <SegTabs ariaLabel="Filters or sort" value={tab} onChange={setTab}
          options={[
            { key: 'filters', label: 'Filters', icon: labels.length ? <span style={DOT} /> : null },
            { key: 'sort', label: 'Sort', icon: sortActive ? <span style={DOT} /> : null },
          ]} />
      </div>

      {tab === 'filters' ? (<>
        {group('OWNERSHIP', states.length, OWN_STATES.map(([k, l]) => <Chip key={k} label={l} active={states.includes(k)} onClick={() => toggle(states, setStates, k)} />))}
        {group('FINISH', finishes.length, FINISHES.map(([k, l]) => <Chip key={k} label={l} active={finishes.includes(k)} onClick={() => toggle(finishes, setFinishes, k)} />))}
        {group('PLAYSET', playset.length, PLAYSET_KEYS.map(([k, l]) => <Chip key={k} label={l} active={playset.includes(k)} onClick={() => toggle(playset, setPlayset, k)} />))}

        <div style={{ marginBottom: 22 }}>
          <SectionLabel label="ELEMENT" count={cnt(els.length + (multi ? 1 : 0))} />
          <ChipRow>
            {EL.map(([k, l]) => <PipChip key={k} el={k} label={l} active={els.includes(k)} onClick={() => toggle(els, setEls, k)} />)}
            <Chip label="Multi" active={multi} onClick={() => setMulti(!multi)} />
          </ChipRow>
        </div>

        {group('TYPE', types.length, TYPES.map(([k, l]) => <Chip key={k} label={l} active={types.includes(k)} onClick={() => toggle(types, setTypes, k)} />))}
        {group('RARITY', rarities.length, RAR.map(([k, l]) => <Chip key={k} label={l} active={rarities.includes(k)} dot={RARITY_DOT[k]} onClick={() => toggle(rarities, setRarities, k)} />))}

        <div style={{ marginBottom: 22 }}>
          <SectionLabel label="OWNED AMOUNT" count={cnt(ownedCmp?.val != null ? 1 : 0)} />
          <CmpRow label="Copies owned" state={ownedCmp} set={setOwnedCmp} max={99} />
        </div>

        {artistOpts.length > 0 && (
          <div style={{ marginBottom: 22, contentVisibility: 'auto', containIntrinsicSize: 'auto 100px' }}>
            <SectionLabel label="ARTIST" count={cnt(artist ? 1 : 0)} />
            <select value={artist} onChange={(e) => setArtist(e.target.value)}
              style={{ width: '100%', height: 44, borderRadius: 12, border: '1px solid #4a3c22', background: 'rgba(42,33,20,.5)', color: '#d8c9a4', font: "400 15px/1 var(--f-read)", padding: '0 14px', WebkitAppearance: 'none', appearance: 'none' }}>
              <option value="">Any artist</option>
              {artistOpts.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}
      </>) : (
        <>
          {setGroupBy && groupOpts.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <SectionLabel label="GROUP BY" count={cnt(grouped ? 1 : 0)} />
              <div style={{ font: "italic 400 12.5px/1.4 var(--f-read)", color: '#8a8175', margin: '-4px 0 8px' }}>Sections the grid; Sort orders within each section.</div>
              <ChipRow>{groupOpts.map(([k, l]) => <Chip key={k} label={l} active={(groupBy || 'none') === k} onClick={() => setGroupBy(k)} />)}</ChipRow>
            </div>
          )}
          <div style={{ marginBottom: 22 }}>
            <SectionLabel label="SORT" />
            <div style={{ font: "italic 400 12.5px/1.4 var(--f-read)", color: '#8a8175', margin: '-4px 0 8px' }}>Applies within each group.</div>
            <ChipRow>{SORT_KEYS.map(([k, l]) => <Chip key={k} label={l} active={(sort || 'name-asc') === k} onClick={() => setSort(k)} />)}</ChipRow>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button onClick={onClear} style={{ ...BTN_GHOST, flex: 1, opacity: activeCount ? 1 : 0.4 }}>Clear</button>
        <button onClick={onClose} style={{ flex: 2, padding: '15px 0', borderRadius: 16, background: GILT, border: '1px solid #e3c589', color: '#1a1206', font: "600 13.5px/1 var(--f-display)", boxShadow: '0 6px 20px rgba(203,167,95,.22)', cursor: 'pointer' }}>{ctaLabel}</button>
      </div>
    </GothicSheet>
  );
}

const DOT = { width: 6, height: 6, borderRadius: '50%', background: '#e3c589', flex: 'none' };
