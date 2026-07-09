// Arcanum bottom sheet - the standard sheet across the app (grimoire is kept
// only for article pages). Scrim + amethyst panel + handle, optional Cinzel
// title/close header and footer. CSS: arcanum.css (.a-sheet*). Pixel-ported
// from Arcanum's #card-sheet / canonical .sheet.
import React, { useEffect, useRef } from 'react';
import { useFocusTrap } from './ui.jsx';
import { useSheetDrag } from './useSheetDrag.js';
import { registerBackConsumer } from '../back.js';
import '../theme/arcanum.css';

export default function Sheet({ open, title, onClose, footer, children }) {
  const trapRef = useFocusTrap(open);
  const { handleProps, style } = useSheetDrag(onClose);
  // Hardware BACK closes the sheet (topmost-first) instead of navigating behind it.
  // Register ONCE per open (via a ref for onClose) so re-renders don't churn the
  // LIFO registry order - otherwise a re-rendering sheet under another would jump on top.
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { if (open) return registerBackConsumer(() => { closeRef.current?.(); return true; }); }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="arc a-sheet-scrim" onClick={onClose} />
      <div ref={trapRef} role="dialog" aria-modal="true" aria-label={title || 'Sheet'} className="arc a-sheet" style={style} onClick={(e) => e.stopPropagation()}>
        {/* Drag down anywhere on the top chrome (handle + header) to dismiss; the
            body still scrolls. The close button opts out so a tap never drags. */}
        <div className="a-sheet-grab" {...handleProps}><div className="a-sheet-handle" /></div>
        {title != null && (
          <div className="a-sheet-header" {...handleProps}>
            <div className="a-sheet-title">{title}</div>
            <button className="a-sheet-close" onClick={onClose} onPointerDown={(e) => e.stopPropagation()} aria-label="Close">✕</button>
          </div>
        )}
        <div className="a-sheet-body">{children}</div>
        {footer && <div className="a-sheet-footer" style={{ display: 'flex', gap: 8, padding: '12px 16px 0', flexShrink: 0 }}>{footer}</div>}
      </div>
    </>
  );
}
