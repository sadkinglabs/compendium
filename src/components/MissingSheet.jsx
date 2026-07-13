// The missing cards for a deck (or, later, a wanted list) as a shopping list plus
// actions. Fed by an engine Report - the generation is a pure formatter, so decks
// and lists share ONE surface. Reused across the app; takes any compareEngine report.
import React, { useState, useEffect } from 'react';
import { BottomSheet, BTN_GOLD, BTN_GHOST } from './ui.jsx';
import { missingLines, formatMissingText } from '../store/compareEngine.js';
import { addMissingToWishlist, cardNames } from '../store/ownedRepository.js';
import { toast } from '../feedback.js';

export default function MissingSheet({ open, report, title, onOpenCard, onClose, onChanged }) {
  const [names, setNames] = useState(new Map());
  const missing = report ? missingLines(report) : [];
  useEffect(() => {
    if (open && report) cardNames(missing.map((l) => l.card_id)).then(setNames);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report]);
  if (!report) return null;
  const text = () => formatMissingText(report, names, title);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text()); toast(`Copied ${missing.length} card${missing.length === 1 ? '' : 's'}`); }
    catch { toast('Copy failed', { tone: 'danger' }); }
  };
  const wish = async () => {
    const n = await addMissingToWishlist(missing);
    toast(`Added ${n} card${n === 1 ? '' : 's'} to your Wishlist`);
    onChanged?.();
    onClose();
  };
  const totalMissing = missing.reduce((s, l) => s + l.missing, 0);
  return (
    <BottomSheet open={open} title="MISSING CARDS" onClose={onClose}>
      {title && <div style={{ font: "600 14px/1.3 var(--f-read)", color: 'var(--gold-leaf)', textAlign: 'center', marginBottom: 3 }}>{title}</div>}
      <div style={{ font: "400 12.5px/1.4 var(--f-ui)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 14 }}>
        {missing.length === 0 ? 'You own every card here.' : `${totalMissing} card${totalMissing === 1 ? '' : 's'} across ${missing.length} name${missing.length === 1 ? '' : 's'}`}
      </div>
      {missing.map((l) => (
        <div key={l.card_id} onClick={() => onOpenCard?.(l.card_id)} className="cx-row"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 4px', borderBottom: '1px solid var(--hair-12)', cursor: onOpenCard ? 'pointer' : 'default' }}>
          <span style={{ minWidth: 0, font: "500 15px/1.2 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ color: 'var(--accent-ruby)', font: "600 13px/1 var(--f-mono)", marginRight: 8 }}>{l.missing}×</span>{names.get(l.card_id) || l.card_id}
          </span>
          <span style={{ flex: 'none', font: "600 11px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>own {l.owned}/{l.required}</span>
        </div>
      ))}
      {missing.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          <button onClick={wish} style={{ ...BTN_GOLD, flex: '1 1 100%', justifyContent: 'center' }}>Add all to Wishlist</button>
          <button onClick={copy} style={{ ...BTN_GHOST, flex: '1 1 100%', justifyContent: 'center' }}>Copy list</button>
        </div>
      )}
    </BottomSheet>
  );
}
