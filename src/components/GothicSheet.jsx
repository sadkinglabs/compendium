// The app-wide bottom-sheet chassis, now driven by VAUL.
//
// WHY THE ENGINE CHANGED (2026-08-16): the hand-rolled engine in sheetMotion.js
// went three review-and-device rounds - gesture origin, scroll handoff, velocity,
// the asymptotic close - and each round fixed a real defect and surfaced another.
// vaul solves the same list, has enormous mileage on exactly our target (mobile
// WebViews; it is what shadcn's Drawer is built on), and is maintained by someone
// whose whole job is that this feels right. We keep the CHASSIS - the Manuscript
// chrome, the pinned header/footer, `dismissible`, hardware back, the WebView paint
// contract - and let vaul own motion and gestures only.
//
// The PUBLIC API IS UNCHANGED, so all 37 call sites are untouched by this swap.
//
// WHAT WE STILL OWN, AND WHY:
//  - PORTAL TARGET `.cx-app`: our position:fixed must escape the pillar's
//    transformed slide-pane, so vaul's portal is pointed at the same root the old
//    chassis used, not document.body.
//  - THE OPAQUE SELF-COMPOSITING SCROLLER: on Android WebView a transform-animated
//    ancestor with overflow:hidden fails to paint its background under a nested
//    scroller, and the sheet's lower half goes transparent. The scroll body keeps
//    its own opaque ground + translateZ(0). This is the one rule most likely to
//    bite a library swap, so it is applied explicitly rather than assumed.
//  - HARDWARE BACK: Android's back button is not Escape; it routes through the
//    app's LIFO consumer stack (back.js) exactly as before. A locked sheet still
//    CONSUMES back so the app cannot navigate or exit underneath it.
//  - KEYBOARD: `repositionInputs={false}` - vaul's own keyboard handling is turned
//    OFF in favour of the device-proven `--kb` / visualViewport mechanism
//    (windowSoftInputMode=adjustNothing + appearance.js). Two systems moving the
//    same sheet would fight.
//  - NO BACKGROUND SCALING: vaul can recede the page behind the sheet; that would
//    transform the app root the sheet deliberately portals out of. Left off.
import React, { useEffect, useRef } from 'react';
import { Drawer } from 'vaul';
import { registerBackConsumer } from '../back.js';

export default function GothicSheet({ open, onClose, label = 'Sheet', dismissible = true, ariaBusy, header = null, footer = null, onSettled, onExited, children }) {
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const dismissRef = useRef(dismissible); dismissRef.current = dismissible;
  const settledRef = useRef(onSettled); settledRef.current = onSettled;
  const exitedRef = useRef(onExited); exitedRef.current = onExited;

  // Hardware back, for the sheet's whole open life. Registered even when locked so
  // back is swallowed rather than falling through to the layer beneath.
  useEffect(() => {
    if (!open) return undefined;
    return registerBackConsumer(() => { if (dismissRef.current) closeRef.current?.(); return true; });
  }, [open]);

  const root = typeof document !== 'undefined' ? (document.querySelector('.cx-app') || document.body) : null;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => { if (!o) closeRef.current?.(); }}
      dismissible={dismissible}
      repositionInputs={false}
      onAnimationEnd={(isOpen) => { if (isOpen) settledRef.current?.(); else exitedRef.current?.(); }}
    >
      <Drawer.Portal container={root}>
        <Drawer.Overlay
          className="cx-sheet-layer"
          style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 200 }}
        />
        <Drawer.Content
          aria-busy={ariaBusy || undefined}
          className="cx-sheet-panel"
          style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 201,
            marginBottom: 'calc(var(--kb,0px) / var(--ui-scale,1))',
            borderRadius: 'var(--radius-sheet, 30px) var(--radius-sheet, 30px) 0 0',
            borderTop: '1px solid rgba(203,167,95,.35)',
            background: 'var(--surface-sheet, #100c08)',
            boxShadow: 'var(--shadow-sheet)',
            maxHeight: 'min(88dvh, calc(100dvh - env(safe-area-inset-top,0px) - 12px - var(--kb,0px) / var(--ui-scale,1)))',
            display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none',
          }}
        >
          {/* Radix requires a dialog title for the accessible name. Ours is visually
              hidden because the Manuscript chassis shows its own header treatment. */}
          <Drawer.Title style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{label}</Drawer.Title>

          {/* Handle: vaul's own grab affordance, restyled to the M3 32x4 in Manuscript
              gold. It is also the drag surface vaul listens on. */}
          {dismissible && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 8px', flex: 'none' }}>
              <Drawer.Handle style={{ width: 32, height: 4, borderRadius: 2, background: 'var(--gold-handle, #5a4a28)' }} />
            </div>
          )}
          {!dismissible && <div style={{ height: 14, flex: 'none' }} />}

          {header != null && (
            <div style={{ flex: 'none', background: 'var(--surface-sheet, #100c08)' }}>{header}</div>
          )}

          {/* See the paint note in the header comment: opaque ground + its own layer. */}
          <div
            className="cx-scroll"
            style={{ flex: '0 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '14px 26px calc(26px + env(safe-area-inset-bottom,0px))', background: 'var(--surface-sheet, #100c08)', transform: 'translateZ(0)', WebkitOverflowScrolling: 'touch' }}
          >
            {children}
          </div>

          {footer != null && (
            <div style={{ flex: 'none', background: 'var(--surface-sheet, #100c08)', paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>{footer}</div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
