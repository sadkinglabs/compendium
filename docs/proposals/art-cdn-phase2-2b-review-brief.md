# Codex review request - art-CDN Phase 2b (activation) + Phase 6 (Standard/Foil sheet + wishlist)

## Read first

Two logically distinct bodies of work sit on one branch because they ship together and Phase 6's
foil art is the reason the CDN exists. **2a (the inert boundary) was reviewed and APPROVED** at
`e73811f`; this request covers **only what landed after it**. Reviewing them as one branch is correct -
they merge to `main` as a unit.

- **Part A - art-CDN Phase 2b (atomic activation).** The seam is flipped: every render site now resolves
  art through the tested boundary (`useArtSource`/`ArtImage`) instead of `${BASE}cards/`, the catalog is
  repointed to content-addressed keys, the full manifest ships, `initArtCache()` runs at boot, and the
  Android backup exclusion is in. The app now serves card art from `cdn.sadkinglabs.com` + the on-device
  cache. **Live and verified on a Pixel 9 Pro XL (build 146+).**
- **Part B - Phase 6 (Standard/Foil sheet + per-item wishlist).** `CollectionCardSheet` gained a
  Standard/Foil toggle (foils are now wishlist-able), a two-column layout with a centered `[-] N [+]`
  ownership console, and the wishlist now opens each row scoped to its exact printing (set + finish) with
  no set picker. Backed by two new pure store selectors (`selectPrinting`, `defaultFinish`).

**Transitional state - by design, call it out so it is not mistaken for a regression:** the 72 MB legacy
art in `public/cards/` is STILL bundled in the APK (build 152 is 94 MB). It is the offline safety net -
the candidate chain's `bundledLegacy` layer - so a first-launch-offline install still shows real art
before the CDN cache warms. **Phase 5** deletes it (the one irreversible step) once this build's CDN +
cache path is confirmed. No schema change: schema v11 (collector items) is already live; Part B is UI over
existing storage. `catalogVersion` bumped v5 -> v6 (catalog DATA version, not the user-data schema).

## Branch and range

**Branch:** `art-cdn-phase2` (off `main`, tip = `6402fdc`).

```
git fetch origin && git checkout art-cdn-phase2
git diff e73811f..HEAD          # everything since the 2a approval - THIS review
git diff main..HEAD             # the whole branch (2a re-included for context only)
```

Commits in range (oldest -> newest):
`c13fdfb` 2b-1/2 backup exclusion + boot wiring · `aac4f6f` 2b-3 seam flip + 19 sites + drop poster art ·
`94e6b31` 2b-4 catalog repoint + manifest + v6 · `44353d4` 2b polish (art shimmer) · `39e4548` poster
`x.arc()` fix + 3x · `72e4392` Ph6-1 selectors · `71645cd` Ph6-2 finish toggle · `000c95a` Ph6-3
two-column · `1027964` Ph6-4 ownership console · `6402fdc` Ph6-5 wishlist scoped open.

---

## Part A - art-CDN Phase 2b (activation)

**What changed and why:**

- **Seam flip (`aac4f6f`).** `cardImageUrl` is retired (no live callers). All 19 render sites - the
  resolver components (`CardArt`, `CollectionCardSheet` `SheetArt`/`SiteArt`, `CardArtViewer`) and the
  inline `${BASE}cards/` sites across `Home`, `Decks`, `DecksPager`, `DeckDashboard`, `AvatarPicker`,
  `Play`, `LifeCounter`, `CreateDeckWizard` - now go through `useArtSource(image_slug)`. This is
  all-or-nothing: a half-land regresses the un-migrated sites to broken URLs.
- **Poster avatar art DROPPED (`aac4f6f`, owner-scoped-out in the approved proposal).** `deckPoster.js`
  no longer loads/draws the hero image; `39e4548` additionally fixes a PRE-EXISTING corruption
  (`x.cx-decks(` parsed as `x.cx - decks(...)` -> the "decks not defined" throw) at four arc sites and
  raises `SCALE` 2 -> 3 for a crisper share image. The poster had never rendered before this fix.
