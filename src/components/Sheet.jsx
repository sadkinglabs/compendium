// Titled bottom sheet - a thin adapter over the canonical GothicSheet chassis
// (portal, drag-to-dismiss, gold top hairline, grab handle, focus trap,
// hardware-back). Renders an optional centered Cinzel title and a footer row.
// (Was the legacy Arcanum .a-sheet with a left title + ✕-glyph close; the chassis
// now dismisses via scrim / drag / back, so no close button is needed.)
import React from 'react';
import GothicSheet from './GothicSheet.jsx';

export default function Sheet({ open, title, onClose, footer, children }) {
  return (
    <GothicSheet open={open} onClose={onClose} label={title || 'Sheet'}>
      {title != null && (
        <div style={{ font: "600 13px/1 var(--f-display)", letterSpacing: '.14em', color: 'var(--gold-leaf)', textAlign: 'center', margin: '0 0 16px' }}>{title}</div>
      )}
      {children}
      {footer && <div style={{ display: 'flex', gap: 8, padding: '12px 0 0', flexShrink: 0 }}>{footer}</div>}
    </GothicSheet>
  );
}
