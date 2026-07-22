# Art CDN rev 2 - architecture redesigns

Companion to `docs/proposals/art-cdn-migration.md` (rev 1, Codex disposition: Changes required).
This document answers the two architectural findings. It is design only - no production code
exists for either piece. Both sections are written to be merged into proposal rev 2 verbatim.

- **Section A** resolves the **Blocker**: mutable slugs under an immutable cache header make
  corrected art permanently stale. Redesign: content-addressed object identity.
- **Section B** resolves the **Major** (and the zero-image **Minor**): a partial cache boundary
  that double-fetches, races, and leaves ~14 render sites remote-only. Redesign: one shared
  `artCache` / `useArtSource` / `ArtImage` boundary for every card-art pixel in the app.

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

### A2. Object key scheme and digest

**Key format:** `<variant-slug>.<sha256-prefix-12>.webp`
Example: `001-abundance-b-s.4f2a9c1d8e3b.webp`

Slug first, digest second: object listings group by card, keys stay grep-able against the
catalog, and `printingBase()` (`scripts/catalog/curiosa.mjs:15-17`) style suffix reasoning is
untouched because the digest segment is strictly appended between slug and extension.

**Digest input: the OUTPUT WebP bytes.** SHA-256 over the exact bytes that will live on R2,
computed in the conversion stage immediately after sharp writes the file (the unified 745 px
q80 converter - rev 1 already merges `convertOne` at `images.mjs:107` with the
`cdn-convert.mjs:20-21` constants). Hashing the output rather than the source is what makes
the key a promise about what the CDN serves: any change in encoder settings, sharp version, or
source scan that changes served bytes changes the key; anything that leaves served bytes
identical leaves the key identical.

**Encoder-drift containment.** sharp/libwebp output is deterministic for a fixed version +
input + parameters, but a sharp upgrade could alter output bytes corpus-wide and re-key all
3090 objects. Two containments: (1) conversion is **skipped when the SOURCE is unchanged**
(A4), so an encoder upgrade re-keys nothing unless a forced `--reconvert` is passed; (2) the
manifest diff is printed before upload ("N keys changed"), so a surprise mass re-key is a
loud, refusable event, never a silent 285 MB re-push.

**Prefix length: 12 hex chars (48 bits). Justification.** Collisions only matter *within one
slug* - two different byte-versions of the same variant colliding on the prefix - because
distinct slugs can never share a key (the slug is part of it). A slug accrues a handful of
byte-versions over its life; the per-pair collision odds are 2^-48, and even treating the
whole corpus (~3090 slugs, ~10k objects someday) as one birthday pool the collision
probability is under 2e-7. Additionally the build holds **full** 64-char digests in the
manifest (A3), so the manifest builder detects any prefix collision deterministically and
fails the run (`two digests for slug X share prefix Y - refusing`). 8 chars would survive the
math too; 12 costs four characters and removes the topic from review permanently. Full 64-char
keys were rejected: 69-char basenames hurt every log, listing, and directory readout for zero
additional safety given build-time collision detection.

### A3. `art-manifest.json` - shape, home, and roles

**Location: `public/catalog/art-manifest.json`, committed.** It is catalog generation output,
promoted by the same journaled promote as `cards.json`, versioned by the same content hash,
and rolled back by the same `git revert`. Not gitignored staging: the manifest is the durable
ledger of "which bytes each slug currently publishes," and its git history is the rollback
record (A8). It also ships in the APK for free (~3090 entries, ~300 KB minified - noise inside
an 18 MB artifact) which gives the runtime exact byte sizes for pack progress and cached-file
validation (B3) without a network round trip.

**Shape** (one entry per variant slug; sorted keys; minified like `cards.json`):

```json
{
  "tier": { "width": 745, "quality": 80, "format": "webp" },
  "objects": {
    "001-abundance-b-s": {
      "key": "001-abundance-b-s.4f2a9c1d8e3b.webp",
      "sha256": "4f2a9c1d8e3b…64 hex…",
      "bytes": 94211,
      "srcSha256": "…64 hex of the source PNG…"
    }
  }
}
```

Map-by-slug (not an array) makes "exactly one current object per slug" structural and gives
`planImages` an O(1) repoint lookup. `srcSha256` exists solely for the conversion skip rule
(A4); the runtime ignores it.

