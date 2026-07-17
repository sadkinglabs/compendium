// Codex browse - an A–Z divided list with note-indicator dots. The scope
// (Rules / Cards / Marginalia) is chosen by the shared control in the app
// contextHeader (App.CodexScopeBar) and passed in as `scope`; the Marginalia
// scope gathers the whole personal layer (notes, links, collections).
import React, { useEffect, useState, useMemo } from 'react';
import {
  getCodexEntries, getCodexCards, marginaliaAll, deleteNote, deleteLink, toggleSaved,
  listCollections, createCollection, renameCollection, deleteCollection, collectionItems, toggleCollectionItem,
} from '../store/codexRepository.js';
import { getSets, getArtists } from '../store/deckRepository.js';
import { Chip, ChipRow, SectionLabel, SegTabs, IcList, IcGrid, IconButton, Loading } from '../components/ui.jsx';
import Sheet from '../components/Sheet.jsx';
import RefineSheet from '../components/RefineSheet.jsx';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import CardArt from '../components/CardArt.jsx';
import { toast, confirmAction } from '../feedback.js';

// Codex row glyphs - card = rectangle (a card), article = three lines of text.
// The one entity-icon set for the whole app: card = rounded rectangle,
// rule/article = three lines, deck = stacked squares (matches the Decks nav).
// Reused by the resume tile and dashboard rows so an entity always reads the same.
export function CodexGlyph({ kind, size = 16 }) {
  const s = { width: size, height: size };
  if (kind === 'card') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={s}><rect x="5" y="3" width="14" height="18" rx="2" /></svg>
  );
  if (kind === 'deck') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s}><rect x="3" y="5" width="13" height="17" rx="2" /><rect x="8" y="2" width="13" height="17" rx="2" /></svg>
  );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={s}><line x1="5" y1="7" x2="19" y2="7" /><line x1="5" y1="12" x2="19" y2="12" /><line x1="5" y1="17" x2="14" y2="17" /></svg>
  );
}

// Scope-specific filter sheets. Shared: saved / marginalia / linked. Rules add
// structure filters (sub-articles, card examples); Cards add FAQ/errata/sets.
const RULE_FILTERS = [
  ['fav', 'Bookmarked'], ['marg', 'Has marginalia'], ['subs', 'Contains sub-articles'],
  ['examples', 'Contains examples'], ['linked', 'Linked'],
];
const CARD_FILTERS = [
  ['fav', 'Bookmarked'], ['marg', 'Has marginalia'], ['faq', 'Contains FAQ'],
  ['errata', 'Errata cards'], ['linked', 'Linked'],
];

