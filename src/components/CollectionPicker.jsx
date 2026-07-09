// The collection picker - add/remove an entry to named collections, or create a
// new one. Its own component (matching the app's per-component file layout);
// opened from CodexDetail's "Collect" FAB.
import React, { useState, useEffect } from 'react';
import { collectionsForTarget, toggleCollectionItem, createCollection } from '../store/codexRepository.js';
import { BottomSheet, BTN_GOLD } from './ui.jsx';

export default function CollectionPicker({ open, targetType, targetId, onClose }) {
  const [cols, setCols] = useState([]);
  const [name, setName] = useState('');
  async function refresh() { if (open && targetId) setCols(await collectionsForTarget(targetId)); }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [open, targetId]);
  async function create() {
    if (!name.trim()) return;
    const cid = await createCollection(name.trim());
    await toggleCollectionItem(cid, targetType, targetId);
    setName(''); refresh();
  }
  return (
    <BottomSheet open={open} title="ADD TO COLLECTION" onClose={onClose}>
      {cols.length === 0 && <div style={{ font: "400 13.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', textAlign: 'center', marginBottom: 12 }}>No collections yet - name one below.</div>}
      {cols.map((c) => (
        <div key={c.id} onClick={async () => { await toggleCollectionItem(c.id, targetType, targetId); refresh(); }}
          className="cx-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer' }}>
          <span style={{ font: "600 15px/1 var(--f-read)", color: 'var(--ink-body)' }}>{c.name}</span>
          <span style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid var(--hair-40)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a1410', background: c.inIt ? 'var(--gold-leaf)' : 'transparent', fontSize: 13 }}>{c.inIt ? '✓' : ''}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection…"
          style={{ flex: 1, height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)" }} />
        <button onClick={create} style={BTN_GOLD}>Add</button>
      </div>
    </BottomSheet>
  );
}
