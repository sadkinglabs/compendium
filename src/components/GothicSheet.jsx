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
import React, { useEffect, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import { registerBackConsumer } from '../back.js';

export default function GothicSheet({ open, onClose, label = 'Sheet', dismissible = true, ariaBusy, header = null, footer = null, snapPoints = null, onSettled, onExited, children }) {
  // OPT-IN peek/expand via vaul's own snap points. Controlled state is vaul's documented pattern
  // (its snap example does exactly this); it is reset to the peek stop when the sheet finishes
  // CLOSING (onAnimationEnd below) so every open starts at peek. Entirely inert when a caller
  // passes no snapPoints - no snap prop reaches vaul - so the other sheets on this shared chassis
  // behave exactly as before.
  //
  // VAUL'S GEOMETRY CONTRACT (learned the hard way; the flash/bounce open came from breaking it):
  // snap offsets are computed as `containerHeight - fraction * containerHeight` and applied as a
  // translate to the drawer, which assumes THE DRAWER IS CONTAINER-HEIGHT. In snap mode the panel
  // therefore gets height:100% instead of the intrinsic-height + 88dvh cap, and a fraction means
  // exactly "this share of the viewport is visible". `fadeFromIndex: 0` keeps the scrim on at
  // every stop - vaul's default only fades it in at the LAST stop, which both flashed on open and
  // left the peeked sheet scrimless, unlike every other sheet on the chassis.
  // (At --ui-scale != 1 the .cx-app zoom skews vaul's window-based px math slightly; the chassis
  // already accepts that class of approximation - see railGeometry.js.)
  const [snap, setSnap] = useState(snapPoints ? snapPoints[0] : undefined);
  const snapProps = snapPoints ? { snapPoints, activeSnapPoint: snap, setActiveSnapPoint: setSnap, fadeFromIndex: 0 } : {};
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
  // In snap mode the drawer is container-height but the top stop shows only `topSnap` of it, so a
  // strip of `(1 - topSnap)` of the viewport hangs permanently below the fold. The scroller pads by
  // exactly that strip - derived from the snap, not a magic number - so the last content (the card
  // sheet's Wishlist / Add to list) lands the same 26px above the gesture bar as on a normal sheet.
  const topSnap = snapPoints ? snapPoints[snapPoints.length - 1] : null;
  const hiddenStrip = snapPoints ? `${((1 - topSnap) * 100).toFixed(2)}dvh` : '0px';
  const peeked = snapPoints && snap !== snapPoints[snapPoints.length - 1];

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => { if (!o) closeRef.current?.(); }}
      dismissible={dismissible}
      repositionInputs={false}
      // Close-time snap reset so every open starts at peek. Unconditional: if the caller's
      // snapPoints prop is transiently null at close time (the card sheet nulls it in picking
      // mode), clearing to undefined lets vaul's own default (the first stop) take over on reopen.
      onAnimationEnd={(isOpen) => { if (isOpen) settledRef.current?.(); else { exitedRef.current?.(); setSnap(snapPoints ? snapPoints[0] : undefined); } }}
      {...snapProps}
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
            // Snap mode: container-height per vaul's geometry contract (see the note by snapProps);
            // the visible height is the active snap fraction, so no cap is needed - the top stop IS
            // the cap. Normal mode: intrinsic height under the usual 88dvh / keyboard-aware ceiling.
            ...(snapPoints
              ? { height: '100%' }
              : { maxHeight: 'min(88dvh, calc(100dvh - env(safe-area-inset-top,0px) - 12px - var(--kb,0px) / var(--ui-scale,1)))' }),
            display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none',
          }}
        >
          {/* Radix requires a dialog title for the accessible name. Ours is visually
              hidden because the Manuscript chassis shows its own header treatment. */}
          <Drawer.Title style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{label}</Drawer.Title>

          {/* The handle is OUR button, not vaul's <Drawer.Handle>: vaul's renders no
              accessible name, which would silently drop the owner ruling that the
              handle doubles as a screen-reader "Close" (it is the only in-sheet exit
              on the card sheets - there is no X). Nothing is lost by replacing it,
              because vaul drags from the whole sheet, not from the handle. */}
          {dismissible && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 8px', flex: 'none' }}>
              <button
                type="button" aria-label="Close" className="cx-hit44"
                onClick={() => closeRef.current?.()}
                style={{ width: 32, height: 8, padding: 0, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab' }}
              >
                <span aria-hidden="true" style={{ width: 32, height: 4, borderRadius: 2, background: 'var(--gold-handle, #5a4a28)', display: 'block' }} />
              </button>
            </div>
          )}
          {!dismissible && <div style={{ height: 14, flex: 'none' }} />}

          {header != null && (
            <div style={{ flex: 'none', background: 'var(--surface-sheet, #100c08)' }}>{header}</div>
          )}

          {/* See the paint note in the header comment: opaque ground + its own layer. */}
          <div
            className="cx-scroll"
            style={{ flex: '0 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: `14px 26px calc(26px + ${hiddenStrip} + env(safe-area-inset-bottom,0px))`, background: 'var(--surface-sheet, #100c08)', transform: 'translateZ(0)', WebkitOverflowScrolling: 'touch' }}
          >
            {children}
          </div>

          {footer != null && (
            <div style={{ flex: 'none', background: 'var(--surface-sheet, #100c08)', paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>{footer}</div>
          )}
        </Drawer.Content>

        {/* "More below" affordance for a peeked sheet: a soft fade + an up-chevron over the sheet's
            VISIBLE fold, so the cut-off next row reads as "pull up for more". It is fixed to the
            viewport bottom rather than parented to Drawer.Content, because vaul transforms the content
            to size a snap - an affordance inside it is translated off-screen (the bug the owner saw).
            Snap-aware (gone once expanded to the top stop) and pointer-transparent so it never eats a
            drag. Only ever rendered when a caller opted into snap points. */}
        {peeked && (
          <div aria-hidden="true" style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, height: 88, zIndex: 202, pointerEvents: 'none',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            paddingBottom: 'calc(16px + env(safe-area-inset-bottom,0px))',
            background: 'linear-gradient(to top, var(--surface-sheet,#100c08) 55%, transparent)',
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--gold-leaf, #cba75f)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .95 }}>
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </div>
        )}
      </Drawer.Portal>
    </Drawer.Root>
  );
}