**The manifest is the single source of truth for five consumers:**

| Consumer | Rule |
|---|---|
| Conversion | Skip a slug iff `manifest.objects[slug].srcSha256 === sha256(drop PNG)`. Source changed or slug new -> convert, hash output, write a new entry. No source PNG in the drop and an entry exists -> keep the entry (incremental drops stay legal). |
| Upload diff | Upload exactly `manifest keys − remote keys` (S3 `ListObjectsV2` on the bucket, ~4 pages). PUT carries `x-amz-checksum-sha256` (base64 of the full digest) so R2 rejects corrupt writes server-side. Remote truth, not a local ledger: a key present remotely was checksum-validated at write time, so presence + size match *is* checksum verification. |
| Publish audit | Every distinct `v.image` in the staged `cards.json` must be a `manifest.objects[*].key` AND present in the remote listing with `size === bytes`. Any miss refuses the promote. One listing call, not 3090 HEADs. |
| Catalog hash | `generation.mjs:90-97` replaces `imagePlan.manifest.join('\n')` with the serialized art manifest (keys + full sha256). Corrected bytes -> new digest -> new hash -> version token bump -> reseed. (Belt and suspenders: `serializeCards` already moves too, because `v.image` embeds the prefix.) This closes the exact hole Codex found at `generation.mjs:95`. |
| Rollback | `git revert` of manifest + `cards.json` restores the prior keys. R2 is additive-only; the old objects were never deleted, so rollback is a repoint with zero remote action (A8). |

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
buildArtManifest({ committed, dropSources, convertedDir, hashFile }):
  next = clone(committed.objects)
  for (slug, pngPath) of dropSources:            # finish-suffixed slugs, reverse faces excluded
    srcSha = hashFile(pngPath)
    if next[slug]?.srcSha256 === srcSha: continue        # unchanged source: keep key
    webpBytes = ensureConverted(pngPath, convertedDir)   # sharp 745/q80, idempotent
    sha = sha256(webpBytes)
    next[slug] = { key: `${slug}.${sha.slice(0,12)}.webp`,
                   sha256: sha, bytes: webpBytes.length, srcSha256: srcSha }
  assertNoPrefixCollisions(next)                 # full digests differ but prefixes match -> throw
  return { tier, objects: sortKeys(next) }
```

Staging file naming stays **plain-slug** (`cdn-art/001-abundance-b-s.webp`) - the
content-addressed name exists only in the manifest, on R2, and on devices. The staging file is
re-hashed cheaply whenever needed; if it is deleted but `srcSha256` matches, no reconversion is
needed either, because the object already exists remotely (verified by the audit). A routine
no-image drop therefore still needs neither sharp nor `.env.r2`.

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
every manifest entry's `key` must equal `` `${slug}.${sha256.slice(0,12)}.webp` `` (shape
integrity, catches hand-edits).

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
  `srcSha256` for all 3090 sources); `CATALOG_DROP/Card Images high res` is on disk today. If
  `cdn-art/` staging still holds the converted WebP, no re-encode happens - the builder hashes
  the existing outputs; otherwise it reconverts (one-time ~cost of `cdn-convert.mjs`).
- Never derive the manifest by downloading and hashing R2 objects: the build machine's bytes
  are the source of truth; the remote is the thing being audited.
- Optional cleanup (delete un-suffixed keys) is a follow-up allowed only after the slim APK is
  the sole build in the field; it is never required for correctness.

### A8. Rollback

`git revert` of the promote commit restores the previous `cards.json` + `art-manifest.json`;
the version token's string-inequality compare reseeds back; every key the reverted catalog
references still exists on R2 because objects are never overwritten or deleted. Rolling
forward again is the same operation. The manifest's git history is a complete, auditable
byte-level provenance record for every slug.

### A9. Resubmission evidence this design enables

1. **Corrected-scan test** (`images.test.mjs` / `artManifest` tests): same slug, changed
   source bytes -> new `srcSha256` -> new key in the manifest, old key absent, `v.image`
   repointed. The rev 1 contradiction becomes an assertable behavior.
2. **Hash-moves-on-bytes test** (`generation` tests): two generations with identical
   filenames but different manifest digests produce different content hashes - the exact
   defect at `generation.mjs:95`, pinned.
3. **Upload-diff test**: manifest vs a mocked remote listing uploads exactly the absent keys;
   a re-run uploads zero.
4. **Audit-refusal test**: staged catalog referencing a key missing from the mocked remote
   listing (or size-mismatched) refuses to promote.
5. **Prefix-collision test**: two full digests sharing a forged 12-char prefix under one slug
   make the manifest builder throw.
6. **Device evidence** (manual, phase checkpoint): view a card, republish corrected bytes for
   its slug, update catalog, reinstall/reseed -> the new art renders with no cache clear and
   no purge, while airplane-mode still serves the previously cached keys.

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
over an injected `io` adapter (`stat/download/rename/delete/list/now`), with the thin
Capacitor adapter as the only native-touching code - so single-flight, epoch, and quarantine
logic are unit-testable DOM-free.

```js
// -- reading --
resolve(key)   // Promise<string|null>: displayable src - validated local file URI (native),
               // remote URL (web, or native last-resort after a failed download),
               // or null (zero-image mode / falsy key). THE only art entry point.
