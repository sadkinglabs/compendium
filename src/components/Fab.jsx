// Global context FAB - the app's interaction spine, ported from Arcanum.
// Lives on every page; its icon + menu mutate by context. Verbatim visual
// shell (.fab-wrap / .fab / .fab-menu / .fab-scrim in arcanum.css); the open
// morph is driven by the `variant` class (lib → +↦×, deck → ⋮ tilts 90°).
//
// Props:
//   variant : 'lib' | 'deck'         - which open-rotation morph to use
//   icon    : node                    - glyph/svg inside the button (default +)
//   label   : aria-label
//   items   : [{ label, onClick, danger?, state?, icon? }]  - menu entries
//   onClick : if given (and no items), the FAB is a plain action button
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { haptic } from '../native.js';
import { registerBackConsumer } from '../back.js';

// FAB glyphs - three vertical dots (menus) · magnifying glass (search) ·
// filter sliders (filters/sort).
export function FabGlyph({ kind }) {
  if (kind === 'dots') return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 22, height: 22 }}>
      <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
    </svg>
  );
  if (kind === 'search') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ width: 21, height: 21 }}>
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.3" y2="16.3" />
    </svg>
  );
  if (kind === 'add') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ width: 22, height: 22 }}>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
  if (kind === 'camera') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
      <path d="M4 8h3l1.5-2.2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.2" />
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

export default function Fab({ variant = 'lib', icon = '+', label = 'Actions', items = null, onClick = null, active = false, badge = 0, className = '' }) {
  const [open, setOpen] = useState(false);

  // Back/Escape closes an open menu first (matches Arcanum's closeFabs routing).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    // Hardware BACK closes the open menu FIRST (it's the topmost layer).
    const unreg = registerBackConsumer(() => { setOpen(false); return true; });
    return () => { window.removeEventListener('keydown', onKey); unreg(); };
  }, [open]);

  // Rendered through a portal to the .cx-app root (NOT document.body): the FAB is
  // position:fixed, and a transformed ancestor (Home's sliding swipe-pane) would
  // otherwise become its containing block and make it jump. Portaling to .cx-app
  // lifts it out of the pane while KEEPING it inside the app's stacking context,
  // so full-screen overlays like the life counter (#counter-screen, z-index 100)
  // still cover it - body would let a z-50 FAB paint over the whole app.
  const root = typeof document !== 'undefined' ? (document.querySelector('.cx-app') || document.body) : null;
  const portal = (node) => (root ? createPortal(node, root) : node);

  // Plain action FAB (no menu) - e.g. add-a-widget / a search trigger. Gets the
  // same shell + variant as the menu FABs: it spins in on mount (fab-enter) and,
  // when `active`, morphs via the variant open-rotation (+ ↦ ×) like the others.
  if (!items) {
    return portal(
      <div className={`arc fab-wrap fab-enter fab-${variant}${active ? ' open' : ''}${className ? ' ' + className : ''}`}>
        <button className="fab" onClick={onClick} aria-label={label} aria-pressed={active}>{icon}</button>
        {badge > 0 && <span className="fab-badge">{badge}</span>}
      </div>
    );
  }

  // Most items close the menu on tap; toggles (keepOpen) leave it open so their
  // live state (✓/✕, ★/☆) stays visible - matches Arcanum's rarity/star toggles.
  const run = (it) => { haptic('light'); if (!it.keepOpen) setOpen(false); it.onClick?.(); };

  return portal(
    <>
      <div className={`arc fab-scrim${open ? ' show' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <div className={`arc fab-wrap fab-enter fab-${variant}${open ? ' open' : ''}${className ? ' ' + className : ''}`}>
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
        <button className="fab" onClick={() => { haptic('light'); setOpen((o) => !o); }} aria-haspopup="menu" aria-expanded={open} aria-label={label}>{icon}</button>
      </div>
    </>
  );
}
