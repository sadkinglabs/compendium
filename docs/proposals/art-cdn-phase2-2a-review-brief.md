# Codex review request - art-CDN Phase 2a (the INERT boundary foundation)

**Branch:** `art-cdn-phase2` (off `main`, tip = latest). This is the Phase-2 checkpoint BEFORE the atomic
activation: the runtime art boundary is fully built but **inert** - nothing imports the new render/native
modules, so the production bundle is byte-identical and app behavior is unchanged. Reviewing it now
catches any cache-core/adapter design issue before 2b wires 14 render sites + the catalog repoint on top.

The DESIGN is already approved (rev-6): `docs/proposals/art-cdn-rev2-architecture.md` Section B (B2
interface, B3 resolution, B3.5 candidate chain, B4 reducer, B6 zero-image). This reviews the
IMPLEMENTATION of that design plus the native adapter. The activation plan is
`docs/proposals/art-cdn-phase2-activation.md` (owner-approved; owner scoped the poster's card art OUT).

## Range

```
git fetch origin && git checkout art-cdn-phase2
git diff main..art-cdn-phase2            # proposal + the inert 2a modules
```

Commits: `e1ecc67`/`e4b5ab9` (proposal), `8e01684` (pure cores + tests), `a027fc8` (native/React glue).

## What's here (all inert - nothing imports it yet)

- **`src/store/artSource.js`** (+ test, 10) - the pure reducer + `visibleCandidate`, imports NOTHING.
  Implements B4: stale-key drop, KEY resets `broken`, `visibleCandidate` returns null on a key mismatch
  (no stale paint), quarantine re-resolve bumps `gen`.
- **`src/store/artCache.js`** (+ test, 13) - `createArtCache(deps)`, a pure core over an injected `io`
  adapter. Implements B2/B3/B6: single-flight joinable only within one epoch; the promotion-lock
  linearization (epoch re-checked inside the lock around every rename/delete; download never locked);
  the non-repopulating `staleResult`; exact-size fail-closed `validSize` (a manifest-miss key is never
  cached/served); quarantine-retry-once; zero-image prohibits render AND I/O.
- **`src/store/artCacheAdapter.js`** - the ONLY Capacitor-touching code. `Filesystem` io over
  `Directory.Data`; a SYNC `convertFileSrc` (caches the Data root uri at init, since a relative path is
  only known async); `download` prefers `Filesystem.downloadFile` and falls back to
  `CapacitorHttp -> writeFile` (the deckRepository.js:532 pattern). `rename`/`download` ensure the parent
  dir exists (so a promote after `clear()` re-creates `art/`).
- **`src/store/artCacheInstance.js`** - the singleton wiring + a MUTABLE manifest holder filled by
  `loadArtManifest()` at boot (created-at-import, filled-later; absent/offline degrades to remote/legacy).
- **`src/components/ArtImage.jsx`** - `useArtSource` hook + `ArtImage`, zero-logic shells calling the
  tested pure functions in React's effect order; `<img>` keyed on `gen`. No canvas, no crossOrigin.
- **`src/store/cardArt.js`** - export `imagesDisabled`; add `ART_CDN_BASE`, `artUrl`, `legacyUrl`.
  `cardImageUrl` is UNTOUCHED (the seam flip is 2b).
- **`src/store/artCacheSpike.js`** - a debug-build `window.__artSpike` probe (release has no console).

## Gates

`test:query` 674 (23 new), `check:cycles` (131 modules, no cycles), `check:types`, `build` (bundle
byte-identical - proof of inertness). The native adapter / ArtImage are device/React glue, not unit-tested
here (they carry no branching logic; all logic is in the two tested pure cores).

## Where to attack

- **Resolution faithfulness to B3:** any path where a stale flight (epoch changed mid-download) could
  memoize or promote; any missing epoch re-check after an awaited step; single-flight join across epochs.
- **Fail-closed validation:** can an object the manifest can't describe ever be served `local`, or a
  wrong-size file trusted?
- **Adapter correctness (by inspection - untested):** the sync `convertFileSrc` after `clear()`+re-init;
  `rename`/`download` parent-ensure vs `deleteTree('art')`; the `downloadFile`->`CapacitorHttp` fallback
  and base64 write; does `readdir` return `size` on 6.0.4 for `stats()`?
- **Reducer purity:** does `artSource.js` truly import nothing and is every impure input on the event?
- **Zero-image widening:** every entry point (`resolve/download/peek/legacySrc`) gated; no I/O when off.

## Deferred to 2b (the atomic activation - NOT in this diff)

The `cardImageUrl` seam flip; adopting `ArtImage`/`useArtSource` at the 5 resolver sites + 14 inline
`${BASE}cards/` sites; DELETING the poster's avatar-art draw; the catalog repoint (`image_slug` ->
content key) + version bump + shipped slim manifest; the Android backup-exclusion XML; the real R2 upload.
All land together (a half-land regresses every card to fallback). `downloadFile` reliability is covered by
the adapter fallback and verified at the 2b device render.
