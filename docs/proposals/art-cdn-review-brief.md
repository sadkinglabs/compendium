# Codex RE-REVIEW request - art-CDN migration PROPOSAL rev 6 (design review, pre-implementation)

**Branch:** `art-cdn`. **Proposal; Phase-1 implementation has begun (dormant - no catalog promote, no
app behavior change).** Owner authorized proceeding; this re-review is for the final design sign-off.

## Where we are

- **Rev 1-4:** progressively cleared (blocker + majors + minors each round).
- **Rev 5** (Changes required, narrow): rev-4 findings closed; the conflict repair was "not yet
  executable or retry-deterministic" (a publication-history oracle could misjudge a shallow/rebased
  checkout; incident-key `<n>` allocation unspecified).
- **Rev 6** adopts Codex's simpler fix: conflict repair **never overwrites any object** - a
  deterministic `repair-<n>` loop (first `n` absent -> PUT; first `n` already correct -> reuse;
  present-but-wrong -> advance), repoint to the new URL. No purge, no history oracle; converges after
  interruption. Companion `art-cdn-rev2-architecture.md` is rev 6 (finding-to-resolution table at top).

## The design, current state (rev 6)

- **Content-addressing (blocker):** conversion never existence-skips - the manifest predicate
  (`srcSha256` AND `recipeId`) is the only skip oracle; a miss ALWAYS converts fresh, so a changed
  source can't reuse an old staging webp. Full 64-hex keys. Migration reconverts all 3,090.
  **(Implemented: `scripts/catalog/artManifest.mjs` + tests, mutation-checked.)**
- **Conflict repair (rev-6 change):** **never overwrites any object.** A `conflicting` object (key
  present but wrong bytes) allocates a fresh `<slug>.<sha256>.repair-<n>.webp` by a deterministic loop
  - first `n` absent -> PUT; first `n` already correct -> reuse (interrupted-run recovery);
  present-but-wrong -> advance - then repoints the catalog to that new URL. No purge, no
  publication-history oracle, no manual-purge step; converges after interruption. (A3.)
- **Cache boundary:** epoch-mismatch returns a non-caching `staleResult` (never a recursive resolve);
  the epoch is re-checked after the awaited wrong-size delete; temps in an `art-tmp/` scratch cleaned
  in `finally`; `visibleCandidate(state, propKey)` returns **null** on a key mismatch (so a
  mismatched-frame error can't be lost). `art/` + `art-tmp/` excluded from Android backup. (B3/B4/B7/B8.)
- **Phase-5 legacyKey:** `normalizeTransitional()` strips it from every retained entry. (A4.)

## What to read

- **Primary:** `docs/proposals/art-cdn-migration.md` (the §8 proposal) + companion
  `docs/proposals/art-cdn-rev2-architecture.md` (**rev 6**; interface-level design + pseudocode + the
  counterfactual tests each fix enables, incl. the rev-6 convergence tests in A9.3).
- **Implemented so far (Phase 1, dormant):** `scripts/catalog/artManifest.mjs` + `artManifest.test.mjs`.
  (`cdn-convert.mjs` is being retired per the fresh-convert contract; a hardened uploader/audit engine
  is the next increment.)

**Range:**

```
git fetch origin && git checkout art-cdn      # use the current art-cdn tip
git diff c787585..art-cdn                     # full: proposal + companion + the artManifest engine
# rev-6 delta (docs) + first Phase-1 increment:  git diff 8cc6946..art-cdn
```

## Already verified (challenge only if you think a check is wrong)

- **CDN live + edge-cached:** 3,090 webp (285 MB) serve `200 image/webp` via `cdn.sadkinglabs.com`
  (`cf-cache-status` MISS then HIT). Keys will be RE-UPLOADED under full-hash content-addressed names
  in Phase 1 (the current slug-named objects become orphans).
- **CORS:** R2 sends no `Access-Control-Allow-Origin` + 403s preflight, so the cache byte-fetch is
  native (`Filesystem.downloadFile` present in `@capacitor/filesystem` 6.0.4; `CapacitorHttp` already
  used in `deckRepository.js:529-538`). `<img>` display needs no CORS.
- **Content-MD5/ETag** is the R2-documented integrity path (Codex confirmed), gated behind a Phase-0
  `ETag == MD5` canary.
- **Hard ordering:** pipeline repoint before the seam swap (dormant Phase 1, atomic Phase 2).

## Where to attack rev 6

The rev-6 conflict-repair loop (does the `repair-<n>` allocation truly never overwrite, and does it
converge on every interruption ordering - crash after PUT-before-promote, a `repair-1` that itself
took a bad write); the convert-fresh contract in the implemented `artManifest.mjs` (any residual
existence-skip); the cache guards (any write into `art/`/`art-tmp/` still reachable post-clear; any
render path that can still return a stale candidate); and whether any previously-cleared item
regressed. Also worth a pass: the implemented engine's tests vs the A9 evidence list.

## Not in scope

Implementation. No Phase-1 code is written; this reviews the DESIGN + the two prep scripts.
Phase-by-phase code review follows approval.
