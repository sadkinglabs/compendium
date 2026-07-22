# Codex RE-REVIEW request - art-CDN migration PROPOSAL rev 4 (design review, pre-implementation)

**Branch:** `art-cdn`. **Still a proposal, no production app code.** Approval of this design gates
Phase 1. This brief is rewritten clean for rev 4 (prior stacked rev-1/2/3 layers removed - stale
instructions caused a version mix-up in the last round).

## Where we are

- **Rev 1** (Changes required): blocker + 3 majors - all resolved.
- **Rev 2** (Changes required, direction approved): 4 impl majors + 3 minors - all resolved.
- **Rev 3** (Changes required): Codex cleared all ten prior resolutions and approved the direction,
  then found 1 new Blocker + 3 Majors + 2 Minors in the rev-3 design itself.
- **Rev 4** resolves those six. Architecture fixes are in the companion
  `art-cdn-rev2-architecture.md` (content is rev 4; finding-to-resolution table at its top);
  reconciled in `art-cdn-migration.md`.

## Rev 4 - how each rev-3 finding is resolved

- **Blocker (stale converted bytes):** conversion never existence-skips. When `srcSha256` OR
  `recipeId` fails the skip predicate it produces FRESH bytes (unique temp -> convertFresh ->
  validate -> atomic replace -> describe), so a changed source can't reuse an old staging webp. The
  initial migration reconverts all 3,090 (no bare-file provenance trust). (Companion A4/A7.)
- **Major (pre-clear repopulation):** on an epoch mismatch the resolver returns a NON-CACHING
  candidate (remote/legacy/null), never a recursive `resolve()`, so an in-flight pre-clear request
  cannot refill the cache; temp writes use a scratch namespace with orphan cleanup so no temp
  survives `clear()`. (B3/B7.)
- **Major (one-frame wrong-card paint):** the reducer is genuinely pure (events carry `peeked`/
  `legacy`), and a pure `visibleCandidate(state, propKey, peeked)` returns the OLD candidate only
  when `state.key === propKey` - a mismatch yields the new key's memo or null, never card A's art on
  card B. (B4.)
- **Major (unrecoverable remote conflict):** upload planning classifies each object by the full
  tuple - `valid` (skip), `missing` (upload), `conflicting` (present but wrong size/ETag -> explicit
  actionable re-PUT repair, documented as exceptional edge-cache incident recovery, not normal
  invalidation). (A3.)
- **Minor (Phase-5 legacyKey):** Phase 5 normalizes transitional fields for EVERY retained entry,
  not just newly converted ones, so no `legacyKey` survives the un-bundling. (A4.)
- **Minor (doc contradictions):** this brief rewritten; the main proposal's stale LifeCounter row and
  the error-summary (now includes `bundledLegacy`) corrected; the `${v.slug}.webp` key claim removed
  everywhere (keys are full-hash content-addressed).

## What to read

- **Primary:** `docs/proposals/art-cdn-migration.md` (the §8 proposal) + companion
  `docs/proposals/art-cdn-rev2-architecture.md` (rev-4 interface-level design + pseudocode + the
  counterfactual tests each fix enables).
- Prep tooling to be wired in Phase 1: `scripts/catalog/cdn-convert.mjs`, `cdn-upload.mjs`.

**Range:**

```
git fetch origin && git checkout art-cdn      # HEAD must be the rev-4 tip, not 5c7abd6
git diff c787585..art-cdn                     # full tooling + proposal + companion; no src/** app code
# rev-4 delta only:  git diff 5c7abd6..art-cdn
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

## Where to attack rev 4

The convert-fresh contract (any residual existence-skip path in `ensureConverted`/`convertFresh`);
the pre-clear non-caching return + scratch-namespace temp cleanup (any write into `art/` still
reachable post-clear); the `visibleCandidate` selector + its production wiring (any render path that
can still return a stale candidate); the conflict-repair path (does re-PUT + re-audit actually
converge, and is the edge-purge incident procedure sound); and whether any rev-3-cleared item
regressed.

## Not in scope

Implementation. No Phase-1 code is written; this reviews the DESIGN + the two prep scripts.
Phase-by-phase code review follows approval.
