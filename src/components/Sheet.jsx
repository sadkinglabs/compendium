// Titled bottom sheet - a thin adapter over the canonical GothicSheet chassis
// (portal, drag-to-dismiss, gold top hairline, grab handle, focus trap,
// hardware-back). Renders an optional centered Cinzel title and a footer row.
// (Was the legacy Arcanum .a-sheet with a left title + ✕-glyph close; the chassis
// now dismisses via scrim / drag / back, so no close button is needed.)
import React from 'react';
import GothicSheet from './GothicSheet.jsx';

// `bodyClass` scopes the sheet's content under a class (used to restore `.arc`
// for sheets whose styles are Arcanum-scoped: GothicSheet portals into `.cx-app`,
// which has no `.arc` ancestor, so `.arc .es-*`/`.ds-*` rules would otherwise
// not match and the content paints unstyled).
export default function Sheet({ open, title, onClose, footer, children, bodyClass }) {
  const inner = (
    <>
      {title != null && (
        <div style={{ font: "600 13px/1 var(--f-display)", letterSpacing: '.14em', color: 'var(--gold-leaf)', textAlign: 'center', margin: '0 0 16px' }}>{title}</div>
      )}
      {children}
      {footer && <div style={{ display: 'flex', gap: 8, padding: '12px 0 0', flexShrink: 0 }}>{footer}</div>}
    </>
  );
  return (
    <GothicSheet open={open} onClose={onClose} label={title || 'Sheet'}>
      {bodyClass ? <div className={bodyClass}>{inner}</div> : inner}
    </GothicSheet>
  );
}
