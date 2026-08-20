// LONG-PRESS + DRAG reordering for a list of rows - the app-wide shape for manual ordering
// (owner ruling 2026-08-20), now driven by DND-KIT.
//
// WHY THE ENGINE CHANGED (2026-08-21). The hand-rolled gesture in `useDragReorder.js` went three
// review-and-device rounds - scroll suppression, then a drop BOUNCE, then a drop FLASH - and each
// round fixed a real defect and surfaced another. The flash was diagnosed, and the diagnosis is the
// argument for the swap: the commit ran from a `transitionend` listener, and `transitionend` is a
// NON-DISCRETE event, so React 18+ may defer the reorder render past the next paint - while our own
// `freezeRows()` had already synchronously stripped every transform. One frame of the OLD DOM order,
// transform-free, reaches the screen before the new order lands. Fixing that means owning the
// handover frame between a gesture's transforms and a list's layout, which is precisely the problem
// dnd-kit's sortable preset has already solved with a measured FLIP. Same call the bottom sheet made
// when it swapped `sheetMotion.js` for vaul (see `GothicSheet.jsx`): stop hand-rolling the part with
// enormous prior art.
//
// WHAT WE KEEP:
//  - THE MODULE BOUNDARY. One place owns list reordering. Both surfaces (Collection > Storage's
//    "Your Places", Decks > Library's sections) render `DragReorderList` + `DragReorderRow` and
//    nothing else; no consumer imports dnd-kit.
//  - THE COMMIT CONTRACT. `onReorder(from, to)` in the list's own index space, exactly the signature
//    the old hook's `onCommit` had, so the pure mapping below it (`reorderList`,
//    `librarySections.reorderInSection`) and the repository writes are untouched.
//  - THE INTERACTION VALUES: ~400ms hold to lift with a `medium` haptic, an 8px slop that cancels
//    the gesture (a row is also a scroll surface, and a flick must never become a reorder), a
//    `light` haptic per slot change, `scale(1.02)` + shadow + raised z on the lifted row, and the
//    click-after-drag suppression that stops a reorder from also opening the row it reordered.
//  - THE OPTIMISTIC COMMIT. `onReorder` must still apply the new order synchronously; dnd-kit's FLIP
//    measures the pre-render rects and animates from them, so the new order must arrive in the same
//    React pass the drag ended in.
//
// WHAT THE LIBRARY OWNS: geometry (which slot the finger is over, how far each displaced row
// slides), sensors and their activation constraints, autoscroll, and the drop/settle animation
// including the handover frame. None of our freeze machinery survives, deliberately.
//
// TOUCH SENSOR, NOT POINTER SENSOR - THE ONE DEVIATION FROM THE STOCK RECIPE. dnd-kit's
// `PointerSensor` preventDefaults `pointermove`, which does not stop Android from scrolling; the
// stock answer is `touch-action: none` on the draggable, and we cannot pay that - these rows ARE the
// scroll surface, so a permanent `touch-action: none` would make the list unscrollable by touch.
// `TouchSensor` instead attaches a NON-PASSIVE `touchmove` listener at touchstart and
// preventDefaults it once the hold activates, which is the same mechanism the hand-rolled hook had
// to discover (and better timed - attached before the first move, so the compositor never classifies
// the sequence as a scroll in the first place). `MouseSensor` covers the desktop pointer.
// `PointerSensor` is deliberately absent: `pointerdown` precedes `touchstart`, so merely adding it
// would let it win every touch and silently reinstate the scroll bug.
//
// THE ZOOM BOUNDARY. Accessibility scaling is `.cx-app { zoom: var(--ui-scale) }` (tokens.css,
// set by appearance.js), so `ui-scale != 1` is a SUPPORTED state, not an edge case. Pointer
// coordinates and `getBoundingClientRect` are real VIEWPORT px; a `transform` on an element inside
// that zoomed subtree is multiplied by the zoom when painted. Every transform dnd-kit hands us -
// the active row's pointer delta, the strategy's sibling displacement, and the FLIP delta on the
// handover frame - is computed from client rects, i.e. viewport px. So the division by the measured
// zoom happens ONCE, at the CSS boundary in `DragReorderRow`, exactly where the old hook put it.
//   NOT A MODIFIER, and this is the load-bearing detail: modifiers only touch the ACTIVE draggable's
// transform. The sibling displacement comes from the sorting strategy and the handover comes from
// `useDerivedTransform`, and neither passes through the modifier pipeline - a modifier would fix one
// row out of three sources and leave the other two over-travelling by the zoom factor. The
// restriction modifiers stay modifiers because they compare rects to rects in viewport px, which is
// self-consistent and must happen BEFORE the division.
//   Worked example at `--ui-scale: 1.15`, finger moved 80px: dnd-kit reports `transform.y = 80`
// (viewport px). Written raw, `translate3d(0,80px,0)` paints 80 x 1.15 = 92px and the row outruns
// the finger. Divided, 80 / 1.15 = 69.57 layout px, painted 69.57 x 1.15 = 80px - back under the
// finger.
//   ACCEPTED APPROXIMATION: dnd-kit adds raw `scrollTop` deltas (layout px) to pointer coordinates
// (viewport px) while autoscrolling, so at `ui-scale != 1` a long autoscroll drifts the chosen slot
// by `scrolled x (scale - 1)`. Bounded here by `restrictToParentElement` and short lists. This is
// the same class of approximation the sheet chassis already accepts from vaul (GothicSheet.jsx).
//
// WEBVIEW PAINT RULE (documented in GothicSheet.jsx): a transform and an `overflow` scroll must
// never share an element. These row wrappers are transformed, so nothing here or in a consumer may
// give them `overflow`.
//
// ACCESSIBILITY, STATED NOT PAPERED OVER: no `KeyboardSensor` ships, so dnd-kit's `attributes`
// (role="button", tabIndex, aria-roledescription="draggable") are deliberately NOT spread onto the
// rows - they would advertise a keyboard drag that does not exist, on top of a row that is already
// clickable. The gesture remains touch/pointer only; that gap is recorded in DESIGN_SYSTEM §5.
import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { haptic } from '../native.js';