peek(key)      // string|null, sync: memoized prior resolution, for flash-free first paint.

// -- writing --
download(key)          // Promise<boolean>: ensure cached locally. No-op on web and in
                       // zero-image mode. Shares the same single-flight as resolve().
downloadAll(keys, { onProgress, shouldStop })   // the pack; concurrency 6; epoch-aware.

// -- lifecycle --
clear()        // Promise<void>: bump epoch, delete Directory.Data/art recursively,
               // drop memos, clear the Preferences pack stamp.
stats()        // Promise<{ files, bytes, complete }>: complete is computed by comparing
               // the art/ listing against the manifest keys - NEVER read from the stamp.
```

Internal state (the data structures Codex asked for):

```js
const inflight = new Map();   // key -> Promise<string|null>   (single-flight per key)
const resolved = new Map();   // key -> local URI               (session memo; feeds peek)
const retried  = new Set();   // keys quarantined+retried once this session
let   epoch    = 0;           // cache generation counter; clear() increments it
```

### B3. Resolution algorithm

**Web (`!isNative()`):** `resolve(key)` returns `imagesDisabled() ? null :
`${ART_CDN_BASE}/${key}``. The browser HTTP cache is the cache; no Filesystem anywhere.

**Native - local-first, single-download, no parallel remote `<img>`:**

```
resolve(key):
  if (!key || imagesDisabled()) return null            # zero-image: no render, no I/O (B6)
  if (resolved.has(key)) return resolved.get(key)
  if (inflight.has(key)) return inflight.get(key)      # single-flight join
  p = (async () => {
    st = await io.stat(`art/${key}`)                   # Directory.Data
    if (st && validSize(key, st.size)):                # validation, below
      uri = convertFileSrc(st.uri); resolved.set(key, uri); return uri
    if (st) await io.delete(`art/${key}`)              # wrong-size file: quarantine now
    myEpoch = epoch
    tmp = `art/.tmp/${key}.${rand()}`                  # unique temp per attempt - no races
    ok = await io.download(remoteUrl(key), tmp)        # Filesystem.downloadFile, else
                                                       # CapacitorHttp -> writeFile
    if (!ok || !validSize(key, await size(tmp)) || myEpoch !== epoch):
      await io.delete(tmp)                             # NEVER persist a failure or a stale-
      if (myEpoch !== epoch) return null               # epoch download (B7)
      return remoteUrl(key)                            # sequential last resort: let the <img>
                                                       # try (WebView HTTP cache may hold it);
                                                       # nothing was cached, nothing races
    await io.rename(tmp, `art/${key}`)                 # atomic promote
    uri = convertFileSrc(...); resolved.set(key, uri); return uri
  })().finally(() => inflight.delete(key))             # failures are NOT memoized: a 404/
  inflight.set(key, p); return p                       # offline miss retries on next view
