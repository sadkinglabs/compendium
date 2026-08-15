// The card-art source state machine - a GENUINELY pure reducer + selector, kept out of the React
// components so the "which candidate does this frame paint" rules are provable without a DOM. Run:
// npm run test:query
//
// THIS IS THE NO-STALE-PAINT BOUNDARY. Every card-art <img> in the app (via useArtSource/ArtImage)
// derives its src from here. This module exists to kill two defects the old per-component approach had:
//   1. A recycled list tile flipping card A -> B painted A's art for one frame, because React runs
//      effects AFTER the render that first observes the changed prop. visibleCandidate() returns NULL
//      on a key mismatch so A's art is unreachable on that frame (the deterministic fallback shows for
//      at most one frame, then KEY(B) mounts B fresh).
//   2. A `broken` flag retained across card changes, so a tile that once 404'd never showed art again.
//      KEY() resets to `initial`, so 'broken' can never leak across keys.
//
// PURITY CONTRACT (art-cdn rev-6, Codex Major 2): this file imports NOTHING. Every impure input a
// transition needs - the memoized `peeked` candidate and the `legacy` fallback candidate - rides ON THE
// EVENT, captured by the hook's dispatch sites (useArtSource). A transition never reaches into artCache.
// See docs/proposals/art-cdn-rev2-architecture.md Section B4 for the approved design this implements.
//
// A candidate is a KIND-TAGGED object { kind:'local'|'remote', src } - never a bare string, because a
// native cached file becomes an https://localhost/_capacitor_file_/... URL that a startsWith('http')
// sniff would misread as remote. The resolver says what it produced. (Phase 5 removed the 'legacy'
// bundled-image candidate: a remote miss now goes straight to the deterministic fallback.)

/** @typedef {{ kind: 'local'|'remote', src: string }} Candidate */
/** @typedef {'resolving'|'shown'|'quarantining'|'broken'} Phase */
/** @typedef {{ key: string|null, phase: Phase, cand: Candidate|null, gen: number }} ArtState */

/**
 * The initial state for a key. If a prior resolution is memoized (`peeked`), start SHOWN with it for a
 * flash-free first paint; otherwise resolve (or go straight to 'broken' for a falsy key - no art).
 * @param {string|null} key
 * @param {Candidate|null} peeked
 * @returns {ArtState}
 */
export function initial(key, peeked) {
  if (peeked) return { key, phase: 'shown', cand: peeked, gen: 0 };
  return { key, phase: key ? 'resolving' : 'broken', cand: null, gen: 0 };
}

/**
 * The pure transition. Events:
 *   { type:'KEY', key, peeked }              the prop key changed (or first mount)
 *   { type:'RESOLVED', key, cand }           artCache.resolve()/quarantine() settled (cand may be null)
 *   { type:'IMG_ERROR', key }                the <img> onError fired (a remote miss -> deterministic fallback)
 * Every non-KEY event carries the key it was produced for; a result for a superseded key is DROPPED
 * (the generation guard, now inside the tested core - a late resolve for card A cannot paint over B).
 * @param {ArtState} state
 * @param {object} ev
 * @returns {ArtState}
 */
export function reduce(state, ev) {
  if (ev.type !== 'KEY' && ev.key !== state.key) return state;   // stale async from a superseded key

  switch (ev.type) {
    case 'KEY':
      return initial(ev.key, ev.peeked || null);                 // also resets 'broken' across keys

    case 'RESOLVED': {
      if (state.phase !== 'resolving' && state.phase !== 'quarantining') return state;
      if (ev.cand == null) return { ...state, phase: 'broken', cand: null };   // zero-image / falsy: fallback only
      // A quarantine re-resolve that returns the SAME local uri must still remount the <img>, so bump gen.
      if (ev.cand.kind === 'local' && state.phase === 'quarantining') {
        return { ...state, phase: 'shown', cand: ev.cand, gen: state.gen + 1 };
      }
      return { ...state, phase: 'shown', cand: ev.cand };
    }

    case 'IMG_ERROR': {
      if (state.phase !== 'shown' || !state.cand) return state;
      switch (state.cand.kind) {
        case 'local':                                            // a cached file went bad -> quarantine + retry
          return { ...state, phase: 'quarantining' };
        case 'remote':                                           // CDN miss -> the deterministic fallback (Phase 5: no bundled legacy)
          return { ...state, phase: 'broken', cand: null };
        default:
          return state;
      }
    }

    default:
      return state;
  }
}

/**
 * The no-stale-paint selector: what the <img> may paint THIS frame. Returns the current candidate only
 * when the reducer's key matches the prop key; on a mismatch (a recycled tile whose effect has not yet
 * dispatched KEY) it returns null so the previous card's art is unreachable and a mismatched-frame
 * IMG_ERROR can never be lost. Pure and total.
 * @param {ArtState} state
 * @param {string|null} propKey
 * @returns {Candidate|null}
 */
export function visibleCandidate(state, propKey) {
  return state.key === propKey ? state.cand : null;
}

/**
 * The first-paint display decision for a framed card image - pure, so the reveal rule is testable
 * without a DOM. `painted` is passed IN (artCache owns that registry, alongside the quarantine/clear
 * lifecycles that evict from it); this module stays stateless.
 *
 * REVEAL CONTRACT (aligned with artReveal.js, the Decks/ArtImg fix - owner device report 2026-08-15
 * saw the broken-image artifact in Codex Cards, the last CardArt-only holdout of the old rule):
 *   - NOTHING is visible before THIS {src, gen}'s own decode. The old "painted shows at once" rule
 *     put a remounted <img> at opacity 1 before its load event - on the WebView that frame can be
 *     the broken-image glyph or a half-rastered seam (builds 232-234 forensics).
 *   - Warm history (painted) still buys what it safely can: NO shimmer replay on a pillar switch,
 *     and a SHORT fade (90ms, = REVEAL_WARM_MS) instead of the cold .3s.
 * @param {{ src: string|null, gen: number, loadedSrc: string|null, loadedGen: number, painted: boolean }} p
 * @returns {{ shown: boolean, shimmer: boolean, transition: string }}
 */
export function paintState({ src, gen, loadedSrc, loadedGen, painted }) {
  const decoded = !!src && loadedSrc === src && loadedGen === gen;
  return {
    shown: decoded,
    shimmer: !!src && !decoded && !painted,
    transition: painted ? 'opacity .09s ease' : 'opacity .3s ease',
  };
}
