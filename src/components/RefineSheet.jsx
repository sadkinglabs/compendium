// The app-wide Refine sheet - one elevated filtering surface (deckbuilder +
// Codex > Cards) on the GothicSheet trophy chassis. "A Codex page you edit":
// an eyebrow, a summary hero that writes the current refinement as a manuscript
// line, a fade divider, then rubric-divided groups whose control shape tells you
// the kind of choice (gilt Chip = any-of, gothic pill = one-of, pip chip =
// element, comparator ledger row = number, priority seal = sort). Pure
// presentation - every filter/behaviour is driven by props from the parent, and
// the sheet renders only the groups whose setters are supplied.
import React, { useState, useEffect } from 'react';
import GothicSheet from './GothicSheet.jsx';
import { SectionLabel, Chip, ChipRow, BTN_GHOST, SegTabs } from './ui.jsx';
import { StepBtn, EYEBROW } from './CollectionCardSheet.jsx';
import { elementIconUrl } from '../store/cardArt.js';

const EL = [['air', 'Air'], ['earth', 'Earth'], ['fire', 'Fire'], ['water', 'Water']];
const EL_LABEL = { air: 'Air', earth: 'Earth', fire: 'Fire', water: 'Water' };
const TYPES = [['Minion', 'Minions'], ['Aura', 'Auras'], ['Magic', 'Magic'], ['Artifact', 'Artifacts'], ['Site', 'Sites']];
const RAR = [['Ordinary', 'Ordinary'], ['Exceptional', 'Exceptional'], ['Elite', 'Elite'], ['Unique', 'Unique']];
const RARITY_DOT = { Ordinary: 'var(--ordinary)', Exceptional: 'var(--exceptional)', Elite: 'var(--elite)', Unique: 'var(--unique)' };
const SORT_KEYS = [['name', 'Name'], ['cost', 'Mana Cost'], ['element', 'Element'], ['th', 'Threshold Amount']];
const OP_SYM = { '>=': '≥', '<=': '≤', '=': '=' };   // math symbols, not decorative glyphs
const OP_NEXT = { '>=': '<=', '<=': '=', '=': '>=' };
const GILT = 'linear-gradient(180deg, #d8b872, #b8954f)';
const cnt = (n) => n || undefined;
const HAIR_ROW = { borderBottom: '1px solid rgba(74,60,34,.3)' };
const DOT = { width: 6, height: 6, borderRadius: '50%', background: '#e3c589', flex: 'none' };   // "this tab has active choices" mark

// Element chip carrying the real PNG threshold icon (togglable). Chip geometry.
function PipChip({ el, label, active, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={active} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px 6px 10px', borderRadius: 18, cursor: 'pointer',
      font: "600 13px/1 var(--f-ui)", whiteSpace: 'nowrap',
      background: active ? GILT : 'rgba(42,33,20,.5)', color: active ? '#1a1206' : '#c9bda6', border: `1px solid ${active ? '#e3c589' : '#4a3c22'}`,
    }}>
      <img src={elementIconUrl(el)} width={16} height={16} alt="" style={{ display: 'block', filter: active ? 'drop-shadow(0 0 1px rgba(0,0,0,.55))' : 'none' }} />{label}
    </button>
  );
}

// Comparator ledger row - the trophy sheet's CountCol grammar applied to a
// numeric filter: element/label on the left, operator pill + frosted StepBtns +
// gilt value on the right. Any = unset.
function CmpRow({ label, icon, state, set, max, valueTint }) {
  const stepVal = (d) => {
    let v = state.val == null ? (d > 0 ? 0 : null) : state.val + d;
    if (v != null) v = v < 0 ? null : Math.min(max, v);
    set({ ...state, val: v });
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', ...HAIR_ROW }}>
      <span style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 8, font: "600 12.5px/1 var(--f-display)", letterSpacing: '.16em', textTransform: 'uppercase', color: '#a99a80', overflow: 'hidden' }}>
        {icon && <img src={elementIconUrl(icon)} width={18} height={18} alt="" style={{ display: 'block', flex: 'none' }} />}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flex: 'none' }}>
        <button onClick={() => set({ ...state, op: OP_NEXT[state.op] })} aria-label="Cycle operator" style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid #4a3c22', background: 'rgba(42,33,20,.5)', color: '#d8c9a4', font: "600 15px/1 var(--f-ui)", cursor: 'pointer', flex: 'none' }}>{OP_SYM[state.op]}</button>
        <StepBtn dir={-1} disabled={state.val == null} onClick={() => stepVal(-1)} />
        <span style={{ minWidth: 40, textAlign: 'center', ...(state.val != null ? { font: "600 19px/1 var(--f-display)", color: valueTint || '#e3c589' } : { font: "italic 400 14px/1 var(--f-read)", color: '#8a8175' }) }}>{state.val == null ? 'Any' : state.val}</span>
        <StepBtn dir={1} disabled={false} onClick={() => stepVal(1)} />
      </span>
    </div>
  );
}