```

**Validation is exact-size-against-the-manifest, not mere existence.** `validSize(key, n)`
looks the key's slug up in the shipped `art-manifest.json` (A3) and requires `n ===
entry.bytes` (fallback `n > 0` if the manifest lacks the slug). This is *stronger* than a
RIFF/WEBP magic sniff - a truncated file, an HTML error page, or a wrong-object write all fail
it - and it costs one `stat`, no base64 read-back (Capacitor's `readFile` cannot read ranges,
so magic-sniffing would mean reading the whole file over the bridge). Decode-level corruption
is caught by the second layer:

**Decode-failure quarantine, retry once.** When an `<img>` whose `src` is a *local* URI fires
`onError`, `ArtImage` calls `artCache.quarantine(key)`: delete the file, drop the memo, and -
if `!retried.has(key)` - add to `retried` and `resolve(key)` again (fresh download). A second
failure leaves the deterministic fallback. `retried` is session-scoped, so a transient bad
write never bricks a slug, and a persistently bad object cannot cause a retry storm.

### B4. `useArtSource` and `ArtImage` - the two consumption forms

**Hook** (for bespoke markup: `CardArtViewer`'s rotated Site layout, and any future custom
`<img>`):

```jsx
export function useArtSource(key) {
  const [src, setSrc] = useState(() => artCache.peek(key));
  useEffect(() => {
    if (!key) { setSrc(null); return; }
    let alive = true;                                   // generation/unmount guard: a stale
    setSrc(artCache.peek(key));                         // promise can never write into a
    artCache.resolve(key).then((s) => { if (alive) setSrc(s); });  // component whose key moved on
    return () => { alive = false; };
  }, [key]);
  return src;   // null => render nothing over the fallback (never an empty <img>)
}
```

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
  const src = useArtSource(artKey);
  const [brokenFor, setBrokenFor] = useState(null);
  const broken = brokenFor === src;          // derived: a NEW src auto-clears broken -
                                             // fixes the CardArt.jsx:11 retention defect
  const onError = () => {
    if (src?.startsWith('http')) { setBrokenFor(src); return; }     // remote 404 -> fallback
    artCache.quarantine(artKey).then((again) => again || setBrokenFor(src));  // local: B3
  };
  const img = src && !broken ? <img src={src} onError={onError} ... /> : null;
  if (bare) return img ?? fallbackNode;
  return <div style={{ background: cardFallbackArt(card), ... }}>{img}{frame.children}</div>;
}
```

`CardArt.jsx` becomes a ~5-line shell: `<ArtImage artKey={card?.image_slug} card={card}
{...props} />` (its public props are `ArtImage`'s framed-mode props, so its ~20 call sites do
not change). `CardArtViewer.jsx:140` swaps `cardImageUrl(card)` for
`useArtSource(card?.image_slug)` and keys its `broken` reset the same derived way; its markup,
FLIP, and tilt code are untouched. `cardImageUrl`/`artUrl` in `cardArt.js` remain the URL
formatters, but **only `artCache` may call them for card art** - the seam-guard test extends
to ban `artUrl(`/`cardImageUrl(` imports outside `artCache.js`, `cardArt.js`, and their tests,
closing the "new site quietly renders remote-only" class, not just the `${BASE}cards/` class.

### B5. Adoption map - every render site, the drop-in swap

| Site | Today | Rev 2 |
|---|---|---|
| `src/components/CardArt.jsx` | own `<img>` + retained `broken` | shell over framed `ArtImage` |
| `src/components/CardArtViewer.jsx:140,184` | `cardImageUrl` + own `broken` | `useArtSource` + derived broken |
| `src/pillars/AvatarPicker.jsx:97,120,137` | inline `${BASE}cards/` | `<ArtImage bare artKey={….image_slug} …/>` |
| `src/pillars/DeckDashboard.jsx:170,339,452` | inline + display-none onError | bare mode (null replaces display-none) |
| `src/pillars/Decks.jsx:28` | inline hero | bare mode |
| `src/pillars/DecksPager.jsx:470` | inline | bare mode |
| `src/pillars/Home.jsx:185,478,512` | inline; `:512` picks `<img>` vs `dw-deckph` by slug | bare mode; `:512` passes `fallbackNode={<div className="dw-deckph"/>}` |
| `src/pillars/Play.jsx:138,169` | inline | bare mode |
| `src/components/CreateDeckWizard.jsx:101` | inline | bare mode |
| `src/store/deckPoster.js:71` | `_loadImg(`${BASE}cards/…`)` | `const src = await artCache.resolve(deck.avatarSlug)`; null -> no hero (B9) |

