// The Collection pillar's bottom-sheet chassis: a gothic panel (30px top radius,
// #181209 -> #0b0806 gradient, gold top hairline, grab handle) with real
// drag-to-dismiss, focus trap, hardware-back, and a scrim. Portaled to the app
// root so its position:fixed escapes the pillar's transformed slide-pane and
// paints above the bottom nav (the same escape hatch the FAB uses). Shared by the
// card detail sheet and the filters sheet so they read as one surface.
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from './useFocusTrap.js';   // leaf module - importing ui.jsx here is a cycle
import { useSheetDrag } from './useSheetDrag.js';
import { registerBackConsumer } from '../back.js';

// `dismissible` (default true) gates every soft exit - backdrop tap, drag-to-dismiss, and hardware
// back. A sheet in the middle of a committed transaction (the wishlist import mid-write) sets it
// false so a gesture cannot appear to cancel a write that is still going. Hardware back is still
// CONSUMED (returns true) while locked, so it does not fall through and close the app.
export default function GothicSheet({ open, onClose, label = 'Dialog', dismissible = true, ariaBusy, header = null, children }) {
  const trapRef = useFocusTrap(open);
  const NOOP = () => {};
  const drag = useSheetDrag(dismissible ? onClose : NOOP);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const dismissRef = useRef(dismissible); dismissRef.current = dismissible;
  const guardedClose = () => { if (dismissRef.current) closeRef.current?.(); };
  useEffect(() => { if (open) return registerBackConsumer(() => { if (dismissRef.current) closeRef.current?.(); return true; }); }, [open]);
  if (!open) return null;
  const handleProps = dismissible ? drag.handleProps : {};
  const dragStyle = dismissible ? drag.style : {};

  const root = typeof document !== 'undefined' ? (document.querySelector('.cx-app') || document.body) : null;
  // Two DELIBERATELY separate elements (mirrors the working wizard .ob-overlay/
  // .ob-inner and the avatar picker): the OUTER is the position:fixed scrim +
  // flex column, animated with cxfade (OPACITY only). The INNER panel is
  // position:relative, pinned to the bottom via margin-top:auto, and carries the
  // cxsheet TRANSFORM slide-in, overflow:hidden clip, and the drag transform.
  // Keeping transform-animation + overflow OFF the fixed element is what stops the
  // Android-WebView deferred-paint bug (nested scroller stays blank until scroll)
  // that a single combined element re-introduces (the Refine sheet symptom).
  const tree = (
    <div
      onClick={guardedClose}
      style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 200, animation: 'cxfade .2s ease', display: 'flex', flexDirection: 'column' }}
    >
      <div
        ref={trapRef} role="dialog" aria-modal="true" aria-label={label} aria-busy={ariaBusy || undefined}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', marginTop: 'auto', marginBottom: 'calc(var(--kb,0px) / var(--ui-scale,1))',
          borderRadius: '30px 30px 0 0', borderTop: '1px solid rgba(203,167,95,.35)',
          background: '#100c08',
          boxShadow: '0 -20px 50px -10px rgba(0,0,0,.5)', animation: 'cxsheet .28s cubic-bezier(.2,.9,.3,1)',
          maxHeight: 'min(88dvh, calc(100dvh - env(safe-area-inset-top,0px) - 12px - var(--kb,0px) / var(--ui-scale,1)))',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', willChange: 'transform', ...dragStyle,
        }}
      >
        {/* The scroll body carries its OWN opaque background and its own compositor
            layer (translateZ). On Android WebView a transform-animated ancestor with
            overflow:hidden fails to paint its background under a nested scroller - the
            sheet's lower half went transparent and the page bled through. An opaque,
            self-compositing scroller can't depend on the ancestor's paint, so it's
            always solid. */}
        {/* Optional PINNED header (opt-in; owner ask via Deck Spread): the handle +
            header stay as fixed chrome above the scroller, so a sheet's title is
            respected as its header while in-body sticky sections anchor below it.
            Without `header`, the handle lives in the scroller exactly as before. */}
        {header != null && (
          <div {...handleProps} style={{ ...handleProps.style, flex: 'none', padding: '4px 0 0', background: '#100c08' }}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '0 0 10px' }}>
              <div style={{ width: 46, height: 5, borderRadius: 3, background: '#5a4a28' }} />
            </div>
            {header}
          </div>
        )}
        <div className="cx-scroll" style={{ flex: '0 1 auto', minHeight: 0, overflowY: 'auto', padding: '14px 26px calc(26px + env(safe-area-inset-bottom,0px))', background: '#100c08', transform: 'translateZ(0)', WebkitOverflowScrolling: 'touch' }}>
          {header == null && (
            /* Drag the top chrome (handle) to dismiss; the body still scrolls. */
            <div {...handleProps} style={{ ...handleProps.style, padding: '4px 0 10px', margin: '0 -26px', display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 46, height: 5, borderRadius: 3, background: '#5a4a28' }} />
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
  return root ? createPortal(tree, root) : tree;
}