// Sort ledger row - a gilt priority seal (numbered when active) + label + an
// SVG direction flip. Tap row toggles; tap the flip reverses.
function SortRow({ label, index, dir, onToggle, onFlip }) {
  const on = index >= 0;
  return (
    <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', cursor: 'pointer', ...HAIR_ROW }}>
      <span style={{ width: 24, height: 24, flex: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        ...(on ? { background: GILT, border: '1px solid rgba(16,10,3,.4)', color: '#1a1206', font: "700 12px/1 var(--f-display)" } : { border: '1px solid #4a3c22' }) }}>{on ? index + 1 : ''}</span>
      <span style={{ flex: 1, minWidth: 0, font: "600 15px/1.2 var(--f-read)", color: on ? '#efe7d8' : '#d8cebb' }}>{label}</span>
      {on && (
        <button onClick={(e) => { e.stopPropagation(); onFlip(); }} aria-label="Flip direction" style={{ width: 30, height: 30, flex: 'none', borderRadius: 10, border: '1px solid #4a3c22', background: 'rgba(42,33,20,.5)', color: '#d8c9a4', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{dir === 'asc' ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}</svg>
        </button>
      )}
    </div>
  );
}

export default function RefineSheet({
  open, onClose, onClear, eyebrow = 'REFINE', emptyLabel = 'All cards', activeCount = 0, ctaLabel = 'Show results',
  summaryLead = [], leadSections, trailSections,
  els, setEls, multi, setMulti,
  types, setTypes, rarities, setRarities, sets, setSets, setOpts = [],
  thByEl, setThByEl, totalTh, setTotalTh, costCmp, setCostCmp, powerCmp, setPowerCmp,
  artist, setArtist, artistOpts = [], sort, setSort,
}) {
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const toggleSort = (key) => { const i = sort.findIndex((s) => s.key === key); setSort(i >= 0 ? sort.filter((s) => s.key !== key) : [...sort, { key, dir: 'asc' }]); };
  const flipSort = (key) => setSort(sort.map((s) => (s.key === key ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s)));

  // Filters / Sort live behind a top toggle so sort isn't buried below a long
  // filter scroll. The toggle only appears when the surface actually sorts
  // (setSort supplied - the deckbuilder + Collection; Codex re-sorts A-Z, no sort).
  const [tab, setTab] = useState('filters');
  useEffect(() => { if (open) setTab('filters'); }, [open]);   // reopen on Filters
  const hasSort = !!setSort;
  const showFilters = !hasSort || tab === 'filters';
  const showSort = hasSort && tab === 'sort';

  // Summary hero: write the active refinement as a manuscript line.
  const labels = [...summaryLead];
  (els || []).forEach((k) => labels.push(EL_LABEL[k]));
  if (multi) labels.push('Multi');
  (types || []).forEach((t) => labels.push(t));
  (rarities || []).forEach((r) => labels.push(r));
  (sets || []).forEach((s) => labels.push(s));
  if (thByEl) ['air', 'earth', 'fire', 'water'].forEach((el) => { if (thByEl[el]?.val != null) labels.push(`${EL_LABEL[el]} thr`); });
  if (totalTh?.val != null) labels.push('Threshold');
  if (costCmp?.val != null) labels.push('Mana');
  if (powerCmp?.val != null) labels.push('Power');
  if (artist) labels.push(artist);
  const shown = labels.length > 4 ? [...labels.slice(0, 3), `+${labels.length - 3} more`] : labels;

  return (
    <GothicSheet open={open} onClose={onClose} label="Refine">
      <div style={{ ...EYEBROW, marginTop: 2 }}>{eyebrow}</div>
      <div style={{ textAlign: 'center', marginTop: 10, minHeight: 18, padding: '0 8px' }}>
        {labels.length === 0
          ? <span style={{ font: "italic 400 13.5px/1.4 var(--f-read)", color: 'var(--ink-faint)' }}>{emptyLabel}</span>
          : <span style={{ font: "400 13.5px/1.4 var(--f-read)", color: 'var(--ink-status)' }}><span style={{ font: "600 15px/1 var(--f-display)", color: '#c9b487' }}>{activeCount}</span> <span style={{ fontStyle: 'italic' }}>active &middot; {shown.join(' · ')}</span></span>}
      </div>
      <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, #4a3c22 30%, #4a3c22 70%, transparent)', margin: '18px 0 20px' }} />

      {hasSort && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
          <SegTabs ariaLabel="Filters or sort" value={tab} onChange={setTab}
            options={[
              { key: 'filters', label: 'Filters', icon: labels.length ? <span style={DOT} /> : null },
              { key: 'sort', label: 'Sort', icon: sort.length ? <span style={DOT} /> : null },
            ]} />
        </div>
      )}

      {showFilters && (<>
      {leadSections}

      {setEls && (
        <div style={{ marginBottom: 22 }}>
          <SectionLabel label="ELEMENT" count={cnt((els.length) + (multi ? 1 : 0))} />
          <ChipRow>
            {EL.map(([k, l]) => <PipChip key={k} el={k} label={l} active={els.includes(k)} onClick={() => toggle(els, setEls, k)} />)}
            {setMulti && <Chip label="Multi" active={multi} onClick={() => setMulti(!multi)} />}
          </ChipRow>
        </div>
      )}

      {setTypes && (
        <div style={{ marginBottom: 22 }}>
          <SectionLabel label="TYPE" count={cnt(types.length)} />
          <ChipRow>{TYPES.map(([k, l]) => <Chip key={k} label={l} active={types.includes(k)} onClick={() => toggle(types, setTypes, k)} />)}</ChipRow>
        </div>
      )}

      {setRarities && (
        <div style={{ marginBottom: 22 }}>
          <SectionLabel label="RARITY" count={cnt(rarities.length)} />
          <ChipRow>{RAR.map(([k, l]) => <Chip key={k} label={l} active={rarities.includes(k)} dot={RARITY_DOT[k]} onClick={() => toggle(rarities, setRarities, k)} />)}</ChipRow>
        </div>
      )}

      {setSets && setOpts.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <SectionLabel label="SET" count={cnt(sets.length)} />
          <ChipRow>{setOpts.map((s) => <Chip key={s} label={s} active={sets.includes(s)} onClick={() => toggle(sets, setSets, s)} />)}</ChipRow>
        </div>
      )}

      {setThByEl && (
        // content-visibility: below the fold on a phone (THRESHOLD/TOTALS/ARTIST) - skip
        // their layout+paint on open so the 280ms slide isn't fighting them; intrinsic-
        // size reserves height so the sheet is full-height from frame one (no jump).
        <div style={{ marginBottom: 22, contentVisibility: 'auto', containIntrinsicSize: 'auto 290px' }}>
          <SectionLabel label="THRESHOLD" count={cnt(['air', 'earth', 'fire', 'water'].filter((el) => thByEl[el]?.val != null).length)} />
          {['air', 'earth', 'fire', 'water'].map((el) => (
            <CmpRow key={el} icon={el} label={EL_LABEL[el]} state={thByEl[el]} set={(next) => setThByEl({ ...thByEl, [el]: next })} max={5} />
          ))}
        </div>
      )}

      {(setTotalTh || setCostCmp || setPowerCmp) && (
        <div style={{ marginBottom: 22, contentVisibility: 'auto', containIntrinsicSize: 'auto 230px' }}>
          <SectionLabel label="TOTALS" count={cnt((totalTh?.val != null ? 1 : 0) + (costCmp?.val != null ? 1 : 0) + (powerCmp?.val != null ? 1 : 0))} />
          {setTotalTh && <CmpRow label="Threshold" state={totalTh} set={setTotalTh} max={20} />}
          {setCostCmp && <CmpRow label="Mana" state={costCmp} set={setCostCmp} max={20} valueTint="#c9a8e8" />}
          {setPowerCmp && <CmpRow label="Power" state={powerCmp} set={setPowerCmp} max={12} valueTint="#e0a58f" />}
        </div>
      )}

      {setArtist && artistOpts.length > 0 && (
        <div style={{ marginBottom: 22, contentVisibility: 'auto', containIntrinsicSize: 'auto 100px' }}>
          <SectionLabel label="ARTIST" count={cnt(artist ? 1 : 0)} />
          <select value={artist} onChange={(e) => setArtist(e.target.value)}
            style={{ width: '100%', height: 44, borderRadius: 12, border: '1px solid #4a3c22', background: 'rgba(42,33,20,.5)', color: '#d8c9a4', font: "400 15px/1 var(--f-read)", padding: '0 14px', WebkitAppearance: 'none', appearance: 'none' }}>
            <option value="">Any artist</option>
            {artistOpts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      )}
      </>)}

      {showSort && (
        <div style={{ marginBottom: 22 }}>
          <SectionLabel label="SORT" count={cnt(sort.length)} />
          <div style={{ font: "italic 400 12.5px/1.4 var(--f-read)", color: '#8a8175', margin: '-4px 0 4px' }}>Tap to add - order sets priority.</div>
          {SORT_KEYS.map(([key, label]) => {
            const i = sort.findIndex((s) => s.key === key);
            return <SortRow key={key} label={label} index={i} dir={i >= 0 ? sort[i].dir : 'asc'} onToggle={() => toggleSort(key)} onFlip={() => flipSort(key)} />;
          })}
        </div>
      )}

      {showFilters && trailSections}

      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button onClick={onClear} style={{ ...BTN_GHOST, flex: 1, opacity: activeCount ? 1 : 0.4 }}>Clear</button>
        <button onClick={onClose} style={{ flex: 2, padding: '15px 0', borderRadius: 16, background: GILT, border: '1px solid #e3c589', color: '#1a1206', font: "600 13.5px/1 var(--f-display)", boxShadow: '0 6px 20px rgba(203,167,95,.22)', cursor: 'pointer' }}>{ctaLabel}</button>
      </div>
    </GothicSheet>
  );
}