Every swap is mechanical: the conditional wrapper (`{slug && <img …>}`) collapses into
`ArtImage`, which conditions on the **resolved src**, not the raw slug. That is the structural
fix for Codex's Minor: no site can render an empty `<img>` in zero-image mode anymore, because
no site renders an `<img>` at all - the boundary does, and only when it has a real src.

### B6. Zero-image contract (`cx-no-images`)

`imagesDisabled()` is checked **inside the boundary**, at the top of `resolve`, `download`,
and `downloadAll`: with the gate on, no URL is formed, no `stat` runs, no download starts, no
byte is written. Rendering and I/O are prohibited by the same line of code, so they cannot
drift apart. The Settings pack button additionally disables itself with explanatory copy when
the gate is on (UI nicety; the boundary is the enforcement).

### B7. Serializing "Clear art cache" against lazy + pack downloads

The epoch counter is the lock:

- `clear()`: `epoch++`, then delete `art/` (temps live in `art/.tmp/`, so they go too), drop
  `resolved`/`retried`, clear the stamp.
- Every download captures `myEpoch` **before** it starts and re-checks `myEpoch === epoch`
  **before the rename-promote** (B3). A download that straddles a clear deletes its temp and
  promotes nothing - a cleared file cannot reappear, because the epoch-gated rename is the
  *only* write into `art/`.
- `downloadAll` re-checks the epoch between items and exits `cancelled` on a bump. No mutex,
  no queue, no await-all-inflight: the gate at the single promotion point is sufficient.

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

`deckPoster.js` uses the same resolver, not the component: `await
artCache.resolve(deck.avatarSlug)`, then `_loadImg(src)`. Three outcomes: local
`convertFileSrc` URI (expected steady state - same-origin via the app scheme, no taint,
**device evidence still required**: export a poster from a cached avatar and confirm
`toDataURL` does not throw); remote URL (first-ever view: set `img.crossOrigin='anonymous'`,
which requires the R2 CORS policy from rev 1 Phase 0 - device evidence again); `null`
(zero-image or no avatar: poster renders without a hero, current behavior). The poster is the
one consumer where `resolve`'s local-first order is not just performance but correctness,
because the local file sidesteps taint entirely.

### B10. Resubmission evidence this design enables

1. **Single-flight test** (pure core, fake `io`): two concurrent `resolve(k)` calls produce
   exactly one `io.download`; both settle to the same URI.
2. **Generation-guard test**: resolve settling after the hook's key changed does not write the
   stale src (React Testing Library, fake timers).
3. **Broken-reset test**: a key/src change renders the `<img>` again after a prior error - the
   `CardArt.jsx:11` defect, pinned.
4. **Quarantine test**: local decode failure deletes the file, re-downloads once, and a second
   failure yields fallback with no further downloads (`retried` respected).
5. **Zero-image I/O test**: with the gate on, `resolve`/`download`/`downloadAll` return
   null/no-op and the fake `io` records zero calls - download prohibition, not just render
   prohibition.
6. **Clear-vs-download race test**: `clear()` between a download's start and its promote
   leaves `art/` empty (temp deleted, no rename) - cleared files cannot reappear.
7. **Failure-not-cached test**: a 404 download persists nothing and a later `resolve` retries.
8. **Seam-guard test (extended)**: no `${BASE}cards/` template and no `artUrl`/`cardImageUrl`
   import outside `cardArt.js`/`artCache.js` anywhere in `src/**`.
9. **Stats-vs-stamp test**: `stats().complete` reflects files-vs-manifest even when the stamp
   claims completion (stamp is reporting only).
10. **Device evidence**: lazy view -> airplane -> restart persistence; pack download + clear
    mid-pack; zero-image full-route sweep now covering the ex-bypass sites; poster taint both
    paths; backup exclusion per B8.

---

## Interaction between the two designs

Content-addressing (A) is what makes the boundary (B) simple: because a key names immutable
bytes, the device cache needs no revalidation, no TTL, no purge protocol, and exact-size
validation is a sufficient integrity check; because the boundary is the only reader, the key
scheme needs no compatibility shims at render sites. The two designs land in rev 1's existing
phase skeleton: A replaces the Phase 1 pipeline work and Phase 0/1 upload tooling contracts; B
replaces the Phase 2/3 seam-and-cache design and adds the B8 manifest work to Phase 3.
