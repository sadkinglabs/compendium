// The Collection pillar's bottom-sheet chassis: a gothic panel (30px top radius,
// #181209 -> #0b0806 gradient, gold top hairline, grab handle) with real
// drag-to-dismiss, focus trap, hardware-back, and a scrim. Portaled to the app
// root so its position:fixed escapes the pillar's transformed slide-pane and
// paints above the bottom nav (the same escape hatch the FAB uses). Shared by the
// card detail sheet and the filters sheet so they read as one surface.
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from './ui.jsx';
import { useSheetDrag } from './useSheetDrag.js';
import { registerBackConsumer } from '../back.js';

export default function GothicSheet({ open, onClose, label = 'Dialog', children }) {
  const trapRef = useFocusTrap(open);
  const { handleProps, style: dragStyle } = useSheetDrag(onClose);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { if (open) return registerBackConsumer(() => { closeRef.current?.(); return true; }); }, [open]);
  if (!open) return null;

  const root = typeof document !== 'undefined' ? (document.querySelector('.cx-app') || document.body) : null;
  const tree = (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 200, animation: 'cxfade .2s ease' }} />
      {/* The slide-in animation lives on the OUTER shell and the scroll on an
          INNER body - deliberately separate elements. Putting `animation:
          transform` AND `overflow:auto` on ONE element leaves the content
          unpainted on Android WebView until a scroll forces a repaint (fine in
          desktop Chrome). This mirrors the wizard/picker sheets, which don't
          have the bug. */}
      <div
        ref={trapRef} role="dialog" aria-modal="true" aria-label={label}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 'calc(var(--kb,0px) / var(--ui-scale,1))', zIndex: 201,
          borderRadius: '30px 30px 0 0', borderTop: '1px solid rgba(203,167,95,.35)',
          background: 'linear-gradient(180deg, #181209 0%, #100c08 42%, #0b0806 100%)',
          boxShadow: '0 -20px 50px -10px rgba(0,0,0,.5)', animation: 'cxsheet .28s cubic-bezier(.2,.9,.3,1)',
          maxHeight: 'min(88dvh, calc(100dvh - env(safe-area-inset-top,0px) - 12px - var(--kb,0px) / var(--ui-scale,1)))',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', ...dragStyle,
        }}
      >
        <div className="cx-scroll" style={{ flex: '0 1 auto', minHeight: 0, overflowY: 'auto', padding: '14px 26px calc(26px + env(safe-area-inset-bottom,0px))' }}>
          {/* Drag the top chrome (handle) to dismiss; the body still scrolls. */}
          <div {...handleProps} style={{ ...handleProps.style, padding: '4px 0 10px', margin: '0 -26px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: 46, height: 5, borderRadius: 3, background: '#5a4a28' }} />
          </div>
          {children}
        </div>
      </div>
    </>
  );
  return root ? createPortal(tree, root) : tree;
}
