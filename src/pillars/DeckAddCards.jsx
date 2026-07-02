// Scoped add-cards flow — pick a zone (Spellbook/Atlas/Collection), search,
// List ⇄ Card view, per-card +/- steppers (List) or tap-to-add (Card), and a
// Filters & Sort sheet built from catalogue values. Enforces rarity/zone limits.
import React, { useEffect, useState } from 'react';
import { getPool, getSets, getArtists } from '../store/deckRepository.js';
import { query } from '../store/db.js';
import { ThresholdPips } from '../components/ui.jsx';
import { thresholdRuns } from '../store/cardArt.js';
import CardArt from '../components/CardArt.jsx';
import CardSheet from '../components/CardSheet.jsx';

const BASE = import.meta.env.BASE_URL;
const EL = [['air', 'Air'], ['earth', 'Earth'], ['fire', 'Fire'], ['water', 'Water']];
const TYPES = [['Minion', 'Minions'], ['Aura', 'Auras'], ['Magic', 'Magic'], ['Artifact', 'Artifacts'], ['Site', 'Sites']];
const RAR = [['Ordinary', 'Ordinary'], ['Exceptional', 'Exceptional'], ['Elite', 'Elite'], ['Unique', 'Unique']];
const RARITY_COLOR = { Ordinary: 'var(--ordinary)', Exceptional: 'var(--exceptional)', Elite: 'var(--elite)', Unique: 'var(--unique)' };

