// The folio picker - add/remove an entry to named folios, or create a new one.
// Its own component (matching the app's per-component file layout); opened from
// CodexDetail's "Add to Folio" FAB item.
import React, { useState, useEffect } from 'react';
import { foliosForTarget, toggleFolioItem, createFolio } from '../store/codexRepository.js';
import { BottomSheet, BTN_GOLD } from './ui.jsx';
import { CheckIcon } from './icons.jsx';

export default function FolioPicker({ open, targetType, targetId, onClose }) {
  const [folios, setFolios] = useState([]);
  const [name, setName] = useState('');
  async function refresh() { if (open && targetId) setFolios(await foliosForTarget(targetId)); }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [open, targetId]);
  async function create() {
    if (!name.trim()) return;
    const fid = await createFolio(name.trim());
    await toggleFolioItem(fid, targetType, targetId);
    setName(''); refresh();
  }
  return (
    <BottomSheet open={open} title="ADD TO FOLIO" onClose={onClose}>
      {folios.length === 0 && <div style={{ font: "400 13.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', textAlign: 'center', marginBottom: 12 }}>No folios yet - a folio gathers cards and rules into a named reference. Name one below; find your folios under Codex - Marginalia.</div>}
      {folios.map((f) => (
        <div key={f.id} onClick={async () => { await toggleFolioItem(f.id, targetType, targetId); refresh(); }}
          role="button" aria-pressed={!!f.inIt}
          className="cx-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer' }}>
          <span style={{ font: "600 15px/1 var(--f-read)", color: 'var(--ink-body)' }}>{f.name}</span>
          <span style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid var(--hair-40)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a1410', background: f.inIt ? 'var(--gold-leaf)' : 'transparent' }}>{f.inIt ? <CheckIcon width={14} height={14} /> : null}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New folio…" aria-label="New folio name"
          style={{ flex: 1, height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)" }} />
        <button onClick={create} style={BTN_GOLD}>Add</button>
      </div>
    </BottomSheet>
  );
}
