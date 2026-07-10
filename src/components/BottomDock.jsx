// THE bottom dock: one fixed, keyboard-aware container that holds a page's search
// pill (left) and its context FAB (right) as a SINGLE unit, so they share one
// bottom calc and rise together when the keyboard opens (the old bug: the search
// bar included var(--kb) but the FAB didn't, so they split apart while typing).
// Mounted once by the app shell; SearchPill and Fab portal their content into the
// two slots below. A page with only a FAB (no search) still uses it - the empty
// search slot just pushes the FAB to the right. Positioning lives entirely in
// .cx-dock (tokens.css); nothing here or in consumers hand-rolls a bottom offset.
import React from 'react';

export default function BottomDock() {
  return (
    <div className="cx-dock">
      <div className="cx-dock-search" id="cx-dock-search" />
      <div className="cx-dock-fab" id="cx-dock-fab" />
    </div>
  );
}