const LONG_PRESS_MS = 400;   // hold this long and the row lifts
const SLOP_PX = 8;           // movement past this before the lift means the user is scrolling
const CLICK_EAT_MS = 400;    // how long a swallowed click stays swallowed if none ever arrives

// Vertical first, then clamped to the list wrapper - both in viewport px, before the CSS boundary
// divides by the zoom. Order matters: the clamp compares the dragged rect to its parent's rect.
const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];

const Ctx = createContext(null);
const NO_IDS = [];

/** The effective zoom on this subtree: viewport px per layout px. 1 when `--ui-scale` is 1. */
function measureZoom(el) {
  if (!el) return 1;
  const w = el.getBoundingClientRect().width;
  return w > 0 && el.offsetWidth > 0 ? w / el.offsetWidth : 1;
}

/**
 * The draggable list. Wrap the rows of ONE uninterrupted run - a section header inside the run would
 * be measured as part of it.
 *
 * @param {object} props
 * @param {Array<string|number>} props.ids  stable row ids, in render order, one per DragReorderRow
 * @param {(from:number, to:number)=>void} props.onReorder
 *        indices into `ids`. MUST apply the new order synchronously (optimistically, before any
 *        await) - see the header.
 * @param {boolean} [props.disabled] no lifts while true (a filtered list, a selection mode)
 */