export default function DeckAddCards({ deckId, q, setQ, filterOpen, setFilterOpen, onChanged, registerCount }) {
  const [view, setView] = useState('list');
  const [rarityOn, setRarityOn] = useState(false);   // colour card names by rarity (Refine toggle)
  const [sort, setSort] = useState([]);   // [{key,dir}] priority list (Arcanum multi-sort)
  const [els, setEls] = useState([]);
  const [types, setTypes] = useState([]);
  const [rarities, setRarities] = useState([]);
  const [sets, setSets] = useState([]);
  const [multi, setMulti] = useState(false);
  const [thByEl, setThByEl] = useState(() => ({ air: { op: '>=', val: null }, earth: { op: '>=', val: null }, fire: { op: '>=', val: null }, water: { op: '>=', val: null } }));
  const [totalTh, setTotalTh] = useState({ op: '>=', val: null });
  const [costCmp, setCostCmp] = useState({ op: '>=', val: null });
  const [artist, setArtist] = useState('');
  const [setOpts, setSetOpts] = useState([]);
  const [artistOpts, setArtistOpts] = useState([]);
  const [pool, setPool] = useState([]);
  const [qtys, setQtys] = useState({});   // card_id -> total qty across all zones (in-deck badge)
  const [sheetCardId, setSheetCardId] = useState(null);

  useEffect(() => { getSets().then(setSetOpts); getArtists().then(setArtistOpts); }, []);

  async function loadPool() {
    const rows = await getPool({ q: q.trim(), els, types, rarities, sets, multi, thByEl, totalTh, costCmp, artist, sort });
    setPool(rows);
  }
  async function loadQtys() {
    const rows = await query('SELECT card_id, SUM(quantity) n FROM deck_entries WHERE deck_id=? GROUP BY card_id;', [deckId]);
    const m = {}; for (const r of rows) m[r.card_id] = r.n; setQtys(m);
  }
  useEffect(() => { const t = setTimeout(loadPool, 120); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, els, types, rarities, sets, multi, thByEl, totalTh, costCmp, artist, sort]);
  useEffect(() => { loadQtys(); /* eslint-disable-next-line */ }, [deckId]);
  const nComp = ['air', 'earth', 'fire', 'water'].filter((el) => thByEl[el].val != null).length + (totalTh.val != null ? 1 : 0) + (costCmp.val != null ? 1 : 0);
  useEffect(() => { registerCount?.(els.length + types.length + rarities.length + sets.length + (multi ? 1 : 0) + (artist ? 1 : 0) + nComp + (sort.length ? 1 : 0)); }, [els, types, rarities, sets, multi, artist, nComp, sort, registerCount]);

  function clearAll() {
    setEls([]); setTypes([]); setRarities([]); setSets([]); setMulti(false); setArtist('');
    setThByEl({ air: { op: '>=', val: null }, earth: { op: '>=', val: null }, fire: { op: '>=', val: null }, water: { op: '>=', val: null } });
    setTotalTh({ op: '>=', val: null }); setCostCmp({ op: '>=', val: null }); setSort([]);
  }

  const afterChange = () => { loadQtys(); onChanged?.(); };

  return (
    <div className="arc" style={{ padding: '4px 16px 26px', animation: 'cxfade .2s ease' }}>
      {/* view toggle (Arcanum amethyst) — no zone selector; cards auto-route by type */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 12 }}>
        <div className="view-toggle-wrap">
          <button className={`view-btn${view === 'list' ? ' on' : ''}`} onClick={() => setView('list')}>≡ List</button>
          <button className={`view-btn${view === 'grid' ? ' on' : ''}`} onClick={() => setView('grid')}>⊞ Card</button>
        </div>
      </div>

      <div style={{ font: "italic 400 12px/1.4 'EB Garamond',serif", color: 'var(--muted)', marginBottom: 12 }}>
        {pool.length} cards{pool.length > 250 ? ' (showing 250 — refine)' : ''}
      </div>

      {view === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {pool.slice(0, 250).map((c) => {
            const qty = qtys[c.card_id] || 0;
            return (
              <div key={c.card_id} className="card-img-tile" onClick={() => setSheetCardId(c.card_id)}>
                <CardArt card={c} radius={14} />
                {qty > 0 && <span className="in-deck-badge tile">{qty}</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          {pool.slice(0, 250).map((c) => {
            const qty = qtys[c.card_id] || 0;
            return (
              <div key={c.card_id} className="card-row" onClick={() => setSheetCardId(c.card_id)}>
                {qty > 0 && <span className="in-deck-badge">{qty}</span>}
                <span className="name" style={rarityOn ? { color: RARITY_COLOR[c.rarity] || 'var(--text)' } : undefined}>{c.name}</span>
                <ThresholdPips runs={thresholdRuns(c)} />
                {c.cost != null && <div className="cost-badge">{c.cost}</div>}
              </div>
            );
          })}
        </div>
      )}

      <CardSheet cardId={sheetCardId} deckId={deckId} onClose={() => setSheetCardId(null)} onChange={afterChange} />

      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)}
        rarityOn={rarityOn} setRarityOn={setRarityOn}
        sort={sort} setSort={setSort}
        els={els} setEls={setEls} types={types} setTypes={setTypes} rarities={rarities} setRarities={setRarities}
        sets={sets} setSets={setSets} setOpts={setOpts} multi={multi} setMulti={setMulti}
        thByEl={thByEl} setThByEl={setThByEl} totalTh={totalTh} setTotalTh={setTotalTh} costCmp={costCmp} setCostCmp={setCostCmp}
        artist={artist} setArtist={setArtist} artistOpts={artistOpts} onClear={clearAll} />
    </div>
  );
}

const OP_SYM = { '>=': '≥', '<=': '≤', '=': '=' };
const OP_NEXT = { '>=': '<=', '<=': '=', '=': '>=' };

// Comparator row (operator + Any/0-max stepper) — Arcanum's cmp-atom.
function CmpRow({ label, icon, state, set, max }) {
  const step = (d) => {
    let v = state.val == null ? (d > 0 ? 0 : null) : state.val + d;
    if (v != null) v = v < 0 ? null : Math.min(max, v);
    set({ ...state, val: v });
  };
  return (
    <div className="th-el-row">
      <span className={`th-el-label${icon ? '' : ' th-total-label'}`}>{icon && <img src={`${BASE}icons/${icon}.png`} alt="" />}{label}</span>
      <div className="cmp-atom">
        <button type="button" className="cmp-op" onClick={() => set({ ...state, op: OP_NEXT[state.op] })}>{OP_SYM[state.op]}</button>
        <div className="cmp-stepper">
          <button type="button" className="cmp-btn" onClick={() => step(-1)}>−</button>
          <span className={`cmp-val${state.val != null ? ' set' : ''}`}>{state.val == null ? 'Any' : state.val}</span>
          <button type="button" className="cmp-btn" onClick={() => step(1)}>+</button>
        </div>
      </div>
    </div>
  );
}

// Refine sheet — Arcanum's 2-tab (Filters / Sort) amethyst design, full filter set.
const SORT_KEYS = [['name', 'Name'], ['cost', 'Mana Cost'], ['element', 'Element'], ['th', 'Threshold Amount']];

function FilterSheet({ open, onClose, rarityOn, setRarityOn, sort, setSort, els, setEls, types, setTypes, rarities, setRarities,
  sets, setSets, setOpts, multi, setMulti, thByEl, setThByEl, totalTh, setTotalTh, costCmp, setCostCmp, artist, setArtist, artistOpts, onClear }) {
  const [tab, setTab] = useState('filters');
  if (!open) return null;
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const nComp = ['air', 'earth', 'fire', 'water'].filter((el) => thByEl[el].val != null).length + (totalTh.val != null ? 1 : 0) + (costCmp.val != null ? 1 : 0);
  const activeCount = els.length + types.length + rarities.length + sets.length + (multi ? 1 : 0) + (artist ? 1 : 0) + nComp + (sort.length ? 1 : 0);
  const toggleSort = (key) => { const i = sort.findIndex((s) => s.key === key); setSort(i >= 0 ? sort.filter((s) => s.key !== key) : [...sort, { key, dir: 'asc' }]); };
  const flipSort = (key) => setSort(sort.map((s) => s.key === key ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s));
  const sortItem = (key, label) => {
    const i = sort.findIndex((s) => s.key === key);
    const on = i >= 0;
    return (
      <div key={key} className={`sort-item${on ? ' active' : ''}`} onClick={() => toggleSort(key)}>
        <span className="sort-priority">{on ? i + 1 : ''}</span>
        <span className="sort-item-label">{label}</span>
        {on && <button className="sort-dir-btn" onClick={(e) => { e.stopPropagation(); flipSort(key); }}>{sort[i].dir === 'asc' ? '↑' : '↓'}</button>}
      </div>
    );
  };
  return (
    <>
      <div className="arc fsheet-scrim" onClick={onClose} />
      <div className="arc fsheet" onClick={(e) => e.stopPropagation()}>
        <div className="fsheet-handle" />
        <div className="fsheet-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="fsheet-title">Refine</div>
            <div className="fsheet-sub">{activeCount ? `${activeCount} active` : 'All cards'}</div>
          </div>
          <button className="fsheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="fsheet-tabs">
          <button className={`fsheet-tab${tab === 'filters' ? ' active' : ''}`} onClick={() => setTab('filters')}>Filters</button>
          <button className={`fsheet-tab${tab === 'sort' ? ' active' : ''}`} onClick={() => setTab('sort')}>Sort</button>
        </div>
        <div className="fsheet-body">
          {tab === 'filters' ? (
            <>
              <div className="filter-section">
                <div className="filter-label">Element</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {EL.map(([k, l]) => (
                    <button key={k} className={`el-toggle${els.includes(k) ? ' on' : ''}`} onClick={() => toggle(els, setEls, k)}>
                      <img src={`${BASE}icons/${k}.png`} alt="" />{l}
                    </button>
                  ))}
                  <button className={`el-toggle${multi ? ' on' : ''}`} onClick={() => setMulti(!multi)}>◈ Multi</button>
                </div>
              </div>
              <div className="filter-section">
                <div className="filter-label">Type</div>
                <div className="pill-group">
                  {TYPES.map(([k, l]) => <button key={k} className={`pill${types.includes(k) ? ' on' : ''}`} onClick={() => toggle(types, setTypes, k)}>{l}</button>)}
                </div>
              </div>
              <div className="filter-section">
                <div className="filter-label">Rarity</div>
                <div className="pill-group">
                  {RAR.map(([k, l]) => <button key={k} className={`pill${rarities.includes(k) ? ` on rarity-${k}` : ''}`} onClick={() => toggle(rarities, setRarities, k)}>{l}</button>)}
                </div>
              </div>
              <div className="filter-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="filter-label" style={{ marginBottom: 0 }}>Rarity Colours</div>
                <button className={`rarity-switch${rarityOn ? ' on' : ''}`} onClick={() => setRarityOn(!rarityOn)} aria-label="Toggle rarity colours" />
              </div>
              {setOpts.length > 0 && (
                <div className="filter-section">
                  <div className="filter-label">Set</div>
                  <div className="pill-group">
                    {setOpts.map((s) => <button key={s} className={`pill${sets.includes(s) ? ' on' : ''}`} onClick={() => toggle(sets, setSets, s)}>{s}</button>)}
                  </div>
                </div>
              )}
              <div className="filter-section">
                <div className="filter-label">Threshold by Element</div>
                <div className="th-el-list">
                  {['air', 'earth', 'fire', 'water'].map((el) => (
                    <CmpRow key={el} icon={el} label={el[0].toUpperCase() + el.slice(1)} state={thByEl[el]} set={(next) => setThByEl({ ...thByEl, [el]: next })} max={5} />
                  ))}
                </div>
              </div>
              <div className="filter-section">
                <div className="th-el-list">
                  <CmpRow label="Total threshold" state={totalTh} set={setTotalTh} max={20} />
                  <CmpRow label="Total mana" state={costCmp} set={setCostCmp} max={20} />
                </div>
              </div>
              {artistOpts.length > 0 && (
                <div className="filter-section">
                  <div className="filter-label">Artist</div>
                  <select className="filter-select" value={artist} onChange={(e) => setArtist(e.target.value)}>
                    <option value="">Any artist</option>
                    {artistOpts.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="sort-panel-title">Tap to add, ↑↓ to flip direction</div>
              <div className="sort-items">
                {SORT_KEYS.map(([key, label]) => sortItem(key, label))}
              </div>
            </>
          )}
        </div>
        <div className="fsheet-footer">
          <button className="filter-clear-btn" onClick={onClear}>Clear all</button>
          <button className="filter-apply-btn" onClick={onClose}>Show results</button>
        </div>
      </div>
    </>
  );
}
