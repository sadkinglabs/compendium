// Codex browse — scope chips (Rules · Cards · All · Marginalia) and an A–Z
// divided list with note-indicator dots. The Marginalia scope gathers the whole
// personal layer (notes, highlights, links, collections) in one editable place.
import React, { useEffect, useState } from 'react';
import {
  getCodexEntries, marginaliaAll, deleteNote, deleteHighlight, deleteLink,
  listCollections, renameCollection, deleteCollection, collectionItems, toggleCollectionItem,
} from '../store/codexRepository.js';
import { Chip, ChipRow, ListRow, SectionLabel, IconButton, Loading } from '../components/ui.jsx';
import Sheet from '../components/Sheet.jsx';
import Fab, { FabGlyph } from '../components/Fab.jsx';

// Codex row glyphs — card = rectangle (a card), article = three lines of text.
function CodexGlyph({ kind }) {
  if (kind === 'card') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}><rect x="5" y="3" width="14" height="18" rx="2" /></svg>
  );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 16, height: 16 }}><line x1="5" y1="7" x2="19" y2="7" /><line x1="5" y1="12" x2="19" y2="12" /><line x1="5" y1="17" x2="14" y2="17" /></svg>
  );
}

const SCOPES = [['rules', 'Rules'], ['cards', 'Cards'], ['all', 'All']];
const FILTERS = [['fav', 'Saved only'], ['notes', 'Has notes'], ['faq', 'Has FAQ'], ['errata', 'Errata']];

