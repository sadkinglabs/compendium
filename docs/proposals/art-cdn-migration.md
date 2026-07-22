# Proposal: card art on a Cloudflare R2 CDN with an on-device cache, per-finish art end to end, and a ~72 MB slimmer APK

## Status and classification

**Status: Draft** (2026-07-22) · Risk: **High**
Owner: Claude Code / Fable (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner

High-risk because it touches native/plugin behavior (Filesystem, network), the catalog build pipeline and its promoted artifacts, the release packaging (APK contents), and §3 invariant 6 (graceful asset degradation) directly. Several owner decisions are already ruled and are encoded here as constraints, not options:

- Host is **Cloudflare R2**. All 3090 per-finish 745 px q80 WebP (285 MB) are uploaded and serving `200 image/webp`. **Production base URL is the owner's Cloudflare-registered custom domain `https://cdn.sadkinglabs.com`** (connected to the bucket as an R2 Custom Domain, so it is edge-cached), targeted from the first slim-APK release. The dev URL `https://pub-52a319c0f5e240eabb76b6a43d355620.r2.dev` is the interim build target until the domain shows Active; the switch is the one base-URL constant. Edge-caching from day one means the r2.dev rate-limit risk to the download-all pack is largely retired (owner decision: custom domain now, not deferred).
- **All card art** moves to the CDN and `public/cards/` stops shipping in the APK (~90 MB → ~18 MB). Set heroes (`public/sets/`) and element icons (`public/icons/`) **stay bundled** deliberately, so the Collection landing works fully offline (`src/store/cardArt.js:35-44` already documents this split).
- Cache posture is **lazy-cache-on-view (persistent) plus an optional "download all for offline" pack**. Accepted tradeoff, stated honestly: a fresh install with no network shows data-derived placeholder art until the first online session. Card **data** never leaves the device; zero-image degradation (§3.6) is the safety net that makes this shippable.
- Single art tier: 745 px q80 WebP. A 380 px thumbnail tier is a possible later optimization, out of scope.
- The catalog-drop pipeline must, on a new image drop, also emit per-finish WebP, upload the diff to R2, and repoint variant slugs. Foils are no longer dropped.

## Problem and success criteria

**Problems.**

1. **APK weight.** `assets/public/cards` is ~72 MB of the ~90 MB release APK (`BUILD.md:362-367`): 1,596 WebP, one per printing (verified: `public/cards` = 72 MB, 1,596 files). Art dominates the artifact and every future set makes it worse.
2. **Foils are invisible.** The image plan collapses finishes: `pickSource` (`scripts/catalog/images.mjs:21-26`) picks one scan per printing base, names it `<base>.webp` with the finish stripped (`images.mjs:59`), and points every variant at that one file (`images.mjs:71`). `report.droppedFoilDupes` literally counts thrown-away foil scans. The v11 collector-item model (card + set + finish) cannot show a foil's actual face.
3. **The card sheet is finish-blind.** `CollectionCardSheet.jsx` hardcodes the wishlist heart to `foil:false` (`src/components/CollectionCardSheet.jsx:314-317`, `:339-343`, `:345-351`) and always shows two steppers (Owned + Foil, `:417-420`) regardless of which finishes the printing actually has. The store layer already supports per-finish owned and wanted (`ownedRepository.js`: `wantedItemsForCard`, `setWantedForItem`, `addWantedForItem`, `qtyForInSet`, `setFoilInSet`, all keyed on `canonicalPrinting(set, foil)`), so the gap is purely presentational.

**Success criteria.**

1. A release APK ships without `public/cards/` and measures ~18 MB (evidence: measured APK before/after).
2. Every card render site resolves art through the single seam (`cardImageUrl` / a slug-grain sibling) against the R2 base; zero `${BASE}cards/` template literals remain outside `src/store/cardArt.js`, enforced by a mechanical guard test.
3. On device, art viewed once while online renders from the persistent local cache afterwards, including after app restart and in airplane mode.
4. "Download all for offline" fetches the full art set to `Directory.Data`, survives restart, is resumable, and reports progress.
5. `npm run update:catalog` on a drop containing foil scans emits per-finish WebP, uploads only new/changed objects to R2, and repoints `variants[].image` to per-finish slugs; `droppedFoilDupes` ceases to exist as a concept.
6. The card sheet shows a Standard/Foil finish control only when both finishes exist for the selected printing, locks to the only finish otherwise, drives one stepper, one heart, per-finish art, and the per-printing artist credit.
7. The zero-image gate (`localStorage['cx-no-images'] = '1'`, `BUILD.md:374-375`) still renders every screen from data alone, now including the previously bypassing sites.
8. A fresh install with no network is fully usable: all functionality, deterministic placeholder art everywhere (§3.6 verified by manual gate).

**Non-goals.**

- No 380 px thumbnail tier, no `srcset`/multi-resolution logic.
- No move of `public/sets/` or `public/icons/` (deliberately bundled).
- No production custom domain in this change (base URL is a single constant; the swap is follow-up).
- No store/repository/schema changes for the sheet redesign (none are needed; `SCHEMA_VERSION` untouched).
- No cache eviction policy beyond a manual "clear art cache" control (the corpus is bounded, ~285 MB worst case; see Self-Critique).
- No CSP introduction (flagged as optional follow-up hardening).

## Evidence and current architecture

**The art resolution seam.** `src/store/cardArt.js:29-33` `cardImageUrl(card)` returns `${BASE}cards/${card.image_slug}`, honoring zero-image mode via `imagesDisabled()` (`cardArt.js:24-26`, key `cx-no-images`). `src/components/CardArt.jsx:10-24` paints `cardFallbackArt` underneath, layers the `<img>` on top, and removes it on error - the §5 progressive-enhancement contract. `printingArt(card, setCode, foil)` (`src/store/printingRows.js:198-211`) returns a **bare slug, never a URL**, pinned by `src/store/printingRows.test.mjs:242` ("a bare slug, resolved later by cardImageUrl") and by its own doc comment (`printingRows.js:185-187`): "when card art moves to a CDN, only `cardImageUrl` changes."

**Seam bypasses (verified by grep, 12 render sites in 8 files + one canvas loader).** These build `${BASE}cards/${slug}` inline, so they would 404 against the CDN and already ignore zero-image mode:

- `src/pillars/AvatarPicker.jsx:97,120,137`
- `src/pillars/DeckDashboard.jsx:170,339,452`
- `src/pillars/Decks.jsx:28` *(missed by initial discovery; found in the verification sweep)*
- `src/pillars/DecksPager.jsx:470`
- `src/pillars/Home.jsx:185,478,512`
- `src/pillars/Play.jsx:138,169`
- `src/components/CreateDeckWizard.jsx:101`
- `src/store/deckPoster.js:71` (canvas `_loadImg`; `deckPoster.js:44` is only the slug shim, not a URL build)

`src/pillars/LifeCounter.jsx:594-600` documents the precedent: it used to bypass the resolver, which broke zero-image mode, and was fixed to route through `cardImageUrl`. Two near-misses that are **not** URL bypasses but **are** finish-blind slug pickers (they swap `image_slug` and render through `CardArt` → `cardImageUrl`): `CollectionCardViews.jsx:33-41` `artForSet` and `CollectionCardSheet.jsx:354-358` `imageForSet` (both prefer `/-s$/` slugs).

**Offline/runtime facts.** No CSP exists anywhere; INTERNET permission is present; Capacitor serves the app from `https://localhost`, so a remote `https://…r2.dev` `<img>` loads today with zero config. `@capacitor/filesystem` 6.0.4 and `@capacitor/preferences` 6.0.3 are installed; `src/native.js:9` imports Filesystem and uses `Directory.Cache` for share temp files (`native.js:68,86`) - the art cache must NOT reuse `Directory.Cache` (evictable, and semantically share-scratch). `isNative()` (`native.js:13`) is the established runtime branch. `fflate` ^0.8.3 is already a dependency. Curiosa import already uses CapacitorHttp on device (`BUILD.md:371-373`), precedent for CORS-free native fetches.

**Catalog pipeline.** `scripts/update-catalog.mjs` orchestrates pure engines in `scripts/catalog/`; art conversion happens at `update-catalog.mjs:96-107` via `convertOne` (`images.mjs:107-110`, **380 px q78** - diverging from the CDN converter's **745 px q80**, `scripts/catalog/cdn-convert.mjs:20-21`), then a journaled promote replaces `public/cards` wholesale (`update-catalog.mjs:109-124`). `cdn-convert.mjs` and `cdn-upload.mjs` are orphan tooling - correct in behavior (finish suffix preserved, `cdn-convert.mjs:5-8`; immutable cache headers, `cdn-upload.mjs:16`; `--check` healthcheck, `cdn-upload.mjs:48-58`) but not wired into the drop flow. Staging validation requires every `v.image` to be in the image manifest (`scripts/catalog/generation.mjs:142-144`), and the content hash folds in the sorted manifest, so a repoint auto-bumps the catalog version (`COMPENDIUM_DATA_MODEL.md:114-118`). `scripts/catalog/images.test.mjs:7-13` asserts the old collapse (`droppedFoilDupes === 1`, shared webp) and marks the exact contract to flip.

**Key simplification (verified).** The Curiosa variant `slug` already carries the finish token (`001-abundance-b-f`) and equals the drop PNG basename, which `cdn-convert.mjs` preserves as the WebP name. So the per-finish CDN key is exactly `${v.slug}.webp`, and the repoint is a lookup, not a mapping layer.

**Ordering constraint discovered in verification.** Today's catalog slugs are finish-stripped (`001-abundance-b.webp`, `images.mjs:59`) while R2 holds only finish-suffixed keys (`001-abundance-b-s.webp`, `-f.webp`). **The seam swap therefore hard-depends on the pipeline repoint**: swapping `cardImageUrl` to R2 first would 404 every single card. This drives the phase order below.

**Card sheet.** `useOwnedLedger(c.card_id, effSet)` at `CollectionCardSheet.jsx:288` already returns both `owned` and `foil` fields with per-field writes. Finish availability is computable via the permissive `finishesFrom(variantsOf(c), effSet)` (`printingRows.js:93-104`, exposed strictly as `printingFinishes` at `:114-116`); `printingArt` and `finishesFrom` are confirmed present on this branch. Artist credit per printing exists (`artistForSet`, `:360-363`) but is finish-blind.

**Bundling.** `public/cards/` rides Vite's default publicDir (`vite.config.js:30` sets only `base: './'`) → `dist/cards` → `cap sync` → APK assets. No automated gate asserts art counts or existence; `check:smoke` asserts rendered routes/text, not images; the zero-image mode is the mandated safety net.

## Assumptions and confidence

1. **R2 objects are complete and correct for every current catalog variant slug** (all 3090 per-finish WebP uploaded, 200 image/webp). Confidence: **medium-high** - owner-verified serving, but completeness against the exact catalog variant list is unverified. Validation: Phase 1 adds a pipeline audit step that HEADs (or consults the upload manifest for) every `v.image` the repoint will publish, and refuses to promote a catalog pointing at a missing object.
2. **Remote `<img>` loads from `https://localhost` (Capacitor WebView) need no CORS.** Confidence: **high**. *Verified (Claude, curl):* a GET of a real object with `Origin: https://localhost` returns `200 image/webp` with the immutable cache header - image display is not CORS-gated. Residual: device check in Phase 2 that the installed WebView renders it (browser-vs-WebView parity).
3. **Byte fetches for the cache avoid CORS entirely on native.** Confidence: **high** (upgraded from medium after verification). *Verified (Claude):* (a) r2.dev sends **no `Access-Control-Allow-Origin`** and 403s the preflight `OPTIONS` - so a WebView `window.fetch()` of the bytes WOULD be blocked, making the native path REQUIRED, not merely preferred; (b) `Filesystem.downloadFile` **is present** in the installed `@capacitor/filesystem` 6.0.4 (`node_modules/@capacitor/filesystem/dist/docs.json`); (c) `CapacitorHttp` is present and already used in-repo for exactly this CORS-bypass reason (`src/store/deckRepository.js:529-538`). So the primary and the fallback both exist today. Residual: Phase 3 device spike confirms `downloadFile` write behavior + `convertFileSrc` playback. R2 CORS still gets configured (assumption 6) for the poster's `crossOrigin` canvas path and browser dev, but the cache does not depend on it.
4. **`Capacitor.convertFileSrc` URLs render in `<img>` and are same-origin for canvas** (no taint). Confidence: **medium** - `convertFileSrc` serves through the app's own scheme handler; taint behavior must be observed. Validation: Phase 3/Phase 2 device evidence with `deckPoster` export.
5. **`Directory.Data` persists across app restarts and updates, and is removed on uninstall.** Confidence: **high** - documented Capacitor behavior on Android.
6. **Cross-origin images drawn to canvas taint it unless fetched with CORS.** Confidence: **high** - web platform behavior. Consequence: `deckPoster.js:71` breaks (`toDataURL` throws) if it naively loads the R2 URL. Validation/mitigation in Phase 2: `crossOrigin='anonymous'` + R2 CORS headers, and prefer the local cached file when present.
7. **r2.dev is rate-limited and not intended for production traffic.** Confidence: **high** (Cloudflare documents this). Accepted for the alpha; the custom domain is the ruled follow-up. The "download all" pack (~3090 requests) is the most likely surface to feel it - see open question 2.
8. **The repo can tolerate a window where the catalog points at per-finish slugs while `public/cards` still holds base-named files** (interim tree renders fallback art if installed, but nothing breaks). Confidence: **high** - `CardArt.jsx` `onError` → fallback is exactly the §5 contract. Mitigation: Phases 1+2 merge/install as one release (see plan).

## Affected systems and invariants

**Systems.** UI render sites (8 files + poster), `src/store/cardArt.js` (seam), new `src/store/artCache.js`, `src/components/CardArt.jsx` and `CardArtViewer.jsx`, Settings (download-all + clear-cache controls), catalog pipeline (`scripts/update-catalog.mjs`, `scripts/catalog/images.mjs`, `cdn-convert.mjs`, `cdn-upload.mjs`, `generation.mjs` untouched but re-exercised), `images.test.mjs`, packaging (`public/cards` removal), docs (`COMPENDIUM_DATA_MODEL.md`, `COMPENDIUM_ARCHITECTURE.md`, `COMPENDIUM_FEATURE_MATRIX.md`, `BUILD.md`, `CATALOG_DROP/README.md`), and `CollectionCardSheet.jsx`.

**§3 invariants, named per the constitution's requirement:**

1. **Catalog/profile boundary - holds.** Art is shared catalog content; the cache is derived shared content keyed by catalog slug, stored app-wide (the same reasoning that made `cx-no-images` app-wide in `docs/proposals/zero-image-toggle.md`: not profile-owned data). No profile writes anywhere in this change.
2. **Profile isolation - untouched.** No profile-scoped read/write path changes. The sheet redesign uses existing per-item repository writers unchanged.
3. **Durable, offline-first writes - unaffected, and this must stay provable.** Only *art* moves off-device. Every authoritative user datum (owned, wanted, decks, matches) remains in SQLite exactly as today. Cache loss is never data loss: every cached byte is re-fetchable from an immutable, slug-addressed object. The proposal deliberately does not route any user data through the network.
4. **Forward-only schema evolution - not applicable, with justification.** `SCHEMA_VERSION` is untouched. The `variants[].image` repoint is catalog content generation, which `COMPENDIUM_DATA_MODEL.md:118` explicitly distinguishes from schema evolution; the reseed token mechanism (string-inequality compare, `DATA_MODEL.md:116`) handles it with no migration.
5. **Transactional user-data operations - holds; extended to the pipeline.** The journaled promote stays. New integrity ordering: R2 upload completes and is verified **before** the catalog JSON that references those objects is promoted, so a published catalog never points at art that is not public.
6. **Graceful asset degradation - the load-bearing invariant.** This change *widens* its coverage: centralizing the 12 bypass sites makes `cx-no-images` and broken-image fallback actually total for the first time. The fresh-install-offline posture is, by design, the zero-image posture. Verified by the gate plus a manual airplane-mode-fresh-install check.
7. **Content is data - holds.** CDN keys are derived from catalog slugs; no card names, sets, or finishes are hardcoded. `SET_HEROES` (`cardArt.js:39`) is pre-existing and out of scope.
8. **Cross-runtime integrity - actively managed.** `artCache` branches on `isNative()`: native uses Filesystem + native HTTP; web returns the remote URL (no-op cache). Every native behavior claim requires device evidence (the automated gates exercise neither Filesystem nor native fetch).

One posture change must be named honestly: this introduces Compendium's **first runtime network dependency** (previous posture: "art is bundled for the offline-first constraint", `COMPENDIUM_DATA_MODEL.md:99`; "zero external/CDN deps" per prior practice). It is owner-ruled, confined strictly to card art as progressive enhancement, and documented in the reconciliation below. Fonts, icons, heroes, catalog data, and all user data remain bundled/local.

## Options considered

1. **Status quo.** Bundle one finish-collapsed WebP per printing. Rejected: 72 MB of a 90 MB APK, growing per set; foils permanently invisible; contradicts the v11 collector-item grain.
2. **Bundle per-finish art.** Fixes foils without a CDN. Rejected: ~3090 files at 745 px ≈ 285 MB APK (or ~140 MB at 380 px) - the opposite of the goal, and permanent git-history bloat.
3. **CDN + Service Worker / Cache API cache.** Rejected: WebView Cache API storage is opaque and OS-evictable; `Directory.Data` is app-private, persistent, inspectable, and already an established plugin surface. Also a SW adds a second runtime to reason about in Capacitor for no gain here.
4. **CDN + Filesystem cache (chosen), with two sub-options for the byte fetch:** (a) web `fetch()` + R2 CORS; (b) native HTTP (`Filesystem.downloadFile` / CapacitorHttp), no CORS dependency. **Chosen: (b) with R2 CORS configured anyway** - belt and suspenders: native path avoids the CORS failure mode entirely; the CORS policy still gets set for browser-dev caching honesty, the poster's `crossOrigin='anonymous'` path, and any future web deployment.
5. **Download-all as one zip via `fflate`** (single R2 object, one request, unzip on device) **vs per-file downloads** (resumable, idempotent, shares the lazy-cache write path, no 285 MB temp allocation). **Recommended: per-file with bounded concurrency and skip-if-present resume.** The zip stays a credible fallback if r2.dev rate limiting bites (open question 2); the pipeline could emit `art-pack-<version>.zip` later without redesign.
6. **Interim dual-destination bundling** (write per-finish files into `public/cards` during the transition so no fallback-art window exists). Rejected: commits ~140-285 MB to git history *permanently* to smooth a window that discipline handles for free (phases 1+2 ship in one release; APK builds are on-request only).

## Proposed design

**Seam (`src/store/cardArt.js`).**

```js
// Production: the edge-cached custom domain. r2.dev is the interim value until the R2 Custom
// Domain shows Active; swapping this one constant is the entire "go to production CDN" step.
const ART_CDN_BASE = 'https://cdn.sadkinglabs.com';

/** URL for a per-finish art slug, or null when suppressed/absent. THE seam. */
export function artUrl(slug) {
  if (imagesDisabled() || !slug) return null;
  return `${ART_CDN_BASE}/${slug}`;
}
export function cardImageUrl(card) { return artUrl(card?.image_slug); }
```

`artUrl(slug)` is the new slug-grain export (most bypass sites hold a slug string, not a card object). `setHeroUrl` and `elementIconUrl` are untouched (bundled by rule). All 12 bypass render sites switch to `artUrl(...)`/`cardImageUrl(...)`, which also brings them under zero-image mode for the first time (the `LifeCounter.jsx:594-600` precedent, applied everywhere). A mechanical **seam-guard test** (under `src/store/`, picked up by `test:query`) scans `src/**` for `` `cards/` `` URL-template usage outside `cardArt.js` and fails on any hit, so the bypass class cannot silently return.

**Cache (`src/store/artCache.js`, new; net ~120 lines).**

- Native: art lives at `art/<slug>` in `Directory.Data`. `resolveArt(slug)`: if the file exists → `Capacitor.convertFileSrc(uri)`; else return the remote URL and fire-and-forget a native download (`Filesystem.downloadFile` if available on 6.0.4, else CapacitorHttp → `Filesystem.writeFile`) so the *next* view is local. Writes are atomic-enough (download to `art/.tmp-<slug>`, rename on success) so an interrupted fetch never leaves a truncated file serving as art.
- Web: `resolveArt(slug)` returns the remote URL; no cache (dev preview unchanged).
- `CardArt.jsx` / `CardArtViewer.jsx`: initial `src` stays synchronous (`cardImageUrl`), a `useEffect` asks `artCache` and swaps `src` to the local URI when cached. First paint, fallback layering, and `onError` semantics are unchanged; a failed remote load still degrades to fallback art exactly as today.
- Download-all pack: iterate the distinct `v.image` slugs from the loaded catalog (no separate manifest needed - the catalog *is* the manifest), download with concurrency ~6, skip existing files (free resume), progress + cancel in a Settings "Storage" block, completion stamp in `@capacitor/preferences` (`artPack: { catalogVersion, count, bytes, completedAt }`). A catalog update simply re-runs against the new slug list; existing files skip. A "Clear art cache" action removes `art/` and the stamp.
- Eviction: none. The corpus is bounded (~285 MB total; lazy usage far less) and objects are immutable (`cdn-upload.mjs:16`). Manual clear covers pathological cases.

**Poster path.** `deckPoster.js` loads the avatar via `artCache.resolveArt` first (local file = no taint); when it must go remote it sets `crossOrigin='anonymous'` (requires the R2 CORS policy, configured in Phase 0/1). Failure keeps the current behavior: poster renders without the hero.

**Pipeline (`scripts/catalog/images.mjs` + `update-catalog.mjs`).**

- `planImages` flips to per-finish: for each variant, `v.image = dropOrKnown.has(v.slug) ? `${v.slug}.webp` : <fallback>`, where `<fallback>` is another scan of the same printing base (standard preferred), else `null` (placeholder at render). "Known" includes previously published slugs (the current committed manifest), so an incremental drop does not need every historical PNG present. Reverse-face scans stay excluded (`images.mjs:36`). Card-level default `image` keeps its rank rule (lowest set, standard first, `images.mjs:73-78`) and now names a per-finish file. Report: `droppedFoilDupes` is deleted; add `perFinish` (converted per-finish count) and keep `keptFoilOnly`, `noScan`, `unmatchedScans`, `skippedReverse`.
- `convertOne` defaults reconcile to **745 px q80** (one converter, one tier; `cdn-convert.mjs`'s constants become the shared default). Conversion output goes to the gitignored `CATALOG_DROP/cdn-art/` (idempotent skip, as `cdn-convert.mjs` does today); **`public/cards` is no longer a promote target** from Phase 1 on (it sits frozen until Phase 5 deletes it).
- `update-catalog.mjs` gains two stages between conversion and promote: **upload diff to R2** (reusing `cdn-upload.mjs` logic as an importable engine; skip objects already uploaded per a local upload ledger or HEAD probe) and **publish audit** (every `v.image` in the new catalog must be confirmed on R2). Order is strict: convert → upload → audit → journaled promote of the JSON. `--dry-run` never uploads. Missing `.env.r2` aborts with instructions *before* anything is written - a routine no-image drop (rules/FAQ only) that changes no art must still work without credentials (upload stage no-ops when the diff is empty).
- `images.test.mjs:7-13` is rewritten to assert the new contract (per-finish images per variant; standard-fallback for a missing finish scan; foil-only unchanged in spirit; no `droppedFoilDupes`). This is a deliberate contract flip, not a test weakened to pass - the old expectation is the defect.
- `CATALOG_DROP/README.md:12-13` ("foils... are sorted out for you") and `:59-60` ("art lives in public/cards") rewritten; `.env.r2` setup documented in `BUILD.md`.

**Card sheet (Phase 6, all inside `CollectionCardSheet.jsx`).** Add `finish` state (boolean foil), defaulted per printing: compute `finishesFrom(variantsOf(c), effSet)`; show a Standard/Foil `SegTabs` control (existing primitive, no new vocabulary per `DESIGN_SYSTEM.md`) only when both exist; lock to the sole finish otherwise (promos/foil-only lock to Foil). Replace the two always-on steppers (`:417-420`) with one stepper bound to the active finish via the existing `useOwnedLedger` fields (`:288`). Heart reads/writes use `canonicalPrinting(effSet, foil)` instead of hardcoded `foil:false` (`:314-317`, `:339-343`, `:347`). Art and artist follow the finish: replace `imageForSet`/`artistForSet` (`:354-364`) with `printingArt(c, effSet, foil)` and a finish-aware artist pick. Store layer: zero changes. The heart's "bare heart means non-foil" doctrine (`:305-306`) is superseded *only* when the user has explicitly selected Foil - an automatic finish default still writes non-foil, preserving the v11 "no silent guessing" rule.

**Error behavior.** Remote 404/timeout → `onError` → deterministic fallback (unchanged contract). Cache write failure → image still renders from remote; cache retries on next view. Pipeline upload failure → hard stop before promote, nothing published, re-run resumes. Pack download failure → partial cache is valid (every file independently useful), resume on next attempt.

## Implementation plan

Ordering rationale: **1 before 2** because R2 keys are per-finish and today's catalog slugs are not - a seam swap first would 404 the entire app. **3 before 5** because unbundling before a persistent cache exists would regress offline users with no recovery path. **4 before 5** so "download all" exists in the same release the bundle disappears. **6** needs 1+2 for per-finish *art* but is otherwise independent and reviewable standalone. Every phase leaves the repo releasable (§4.8): a build from any phase boundary degrades at worst to deterministic fallback art, never to a broken app. The intended **device-install point is after Phase 2** (an install from a Phase-1-only tree shows fallback art broadly; nothing breaks, but do not ship that window - branch discipline, both phases in one release).

- **Phase 0 - preflight (no production code).** Connect `cdn.sadkinglabs.com` as an R2 Custom Domain (Cloudflare auto-creates the CNAME + cert; wait for Active), then re-point `.env.r2` `R2_PUBLIC_BASE_URL` to it and re-verify serving + edge-cache headers. Configure the R2 bucket CORS policy (`Access-Control-Allow-Origin: *`, GET/HEAD) for the poster canvas + browser dev. Run `node scripts/catalog/cdn-upload.mjs --check`; device-verify a remote `<img>` renders in the installed app and that `crossOrigin='anonymous'` canvas draw is untainted. Checkpoint: **domain-live + CORS-verified**.
- **Phase 1 - pipeline emits per-finish + repoints + uploads.** `planImages` flip, `convertOne` 745/q80, upload + audit stages in `update-catalog.mjs`, `images.test.mjs` rewrite, README/BUILD pipeline docs. Verification is pure: `npm run test:catalog`, plus a real `npm run update:catalog -- --dry-run` against the current drop. Checkpoint: **pipeline-green** (report shows per-finish counts, audit passes, no upload on dry-run).
- **Phase 2 - seam swap + centralization.** `ART_CDN_BASE` in `cardArt.js`, `artUrl()` export, all 12 bypass sites through the seam, poster CORS/cache-first handling, seam-guard test. Run `update:catalog` for real (catalog version bumps, `v.image` goes per-finish). Device install: art renders from R2; zero-image gate passes app-wide; poster export works. Checkpoint: **CDN-live**.
- **Phase 3 - persistent lazy cache.** `src/store/artCache.js`, `Directory.Data`, native download spike (`Filesystem.downloadFile` vs CapacitorHttp), `CardArt.jsx`/`CardArtViewer.jsx` lazy swap, web no-op. Device evidence: view → airplane mode → restart → art persists. Checkpoint: **cache-proven**.
- **Phase 4 - download-all pack.** Settings "Storage" block (download with progress/cancel, clear cache, pack stamp in Preferences). Device evidence: full download, restart, airplane-mode full-app sweep; re-run skips existing; catalog-update top-up works. Checkpoint: **pack-proven**.
- **Phase 5 - stop bundling + doc reconciliation.** Delete `public/cards/` from the repo (pipeline stopped writing there in Phase 1); confirm nothing else references the directory (`update-catalog.mjs:23` CARDS_DIR removal, interrupted-promotion recovery message `update-catalog.mjs:42`, `scripts/assert-no-pending-catalog-promote.mjs` if it names the path); doc updates per the table below; `npm run check:docs`. Build APK, measure. Checkpoint: **slim-APK** (report before/after sizes).
- **Phase 6 - Standard/Foil card sheet.** The 8 change points in `CollectionCardSheet.jsx`. `npm run test:ui` (extract any new pure finish-defaulting logic per the UI-state pattern), device + TalkBack evidence. Checkpoint: **sheet-done**.

Each checkpoint uses the constitution §12 report format. Change ledger maintained per AGENTS §5 Phase E.

## Data migration and compatibility

**Not a schema migration.** `SCHEMA_VERSION` untouched; no table, repository, or export format changes. The catalog repoint rides the existing reseed mechanism: content hash changes → version token bumps → atomic reseed of catalog tables on next boot (`COMPENDIUM_DATA_MODEL.md:112-118`); profile tables are never touched by reseed, and `card_id` stability keeps `owned_cards`, `deck_entries`, and marginalia resolving with no migration. Owned/wanted keys are `canonicalPrinting(set, foil)` - independent of image slugs - so the repoint cannot orphan user data by construction. Old profile exports import unchanged (they carry no image URLs). Idempotency: re-running `update:catalog` with the same drop is a no-op (hash gate, `update-catalog.mjs:81-84`); re-running uploads skips existing objects; re-running the pack download skips existing files.

## Rollback and recovery

- **Phase 1:** `git revert` restores the collapse plan; the next `update:catalog` regenerates the old-shape catalog (reseed token compares by string inequality, not order, so "rolling back" catalog content is just another content change - inherently supported). R2 objects are additive and immutable; none are deleted, so no remote rollback exists or is needed.
- **Phase 2:** revert the seam commit; `public/cards` is still frozen in-tree until Phase 5, so a reverted build serves bundled art for base-named slugs again (requires reverting Phase 1's catalog output too - revert them as the pair they shipped as).
- **Phase 3/4:** revert code; orphaned files under `Directory.Data/art` and the Preferences stamp are inert (~≤285 MB reclaimable via uninstall; if a revert ships, include a one-line cleanup that removes `art/` on boot when the feature flag is absent).
- **Phase 5:** revert restores `public/cards` from git history (the files remain in history regardless - this is why Phase 1 stopped *writing* there rather than rewriting history). Installed slim APKs in the field keep working throughout: remote + cache does not depend on the bundle.
- **Phase 6:** revert the single component file; store untouched.
- **Point of no return: none for data.** Art source PNGs stay in `CATALOG_DROP`, converted WebP in `CATALOG_DROP/cdn-art`, published objects on R2, bundled history in git. No step destroys the ability to rebuild any prior state. The only irreversible external action is object *publication* to a public bucket, which is already the status quo.

## Verification plan

Per phase; native claims require device evidence with device/OS/WebView/build named (AGENTS §5F).

- **Automated:** `npm run test:catalog` (Phase 1 - rewritten `images.test.mjs`, planner edge cases: foil-only, missing-finish fallback, reverse exclusion, unmatched, incremental drop with historical slugs); `npm run test:query` (Phase 2/3 - `printingRows.test.mjs:242` slug contract must keep passing untouched; new seam-guard test; new `artUrl` unit tests incl. zero-image null); `npm run test:ui` (Phase 6 - finish-defaulting logic extracted pure); `npm run check:cycles`, `npm run check:types`, `npm run build` (all phases touching `src/**`); `npm run check:docs` (Phases 1, 5).
- **Pipeline integration:** real `update:catalog` run on the current drop (Phase 2), verifying: per-finish counts in the report, upload diff behavior on re-run (0 uploads), audit failure injection (temporarily rename one object reference → promote must refuse), `--dry-run` performs no network writes, missing `.env.r2` with a non-empty art diff aborts pre-promote.
- **Device (each of Phases 2-6):** zero-image gate (`cx-no-images=1`) full-route sweep - now covering the ex-bypass sites; art renders from R2 on Wi-Fi; airplane-mode after viewing (Phase 3) and after pack download (Phase 4) - art persists across force-stop and restart; **fresh-install + airplane-mode manual check** (Phase 5): every pillar usable, placeholders everywhere, no spinner deadlocks, no layout shift; poster export with remote-only and with cached avatar (taint check); `npm run check:smoke` before any release; APK size measured before/after Phase 5.
- **Accessibility (Phase 6):** TalkBack pass on the sheet - finish control announced with state, stepper labels carry the active finish, heart announces per-item wanted state; 48 dp targets; reduced-motion unaffected.
- **Regression:** Collection add flow, wishlist heart per-item semantics (v11 tests), deck poster share, Curiosa import (unrelated but shares CapacitorHttp surface - sanity check).

## Security, privacy, performance, and operations

- **Privacy:** no card *data* leaves the device - requests carry only art slugs. Honest note: Cloudflare observes device IP + which card images are requested (view-pattern metadata). Mitigation available to users: the download-all pack turns browsing patterns into one bulk fetch. No cookies, no auth, no user identifiers.
- **Security:** public read-only bucket; credentials (`.env.r2`) are gitignored, developer-machine only, and used exclusively by the pipeline (`cdn-upload.mjs:19-27`). The app holds no secrets. Slugs come from the bundled catalog, not user input - no injection surface into URLs beyond catalog content already trusted. Optional follow-up: a CSP restricting `img-src` to `'self'` + the art host.
- **Performance:** APK ~90 → ~18 MB. First view per image: one ~94 KB fetch (285 MB / 3090); subsequent views local. Immutable cache headers let the WebView's HTTP cache absorb repeat remote hits even pre-Filesystem-cache. Budget: cache ≤ ~285 MB worst case, surfaced in Settings with the clear control. R2 economics: zero egress fees; storage ≈ $0.004/month at 285 MB.
- **Operations:** `.env.r2` becomes a required developer-machine artifact for art-bearing catalog updates (documented in `BUILD.md` + `CATALOG_DROP/README.md`); routine no-art updates keep working without it. The distribution runbook gains one line: art-bearing drops require network + credentials during `update:catalog`. r2.dev → custom domain swap is a one-constant change + re-verify.

## Documentation impact

| Document | Disposition |
|---|---|
| `COMPENDIUM_DATA_MODEL.md` | **Update** `:99`: `variants[].image` becomes the per-finish slug resolved via the art CDN; "No external image URL is stored - art is bundled for the offline-first constraint" is rewritten to state the slug-not-URL contract, the CDN resolution seam, and the bundled-heroes/icons exception. Pipeline section gains the upload/audit stages. |
| `COMPENDIUM_ARCHITECTURE.md` | **Update** `:198` (pipeline description: per-finish conversion + R2 upload + audit, `public/cards` no longer an output). §5 (`:179-191`) **stays true and is the justification** - add one paragraph naming remote art + persistent cache + the fresh-install-offline = zero-image posture. Runtime posture: first runtime network dependency, art-only, owner-ruled. |
| `COMPENDIUM_FEATURE_MATRIX.md` | **Update**: Collection sheet per-finish owned/wanted/art capability; "download all art for offline" capability; APK-size status note. |
| `BUILD.md` | **Update** `:362-367` (size section: art no longer dominant; new numbers with evidence), add `.env.r2` setup, R2 CORS note, pipeline network step, fresh-install-offline manual gate alongside the existing `:374-375` zero-image note. |
| `DESIGN_SYSTEM.md` | **Reviewed, likely no change**: the finish control reuses `SegTabs`; if any new control variant emerges in Phase 6, it gets documented then. |
| `CATALOG_DROP/README.md` | **Update** `:12-13` (foils are no longer "sorted out" - they ship), `:59-60` (outputs: `public/catalog/` data + R2 art via `CATALOG_DROP/cdn-art/`), new failure modes (missing `.env.r2`, upload/audit failures). |
| `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` | **Reviewed - no change** (no process change). |

`npm run check:docs` runs at Phases 1 and 5; mechanical pass does not substitute for the semantic reconciliation above.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation / owner |
|---|---|---|---|
| A bypass site missed by the sweep 404s silently against the CDN | Low (grep-verified list + one extra found; guard test closes the class) | Cosmetic - fallback art | Seam-guard test in Phase 2; Codex independent re-sweep requested |
| Rate limiting during pack download or tester spike | Low (custom domain `cdn.sadkinglabs.com` is edge-cached from launch; r2.dev is build-only) | Slow/failed art loads (never broken UX - fallbacks) | Resume-capable pack; zip fallback documented if ever observed |
| `Filesystem.downloadFile` not available/reliable on 6.0.4 | Medium | Cache falls back to CapacitorHttp path (slower, base64 bridge) | Phase 3 device spike before committing the primitive |
| Canvas taint breaks poster export | Medium if unhandled | Share feature regression | Cache-first load + `crossOrigin` + R2 CORS; explicit device test |
| R2 object set incomplete vs catalog variant list | Low | Specific cards fall back to placeholder | Phase 1 publish audit refuses to promote a dangling reference |
| Interim install between Phases 1 and 2 shows widespread fallback art | Low (installs are on-request) | Cosmetic, looks unfinished | Phases 1+2 ship as one release; stated install point |
| Fresh-install-offline users see no photography at all | Certain by design | UX expectation risk | Owner-accepted tradeoff; §5 placeholders are "intentional, not broken" (`ARCHITECTURE.md:191`); pack offered on first online session |
| Pipeline now needs network mid-run | Certain | A drop can fail on upload | Strict convert→upload→audit→promote order; nothing promoted on failure; resumable |

**Owner decisions (resolved 2026-07-22):**
1. **Custom domain now.** `cdn.sadkinglabs.com` (Cloudflare-registered) is connected from the first slim-APK release; r2.dev is interim-build only. Edge-cached from day one.
2. **Per-file pack** (resumable, skip-if-present). Zip stays a documented fallback only if a rate limit is ever observed (unlikely on the edge-cached custom domain).
3. **"Storage" Settings block confirmed**, and the app **prompts** to download the pack on first online session (dismissible), in addition to the always-on automatic lazy cache. Two mechanisms coexist: lazy-cache-on-view is automatic and silent; download-all is the optional one-tap for full offline.
4. **No auto-eviction** for the alpha. The device art cache grows only to what is viewed (or the full ~285 MB if the pack is downloaded); the sole removal is the manual "Clear art cache." Accepted.
5. **Finish follows the toggle.** The sheet's Standard/Foil toggle is the source of truth: heart, stepper, and art all reflect the selected finish, and the heart writes that exact, on-screen (set, finish) collector item. The set is shown in the picker and the finish in the toggle, so the write is always explicit - never a silent guess (v11 doctrine preserved).

**Open questions - Codex:** (a) independently re-sweep for seam bypasses (including dynamic slug construction the grep pattern could miss); (b) challenge the convert→upload→audit→promote ordering for partial-failure holes (e.g. audit passes, promote interrupted, recover path); (c) review the `images.test.mjs` contract flip for lost coverage; (d) probe the `CardArt` lazy-swap for flicker/race (src swap after remote load started); (e) verify the reseed-on-repoint claim against the seeder implementation, not just `DATA_MODEL.md`.

## Self-Critique

1. **Strongest case this design is wrong.** Compendium's identity is "strict offline-first, zero external deps" - and this proposal introduces a runtime network dependency and accepts that a fresh offline install has no photography. If testers experience placeholder-only screens as "broken app" rather than "intentional degradation," we traded the product's core promise for 72 MB. The counterargument is that the owner ruled it with eyes open, card *function* never degrades (§5 was built for exactly this), and the pack restores full offline richness in one action - but the objection is real and the first alpha after Phase 5 should watch for it explicitly.
2. **Highest-consequence assumption if false.** Assumption 1 (R2 completeness vs the exact catalog variant list). If wrong and unaudited, specific printings silently regress to placeholders forever with no error anywhere. That is why the publish audit is in Phase 1 as a promote-blocking gate, not a nice-to-have. Second place: assumption 4 (`convertFileSrc` untainted canvas) - if false, the poster path needs the CORS route exclusively, which then *must* work.
3. **Simpler solution rejected, and was it rejected fairly?** Bundling per-finish art (option 2) is dramatically simpler - no network, no cache, no CORS, no pipeline upload - and it was rejected on APK size alone. That is fair at 285 MB, but a 380 px per-finish bundle (~140 MB) was not seriously costed and would fix foils without any of this machinery. It fails the stated ~18 MB goal and worsens the growth trend, so the rejection stands, but a reviewer should know the "boring" option existed. Also rejected: swapping the seam without the cache (Phases 1-2 only, defer 3-5), which delivers foils + CDN sooner; the phasing already allows shipping exactly that if the cache work stalls.
4. **Coupling/regression the analysis may have missed.** Three candidates. (i) `CollectionCardViews.jsx:39` and `CollectionCardSheet.jsx:357` pick slugs by `/-s$/` regex - after the repoint every slug carries a finish token, so these *start matching differently* (today they match nothing since bases are finish-stripped; afterwards they genuinely prefer `-s`). Behavior likely improves, but it is an unreviewed behavior change riding a data change. (ii) The WebView's own HTTP cache interacting with the Filesystem cache could mask cache bugs in testing (it "works offline" briefly via HTTP cache, then evicts). Device tests must force-stop and clear WebView cache to isolate the Filesystem layer. (iii) `check:smoke` and the widget/dashboard art paths (`Home.jsx` widgets) now depend on network timing at first paint - watch for layout-shift or spinner regressions on slow links.
5. **Failure most likely to escape the test plan.** A slow-network cell connection (not offline, not fast): images neither load promptly nor error, so fallbacks never trigger and rows show empty boxes during long pending fetches. Airplane-mode tests (instant error) and Wi-Fi tests (instant success) both miss it. Mitigation to carry into Phase 3: verify `CardArt`'s fallback is painted *underneath* from first paint (it is - `CardArt.jsx:14`), so "pending" already looks intentional; test once with throttled network anyway.
6. **Evidence that would change direction.** (i) Phase 0 finding that WebView canvas taints even from `convertFileSrc`, or that R2 CORS cannot be made to work from `https://localhost` - the poster and web-dev stories would need redesign. (ii) A Phase 3 spike showing native downloads are unreliable on the device fleet (WebView/plugin quirks) - would push toward the zip-pack-first posture or reopen option 2 at 380 px. (iii) Real tester feedback that placeholder-first fresh installs read as broken - would promote the "prompt to download pack on first launch" from open question to requirement, or revisit bundling a low-res starter subset.

## Approval record

Pending. Reviewer disposition: - · Required revisions: - · Human decision: - · Date: -
