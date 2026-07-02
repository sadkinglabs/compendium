// Global context FAB — the app's interaction spine, ported from Arcanum.
// Lives on every page; its icon + menu mutate by context. Verbatim visual
// shell (.fab-wrap / .fab / .fab-menu / .fab-scrim in arcanum.css); the open
// morph is driven by the `variant` class (lib → +↦×, deck → ⋮ tilts 90°).
//
// Props:
//   variant : 'lib' | 'deck'         — which open-rotation morph to use
//   icon    : node                    — glyph/svg inside the button (default +)
//   label   : aria-label
//   items   : [{ label, onClick, danger?, state?, icon? }]  — menu entries
//   onClick : if given (and no items), the FAB is a plain action button
import React, { useState, useEffect } from 'react';

// FAB glyphs — three vertical dots (menus) · filter sliders (filters/sort).
export function FabGlyph({ kind }) {
  if (kind === 'dots') return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 22, height: 22 }}>
      <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 21, height: 21 }}>
      <line x1="21" x2="14" y1="4" y2="4" /><line x1="10" x2="3" y1="4" y2="4" />
      <line x1="21" x2="12" y1="12" y2="12" /><line x1="8" x2="3" y1="12" y2="12" />
      <line x1="21" x2="16" y1="20" y2="20" /><line x1="12" x2="3" y1="20" y2="20" />
      <line x1="14" x2="14" y1="2" y2="6" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="16" x2="16" y1="18" y2="22" />
    </svg>
  );
}

export default function Fab({ variant = 'lib', icon = '+', label = 'Actions', items = null, onClick = null, badge = 0 }) {
  const [open, setOpen] = useState(false);

  // Back/Escape closes an open menu first (matches Arcanum's closeFabs routing).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Plain action FAB (no menu) — e.g. a search/filter trigger.
  if (!items) {
    return (
      <div className="arc fab-wrap">
        <button className="fab" onClick={onClick} aria-label={label}>{icon}</button>
        {badge > 0 && <span className="fab-badge">{badge}</span>}
      </div>
    );
  }

  // Most items close the menu on tap; toggles (keepOpen) leave it open so their
  // live state (✓/✕, ★/☆) stays visible — matches Arcanum's rarity/star toggles.
  const run = (it) => { if (!it.keepOpen) setOpen(false); it.onClick?.(); };

  return (
    <>
      <div className={`arc fab-scrim${open ? ' show' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <div className={`arc fab-wrap fab-${variant}${open ? ' open' : ''}`}>
        <div className="fab-menu" role="menu">
          {items.map((it, i) => (
            <button key={i} role="menuitem" className={it.prominent ? 'prominent' : undefined}
              onClick={() => run(it)} style={it.danger ? { color: 'var(--danger)' } : undefined}>
              {it.icon}
              <span>{it.label}</span>
              {it.state != null && <span className="fab-state">{it.state}</span>}
            </button>
          ))}
        </div>
        <button className="fab" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={label}>{icon}</button>
      </div>
    </>
  );
}
