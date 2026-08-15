// Global context FAB - the app's interaction spine, implemented for Deckbuilder.
// Lives on every page; its icon + menu mutate by context. visual
// shell (.fab-wrap / .fab / .fab-menu / .fab-scrim in decks.css); the open
// morph is driven by the `variant` class (lib → +↦×, deck → ⋮ tilts 90°).
//
// Props:
//   variant : 'lib' | 'deck'         - which open-rotation morph to use
//   icon    : node                    - glyph/svg inside the button (default +)
//   label   : aria-label
//   items   : [{ label, onClick, danger?, state?, icon? }]  - menu entries
//   onClick : if given (and no items), the FAB is a plain action button
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import '../theme/decks.css';   // the FAB's own shell - see the note on `cx-decks` below
import { haptic } from '../native.js';
import { registerBackConsumer } from '../back.js';
import { GLYPH_ICON } from './icons.jsx';

// The Deckbuilder styling scope. It rides the FAB on EVERY pillar, not just Decks:
// the shell (.fab-wrap / .fab / .fab-menu / .fab-scrim) is defined in decks.css and
// the FAB is the app's interaction spine, so Home, Codex, Collection and Play all
// carry it too. Two rules, both load-bearing:
//   1. It must sit on the SAME element as fab-wrap, not a parent. decks.css targets
//      `.cx-decks.fab-wrap .fab` (0,3,0) deliberately, because counter.css leaks a
//      global `.fab-wrap .fab` (0,2,0) that loads later and would otherwise win.
//      Hoisting the scope to a wrapper drops it to (0,2,0) and the FAB turns green.
//   2. It must stay spelled `cx-decks`. The old `.arc` spelling matches nothing
//      since decks.css was renamed, so getting this wrong fails silently and the
//      controls fall back to UA defaults - white squares. Guarded by
//      src/pillars/cssScope.test.mjs.
const SCOPE = 'cx-decks';

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
  if (kind === 'import') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 21, height: 21 }}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="14 3 14 9 20 9" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" />
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

export default function Fab({ variant = 'lib', icon = <FabGlyph kind="add" />, label = 'Actions', items = null, onClick = null, active = false, badge = 0, className = '' }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);

  // Back/Escape closes an open menu first (matches Deckbuilder's closeFabs routing).
  // Escape hands focus back to the FAB (the menu-button contract, same as
  // OverflowMenu); hardware BACK is a navigation gesture and does not grab focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus?.({ preventScroll: true }); } };
    window.addEventListener('keydown', onKey);
    // Hardware BACK closes the open menu FIRST (it's the topmost layer).
    const unreg = registerBackConsumer(() => { setOpen(false); return true; });
    return () => { window.removeEventListener('keydown', onKey); unreg(); };
  }, [open]);

  // Focus lands on the first item when the menu opens - the same keyboard model
  // OverflowMenu carries, so the app's two menus share one a11y contract. The menu
  // stays mounted for its CSS transition, so it is aria-hidden while closed.
  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => itemRefs.current[0]?.focus?.({ preventScroll: true }), 0);
    return () => clearTimeout(id);
  }, [open]);
  const onItemKey = (e, i, n) => {
    const to = (j) => { e.preventDefault(); itemRefs.current[(j + n) % n]?.focus?.({ preventScroll: true }); };
    if (e.key === 'ArrowDown') to(i + 1);
    else if (e.key === 'ArrowUp') to(i - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(n - 1);
  };

  // Rendered through a portal into the unified BottomDock's FAB slot (#cx-dock-fab),
  // so the FAB shares ONE keyboard-aware container with the search pill and the two
  // never diverge. The wrapper is position:relative inside that slot (see
  // decks.css). Retry after mount if the dock committed after us; render nothing
  // until the slot exists (the dock is always mounted by the app shell). NOT
  // .cx-app - a relative wrapper there would land at the top of the page.
  const [slot, setSlot] = useState(() => (typeof document !== 'undefined' ? document.getElementById('cx-dock-fab') : null));
  useEffect(() => { if (!slot) setSlot(document.getElementById('cx-dock-fab')); });
  const portal = (node) => (slot ? createPortal(node, slot) : null);

  // Plain action FAB (no menu) - e.g. add-a-widget / a search trigger. Gets the
  // same shell + variant as the menu FABs: it spins in on mount (fab-enter) and,
  // when `active`, morphs via the variant open-rotation (+ ↦ ×) like the others.
  if (!items) {
    return portal(
      <div className={`${SCOPE} fab-wrap fab-enter fab-${variant}${active ? ' open' : ''}${className ? ' ' + className : ''}`}>
        <button className="fab" onClick={onClick} aria-label={label} aria-pressed={active}>{icon}</button>
        {badge > 0 && <span className="fab-badge">{badge}</span>}
      </div>
    );
  }

  // Most items close the menu on tap; toggles (keepOpen) leave it open so their
  // live state (✓/✕, ★/☆) stays visible - matches Deckbuilder's rarity/star toggles.
  const run = (it) => { haptic('light'); if (!it.keepOpen) setOpen(false); it.onClick?.(); };

  return portal(
    <>
      <div className={`${SCOPE} fab-scrim${open ? ' show' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <div className={`${SCOPE} fab-wrap fab-enter fab-${variant}${open ? ' open' : ''}${className ? ' ' + className : ''}`}>
        <div className="fab-menu" role="menu" aria-hidden={!open}>
          {items.map((it, i) => (
            <button key={i} role="menuitem" className={it.prominent ? 'prominent' : undefined}
              ref={(el) => { itemRefs.current[i] = el; }} tabIndex={open ? 0 : -1}
              onKeyDown={(e) => onItemKey(e, i, items.length)}
              onClick={() => run(it)} style={it.danger ? { color: 'var(--destructive)' } : undefined}>
              {it.icon}
              <span>{it.label}</span>
              {it.state != null && <span className="fab-state">{GLYPH_ICON[it.state] ? React.createElement(GLYPH_ICON[it.state]) : it.state}</span>}
            </button>
          ))}
        </div>
        <button ref={triggerRef} className="fab" onClick={() => { haptic('light'); setOpen((o) => !o); }} aria-haspopup="menu" aria-expanded={open} aria-label={label}>{icon}</button>
      </div>
    </>
  );
}
