# Codex review brief - art-cdn Phase 5 (stop bundling card art)

**Branch:** `art-cdn-phase5` (off `main`)
**Diff:** `git diff main...HEAD` - code/docs is 14 files (+78/-95); plus the mechanical manifest strip
(`public/catalog/art-manifest.json`: 3,084 `legacyKey` removals) and 1,596 `public/cards/*.webp` deletions.
**Build:** 198. **APK: 90.5 MB -> 22.9 MB** (`dist` 7.1 MB). CDN `cdn.sadkinglabs.com` serves all 3,090 WebP
(owner device-confirmed art loads online).
**Purpose:** execute the already-approved **Phase 5** of `art-cdn-migration.md` ("stop bundling + doc
reconciliation") so the app ships fully CDN-reliant. This is the final reviewed phase of that migration.

## Gate status (repo, all green)
`test:catalog` 113 · `test:query` 819 · `test:ui` 181 · `test:app` 17 · `check:types` · `check:cycles` (147) ·
`check:source` (**now asserts no bundled card art**) · `check:docs` · `build`. **`check:smoke` + the Phase-5
device fresh-install/airplane sweep are the remaining pre-merge gates** (device-gated).

## What changed (and the load-bearing decisions to attack)

1. **Manifest `legacyKey` strip - done SURGICALLY, no catalog-version bump.** Rather than re-run the full
   `update:catalog` pipeline (which re-fetches Curiosa + re-audits R2, conflating a data refresh with
   "stop bundling"), `legacyKey` was deleted from every committed manifest entry directly. **Justification
   to verify:** the art manifest is fetched at boot by `loadArtManifest()` (`artCacheInstance.js`) and is
   NOT an input to the catalog-version reseed hash (`catalogVersion.json`), so the app reads the stripped
   manifest fresh with no reseed needed. `assertManifest` accepts a missing `legacyKey`. The pipeline
   machinery that would strip it on a future rebuild is retained (`normalizeTransitional` +
   `bundledExists: () => false`) and its Phase-5 test already passes ("legacyKey stripped with no bundled
   dir"). **Please confirm** the manifest is genuinely outside the reseed hash and that a shipped stripped
   manifest can't desync from any consumer.

2. **`legacy` candidate retired end to end.** `cardArt.legacyUrl` removed; `artCache` dropped `legacySrc`
   + the `legacyUrl` dep; `artCacheInstance` stopped wiring it; `artSource` removed the `'legacy'` kind and
   the `IMG_ERROR` `remote -> legacy` branch (a CDN miss now goes `remote -> broken -> deterministic
   element-gradient placeholder`); `ArtImage` no longer passes `legacy`. Tests updated (artCache, artSource).
   **Please attack** the resolver: a remote miss, a cached-file corruption (quarantine still intact), the
   generation guard, and zero-image (still returns null before any I/O).

3. **Guard hardened.** `check:source` now flags a bundled `cards/` path in EVERY file (the cardArt.js
   exemption is gone) and asserts `public/cards` is absent (`bundleAbsent()`), so no build can re-ship the
   bundle. Guard test flipped accordingly.

4. **Pipeline + docs.** `update-catalog.mjs` CARDS_DIR removed, `bundledExists -> () => false`, recovery
   message + `assert-no-pending` cleaned of `public/cards`; BUILD.md size/offline notes; migration doc
   Phase 5 marked EXECUTED.

## Invariants
- **Offline-first + zero-image (§3.6):** the behaviour change is intentional and owner-approved - a FRESH
  install with no network shows the deterministic element-gradient placeholders for card art until the
  device has been online once (then art caches on-device via `artCache`). Set-hero logos (`public/sets/`)
  stay bundled so the Collection landing is legible offline. The device fresh-install/airplane sweep is the
  gate that proves "every pillar usable, placeholders everywhere, no spinner deadlocks, no layout shift."
- No schema/data-model change; `card_id`-keyed user data is untouched; profile exports carry no image URLs.

## Rollback
Per the migration doc: `git revert` restores `public/cards` from history (files remain in git history) and
the manifest's `legacyKey`. Installed slim APKs keep working (remote + cache never depended on the bundle).

## Disposition asked
Confirm Phase 5 for an alpha release from `main` (after the device sweep + `check:smoke`). The surgical
manifest strip (§1) is the decision I'd most want a second set of eyes on.