export default function DragReorderList({ ids, onReorder, disabled = false, children }) {
  const wrap = useRef(null);
  const zoom = useRef(1);
  const eatClickUntil = useRef(0);
  const overId = useRef(null);
  const list = ids || NO_IDS;
  const idsRef = useRef(list);
  idsRef.current = list;
  const commitRef = useRef(onReorder);
  commitRef.current = onReorder;

  // A single row has nowhere to go, so it is not draggable - a lift that cannot reorder would still
  // eat the tap that follows it.
  const off = disabled || list.length < 2;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: LONG_PRESS_MS, tolerance: SLOP_PX } }),
    useSensor(TouchSensor, { activationConstraint: { delay: LONG_PRESS_MS, tolerance: SLOP_PX } }),
  );

  const onDragStart = useCallback(({ active }) => {
    // Measured at the lift rather than at render: `--ui-scale` can change under a mounted list.
    zoom.current = measureZoom(wrap.current);
    overId.current = active?.id ?? null;
    haptic('medium');
  }, []);

  const onDragOver = useCallback(({ over }) => {
    const id = over?.id ?? null;
    if (id === overId.current) return;
    overId.current = id;
    if (id != null) haptic('light');
  }, []);

  // A lift always eats the following click, even one that reordered nothing - the user was holding
  // the row, not tapping it. A deadline rather than a timer, so a gesture that produces no click at
  // all cannot leave the next real tap dead.
  const end = useCallback(({ active, over } = {}) => {
    eatClickUntil.current = Date.now() + CLICK_EAT_MS;
    overId.current = null;
    if (!active || !over || active.id === over.id) return;
    const order = idsRef.current;
    const from = order.indexOf(active.id);
    const to = order.indexOf(over.id);
    if (from < 0 || to < 0 || from === to) return;
    commitRef.current?.(from, to);
  }, []);

  const ctx = useMemo(() => ({ zoom, eatClickUntil, disabled: off }), [off]);

  return (
    <DndContext sensors={sensors} modifiers={MODIFIERS} collisionDetection={closestCenter}
      onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={end} onDragCancel={end}>
      <SortableContext items={list} strategy={verticalListSortingStrategy} disabled={off}>
        {/* A REAL element, not a fragment: `restrictToParentElement` clamps the drag to the dragged
            row's parent rect, so this wrapper is what keeps a row inside its own run. Left
            style-free so the rows' margins still collapse through it exactly as before. */}
        <div ref={wrap}>
          <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
        </div>
      </SortableContext>
    </DndContext>
  );
}

/** One draggable row. `id` must be the same value, in the same position, as in the list's `ids`. */
export function DragReorderRow({ id, children }) {
  const ctx = useContext(Ctx);
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id, disabled: ctx?.disabled });

  // THE CSS BOUNDARY - the one place the zoom is divided out. See the header.
  const y = transform ? transform.y / (ctx?.zoom.current || 1) : 0;
  const moved = !!transform && y !== 0;

  const onClickCapture = useCallback((e) => {
    const until = ctx?.eatClickUntil;
    if (!until || !until.current || Date.now() > until.current) return;
    until.current = 0;
    e.preventDefault();
    e.stopPropagation();
  }, [ctx]);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      // Capture phase, on the wrapper, so it lands before the row's own onClick navigates.
      onClickCapture={onClickCapture}
      style={{
        // Vertical only, at every source: the modifier pins the active row's x, and the sorting
        // strategy never produces one for a vertical list.
        transform: isDragging ? `translate3d(0, ${y}px, 0) scale(1.02)` : (moved ? `translate3d(0, ${y}px, 0)` : undefined),
        transition,
        position: 'relative',
        zIndex: isDragging ? 20 : undefined,
        boxShadow: isDragging ? '0 12px 30px rgba(0,0,0,.6)' : undefined,
        borderRadius: isDragging ? 12 : undefined,
        willChange: isDragging || moved ? 'transform' : undefined,
        // A lifted row must not also be selecting text under the finger.
        userSelect: isDragging ? 'none' : undefined,
        WebkitUserSelect: isDragging ? 'none' : undefined,
      }}
    >
      {children}
    </div>
  );
}
