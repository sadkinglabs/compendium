// The ArtImg reveal decision - pure, DOM-free, unit-tested. Implements the
// Codex-approved contract (docs/proposals/decks-swap-artifacts.md, Option A):
//
//   1. Every new {src, gen} identity begins HIDDEN, regardless of cache history.
//   2. Only that element's OWN successful load starts its reveal.
//   3. Warm cache history may SHORTEN the fade; it can never skip it, and it can
//      never authorize pre-load visibility.
//   4. A settle timer from an old identity can never settle a replacement.
//
// Why a fade at all: frame forensics on device (builds 232-234) measured a
// transient bright vertical line at a fixed x inside freshly mounted art - at
// the img's left edge + 512px - on the element's first visible frame, and
// measured that a compositor opacity transition eliminates it (the detector
// spike went from ~77k to zero on the cold path). The fixed offset and the
// fade's effect are the OBSERVATIONS; "a raster tile finishing upload after its
// neighbour" is the consistent INFERENCE, not directly observed Chromium state.
// The transition itself lives in CSS classes (tokens.css `cx-art-reveal*`) so
// the reduced-motion exception can be expressed there with plain specificity.

export const REVEAL_COLD_MS = 160;
export const REVEAL_WARM_MS = 90;
// Inline styles + classes drop after this; must outlast the longest fade.
export const SETTLE_AFTER_MS = 300;

export const initialReveal = { id: null, at: 'wait', warm: false };

/** Events: {type:'LOADED', id, warm} from the element's own load;
 *  {type:'SETTLED', id} from the settle timer of that same identity. */
export function revealReduce(state, ev) {
  switch (ev?.type) {
    case 'LOADED':
      return { id: ev.id, at: 'show', warm: !!ev.warm };
    case 'SETTLED':
      // Identity-checked: a timer armed for an old {src, gen} finds state.id
      // moved on and changes nothing (contract item 4).
      return state.at === 'show' && state.id === ev.id ? { ...state, at: 'settled' } : state;
    default:
      return state;
  }
}

/** Presentation for the identity currently rendered. Any identity the state
 *  does not know is 'wait' - which is how a fresh mount, an error retry (gen
 *  bump), and a quarantine re-resolve all start hidden (contract items 1-2). */
export function revealPresentation(state, id) {
  const at = state.id === id ? state.at : 'wait';
  if (at === 'settled') return { revealed: true, className: '', style: null };
  if (at === 'show') {
    // No inline opacity: releasing the wait-state's inline 0 while the reveal
    // class carries the transition animates the element to its NATURAL opacity -
    // which for a deliberately dimmed consumer (Play's .13 hero wash) is its
    // design value, not 1. The old inline `opacity: 1` overrode the consumer's
    // style, so dimmed art flashed to full strength and faded back down when the
    // settle dropped the inline style (owner report 2026-08-15).
    return {
      revealed: true,
      className: state.warm ? 'cx-art-reveal cx-art-reveal-warm' : 'cx-art-reveal',
      style: null,
    };
  }
  return { revealed: false, className: '', style: { opacity: 0, transition: 'none' } };
}
