# Codex RE-REVIEW request - art-CDN migration PROPOSAL rev 2 (design review, pre-implementation)

**Branch:** `art-cdn`. **Still a proposal, no production app code.** Rev 1 disposition was Changes
required (Blocker + 3 Majors + Minors); rev 2 resolves all of them.

## Rev 2 - how each rev-1 finding is resolved

Read the **"Response to the rev-1 disposition" table** at the top of `art-cdn-migration.md`, then the
**companion `art-cdn-rev2-architecture.md`** (Section A content-addressed identity, Section B the
shared `artCache`/`ArtImage` boundary) for the interface-level designs + pseudocode + the tests each
enables. Summary:

- **Blocker (stale art)** -> content-addressed keys `<slug>.<sha256-12>.webp` + committed
  `art-manifest.json`; catalog hash folds the manifest digest not filenames; no purge concept.
- **Major (fail-open tooling)** -> importable engines, non-zero CLIs, temp->validate->rename,
  authoritative remote-checksum skip, real publish audit, `--recover` re-audits R2, dry-run seam.
- **Major (unsafe Phase 1)** -> dormant Phase 1 (no promote) + single atomic Phase-2 activation +
  legacy bundled fallback until Phase 5.
- **Major (cache)** -> one shared boundary, every site, local-first single-flight epoch-guarded, zero-
  image prohibits I/O, Android backup exclusion.
- **Minors** -> count 14+poster, comment-stripped guard banning `artUrl`/`cardImageUrl` outside the
  boundary, doc contradictions fixed, `aws4fetch` disclosed, one `selectPrinting()` for Phase 6.

**Where to attack rev 2:** the content-addressing edge cases (encoder drift, prefix-collision, the
`x-amz-checksum-sha256` R2-support assumption); whether the atomic Phase-2 activation + legacy fallback
truly closes the offline-upgrade window; the `artCache` pure-core/`io`-adapter testability and the
epoch/clear-vs-download serialization; and any resubmission-evidence test still missing.

## (rev 1, retained for context) Please review the design for soundness and the two prep scripts for
correctness, and return a disposition (Approve / Approve-with-conditions / Changes required) as you
would for a §8 proposal.

## What to read

- **Primary:** `docs/proposals/art-cdn-migration.md` - the full §8 proposal (Fable-authored,
  Claude-verified). Classification High-risk; all eight §3 invariants dispositioned; 6 phases.
- **Prep tooling (will be wired into the pipeline in Phase 1, review for correctness now):**
  `scripts/catalog/cdn-convert.mjs` (PNG->745px q80 webp) and `scripts/catalog/cdn-upload.mjs`
  (R2 S3-PUT via aws4fetch, creds from gitignored `.env.r2`, `--check` healthcheck).

**Range:**

```
git fetch origin
git diff c787585..art-cdn          # tooling + proposal + rev-2 companion; no src/** app code
git log --oneline c787585..art-cdn
# rev-2 delta only:  git diff 69f5b4b..art-cdn
```

## Context already VERIFIED (please don't re-litigate; challenge if you think a check was wrong)

- **The library is live.** 3090 per-finish webp (285 MB) uploaded to R2 and serving `200 image/webp`
  through the owner's edge-cached custom domain `https://cdn.sadkinglabs.com` (verified `cf-cache-status`
  MISS then HIT). `ART_CDN_BASE` targets it; r2.dev is interim-build only.
- **CORS (empirically):** r2.dev/R2 sends no `Access-Control-Allow-Origin` and 403s the preflight, so a
  WebView `window.fetch()` of bytes is blocked -> the cache byte-fetch MUST be native. `<img>` display
  needs no CORS (verified 200 with `Origin: https://localhost`).
- **Native download is available:** `Filesystem.downloadFile` is present in the installed
  `@capacitor/filesystem` 6.0.4; `CapacitorHttp` is already used for CORS-bypass in
  `src/store/deckRepository.js:529-538`.
- **Key simplification (verified):** the per-finish CDN key is exactly `${variant.slug}.webp` (the
  Curiosa slug already carries the finish token and equals the drop PNG basename), so the catalog
  repoint is `v.image = v.slug + '.webp'`, not a mapping layer.
- **Hard ordering (verified):** current catalog slugs are finish-stripped, R2 keys are finish-suffixed,
  so a seam swap before the pipeline repoint would 404 the whole app - this drives Phase 1-before-2.

## Where to attack hardest (the proposal's own open questions to you, plus)

1. **Independent seam-bypass re-sweep.** The proposal centralizes ~12 inline `${BASE}cards/${slug}`
   sites behind a new `artUrl()` seam + a mechanical guard test. Re-sweep independently for any the grep
   missed, especially DYNAMIC slug construction (string-built paths, template concatenation) the guard
   regex could miss. A missed site silently 404s against the CDN and bypasses zero-image mode.
2. **Pipeline partial-failure holes.** The new integrity order is `convert -> upload -> audit ->
   journaled promote`. Probe the seams: audit passes then the promote is interrupted (recovery path via
   the existing promote journal?); upload half-completes then the run dies; a re-run's upload-skip ledger
   vs a truly-missing object; `--dry-run` guarantees no network writes; a no-art (rules/FAQ-only) drop
   must still work with no `.env.r2`.
3. **`images.test.mjs` contract flip.** The proposal rewrites the test that currently asserts the
   foil-collapse (`droppedFoilDupes===1`). Confirm the new assertions don't lose coverage the old ones
   held (foil-only printings, missing-finish standard-fallback, reverse-face exclusion, unmatched scans,
   incremental drop against historical slugs).
4. **`CardArt` lazy-swap race/flicker.** Phase 3 swaps `<img src>` from remote URL to the local cached
   URI via `useEffect` after mount. Probe for: a swap landing after a remote load already started (double
   fetch / flicker), a swap after unmount, and whether the always-painted `cardFallbackArt` truly hides
   any pending/blank window.
5. **Reseed-on-repoint claim.** The proposal asserts the `variants[].image` repoint rides the existing
   content-hash reseed with no migration and cannot orphan user data (owned/wanted key on
   `canonicalPrinting(set,foil)`, independent of image slugs). Validate against the ACTUAL seeder
   implementation, not just `COMPENDIUM_DATA_MODEL.md`.
6. **Phase ordering vs an offline-regression window.** Is `3-before-5` (persistent cache before
   un-bundling) sufficient, and does the "Phases 1+2 ship as one release" discipline actually close the
   fallback-art window, or is there a device-state where an installed build regresses offline?
7. **The strongest objection in the Self-Critique** (fresh-install-offline shows placeholder art). Is the
   mitigation (zero-image invariant + first-online download prompt) adequate, or should a low-res starter
   subset be bundled? Owner has ruled the tradeoff; challenge whether the design honours it safely.

## Not in scope for this review

Implementation. No Phase-1 code is written; this reviews the DESIGN + the two prep scripts. Phase-by-phase
code reviews follow approval, one phase at a time.
