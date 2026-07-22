# Proposal - art-CDN Phase 2: atomic activation (runtime seam + on-device cache + catalog repoint)

**Status:** DRAFT for owner approval. **Classification: High-risk** (app-wide runtime change, new native
file I/O, offline-first durability, cross-runtime web/native divergence, and a catalog repoint that
reseeds every install). **Branch:** `art-cdn-phase2` (off `main`).

**Design is already approved.** The runtime boundary and its algorithms were reviewed and approved as
part of the rev-6 design: see [`art-cdn-rev2-architecture.md`](./art-cdn-rev2-architecture.md) Section A4
(pipeline/activation ordering) and Section B (the `artCache` / `artSource` / `ArtImage` boundary - the
resolution algorithm B3, the candidate chain B3.5, the pure reducer B4, the zero-image contract B6, the
backup/pack B7). This proposal does NOT re-derive that design; it maps it onto the real code discovered
this session, defines what lands atomically, and states how each invariant holds and how we verify. The
per-phase code review still happens per increment.

---

## 1. Where we are (Phase 1 recap)

Phase 1 (merged to `main`, PR #1, approved at `8523288`) built the DORMANT pipeline: content-addressed
conversion, durable staging, the prospective `art-manifest.json`, and a fully-tested R2 uploader with
proven overwrite protection (live canary passed). The shipped app is UNCHANGED - it still serves bundled
same-origin art from `public/cards/`, and the committed `cards.json` still points at collapsed base-name
slugs (foils share the standard art). Nothing renders from the CDN yet. **Phase 2 is where that flips.**

## 2. Goal

Activate the CDN: the app resolves every card-art pixel through one shared boundary that serves the
content-addressed key from `cdn.sadkinglabs.com`, caches it on-device (native) or via the browser HTTP
cache (web), and degrades gracefully (bundled legacy image, then deterministic fallback) - while the
committed catalog repoints `image_slug` to the per-finish content key so foils finally show their own
art. This is **one atomic activation**: a build with the repointed catalog but not the runtime seam (or
vice versa) regresses every card to fallback, so the pieces land together.

## 3. The change surface (discovered this session; file:line)

### 3.1 The single seam
- [`cardArt.js:29`](../../src/store/cardArt.js#L29) `cardImageUrl(card)` returns `` `${BASE}cards/${slug}` `` or
  null. This is the ONE bundled-vs-CDN seam (the code comments say as much). It becomes: resolve through
  `artCache`, whose key is the content-addressed key now in `card.image_slug`.
- [`cardArt.js:24`](../../src/store/cardArt.js#L24) `imagesDisabled()` = `localStorage['cx-no-images']==='1'`
  (app-wide, not a profile setting). [`cardArt.js:55`](../../src/store/cardArt.js#L55) `cardFallbackArt`
  is the always-painted deterministic ground. [`printingRows.js:198`](../../src/store/printingRows.js#L198)
  `printingArt` already returns a **slug, not a URL** - so callers are CDN-ready by construction.

### 3.2 New modules (per approved Section B)
- `src/store/artCache.js` - pure core over an injected `io` adapter (`stat/download/rename/delete/
  deleteTree/size/list/now`) + a thin Capacitor adapter (the only native-touching code). Single-flight,
  epoch, promotion-lock, quarantine - all DOM-free unit-tested (the `matchLife.js` precedent).
- `src/store/artSource.js` - the pure reducer + `visibleCandidate` selector (no imports, DOM-free).
- `src/components/ArtImage.jsx` + the `useArtSource(key)` hook - the two consumption forms.
- `cardArt.js` gains `ART_CDN_BASE`, `artUrl(key)`, and the ONE allowlisted `legacySrc` formatter
  (`` `${BASE}cards/${entry.legacyKey}` ``), deleted in Phase 5 with the bundle.

### 3.3 Render sites that adopt the boundary
- **Group 1 - already resolver-backed (swap to `ArtImage`/`useArtSource`):**
  [`CardArt.jsx:12`](../../src/components/CardArt.jsx#L12), [`CardArtViewer.jsx:140`](../../src/components/CardArtViewer.jsx#L140),
  [`CollectionCardSheet.jsx:195`](../../src/components/CollectionCardSheet.jsx#L195) (SiteArt),
  [`LifeCounter.jsx:599`](../../src/pillars/LifeCounter.jsx#L599) + `:1030/:1034`.
- **Group 2 - the 14 inline `${BASE}cards/${slug}` `<img>` builders that BYPASS the resolver and do NOT
  honor zero-image mode** (adopting the boundary fixes a latent zero-image leak too): CreateDeckWizard:101;
  AvatarPicker:97,120,137; Decks:28; DeckDashboard:170,339,452; DecksPager:470; Play:138,169;
  Home:185,478,512.
- **Group 3 - the CORS-critical poster:** [`deckPoster.js:71`](../../src/store/deckPoster.js#L71) loads
  avatar art into a canvas via `_loadImg` (`:11`, **no `crossOrigin`**) and exports through
  `toDataURL`/`toBlob` ([`native.js:82`](../../src/native.js#L82)). Today the art is same-origin bundled,
  so the draw is untainted. A REMOTE CDN URL without `crossOrigin='anonymous'` **taints the canvas and
  breaks poster export**. The poster must walk the candidate chain directly (it can't use the component)
  and set `crossOrigin='anonymous'` on the remote candidate.

### 3.4 Native primitives (net-new - none exist in code today)
- [`native.js`](../../src/native.js): `isNative()` exists (`:13`); `Filesystem` is imported but only writes
  `Directory.Cache` (`:68,:86`). **`Filesystem.downloadFile`, `Directory.Data`, `readFile/stat`, and
  `Capacitor.convertFileSrc` are all net-new.** The `CapacitorHttp` CORS-bypass pattern already exists at
  [`deckRepository.js:529`](../../src/store/deckRepository.js#L529) (window access, `get` -> `{data}`) - the
  fallback for byte fetches if `downloadFile` proves unreliable on `@capacitor/filesystem@6.0.4`.

### 3.5 Catalog repoint + shipped manifest
- Run `update:catalog` for REAL (un-dormant the promote): `cards.json` `image_slug` becomes the per-finish
  **content key**, `catalogVersion.json` bumps (`{version:5}` today - the reseed trigger read at
  [`catalog.js:29`](../../src/store/catalog.js#L29), fired in the atomic wipe-and-reload at
  [`catalog.js:56`](../../src/store/catalog.js#L56)).
- **Ship a runtime manifest** so the boundary can resolve `legacyKey` + `validSize` offline: a SLIM
  `public/catalog/art-manifest.json` (slug -> `{key, legacyKey, bytes}` only - not srcSha256/encoder).
  This is a new client-read artifact (content data, app-wide, never per-profile).

### 3.6 Android backup exclusion (must CREATE)
- [`AndroidManifest.xml`](../../android/app/src/main/AndroidManifest.xml): `allowBackup=true`, and NEITHER
  `fullBackupContent` nor `dataExtractionRules` is set. **Create** `res/xml/backup_rules.xml` (<=11) and
  `res/xml/data_extraction_rules.xml` (12+) excluding `art/` and `art-tmp/`, and add the two `<application>`
  attributes. (The cache is re-downloadable; backing it up wastes the user's backup quota.)

## 4. What lands atomically (the activation unit)

The repointed catalog (content keys) and the runtime resolver must match, so these land in ONE release:
the seam flip (`cardArt.js` -> `ART_CDN_BASE`/`artCache`), the new modules, all render-site adoptions
(Groups 1-3), the native primitives, the shipped slim manifest, the backup XML, the repointed `cards.json`
+ bumped `catalogVersion.json`, and the R2 objects (uploaded + audited BEFORE the catalog that references
them ships). **Hard ordering:** upload objects -> `cdn-upload` audit green -> THEN promote the repointed
catalog. The `bundledLegacy` chain means even a botched flip degrades to bundled art, not blank.

## 5. Implementation plan (build incrementally; ACTIVATE atomically)

- **2a - inert modules + spike (no behavior change).** `native.js` primitives; `artCache.js` +
  `artSource.js` pure cores with DOM-free `node --test`; `ArtImage`/`useArtSource`. Not wired into any
  render site yet, so the app is unchanged. **Device spike:** confirm `downloadFile` works on 6.0.4 or
  fall back to `CapacitorHttp`; confirm a `crossOrigin='anonymous'` canvas draw of a real CDN object is
  untainted (needs R2 bucket CORS `GET/HEAD`, `Access-Control-Allow-Origin: *` - a Phase-0 config step).
- **2b - the atomic activation (one reviewed unit).** Flip the seam; adopt the boundary at every site in
  Groups 1-3; ship the slim manifest + backup XML; run `update:catalog` for real (repoint + version bump)
  and `cdn-upload` (publish + audit). Device install is the acceptance gate.

## 6. Invariant analysis (Constitution §3)

- **Durable offline-first writes:** art writes to `Directory.Data/art/` (persistent), with the promotion
  lock linearizing every rename/delete and the epoch guarding `clear()`; temps live in the sibling
  `art-tmp/` so `deleteTree('art')` is never undone by a late write. No profile/user data is touched.
- **Graceful zero-image degradation:** the contract WIDENS from render-only to render-AND-I/O, gated
  inside the boundary (B6). The 14 inline sites currently leak in zero-image mode; adopting the boundary
  closes that. Verified by an app-wide sweep.
- **Cross-runtime integrity:** web serves the remote URL (browser HTTP cache); native serves the cached
  file via `convertFileSrc`; both resolve the SAME content key, and the shipped manifest is the shared
  source of truth. Kind-tagged sources (`{kind,src}`) avoid the `startsWith('http')` sniff that misfires
  on `convertFileSrc` URIs.
- **Catalog/profile boundary:** art is derived CATALOG content, keyed app-wide (like `cx-no-images`),
  never per-profile. Owned/wanted keys are `canonicalPrinting(set,foil)`, independent of image slugs, so
  the repoint cannot orphan user data by construction.
- **Forward-only schema evolution:** `SCHEMA_VERSION` untouched. The repoint rides the existing reseed
  ([`catalog.js:56`](../../src/store/catalog.js#L56)); `image_slug` now holds a content key instead of a
  base name - same column, a data change, atomic wipe-and-reload with the version written last.
- **Transactional user-data operations / content-is-data / zero-image:** reseed is catalog-only and
  atomic; art is inert data (no execution); the manifest is data.

## 7. Verification

- **Unit (DOM-free `node --test`):** `artCache` core (resolve/download/clear/quarantine, epoch,
  promotion-lock linearization, `validSize`, `staleResult` non-repopulation); `artSource` reducer +
  `visibleCandidate` (no stale paint, stale-key drop, the offline-upgrade candidate chain in both render
  and poster forms - B10.9).
- **Device (native, the real proof):** art renders from CDN; caches on view; survives an airplane-mode
  restart; an OFFLINE upgrade shows `bundledLegacy`; **zero-image app-wide sweep** (every ex-bypass site);
  **poster export works cached AND remote** (untainted canvas); the `downloadFile`-vs-`CapacitorHttp`
  spike result recorded. Web: remote URLs + browser cache + zero-image.
- **Pipeline:** `cdn-upload` full run publishes all 3,087 and the audit is green; the on-device reseed
  flips the catalog at boot.
- **Gates:** `test:codex`, `test:query`, `test:app`, `check:types`, `check:cycles`, `build`, `check:docs`,
  and `check:smoke` (device route render). Docs updated (BUILD/ARCHITECTURE/DATA_MODEL to steady-state
  CDN behavior; the migration-dormant notes retired).

## 8. Risks

- **`downloadFile` reliability on 6.0.4** - the whole native cache depends on it. Mitigated by the 2a
  device spike + the proven `CapacitorHttp` fallback.
- **CORS canvas taint (poster)** - needs R2 bucket CORS (`GET/HEAD`, `ACAO:*`) AND `crossOrigin='anonymous'`
  on the remote candidate. Web dev-proxy hides this, so it MUST be a device test.
- **Upload-before-repoint ordering** - if the catalog referencing content keys ships before the objects are
  uploaded+audited, art 404s. The sequence (upload -> audit -> promote) enforces it.
- **Shipped manifest size** - 3,087 entries; slim to `{key, legacyKey, bytes}` and measure the gzipped
  bundle cost. It MUST ship (offline resolution can't call home).
- **First-online experience** - a fresh install with no network shows fallbacks until the first online
  session caches art. Accepted, documented tradeoff (card DATA never leaves the device).

## 9. Self-Critique (required, §8)

- **The activation is large and all-or-nothing** - a partial land regresses every card. This is the
  central risk. Mitigations: 2a ships inert (zero behavior change, independently reviewable); the
  activation is one reviewed unit; and the `bundledLegacy` arm means a botched flip degrades to bundled
  photography, not blank cards. Still, this is the increment to review hardest.
- **`downloadFile` is an external unknown** - if it's flaky on 6.0.4 and `CapacitorHttp` also disappoints,
  the native cache is in trouble. The spike happens BEFORE the activation commit so we learn early; worst
  case we ship web-style (remote-only) on native too and add the cache in a follow-up (degraded, not
  broken).
- **Shipping a 3,087-entry manifest to the client is a new runtime dependency and bundle cost** I have not
  measured yet. If it's heavy even slimmed+gzipped, the fallback options (per-slug endpoint) break offline
  - so the honest answer is it ships, and 2a must measure it before we commit.
- **Zero-image widening is only as good as the sweep** - miss one of the 14 inline sites and the invariant
  stays broken there. The verification names an explicit app-wide sweep for exactly this reason.
- **I am reusing an approved design, not re-deriving it** - the risk is that the code discovered this
  session diverges from the design's assumptions (e.g. `printingArt` returning slugs, the reseed being a
  clean wipe-and-reload). The discovery confirmed those assumptions hold, but the 2b review should
  re-check them against the actual diff, not this proposal's summary.

## 10. Rollback

Phase 2 ships as the single unit it activates as. Revert the activation commit: `cards.json` points back
at base-named files, the bundle is still present (Phase 5 hasn't run), so a reverted build serves bundled
art again. R2 objects are additive/immutable (prior content keys still exist for roll-forward). The reseed
token's string-inequality compare handles either direction as "just another content change." No user data
is at risk (profile tables are never touched by reseed).
