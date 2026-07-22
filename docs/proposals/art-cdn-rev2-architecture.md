# Art CDN architecture redesigns - rev 3

Companion to `docs/proposals/art-cdn-migration.md`. (Filename kept as
`art-cdn-rev2-architecture.md` because the main proposal links it; the content is rev 3.)
This document is design only - no production code exists for either piece.

- **Section A** resolves the rev-1 **Blocker**: mutable slugs under an immutable cache header
  make corrected art permanently stale. Redesign: content-addressed object identity.
- **Section B** resolves the rev-1 **Major** (and the zero-image **Minor**): a partial cache
  boundary that double-fetches, races, and leaves ~14 render sites remote-only. Redesign: one
  shared `artCache` / `useArtSource` / `ArtImage` boundary for every card-art pixel in the app.

**Rev 3 (2026-07-22).** Codex re-reviewed rev 2: direction **approved**, with four
implementation-bearing Majors and three Minors. Everything Codex approved is preserved; the
findings are resolved in place:

| Finding | Resolution | Where |
|---|---|---|
| **Major 1** - legacy offline fallback was prose-only | Build-side `legacyKey` per manifest entry + an explicit ordered candidate chain `local -> remote -> bundledLegacy -> deterministicFallback`, shared by `ArtImage`/`useArtSource` and `deckPoster` | A3, A4, B3.5, B4, B9 |
| **Major 2** - `clear()` not linearizable | A promotion lock around rename/delete only; epoch captured before the first await and re-checked inside the lock; epoch-tagged inflight entries; non-rejecting `resolve()`; retry-generation rerender | B3, B7 |
| **Major 3** - R2 checksum premise wrong | `md5` in the manifest; `Content-MD5` on PUT (the R2-documented mechanism); Phase-0 ETag==MD5 canary; audit = key + bytes + ETag; signed-HEAD fallback | A3 |
| **Major 4** - conversion reuse ignored the recipe | Per-entry `recipeId` + `encoder` provenance; skip only on `srcSha256` AND `recipeId` match; `--reconvert`; `--approve-rekey`; pin `sharp` | A2, A3, A4 |
| **Minor 1** - seam inventory missed active consumers | `LifeCounter.jsx` (half art + DD twin + end screen) and `CollectionCardSheet.jsx` `SiteArt` added to the adoption map; seam-guard sensitivity test | B5 |
| **Minor 2** - prefix collision detection could not work | Full 64-hex sha256 in the object key; the prefix + `assertNoPrefixCollisions` machinery is deleted | A2, A4, A5 |
| **Minor 3** - two test contracts | `validSize()` fails closed on a manifest miss; no React Testing Library - a pure source-state reducer tested under `node --test` | B3, B4, B10 |

---

## Section A - Content-addressed art identity

### A1. The defect, restated precisely

Rev 1 publishes objects as `${v.slug}.webp` with `Cache-Control: public, max-age=31536000,
immutable` (`scripts/catalog/cdn-upload.mjs:16`) while also promising to "upload changed
objects." Those two statements cannot both be true. If a corrected scan for
`001-abundance-b-s` is re-uploaded under the same key:

- the Cloudflare edge serves the old bytes for up to a year (immutable says never revalidate);
- every WebView HTTP cache in the field holds the old bytes forever;
- every device Filesystem cache keyed by slug holds the old bytes forever;
- and nothing upstream notices, because the catalog content hash folds in the image manifest
  as a list of **filenames** (`generation.mjs:95` - `imagePlan.manifest.join('\n')`), which are
  unchanged. No version bump, no reseed, no signal anywhere.

The fix is to make the header's claim true by construction: **a key names one exact byte
sequence, forever**. Changed bytes are a *new key*, and the key change propagates through
`v.image`, the catalog hash, the version token, the reseed, and the device cache with zero
purge logic at any layer.

### A2. Object key scheme, digest, and the conversion-skip rule

**Key format: `<variant-slug>.<sha256-full-64-hex>.webp`**
Example: `001-abundance-b-s.<64 hex chars of the output digest>.webp`

Slug first, digest second: object listings group by card, keys stay grep-able against the
catalog, and `printingBase()` (`scripts/catalog/curiosa.mjs:15-17`) style suffix reasoning is
untouched because the digest segment is strictly appended between slug and extension.

**Full digest, not a prefix (rev 3, per Codex Minor 2).** Rev 2 truncated to 12 hex chars and
leaned on `assertNoPrefixCollisions` to catch same-slug prefix collisions. That machinery
could not work as written: the manifest is one-entry-per-slug, so a new digest *replaces* the
old before the assertion runs, and the assertion can never see the non-current historical
object a rollback would repoint to. Rather than repair it (a key-history side table, more
tests), the full 64-hex digest goes in the key. Cost: ~52 extra characters per key, ~3090
variants, on the order of 160 KB pre-compression across `cards.json` + the manifest -
negligible beside a 285 MB corpus, and it deletes the collision-detection machinery, its
failure modes, and its tests outright. Rev 2's "69-char basenames hurt logs" objection is
hereby overruled by review: readability is not worth un-testable safety machinery.

**Digest input: the OUTPUT WebP bytes.** SHA-256 over the exact bytes that will live on R2,
computed in the conversion stage immediately after sharp writes the file (the unified 745 px
q80 converter - rev 1 already merges `convertOne` at `images.mjs:107` with the
`cdn-convert.mjs:20-21` constants). Hashing the output rather than the source is what makes
the key a promise about what the CDN serves: any change in encoder settings, sharp version, or
source scan that changes served bytes changes the key; anything that leaves served bytes
identical leaves the key identical.

**Conversion skip requires source AND recipe match (rev 3, per Codex Major 4).** Rev 2
skipped re-conversion solely on unchanged `srcSha256`, so a tier change (745/q80 -> anything
else) would leave old entries claiming a recipe their bytes were not made with. The rule is
now:

