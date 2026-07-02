// Codex browse — scope chips (Rules · Cards · All) and an A–Z divided list with
// note-indicator dots. List-only (no Card view — that's what sets it apart from
// the deckbuilder).
import React, { useEffect, useState } from 'react';
import { getCodexEntries } from '../store/codexRepository.js';
import { Chip, ChipRow, ListRow } from '../components/ui.jsx';
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

export default function Codex({ scope, setScope, onOpen, rev }) {
  const [entries, setEntries] = useState(null);
  const [filters, setFilters] = useState({});
  const [filterSheet, setFilterSheet] = useState(false);

  useEffect(() => {
    let alive = true;
    getCodexEntries(scope, filters).then((e) => alive && setEntries(e));
    return () => { alive = false; };
  }, [scope, rev, filters]);

  return (
    <div style={{ padding: '6px 20px 26px', animation: 'cxfade .2s ease' }}>
      {/* Scope (Rules/Cards/All) — sticky so it stays visible while scrolling. */}
      <div className="cx-codex-topbar">
        <ChipRow>
          {SCOPES.map(([k, label]) => (
            <Chip key={k} label={label} active={scope === k} onClick={() => setScope(k)} />
          ))}
        </ChipRow>
      </div>

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

      {/* Codex FAB — opens filters */}
      <Fab variant="deck" icon={<FabGlyph kind="filters" />} label="Filters" onClick={() => setFilterSheet(true)} />
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
