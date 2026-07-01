// Arcanum bottom sheet — the standard sheet across the app (grimoire is kept
// only for article pages). Scrim + amethyst panel + handle, optional Cinzel
// title/close header and footer. CSS: arcanum.css (.a-sheet*). Pixel-ported
// from Arcanum's #card-sheet / canonical .sheet.
import React from 'react';
import '../theme/arcanum.css';

export default function Sheet({ open, title, onClose, footer, children }) {
  if (!open) return null;
  return (
    <>
      <div className="arc a-sheet-scrim" onClick={onClose} />
      <div className="arc a-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="a-sheet-handle" />
        {title != null && (
          <div className="a-sheet-header">
            <div className="a-sheet-title">{title}</div>
            <button className="a-sheet-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
        )}
        <div className="a-sheet-body">{children}</div>
        {footer && <div className="a-sheet-footer" style={{ display: 'flex', gap: 8, padding: '12px 16px 0', flexShrink: 0 }}>{footer}</div>}
      </div>
    </>
  );
}
