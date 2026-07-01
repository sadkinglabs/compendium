// Codex browse — scope chips (Rules · Cards · All), List ⇄ Card toggle (cards),
// A–Z divided list with note-indicator dots, and a 2-up card grid.
import React, { useEffect, useState } from 'react';
import { getCodexEntries } from '../store/codexRepository.js';
import { thresholdRuns } from '../store/cardArt.js';
import { Chip, ChipRow, ListRow, ThresholdPips, BottomSheet } from '../components/ui.jsx';
import CardArt from '../components/CardArt.jsx';
import Fab, { FabGlyph } from '../components/Fab.jsx';

const SCOPES = [['rules', 'Rules'], ['cards', 'Cards'], ['all', 'All']];
const FILTERS = [['fav', 'Saved only'], ['notes', 'Has notes'], ['faq', 'Has FAQ'], ['errata', 'Errata']];

export default function Codex({ scope, setScope, codexView, setCodexView, onOpen, rev }) {
  const [entries, setEntries] = useState(null);
  const [filters, setFilters] = useState({});
  const [filterSheet, setFilterSheet] = useState(false);
  const filterCount = Object.values(filters).filter(Boolean).length;

  useEffect(() => {
    let alive = true;
    getCodexEntries(scope, filters).then((e) => alive && setEntries(e));
    return () => { alive = false; };
  }, [scope, rev, filters]);

  const showViewToggle = scope === 'cards';
  const isGrid = scope === 'cards' && codexView === 'grid';

  return (
    <div style={{ padding: '6px 20px 26px', animation: 'cxfade .2s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 8 }}>
        <ChipRow>
          {SCOPES.map(([k, label]) => (
            <Chip key={k} label={label} active={scope === k} onClick={() => setScope(k)} />
          ))}
        </ChipRow>
        {showViewToggle && (
          <ChipRow>
            <Chip label="List" active={codexView !== 'grid'} onClick={() => setCodexView('list')} />
            <Chip label="Card" active={codexView === 'grid'} onClick={() => setCodexView('grid')} />
          </ChipRow>
        )}
      </div>

      <BottomSheet open={filterSheet} title="FILTERS" onClose={() => setFilterSheet(false)}>
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
      </BottomSheet>

      {entries == null ? (
        <Skeleton />
      ) : entries.length === 0 ? (
        <div style={{ padding: '50px 20px', textAlign: 'center', font: "400 15px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>Nothing matches these filters.</div>
      ) : isGrid ? (
        <CardGrid entries={entries} onOpen={onOpen} />
      ) : (
        <AzList entries={entries} onOpen={onOpen} />
      )}

      {/* Codex FAB — opens filters */}
      <Fab variant="deck" icon={<FabGlyph kind="filters" />} label="Filters" onClick={() => setFilterSheet(true)} />
    </div>
  );
}

function AzList({ entries, onOpen }) {
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
    rows.push(
      <ListRow
        key={it.kind + it.id}
        icon={it.kind === 'card' ? '◈' : '§'}
        title={it.name}
        sub={it.meta}
        note={it.hasNote}
        trailing={it.saved ? <span style={{ color: 'var(--gold-leaf)' }}>★</span> : undefined}
        onClick={() => onOpen(it.kind, it.id, it.name)}
      />
    );
  });
  return <div>{rows}</div>;
}

function CardGrid({ entries, onOpen }) {
  const cards = entries.filter((e) => e.kind === 'card');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {cards.map((c) => (
        <div key={c.id} onClick={() => onOpen('card', c.id, c.name)} style={{ cursor: 'pointer', animation: 'cxpop .2s ease' }}>
          <CardArt card={{ name: c.name, image_slug: c.image_slug, elements: c.elements, thresholds: c.thresholds, card_id: c.id }}>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '20px 9px 8px', background: 'linear-gradient(180deg,transparent,rgba(11,7,5,.9))' }}>
              <div style={{ font: "600 12px/1.15 var(--f-read)", color: '#f0e9d8' }}>{c.name}</div>
            </div>
          </CardArt>
        </div>
      ))}
    </div>
  );
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