export default function Codex({ scope, onOpen, preset, onPresetApplied, rev }) {
  const sc = scope === 'all' ? 'rules' : scope;   // stale persisted scope → Rules
  const [entries, setEntries] = useState(null);
  const [filters, setFilters] = useState({ rules: {}, cards: {} });   // Codex-only toggles (fav/marg/faq/errata/linked), per-scope
  const [filterSheet, setFilterSheet] = useState(false);
  const [cardView, setCardView] = useState('list');   // Cards scope: list rows vs art grid (parity with the deckbuilder)

  // Rich card filters (Cards scope) - the shared Refine engine, same as the
  // deckbuilder (element/type/rarity/set/threshold/mana/artist). Sort is left off
  // on purpose: the browse list is an A-Z reference index.
  const [cEls, setCEls] = useState([]);
  const [cTypes, setCTypes] = useState([]);
  const [cRarities, setCRarities] = useState([]);
  const [cSets, setCSets] = useState([]);
  const [cMulti, setCMulti] = useState(false);
  const [cThByEl, setCThByEl] = useState(() => ({ air: { op: '>=', val: null }, earth: { op: '>=', val: null }, fire: { op: '>=', val: null }, water: { op: '>=', val: null } }));
  const [cTotalTh, setCTotalTh] = useState({ op: '>=', val: null });
  const [cCostCmp, setCCostCmp] = useState({ op: '>=', val: null });
  const [cArtist, setCArtist] = useState('');
  const [setOpts, setSetOpts] = useState([]);
  const [artistOpts, setArtistOpts] = useState([]);
  useEffect(() => { getSets().then(setSetOpts); getArtists().then(setArtistOpts); }, []);

  // One-shot filter preset from elsewhere in the app (e.g. Home "All notes ›"
  // lands here pre-filtered to entries carrying your marginalia).
  useEffect(() => {
    if (preset) { setFilters((f) => ({ ...f, [sc === 'marginalia' ? 'rules' : sc]: preset })); onPresetApplied?.(); }
    // eslint-disable-next-line
  }, [preset]);

  const marginalia = sc === 'marginalia';
  const cur = filters[sc] || {};
  const setCur = (updater) => setFilters((f) => ({ ...f, [sc]: typeof updater === 'function' ? updater(f[sc] || {}) : updater }));
  const richComp = ['air', 'earth', 'fire', 'water'].filter((el) => cThByEl[el].val != null).length + (cTotalTh.val != null ? 1 : 0) + (cCostCmp.val != null ? 1 : 0);
  const richCount = cEls.length + cTypes.length + cRarities.length + cSets.length + (cMulti ? 1 : 0) + (cArtist ? 1 : 0) + richComp;
  const curCount = Object.entries(cur).reduce((n, [, v]) => n + (Array.isArray(v) ? v.length : v ? 1 : 0), 0);
  const activeCount = sc === 'cards' ? richCount + curCount : curCount;

  useEffect(() => {
    if (marginalia) return;
    let alive = true;
    if (sc === 'cards') {
      const rich = { els: cEls, types: cTypes, rarities: cRarities, sets: cSets, multi: cMulti, thByEl: cThByEl, totalTh: cTotalTh, costCmp: cCostCmp, artist: cArtist };
      getCodexCards(rich, cur).then((e) => alive && setEntries(e));
    } else {
      getCodexEntries(sc, cur).then((e) => alive && setEntries(e));
    }
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [sc, rev, filters, marginalia, cEls, cTypes, cRarities, cSets, cMulti, cThByEl, cTotalTh, cCostCmp, cArtist]);

  const clearCards = () => {
    setCEls([]); setCTypes([]); setCRarities([]); setCSets([]); setCMulti(false); setCArtist('');
    setCThByEl({ air: { op: '>=', val: null }, earth: { op: '>=', val: null }, fire: { op: '>=', val: null }, water: { op: '>=', val: null } });
    setCTotalTh({ op: '>=', val: null }); setCCostCmp({ op: '>=', val: null });
    setCur({});
  };

  return (
    <div style={{ padding: '6px 20px 26px', animation: 'cxfade .2s ease' }}>
      {marginalia ? (
        <>
          <MarginaliaView onOpen={onOpen} rev={rev} />
        </>
      ) : (
      <>

      {sc === 'cards' ? (
        <RefineSheet open={filterSheet} onClose={() => setFilterSheet(false)} onClear={clearCards}
          eyebrow="CARD FILTERS" activeCount={activeCount} ctaLabel={`Show ${entries?.length ?? 0} card${entries?.length === 1 ? '' : 's'}`}
          summaryLead={CARD_FILTERS.filter(([k]) => cur[k]).map(([, label]) => label)}
          leadSections={(
            <div style={{ marginBottom: 22 }}>
              <SectionLabel label="SHOWING ONLY" count={CARD_FILTERS.filter(([k]) => cur[k]).length || undefined} />
              <ChipRow>
                {CARD_FILTERS.map(([k, label]) => <Chip key={k} label={label} active={!!cur[k]} onClick={() => setCur((f) => ({ ...f, [k]: !f[k] }))} />)}
              </ChipRow>
            </div>
          )}
          els={cEls} setEls={setCEls} multi={cMulti} setMulti={setCMulti}
          types={cTypes} setTypes={setCTypes} rarities={cRarities} setRarities={setCRarities}
          sets={cSets} setSets={setCSets} setOpts={setOpts}
          thByEl={cThByEl} setThByEl={setCThByEl} totalTh={cTotalTh} setTotalTh={setCTotalTh} costCmp={cCostCmp} setCostCmp={setCCostCmp}
          artist={cArtist} setArtist={setCArtist} artistOpts={artistOpts} />
      ) : (
        <Sheet open={filterSheet} title="Article Filters" onClose={() => setFilterSheet(false)}>
          <div style={{ padding: '0 16px' }}>
          {RULE_FILTERS.map(([k, label]) => (
            <div key={k} onClick={() => setCur((f) => ({ ...f, [k]: !f[k] }))} className="cx-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer' }}>
              <span style={{ font: "600 14px/1 var(--f-ui)", color: 'var(--ink-body)' }}>{label}</span>
              <span style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid var(--hair-40)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a1410', background: cur[k] ? 'var(--gold-leaf)' : 'transparent' }}>
                {cur[k] && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={() => setCur({})} style={{ flex: 1, padding: '12px 0', borderRadius: 12, background: 'transparent', color: 'var(--ink-status)', font: "600 13px/1 var(--f-ui)", border: '1px solid var(--hair-22)', cursor: 'pointer' }}>Clear</button>
            <button onClick={() => setFilterSheet(false)} style={{ flex: 2, padding: '12px 0', borderRadius: 12, background: 'rgba(18,16,13,.85)', color: 'var(--gold-leaf)', font: "700 14px/1 var(--f-ui)", border: '1px solid rgba(220,184,111,.45)', cursor: 'pointer' }}>Show results</button>
          </div>
          </div>
        </Sheet>
      )}

      {/* Cards get a List / Card (art grid) toggle - parity with the deckbuilder. */}
      {sc === 'cards' && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0 14px' }}>
          <SegTabs ariaLabel="Card view" value={cardView} onChange={setCardView}
            options={[{ key: 'list', label: 'List', icon: <IcList /> }, { key: 'grid', label: 'Card', icon: <IcGrid /> }]} />
        </div>
      )}

      {entries == null ? (
        <Skeleton />
      ) : entries.length === 0 ? (
        <div style={{ padding: '50px 20px', textAlign: 'center', font: "400 15px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>Nothing matches these filters.</div>
      ) : (sc === 'cards' && cardView === 'grid') ? (
        <div className="cx-card-grid">
          {entries.map((it) => (
            <button key={it.id} className="cx-card-tile" onClick={() => onOpen('card', it.id, it.name)} aria-label={it.name}>
              <CardArt card={{ ...it, card_id: it.id }} radius={14} aspect="5/7" />
              {it.saved && (
                <span className="cx-card-seal" aria-label="Bookmarked"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" /></svg></span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <AzList entries={entries} onOpen={onOpen} />
      )}

      {/* Codex FAB - opens the scope's filter sheet; badge = active filter count */}
      <Fab variant="deck" icon={<FabGlyph kind="filters" />} label="Filters" badge={activeCount} onClick={() => setFilterSheet(true)} />
      </>
      )}
    </div>
  );
}

/* ── Marginalia - the whole personal layer in one place. Read-only until the
   user enters Edit mode; then delete/rename affordances appear. ── */
function MarginaliaView({ onOpen, rev }) {
  const [d, setD] = useState(null);
  const [cols, setCols] = useState(null);
  const [edit, setEdit] = useState(false);                     // edit mode gates all destructive affordances
  const [openCols, setOpenCols] = useState(() => new Set());   // expanded collections
  const [items, setItems] = useState({});                      // collectionId → items
  const [editing, setEditing] = useState(null);                // {id, name} - inline rename
  // Collapsible categories - with 100+ entries each, users need to fold sections
  // away. Persisted (which sections are closed) so a curated view survives.
  const MARG_KEY = 'cx-marg-collapse';
  const [closed, setClosed] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem(MARG_KEY) || '[]')); } catch { return new Set(); } });
  const toggleSection = (id) => setClosed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); try { localStorage.setItem(MARG_KEY, JSON.stringify([...n])); } catch { /* private mode */ } return n; });

  const [newCol, setNewCol] = useState('');
  async function load() {
    const [m, c] = await Promise.all([marginaliaAll(), listCollections()]);
    setD(m); setCols(c);
    const it = {};
    for (const id of openCols) it[id] = await collectionItems(id);
    setItems(it);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [rev]);
  async function addCollection() {
    const n = newCol.trim();
    if (!n) return;
    await createCollection(n); setNewCol(''); load();
  }

  async function toggleCol(id) {
    const n = new Set(openCols);
    if (n.has(id)) n.delete(id);
    else { n.add(id); if (!items[id]) setItems({ ...items, [id]: await collectionItems(id) }); }
    setOpenCols(n);
  }
  async function saveRename() {
    const nn = editing?.name.trim();
    if (nn) await renameCollection(editing.id, nn);
    setEditing(null); load();
  }
  async function removeCol(c) {
    if (!(await confirmAction({ title: `Delete “${c.name}”?`, body: `Its ${c.count} item${c.count === 1 ? '' : 's'} stay in the catalogue - only the collection is removed.`, confirmLabel: 'Delete collection', danger: true }))) return;
    await deleteCollection(c.id); load(); toast('Collection deleted');
  }

  if (!d || !cols) return <Loading />;
  const empty = d.saved.length + d.notes.length + d.links.length + cols.length === 0;
  const on = (t) => <span style={{ display: 'block', font: "500 10px/1 var(--f-ui)", color: 'var(--ink-muted)', marginTop: 5 }}>on {t}</span>;
  const openS = (id) => !closed.has(id);
  // A collapsible category header (label + count + Material chevron). Kept as a
  // render function, not a component, so the collections input isn't remounted.
  const secHead = (id, label) => (
    <div className="cx-marg-head" onClick={() => toggleSection(id)} role="button" aria-expanded={openS(id)}>
      <span style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.16em', color: 'var(--gold-leaf)' }}>{label}</span>
      <span className="cx-marg-count">{id === 'collections' ? cols.length : d[id].length}</span>
      <span style={{ flex: 1 }} />
      <span className="cx-sub-chevron" data-open={openS(id) ? 'true' : 'false'} style={{ flex: 'none' }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </span>
    </div>
  );

  return (
    <div style={{ paddingTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={() => { setEdit((v) => !v); setEditing(null); }}
          style={{ padding: '7px 16px', borderRadius: 18, border: '1px solid var(--hair-30)', background: edit ? 'rgba(220,184,111,.14)' : 'transparent', color: 'var(--gold-leaf)', font: "600 12px/1 var(--f-ui)", cursor: 'pointer' }}>
          {edit ? 'Done' : 'Edit'}
        </button>
      </div>
      {empty && !edit && (
        <div style={{ padding: '40px 20px', textAlign: 'center', font: "400 15px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>
          Your marginalia lives here - notes, links and collections you add across the Codex. Tap <span style={{ fontStyle: 'normal', color: 'var(--gold-leaf)' }}>Edit</span> to start a collection.
        </div>
      )}

      {/* SAVED leads - the entries you starred across the Codex, previously
          invisible outside their own pages. Hued like everything else here:
          card = violet, article = gold. Edit mode unsaves. */}
      {d.saved.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          {secHead('saved', 'BOOKMARKS')}
          {openS('saved') && d.saved.map((s) => {
            const isCard = s.target_type === 'card';
            const hue = isCard ? 'var(--link-violet)' : 'var(--gold-leaf)';
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 2px', borderBottom: '1px solid var(--hair-12)' }}>
                <span onClick={() => onOpen(s.target_type, s.target_id, s.on)} className="cx-row" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                  <span style={{ color: hue, flex: 'none', display: 'flex' }}><CodexGlyph kind={s.target_type} size={15} /></span>
                  <span style={{ font: "600 14.5px/1.25 var(--f-read)", color: 'var(--ink-body)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.on}</span>
                  <span style={{ font: "600 9px/1 var(--f-ui)", letterSpacing: '.1em', color: hue, flex: 'none' }}>{isCard ? 'CARD' : 'ARTICLE'}</span>
                </span>
                {edit && <IconButton glyph="✕" tone="danger" size={22} onClick={async () => { await toggleSaved(s.target_type, s.target_id); load(); }} title="Remove bookmark" />}
              </div>
            );
          })}
        </div>
      )}

      {d.notes.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          {secHead('notes', 'NOTES')}
          {/* Notes read as CARDS - full frame, plain upright text. The PLACE leads:
              which entry the note lives on (name + type, hued card-violet /
              article-gold), then the note itself beneath. */}
          {openS('notes') && d.notes.map((n) => {
            const isCard = n.target_type === 'card';
            const hue = isCard ? 'var(--link-violet)' : 'var(--gold-leaf)';
            return (
              <div key={n.id} style={{ background: 'rgba(18,16,13,.72)', border: '1px solid rgba(220,184,111,.2)', borderRadius: 12, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.03)', padding: '11px 14px 12px', marginBottom: 10, display: 'flex', gap: 8 }}>
                <div onClick={() => onOpen(n.target_type, n.target_id, n.on)} className="cx-row" style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                    <span style={{ color: hue, flex: 'none', display: 'flex' }}><CodexGlyph kind={n.target_type} size={14} /></span>
                    <span style={{ font: "600 15px/1.2 var(--f-read)", color: 'var(--ink-body)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.on}</span>
                    <span style={{ font: "600 9px/1 var(--f-ui)", letterSpacing: '.1em', color: hue, flex: 'none' }}>{isCard ? 'CARD' : 'ARTICLE'}</span>
                  </div>
                  <div style={{ font: "400 14px/1.5 var(--f-read)", color: 'var(--ink-body-2)' }}>{n.body}</div>
                </div>
                {edit && <IconButton glyph="✕" tone="danger" size={22} onClick={async () => { await deleteNote(n.id); load(); }} title="Delete note" />}
              </div>
            );
          })}
        </div>
      )}

      {d.links.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          {secHead('links', 'LINKS')}
          {openS('links') && d.links.map((l) => (
            <div key={l.id} style={{ borderLeft: '2px solid var(--link-violet)', background: 'rgba(199,154,208,.08)', borderRadius: '0 10px 10px 0', padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "600 14px/1.35 var(--f-read)", color: 'var(--link-violet)' }}>
                  <span onClick={() => onOpen(l.aType, l.aId, l.aName)} style={{ cursor: 'pointer' }}>{l.aName}</span>
                  <span style={{ color: 'var(--ink-faint)', margin: '0 6px' }}>↔</span>
                  <span onClick={() => onOpen(l.bType, l.bId, l.bName)} style={{ cursor: 'pointer' }}>{l.bName}</span>
                </div>
                {l.description && <div style={{ font: "400 12.5px/1.4 var(--f-read)", color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: 3 }}>{l.description}</div>}
              </div>
              {edit && <IconButton glyph="✕" tone="danger" size={22} onClick={async () => { await deleteLink(l.id); load(); }} title="Delete link" />}
            </div>
          ))}
        </div>
      )}

      {(cols.length > 0 || edit) && (
        <div style={{ marginBottom: 10 }}>
          {secHead('collections', 'COLLECTIONS')}
          {openS('collections') && (<>
          {edit && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input value={newCol} onChange={(e) => setNewCol(e.target.value)} placeholder="New collection…"
                onKeyDown={(e) => { if (e.key === 'Enter') addCollection(); }}
                style={{ flex: 1, height: 40, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 10, padding: '0 12px', color: 'var(--ink-body)', font: "400 14px/1 var(--f-read)" }} />
              <button onClick={addCollection} style={{ padding: '0 16px', borderRadius: 10, background: 'rgba(18,16,13,.85)', border: '1px solid rgba(220,184,111,.45)', color: 'var(--gold-leaf)', font: "700 12px/1 var(--f-ui)", cursor: 'pointer' }}>Add</button>
            </div>
          )}
          {cols.length === 0 && edit && <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', marginBottom: 8 }}>No collections yet - name one above, then collect cards & rules into it from their pages.</div>}
          {cols.map((c) => (
            <div key={c.id} style={{ borderBottom: '1px solid var(--hair-12)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 2px' }}>
                {edit && editing?.id === c.id ? (
                  <>
                    <input value={editing.name} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditing(null); }}
                      style={{ flex: 1, height: 36, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 10, padding: '0 12px', color: 'var(--ink-body)', font: "400 14px/1 var(--f-read)" }} />
                    <IconButton glyph="✓" size={26} onClick={saveRename} title="Save name" />
                  </>
                ) : (
                  <>
                    <span onClick={() => toggleCol(c.id)} className="cx-row" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <span style={{ font: "600 15px/1 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                      <span style={{ font: "500 11px/1 var(--f-mono)", color: 'var(--ink-faint)', flex: 'none' }}>{c.count}</span>
                      <span className="cx-sub-chevron" data-open={openCols.has(c.id) ? 'true' : 'false'} style={{ flex: 'none' }}>
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                      </span>
                    </span>
                    {edit && <IconButton glyph="✎" tone="muted" size={26} onClick={() => setEditing({ id: c.id, name: c.name })} title="Rename collection" />}
                    {edit && <IconButton glyph="✕" tone="danger" size={26} onClick={() => removeCol(c)} title="Delete collection" />}
                  </>
                )}
              </div>
              {openCols.has(c.id) && (
                <div style={{ padding: '0 0 10px 14px' }}>
                  {(items[c.id] || []).length === 0
                    ? <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>Empty collection.</div>
                    : (items[c.id] || []).map((it) => (
                      <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0' }}>
                        <span style={{ color: 'var(--gold)', width: 15, textAlign: 'center', fontSize: 12 }}>{it.target_type === 'card' ? '◈' : '§'}</span>
                        <span onClick={() => onOpen(it.target_type, it.target_id, it.name)} className="cx-row" style={{ flex: 1, minWidth: 0, font: "500 13.5px/1.25 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{it.name}</span>
                        {edit && <IconButton glyph="✕" tone="danger" size={20} onClick={async () => { await toggleCollectionItem(c.id, it.target_type, it.target_id); setItems({ ...items, [c.id]: await collectionItems(c.id) }); load(); }} title="Remove from collection" />}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
          </>)}
        </div>
      )}
    </div>
  );
}

// Right-edge affordance: gold filled bookmark when saved, else a quiet chevron.
const BookmarkGlyph = () => (
  <span className="cx-codex-bm" aria-label="Bookmarked"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" /></svg></span>
);
const ChevGlyph = () => (
  <svg className="cx-codex-chev" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
);

// A-Z divided list. Rule rows are title-only (tap opens the article - no inline
// sub-expansion); card rows carry a mini card-art thumb + the shared type · mana
// meta line. Both end in the bookmark glyph or a quiet chevron.
function AzList({ entries, onOpen }) {
  // The browse index can be the whole catalog (~1100 rows), so rebuild the element
  // list only when the data (or handler) actually changes - not on every re-render.
  const rows = useMemo(() => {
    let cur = '';
    const out = [];
    entries.forEach((it, i) => {
      // Fold diacritics for the section letter so accented initials group under
      // their base letter (e.g. "Älvalinne" belongs in A, not a lone "Ä" header
      // that splits the A run - the sort already orders it among the A's).
      const L = (it.name.charAt(0).normalize('NFD').replace(/[̀-ͯ]/g, '') || it.name.charAt(0)).toUpperCase();
      if (L !== cur) {
        cur = L;
        out.push(
          <div key={'div-' + i} className="cx-codex-rubric">
            <span className="cx-codex-letter">{L}</span>
            <span className="cx-codex-hair" />
          </div>
        );
      }
      if (it.kind === 'card') {
        const type = (it.type || 'Card').split(/[^A-Za-z]+/)[0];
        out.push(
          <div key={'card' + it.id} className="cx-row cx-codex-row" onClick={() => onOpen('card', it.id, it.name)}>
            <span className="cx-codex-thumb"><CardArt card={{ ...it, card_id: it.id }} radius={7} aspect="5/7" /></span>
            <div className="cx-codex-body">
              <span className="cx-codex-name">{it.name}</span>
              <span className="cx-codex-meta">
                <span className="cx-codex-type">{type}</span>
                {it.cost != null && <><span className="cx-codex-sep" /><span><span className="cx-codex-mana">{it.cost}</span> mana</span></>}
              </span>
            </div>
            {it.saved ? <BookmarkGlyph /> : <ChevGlyph />}
          </div>
        );
      } else {
        out.push(
          <div key={'rule' + it.id} className="cx-row cx-codex-row" onClick={() => onOpen('rule', it.id, it.name)}>
            <span className="cx-codex-title">{it.name}</span>
            {it.saved ? <BookmarkGlyph /> : <ChevGlyph />}
          </div>
        );
      }
    });
    return out;
  }, [entries, onOpen]);
  return <div className="cx-az-list">{rows}</div>;
}

function Skeleton() {
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ height: 50, borderBottom: '1px solid var(--hair-12)', opacity: 0.4 }} />
      ))}
    </div>
  );
}
