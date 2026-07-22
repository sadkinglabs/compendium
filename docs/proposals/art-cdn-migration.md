# Proposal: card art on a Cloudflare R2 CDN with an on-device cache, per-finish art end to end, and a ~72 MB slimmer APK

## Status and classification

**Status: Draft rev 2** (2026-07-22) · Risk: **High**
Owner: Claude Code / Fable (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner

**Rev 1 disposition: Changes required.** Rev 2 resolves every blocker/major/minor. The two
architectural redesigns are specified in full in the companion **`art-cdn-rev2-architecture.md`**
(Section A content-addressed identity, Section B the shared `artCache`/`ArtImage` boundary); this
document is updated to match and to fix the tooling, phasing, and doc-consistency findings.

### Response to the rev-1 disposition

| Finding | Resolution (rev 2) |
|---|---|
| **Blocker - immutable URLs not content-addressed** (corrected art stays stale) | **Content-addressed keys** `<slug>.<sha256-12>.webp` + a committed `public/catalog/art-manifest.json` (`{key, sha256, bytes, srcSha256}`) that is the single source of truth for conversion-skip, upload-diff, publish-audit, the catalog hash, and rollback. New bytes -> new key -> new URL at every layer -> reseed, with **no purge concept anywhere**. Full design: companion **Section A**. |
| **Major - prep tooling + recovery fail open** | Convert/upload become importable **engines** with CLI wrappers that exit non-zero on any failure; write-through unique temp then validate (size vs manifest) then rename; upload-skip only on **authoritative remote evidence** (`ListObjectsV2` + server-side `x-amz-checksum-sha256`), never a local ledger; the publish audit checks the real remote object set; the promotion journal records the manifest digest and `--recover` **re-audits remote** before completing; `--dry-run` proves zero PUT/DELETE via an injected network seam; `--check` fails on absent base / non-2xx / wrong body / content-type / cache header. Detailed in *Pipeline (rev 2)* below. Also acknowledged: 3,088 catalog slugs vs 3,090 files - 5 variants legitimately `image:null`, 7 extras (reverse faces) - so completeness is proven by the manifest-vs-catalog audit, never by a file count. |
| **Major - Phase 1 an unsafe activation boundary** | Phase 1 builds/tests/uploads a **dormant** engine and does **not** promote the committed catalog. **Activation is one atomic step** (Phase 2) combining runtime seam + catalog repoint + remote audit + version bump. A **legacy printing-base fallback** covers offline upgrades until Phase 5 removes bundled art (a finish-specific remote miss falls back to the old bundled base image). The "every phase separately releasable" claim is withdrawn; see *Implementation plan (rev 2)*. |
| **Major - cache neither app-wide nor race-safe** | One shared **`artCache`/`useArtSource`/`ArtImage`** boundary used by **every** card-art site (all 14 inline + CardArt/Viewer + poster): native local-first, single-flight per key, epoch-guarded atomic promote, quarantine-on-decode-failure, no parallel remote `<img>`, zero-image prohibits render **and** I/O, Clear serialized against downloads, and `Directory.Data/art` **excluded from Android backup** (`allowBackup="true"` today). Full design: companion **Section B**. |
| **Minor - seam count + guard + facts** | Corrected to **14 inline `<img>` sites + the poster canvas** (the 15th grep hit is the `LifeCounter` comment). The guard test strips comments, bans `${BASE}cards/` **and** `artUrl`/`cardImageUrl` use outside the boundary, asserts no `dist/cards` after Phase 5, and manual zero-image coverage is retained (source scanning can't prove `<img src={null}>` shows the fallback - the `ArtImage` `bare` mode is the structural fix). Doc contradictions reconciled (custom domain is **now**, not deferred; Phase 0 connects the already-live domain; `.env.r2.example` updated). `aws4fetch` was added as a devDependency - called out for explicit approval. |
| **Suggestion - one selector for art + credit** | Phase 6 uses **one pure selector** returning the chosen variant's `{ slug, artist, product }`, so a dual Foil/Rainbow promo never shows Rainbow art with another variant's credit. |
| **Confirmed by Codex (no change)** | The reseed-on-repoint claim (holds given the version token actually moves - content-addressing guarantees it does); the fresh-install-offline tradeoff (owner-ruled, not reopened). |

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
- The production custom domain `cdn.sadkinglabs.com` IS in scope (already live + edge-cached); the base URL is a single constant. (Corrects a rev-1 contradiction with the status section.)
- No store/repository/schema changes for the sheet redesign (none are needed; `SCHEMA_VERSION` untouched).
- No cache eviction policy beyond a manual "clear art cache" control (the corpus is bounded, ~285 MB worst case; see Self-Critique).
- No CSP introduction (flagged as optional follow-up hardening).

## Evidence and current architecture

**The art resolution seam.** `src/store/cardArt.js:29-33` `cardImageUrl(card)` returns `${BASE}cards/${card.image_slug}`, honoring zero-image mode via `imagesDisabled()` (`cardArt.js:24-26`, key `cx-no-images`). `src/components/CardArt.jsx:10-24` paints `cardFallbackArt` underneath, layers the `<img>` on top, and removes it on error - the §5 progressive-enhancement contract. `printingArt(card, setCode, foil)` (`src/store/printingRows.js:198-211`) returns a **bare slug, never a URL**, pinned by `src/store/printingRows.test.mjs:242` ("a bare slug, resolved later by cardImageUrl") and by its own doc comment (`printingRows.js:185-187`): "when card art moves to a CDN, only `cardImageUrl` changes."

**Seam bypasses (verified by grep, 14 inline `<img>` render sites in 8 files + one canvas loader; the 15th `${BASE}cards/` grep hit is the `LifeCounter.jsx:594` comment).** These build `${BASE}cards/${slug}` inline, so they would 404 against the CDN and already ignore zero-image mode. Rev 2 routes ALL of them through the shared `ArtImage` boundary (companion Section B, adoption map B5), not merely through a URL formatter:

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
6. **Graceful asset degradation - the load-bearing invariant.** This change *widens* its coverage: routing the 14 bypass sites + poster through the shared `ArtImage` boundary makes `cx-no-images` and broken-image fallback actually total for the first time. The fresh-install-offline posture is, by design, the zero-image posture. Verified by the gate plus a manual airplane-mode-fresh-install check.
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

`artUrl(slug)`/`cardImageUrl` remain the URL formatters, but per **companion Section B** they become
*private to the boundary*: **only `artCache` may call them for card art**. Every render site (14
inline + CardArt/Viewer + poster) consumes the shared `ArtImage`/`useArtSource` boundary, never a URL
directly. The `bare` mode renders an `<img>` only when the boundary yields a real src, else the
fallback node - so zero-image mode can never produce an empty `<img>` (Codex's Minor). `setHeroUrl`/
`elementIconUrl` are untouched (bundled by rule).

**Cache - rev 2, full design in companion Section B.** One `src/store/artCache.js` (pure core over an
injected `io` adapter) owns every art byte: native **local-first** (validate a cached file by exact
size-vs-manifest, no parallel remote `<img>`), **single-flight** per content key, **epoch-guarded**
atomic temp->rename promote, **quarantine + one retry** on decode failure, failures never memoized;
web returns the remote URL. Zero-image mode prohibits render **and** I/O at the same line. Files live
at `art/<content-key>` in `Directory.Data`, **excluded from Android backup** (B8). "Clear cache" is
serialized against downloads by the epoch gate; the pack's Preferences stamp is reporting-only
(completeness = files-vs-manifest, never the stamp). Because keys are content-addressed (Section A),
the cache needs no TTL, no revalidation, and no purge.

**Seam-guard test (extended):** scans `src/**` and fails on any `${BASE}cards/` template AND on any
`artUrl`/`cardImageUrl` use outside `cardArt.js`/`artCache.js` (comments stripped first, so the
`LifeCounter.jsx:594` comment is not a false match); after Phase 5 it also asserts no `dist/cards`.
Manual zero-image route coverage is retained - a source scan cannot prove `<img src={null}>` reveals
the fallback; the `ArtImage` structure guarantees it.

**Poster path.** `deckPoster.js` resolves via `artCache.resolve(slug)` first (a local file sidesteps
canvas taint entirely); a remote-only first view sets `crossOrigin='anonymous'` (needs the R2 CORS
policy from Phase 0). Both paths require dedicated device taint evidence.

**Pipeline (rev 2 - content-addressed; full design in companion Section A).** Stage order becomes
`discover -> convert+digest -> build art-manifest (pure) -> buildGeneration({artManifest}) ->
validateGeneration -> [real run only] upload diff -> publish audit -> journaled promote`.

- **Content-addressed keys.** Conversion moves in FRONT of `buildGeneration` (resolving the
  chicken-and-egg: a content key is unknowable until bytes exist). A new engine
  `scripts/catalog/artManifest.mjs` produces `public/catalog/art-manifest.json` -
  `{ slug -> { key: `<slug>.<sha256(outputBytes)[:12]>.webp`, sha256, bytes, srcSha256 } }` - and
  `planImages` sets `v.image = manifest.objects[v.slug]?.key ?? keyOfSiblingFinish(...) ?? null`
  (`images.mjs:71`). The catalog content hash (`generation.mjs:95`) folds in the **serialized
  manifest (keys + full digests)**, not filenames - closing the exact stale-art hole. `convertOne`
  reconciles to **745 px q80**; `images.test.mjs` flips its contract (per-finish; missing-finish
  standard fallback; foil-only; reverse-face exclusion; **corrected-bytes-under-same-slug -> new
  key**; no `droppedFoilDupes`). `printingArt`'s "returns a slug, never a URL" contract survives -
  the slug is simply the content key now.
- **Hardened tooling (no fail-open).** `cdn-convert`/`cdn-upload` become importable **engines**;
  their CLI wrappers **exit non-zero on any failure** (today `cdn-convert` counts failures but exits
  0 - `cdn-convert.mjs:66`). Every write is **temp -> validate (size vs manifest / magic / digest)
  -> atomic rename**, so a truncated or wrong output never serves. Upload skips a key **only on
  authoritative remote evidence** (`ListObjectsV2` + `x-amz-checksum-sha256` on PUT so R2 rejects
  corrupt writes), never a local ledger. The **publish audit** confirms every distinct `v.image` is
  a manifest key AND present remotely with matching size (one listing, not 3090 HEADs) and **refuses
  the promote on any miss**. `--dry-run` proves **zero PUT/DELETE** through an injected network seam.
  `--check` fails (non-zero) on absent public base, non-2xx GET, wrong body, wrong content-type, or
  wrong cache header. Note: `--dry-run` may now encode new scans into the gitignored
  `CATALOG_DROP/cdn-art/` staging (nothing under `public/`/`src/` is touched) - a deliberate,
  documented change to the "writes nothing" wording at `update-catalog.mjs:4`.
- **Recovery re-audits remote.** The promotion journal records the manifest digest; `--recover`
  **re-runs the publish audit against R2** before completing the catalog/version promote, so a
  green *local* recovery can never publish references to missing/stale remote objects.
- **Completeness is proven, not counted.** There are 3,088 distinct catalog variant slugs vs 3,090
  converted files: 5 variants legitimately stay `image:null` (no scan), 7 files are extras (reverse
  faces, excluded). "3,090 uploaded" is not proof of catalog completeness - the manifest-vs-catalog
  publish audit is. Incremental drops stay legal (a slug with an unchanged `srcSha256`, or no source
  PNG present but an existing manifest entry, keeps its key).
- `CATALOG_DROP/README.md:12-13` / `:59-60` and `BUILD.md` are rewritten (per-finish, R2 upload,
  `.env.r2`, the manifest).

**Card sheet (Phase 6, all inside `CollectionCardSheet.jsx`).** Add `finish` state (boolean foil), defaulted per printing: compute `finishesFrom(variantsOf(c), effSet)`; show a Standard/Foil `SegTabs` control (existing primitive, no new vocabulary per `DESIGN_SYSTEM.md`) only when both exist; lock to the sole finish otherwise (promos/foil-only lock to Foil). Replace the two always-on steppers (`:417-420`) with one stepper bound to the active finish via the existing `useOwnedLedger` fields (`:288`). Heart reads/writes use `canonicalPrinting(effSet, foil)` instead of hardcoded `foil:false` (`:314-317`, `:339-343`, `:347`). Art, artist, and origin follow the finish through **one pure selector** `selectPrinting(c, effSet, foil) -> { slug, artist, product }` (Codex suggestion), replacing the separate `imageForSet`/`artistForSet` (`:354-364`) so a dual Foil/Rainbow promo can never show Rainbow art with another variant's artist credit; the resolved `slug` renders through the `ArtImage` boundary. Store layer: zero changes. The heart's "bare heart means non-foil" doctrine (`:305-306`) is superseded *only* when the user has explicitly selected Foil - an automatic finish default still writes non-foil, preserving the v11 "no silent guessing" rule.

**Error behavior.** Remote 404/timeout → `onError` → deterministic fallback (unchanged contract). Cache write failure → image still renders from remote; cache retries on next view. Pipeline upload failure → hard stop before promote, nothing published, re-run resumes. Pack download failure → partial cache is valid (every file independently useful), resume on next attempt.

## Implementation plan

**Activation is atomic (rev 2, per Codex).** The dangerous coupling is that a repointed catalog
(content-addressed keys) and the runtime resolver (`artCache` + `ART_CDN_BASE`) must land together:
a build with one but not the other regresses every card to fallback. Rev 2 therefore does **not**
claim every phase is separately releasable. Phase 1 builds and tests the pipeline + engines and
uploads objects, but **does not promote the committed catalog** - the shipped `cards.json` still
points at bundled base-named files, so the tree stays fully releasable. **Phase 2 is the single
atomic activation**: it lands the runtime seam/`artCache`, promotes the repointed catalog, runs the
remote audit, and bumps the version - all in one release. Until Phase 5 removes bundled art, the
resolver keeps a **legacy fallback**: a content-addressed remote miss for a slug whose old
printing-base file is still bundled falls back to that bundled image, so an offline *upgrade* to a
Phase-2 build never loses photography before the cache is populated. `3 before 5` (persistent cache
before un-bundling) and `4 before 5` (pack before the bundle disappears) still hold. Phase 6 needs
the per-finish art of Phases 1-2 but is otherwise standalone.

- **Phase 0 - preflight (no production code).** Custom domain already connected + verified (live,
  edge-cached, `.env.r2` pointed at `cdn.sadkinglabs.com`). Remaining: configure the R2 bucket CORS
  policy (`Access-Control-Allow-Origin: *`, GET/HEAD) for the poster canvas + browser dev; device-
  verify a remote `<img>` renders and a `crossOrigin='anonymous'` canvas draw is untainted; harden
  `cdn-upload.mjs --check` to fail non-zero. Checkpoint: **CORS + check verified**.
- **Phase 1 - pipeline + engines (DORMANT; no catalog promote).** `artManifest.mjs`, content-
  addressed `planImages`, the manifest-in-content-hash change, hardened convert/upload/audit engines
  with non-zero CLIs and the injected dry-run seam, `images.test.mjs` contract flip, README/BUILD
  docs. Objects may be uploaded (additive, safe). **The committed catalog is NOT repointed/promoted.**
  Verification is pure: `npm run test:catalog` (incl. the corrected-scan + audit-refusal + dry-run
  tests), a real `--dry-run`. Checkpoint: **pipeline-green, dormant**.
- **Phase 2 - ATOMIC ACTIVATION.** `ART_CDN_BASE` + `artUrl` in `cardArt.js`; `src/store/artCache.js`
  (native download via `Filesystem.downloadFile`, fallback `CapacitorHttp`); `useArtSource`/`ArtImage`;
  all 14 inline sites + CardArt/Viewer + poster adopt the boundary; the legacy bundled fallback; the
  extended seam-guard test. **In the same release**, run `update:catalog` for real (catalog repoints
  to content keys, version bumps, remote audit passes). Device install: art renders from CDN, caches
  on view, persists in airplane mode after restart; zero-image gate passes app-wide (ex-bypass sites
  now covered); poster export works both paths. Checkpoint: **CDN-live + cached**.
- **Phase 3 - download-all pack + backup exclusion.** Settings "Storage" block (download w/
  progress+cancel, clear cache serialized via the epoch gate, `stats()` completeness = files-vs-
  manifest); Android `backup_rules.xml` + `data_extraction_rules.xml` excluding `art/`. Device
  evidence: full download, restart, airplane full-app sweep; re-run skips existing; clear mid-pack;
  `adb bmgr` backup/restore confirms `art/` absent + profile data intact. Checkpoint: **pack-proven**.
- **Phase 5 - stop bundling + doc reconciliation.** (No Phase 4 - the cache landed with activation in
  Phase 2 and the pack in Phase 3.) Delete `public/cards/` + the legacy fallback; confirm no
  references remain (`update-catalog.mjs` CARDS_DIR, recovery message, `assert-no-pending...`);
  seam-guard asserts no `dist/cards`; docs per the table; `check:docs`. Build APK, measure. Checkpoint:
  **slim-APK**.
- **Phase 6 - Standard/Foil card sheet.** The change points in `CollectionCardSheet.jsx` incl. the
  one `selectPrinting` selector. `npm run test:ui` (pure finish-defaulting logic), device + TalkBack
  evidence. Checkpoint: **sheet-done**.

Each checkpoint uses the constitution §12 report format. Change ledger maintained per AGENTS §5 Phase E.

## Data migration and compatibility

**Not a schema migration.** `SCHEMA_VERSION` untouched; no table, repository, or export format changes. The catalog repoint rides the existing reseed mechanism: content hash changes → version token bumps → atomic reseed of catalog tables on next boot (`COMPENDIUM_DATA_MODEL.md:112-118`); profile tables are never touched by reseed, and `card_id` stability keeps `owned_cards`, `deck_entries`, and marginalia resolving with no migration. Owned/wanted keys are `canonicalPrinting(set, foil)` - independent of image slugs - so the repoint cannot orphan user data by construction. Old profile exports import unchanged (they carry no image URLs). Idempotency: re-running `update:catalog` with the same drop is a no-op (hash gate, `update-catalog.mjs:81-84`); re-running uploads skips existing objects; re-running the pack download skips existing files.

## Rollback and recovery

- **Phase 1 (dormant):** nothing shipped changes - the committed catalog was never repointed. `git revert` of the engine/pipeline commits is a clean removal; uploaded R2 objects are additive/immutable and simply orphaned (no remote rollback needed).
- **Phase 2 (atomic activation):** revert the activation as the single unit it shipped as (seam + `artCache` + the repointed catalog + version bump). `public/cards` is still bundled until Phase 5, and the reverted catalog points back at base-named files, so a reverted build serves bundled art again. R2 keys are additive/immutable; the prior content-addressed keys still exist for a roll-forward. The reseed token's string-inequality compare handles either direction as "just another content change."
- **Phase 3:** revert code; orphaned files under `Directory.Data/art`, the Preferences stamp, and the backup-rules XML are inert (~≤285 MB reclaimable via uninstall; a shipped revert includes a boot-time `art/` cleanup when the feature is absent).
- **Phase 5:** revert restores `public/cards` from git history (the files remain in history regardless - this is why Phase 1 stopped *writing* there rather than rewriting history). Installed slim APKs in the field keep working throughout: remote + cache does not depend on the bundle.
- **Phase 6:** revert the single component file; store untouched.
- **Point of no return: none for data.** Art source PNGs stay in `CATALOG_DROP`, converted WebP in `CATALOG_DROP/cdn-art`, published objects on R2, bundled history in git. No step destroys the ability to rebuild any prior state. The only irreversible external action is object *publication* to a public bucket, which is already the status quo.

## Verification plan

Per phase; native claims require device evidence with device/OS/WebView/build named (AGENTS §5F).

- **Required resubmission evidence (Codex's list), by area:**
  - *Pipeline/content-addressing (Phase 1, `test:catalog` + new `artManifest`/`generation` tests):*
    corrected bytes under an unchanged source slug -> new key/`v.image`, old key absent;
    identical filenames + different manifest digests -> different content hash (the `generation.mjs:95`
    defect, pinned); conversion failure exits non-zero; a stale/truncated output is not skipped;
    upload-diff uploads exactly the absent keys and a re-run uploads zero (half-upload resume against
    a mocked remote listing); `--check` failure exits non-zero; audit failure prevents journal
    creation/promotion; `--recover` re-audits remote; `--dry-run` records zero network mutations
    (injected seam); prefix-collision throws; per-finish standard/foil/rainbow, foil-only,
    missing-scan fallback, reverse exclusion, unmatched scans, historical incremental art.
  - *Cache boundary (Phase 2/3, `test:query`/`test:ui` over the pure `artCache` core + fake `io`):*
    one native request for multiple simultaneous consumers (single-flight); a stale component
    resolution cannot win (generation guard); a corrupt cached file is evicted and recovered once,
    then falls back; zero-image mode performs zero art network/filesystem writes; `clear()` between a
    download's start and promote leaves `art/` empty (no reappear); a 404 is never cached; `stats()`
    completeness reflects files-vs-manifest even when the stamp claims done; the extended seam-guard
    (`printingRows.test.mjs:242` slug contract still green; no `${BASE}cards/` and no
    `artUrl`/`cardImageUrl` outside the boundary in `src/**`).
  - *Offline boundary:* the legacy bundled fallback works at the Phase-2 offline-upgrade boundary.
- **Standard gates each phase:** `check:cycles`, `check:types`, `build` (any `src/**`); `check:docs`
  (Phases 1, 5).
- **Device (each of Phases 2, 3, 5, 6):** zero-image gate (`cx-no-images=1`) full-route sweep - now covering the ex-bypass sites; art renders from the CDN on Wi-Fi and caches on view (Phase 2); airplane-mode after viewing (Phase 2) and after pack download (Phase 3) - art persists across force-stop and restart; **fresh-install + airplane-mode manual check** (Phase 5): every pillar usable, placeholders everywhere, no spinner deadlocks, no layout shift; poster export with remote-only and with cached avatar (taint check); `npm run check:smoke` before any release; APK size measured before/after Phase 5.
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

**Rev-1 Codex open questions - now answered in rev 2:** (a) re-sweep -> corrected to 14 inline + poster and closed with the extended seam-guard + the boundary; (b) partial-failure -> the promote journal records the manifest digest and `--recover` re-audits R2; (c) contract flip -> the corrected-scan/audit-refusal/fallback tests are in the resubmission list; (d) lazy-swap race -> replaced by the single-flight + generation-guarded boundary (Section B); (e) reseed -> Codex confirmed it holds given the version token moves, which content-addressing guarantees.

## Self-Critique

1. **Strongest case this design is wrong.** Compendium's identity is "strict offline-first, zero external deps" - and this proposal introduces a runtime network dependency and accepts that a fresh offline install has no photography. If testers experience placeholder-only screens as "broken app" rather than "intentional degradation," we traded the product's core promise for 72 MB. The counterargument is that the owner ruled it with eyes open, card *function* never degrades (§5 was built for exactly this), and the pack restores full offline richness in one action - but the objection is real and the first alpha after Phase 5 should watch for it explicitly.
2. **Highest-consequence assumption if false.** Assumption 1 (R2 completeness vs the exact catalog variant list). If wrong and unaudited, specific printings silently regress to placeholders forever with no error anywhere. That is why the publish audit is in Phase 1 as a promote-blocking gate, not a nice-to-have. Second place: assumption 4 (`convertFileSrc` untainted canvas) - if false, the poster path needs the CORS route exclusively, which then *must* work.
3. **Simpler solution rejected, and was it rejected fairly?** Bundling per-finish art (option 2) is dramatically simpler - no network, no cache, no CORS, no pipeline upload - and it was rejected on APK size alone. That is fair at 285 MB, but a 380 px per-finish bundle (~140 MB) was not seriously costed and would fix foils without any of this machinery. It fails the stated ~18 MB goal and worsens the growth trend, so the rejection stands, but a reviewer should know the "boring" option existed. Also rejected: swapping the seam without the cache (Phases 1-2 only, defer 3-5), which delivers foils + CDN sooner; the phasing already allows shipping exactly that if the cache work stalls.
4. **Coupling/regression the analysis may have missed.** Three candidates. (i) `CollectionCardViews.jsx:39` and `CollectionCardSheet.jsx:357` pick slugs by `/-s$/` regex - after the repoint every slug carries a finish token, so these *start matching differently* (today they match nothing since bases are finish-stripped; afterwards they genuinely prefer `-s`). Behavior likely improves, but it is an unreviewed behavior change riding a data change. (ii) The WebView's own HTTP cache interacting with the Filesystem cache could mask cache bugs in testing (it "works offline" briefly via HTTP cache, then evicts). Device tests must force-stop and clear WebView cache to isolate the Filesystem layer. (iii) `check:smoke` and the widget/dashboard art paths (`Home.jsx` widgets) now depend on network timing at first paint - watch for layout-shift or spinner regressions on slow links.
5. **Failure most likely to escape the test plan.** A slow-network cell connection (not offline, not fast): images neither load promptly nor error, so fallbacks never trigger and rows show empty boxes during long pending fetches. Airplane-mode tests (instant error) and Wi-Fi tests (instant success) both miss it. Mitigation to carry into Phase 3: verify `CardArt`'s fallback is painted *underneath* from first paint (it is - `CardArt.jsx:14`), so "pending" already looks intentional; test once with throttled network anyway.
6. **Evidence that would change direction.** (i) Phase 0 finding that WebView canvas taints even from `convertFileSrc`, or that R2 CORS cannot be made to work from `https://localhost` - the poster and web-dev stories would need redesign. (ii) A Phase 3 spike showing native downloads are unreliable on the device fleet (WebView/plugin quirks) - would push toward the zip-pack-first posture or reopen option 2 at 380 px. (iii) Real tester feedback that placeholder-first fresh installs read as broken - would promote the "prompt to download pack on first launch" from open question to requirement, or revisit bundling a low-res starter subset.

**Rev-2 addendum - residual risks introduced by the redesign itself.**
- **`x-amz-checksum-sha256` on R2.** The upload's server-side corrupt-write rejection assumes R2 honours the S3 checksum header. R2's S3 compatibility is partial; if it ignores the header, integrity degrades to the client-side digest + the size-match audit (still sound, just not server-enforced). Verify in Phase 1; the design does not depend on it for correctness.
- **Sharp/libwebp encoder drift re-keys the corpus.** A `sharp` upgrade could change output bytes for all 3090 objects and mass-re-key them. Contained by convert-skip on unchanged source + a loud "N keys changed" diff before upload (Section A2), but a careless upgrade is a 285 MB re-push. Pin `sharp` and treat an upgrade as a deliberate re-key event.
- **The legacy bundled fallback adds transient complexity.** It exists only between Phase 2 and Phase 5 and is deleted with the bundle. Its risk is that it masks a genuine CDN miss as "fine, fell back to bundled" during that window - so the Phase-2 device evidence must confirm art comes from the CDN/cache, not the bundle (check with the bundle temporarily emptied, or via the cache-file presence).
- **`--dry-run` now writes to gitignored staging.** A deliberate semantics change (Section A4) from the old "writes nothing." Documented and bounded to `CATALOG_DROP/cdn-art/`, but a reviewer expecting a truly side-effect-free dry run should see it flagged.

## Approval record

**Dependency note for approval:** one devDependency, `aws4fetch` (SigV4 for R2 uploads), was already
added during rev-1 prep tooling. It is dev/pipeline-only (never bundled into the app). Human approval
of this proposal is taken to include that dependency.

- **Rev 1** - Reviewer disposition: **Changes required** (2026-07-22). Blocker (content-addressing) +
  3 Majors (fail-open tooling, unsafe Phase-1 activation, non-app-wide cache) + Minors.
- **Rev 2** - Reviewer disposition: *pending re-review*. Required revisions: - · Human decision: - · Date: -
