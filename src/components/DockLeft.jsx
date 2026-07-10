// Portal any page-specific bottom control into the BottomDock's left slot, so it
// sits in the SAME keyboard-aware container as the FAB and the two always move
// together (the search pill uses its own SearchPill; the Decks List/Stats toggle
// uses this). One or the other occupies the slot per page, never both.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function DockLeft({ children }) {
  const [slot, setSlot] = useState(() => (typeof document !== 'undefined' ? document.getElementById('cx-dock-search') : null));
  useEffect(() => { if (!slot) setSlot(document.getElementById('cx-dock-search')); });
  if (!slot) return null;
  return createPortal(children, slot);
}