- Every manifest entry records `recipeId` (the exact conversion recipe, e.g.
  `"webp:w745:q80:v1"` - the `v1` tail exists so a semantic converter change that leaves
  width/quality unchanged can still force reconversion) and `encoder` provenance
  (`{ sharp, vips }` versions, from sharp's package version + `sharp.versions.vips`).
- **Skip conversion iff `srcSha256` matches AND `recipeId` matches.** A recipe change forces
  reconversion of every affected entry (and therefore a re-key - new bytes, new digest).
- **Encoder-version-only change** (sharp upgraded; source and recipe unchanged): existing
  bytes and keys are **retained** - no silent corpus re-key - unless `--reconvert` is passed.
  Newly converted entries always record the encoder that actually produced them, so the
  manifest may honestly contain mixed encoder provenance; provenance is a record, never a
  skip input.
- **A mass re-key is a refused event, not a warning.** The manifest diff is always printed
  ("N new, M re-keyed, K removed"). Any run that would re-key entries whose *source did not
  change* (i.e. a recipe change or `--reconvert`) refuses to proceed without an explicit
  `--approve-rekey` flag, given after the diff is on screen. A surprise 285 MB re-push is
  thereby impossible.
- **`sharp` must be pinned.** `package.json:59` currently carries `"sharp": "^0.32.6"` - a
  caret range, so a fresh `npm install` can silently move the encoder. Phase 1 pins it to the
  exact version (`"sharp": "0.32.6"`), and an upgrade becomes a deliberate, diffed event.

### A3. `art-manifest.json` - shape, home, and roles

**Location: `public/catalog/art-manifest.json`, committed.** It is catalog generation output,
promoted by the same journaled promote as `cards.json`, versioned by the same content hash,
and rolled back by the same `git revert`. Not gitignored staging: the manifest is the durable
ledger of "which bytes each slug currently publishes," and its git history is the rollback
record (A8). It also ships in the APK for free (~3090 entries, ~500 KB minified with the rev-3
fields - noise inside an 18 MB artifact), which gives the runtime exact byte sizes for pack
progress and cached-file validation (B3) and the `legacyKey` for the transition fallback
(B3.5) without a network round trip.

**Shape** (one entry per variant slug; sorted keys; minified like `cards.json`):

```json
{
  "tier": { "width": 745, "quality": 80, "format": "webp", "recipeId": "webp:w745:q80:v1" },
  "objects": {
    "001-abundance-b-s": {
      "key": "001-abundance-b-s.<full 64-hex sha256>.webp",
      "sha256": "…64 hex of the OUTPUT WebP bytes…",
      "md5": "…32 hex of the OUTPUT WebP bytes…",
      "bytes": 94211,
      "srcSha256": "…64 hex of the source PNG…",
      "recipeId": "webp:w745:q80:v1",
      "encoder": { "sharp": "0.32.6", "vips": "8.14.5" },
      "legacyKey": "001-abundance-b.webp"
    }
  }
}
```

Map-by-slug (not an array) makes "exactly one current object per slug" structural and gives
`planImages` an O(1) repoint lookup. Field roles:

- `srcSha256` + `recipeId`: the conversion-skip rule (A2). Build-side only.
- `md5`: upload integrity + publish audit (below). Build-side only.
- `encoder`: provenance record, never consulted for skipping. Build-side only.
- `key`, `bytes`: read by the runtime (resolution, validation, pack progress).
- `legacyKey` (rev 3, per Codex Major 1): the canonical bundled filename this printing had
  *before* content addressing - `` `${printingBase(slug)}.webp` `` (the finish-stripped name
  `images.mjs:59` produces today, still present in `public/cards/`). **Computed by the build**
  (the `artManifest` engine imports `printingBase` from `curiosa.mjs`), never reconstructed
  from the hashed key in runtime code. Recorded **iff** that file actually exists in the
  committed `public/cards/` tree at build time, so a printing that never had a bundled image
  gets no `legacyKey`. Sibling finishes of one printing share a `legacyKey` by design - that
  IS the pre-content-addressing collapse, and exactly what the bundled APK contains.
  **`legacyKey` and everything that reads it are deleted in Phase 5 with the bundle**: once
  `public/cards/` stops existing, the build records no `legacyKey`, Phase 5 strips the field
  from surviving entries, and the runtime `bundledLegacy` branch (B3.5) is removed in the
  same change.

**The manifest is the single source of truth for these consumers:**

| Consumer | Rule |
|---|---|
| Conversion | Skip a slug iff `srcSha256` AND `recipeId` both match (A2). Source changed, recipe changed, or slug new -> convert, hash output, write a new entry (recording the current encoder). No source PNG in the drop and an entry exists -> keep the entry (incremental drops stay legal). |
| Upload diff | Upload exactly `manifest keys − remote keys` (S3 `ListObjectsV2` on the bucket, ~4 pages). Every PUT carries **`Content-MD5`** (base64 of the entry's raw MD5 digest) - the mechanism Cloudflare R2 documents for PutObject write integrity; R2 refuses a body that does not match. **`x-amz-checksum-sha256` is NOT used**: R2 documents Content-MD5, and full-object SHA-256 checksums are unsupported - rev 2's premise was wrong. |
| Publish audit | Every distinct `v.image` in the staged `cards.json` must be a `manifest.objects[*].key` AND present in the remote listing with `size === bytes` **AND `etag === md5`** (quotes stripped; hex compare). `ListObjectsV2` returns ETag and Size - it does **not** return checksum values, so the ETag is the only integrity evidence the listing actually exposes. Any miss refuses the promote. One listing call, not 3090 HEADs. |
| Catalog hash | `generation.mjs:90-97` replaces `imagePlan.manifest.join('\n')` with the serialized art manifest (keys + full sha256). Corrected bytes -> new digest -> new hash -> version token bump -> reseed. (Belt and suspenders: `serializeCards` already moves too, because `v.image` embeds the digest.) This closes the exact hole Codex found at `generation.mjs:95`. |
| Runtime | `key` -> URL/cache path; `bytes` -> `validSize` + pack progress; `legacyKey` -> the bundledLegacy candidate during the Phase 2->5 transition (B3.5). |
| Rollback | `git revert` of manifest + `cards.json` restores the prior keys. R2 is additive-only; the old objects were never deleted, so rollback is a repoint with zero remote action (A8). |

**The ETag premise is verified, not assumed (rev 3, per Codex Major 3).** These are
single-part PUTs, for which S3-compatible stores - R2 included - return an ETag equal to the
body's MD5. Because that equality is the audit's load-bearing assumption, **Phase 0 runs a
canary**: PUT one real object with `Content-MD5`, then assert that the PutObject response
ETag AND the `ListObjectsV2` ETag both equal the manifest `md5` (hex, quotes stripped).

- **Canary passes** (expected): the audit is `key + bytes + ETag` from one listing, as above.
- **Canary fails**: every PUT carries `Content-MD5` **plus `x-amz-meta-sha256`** (the full
  output digest as user metadata), and the audit switches to **signed HEAD** requests per
  audited key, comparing `Content-Length === bytes` and the `x-amz-meta-sha256` header
  against the manifest. Cost: one HEAD per changed/new key per audit - fine at routine diff
  sizes; the one-time 3090-key migration audit is a scripted run either way.

Either branch, the audit's counterfactual is tested: a mocked remote listing containing the
right key with the **right size but a wrong ETag** must refuse the promote - size match alone
is not an integrity check (A9.4).

### A4. Pipeline restructure (stage order and pseudocode)

The chicken-and-egg to resolve: `planImages` runs inside `buildGeneration`
(`generation.mjs:60`) and must be pure/dry-runnable, but a content-addressed key is unknowable
until conversion produces bytes. Resolution: **move conversion (with digesting) in front of
generation build**, feeding the finished manifest into `buildGeneration` as a pure input.
Conversion writes only to the gitignored `CATALOG_DROP/cdn-art/` staging and is idempotent, so
running it on `--dry-run` violates nothing the dry run promises (nothing under `public/` or
`src/` is touched); the dry-run report becomes *exact* instead of "digest pending." This is a
stated behavior change: dry runs may encode new scans into gitignored staging.

New stage order in `scripts/update-catalog.mjs` (replacing the convert loop at `:96-107`):

```
discover -> convert+digest -> build next art-manifest (pure) ->
buildGeneration({ ..., artManifest }) -> validateGeneration ->
[real run only] upload diff -> publish audit -> journaled promote
```

`scripts/catalog/artManifest.mjs` (new engine, unit-tested like its siblings):

```
RECIPE = { width: 745, quality: 80, format: 'webp' }
RECIPE_ID = 'webp:w745:q80:v1'

buildArtManifest({ committed, dropSources, bundledDir, convertedDir, hashFile,
                   encoderVersions, flags }):
  next = clone(committed.objects)
  rekeyedSourceUnchanged = []
  for (slug, pngPath) of dropSources:            # finish-suffixed slugs, reverse faces excluded
    srcSha = hashFile(pngPath)
    prior = next[slug]
    if prior && prior.srcSha256 === srcSha
             && prior.recipeId === RECIPE_ID
             && !flags.reconvert: continue        # source AND recipe unchanged: keep bytes+key
    webpBytes = ensureConverted(pngPath, convertedDir, RECIPE)   # sharp, idempotent
    sha = sha256(webpBytes)
    legacy = `${printingBase(slug)}.webp`         # curiosa.mjs printingBase - BUILD-side only
    next[slug] = { key: `${slug}.${sha}.webp`,    # FULL 64-hex digest (A2) - no prefix,
                   sha256: sha,                   # no assertNoPrefixCollisions, machinery gone
                   md5: md5(webpBytes),
                   bytes: webpBytes.length,
                   srcSha256: srcSha,
                   recipeId: RECIPE_ID,
                   encoder: encoderVersions,      # { sharp, vips } - provenance, not identity
                   ...(existsIn(bundledDir, legacy) ? { legacyKey: legacy } : {}) }
    if prior && prior.srcSha256 === srcSha && next[slug].key !== prior.key:
      rekeyedSourceUnchanged.push(slug)
  printDiff(committed, next)                      # "N new, M re-keyed, K removed" - always
  if rekeyedSourceUnchanged.length && !flags.approveRekey:
    throw `refusing to re-key ${n} source-unchanged entries - re-run with --approve-rekey`
  return { tier: { ...RECIPE, recipeId: RECIPE_ID }, objects: sortKeys(next) }
```

Staging file naming stays **plain-slug** (`cdn-art/001-abundance-b-s.webp`) - the
content-addressed name exists only in the manifest, on R2, and on devices. The staging file is
re-hashed cheaply whenever needed; if it is deleted but `srcSha256` and `recipeId` both match,
no reconversion is needed either, because the object already exists remotely (verified by the
audit). A routine no-image drop therefore still needs neither sharp nor `.env.r2`.

### A5. `v.image` assignment and validation adaptation

`planImages` (`images.mjs:34`) gains an `artManifest` parameter. The rev 1 per-finish flip now
assigns **keys, not filenames**, replacing `images.mjs:71`:

```
for v of c.variants:
  entry = artManifest.objects[v.slug]
  v.image = entry ? entry.key
          : keyOfSiblingFinish(c, v)   # same printing, standard preferred - rev 1 fallback rule
          : null                       # deterministic placeholder at render
```

The card-level default (`images.mjs:73-78`) keeps its rank rule and now lands on a key.
`printingArt` (`src/store/printingRows.js:198-211`) and its "returns a SLUG, never a URL"
contract (`printingRows.test.mjs:242`) survive untouched - the value it passes through simply
became the content-addressed key, still resolved by the one seam.

`validateGeneration` (`generation.mjs:136-156`): the check at `:139-145` swaps its set source -
`const manifest = new Set(Object.values(gen.artManifest.objects).map(o => o.key))` - and the
rule is unchanged: every `c.image` / `v.image` is null or a member. A new companion check:
every manifest entry's `key` must equal `` `${slug}.${sha256}.webp` `` with the **full**
64-hex digest (shape integrity, catches hand-edits), and any `legacyKey` present must equal
`` `${printingBase(slug)}.webp` ``.

### A6. Device and edge invalidation: none needed, by construction

- The device cache stores files as `art/<key>` (Section B). Corrected art means the catalog
  reseeds with a new `v.image`, every render site asks the boundary for the **new key**, the
  cache misses, and the new bytes download. The old file is inert garbage (bounded to re-keyed
  slugs; the pack download sweeps `art/<slug>.*.webp` files whose key is no longer in the
  manifest).
- The WebView HTTP cache and the Cloudflare edge both key on the URL; a new key is a new URL.
  The year-long immutable header is now literally true, so **no Cloudflare purge API, no purge
  tooling, no purge documentation** - the concept does not exist in this design.
- Rev 1's Phase-order constraint is unchanged: pipeline repoint before seam swap, shipped as
  one release.

### A7. Migration of the 3090 already-uploaded objects

The bucket currently holds slug-named keys (`001-abundance-b-s.webp`). Decision: **re-upload
everything under content-addressed keys and leave the old objects as orphans.**

- Cost of orphans: ~285 MB duplicate storage ≈ $0.004/month extra. Zero egress fees. Not worth
  a deletion pass while any historical pointer might exist.
- The first `buildArtManifest` run needs the full high-res drop present once (to record
  `srcSha256`, `md5`, `recipeId`, `encoder`, and `legacyKey` for all 3090 sources);
  `CATALOG_DROP/Card Images high res` is on disk today. If `cdn-art/` staging still holds the
  converted WebP, no re-encode happens - the builder hashes the existing outputs; otherwise it
  reconverts (one-time ~cost of `cdn-convert.mjs`). `public/cards/` still exists at Phase 1,
  so `legacyKey` presence is checkable directly against the committed bundled tree.
- Never derive the manifest by downloading and hashing R2 objects: the build machine's bytes
  are the source of truth; the remote is the thing being audited.
- Optional cleanup (delete un-suffixed keys) is a follow-up allowed only after the slim APK is
  the sole build in the field; it is never required for correctness.

### A8. Rollback

`git revert` of the promote commit restores the previous `cards.json` + `art-manifest.json`;
the version token's string-inequality compare reseeds back; every key the reverted catalog
references still exists on R2 because objects are never overwritten or deleted. Rolling
forward again is the same operation. The manifest's git history is a complete, auditable
byte-level provenance record for every slug - now including the recipe and encoder each byte
sequence was produced with.

### A9. Resubmission evidence this design enables

1. **Corrected-scan test** (`images.test.mjs` / `artManifest` tests): same slug, changed
   source bytes -> new `srcSha256` -> new key in the manifest, old key absent, `v.image`
   repointed. The rev 1 contradiction becomes an assertable behavior.
2. **Hash-moves-on-bytes test** (`generation` tests): two generations with identical
   filenames but different manifest digests produce different content hashes - the exact
   defect at `generation.mjs:95`, pinned.
3. **Upload-diff test**: manifest vs a mocked remote listing uploads exactly the absent keys,
   each PUT carrying `Content-MD5`; a re-run uploads zero.
4. **Audit-refusal tests**: staged catalog referencing (a) a key missing from the mocked
   remote listing, (b) a size-mismatched object, or (c) **a same-size object with a wrong
   ETag** refuses to promote. (c) is the new counterfactual: size match alone is not
   integrity evidence.
5. **Recipe-skip tests** (Major 4): unchanged `srcSha256` + unchanged `recipeId` -> entry
   untouched, zero conversions; unchanged `srcSha256` + **changed `recipeId`** -> reconverted
   and re-keyed (under `--approve-rekey`), new `recipeId` recorded; unchanged source + recipe
   but a **new encoder version** -> bytes and key retained, no reconversion, and a
   `--reconvert` run re-keys with the new `encoder` recorded.
6. **Re-key refusal test**: a run that would re-key source-unchanged entries throws without
   `--approve-rekey`, after printing the diff; with the flag it proceeds.
7. **legacyKey tests** (Major 1): every recorded `legacyKey` equals
   `` `${printingBase(slug)}.webp` `` and corresponds to a file present in the bundled tree
   fixture; a slug with no bundled file gets no `legacyKey`; a post-Phase-5 build (empty
   bundled dir) records none.
8. **ETag canary** (Phase 0, scripted): PUT one object with `Content-MD5` -> response ETag ==
   listed ETag == manifest `md5`. On failure, the signed-HEAD fallback path is exercised and
   its evidence recorded instead.
9. **Device evidence** (manual, phase checkpoint): view a card, republish corrected bytes for
   its slug, update catalog, reinstall/reseed -> the new art renders with no cache clear and
   no purge, while airplane-mode still serves the previously cached keys.

*(Deleted with the prefix scheme: the rev-2 prefix-collision test - there are no prefixes.)*

---

## Section B - The shared `artCache` / `useArtSource` / `ArtImage` boundary

### B1. The defect, restated precisely

Rev 1 gave `CardArt.jsx` / `CardArtViewer.jsx` a lazy cache and left the other ~14 render
sites (list at rev 1 "Seam bypasses"; `AvatarPicker.jsx:97,120,137`,
`DeckDashboard.jsx:170,339,452`, `Decks.jsx:28`, `DecksPager.jsx:470`, `Home.jsx:185,478,512`,
`Play.jsx:138,169`, `CreateDeckWizard.jsx:101`, plus the canvas loader `deckPoster.js:71`)
pointed at raw remote URLs. Worse, the cached path itself was "give the `<img>` the remote URL
AND fire a native download" - a double fetch that races on temp files, can persist a 404 body
as art, and still starts downloads in zero-image mode. `CardArt.jsx:11` additionally retains
`broken` across `card` changes, so a recycled row that once 404'd never shows art again.

The redesign: **one module owns every byte of card art the app touches.** Rendering, caching,
downloading, validating, clearing - all behind a single boundary with a single key vocabulary
(the content-addressed key from Section A).

### B2. `src/store/artCache.js` - module interface

All functions take the content-addressed **key** (the value in `v.image` / `card.image_slug`
after the repoint). The module is written per the UI-state extraction pattern: a pure core
over an injected `io` adapter (`stat/download/rename/delete/deleteTree/size/list/now`), with
the thin Capacitor adapter as the only native-touching code - so single-flight, epoch,
promotion-lock, and quarantine logic are unit-testable DOM-free.

Sources are **kind-tagged objects**, `{ kind: 'local'|'remote'|'legacy', src }`, not bare
strings. (Rev 2 sniffed `src?.startsWith('http')` to detect the remote case - wrong, because
`convertFileSrc` URIs are also `https://localhost/_capacitor_file_/…` on Android. The
resolver knows what it produced; it says so.)

```js
// -- reading --
resolve(key)   // Promise<{kind:'local'|'remote', src}|null>: the FIRST candidate -
               // validated local file URI (native), or remote URL (web always; native
               // after a failed download), or null (zero-image mode / falsy key).
               // NEVER rejects: adapter failures are caught inside and degrade to the
               // remote candidate (native) or null. THE only art entry point.
legacySrc(key) // {kind:'legacy', src}|null, sync: the bundled printing-base image for the
               // Phase 2->5 transition - `${BASE}cards/${manifest[slugOf(key)].legacyKey}`.
               // null when zero-image, key unknown, or the entry has no legacyKey. The ONE
               // sanctioned use of the `${BASE}cards/` path, formatted in cardArt.js,
               // DELETED in Phase 5 with the bundle (B3.5).
peek(key)      // {kind,src}|null, sync: memoized prior resolution, for flash-free first paint.
quarantine(key)// Promise<{kind,src}|null>: delete the local file (locked, epoch-checked),
               // drop the memo; first offence re-resolves (fresh download) and returns the
               // new candidate; repeat offence returns the remote candidate. Never rejects.

// -- writing --
download(key)          // Promise<boolean>: ensure cached locally. No-op on web and in
                       // zero-image mode. Shares the same single-flight as resolve().
downloadAll(keys, { onProgress, shouldStop })   // the pack; concurrency 6; epoch-aware.

// -- lifecycle --
clear()        // Promise<void>: bump epoch, detach inflight, drop memos, delete
               // Directory.Data/art under the promotion lock, clear the pack stamp (B7).
stats()        // Promise<{ files, bytes, complete }>: complete is computed by comparing
               // the art/ listing against the manifest keys - NEVER read from the stamp.
```

Internal state:

```js
const inflight = new Map();   // key -> { epoch, promise }  (single-flight per key,
                              //   joinable ONLY by requests of the same epoch - B3)
const resolved = new Map();   // key -> {kind,src}          (session memo; feeds peek)
const retried  = new Set();   // keys quarantined+retried once this session
let   epoch    = 0;           // cache generation counter; clear() increments it
let   promotionLock = Promise.resolve();   // serializes rename/delete ONLY - B3
```

### B3. Resolution algorithm

**Web (`!isNative()`):** `resolve(key)` returns `imagesDisabled() ? null : { kind: 'remote',
src: `${ART_CDN_BASE}/${key}` }`. The browser HTTP cache is the cache; no Filesystem anywhere.

**Native - local-first, single-download, no parallel remote `<img>`.** Rev 3 rebuilds this
around a real linearization point (Codex Major 2). The invariant: **every write into `art/`
(rename or delete) happens inside a short promotion lock, and the epoch is re-read inside
that lock.** The network download is never under the lock.

```
withPromotionLock(fn):                       # a promise-chain mutex; held for the duration
  run = promotionLock.then(fn, fn)           # of ONE rename or delete, never a download
  promotionLock = run.catch(() => {})
  return run

resolve(key):
  if (!key || imagesDisabled()) return null            # zero-image: no render, no I/O (B6)
  if (resolved.has(key)) return resolved.get(key)
  ent = inflight.get(key)
  if (ent && ent.epoch === epoch) return ent.promise   # join CURRENT-epoch flights only -
                                                       # a post-clear request never joins an
                                                       # obsolete promise
  reqEpoch = epoch                                     # captured BEFORE the first await
  ent = { epoch: reqEpoch, promise: null }
  ent.promise = (async () => {
    try:
      st = await io.stat(`art/${key}`)                 # Directory.Data
      if (reqEpoch !== epoch) return resolve(key)      # cleared mid-stat: the file the stat
                                                       # saw may already be gone - redo fresh
      if (st && validSize(key, st.size)):
        out = { kind:'local', src: convertFileSrc(st.uri) }
        resolved.set(key, out); return out             # reached only with epoch intact
      if (st) await withPromotionLock(() =>            # wrong-size file: delete under the
        reqEpoch === epoch ? io.delete(`art/${key}`) : null)   # lock, epoch re-checked
      tmp = `art/.tmp/${key}.${rand()}`                # unique temp per attempt - no races
      ok = await io.download(remoteUrl(key), tmp)      # Filesystem.downloadFile, else
                                                       # CapacitorHttp -> writeFile. NOT locked.
      good = ok && validSize(key, await io.size(tmp))
      promoted = good && await withPromotionLock(async () => {
        if (reqEpoch !== epoch) return false           # THE linearization point: the epoch
        await io.rename(tmp, `art/${key}`)             # check and the rename are one atomic
        return true                                    # step with respect to clear()
      })
      if (!promoted):
        await io.delete(tmp).catch(noop)               # NEVER persist a failure or a stale-
        if (reqEpoch !== epoch) return resolve(key)    # epoch download; a cleared-mid-flight
                                                       # request redoes itself fresh
        return { kind:'remote', src: remoteUrl(key) }  # sequential last resort: let the <img>
                                                       # try (WebView HTTP cache may hold it);
                                                       # nothing was cached, nothing races
      out = { kind:'local', src: convertFileSrc(...) }
      if (reqEpoch === epoch) resolved.set(key, out)   # every memo write is epoch-guarded
      return out
    catch (e):
      return { kind:'remote', src: remoteUrl(key) }    # adapter failure caught INSIDE: the
                                                       # Promise contract never
                                                       # unhandled-rejects
  })().finally(() => {
    if (inflight.get(key) === ent) inflight.delete(key)  # delete only OUR entry - an old
  })                                                     # promise's finally cannot evict a
  inflight.set(key, ent); return ent.promise             # newer request's entry
```

Failures are still never memoized: a 404/offline miss retries on next view. The `resolve(key)`
re-entries on epoch mismatch are bounded - each re-entry reads the *current* epoch, and
`clear()` is a rare, user-initiated action, so the recursion terminates after the clears stop.

**Validation is exact-size-against-the-manifest, and it FAILS CLOSED (rev 3, Codex Minor 3).**

```
validSize(key, n):
  entry = manifest.objects[slugOf(key)]
  if (!entry || entry.key !== key) return false   # key absent from the shipped manifest:
                                                  # NEVER cache or serve an object the
                                                  # manifest cannot describe
  return n === entry.bytes
```

Rev 2's `n > 0` fallback for manifest-miss keys is removed - it authorized arbitrary bytes
under an undescribed key. A manifest miss cannot legitimately occur (keys and manifest ship
in the same promoted catalog), so it is treated as the integrity failure it is: the cached
file is quarantined, nothing is promoted, and display degrades to the remote candidate. This
is *stronger* than a RIFF/WEBP magic sniff - a truncated file, an HTML error page, or a
wrong-object write all fail it - and it costs one `stat`, no base64 read-back (Capacitor's
`readFile` cannot read ranges, so magic-sniffing would mean reading the whole file over the
bridge). Decode-level corruption is caught by the second layer:

**Decode-failure quarantine, retry once - with a real state update.** When an `<img>` showing
a *local* candidate fires `onError`, the source machine (B4) enters `quarantining` and calls
`artCache.quarantine(key)`: delete the file (under the promotion lock, epoch-checked), drop
the memo, and - if `!retried.has(key)` - add to `retried`, `resolve(key)` again (fresh
download), and return the new candidate. A repeat offence returns the remote candidate
instead (no further downloads). The returned candidate feeds the machine as a `RESOLVED`
event **with a bumped retry generation**, and `ArtImage` keys the `<img>` on that generation -
so even when the re-resolved local URI is byte-identical to the failed one, React remounts
and re-decodes it. (Rev 2 ignored the quarantine result and relied on a `src` change that
often would not happen; Codex Major 2 caught it.) `retried` is session-scoped, so a transient
bad write never bricks a slug, and a persistently bad object cannot cause a retry storm.

### B3.5. The ordered candidate chain: `local -> remote -> bundledLegacy -> deterministicFallback`

Rev 2 promised the main proposal's legacy offline fallback
(`art-cdn-migration.md`, Implementation plan: "a content-addressed remote miss … falls back
to that bundled image") in prose but never gave it a code path - a remote `<img>` error just
set `brokenFor`, so photography vanished offline even though the base file was still in the
APK (Codex Major 1). Rev 3 makes art resolution an **explicit ordered candidate chain**, the
same chain for rendering and for the poster canvas:

| # | Candidate | Produced by | On failure advance to |
|---|---|---|---|
| 1 | `local` | `resolve()` - validated cached file (native only) | `quarantining` -> retried `local` once -> `remote` |
| 2 | `remote` | `resolve()` - CDN URL (web always; native when no valid cache and the download failed) | `bundledLegacy` |
| 3 | `bundledLegacy` | `legacySrc()` - `` `${BASE}cards/${entry.legacyKey}` ``, the pre-content-addressing base image still bundled in the APK (A3) | `deterministicFallback` |
| 4 | `deterministicFallback` | terminal - `cardFallbackArt` (already painted underneath in framed mode; `fallbackNode` in bare mode) | - |

- **The offline Phase-2 upgrade scenario, now executable:** device upgrades offline to a
  Phase-2 build; `resolve()` finds no cached file, the native download fails, so it returns
  the `remote` candidate; the remote `<img>` errors (offline); the machine advances to
  `bundledLegacy` and the bundled base image renders. Photography survives the upgrade.
  This exact sequence is a required test, in both render and poster variants (B10.8).
- `legacySrc` is **sync** (one manifest lookup, no I/O), gated by `imagesDisabled()` like
  everything else (B6), and returns null for keys whose entry has no `legacyKey`.
- `bundledLegacy` is **transition-only**: Phase 5 deletes the bundle, the `legacyKey` field
  (A3), the `legacySrc` function, and the machine's legacy arm in one change; the chain
  becomes `local -> remote -> fallback`. The seam-guard's `${BASE}cards/` ban has exactly one
  allowlisted formatter (in `cardArt.js`, called only by `artCache`) until then, and zero
  after.
- `deckPoster` walks the same candidates **sequentially** (B9) - it cannot use the component,
  so it uses the chain directly.

### B4. `useArtSource` and `ArtImage` - the two consumption forms

**The source machine is a pure reducer, owned by the hook, tested DOM-free** (rev 3, per
Codex Majors 1-2 and Minor 3). `src/store/artSource.js` follows the UI-state extraction
pattern (pure core, no DOM, `node --test` - the `matchLife.js` precedent): it owns the
candidate chain, the quarantine retry, and the stale-resolution guard as *tested transitions*
rather than component-local `useState` conventions.

```
state = { key, phase, cand, gen }
  phase: 'resolving' | 'shown' | 'quarantining' | 'broken'
  cand:  { kind:'local'|'remote'|'legacy', src } | null
  gen:   retry generation - bumped on quarantine re-resolve; ArtImage keys the <img> on it

initial(key, peeked) = peeked ? { key, phase:'shown', cand: peeked, gen: 0 }
                              : { key, phase: key ? 'resolving' : 'broken', cand: null, gen: 0 }

reduce(state, ev):                       # every event carries the key it was produced for;
  if (ev.key !== state.key && ev.type !== 'KEY') return state   # stale async results from a
                                                                # superseded key are DROPPED -
                                                                # the generation guard, now
                                                                # inside the tested core
  KEY(k)         -> initial(k, peek(k))               # also resets 'broken': the CardArt.jsx:11
                                                      # retention defect stays pinned
  RESOLVED(cand) if phase in {resolving, quarantining}:
    cand == null -> { phase:'broken' }                # zero-image / falsy key: fallback only;
                                                      # legacy is NOT consulted (B6 gates it too)
    cand.kind == 'local' && phase == 'quarantining'
                 -> { phase:'shown', cand, gen: gen+1 }   # identical URI still remounts
    else         -> { phase:'shown', cand }
  IMG_ERROR      if phase == 'shown':
    cand.kind == 'local'  -> { phase:'quarantining' }     # effect: artCache.quarantine(key)
    cand.kind == 'remote' -> legacySrc(key) ? { phase:'shown', cand: legacy }
                                            : { phase:'broken' }
    cand.kind == 'legacy' -> { phase:'broken' }
```

**Hook** (for bespoke markup: `CardArtViewer`'s rotated layout, `SiteArt`, `LifeCounter` -
and any future custom `<img>`):

```jsx
export function useArtSource(key) {
  const [st, dispatch] = useReducer(reduce, key, (k) => initial(k, artCache.peek(k)));
  useEffect(() => { dispatch({ type: 'KEY', key }); }, [key]);
  useEffect(() => {              // one resolution attempt per (key, phase, gen)
    if (st.phase === 'resolving')
      artCache.resolve(st.key).then((cand) => dispatch({ type: 'RESOLVED', key: st.key, cand }));
    if (st.phase === 'quarantining')
      artCache.quarantine(st.key).then((cand) => dispatch({ type: 'RESOLVED', key: st.key, cand }));
  }, [st.key, st.phase, st.gen]);
  const onError = useCallback(() => dispatch({ type: 'IMG_ERROR', key: st.key }), [st.key]);
  return { src: st.cand?.src ?? null, gen: st.gen, onError };
  // src null => render nothing over the fallback (never an empty <img>)
}
```

A resolution settling after the key moved on dispatches with the *old* key and is dropped by
the reducer's key match - the stale-write guard is a reducer test, not a closure flag.
(`artCache.resolve`/`quarantine` never reject, so no `.catch` wiring is needed here - B3.)

**Component** (everything else). Two modes, so both current markup shapes are drop-in:

```jsx
// Framed mode (CardArt's contract, kept): fallback painted under, image layered over.
<ArtImage artKey={key} card={card} radius={8} aspect="5/7" imgStyle={...}>{children}</ArtImage>

// Bare mode (the inline sites): renders ONLY the <img> when a src exists, else fallbackNode
// (default null) - the surrounding chrome/CSS is untouched.
<ArtImage bare artKey={key} className="cx-deck-card-bg" alt="" fallbackNode={<div className="dw-deckph" />} />
```

Internals:

```jsx
export default function ArtImage({ artKey, card, bare, fallbackNode = null, ...frame }) {
  const { src, gen, onError } = useArtSource(artKey);
  const img = src ? <img key={gen} src={src} onError={onError} ... /> : null;   // key={gen}:
  if (bare) return img ?? fallbackNode;                 // a quarantine retry that re-resolves
  return (                                              // to the SAME URI still remounts
    <div style={{ background: cardFallbackArt(card), ... }}>{img}{frame.children}</div>
  );
}
```

Rev 2's `brokenFor === src` derivation and its `src?.startsWith('http')` kind-sniffing are
gone - the machine carries the kind, and the KEY transition resets a broken state (the
`CardArt.jsx:11` retention defect remains pinned, now by a reducer test).

`CardArt.jsx` becomes a ~5-line shell: `<ArtImage artKey={card?.image_slug} card={card}
{...props} />` (its public props are `ArtImage`'s framed-mode props, so its ~20 call sites do
not change). `CardArtViewer.jsx:140` swaps `cardImageUrl(card)` for
`useArtSource(card?.image_slug)`; its markup, FLIP, and tilt code are untouched.
`cardImageUrl`/`artUrl` in `cardArt.js` remain the URL formatters, but **only `artCache` may
call them for card art** - the seam-guard test extends to ban `artUrl(`/`cardImageUrl(`
imports outside `artCache.js`, `cardArt.js`, and their tests, closing the "new site quietly
renders remote-only" class, not just the `${BASE}cards/` class.

### B5. Adoption map - every render site, the drop-in swap

Rev 3 corrects the inventory (Codex Minor 1). Rev 2 repeated the main proposal's claim that
`LifeCounter`'s only involvement was the comment at `LifeCounter.jsx:594` - true for the
`${BASE}cards/` grep (it is not a URL *bypass*), **wrong as a seam inventory**: it is a
direct `cardImageUrl` *consumer*, and so is `CollectionCardSheet.jsx`'s `SiteArt`. Once
`cardImageUrl` becomes private to the boundary, both must move or the guard cannot land. The
method error was grepping for the URL template instead of for consumers of the formatters.

| Site | Today | Rev 3 |
|---|---|---|
| `src/components/CardArt.jsx` | own `<img>` + retained `broken` | shell over framed `ArtImage` |
| `src/components/CardArtViewer.jsx:140,184` | `cardImageUrl` + own `broken` | `useArtSource` + machine state |
| `src/components/CollectionCardSheet.jsx:193-203` (`SiteArt`) | `cardImageUrl(c)` + own `broken`; **rotated Site layout** - landscape 531:380 frame, image sized to the swapped dimensions and counter-rotated 90° (the canonical `.sheet-site-wrap` technique) | `useArtSource(c.image_slug)` + machine state; the frame/rotation markup is untouched (bespoke markup is exactly what the hook form exists for) |
| `src/pillars/LifeCounter.jsx:599-600` (half art, `halfArt` `:669-684`) + end screen `:1030,:1034` | `cardImageUrl(players.you/opp)` direct. Each half renders the SAME url **twice** - the `.half-bg` `<img>` plus its grayscale `.half-bg-dd` DD twin (one decode, two textures); artless halves use an inline SVG sigil + achromatic ash wash. End-state pills render `<img>` with a display-none `onError`. | `useArtSource(players.you?.image_slug)` / `(players.opp?.image_slug)`; **both textures consume the one resolved `src`**, preserving the one-decode-two-textures behavior; sigil/ash and all DD choreography unchanged; the end-pill display-none `onError` becomes the machine's advance (fallback = no art in the pill, as today). This screen's zero-image posture (the `:594-598` comment's hard-won lesson) is preserved by construction - `resolve()` gates identically. |
| `src/pillars/AvatarPicker.jsx:97,120,137` | inline `${BASE}cards/` | `<ArtImage bare artKey={….image_slug} …/>` |
| `src/pillars/DeckDashboard.jsx:170,339,452` | inline + display-none onError | bare mode (null replaces display-none) |
| `src/pillars/Decks.jsx:28` | inline hero | bare mode |
| `src/pillars/DecksPager.jsx:470` | inline | bare mode |
| `src/pillars/Home.jsx:185,478,512` | inline; `:512` picks `<img>` vs `dw-deckph` by slug | bare mode; `:512` passes `fallbackNode={<div className="dw-deckph"/>}` |
| `src/pillars/Play.jsx:138,169` | inline | bare mode |
| `src/components/CreateDeckWizard.jsx:101` | inline | bare mode |
| `src/store/deckPoster.js:71` | `_loadImg(`${BASE}cards/…`)` | walks the candidate chain via `artCache` (B9); null -> no hero |

Every swap is mechanical: the conditional wrapper (`{slug && <img …>}`) collapses into
`ArtImage`, which conditions on the **resolved src**, not the raw slug. That is the structural
fix for Codex's rev-1 Minor: no site can render an empty `<img>` in zero-image mode anymore,
because no site renders an `<img>` at all - the boundary does, and only when it has a real
src.

**Seam-guard sensitivity (rev 3).** The extended guard (no `${BASE}cards/` template and no
`artUrl(`/`cardImageUrl(` outside `cardArt.js`/`artCache.js`) must be *proven able to catch*
the consumers it exists to catch:

1. **Fixture-level**: the guard's own unit test feeds it fixture source containing a
   `cardImageUrl` import and a `${BASE}cards/`-style template and asserts both are reported
   (comment-stripping verified against a fixture modeled on `LifeCounter.jsx:594`'s comment).
2. **Repo-level, red-first**: the guard is run against the pre-adoption tree and **must
   FAIL**, naming exactly `CardArt.jsx`, `CardArtViewer.jsx`, `CollectionCardSheet.jsx`, and
   `LifeCounter.jsx`. That failing run is recorded in the Phase-2 checkpoint evidence; the
   guard flips green in the same Phase-2 change that moves the consumers. A guard that was
   never red proves nothing.

### B6. Zero-image contract (`cx-no-images`)

`imagesDisabled()` is checked **inside the boundary**, at the top of `resolve`, `download`,
`downloadAll`, `quarantine`, and `legacySrc`: with the gate on, no URL is formed (bundled
legacy included), no `stat` runs, no download starts, no byte is written, and the source
machine goes straight to `broken` (fallback-only render). Rendering and I/O are prohibited by
the same line of code, so they cannot drift apart. The Settings pack button additionally
disables itself with explanatory copy when the gate is on (UI nicety; the boundary is the
enforcement).

### B7. Serializing "Clear art cache" against lazy + pack downloads

Rev 2 used the epoch alone and checked it *before* awaiting the rename - so a `clear()`
starting after the check and finishing before the rename would see its cleared file
recreated; a `stat` that straddled a clear could memoize a deleted URI; and `inflight`
survived the clear, so a new request could join an obsolete promise (Codex Major 2). Rev 3's
mechanism (specified in B3, argued here):

- **The promotion lock is the linearization point.** Every write into `art/` - the promote
  rename, the wrong-size delete, the quarantine delete, and `clear()`'s `deleteTree` - runs
  inside `withPromotionLock`, and the rename/delete paths re-read the epoch *inside* the
  lock. The lock is held only for that one filesystem operation, **never across a network
  download**, so it cannot serialize downloads behind each other.
- `clear()` in full:

  ```
  clear():
    epoch++                          # invalidates every captured reqEpoch immediately
    resolved.clear(); retried.clear()
    inflight.clear()                 # detach: in-flight promises keep running but can no
                                     # longer be joined; their promotions will be refused
                                     # inside the lock; their finally cannot evict newer
                                     # entries (identity check, B3)
    await withPromotionLock(() => io.deleteTree('art'))   # temps live in art/.tmp, so they
    clear the Preferences pack stamp                      # go too
  ```

- **Why a cleared file cannot reappear:** `epoch++` happens-before `deleteTree` acquires the
  lock. Any promotion that acquires the lock *after* `deleteTree` re-reads the epoch inside
  the lock, sees the bump, and refuses (temp deleted, nothing written). Any promotion already
  *holding* the lock completes first - and its file is then removed by `deleteTree`, which is
  queued behind it. Either interleaving ends with `art/` empty.
- **Why a deleted URI cannot be memoized or returned:** the epoch is captured before the
  first `await` (`stat` included), every `resolved.set()` and every local-URI return is
  epoch-guarded, and a mismatch re-enters `resolve()` fresh under the new epoch.
- **Why a new request cannot join a dead flight:** `inflight` entries carry their epoch; the
  join requires `entry.epoch === epoch`; `clear()` empties the map besides. An old promise's
  `finally` deletes its entry only if the map still holds *that* entry, so it cannot race
  away a newer request's registration.
- `downloadAll` re-checks the epoch between items and exits `cancelled` on a bump; each
  item's promote goes through the same locked, epoch-checked path. No queue, no
  await-all-inflight.

**Pack stamp = reporting only.** The Preferences `artPack` stamp (`{ catalogVersion, count,
bytes, completedAt }`) feeds copy like "last completed …". Completeness is always
`stats().complete` - a live comparison of `art/` contents against the shipped manifest's keys.
The stamp is never consulted to skip work, never treated as evidence files exist, and a
missing/stale stamp changes no behavior. (Content-addressing makes the file comparison exact:
a stale pre-correction file does not count toward the *current* manifest's completeness.)

### B8. Android backup exclusion

`AndroidManifest.xml:5` sets `android:allowBackup="true"` with no rules files, so today
*everything* in `getFilesDir()` would enter Google backup - which is where `Directory.Data`
maps. A 285 MB derived, re-fetchable cache must not ride device backups or device-to-device
transfers. Changes (design; exact files):

`android/app/src/main/AndroidManifest.xml` `<application>` gains:

```xml
android:fullBackupContent="@xml/backup_rules"
android:dataExtractionRules="@xml/data_extraction_rules"
tools:targetApi="s"
```

New `android/app/src/main/res/xml/backup_rules.xml` (API <= 30 path):

```xml
<full-backup-content>
    <exclude domain="file" path="art/" />
</full-backup-content>
```

New `android/app/src/main/res/xml/data_extraction_rules.xml` (API 31+):

```xml
<data-extraction-rules>
    <cloud-backup>     <exclude domain="file" path="art/" /> </cloud-backup>
    <device-transfer>  <exclude domain="file" path="art/" /> </device-transfer>
</data-extraction-rules>
```

Exclude-only rules keep the default include for everything else, so SQLite profile data and
Preferences keep exactly today's backup posture - the rules narrow nothing but the art cache.
Evidence: `adb shell bmgr backupnow` + restore on the test device, confirming profile data
survives and `art/` is absent (plus a backup payload size sanity check).

### B9. The poster/canvas path

`deckPoster.js` uses the same resolver and the same candidate chain (B3.5), attempted
**sequentially** - `_loadImg` already resolves `null` on error (`deckPoster.js:11-12`), which
makes the walk three short lines:

```js
// replaces deckPoster.js:71
let hero = null;
const first = await artCache.resolve(deck.avatarSlug);            // local, remote, or null
if (first) hero = await _loadImg(first.kind === 'remote' ? corsSrc(first.src) : first.src);
if (!hero) {
  const legacy = artCache.legacySrc(deck.avatarSlug);             // bundledLegacy candidate
  if (legacy) hero = await _loadImg(legacy.src);                  // same-origin: no taint
}
// hero === null -> poster renders without a hero (current behavior, zero-image included)
```

Outcomes per candidate: **local** `convertFileSrc` URI (expected steady state - same-origin
via the app scheme, no taint, **device evidence still required**: export a poster from a
cached avatar and confirm `toDataURL` does not throw); **remote** (first-ever view:
`corsSrc` sets `img.crossOrigin='anonymous'`, which requires the R2 CORS policy from rev 1
Phase 0 - device evidence again); **bundledLegacy** (offline Phase-2 upgrade: bundled asset,
same-origin, no taint - this is the poster variant of the Major-1 test, B10.8); **null**
(zero-image or no avatar: poster renders without a hero, current behavior). The poster is the
one consumer where the chain's local-first order is not just performance but correctness,
because the local file sidesteps taint entirely.

### B10. Resubmission evidence this design enables

All boundary tests are pure `node --test` over the `artSource` reducer and the `artCache`
core with a fake `io` - **no DOM harness**. React Testing Library is not installed, is not in
the approved dependency set (`aws4fetch` only), and is not requested by this design; if a DOM
harness is ever wanted it must be separately declared and approved. (Rev 2 named RTL for the
generation-guard test; that guard is now a reducer transition - testable without a DOM.)

1. **Single-flight test**: two concurrent `resolve(k)` calls produce exactly one
   `io.download`; both settle to the same candidate.
2. **Reducer tests** (`artSource.js`, replacing the rev-2 RTL test):
   stale-resolution guard (a `RESOLVED` carrying a superseded key is dropped); broken-reset
   (KEY transition re-arms after a prior error - the `CardArt.jsx:11` defect, pinned); the
   full candidate walk `local -> quarantining -> remote -> legacy -> broken`, each arm;
   zero-image `RESOLVED(null)` goes straight to `broken` without consulting legacy.
3. **Quarantine tests**: local decode failure deletes the file, re-downloads once, and a
   second failure yields the remote candidate with no further downloads (`retried`
   respected); **a successful quarantine that re-resolves to the byte-identical local URI
   still produces a state change** - `gen` bumps, so the keyed `<img>` remounts (Codex
   Major 2's rerender counterfactual).
4. **Zero-image I/O test**: with the gate on, `resolve`/`download`/`downloadAll`/
   `quarantine`/`legacySrc` return null/no-op and the fake `io` records zero calls -
   download prohibition, not just render prohibition.
5. **Clear counterfactuals** (Codex Major 2, each against the fake `io` with controllable
   promise ordering):
   - clear during an existing-file `stat`: the stale attempt neither memoizes nor returns
     the deleted URI; the caller's promise settles from a fresh attempt under the new epoch;
   - clear between download completion and promotion: the rename is refused inside the lock,
     the temp is deleted, `art/` ends empty - a cleared file cannot reappear;
   - a promotion already holding the lock when `clear()` runs: the rename completes, then
     `deleteTree` (queued behind it) removes the file - `art/` still ends empty;
   - an inflight request, then `clear()`, then a new same-key request: the new request does
     NOT join the obsolete promise (epoch-tagged entries) and triggers its own download;
   - the old promise's `finally` racing the new entry: the newer inflight registration
     survives (entry-identity check).
6. **Non-rejecting-resolve test**: the fake `io` throwing at each adapter call site in turn
   still settles `resolve()`'s promise (remote candidate or null) - the `Promise` contract
   never unhandled-rejects.
7. **Failure-not-cached test**: a 404 download persists nothing and a later `resolve`
   retries.
8. **Legacy-fallback production-path tests** (Codex Major 1): with the fake `io`, native
   download fails AND the remote candidate is error'd by the consumer - the machine lands on
   `bundledLegacy` and its `src` is the bundled `legacyKey` path (render variant, via the
   reducer); the poster walk under the same double failure loads the bundled candidate
   (poster variant, `_loadImg` faked). Both assert the bundled path is used, not the
   deterministic fallback.
9. **validSize fail-closed test** (Codex Minor 3): a key absent from the manifest validates
   false - the cached file is quarantined and nothing is promoted; the rev-2 `n > 0` branch
   does not exist.
10. **Seam-guard test (extended + sensitivity)**: no `${BASE}cards/` template and no
    `artUrl`/`cardImageUrl` import outside `cardArt.js`/`artCache.js` anywhere in `src/**`;
    the guard's own fixtures prove it detects both offence classes; and the recorded
    red-first run against the pre-adoption tree names `CardArt.jsx`, `CardArtViewer.jsx`,
    `CollectionCardSheet.jsx`, and `LifeCounter.jsx` (B5).
11. **Stats-vs-stamp test**: `stats().complete` reflects files-vs-manifest even when the
    stamp claims completion (stamp is reporting only).
12. **Device evidence**: lazy view -> airplane -> restart persistence; pack download + clear
    mid-pack; zero-image full-route sweep now covering the ex-bypass sites AND LifeCounter +
    SiteArt; poster taint on the local, remote, and bundledLegacy paths; **offline-upgrade
    check**: install a Phase-2 build over a Phase-1 build with the network off - card and
    Site photography renders from the bundle (Major 1's scenario on hardware); backup
    exclusion per B8.

---

## Interaction between the two designs

Content-addressing (A) is what makes the boundary (B) simple: because a key names immutable
bytes, the device cache needs no revalidation, no TTL, no purge protocol, and exact-size
validation (fail-closed against the shipped manifest) is a sufficient integrity check;
because the boundary is the only reader, the key scheme needs no compatibility shims at
render sites. The one deliberate impurity is transitional: the manifest's `legacyKey` and the
`bundledLegacy` candidate let a Phase-2 offline upgrade keep photography from the still-
bundled base images, and both are deleted in Phase 5 with the bundle. The two designs land in
rev 1's existing phase skeleton: A replaces the Phase 1 pipeline work and Phase 0/1 upload
tooling contracts (plus the Phase-0 ETag canary and the `sharp` pin); B replaces the Phase
2/3 seam-and-cache design and adds the B8 manifest work to Phase 3.
