// THE one search bar. Every search input renders this chassis - the frosted
// glass pill, magnifier, the shared input idioms (enterKeyHint, autoComplete-off,
// Enter-to-blur), a 44px clear button that KEEPS focus (Material search: clearing
// starts a new query, it does not end the session), and an optional syntax-help
// button. Two mounts:
//   docked (default) - portals into the BottomDock's search slot, so it shares the
//     dock's single keyboard-aware position with the FAB.
//   inline - renders in place at 48px for in-sheet / in-panel search (add-cards,
//     marginalia link, deck picker, avatar search). Same chassis, no portal.
// Owners keep their own value/onChange AND their own query scheduling - the
// chassis never debounces (Codex-reviewed contract: presentation only; cheap
// in-memory filters stay immediate, expensive work debounces at the owner).
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function SearchPill({ value, onChange, onClear, placeholder = 'Search…', ariaLabel, onHelp, inline = false, autoFocus = false }) {
  const inputRef = useRef(null);
  // Resolve the dock slot (docked mount only); retry after mount if the dock
  // committed after us.
  const [slot, setSlot] = useState(() => (typeof document !== 'undefined' ? document.getElementById('cx-dock-search') : null));
  useEffect(() => { if (!inline && !slot) setSlot(document.getElementById('cx-dock-search')); });

  const clear = () => {
    if (onClear) onClear(); else onChange('');
    inputRef.current?.focus({ preventScroll: true });
  };

  const pill = (
    <div className={`cx-search-pill${inline ? ' cx-search-pill--inline' : ''}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel || placeholder}
        autoComplete="off" autoCapitalize="off" spellCheck="false" enterKeyHint="search" autoFocus={autoFocus}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      {value ? (
        <button className="cx-search-clear" onClick={clear} aria-label="Clear search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      ) : null}
      {onHelp ? (
        <button onClick={onHelp} aria-label="Search syntax help" className="cx-hit44 cx-press"
          style={{ flex: 'none', width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--hair-30)', background: 'transparent', color: 'rgba(220,184,111,.55)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M9.2 9a3 3 0 1 1 4.3 2.7c-.9.5-1.5 1.2-1.5 2.3" /><line x1="12" y1="17.5" x2="12" y2="17.51" /></svg>
        </button>
      ) : null}
    </div>
  );

  if (inline) return pill;
  if (!slot) return null;
  return createPortal(pill, slot);
}