export default function Codex({ scope, setScope, onOpen, preset, onPresetApplied, rev }) {
  const [entries, setEntries] = useState(null);
  const [filters, setFilters] = useState({});
  const [filterSheet, setFilterSheet] = useState(false);

  // One-shot filter preset from elsewhere in the app (e.g. Home "All notes ›"
  // lands here pre-filtered to entries carrying your marginalia).
  useEffect(() => {
    if (preset) { setFilters(preset); onPresetApplied?.(); }
    // eslint-disable-next-line
  }, [preset]);

  const marginalia = scope === 'marginalia';
  useEffect(() => {
    if (marginalia) return;
    let alive = true;
    getCodexEntries(scope, filters).then((e) => alive && setEntries(e));
    return () => { alive = false; };
  }, [scope, rev, filters, marginalia]);

  return (
    <div style={{ padding: '6px 20px 26px', animation: 'cxfade .2s ease' }}>
      {/* Scope (Rules/Cards/All · Marginalia) — sticky so it stays visible while scrolling. */}
      <div className="cx-codex-topbar">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <ChipRow>
            {SCOPES.map(([k, label]) => (
              <Chip key={k} label={label} active={scope === k} onClick={() => setScope(k)} />
            ))}
          </ChipRow>
          <Chip label="Marginalia" active={marginalia} onClick={() => setScope('marginalia')} />
        </div>
      </div>

      {marginalia ? (
        <>
          <MarginaliaView onOpen={onOpen} rev={rev} />
        </>
      ) : (
      <>

      <Sheet open={filterSheet} title="Filters" onClose={() => setFilterSheet(false)}>
        <div style={{ padding: '0 16px' }}>
        {FILTERS.map(([k, label]) => (
          <div key={k} onClick={() => setFilters((f) => ({ ...f, [k]: !f[k] }))} className="cx-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer' }}>
            <span style={{ font: "600 14px/1 var(--f-ui)", color: 'var(--ink-body)' }}>{label}</span>
            <span style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid var(--hair-40)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a1410', background: filters[k] ? 'var(--gold-leaf)' : 'transparent', fontSize: 13 }}>{filters[k] ? '✓' : ''}</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={() => setFilters({})} style={{ flex: 1, padding: '12px 0', borderRadius: 12, background: 'transparent', color: 'var(--ink-status)', font: "600 13px/1 var(--f-ui)", border: '1px solid var(--hair-22)', cursor: 'pointer' }}>Clear</button>
          <button onClick={() => setFilterSheet(false)} style={{ flex: 2, padding: '12px 0', borderRadius: 12, background: 'linear-gradient(180deg,#dcb86f,#c9a35a)', color: '#1a1410', font: "700 14px/1 var(--f-ui)", border: 'none', cursor: 'pointer' }}>Show results</button>
        </div>
        </div>
      </Sheet>

      {entries == null ? (
        <Skeleton />
      ) : entries.length === 0 ? (
        <div style={{ padding: '50px 20px', textAlign: 'center', font: "400 15px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>Nothing matches these filters.</div>
      ) : (
        <AzList entries={entries} onOpen={onOpen} />
      )}

      {/* Codex FAB — opens filters (browse scopes only) */}
      <Fab variant="deck" icon={<FabGlyph kind="filters" />} label="Filters" onClick={() => setFilterSheet(true)} />
      </>
      )}
    </div>
  );
}

/* ── Marginalia — the whole personal layer, editable in one place ── */
function MarginaliaView({ onOpen, rev }) {
  const [d, setD] = useState(null);
  const [cols, setCols] = useState(null);
  const [openCols, setOpenCols] = useState(() => new Set());   // expanded collections
  const [items, setItems] = useState({});                      // collectionId → items
  const [editing, setEditing] = useState(null);                // {id, name} — inline rename

  async function load() {
    const [m, c] = await Promise.all([marginaliaAll(), listCollections()]);
    setD(m); setCols(c);
    const it = {};
    for (const id of openCols) it[id] = await collectionItems(id);
    setItems(it);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [rev]);

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
    if (!confirm(`Delete collection “${c.name}”? Its ${c.count} item${c.count === 1 ? '' : 's'} stay in the catalogue.`)) return;
    await deleteCollection(c.id); load();
  }

  if (!d || !cols) return <Loading />;
  const empty = d.notes.length + d.highlights.length + d.links.length + cols.length === 0;
  if (empty) return (
    <div style={{ padding: '50px 20px', textAlign: 'center', font: "400 15px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>
      Your marginalia lives here — notes, highlights, links and collections you add across the Codex.
    </div>
  );
  const on = (t) => <span style={{ display: 'block', font: "500 10px/1 var(--f-ui)", color: 'var(--ink-muted)', marginTop: 5 }}>on {t}</span>;

  return (
    <div style={{ paddingTop: 4 }}>
      {d.notes.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <SectionLabel glyph="⚜" label="NOTES" count={d.notes.length} />
          {d.notes.map((n) => (
            <div key={n.id} style={{ borderLeft: '2px solid var(--gold)', background: 'rgba(201,163,90,.06)', borderRadius: '0 10px 10px 0', padding: '10px 12px', marginBottom: 8, display: 'flex', gap: 8 }}>
              <div onClick={() => onOpen(n.target_type, n.target_id, n.on)} className="cx-row" style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                <div style={{ font: "400 14px/1.45 var(--f-read)", color: 'var(--ink-body)', fontStyle: 'italic' }}>{n.body}</div>
                {on(n.on)}
              </div>
              <IconButton glyph="✕" tone="danger" size={22} onClick={async () => { await deleteNote(n.id); load(); }} title="Delete note" />
            </div>
          ))}
        </div>
      )}

      {d.highlights.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <SectionLabel glyph="✦" label="HIGHLIGHTS" count={d.highlights.length} />
          {d.highlights.map((h) => (
            <div key={h.id} style={{ borderLeft: '3px solid var(--hl-blue)', background: 'rgba(91,135,214,.06)', borderRadius: '0 10px 10px 0', padding: '10px 12px', marginBottom: 8, display: 'flex', gap: 8 }}>
              <div onClick={() => onOpen(h.target_type, h.target_id, h.on)} className="cx-row" style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                <div style={{ font: "400 14px/1.45 var(--f-read)", color: 'var(--ink-body-2)', fontStyle: 'italic' }}>“{h.text}”{h.comment ? <span style={{ display: 'block', fontStyle: 'normal', color: 'var(--ink-muted)', fontSize: 12, marginTop: 4 }}>{h.comment}</span> : null}</div>
                {on(h.on)}
              </div>
              <IconButton glyph="✕" tone="danger" size={22} onClick={async () => { await deleteHighlight(h.id); load(); }} title="Delete highlight" />
            </div>
          ))}
        </div>
      )}

      {d.links.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <SectionLabel glyph="↔" label="LINKS" count={d.links.length} />
          {d.links.map((l) => (
            <div key={l.id} style={{ borderLeft: '2px solid var(--link-violet)', background: 'rgba(199,154,208,.08)', borderRadius: '0 10px 10px 0', padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "600 14px/1.35 var(--f-read)", color: 'var(--link-violet)' }}>
                  <span onClick={() => onOpen(l.aType, l.aId, l.aName)} style={{ cursor: 'pointer' }}>{l.aName}</span>
                  <span style={{ color: 'var(--ink-faint)', margin: '0 6px' }}>↔</span>
                  <span onClick={() => onOpen(l.bType, l.bId, l.bName)} style={{ cursor: 'pointer' }}>{l.bName}</span>
                </div>
                {l.description && <div style={{ font: "400 12.5px/1.4 var(--f-read)", color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: 3 }}>{l.description}</div>}
              </div>
              <IconButton glyph="✕" tone="danger" size={22} onClick={async () => { await deleteLink(l.id); load(); }} title="Delete link" />
            </div>
          ))}
        </div>
      )}

      {cols.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <SectionLabel glyph="❧" label="COLLECTIONS" count={cols.length} />
          {cols.map((c) => (
            <div key={c.id} style={{ borderBottom: '1px solid var(--hair-12)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 2px' }}>
                {editing?.id === c.id ? (
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
                      <span className="cx-sub-chevron" data-open={openCols.has(c.id) ? 'true' : 'false'} style={{ flex: 'none' }}>⌄</span>
                    </span>
                    <IconButton glyph="✎" tone="muted" size={26} onClick={() => setEditing({ id: c.id, name: c.name })} title="Rename collection" />
                    <IconButton glyph="✕" tone="danger" size={26} onClick={() => removeCol(c)} title="Delete collection" />
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
                        <IconButton glyph="✕" tone="danger" size={20} onClick={async () => { await toggleCollectionItem(c.id, it.target_type, it.target_id); setItems({ ...items, [c.id]: await collectionItems(c.id) }); load(); }} title="Remove from collection" />
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AzList({ entries, onOpen }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  let cur = '';
  const rows = [];
  entries.forEach((it, i) => {
    const L = it.name.charAt(0).toUpperCase();
    if (L !== cur) {
      cur = L;
      rows.push(
        <div key={'div-' + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0 8px' }}>
          <span style={{ font: "600 13px/1 var(--f-display)", color: 'var(--gold)' }}>{L}</span>
          <span style={{ flex: 1, height: 1, background: 'var(--hair-12)' }} />
        </div>
      );
    }
    const hasSubs = it.kind === 'rule' && it.subs?.length > 0;
    const isOpen = expanded.has(it.id);
    rows.push(
      <ListRow
        key={it.kind + it.id}
        icon={<CodexGlyph kind={it.kind} />}
        title={it.name}
        sub={it.meta}
        note={it.hasNote}
        trailing={hasSubs
          ? <button className="cx-sub-chevron" data-open={isOpen ? 'true' : 'false'} onClick={(e) => { e.stopPropagation(); toggle(it.id); }} aria-label="Toggle sub-entries">⌄</button>
          : (it.saved ? <span style={{ color: 'var(--gold-leaf)' }}>★</span> : undefined)}
        onClick={() => onOpen(it.kind, it.id, it.name)}
      />
    );
    if (hasSubs && isOpen) {
      it.subs.forEach((s) => rows.push(
        <div key={'sub-' + s.id} style={{ paddingLeft: 26 }}>
          <ListRow icon={<CodexGlyph kind="rule" />} title={s.name} onClick={() => onOpen('rule', s.id, s.name)} />
        </div>
      ));
    }
  });
  return <div>{rows}</div>;
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