- **Catalog repoint (`94e6b31`).** `public/cards.json` `image_slug` values become content-addressed keys
  (`<slug>.<sha256>.webp`); the full `art-manifest.json` ships (serves the app's key/legacyKey/bytes AND
  the pipeline's skip oracle); `catalogVersion.json` -> v6. `update-catalog.mjs` un-dormanted the promote
  (JSON-only; art lives on the CDN; `public/cards/` kept as legacy).
- **Boot + platform (`c13fdfb`).** `initArtCache()` is awaited (try/catch) in `App.jsx` after
  `seedCatalogIfNeeded`; Android `backup_rules` exclude `art/` + `art-tmp/` (cache, not user data).
- **Shimmer (`44353d4`).** `CardArt` fades in on load over a `cx-art-shimmer` placeholder.

**Invariants (constitution §3) touched and how they still hold:**

- **Graceful zero-image degradation.** The boundary prohibits BOTH render and I/O when
  `imagesDisabled`; every consumer falls to the deterministic `cardFallbackArt`. Candidate chain
  `local -> remote -> bundledLegacy -> fallback` means a manifest miss / offline / cache miss still paints.
- **Content-is-data.** Art is keyed on the content-addressed `image_slug`; a changed scan yields a new
  key and reseeds every cache layer. Catalog is data, versioned (v6), promoted atomically.
- **Cross-runtime integrity.** The adapter is native-only Capacitor (`Directory.Data`, sync
  `convertFileSrc` over a cached root); no new migration, no DDL, so the native/sql.js divergence class
  is not in play here.

**Where to attack (Part A):**

- Any of the 19 sites still constructing a raw `cards/` URL, or passing a raw slug where a content key is
  now expected (mismatch -> permanent fallback, silent).
- The catalog repoint atomicity: can a partially-promoted catalog (new cards.json, old/absent manifest)
  serve a key the manifest can't describe? (Should degrade to remote-then-fallback, never a bad `local`.)
- Poster: confirm the `x.arc()` fix is behaviourally identical to intent at all four sites and 3x doesn't
  blow the canvas budget on a low-RAM device.

---

## Part B - Phase 6 (Standard/Foil sheet + per-item wishlist)

**What changed and why:**

- **Pure selectors (`72e4392`, `printingRows.js` + tests).** `selectPrinting(card, set, foil) ->
  {slug, artist, product}` (all from one variant) and `defaultFinish({nonFoil,foil})`. DOM-free, unit-tested.
- **Finish toggle (`71645cd`).** One active finish at a time drives stepper + heart + art together. The
  heart/`addWant`/`clearWant` are keyed to the ACTIVE finish via `canonicalPrinting(set, foil)` - a foil
  want is a real, separate collector item (schema v11). Toggle shows only when a printing has both
  finishes; `finishes` is display-safe (malformed variant metadata degrades to standard-only, no crash).
- **Layout (`000c95a`, `1027964`).** Two columns (image left, identity right) + a full-width ownership
  console with a centered `[-] N [+]` (`CountRow`), killing the negative space under Site art. `CountCol`
  is SHARED with deckbuilder `CardSheet.jsx` and was NOT touched.
- **Wishlist scoped open (`6402fdc`).** The data layer (`wishlistCards`) and list were already per-item;
  the bug was the OPEN path - the row opened with `onPeek(card_id)` only, so the sheet fell into its
  `set == null` branch and showed the set picker. Fix: wishlist rows open with `onPeek(card_id, set,
  foil)`; a one-shot `pendingFoil` ref honors the wanted finish ONCE on mount, then every later set change
  falls back to `defaultFinish` (a foil stays an explicit choice, never a silent guess).

**Invariants touched and how they still hold:**

- **Profile isolation / catalog-profile boundary.** Wants are profile-scoped collector items; the sheet
  reads catalog (variants/art) and writes only profile want-rows through the existing per-item chain.
  No cross-profile read/write introduced.
- **Forward-only schema evolution.** NO schema change. This is UI over existing v11 collector items
  (card + set + finish; binary nonFoil/foil, Rainbow = a flavour of foil).
- **Transactional user-data operations.** `clearWant`/`addWant` keep the existing serialized-clear vs
  delta semantics; scoping the sheet does not change the write path, only which (set, finish) it targets.

**Where to attack (Part B):**

- The one-shot finish resolution: does `pendingFoil` ever leak into a later deliberate set switch? Does a
  scoped open to a finish the printing lacks resolve sanely (should fall to `defaultFinish`)?
- Heart correctness for an Alpha-wanted / Beta-selected card - the exact card-vs-item defect v11 exists to
  kill. Confirm the heart reflects and toggles the ACTIVE (set, finish) item, never the card total.
- Wishlist rows sharing a card_id: keyed by row identity, not card_id (two rows must not collapse or send
  both edits to one item).

## Gates (this branch, HEAD)

`test:codex` 10, `test:query` 691, `test:ui` 148, `test:app` 17, `check:types` 11, `check:cycles` 14,
`check:docs` 2 - all pass, 0 fail. `build` ✓. Not run: `check:smoke` (needs the pre-merge device pass).

## Device verification

Build 152 installed on the Pixel 9 Pro XL. Art serves from `cdn.sadkinglabs.com` + on-device cache
(proven end-to-end since build 146). The wishlist scoped-open and the ownership-console layout are on the
device for the owner's own pass. `check:smoke` is the remaining pre-merge device gate.

## Deferred (NOT in this diff)

- **Phase 5** - delete the bundled `public/cards/` (~72 MB APK reduction) once this build's CDN + cache
  path is confirmed. The one irreversible step; held deliberately.
- **Phase 3 (partial)** - cache management UI (clear / download-all). Backup exclusion already landed here.
- Optional: release date on the sheet (not in catalog data; owner to decide static table vs. skip).
