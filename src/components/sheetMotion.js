// Physics + gesture engine for the bottom-sheet chassis (docs/bottom-sheet-spec.md,
// corrected per docs/bottom-sheet-device-review-1.md - Codex disposition, build 255).
//
// One rAF spring drives every programmatic motion (open, close, snap-back) so any
// motion can be grabbed mid-flight with velocity carried across the interruption.
// The engine owns the DOM writes - transform on the panel, opacity on the scrim -
// and never goes through React state, so a drag costs zero renders per frame.
//
// GESTURE CONTRACT (Codex-prescribed): the ORIGINAL pointerdown owns the gesture's
// history. {originY, originP, height} and the first velocity sample are recorded at
// pointerdown; samples keep accumulating through the tracking phase; a scroll-handoff
// takeover RETAINS that origin and history and applies the takeover event
// immediately, so the sheet catches up to the finger instead of losing the first
// 10+px. Flick distance is judged on pointer displacement (releaseY - originY);
// the projected-position test uses the panel's ACTUAL current position.
//
// SCRIM CONTRACT (owner ruling, finding 1a): opening, dragging, and failed-dismiss
// snap-back are position-linked. Once a dismissal is ACCEPTED the scrim FREEZES at
// its current opacity, the panel slides fully off-screen with no scrim change, and
// only then does the scrim fade (100ms) before onClosed. Close reads as the sheet
// coming down, never as a fade.
//
// Every constant is sourced or derived (audit section 7): spring critically damped
// ~300ms (Compose parity); dismissal = velocity-projected position (Android
// HIDE_FRICTION 0.1) with vaul's 0.25 fraction; flick 500px/s (Android) + 20px
// floor (react-modal-sheet); rubber band iOS c=0.55; handoff 10px slop (Ionic) +
// 100ms post-scroll cooldown (vaul).
const STIFFNESS = 235;
const DAMPING = 31;
const PROJECTION_S = 0.1;
const DISMISS_FRACTION = 0.25;
const FLICK_VELOCITY = 500;        // px/s
const MIN_FLICK_DISTANCE = 20;     // px of pointer displacement from the ORIGIN
const ACTIVATION_SLOP = 10;        // px
const SCROLL_COOLDOWN_MS = 100;
const RUBBER_C = 0.55;
const VELOCITY_WINDOW_MS = 100;
const SCRIM_FADE_MS = 90;
// The close leg aims PAST the exit (device pass 2: the background stayed dimmed
// too long after the sheet had gone). A critically damped spring approaches its
// target asymptotically, so aiming at exactly 1.0 meant the panel was visually
// gone at ~200ms but the settle test (|p-1|<0.001 AND |v|<0.01) only passed near
// ~430ms - a quarter-second of dead time with nothing moving and the scrim still
// full. Aiming at 1.25 puts the visible travel on the FAST early part of the
// curve and makes p >= 1 arrive in finite time (~200ms from rest, sooner with
// release velocity) - which is also where M3 puts a sheet exit (short-4, 200ms,
// emphasized-accelerate). Nothing is visible past p = 1; the extra 25% is only
// there to shape the curve.
const CLOSE_TARGET = 1.25;
// The dim lifts in the TAIL, as the sheet clears, not in lockstep with it: at 90%
// of travel the panel is a sliver, so this still reads as "the sheet came down
// and the screen came back", never as a sheet that faded out (owner ruling 1a).
const FADE_AT = 0.9;

// A drag-to-close ends with a touch that emits ONE synthetic click on release. Once
// the sheet unmounts, that click lands on whatever is underneath and eats the
// user's next tap. Swallow it (capture phase, one-shot, short-lived). Only armed
// when the gesture actually MOVED - a stationary scrim tap must keep its click.
function swallowNextClick() {
  if (typeof window === 'undefined') return;
  const block = (e) => { e.stopPropagation(); e.preventDefault(); done(); };
  const done = () => { window.removeEventListener('click', block, true); clearTimeout(t); };
  const t = setTimeout(done, 400);
  window.addEventListener('click', block, true);
}

const reducedMotion = () =>
  typeof document !== 'undefined' && document.body?.classList?.contains('reduce-motion');

/**
 * @param {{
 *   panel: HTMLElement, scrim: HTMLElement, scroller: HTMLElement|null,
 *   onClosed: (source: 'gesture'|'caller') => void,
 *   onSettled: () => void,
 *   isDismissible: () => boolean,
 * }} cfg
 */
