# Codex review request - art-CDN Phase 1 IMPLEMENTATION (post-corrective)

**Branch:** `art-cdn`. **Tip:** `fb33ddc`. The rev-6 DESIGN is approved (do not reopen). This adds the
Phase-1 completion increment that closes your Changes-required disposition. Phase 1 is **dormant**: it
converts + durably stages + can upload objects additively, but promotes no catalog and changes no app
behavior.

## Range

```
git fetch origin && git checkout art-cdn      # tip fb33ddc
git diff 5d7c662..fb33ddc                      # the corrective increment (review this)
git diff acc16f4..fb33ddc                      # the whole Phase-1 implementation, for context
```

## How the disposition was addressed (all in fb33ddc)

- **Blocker (never-overwrite not enforced by R2):** every create is now a conditional PUT with
  `If-None-Match: *`; a 412 is decided by an authoritative HEAD. The pure repair seam changed from
  `remoteLookup`/`putObject` to a single atomic `claimObject` outcome (`created|reused|conflict|retry`),
  so no stale/incomplete listing or racing run can clobber an immutable object. New `claimOutcome` +
  a **race test** (listing thought the slot absent, the atomic claim reports conflict -> advances).
- **Major (staging deferred):** durable staging finished in Phase 1 - `convertFresh` writes through a
  per-slug temp, validates the webp, atomically replaces `cdn-art/<slug>.webp`; the prospective
  manifest is written to `.catalog-build/art-manifest.json` (never `public/catalog`). The uploader
  reads staged bytes by slug and re-verifies byte count + sha256 + md5 immediately before every PUT.
- **Major (real dry run broken):** `report.mjs` read the retired image-report shape. One combined
  images contract now carries manifest conversion + assignment + reverse exclusions + unmatched scans;
  `report.test.mjs` runs a real `buildGeneration` report through `formatReport`. **Real `--dry-run`
  passes: 3087 objects, 5 no-scan, 4 unmatched, 3 reverse faces excluded** (matches your run).
- **Major (--check exits 0 on failure):** `--check` is fail-closed - throws unless PUT ETag==MD5, the
  listing matches size+ETag, a public base is configured, the public GET succeeds, and content-type +
  immutable cache header + body all match. The unreachable signed-HEAD fallback claim is removed.
- **Minors:** canonical `setRank` (`Number.MAX_SAFE_INTEGER`, numeric-vs-promotional test); the named
  hash tests (art-key-change reseeds; encoder-only does not); `assertManifest` now validates tier,
  64-hex `srcSha256`, encoder provenance, and `incidentOf` as a real same-slug/digest predecessor;
  `listRemote` decodes the continuation token and fails closed on a truncated page with no token; the
  dormant completion message updated; `package-lock.json` synced to the sharp 0.32.6 pin.

## Not pushed

Local tip `fb33ddc`; `origin/art-cdn` remains behind pending this review, per your instruction.

## Original checkpoint context (the five prior commits)

## What landed (five commits)

1. `4e95b43` **(1/n, corrective - already seen)** `artManifest.mjs` made async (awaits injected
   `hashFile`/`convertFresh`/`hashBytes`, bounded `mapPool`), md5 stored as lowercase HEX +
   `contentMd5(hex)->base64` PUT helper, fail-closed `assertManifest` (all fields + digests, only
   `repair-[1-9]`, `incidentOf` required on incident keys, validates committed input AND built output).
2. `70962a9` **(2/n)** `planImages` is now a pure per-finish lookup over the finished manifest: a
   variant with its own scan gets its OWN content key (foils are no longer collapsed onto the
   standard), a finish with no scan borrows a sibling of the same printing, a printing with no scan is
   `image=null`. `buildGeneration` takes the built `artManifest` (not `dropPngNames`) and folds the
   per-slug `slug\0key` DIGESTS into the version hash, so a corrected scan moves the version token and
   reseeds. `validateGeneration` checks every image against the manifest keys. `update-catalog.mjs`
   builds the manifest first (real sharp deps, reverse faces `-s-r`/`-f-r` excluded) then STOPS before
   promotion with a dormant `RESULT: OK (dormant)`. Tests rewritten for content keys.
3. `24f3189` **(3/n)** New pure `scripts/catalog/cdnUpload.mjs`: `planUpload` (put/skip/conflicting;
   a skip requires BOTH size AND etag), `repairKey` (the rev-6 never-overwrite `repair-<n>` loop:
   PUT the first absent slot, REUSE a slot already holding correct bytes, advance past a
   present-but-wrong slot; runaway guard fails closed), `auditPublish` (refuses unless every needed
   key is published with matching size + integrity digest; `integrity:'sha256'` carries the
   canary-failed signed-HEAD evidence). 11 mutation-checked tests (flip size OR etag alone -> outcome
   flips). `incidentKey` moved to `artManifest.mjs` so the repair loop and `assertManifest`'s KEY_RE
   share one key-construction site.
4. `afb5544` **(4/n)** `cdn-upload.mjs` rewritten as the thin R2 network seam over the pure engine
   (paginated ListObjectsV2 -> remote map; PUT with Content-MD5; `--check` is now the Phase-0
   `ETag == MD5` canary; clean-path audit). `cdn-convert.mjs` retired (its job is `convertFresh`; it
   named outputs by source filename, not content key). `sharp` pinned to `0.32.6` (encoder is recorded
   as byte provenance).
5. `5d7c662` **(fix)** the `--repair-conflicts` path stops before the manifest-key audit, because the
   manifest still names the conflicted originals until the promote repoints `v.image` (a Phase-2 job).

## Gates

`npm run test:catalog` 78 pass (incl. 11 new engine tests), `check:cycles`, `check:types`, `check:docs`
all green. No `src/` app code touched.

## Where to attack

- **Content-fresh contract:** any residual existence-skip in `artManifest.mjs`/`update-catalog.mjs`
  (the skip oracle must be `srcSha256` AND `recipeId` only; a miss must convert fresh).
- **Repair loop:** does `repairKey` truly never overwrite, and converge on every interruption ordering
  (crash after PUT-before-promote; a `repair-1` that itself took a bad write)? Is the runaway guard right?
- **planImages:** the per-finish flip - can a foil ever silently reuse the standard key when it has its
  own scan? Is the sibling fallback and card-default selection correct? `noScan` accounting.
- **Hash fold:** does folding `slug\0key` (not filenames) actually reseed on a corrected scan and NOT
  bump on an encoder-only metadata change?
- **Adapter (network glue, not unit-tested):** ListObjectsV2 pagination/parse, Content-MD5 derivation,
  the audit's integrity comparison, the canary's fail branch.

## Known Phase-2 gap (called out, not a defect)

The uploader reads content-key-named bytes from `CATALOG_DROP/cdn-art`, but nothing populates that
staging yet (`update-catalog`'s conversions are in-memory Buffers). Persisting the staged bytes and
wiring upload -> repoint -> journaled promote atomically is the Phase-2 activation, deliberately out of
this dormant scope.

## Not in scope

Phase 2 (atomic activation: seam + `artCache`/`ArtImage` boundary + 14 bypass sites), Phase 3
(pack + backup), Phase 5 (unbundle), Phase 6 (Standard/Foil card sheet). No app behavior changed here.