export function createSheetMotion(cfg) {
  const { panel, scrim } = cfg;
  let phase = 'closed';            // closed | opening | open | tracking | dragging | settling | closing | fading
  let closeSource = 'caller';
  let p = 1;                       // normalized position, 0 open .. 1 hidden (< 0 = overdrag)
  let v = 0;                       // normalized velocity (1/s)
  let target = 0;
  let raf = 0;
  let lastT = 0;
  let lastScrollT = 0;
  // Scrim freeze (accepted dismissal): opacity captured once, untouched until the fade.
  let scrimFrozen = false;
  let frozenOpacity = 1;
  let fadeStart = 0;
  // The active gesture - ONE origin for its whole life, tracking included.
  let gesture = null;              // { pointerId, originY, originX, originP, h, mode: 'tracking'|'dragging', scrollTop, moved }
  let lastMoved = false;           // survives gesture teardown - the release click arrives AFTER unlisten()
  const samples = [];              // [{ t, y }] clientY history for release velocity

  const rubber = (x) => -(1 - 1 / (x * RUBBER_C + 1));

  function apply() {
    const visual = p >= 0 ? p : rubber(-p);
    // translate3d + PERMANENT will-change (set by the chassis): the panel's layer
    // stays promoted for its entire mounted life. Demoting it at settle re-raster
    // glitched the RefineSheet at full height on-device (review finding 3).
    panel.style.transform = `translate3d(0, ${(visual * 100).toFixed(4)}%, 0)`;
    if (!scrimFrozen) scrim.style.opacity = String(Math.min(1, Math.max(0, 1 - visual)));
  }

  function freezeScrim() {
    if (scrimFrozen) return;
    scrimFrozen = true;
    const visual = p >= 0 ? p : 0;
    frozenOpacity = Math.min(1, Math.max(0, 1 - visual));
    scrim.style.opacity = String(frozenOpacity);
  }
  function unfreezeScrim() { scrimFrozen = false; }

  function finishClose() {
    phase = 'closed';
    scrim.style.opacity = '0';
    cfg.onClosed?.(closeSource);
  }

  function step(now) {
    raf = 0;
    const dt = Math.min(0.032, Math.max(0.001, (now - lastT) / 1000));
    lastT = now;
    const a = -STIFFNESS * (p - target) - DAMPING * v;
    v += a * dt;
    p += v * dt;

    if (target !== 0) {                       // ---- closing ----
      if (p >= 1) { p = 1; v = 0; }           // fully off-screen: stop moving, keep the fade running
      apply();
      if (!fadeStart && p >= FADE_AT) { fadeStart = now; phase = 'fading'; }
      if (fadeStart) {
        const t = Math.min(1, (now - fadeStart) / SCRIM_FADE_MS);
        scrim.style.opacity = String(frozenOpacity * (1 - t));
        if (t >= 1 && p >= 1) { finishClose(); return; }
      }
      raf = requestAnimationFrame(step);
      return;
    }

    if (Math.abs(p) < 0.001 && Math.abs(v) < 0.01) {   // ---- settled open ----
      p = 0; v = 0;
      // apply() writes translate3d(0, 0%, 0) - the panel settles WITH a transform
      // (never cleared), so its layer stays promoted.
      apply();
      phase = 'open';
      scrim.style.opacity = '1';
      cfg.onSettled?.();
      return;
    }
    apply();
    raf = requestAnimationFrame(step);
  }

  function spring(to) {
    target = to;
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
      p = to === 0 ? 0 : 1; v = 0; apply();   // never park at the shaping overshoot
      if (to === 0) {
        phase = 'open';
        scrim.style.opacity = '1';
        cfg.onSettled?.();
      } else {
        finishClose();                       // reduced motion: slide + fade within one frame
      }
      return;
    }
    if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(step); }
  }

  function stopSpring() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  // ---- velocity from the last ~100ms of pointer samples (whole-gesture history) ----
  function pushSample(y) {
    const t = performance.now();
    samples.push({ t, y });
    while (samples.length > 2 && t - samples[0].t > VELOCITY_WINDOW_MS) samples.shift();
  }
  function sampleVelocity() {                 // px/s, positive = downward
    if (samples.length < 2) return 0;
    const a = samples[0], b = samples[samples.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? (b.y - a.y) / dt : 0;
  }

  // ---- gesture ----
  const winMove = (e) => { if (gesture && e.pointerId === gesture.pointerId) move(e); };
  const winUp = (e) => { if (gesture && e.pointerId === gesture.pointerId) release(e); };
  const blockTouch = (e) => { e.preventDefault(); };

  function listen() {
    window.addEventListener('pointermove', winMove);
    window.addEventListener('pointerup', winUp);
    window.addEventListener('pointercancel', winUp);
  }
  function unlisten() {
    window.removeEventListener('pointermove', winMove);
    window.removeEventListener('pointerup', winUp);
    window.removeEventListener('pointercancel', winUp);
    window.removeEventListener('touchmove', blockTouch);
    gesture = null;
  }

  // Ownership: the sheet takes the gesture. Origin and samples are NOT reset -
  // the takeover event is applied immediately so the sheet catches up to the
  // finger (Codex contract, finding 1b).
  function takeOwnership(e) {
    stopSpring();
    unfreezeScrim();                          // a caught sheet is live again
    gesture.mode = 'dragging';
    phase = 'dragging';
    fadeStart = 0;                            // a caught sheet is live again - no pending fade
    // Cancel native scrolling for the remainder of the gesture - the sheet owns it.
    window.addEventListener('touchmove', blockTouch, { passive: false });
    dragTo(e);
  }

  function dragTo(e) {
    const rawP = gesture.originP + (e.clientY - gesture.originY) / gesture.h;
    if (Math.abs(e.clientY - gesture.originY) >= ACTIVATION_SLOP) gesture.moved = true;
    p = rawP;                                 // apply() rubber-bands p < 0
    v = 0;                                    // the finger owns position; spring velocity must not fight it
    apply();
  }

  function pointerDown(e, zone) {
    if (!cfg.isDismissible()) return;
    if (e.button != null && e.button > 0) return;
    if (gesture) return;                                             // primary pointer only
    if (phase === 'fading' || phase === 'closed') return;
    if (phase === 'closing' && closeSource !== 'gesture') return;    // caller-initiated close is final
    const moving = phase === 'opening' || phase === 'settling' || phase === 'closing';
    if (zone === 'scrim' && !moving) return;  // fully open: the scrim is tap-to-dismiss, never an air-drag surface
    gesture = {
      pointerId: e.pointerId,
      originY: e.clientY, originX: e.clientX,
      originP: Math.max(0, p),
      h: Math.max(1, panel.offsetHeight),
      mode: 'tracking',
      scrollTop: cfg.scroller ? cfg.scroller.scrollTop : 0,
      moved: false,
    };
    lastMoved = false;
    samples.length = 0;
    pushSample(e.clientY);
    listen();
    if (moving || zone === 'chrome') takeOwnership(e);
    // body zone while open: stay in tracking - the scroll handoff decides ownership
  }

  function move(e) {
    pushSample(e.clientY);                    // history accumulates through TRACKING too
    if (gesture.mode === 'tracking') {
      const dx = e.clientX - gesture.originX, dy = e.clientY - gesture.originY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < ACTIVATION_SLOP) return;
      const takeIt = dy > 0 && dy > Math.abs(dx)
        && gesture.scrollTop === 0
        && performance.now() - lastScrollT > SCROLL_COOLDOWN_MS;
      if (takeIt) takeOwnership(e);
      else { phase = 'open'; unlisten(); }    // native scroll owns this gesture for good
      return;
    }
    dragTo(e);
  }

  function release(e) {
    if (gesture.mode === 'tracking') { phase = 'open'; unlisten(); return; }
    pushSample(e.clientY);
    const vpx = sampleVelocity();
    const h = gesture.h;
    const yPx = Math.max(0, p) * h;                        // the panel's ACTUAL current position
    const displacement = e.clientY - gesture.originY;      // pointer displacement from the ORIGIN
    const moved = gesture.moved;
    lastMoved = moved;
    unlisten();
    // A MOVED release emits a synthetic click that would land on the handle or
    // scrim and ghost-dismiss a sheet that just snapped back - swallow it for
    // both outcomes. A stationary tap keeps its click (scrim tap-to-dismiss).
    if (moved) swallowNextClick();
    const projected = yPx + vpx * PROJECTION_S;
    const dismiss = cfg.isDismissible() && (
      projected > DISMISS_FRACTION * h ||
      (vpx >= FLICK_VELOCITY && displacement >= MIN_FLICK_DISTANCE)
    );
    if (dismiss) {
      closeSource = 'gesture';
      phase = 'closing';
      freezeScrim();
      fadeStart = 0;
      v = vpx / h;                                         // accepted dismissal carries full release velocity
      spring(CLOSE_TARGET);
    } else {
      phase = 'settling';
      // Rejected close: never seed DOWNWARD velocity into the snap-back - that is
      // the dip-and-rebound the owner saw (finding 1b). Upward carry is kept.
      v = Math.min(0, vpx) / h;
      spring(0);
    }
  }

  // scroll cooldown bookkeeping (vaul's SCROLL_LOCK_TIMEOUT)
  const onScroll = () => { lastScrollT = performance.now(); };
  cfg.scroller?.addEventListener('scroll', onScroll, { passive: true });

  return {
    open() {
      if (phase === 'opening' || phase === 'open') return;
      if (phase === 'dragging' || phase === 'tracking') return;   // the finger owns it
      unfreezeScrim();
      fadeStart = 0;
      phase = 'opening';
      spring(0);
    },
    /** Caller-initiated close (open prop flipped false): final, not catchable. */
    close() {
      if (phase === 'closing' || phase === 'fading' || phase === 'closed') return;
      closeSource = 'caller';
      phase = 'closing';
      freezeScrim();                          // full opacity from open; current if caught mid-motion
      fadeStart = 0;
      spring(CLOSE_TARGET);
    },
    /** Gesture-class dismissal (scrim tap, back, handle activate): plays the close
     *  motion and reports the close at settle, so it stays catchable mid-flight. */
    dismiss() {
      if (!cfg.isDismissible()) return;
      if (phase === 'closing' || phase === 'fading' || phase === 'closed') return;
      closeSource = 'gesture';
      phase = 'closing';
      freezeScrim();
      fadeStart = 0;
      spring(CLOSE_TARGET);
    },
    pointerDown,
    wasDragged: () => lastMoved || !!gesture?.moved,
    destroy() {
      stopSpring();
      unlisten();
      cfg.scroller?.removeEventListener('scroll', onScroll);
      phase = 'closed';
    },
  };
}
