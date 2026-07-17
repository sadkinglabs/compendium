# Proposal: The catalog-update pipeline and per-printing card art

## Status and classification

Draft (revision 5)
Risk: **High**
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner

> **Scope amendment (2026-07-18, after Codex's adversarial review of the branch).**
> As shipped in **1.0.2, Collection ownership is per SET** (Alpha / Beta / Promotional),
> **not the exact-printing design the rest of this proposal describes.** The per-set
> implementation reuses the set-code `owned_cards.variant_slug` rows (`''` Unspecified,
> `'foil'` legacy foil, `'001'` a set, `'001:f'` a set's foil), the boot backfill, and a
> single-set reconciliation that is now transactional and covered by repository tests
> (fixed after review). **Known limitation:** 22 cards have multiple distinct printings
> *within one set* (e.g. Avatar of Fire has two Alpha printings; Sorcerer has three Promo
> printings) - the per-set picker cannot tell those apart and shows one representative art
> per set. Deck-building and play are unaffected (same card). The **exact-printing** design
> below (per-printing keys, `canonicalizeOwnedPrintings`, `ownedPrintingDeltaStatements`,
> conservation mutation tests) was consciously **deferred to a follow-up increment** so
> 1.0.2 could ship; it remains the plan. This note records the divergence honestly so the
> original approval is not read as covering the materially different per-set implementation.

High-risk under constitution §6 on five independent grounds: persisted-data change (the entire
catalog payload is rewritten and every installed device re-seeds), a **profile-owned data change**
(the Collection ownership write path now records the exact printing in `owned_cards.variant_slug`;
new in rev 2), a new repeatable pipeline pattern (a standing process, not a one-off script), an
asset/build change (~1,600 bundled images replacing 1,103 under a new nomenclature, plus a new
declared dependency), and user-data adjacency (profile-owned `owned_cards` / `deck_entries`
reference catalog identity; the design proves they survive untouched).

### Revision history

- **Rev 1.** Full pipeline + per-printing art, with Collection ownership keyed to **set-code
  buckets** and a deterministic representative art per set. Five open questions raised.
- **Rev 2.** The owner settled all five open questions. The material change: **promo granularity
  widens to the exact printing now** (rev-1 open question 2 / Option H). Ownership and Collection
  redesigned so a user owns and sees the *exact* printing. Rev 2 claimed existing `owned_cards`
  rows are never rewritten (pure read-resolution) and held the canonicalising backfill out of
  scope. Codex: **Changes required** - one Blocker, four Majors, one Minor.
- **Rev 3 (this document).** All six findings accepted and resolved.
  - **Blocker (double-count on edit).** Read-resolution is a safe *projection*, but the *write*
    path turned a resolved legacy row into a second durable exact row, so `ownedMap` summed both.
    Rev 3 makes the transition atomic: a forward-only, idempotent, transactional **boot backfill**
    canonicalises every unambiguous legacy set-code row to its exact printing (lossless - those
    sets have one printing), **plus** a **first-edit reconciliation** that, on any edit of a
    still-legacy bucket, folds the legacy quantity into the chosen exact key inside one `tx()`.
    Rev 2's "no row is ever rewritten" guarantee is withdrawn and replaced with a *conservation*
    guarantee (total owned quantity per card is invariant across the transition), proven by test.
    The backfill is now in shipping scope.
  - **Major (foil misread).** Foil-sensitive card-level reads matched the literal `'foil'`, so a
    new `…:f` printing-foil row read as regular. Every such aggregate now recognises `'foil'`
    **and** the `:f` suffix (this also fixes the pre-existing `'001:f'` quirk).
  - **Major (pipeline not atomic).** "Write at end" was replaced with an implementable
    stage/validate/journal-promote commit protocol that leaves either the whole old or the whole
    new generation, and *detects and explains* an interrupted promote.
  - **Major (link-graph soft escape).** The byte-reproduction check is now a **hard** Increment 1
    gate; a mismatch stops for a separately-reviewed curated-baseline design, never a report note.
  - **Major (set metadata).** Collection set labels and order are **derived from catalog set
    data**, not a hardcoded map; an unknown set code is a hard pipeline failure until then.
  - **Minor (discriminator).** The pipeline rejects any printing base that is empty, `'foil'`, or
    matches the reserved `/^\d{3}(:f)?$/`.
  - The four non-material rev-2 answers stand: APK ~82-85 MB, `CATALOG_DROP`, keep both Foot
    Soldier forms with overlap reported, reverse faces unbundled. The catalog pipeline +
    one-art-per-card catalog (Increments 1-2) remain ahead of the profile-owned ownership
    increment (now Increment 4), still shippable first.
- **Rev 4 (this document).** Codex re-review of rev 3: five findings resolved; **Changes required**
  on two (one still the ownership Blocker) plus a Minor doc-consistency fix. Tightened, not
  rebuilt - Codex's own framing ("the ownership increment should be eligible for approval rather
  than another architectural rewrite"):
  - **Blocker still open - the stepper's read-then-absolute write loses a concurrent increment.**
    Rev 3's reconciliation was transactional, but `useOwnedLedger` still computed an *absolute*
    target from a React read taken *outside* the tx ([OwnedControl.jsx:55-68](../../src/components/OwnedControl.jsx#L55)),
    so a scanner upsert committing between the read and the reconciling write is overwritten by
    the stale absolute. Rev 4 makes `+`/`-` **transactional delta** operations (fold legacy, read
    the exact row, apply the delta, commit - all in one `tx()`, no read outside it), aligned with
    the scanner's existing additive upsert; the typed absolute-set path reconciles in-tx too, with
    last-writer-wins on that printing's quantity stated explicitly. The conservation suite now
    forces **both barriered interleavings** and must fail against a naive rename *and* the
    read-then-absolute design.
  - **Major - the promote journal only gated `update:catalog`.** A normal `npm run build` could
    still package a mixed tree after an interrupted promote. Rev 4 makes "no incomplete catalog
    promotion" a **build-wide preflight**: `build`, `compile:codex`/`--check`, and `check:docs`
    all hard-fail while the journal exists, with the recovery instructions.
  - **Minor - Self-Critique link-graph inconsistency.** The Self-Critique still described a
    manual-review fallback for a byte-reproduction mismatch, contradicting the operative hard gate;
    rewritten to match (a mismatch stops implementation for a separately-reviewed curated-baseline
    revision).
  - Codex confirmed resolved and shipping (no action): the boot canonicalisation and
    ambiguous-rows-explicit model; foil classification with tests; the hard link-graph gate;
    derived set labels/order with a hard-fail on missing names; reserved-key rejection.
- **Rev 5 (this document, the last design round).** Codex re-review of rev 4: Changes required on
  two, **with the concrete fix supplied for each**; Codex confirms the ownership increment is
  approvable with the fixed-SQL approach, no `db.js` change, no further architecture revision.
  - **Blocker - "read the quantity inside the tx" is not implementable with our `tx()` contract.**
    `tx(statements)` ([db.js:47](../../src/store/db.js#L47)) takes only a pre-built statement list;
    there is no callback transaction that can query then build a later write while the tx stays
    open, so reading via `query()` before `tx()` silently recreates rev 3's stale-read race. Rev 5
    adopts Codex's fix: express the whole delta reconciliation as a **fixed parameterised
    five-statement set** through the existing `tx()` - no JS quantity read, no `db.js` change -
    behind a pure builder `ownedPrintingDeltaStatements(...)` tested by running the exact SQL against
    an in-memory sql.js DB, with two mutation checks that must fail.
  - **Major - `npm run android` bypasses the `prebuild` journal gate.** The documented APK workflow
    runs `vite build` directly, so npm's `prebuild` hook never fires. Rev 5 adopts Codex's fix: a
    reusable `catalog:assert-clean` script wired via `prebuild`/`preandroid`/`precompile:codex`/
    `precheck:docs`, with `update:catalog` calling the assertion internally (recovery must handle
    the journal, not be blocked by a generic pre-hook).
  - Codex confirmed resolved (no action): the barriered conservation contract; absolute-set
    last-writer-wins; the shared journal assertion across build/compile/check; the Self-Critique
    link-graph consistency.

**Owner decisions already locked** (recorded so they are never re-raised; design conforms to them):

1. **One card object per card NAME.** `card_id` stays `cardSlug(name)` - existing
   `deck_entries.card_id` and `owned_cards.card_id` keep resolving with no migration. The
   Scryfall model: store printings, present one card.
2. **Printings are enriched `variants`.** Each printing lives in the card's `variants` array and
   carries its own local art under the numeric `<setcode>-<slug>-…` nomenclature. Promos
   (set 999) are printings, not separate cards. Foils are dropped (refined below in Proposed
   design §1: *duplicate foil scans* are dropped; a foil scan that is a printing's **only** art
   is kept as that printing's art - the owner's own acceptance example requires this).
3. **The acceptance example (owner's words):** "If I add 3 copies of City of Glass and mark one
   as a promo, my Collection shows 2 copies with the set art and a third with the promo art."
   Collection renders owned copies per-printing; Codex shows one entry per name with a printing
   switcher in card detail; decks stay printing-agnostic and untouched.
4. **Sources:** rules from the codex CSV; FAQs from the FAQ CSV; card stats / rulesText / new
   cards from the Curiosa tRPC API; errata via rulesText beginning `UPDATED`.
5. **CATALOG_VERSION bumps 2 → 3** so installed apps re-seed. The seed clears and reloads
   catalog tables only; profile tables are untouched.
6. **Reusability is first-class.** One npm command, runnable by a non-engineer with no AI agent,
   reads the drop folder and does everything; idempotent; human-readable progress and errors.
7. **An obvious drop folder** replaces `catalog/input`, with an internal layout and a README in
   the folder. The way it is done for this drop is the way it is done forever.
8. **Ships in the parked 1.0.2-alpha release.** Build bump beyond the committed build 43 plus a
   celebratory What's New entry ("Catalog update 16/07/26").

## Problem and success criteria

**The catalog is stale and the update path does not exist.** The bundled catalog was last built
for CATALOG_VERSION 2 ([src/store/catalog.js:22](../../src/store/catalog.js#L22)); since then
Curiosa has added five cards, rewritten and expanded the Codex rules (210 → 212 articles, 69
subentry rows), grown the FAQ corpus (734 → 835 entries), and issued errata (28 cards' rulesText
now begins `UPDATED`, verified against the live API on 2026-07-16). The one existing refresh
script (`scripts/refresh-card-variants.mjs:72-76`, since removed in Increment 1)
only updates cards that already exist locally - it cannot add a card - and no script at all
exists for the rules CSV, the FAQ CSV, the image conversion, or the `link_graph.json`
regeneration (that file has no generator in the repository at all). Updating the catalog today
requires an engineer improvising, which is exactly how content updates rot.

**And the product model under it is one art per card.** `cards.image_slug` holds a single file
name ([src/store/schema.js:29](../../src/store/schema.js#L29)); every printing of a card renders
the same picture. The Collection is already printing-aware in its *quantities*
(`owned_cards.variant_slug` set buckets,
[src/store/ownedRepository.js:117-131](../../src/store/ownedRepository.js#L117)) but not in its
*art*: an owned promo renders the Alpha scan. The drop contains per-printing scans for
essentially every printing in the game; the model should catch up.

### Acceptance criteria

1. **One command.** `npm run update:catalog` reads the drop folder and produces the complete
   bundled catalog: `public/catalog/cards.json`, `articles_normalized.json`, `faqs.json`,
   `link_graph.json`, `codex_documents.json`, the converted art in `public/cards/`, and the
   catalog version token. No source-code edit is required to ship a routine content update. The
   command is idempotent: a second run with unchanged inputs produces byte-identical outputs and
   does not change the version token.
2. **Nothing lost, five gained.** All 1,104 existing local cards survive (including the nine
   token cards absent from the API); the five new API cards (Court of Equity, Foot Soldier,
   Mobbed Court, Mock Court, Overflowing Court - names verified live) are added; final count
   1,109. The pipeline fails loudly if any existing `card_id` would disappear.
3. **The City of Glass example works on a device.** Three owned copies, one recorded as the
   promo printing: My Collection shows two rows/tiles with Gothic art and one with the promo art
   (`999-city_of_glass-scg`, which exists only as a foil scan and is therefore kept).
4. **Exact printings, not set buckets (rev 2).** A user can record ownership against a specific
   printing, and Collection groups and renders owned copies by that printing. A multi-art promo
   (Druid: `999-druid-d` and `999-druid-op`; Sorcerer: three) shows the exact art owned, not a
   representative. `card_id` is unchanged, so decks, lists, and marginalia are unaffected.
5. **Owned quantity is conserved across the widening (rev 3).** A device that already recorded
   owned copies under the old set-code buckets (`'001'`, `'999'`, `'001:f'`, `'foil'`, `''`)
   upgrades with **every quantity conserved** per card and resolving to the correct printing:
   the boot backfill canonicalises unambiguous single-printing-set rows to their exact printing
   (lossless), the 24 ambiguous card/set pairs (quantified below) remain an explicit
   "unspecified promo" bucket until the user assigns one, and any edit of a still-legacy bucket
   folds its quantity into the chosen exact printing atomically - never a second durable row.
   The conservation invariant (total `qty_owned`/`qty_wanted` per card unchanged by any
   transition, across `+`, `-`, set-to-zero, and concurrent upserts) is the headline test, run
   from real legacy **and** pre-existing exact rows, and verified on hardware.
6. **Codex printing switcher.** Card detail shows one entry per name with a printing rail;
   selecting a printing swaps the hero art and its set/promo/artist label. Codex search and
   browse remain exactly one row per card name.
7. **Existing user data survives the reseed.** A device upgrading with existing decks,
   collections, notes, and matches boots CATALOG_VERSION 3, re-seeds, and every deck entry,
   owned row, and marginalia target still resolves. Verified on hardware, not inferred.
8. **Rules, FAQs, errata.** The 212 articles and their 69 subentries replace the current 210;
   the 835 FAQs replace the current 734 with stable deterministic ids; the errata filter
   (`rules_text LIKE 'UPDATED%'`,
   [src/store/codexRepository.js:47-49](../../src/store/codexRepository.js#L47)) lights up for
   the 28 errata'd cards.
9. **Zero-image mode** (`localStorage['cx-no-images']`) renders every new surface - the printing
   rail included - legibly from data alone, and a printing with no bundled art falls back to the
   deterministic gradient without layout shift.
10. **Gates.** `npm run test:codex`, `test:query`, `test:ui`, `build`, `check:docs` pass; the new
    pipeline stages carry their own `node --test` coverage.

### Non-goals

- **Finish-level art.** Standard vs foil of one printing share one bundled art file; foil stays
  expressible as a per-printing owned quantity (`<base>:f`), but the WebView renders no foil
  effect, so shipping a separate foil scan buys nothing (Options F). The ownership *key* widens to
  the exact printing (rev 2); the art *file* is per printing, not per finish.
- **A *lossy* rewrite of existing owned rows, or a schema migration.** The boot backfill rewrites
  unambiguous legacy rows to their exact printing, but only *losslessly* and *idempotently*
  (quantity conserved; ambiguous rows untouched); it is an app-level data canonicalisation in the
  existing `backfillSingleSetOwned` mould, **not** a schema migration - no DDL, no `SCHEMA_VERSION`
  bump (Data migration and compatibility).
- **Downloadable/CDN art, or bundling foil and reverse-face scans.** The cloudfront `src` URLs
  keep riding along in `variants` for a future migration; reverse faces (`…-s-r` / `…-f-r`, the
  avatar card backs) are not bundled.
- **Rules-diff/enrichment tooling** (the Stage 4 enrichment overlay of the rule-architecture
  plan) and any change to the Codex compiler's document model.
- **Automating the release itself.** The pipeline updates catalog data; the build bump,
  changelog entry, and APK build remain the documented manual release steps.

## Evidence and current architecture

All drop and API figures below were measured directly on 2026-07-16 in this repository; the API
figures via the same tRPC endpoint the existing script uses.

| Fact | Evidence | Confidence |
|---|---|---|
| Seed clears + reloads **catalog tables only**, one parameterized `tx()`; profile tables untouched | [src/store/catalog.js:74-96](../../src/store/catalog.js#L74) - `DELETE FROM cards/rules/faqs/link_graph` and nothing else | High |
| Seed keys on `catalog_meta['version'] === String(CATALOG_VERSION)` - equality, not ordering | [src/store/catalog.js:53-57](../../src/store/catalog.js#L53) | High |
| `card_id = cardSlug(name)`; the compiler mirrors it so doc ids equal DB ids | [src/store/catalog.js:26-32](../../src/store/catalog.js#L26), [scripts/codex/compile.mjs:17-19](../../scripts/codex/compile.mjs#L17) | High |
| Local catalog: 1,104 cards; API: 1,100; **5 on API not local** (Court of Equity, Foot Soldier, Mobbed Court, Mock Court, Overflowing Court); **9 local not on API** (Foot Soldier 1/2/3, Frogs ×3, Foot Soldiers, Foot Soldier English/Saracen - token entries) | Live API sweep, 11 pages, diffed against `public/catalog/cards.json` | High |
| The API's new `Foot Soldier` card **carries the numbered token printings** (`001/002/999-foot_soldier_1…` etc.) that local models as nine separate cards | Live API: `Foot Soldier` variants list | High |
| `refresh-card-variants.mjs` updates only existing cards; unmatched names are skipped with a log | `scripts/refresh-card-variants.mjs:72-76` (removed in Increment 1, superseded by `scripts/catalog/curiosa.mjs`) | High |
| Drop: 3,090 PNGs (3.2 GB, untracked); finishes: 1,542 `-s`, 1,524 `-f`, 21 `-rf` (rainbow), 3 reverse faces (`-s-r`/`-f-r`); sets 001/002/004/005/006/999 | Directory scan of `catalog/input/Card Images high res` | High |
| **1,599 distinct base arts** (slug minus finish token); **57 have no standard scan** - foil or rainbow only - including `999-city_of_glass-scg` (the owner's example), all four `001-avatar_of_*`, `001-winter_river-bt`, and the 21 `-op` rainbow avatars | Drop grouping analysis | High |
| Every Standard variant in the current catalog has a matching drop scan (0 missing); 26 drop scans match no current variant - all belong to the 5 new cards or new promo printings (e.g. `999-waypoint_portal-d-s`) | Drop ↔ `variants[].slug` diff | High |
| `Winter River` currently has **no image at all** and its only printing is a foil (`001-winter_river-bt-f`) | `cards.json`: `image: null` | High |
| Current bundled art: 1,103 WebP in `public/cards/`, 47 MB, **old abbreviation nomenclature** (`alp-` 410, `art-` 226, `bet-` 4, `dra-` 13, `got-` 438, `pro-` 12), 380×531 | Directory scan; `sharp` metadata | High |
| Drop scans are 380×531 except Gothic at 744×1039 - conversion is re-encode plus an occasional downscale | `sharp` metadata spot checks | Medium (spot-checked, not exhaustive) |
| `owned_cards.variant_slug` vocabulary is **set-code buckets**, not printing slugs: `''` unspecified, `'foil'` legacy foil, `'001'` per-set, `'001:f'` per-set foil | [src/store/ownedRepository.js:117-131](../../src/store/ownedRepository.js#L117) `parseVslug`/`vslug` | High |
| **Only 21 of 1,104 cards have a multi-printing set** (24 card/set pairs): 999 ×9, 001 ×8, 006 ×4, 002 ×2, 004 ×1. Only a legacy owned row on one of those exact pairs is ambiguous under the set-code key; every other set has one printing, so a set-code row resolves to an **exact** printing. The ambiguous target is tiny and mostly promos/avatars | Analysis over `cards.json` variants grouped by finish-stripped base per set | High |
| Ownership aggregates that matter for buildability sum `qty_owned` by `card_id` regardless of `variant_slug` (widening the key cannot affect them) | [ownedRepository.js:31-39](../../src/store/ownedRepository.js#L31) `ownedMap`; the `UNIQUE(profile_id,card_id,variant_slug)` index + `ON CONFLICT` upserts key on the same triple | High |
| The set-scoped write path already exists: the sheet/OwnedControl pass a `set` and steppers write `writeSetRow`/`qtyForInSet`; the scanner files a single-set card under its set via `addOwnedCopiesInSet` | [CollectionCardSheet.jsx:186-193](../../src/components/CollectionCardSheet.jsx#L186), [ownedRepository.js:157-206](../../src/store/ownedRepository.js#L157) | High |
| Precedent for an idempotent, non-destructive boot promotion of owned rows already ships (moves single-set `''` rows onto their set row) | [ownedRepository.js:212-231](../../src/store/ownedRepository.js#L212) `backfillSingleSetOwned` | High |
| Collection expands each card into one row per set and renders `<CardArt card={c}/>` - same art for every set row; the set list/labels are hardcoded | [src/pillars/Collection.jsx:465-525](../../src/pillars/Collection.jsx#L465), [SET_LABEL :312](../../src/pillars/Collection.jsx#L312) | High |
| The ownership sheet already scopes owned/foil steppers to one set bucket | [src/components/CollectionCardSheet.jsx:186-193](../../src/components/CollectionCardSheet.jsx#L186), [src/components/OwnedControl.jsx:19-29](../../src/components/OwnedControl.jsx#L19) | High |
| Card art resolves solely through `cards.image_slug` via `cardImageUrl(card)`; fallback is derived from elements + name, zero-image gate inside | [src/store/cardArt.js:29-53](../../src/store/cardArt.js#L29), [src/components/CardArt.jsx](../../src/components/CardArt.jsx) | High |
| Persisted profile data never stores image file names that are read back: deck art resolves `avatar_card_id → cards.image_slug` at read time; `decks.avatar_slug`/`cover_slug` exist in schema and transfer but have **no reader** | [src/store/deckRepository.js:57-84](../../src/store/deckRepository.js#L57); grep: `avatar_slug` appears only in [schema.js:73](../../src/store/schema.js#L73) and [profileTransfer.js:98-99](../../src/store/profileTransfer.js#L98) | High |
| Codex card detail: hero `CardArt`, meta row lists set names, one entry per card | [src/pillars/CodexDetail.jsx:300-344](../../src/pillars/CodexDetail.jsx#L300) | High |
| Codex CSV: `title,content,subcodexes`; 281 data rows = **212 titled articles + 69 continuation rows** (blank title, one `Label:  content` subcodex each); content carries `[[Card]]`/`((Rule))` links and ~100-col hard-wrap noise that `canonicalizeArticle` already reflows | CSV parse; [scripts/codex/canonicalize.mjs:53-64](../../scripts/codex/canonicalize.mjs#L53) | High |
| FAQ CSV: `card name,question,answer`; 835 data rows, **430 with a blank card name = continuation of the previous card**; every named card resolves against local + the five new cards (0 unresolved) | CSV parse + name resolution sweep | High |
| Current `faqs.json` ids are Curiosa UUIDs with `created_at` etc.; the seeder consumes only `{id,question,answer,cards,source}` | `public/catalog/faqs.json`; [src/store/catalog.js:87-88](../../src/store/catalog.js#L87) | High |
| `link_graph.json` (678 edges; target types card 605 / article 27 / subentry 34 / unresolved_article 12) **has no generator in the repository** | glob of `scripts/**`; edge shape from the file | High |
| Codex documents are compiled at build time by `compile-codex.mjs` (deterministic, committed, `--check` staleness gate) and loaded from the bundle, not the DB | [scripts/compile-codex.mjs](../../scripts/compile-codex.mjs), [src/store/codexDoc.js:1-18](../../src/store/codexDoc.js#L1) | High |
| Catalog rows are parsed once per session and frozen; re-seed invalidates the cache | [src/store/catalogCache.js:47-67](../../src/store/catalogCache.js#L47) | High |
| `sharp` resolves from `node_modules` but is **not declared** in `package.json` - a fresh `npm install` would not restore it | `require.resolve('sharp')` OK; [package.json](../../package.json) has no sharp entry | High |
| API card/variant shape: card `{slug,name,type,rarity,rulesText,cost,attack,defense,life,*Threshold,elements,variants,…}`; variant `{slug,finish,product,flavorText,artist,setCard,src,reverse,…}` | Live API probe | High |
| The drop folder is untracked (`?? catalog/input/`) and 3.2 GB - it must never be committed | `git status` | High |

### Discrepancies found during discovery (reported, per CLAUDE.md)

1. **"Foils are dropped" collides with the acceptance example.** 57 printings exist only as foil
   or rainbow scans - among them `999-city_of_glass-scg-f`, the exact promo the owner's example
   names, and `001-winter_river-bt-f`, the only printing of a card that today has no art at all.
   Dropping every `-f` file makes criterion 3 impossible and leaves ~57 printings artless.
   Resolution designed in (Proposed design §1): foil *duplicates* are dropped; a foil scan that
   is the only art for its printing is kept as that printing's art. This preserves the
   decision's intent (no duplicate foil scans, no finish-level art) and its own example.
2. **Flavour text is silently broken today.** Card detail reads flavour from
   `variants[].flavorText` ([CodexDetail.jsx:303](../../src/pillars/CodexDetail.jsx#L303)), but
   the catalog-v2 variant refresh replaced `variants` with entries that have no `flavorText` key,
   and the card-level `flavorText` field in `cards.json` is never seeded (no column,
   [catalog.js:76-85](../../src/store/catalog.js#L76)). No card has rendered flavour since v2
   shipped. The API provides per-variant `flavorText`; the enriched variant shape restores it as
   a side effect.
3. **The token overlap.** The API consolidated the Foot Soldier tokens into one `Foot Soldier`
   card whose variants are the numbered token printings; local retains nine separate token cards
   sharing those same physical printings. Adding the API card without touching the local ones
   (the only option compatible with locked decision 1) leaves the same printing reachable under
   two card entries. Flagged as open question 1.
4. **`avatar_slug` / `cover_slug` are dead columns** (schema + transfer only, no reader). Not
   touched by this change; noted so the reviewer does not assume they pin old file names.

## Assumptions and confidence

| # | Assumption | Confidence | Validation |
|---|---|---|---|
| 1 | The Curiosa tRPC endpoint keeps its current shape long enough to ship this update | **High** for this drop (probed live today); **Low** across future drops | The importer validates the response shape field-by-field and fails with a named, human-readable error ("Curiosa changed its API - a developer needs to update scripts/catalog/curiosa.mjs") rather than writing anything |
| 2 | A reseed at 1,109 cards + 835 FAQs + larger rules completes on device within the existing splash-progress flow, on both sql.js and the native plugin | Medium | Device test in Increment 2; the seed already runs as one parameterized `tx()` immune to the native splitter ([catalog.js:6-14](../../src/store/catalog.js#L6)) |
| 3 | The committed `link_graph.json` is derivable from `articles_normalized.json` by a deterministic extraction of `[[..]]`/`((..))` references | Medium | Increment 1 gate: the new generator must reproduce the committed file from the committed inputs before it is trusted with new input; if it cannot, the delta is inspected and the rule set corrected |
| 4 | Sharp's WebP encoding at ~380px/quality-tuned matches the current ~41 KB per-file weight | High | Measured during Increment 1 on a sample; the pipeline report prints the total payload size |
| 5 | Every current UI consumer of `variants` tolerates added keys (they read `slug`/`set`/`finish`/`artist` and now `flavorText`/`image`) | High | grep of `_variants`/`variants` consumers: deck Refine artist filter, CodexDetail flavour, Collection set expansion - all key-tolerant; `test:query` + `test:ui` regression |
| 6 | A legacy set-code owned row can be distinguished from a new exact-printing row by shape (a set code matches `/^\d{3}(:f)?$/`; a printing base always contains hyphens), so both vocabularies coexist in one column with no collision | High | Every current `variant_slug` value is `''`, `'foil'`, a 3-digit code, or `code:f`; a printing base is `set-slug-qualifier`. `test:query` covers the discriminator |
| 7 | The boot backfill can canonicalise an unambiguous legacy set-code row to its exact printing losslessly (single-printing sets are exact by definition), and the first-edit reconciliation folds an ambiguous legacy row into a chosen printing conserving quantity | High (single-printing exactness proven by the count of 24 ambiguous pairs across 21 cards; conservation is a testable invariant) | The conservation test suite (below) run from real legacy + exact rows; the device upgrade test |
| 8 | The CSV files are UTF-8, RFC-4180 quoted, CRLF-tolerant, with the continuation-row conventions measured above | High for this drop (parsed successfully today); Medium for future drops | Parser rejects unknown headers and reports the exact row/column of any malformed record |
| 9 | No profile-owned row stores an art file name that must survive the nomenclature change | High | Grep evidence in the table above; deck/match/profile art all resolves through catalog rows at read time |

## Affected systems and invariants

| Surface | Change |
|---|---|
| `CATALOG_DROP/` (new, renames `catalog/input`) | The standing drop location: `README.md` (committed) + gitignored payload |
| `.gitignore` | Ignore `CATALOG_DROP/*` except the README (3.2 GB must never land in history) |
| `scripts/update-catalog.mjs` (new) | The one-command orchestrator |
| `scripts/catalog/*.mjs` (new) | Importable stage engines + co-located tests: drop discovery, Curiosa fetch/merge, rules CSV, FAQ CSV, image conversion, link-graph generation, report |
| `scripts/refresh-card-variants.mjs` | **Deleted** - superseded by the merge stage (§4.2: remove superseded code) |
| `package.json` | `update:catalog` + `test:catalog` scripts; `sharp` declared as a devDependency (it is already in `node_modules`, undeclared - a latent break) |
| `public/catalog/*.json` | Regenerated by the pipeline (cards/articles/faqs/link_graph/codex_documents) |
| `public/cards/` | 1,103 old-nomenclature WebPs replaced by ~1,599 per-printing WebPs |
| `src/store/catalogVersion.json` (new, generated) | `{ version, hash, updated }` - the seed token, written by the pipeline so a routine update edits no code |
| `src/store/catalog.js` | Reads `CATALOG_VERSION` from the generated file; seed logic otherwise unchanged |
| `src/store/cardArt.js` | New pure helpers: `cardPrintings(card)` (distinct printings with art + label) and `printingImage(card, printing)` (a printing base's art, or default); `cardImageUrl` gains an optional slug override |
| `src/components/CardArt.jsx` | Optional `imageSlug` prop (default = current behavior) |
| `src/pillars/CodexDetail.jsx` | Printing rail + hero swap in `CardBody`; flavour text resumes rendering |
| **`src/store/ownedRepository.js` (rev 5)** | `variant_slug` widens to the exact printing base. `parseVslug`/`vslug` gain the printing form and a legacy set-code discriminator + resolver; `ownedBySet` → `ownedByPrinting`; a new **pure statement builder** `ownedPrintingDeltaStatements(...)` returning the fixed five-statement set run through the existing `tx()` (no `query()` before `tx()`, no `db.js` change) that `+`/`-` route through, and the typed absolute-set path (statements 1-3 then an absolute `UPDATE`, last-writer-wins); a new `canonicalizeOwnedPrintings()` boot backfill; **every foil-sensitive card-level read** (`ownWantMap` :43, `qtyFor` :56, `recentlyAdded` :490) recognises `'foil'` **and** the `:f` suffix. Card-level owned *totals* and `ownedMap` unchanged |
| **`src/components/OwnedControl.jsx` (rev 5)** | `useOwnedLedger.step` runs the builder's statement set via `tx()` for the durable write (no quantity read into JS, no absolute from the React mirror); the optimistic mirror stays visual-only |
| **`scripts/assert-no-pending-catalog-promote.mjs` (new, rev 5)** | The shared journal assertion behind the `catalog:assert-clean` script |
| **`package.json` (rev 5)** | New scripts `catalog:assert-clean` and `update:catalog`; **lifecycle hooks** `prebuild`/`preandroid`/`precompile:codex`/`precheck:docs` each run `catalog:assert-clean`; `android` unchanged in shape but now gated by `preandroid` (the APK workflow no longer bypasses the journal). `sharp` declared as a devDependency |
| **`src/store/catalogCache.js` + a new `catalogSets()` (rev 3)** | Derive the distinct set `{code, name}` list from the catalog (sorted by numeric code) so Collection's labels/order are data, not a hardcoded map |
| **`src/App.jsx` (rev 3)** | Call `canonicalizeOwnedPrintings()` in the boot backfill sequence beside `backfillSingleSetOwned`/`migrateAnnotationsIfNeeded` |
| **`src/components/CollectionCardSheet.jsx` + `src/components/OwnedControl.jsx` (rev 2)** | The `set` prop/param becomes a printing base; steppers write the exact printing (through the reconciling writers). `SheetArt` uses the printing's own art |
| **`src/pillars/Collection.jsx` (rev 3)** | `groups` expands each card into one row per **printing** (grouped under its set header), not one row per set; `SET_LABEL`/`SET_RANK` replaced by the derived `catalogSets()`; `LedgerRow`/`BinderTile` render `printingImage(card, printing)`; recently-added rows likewise |
| **`scripts/catalog/*` + `scripts/update-catalog.mjs` (rev 3)** | The stage/validate/journal-promote commit protocol; the hard link-graph reproduction gate; discriminator rejection of malformed printing bases; hard failure on an unknown set code |
| `src/content/changelog.js` | Build-44 entry celebrating the update |
| Docs | See Documentation impact |

### Invariants (constitution §3), each named with how it holds

**1 - Catalog/profile boundary.** Touched and preserved. The reseed's write set is exactly
`cards`, `rules`, `faqs`, `link_graph`, `catalog_meta`
([catalog.js:74-96](../../src/store/catalog.js#L74)); no statement in the pipeline or the seed
touches a profile-owned table, and the pipeline itself runs at build time on a development
machine, never on device. Verified by the on-device upgrade test (decks/collections intact after
reseed) and by review of the seed statement list.

**2 - Profile isolation.** Not materially affected: every widened read and write in
`ownedRepository` keeps its `activeProfileId()` scope
([ownedRepository.js:31,68,157](../../src/store/ownedRepository.js#L31)); the widening changes the
`variant_slug` *value*, never the profile predicate. The new art helpers are pure functions over
catalog rows.

**3 - Durable, offline-first writes (rev 3, load-bearing for `owned_cards`).** The widened write
path and the boot backfill commit through the same `owned_cards` upsert/`tx()` machinery that
already backs owned quantities ([ownedRepository.js:157-206](../../src/store/ownedRepository.js#L157)) -
same durability, same `bump()` freshness bus, no new store. The reseed's catalog `tx()` is
unchanged. Authoritative ownership stays in SQLite, never in React state.

**4 - Forward-only schema evolution (rev 3 statement).** **`SCHEMA_VERSION` stays 10, no
`MIGRATIONS` entry, and the `owned_cards` table shape is unchanged** - `variant_slug` is already a
free-text column with `UNIQUE(profile_id,card_id,variant_slug)`, and the widening writes longer,
more specific strings into it. The canonicalising backfill is an **app-level, boot-time data
canonicalisation**, not a schema migration: it runs every boot (cheap after the first pass, like
the existing [`backfillSingleSetOwned`](../../src/store/ownedRepository.js#L212) and
`migrateAnnotationsIfNeeded`), is idempotent, and needs no version gate. It is forward-only: it
only ever moves a quantity from a less-specific key to its unique more-specific key, never the
reverse, and never touches an ambiguous row. The catalog version token changes form (integer →
generated `{version, hash}`) but the seed's comparison was always string equality, so any change
re-seeds and an unchanged token does not (a failed seed leaves the old token; the next boot
retries the whole `tx()`).

**5 - Transactional user-data operations (rev 3, the blocker's fix).** The reseed is one atomic
`tx()` and stays so. For `owned_cards` the correctness rule is **quantity conservation under one
transaction**:
- The **boot backfill** canonicalises each unambiguous legacy row (`'001'` → the single
  `001-<slug>-b` printing) as a single `UPDATE` (rename) when the exact key is free, or, when a
  pre-existing exact row already holds that key, an add-then-delete inside **one `tx()`** that
  sums `qty_owned`, preserves `qty_wanted`, `notes`, and the earlier `created_at`, and removes the
  legacy row. Idempotent (a canonicalised row is no longer legacy-shaped) and interruption-safe
  (each card's transition is one `tx()`; a crash between cards leaves some canonical, some legacy,
  both of which read and re-run correctly).
- The **fixed-SQL delta write** (rev 5, the blocker's direct fix): `+`/`-` run the five-statement
  set (Proposed design §3) in one `tx()` - ensure-exact, fold-legacy, delete-legacy, apply-delta
  (`MAX(0,…)`), delete-at-zero - with **no quantity read into JS**, so there is no read outside the
  transaction to go stale against a concurrent scanner upsert. The typed absolute-set path folds
  in-tx too and overwrites that printing's quantity (last-writer-wins, stated). This closes the
  window the backfill cannot (the ambiguous 24, and any edit racing the first boot) and the
  concurrency window rev 3 left open, within the existing `tx()` contract (no `db.js` change).
  Covered by the statement-level conservation suite (Verification).

**6 - Graceful zero-image degradation.** Actively exercised: printings whose scan is absent
(possible in future drops; today only if a drop omits an image) render the deterministic
element/name gradient with no layout shift ([cardArt.js:43-53](../../src/store/cardArt.js#L43)).
The fallback is keyed to card identity, deliberately **not** to printing, so it stays stable per
§5's "same card → same fallback". The printing rail remains rendered and labelled (set names are
data) under `cx-no-images`. Winter River - artless today - *gains* art from its foil-only scan.

**7 - Content is data (rev 3, strengthened per Codex Major).** New cards, printings, rules, and
FAQs arrive as data with zero component edits. Rev 3 removes the last hardcoded conditional: the
`SET_LABEL`/`SET_RANK` maps ([Collection.jsx:312-314](../../src/pillars/Collection.jsx#L312)) are
replaced by `catalogSets()`, which derives the set `{code, name}` list from the catalog and orders
by numeric code (which already yields Alpha, Beta, Arthurian Legends, Dragonlord, Gothic,
Promotional - 999 sorts last naturally). A **new set therefore needs no source edit**. As a
backstop against a genuinely unknown code slipping through, the pipeline hard-fails on a set code
it cannot name (Proposed design §4), so an unlabelled set can never ship.

**8 - Cross-runtime integrity.** The reseed, the widened `owned_cards` writes/reads, and every
new render path run on both sql.js and native SQLite. The seed already uses positional-parameter
statements precisely because the native plugin's statement splitter mangles inline literals
([catalog.js:6-14](../../src/store/catalog.js#L6)); the new content (CSV prose full of
apostrophes and semicolons) flows through the same parameterized path, and the widened ownership
writes reuse the existing parameterized upserts. Browser evidence is not accepted for the reseed,
the switcher, Collection art, or the owned-row upgrade - all get installed-app verification.

## Options considered

**A. Status quo / manual update by an engineer with ad-hoc scripts.** Rejected: it is the
problem. The last update left an undeclared dependency, a dead flavour-text path, and no
generator for one of the five catalog files.

**B. Per-printing cards (one card row per printing).** The Gatherer model. Rejected by owner
decision 1 (recorded; not re-argued): it would change every `card_id`, forcing a migration
across `deck_entries`, `owned_cards`, `card_list_entries`, `saved`, `notes`, `links`, and the
compiled document ids, to solve a presentation problem.

**C. A new `printings` DB table (normalized child of `cards`).** Cleaner queries than JSON, but
it adds a schema migration (v11), a second seeding path, and repository churn, for data the app
only ever reads whole-card (the catalog cache parses `variants` once per session,
[catalogCache.js:59](../../src/store/catalogCache.js#L59)). The JSON column already exists and
suffices; owner decision "prefer no schema change" concurs. Rejected.

**D. Keep the old `alp-` art files alongside the new nomenclature.** Avoids any transition risk
but permanently doubles ~44 MB of APK payload for zero benefit once `image_slug` values are
rewritten in the same reseed. Rejected; the transition is a single atomic pair (files + catalog
rows ship together in one APK).

**E. Manual CATALOG_VERSION integer in source (status quo mechanism).** Simple, but it means a
routine content update requires a code edit - which breaks the non-engineer requirement
(decision 6) and is exactly the step that gets forgotten (the app would silently keep serving
the old catalog from an unchanged version token). Rejected in favour of a generated
`{version, hash}` token: content changes re-seed automatically, unchanged content never churns,
and the human-readable integer still bumps (2 → 3 here, honouring decision 5) for display and
support conversations.

**F. Foils as separately-bundled art (`-s` and `-f` files both shipped).** Doubles the art
payload (~128 MB of images) to show a shinier scan the WebView cannot actually render as foil.
Rejected by owner decision 2; the refinement (keep a foil scan only where it is the *only* art)
is the minimum that keeps 57 printings - including the owner's own example - from going artless.

**G. Drop-folder naming.** `DROPNEWFILESHERE/` (owner's sketch) vs `CATALOG_DROP/`. Chosen:
**`CATALOG_DROP/`** - it sorts to the top of the repo listing, states *what* is dropped (there
are other conceivable drops: fonts, icons), and reads acceptably in scripts and docs. The README
inside it is the real discoverability mechanism. If the owner prefers the louder name, it is a
one-line constant plus a rename; recorded as a style choice, not a design fork.

**H. Ownership keyed to the exact printing now - CHOSEN (rev 2, owner decision).** Makes "which
exact promo do I own" representable so multi-art promos render the one owned. Rev 1 deferred this
over a feared migration of existing `'999'` rows; the deferral was wrong on the facts. The
widening needs **no migration and no schema bump**: the `variant_slug` column already holds
arbitrary text, legacy set-code rows are shape-distinguishable from exact-printing rows
(assumption 6) and read-resolve to a printing without being rewritten (assumption 7), and only 24
card/set pairs are even ambiguous (Evidence). The set-bucket compromise (rev 1's Proposed design)
is retained only as the read-resolution *fallback* for a pre-existing ambiguous row, not as the
model. This is the safest form of Option H: it changes what new writes record, never what
existing rows say.

## Proposed design

### 1. The printing model (data)

**A printing is a distinct physical art**: a card variant slug minus its finish token. The two
finishes of one printing (`006-city_of_glass-b-s` / `006-city_of_glass-b-f`) are one printing
with one bundled art file. The enriched `variants[]` entry - in `cards.json` and seeded verbatim
into the `cards.variants` JSON column (no schema change;
[schema.js:28](../../src/store/schema.js#L28) already declares the column) - is:

```json
{
  "slug": "006-city_of_glass-b-s",
  "set": "006",
  "setName": "Gothic",
  "finish": "Standard",
  "product": "Booster",
  "artist": "Elwira Pawlikowska",
  "flavorText": "",
  "src": "https://d27a44hjr9gen3.cloudfront.net/cards/006-city_of_glass-b-s.png",
  "image": "006-city_of_glass-b.webp"
}
```

- `slug` is the durable printing identity (Curiosa's own, already the drop's file-name scheme).
- `finish` is `Standard | Foil | Rainbow` (all three observed in the live data).
- `product` is the API's human product name (`Booster`, `Box Topper`, `Preconstructed Deck`,
  promo products) - opaque display text, never parsed.
- `image` is the bundled per-printing art: the **finish-stripped base name** + `.webp`, shared
  by every finish of the printing, or `null` when no scan is bundled (zero-image fallback).
  There is deliberately no `promo` boolean: `set === '999'` *is* the promo flag (content is
  data; the UI derives the tag).
- `flavorText` restores the flavour pipeline broken since catalog v2 (discrepancy 2).
- `sets` (the card-level distinct-set array) keeps its current `[{name, code}]` shape.

**Card identity and default art.** `card_id` remains `cardSlug(name)`, untouched. The card-level
`image` (→ `cards.image_slug` column) becomes the **default printing's** art: lowest set rank,
preferring a standard-sourced scan, tie-broken by slug sort - deterministic, and for every
existing card this lands on the same artwork the old `alp-…` file showed (the lowest-set
standard printing), so nothing visibly changes for single-art consumers (deck heroes, list
thumbnails, search rows, mention rails).

**Art selection per printing.** From the drop, for each printing base: use `<base>-s.png`; else
`<base>-f.png`; else `<base>-rf.png`; else no art. Reverse-face scans (`-s-r`, `-f-r`: avatar
card backs, matching the API's per-variant `reverse` field) are never bundled. This is the
"foils dropped" refinement: 1,542 standards win their printing; 57 foil/rainbow-only printings
keep their only art; 1,467 duplicate foil scans and 3 reverse faces are dropped. ~1,599 bundled
files.

**The printing base is the ownership key (rev 2).** `printingImage(card, printing)` returns that
printing base's own `image`. The Collection now records and groups by the printing base directly
(§3 and Data migration), so the art shown is the art owned - exactly, including for the 24
multi-printing pairs. A legacy set-code bucket resolves to its set's printing (single-printing
sets: exact; the 24 ambiguous pairs: the deterministic standard-first representative) until the
user re-specifies. The `''` (unspecified) and `'foil'` legacy buckets resolve to the card's
default art. The Codex rail always shows every printing regardless.

### 2. The Codex printing switcher (UI)

In `CardBody` ([CodexDetail.jsx:300-344](../../src/pillars/CodexDetail.jsx#L300)), directly
under the hero and above the meta row:

- **When the card has ≥ 2 printings:** a horizontal rail of printing thumbnails (5:7 `CardArt`
  tiles at ~56 px wide inside ≥ 48 dp touch targets, the existing mention-rail pattern
  [CodexDetail.jsx:174-181](../../src/pillars/CodexDetail.jsx#L174)), ordered by set rank then
  slug. The selected printing drives: the hero art (`CardArt imageSlug`), and a caption line
  under the rail - `setName · product · artist`, with the gold `PROMO` treatment when
  `set === '999'` (rendered from data, no per-set conditionals). Selection is transient view
  state (not persisted - it is a reading aid, not user data), defaulting to the card's default
  printing so the entry opens exactly as today.
- **When the card has 1 printing:** no rail; the screen is unchanged.
- **Zero-image mode:** thumbnails render their deterministic fallback (identical per card, per
  §5's stability rule) and the caption still names the set - the rail remains informative with
  no photography; layout is reserved by aspect-ratio boxes, so no shift either way.
- **Search and browse are untouched**: `getCodexEntries` / `getCodexCards` / `searchCodex`
  ([codexRepository.js:56-236](../../src/store/codexRepository.js#L56)) continue returning one
  row per card with the default `image_slug`.

The printing list itself (`cardPrintings(card)`: group `_variants` by finish-stripped base,
pick each group's art and label) is a pure function in `cardArt.js` with `node --test` coverage
under `test:query` - the component consumes, never computes.

### 3. Exact-printing ownership + Collection art (rev 2)

**The ledger key widens from set code to printing base.** The vocabulary reconciles cleanly with
the current one because the two forms are shape-distinguishable:

| `variant_slug` | Meaning | Vintage |
|---|---|---|
| `''` | unspecified owned; wishlist lives here | legacy, kept |
| `'foil'` | unspecified foil | legacy, kept |
| `'001'`, `'999'` (`/^\d{3}$/`) | a **set** bucket | legacy, **read-resolved**, never written anew |
| `'001:f'`, `'999:f'` | a set bucket, foil | legacy, read-resolved |
| `'999-druid-op'` (contains hyphens) | an **exact printing** | new (rev 2) |
| `'999-druid-op:f'` | an exact printing, foil | new (rev 2) |

`parseVslug` gains one branch: after stripping an optional trailing `:f`, a value matching
`/^\d{3}$/` is a legacy set-code row (resolve to a printing via the catalog); anything else is a
printing base already. `vslug(printing, foil)` builds `printing` or `printing:f`. The
`UNIQUE(profile_id, card_id, variant_slug)` index and every `ON CONFLICT(...variant_slug)` upsert
are unchanged - the key is the same triple, only more specific.

**Boot backfill: canonicalise the unambiguous rows (rev 3, in shipping scope).**
`canonicalizeOwnedPrintings()` runs in `App.jsx`'s boot backfill sequence, alongside the existing
`backfillSingleSetOwned`/`migrateAnnotationsIfNeeded` ([App.jsx](../../src/App.jsx) boot path).
For every owned row keyed `/^\d{3}(:f)?$/` whose set has exactly one printing base in the catalog
(every set/card pair but the 24 ambiguous ones), it moves the quantity onto the exact key:
a single `UPDATE` when the exact key is free, or an add-then-delete inside one `tx()` when a
pre-existing exact row already holds it (summing `qty_owned`, keeping `qty_wanted`, `notes`, and
the earlier `created_at`). Idempotent and per-card transactional (§3.5). After it runs, the only
legacy set-code rows left are the ambiguous 24 - deliberately, as an "unspecified promo" bucket
the user assigns explicitly.

**Writes are a fixed parameterised SQL statement set through `tx()` (rev 5, the blocker's fix).**
Rev 3 computed an absolute from a read outside the tx (a lost-update race); rev 4 said "read the
quantity inside the tx", but that is **not implementable with our `tx()` contract** -
`tx(statements)` ([db.js:47](../../src/store/db.js#L47)) takes only a pre-built statement list, and
there is no callback transaction that can query then build a later write while the tx stays open.
Reading via `query()` before `tx()` silently restores the rev-3 race. Rev 5 adopts Codex's fix:
the delta edit is expressed entirely as **fixed SQL that never reads a quantity into JS** - the
folds and the delta happen in the statements themselves. No `db.js` change.

`legacySlug` and `exactSlug` (the finish-carrying keys, `printing` or `printing:f`) are computed
**before** building the tx (from the catalog resolution, not from any quantity query). A pure
builder `ownedPrintingDeltaStatements({ profileId, cardId, legacySlug, exactSlug, delta, now, ids })`
returns these five statements, run in one `tx()`:

```sql
-- 1. Ensure the exact-printing row exists at zero (no-op if it already does).
INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
VALUES(?,?,?,?,0,0,'',?,?)
ON CONFLICT(profile_id,card_id,variant_slug) DO NOTHING;

-- 2. Fold the legacy bucket into the exact printing (SELECT is empty when no legacy row exists,
--    so this inserts nothing then). Quantities ADD; notes keep the exact row's note and take the
--    legacy note only when the exact note is empty.
INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
SELECT ?, profile_id, card_id, ? /*exactSlug*/, qty_owned, qty_wanted, notes, created_at, ?
FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=? /*legacySlug*/
ON CONFLICT(profile_id,card_id,variant_slug) DO UPDATE SET
  qty_owned  = owned_cards.qty_owned  + excluded.qty_owned,
  qty_wanted = owned_cards.qty_wanted + excluded.qty_wanted,
  notes      = CASE WHEN COALESCE(owned_cards.notes,'')='' THEN COALESCE(excluded.notes,'') ELSE owned_cards.notes END,
  created_at = MIN(owned_cards.created_at, excluded.created_at),
  updated_at = excluded.updated_at;

-- 3. Delete the folded legacy source row.
DELETE FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=? /*legacySlug*/;

-- 4. Apply the user's delta to the exact key (clamped at zero).
UPDATE owned_cards SET qty_owned=MAX(0,qty_owned+?), updated_at=? WHERE profile_id=? AND card_id=? AND variant_slug=? /*exactSlug*/;

-- 5. Delete-at-zero.
DELETE FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=? /*exactSlug*/ AND qty_owned=0 AND qty_wanted=0;
```

- **`+`/`-`** route through this builder (`delta = +1`/`-1`). `useOwnedLedger`
  ([OwnedControl.jsx:55-68](../../src/components/OwnedControl.jsx#L55)) calls it for the durable
  write; the optimistic mirror stays purely visual and reconciles from the DB on drain, exactly as
  today. Because no quantity is ever read into JS, there is no stale value to lose.
- **The absolute-set path (typing a quantity)** uses statements 1-3, then
  `UPDATE owned_cards SET qty_owned=MAX(0,?), updated_at=? WHERE (exact key)` and the delete-at-zero
  (statement 5) - a deliberate overwrite with **last-writer-wins on that printing's quantity, stated
  as the semantics, not an accident**. It still folds the legacy row first, so no phantom second row
  survives.
- **The foil path** passes `set:f`/`printing:f` as `legacySlug`/`exactSlug` and the same five
  statements run against the foil rows; `qty_wanted` is folded too (harmless on set rows, which
  carry none, and correct on the `''`/`'foil'` legacy rows should a fold ever touch them).
- **The scanner add path** stays an additive in-tx upsert
  ([ownedRepository.js:194-206](../../src/store/ownedRepository.js#L194)) targeting the exact key
  (unambiguous set) or the legacy bucket (ambiguous set). SQLite serialises it against the step
  `tx()`, so both interleavings conserve: **scanner-first**, the fold (statement 2) sees the
  increment and carries it into the exact key; **stepper-first**, the step tx completes and the
  scanner later adds the next copy onto whichever key survived. Neither can lose or double a copy -
  the `UNIQUE` index cannot catch a cross-key double-count, but the additive SQL and the
  fold-before-delta ordering make it structurally impossible.

`ownedMap` therefore never sees both a `999` and a `999-druid-d` row for the same copies. The
barriered conservation suite runs the **exact statements** above against an in-memory sql.js DB and
must fail against a naive rename **and** against rev 3's read-before-tx absolute write
(Verification).

**Foil-sensitive card-level reads recognise `:f` (rev 3, Codex Major).** `ownWantMap`
([:43](../../src/store/ownedRepository.js#L43)), `qtyFor` ([:56](../../src/store/ownedRepository.js#L56)),
and the Overview `recentlyAdded` query ([~:490](../../src/store/ownedRepository.js#L487)) split
foil by the literal `variant_slug='foil'`, so a new `999-druid-op:f` row would read as *regular*
and the card-level surfaces would disagree with My Collection about the same durable row. Every
such condition changes to treat a row as foil when `variant_slug='foil' OR variant_slug LIKE '%:f'`.
This also fixes the pre-existing bug where a `'001:f'` per-set foil row was miscounted as regular
at card level. `ownedMap`/buildability keep summing every row regardless of finish, so totals are
unaffected.

**Reads and rendering group by printing.** `ownedBySet` becomes `ownedByPrinting`: it resolves
each owned row's `variant_slug` to a printing base (exact rows pass through; a residual ambiguous
legacy row resolves to its deterministic representative) and keys the map `card_id|printingBase`.
In `Collection.jsx`, the `groups` memo expands each card into one row per **printing it was printed
in** (from `_variants`, grouped by finish-stripped base) placed under its set header, instead of
one row per set ([Collection.jsx:465-525](../../src/pillars/Collection.jsx#L465)); the set headers
and their order come from the derived `catalogSets()` (Codex Major, §3.7), not a hardcoded map.
`LedgerRow` / `BinderTile` render `imageSlug={printingImage(card, printing)}`. For the ~98% of
cards with one printing per set, the screen looks exactly as today; the 21 multi-printing cards
now show a row per promo, each with its own art. The Overview "recently added" rows resolve the
owned printing from `owned_slug` (already carried,
[Collection.jsx:257-264](../../src/pillars/Collection.jsx#L257)) through the same helper.
`SheetArt` uses the printing's art.

This delivers the acceptance example and more: the copy recorded on `999-city_of_glass-scg`
renders the promo art; three Druid copies split across `999-druid-d` and `999-druid-op` render
their two distinct arts. `card_id` never changes, so `ownedMap`/buildability, decks, lists, and
marginalia are untouched (Data migration proves it).

### 4. The pipeline

**The drop folder.** `catalog/input/` is renamed **`CATALOG_DROP/`** (repo root). Committed
content: only `CATALOG_DROP/README.md`. `.gitignore` gains `CATALOG_DROP/*` +
`!CATALOG_DROP/README.md` - today's 3.2 GB drop is already untracked only by luck. The README
(a deliverable of this proposal) states, in non-engineer language: what goes where, the one
command to run, what "done" looks like, and the three most likely errors with their fixes.
Prescribed layout:

```text
CATALOG_DROP/
├─ README.md              committed - how to run an update
├─ images/                the card scans (PNG, named <set>-<slug>-<qualifier>-<finish>.png)
├─ rules.csv              the codex export   (header: title,content,subcodexes)
├─ faq.csv                the FAQ export     (header: card name,question,answer)
└─ changelog-url.txt      optional - the human-readable errata page, reference only
```

Discovery is forgiving by design: the pipeline scans the folder **recursively**, classifies any
`.csv` by its header row (so `codex-16 Jul 2026.csv` and `faq-…Z.csv` work as dropped, no
renaming) and treats every `.png` found anywhere beneath the folder as a scan (so today's
`Card Images high res/` subfolder works as-is). Ambiguity - two CSVs with the same header,
an unclassifiable CSV - is a named failure, not a guess.

**The command.** `npm run update:catalog` → `scripts/update-catalog.mjs`, stages below. Progress
is narrated per stage; failures state what happened, which input caused it, and what a
non-engineer should do ("the rules file is missing its title column - re-export the codex CSV").
Every stage builds into a **staging tree outside shipped paths** (`.catalog-build/staging/`,
gitignored); nothing under `public/` or `src/` is touched until the whole tree validates and the
commit protocol below runs. A failure *before* promote leaves the repository exactly as it was; a
failure *during* promote is detected and explained (never silently "unchanged"), per the protocol.

1. **Discover** the drop: locate and classify inputs; print what was found and what is absent
   (a rules-only drop is legal - absent inputs mean "keep the current data for that stage").
2. **Fetch** the full card list from the Curiosa tRPC API
   (the `refresh-card-variants.mjs:22-43` pagination, now in `scripts/catalog/curiosa.mjs`,
   hardened: response shape validated, page cap, retry-once). Offline or shape-changed → named
   failure, nothing written.
3. **Merge cards.** For every API card: update stats/rulesText/thresholds/elements/sets and
   replace `variants` with the enriched shape (§1); **add** cards whose `cardSlug(name)` is
   absent locally; preserve local-only cards untouched and list them by name in the report
   (today: the nine Foot Soldier tokens - kept alongside the API's unified `Foot Soldier`, with
   the overlapping printings named every run, per the owner decision). Hard gates: no existing
   `card_id` may disappear; no duplicate `card_id`; the API total must be within a sane band of
   the local total (a 10-card API response fails rather than gutting the catalog); **every
   printing base is well-formed** - the run fails if any base is empty, equals `'foil'`, or
   matches the reserved legacy form `/^\d{3}(:f)?$/` (Codex Minor), so a malformed or 3-digit
   slug can never later be misread as a legacy ownership bucket; **every set code the merged
   catalog uses has a name** (from the API's set data), else a hard failure naming the code (the
   backstop for the derived labels, Codex Major).
4. **Rules.** Parse the codex CSV (RFC-4180, CRLF-tolerant; titled rows = articles in file
   order, blank-title continuation rows = one subentry each, `Label:  content` split on the
   first colon). Emit `articles_normalized.json` in the current shape: `id = slugify(title)`
   (the current scheme - lowercase, apostrophes removed, non-alphanumerics to `-`), subentry
   `id = parentId + '__' + slugify(label)`. Gates: unique ids; non-empty content; the title set
   must be a superset of the outgoing file's titles minus an explicit allowance for removals
   (a removed article is reported, never silent - marginalia may target it).
5. **FAQs.** Parse the FAQ CSV; blank card names inherit the previous row's card. Emit
   `faqs.json` as `{id, question, answer, cards:[card_id], source}` with
   `id = 'faq_' + sha256(card + '\n' + question + '\n' + answer).slice(0,16)` - deterministic,
   so re-runs and unchanged entries keep stable ids (compiled FAQ links key on them,
   [codexDoc.js:33-36](../../src/store/codexDoc.js#L33)). Gates: every card name resolves to a
   `card_id` (post-merge, so new-card FAQs resolve); duplicate-id collisions fail with both
   rows printed.
6. **Link graph.** Regenerate `link_graph.json` from the new articles with a new deterministic
   extractor (`scripts/catalog/linkGraph.mjs`). **Hard gate, no escape (Codex Major):** run on
   the **current committed** `articles_normalized.json` it must byte-reproduce the current
   committed `link_graph.json`. If it does not, the pipeline **stops** and the mismatch is not
   shippable via a report note - it is a signal that the committed graph was not produced by a
   rule this extractor captures, and requires a **separately-reviewed curated-baseline /
   intentional-migration design** (a revision to this proposal) before regeneration is trusted.
   Only once reproduction passes is the new-corpus output accepted.
7. **Images.** For each printing base in the merged catalog, select the source scan (§1 order),
   re-encode via `sharp` to WebP, 380 px wide (5:7; Gothic's 744×1039 downscales), quality
   pinned to match the current corpus weight (~41 KB average, measured and reported). Emit the
   full manifest into the staging tree; the promote step (below) mirrors it into `public/cards/`
   and **deletes every file not in the manifest** (this is the `alp-` → numeric transition, and
   it keeps the folder canonical forever). Unmatched drop scans (a scan whose base matches no
   variant) are warnings with file names; variants with no scan and no existing file are warnings
   ending in "this printing will show generated art".
8. **Compile.** Run the existing `compile:codex`
   ([scripts/compile-codex.mjs](../../scripts/compile-codex.mjs)) into staging - its invariant
   checks (no dropped content, no overlaps, no duplicate ids) are the corpus gate. The compiled
   `codex_documents.json` is a staged artifact like every other, so a mixed generation (docs from
   one input set, JSON from another) is impossible by construction.
9. **Validate the staged tree (referential integrity, before any promote).** Every `image` slug
   named in the staged `cards.json` has a file in the staged art manifest; the staged compiled
   docs derive from the staged JSON (buildHash matches); counts match the report. A failure here
   leaves `public/`/`src/` untouched (nothing was promoted).
10. **Version + commit protocol (atomic promote, Codex Major).** Compute `hash` = sha256 over the
    five JSON outputs plus the sorted art manifest; `version` = previous integer + 1 **only when
    the hash changed** (2 → 3 for this drop, honouring decision 5; a no-op re-run changes
    nothing and promotes nothing). Then promote under a journal:
    - Write a promote journal (`.catalog-build/PROMOTE.json`) marked `in-progress`, listing every
      target file and the target version hash. Staging is retained until the journal clears.
    - Mirror the staged art into `public/cards/` (add/replace, delete files absent from the
      manifest), then the staged JSON into `public/catalog/`, then `src/store/catalogVersion.json`
      **last** - so the version token, the seed's trigger, only appears once every referenced file
      is in place.
    - Mark the journal `complete`, then delete it.
    - **The journal is a build-wide preflight, not just an `update:catalog` guard (rev 5, Codex
      Major).** A stale `in-progress` journal means the working tree is a mixed generation, and
      *any* packaging path must refuse to proceed. A reusable script
      **`"catalog:assert-clean": "node scripts/assert-no-pending-catalog-promote.mjs"`** hard-fails
      with the recovery instructions - "the last catalog update was interrupted; the tree is mixed.
      Run `npm run update:catalog -- --recover`, or `git checkout -- public/ src/store/catalogVersion.json`".
      It is wired through npm **lifecycle hooks** so it fires without editing each target's body:
      `prebuild`, **`preandroid`** (the documented APK workflow `npm run android` runs `vite build`
      directly, so `prebuild` never fires for it - `preandroid` closes exactly that gap, Codex's
      Major), `precompile:codex`, and `precheck:docs` each run `catalog:assert-clean`. `android`
      keeps its current shape (`vite build && cap sync android && strip-wasm`); the `preandroid`
      hook is the chosen mechanism (over rewriting `android` to `npm run build && …`, which would
      double the vite build). **`update:catalog` calls the shared assertion internally rather than
      via a pre-hook**, because recovery mode (`--recover`) must *detect and deliberately handle*
      the journal, not be blocked by a generic guard. So either the whole previous generation (git
      restore) or the whole new generation (`--recover` re-promotes deterministically from retained
      staging) is shippable; a mixed state is detected and named on **every** path to an artifact -
      `build`, `android`, `compile:codex`/`--check`, `check:docs`, `update:catalog` - **never
      silently packaged**. Optional defence in depth (non-blocking, not required given BUILD.md
      mandates `npm run android` before `assembleRelease`): bind the assertion into Android's
      `preBuild`/`preReleaseBuild` Gradle task to also protect a direct `assembleRelease`.
    `catalog.js:22`([catalog.js:22](../../src/store/catalog.js#L22)) becomes
    `CATALOG_VERSION = version + ':' + hash.slice(0,12)` read from the generated file - the seed's
    equality check ([catalog.js:53-57](../../src/store/catalog.js#L53)) needs no change.
11. **Report.** Print the human summary: cards added/updated/local-only (incl. the Foot Soldier
    overlap), articles/subentries, FAQs, errata count, images converted/kept/skipped-foil/
    skipped-reverse/warned, total art payload, and the reminder checklist (changelog entry, build
    bump on install, `git diff` review).

**What the pipeline never does:** touch `SCHEMA_VERSION`, touch anything under `src/` except the
generated `catalogVersion.json`, bump `package.json`'s `build` (that is tied to device installs,
per BUILD.md), write `.bak` files into `public/` (they would ship in the APK - git is the backup),
or commit. The only paths it promotes into are `public/catalog/`, `public/cards/`, and
`src/store/catalogVersion.json`; the staging tree and journal live under gitignored
`.catalog-build/`.

### 5. Error behavior, summarized

| Failure | Behavior |
|---|---|
| API unreachable / shape changed | Named failure before any write; repo untouched |
| An existing card would vanish, or ids collide | Hard failure naming the cards |
| Malformed CSV row / unknown header | Failure with file, row number, and expected header |
| FAQ card name resolves to nothing | Failure listing the names (0 today; guards typos in future drops) |
| Drop scan matches no printing | Warning with file name; run continues |
| Printing has no scan and no existing art | Warning; zero-image fallback covers it (invariant 6) |
| Malformed printing base (empty, `'foil'`, or `/^\d{3}(:f)?$/`) | **Hard failure** naming the slug (Codex Minor) - it could be misread as a legacy bucket |
| A used set code has no name in the API set data | **Hard failure** naming the code (Codex Major) - labels are derived, so an unnamed set cannot ship |
| Link-graph reproduction of the committed file fails | **Hard failure**; stop and revise the proposal with a curated-baseline design (Codex Major) - never a report note |
| Staged tree fails referential integrity (art/doc/counts) | Failure before any promote; `public/`/`src/` untouched |
| A prior run's promote was interrupted (stale journal) | **Build-wide hard failure with recovery instructions** (`--recover` or `git checkout`) - `catalog:assert-clean` via `prebuild`/`preandroid`/`precompile:codex`/`precheck:docs` makes `build`, **`android`**, `compile:codex`/`--check`, `check:docs`, and `update:catalog` all refuse until cleared; never silently packaged (Codex Major) |
| compile:codex invariant issue | Failure (existing behavior, [compile-codex.mjs:32-37](../../scripts/compile-codex.mjs#L32)) |

## Implementation plan

Ordered; each increment leaves the repo releasable (§4.8). The pipeline (low-risk build tooling)
lands and is proven before any app-visible change; the data lands before the UI that exploits it.

**0. Housekeeping (Trivial-class edits inside this approved scope).**
Rename `catalog/input` → `CATALOG_DROP`; add the README; gitignore the payload and
`.catalog-build/`; declare `sharp` as a devDependency; add the `test:catalog` script; add
`scripts/assert-no-pending-catalog-promote.mjs` + the `catalog:assert-clean` script and wire the
lifecycle hooks `prebuild`/`preandroid`/`precompile:codex`/`precheck:docs` (the build-wide
preflight, Codex Major - inert until a journal can exist, but in place before any promote path
does).
*Verify:* `git status` shows only intended files; `npm install && node -e "require('sharp')"`;
with a hand-written stale `PROMOTE.json`, **`npm run build`, `npm run android`,
`compile:codex -- --check`, and `check:docs` all hard-fail** with the recovery message; removing it
(or `--recover`) restores green.

**1. Pipeline engines + tests. No app code, no output rewrite.**
`scripts/catalog/*.mjs` with co-located `*.test.mjs`: CSV parser on real-shape fixtures
(continuation rows, quotes, CRLF); merge rules incl. the no-card-lost gate, the Foot Soldier
overlap report, **the discriminator-rejection gate** (a base that is empty, `'foil'`, or
`/^\d{3}(:f)?$/` fails, Codex Minor), and the unnamed-set hard failure; art selection incl.
foil-only and reverse cases; FAQ id determinism; **the commit protocol** (a stage/validate/journal
promote, with injected-failure tests proving a kill after each promote phase is detected on the
next run and recovers to a complete generation, Codex Major). The two history gates run here:
**link-graph regeneration byte-reproduces the committed file from committed inputs - a HARD gate,
no report-note escape (Codex Major)**; `compile:codex -- --check` stays green (nothing regenerated
yet).
*Verify:* `npm run test:catalog`, `test:codex`; a dry-run mode prints the report without writing.
**Checkpoint (§12):** dry-run report reviewed - card/article/FAQ/image deltas match the numbers
in this proposal, and the link-graph reproduction gate passes, before anything is rewritten. **If
reproduction fails, stop and revise the proposal (curated-baseline design) rather than proceeding.**

**2. Run the pipeline for real: the 16/07/26 catalog lands.**
Regenerated `public/catalog/*.json`, new `public/cards/` payload, `catalogVersion.json`
(version 3), `catalog.js` reading it, `refresh-card-variants.mjs` deleted, `catalogSets()`
deriving set labels/order. **No UI change to ownership yet** - the app shows new
cards/rules/FAQs/errata with the existing one-art-per-card presentation (enriched variants ride
along unused except flavour text resuming), and set headers now come from derived data.
*Verify:* all five gates; browser boot re-seeds; **device (installed release APK, named
device/OS/WebView per AGENTS §5):** upgrade over an install with real decks + collection +
notes → reseed completes, decks/collection/marginalia intact, new cards searchable, errata
filter counts 28, airplane-mode boot clean, zero-image sweep. Fresh install also verified.
**Checkpoint:** device evidence reviewed before the UI increments.

**3. Codex printing switcher + per-printing art helpers. Catalog-only, no profile write.**
`cardPrintings`/`printingImage` pure helpers + tests; `CardArt` `imageSlug` prop; the Codex
printing rail and hero swap; flavour text resumes. This increment reads catalog data only and
touches no `owned_cards` path, so it is releasable on its own even if Increment 4 slips.
*Verify:* `test:query`, `test:ui`, `build`; device: the rail on a multi-printing card (Apprentice
Wizard, Druid), absence on a single-printing card, foil-only/rainbow-only art renders, zero-image
mode on the detail screen, site-card (landscape) art.

**4. Exact-printing ownership widening + Collection rendering. The profile-owned increment.**
`ownedRepository` vocabulary widening (`parseVslug` discriminator + resolver, `ownedByPrinting`);
**the `canonicalizeOwnedPrintings()` boot backfill** wired into `App.jsx`; **the pure builder
`ownedPrintingDeltaStatements(...)`** returning the fixed five-statement set (Proposed design §3)
that `+`/`-` route through via the existing `tx()`, plus the typed absolute-set variant
(statements 1-3 + absolute `UPDATE`, last-writer-wins); `useOwnedLedger.step` runs the builder's
statements via `tx()` (no quantity read into JS, no absolute from the React mirror); **the
foil-read fix** (every `variant_slug='foil'` aggregate also matches `:f`); the scanner stays its
additive in-tx upsert; `Collection.jsx` groups by printing under derived set headers and renders
per-printing art. **No `db.js` change.** **Checkpoint (§12) before this increment** - it is the
profile-owned data change and carries the blocker's fix.
*Verify:* `test:query`, `test:ui`, `build`, and the statement-level suite below; device,
**required** (invariant 8):
- **The barriered conservation suite - the exact SQL, not a model (the headline correctness test,
  Codex Blocker).** Extract `ownedPrintingDeltaStatements(...)` as a pure builder and run its
  **exact statements** against an in-memory sql.js DB under `test:query`. Cases: legacy-only `+1`;
  legacy + pre-existing exact `+1`; `-1` with delete-at-zero; regular and foil keys;
  scanner-tx-**before**-step-tx; step-tx-**before**-scanner-tx; typed absolute before **and** after
  a scanner increment; backfill collision (legacy + exact rows). Every case asserts
  `SUM(qty_owned)`/`SUM(qty_wanted)` conservation per card (`999`+`999-druid-d` totals 3 when a scan
  and a `+1` both land, never 2). **Mutation check (must be recorded in the implementation
  report):** temporarily substitute (a) a naive rename and (b) rev 3's read-before-tx absolute
  write - **both must fail** this suite.
- **Foil-read tests:** a `999-druid-op:f` and a `'001:f'` row read as foil at card level
  (`ownWantMap`, `qtyFor`, Overview), and buildability still sums them.
- **Stale-journal build gate:** with a `PROMOTE.json` present, `npm run build`, `npm run android`,
  `compile:codex -- --check`, `check:docs`, and `update:catalog` all hard-fail; `--recover` (or git
  restore) clears it and all proceed.
- Device: the City of Glass example end-to-end (criterion 3); a multi-art promo (Druid) split
  across two printings shows both arts with independent quantities; **the owned-row upgrade test
  (criterion 5)** - a build-43 install carrying every legacy key upgrades, the backfill runs, and
  every quantity is conserved and resolves to the right printing (inspect `owned_cards`
  before/after); recording a new copy persists and re-renders; zero-image mode on My Collection;
  scanner files a single-set card under its exact printing.

**5. Release packaging.**
Changelog build-44 entry (draft below), documentation updates (next section), `check:docs`.
Build bump to 44 happens with the first device install per BUILD.md; distribution stays
owner-triggered.

Draft What's New (voice per `src/content/changelog.js`; owner edits welcome):

> **Catalog update - 16 July 2026.** The Codex grew.
> - *added:* Five new cards join the catalogue, Court of Equity and its courtrooms among them.
> - *added:* Every printing now shows its own art. A promo City of Glass finally looks like
>   one - in your collection, and in the Codex, where a new printing rail on each card lets
>   you flip through every version ever printed.
> - *changed:* The rules Codex is current: two new articles, dozens rewritten, a hundred new
>   official FAQs, and updated text on 28 errata'd cards - look for the errata filter.

## Data migration and compatibility

**No schema migration.** `SCHEMA_VERSION` stays 10; no `MIGRATIONS` entry. The whole change
rides the catalog reseed, which is the designed mechanism for catalog evolution
([catalogCache.js:1-7](../../src/store/catalogCache.js#L1)).

**Reseed behavior (the real migration).** First boot after update: `catalog_meta['version']`
reads `2`, mismatches `3:<hash>`, and `seedCatalogIfNeeded` deletes + reloads the four catalog
tables in one `tx()`, updates the token, persists, and invalidates the session cache
([catalog.js:53-99](../../src/store/catalog.js#L53)). Interrupted mid-seed → transaction rolls
back, token still `2`, next boot retries: retry-safe. Profile tables are not named in the
statement list; decks, collections, lists, matches, notes, saved, links, dashboards, settings
are bit-identical across the reseed. Proven on device in Increment 2, not asserted.

**Identity stability.** Every existing `card_id` survives (pipeline hard gate). Rules ids are
re-derived from titles by the same slug scheme; all 210 current titles are present in the new
CSV (measured), so existing marginalia/saved/link targets keep resolving. FAQ ids change format
(Curiosa UUIDs → content hashes) - nothing profile-owned references a FAQ id (`saved`/`notes`
target cards and rules; checked against
[FEATURE_MATRIX §8](../../COMPENDIUM_FEATURE_MATRIX.md)), and compiled FAQ links regenerate in
the same commit, so the id swap is invisible.

**The art nomenclature transition.** Old `alp-…` files are deleted and every `image_slug` row
value is rewritten to the new names **in the same APK** - the files and the rows that name them
ship and re-seed together, so no window exists where one references the other's absence. No
profile-owned row stores an art file name that is ever read back (assumption 8, grep-verified;
`decks.avatar_slug`/`cover_slug` have no reader). Profile bundles carry no catalog data or art
names either ([profileTransfer.js:98-99](../../src/store/profileTransfer.js#L98) round-trips the
dead columns verbatim, which remains harmless).

**`owned_cards` widening (rev 5, the profile-owned change).** This is the one place the change
touches profile data, so it is specified in full against §3.3/§3.4/§3.5. Rev 2's "existing rows are
never rewritten" claim is **withdrawn** (Codex Blocker: the *write* path turned a read-resolved
legacy row into a durable second row, double-counting `ownedMap`). Rev 3 replaced it with a
**quantity-conservation** guarantee via a boot backfill plus reconciling writes; rev 4 tried to
close the concurrency window with an in-tx read that our `tx()` contract cannot express; **rev 5
expresses the whole delta reconciliation as a fixed parameterised SQL statement set through the
existing `tx()`** (Proposed design §3) - no quantity read into JS, no `db.js` change - so no read
outside the transaction exists to go stale.

- **No schema migration, no `SCHEMA_VERSION` bump.** `owned_cards`'s columns, its
  `UNIQUE(profile_id,card_id,variant_slug)` index, and every upsert key are unchanged
  ([schema.js:292-303](../../src/store/schema.js#L292)); `variant_slug` already stores free text.
  The new vocabulary is a superset of the old, distinguishable by shape (Proposed design §3). The
  canonicalisation is an **app-level, boot-time data pass**, not a schema-versioned migration -
  the same tier as `backfillSingleSetOwned`.
- **Boot backfill canonicalises the unambiguous rows (in scope).** `canonicalizeOwnedPrintings()`
  promotes every legacy set-code row whose set has one printing (all but the 24 ambiguous pairs
  across 21 cards) to its exact key: a single `UPDATE` when the exact key is free, or an
  add-then-delete in one `tx()` on a collision with a pre-existing exact row (summing `qty_owned`,
  preserving `qty_wanted`, `notes`, earliest `created_at`). Forward-only, idempotent, per-card
  transactional; it never touches an ambiguous row and never merges across cards. Interruption-safe:
  a crash leaves some canonical and some legacy rows, both of which read and re-run correctly, and
  a re-run finishes the rest.
- **Fixed-SQL delta writes close the write window the backfill cannot (rev 5, the Blocker's direct
  fix).** For the 24 ambiguous pairs, and for any edit racing the very first boot, `+`/`-` run the
  five-statement set (Proposed design §3) in one `tx()`: ensure-exact, fold-legacy (quantities add,
  notes merge exact-first), delete-legacy, apply-delta (`MAX(0,…)`), delete-at-zero - **no quantity
  read into JS**. The typed absolute-set path uses statements 1-3 then an absolute `UPDATE`
  (last-writer-wins, stated). The scanner stays an additive in-tx upsert; SQLite serialises it
  against the step tx, so `ownedMap` never sees both a `999` and a `999-druid-d` row for the same
  copies, and no scanner/stepper interleaving loses or doubles a copy - the reported "3 not 2" (and
  its mirror, a lost scan) are both impossible.
- **Conservation is the invariant, proven by barriered test.** Across the backfill and every edit
  path (`+`, `-`, set-to-zero, and a scanner upsert forced to commit both **before** and **after**
  the stepper's fold), total `qty_owned`/`qty_wanted` per card is unchanged; foil (`:f`) and
  wishlist (`''`) contributions are preserved distinctly. The conservation suite (Verification)
  starts from real legacy **and** pre-existing exact fixtures, because the collision
  case is exactly where a naive rename would lose or double a quantity.
- **Foil correctness.** The foil-read fix (Proposed design §3) makes card-level foil counts agree
  with My Collection for both `'foil'` and `:f` rows; buildability sums all rows regardless.

**Point of no return:** none for owned data. The backfill only moves quantities to more-specific
keys losslessly; there is no lossy transform to reverse. A reverted build simply stops running the
backfill; already-canonicalised rows remain valid exact-printing rows (and read-resolve trivially,
being exact). Ambiguous rows were never altered.

**Old bundles / old exports:** unaffected; bundle format does not change. Profile export/import
round-trips `owned_cards.variant_slug` verbatim ([profileTransfer.js](../../src/store/profileTransfer.js)),
so a pre-rev-3 bundle imports and is canonicalised on the next boot exactly as an on-device row is,
and a post-rev-3 bundle carries exact-printing rows that import unchanged.

## Rollback and recovery

| Increment | Rollback | Data consequence |
|---|---|---|
| 0-1 (tooling) | `git revert` | None - no output rewritten |
| 2 (catalog payload) | `git revert` the payload + `catalogVersion.json`; ship a higher build | A device that booted v3 simply re-seeds to the reverted content on its next boot: the token changes again, the same deletion/reload runs. **Catalog reseed is symmetric - no point of no return for catalog data.** Profile data was never written to |
| 3 (Codex switcher) | `git revert` | None - presentation only |
| 4 (ownership widening) | `git revert` | **Owned data is safe either way.** The backfill's promotions are lossless (quantity conserved to a more-specific key); a reverted build stops running it, and already-canonicalised rows remain valid exact rows that read-resolve trivially. No lossy transform to reverse (Data migration: no point of no return) |
| Pipeline promote (dev machine) | `--recover` re-promotes from staging, or `git checkout -- public/ src/store/catalogVersion.json` | An interrupted promote is **detected** on the next run (stale journal) and recovered to a complete generation; never a silent mixed state |
| Shipped APK | Higher-build follow-up (monotonic `versionCode` per BUILD.md) | Same as any release rollback |

Partial failure on device: an interrupted seed rolls back atomically (one `tx()`); an interrupted
boot backfill leaves a mix of canonical and legacy rows, both correct, and the next boot finishes
it. The only irreversible artifact this change creates is history: the old `public/cards/` payload
and old JSONs remain recoverable from git forever.

## Verification plan

**Automated (all gates named in CLAUDE.md/BUILD.md, plus the new suite):**

- `npm run test:catalog` (new): CSV parsing (continuation rows, quoting, CRLF, BOM, apostrophes,
  em-dash content); merge gates (card-loss refusal, duplicate ids, new-card add, local-only
  preservation incl. Foot Soldier overlap); **discriminator rejection** (a printing base that is
  empty, `'foil'`, or `/^\d{3}(:f)?$/` fails the run, Codex Minor); **unnamed-set hard failure**;
  art selection (standard-preferred, foil-only kept, reverse skipped, representative-per-set
  determinism); FAQ id stability; **the link-graph hard gate** (reproduces the committed file, and
  a deliberately-perturbed input makes the gate fail, proving it bites, Codex Major); **the commit
  protocol** - inject a failure after each promote phase (art mirrored, JSON mirrored, before
  `catalogVersion.json`) and assert the next run detects the stale journal and `--recover`
  restores a complete generation, never a mixed tree; **the build-wide preflight** - with a stale
  journal present, `npm run build` (via `prebuild`), **`npm run android` (via `preandroid`)**,
  `compile:codex -- --check`, `check:docs`, and `update:catalog` each hard-fail with the recovery
  message, and clearing the journal (`--recover` or restore) makes them green (Codex Major).
- `npm run test:codex`: existing compiler invariants over the new corpus (no dropped content,
  no overlapping spans, no duplicate doc ids) - the strongest structural check on the CSV
  conversion.
- `npm run test:query`: `cardPrintings`/`printingImage` unit tests; **the `parseVslug` legacy
  set-code discriminator and its read-resolution** (a `'001'` row resolves to the single Alpha
  printing; a `'999'` row on an ambiguous card resolves to the deterministic representative; a
  `'999-druid-op'` row passes through exact; a `:f` suffix is preserved on all forms);
  **the barriered conservation suite - the exact SQL, not a model (Codex Blocker, the headline
  correctness test):** extract `ownedPrintingDeltaStatements(...)` as a pure builder and run its
  **exact statements** against an in-memory sql.js DB. Cases: legacy-only `+1`; legacy + pre-existing
  exact `+1`; `-1` with delete-at-zero; regular and foil keys; scanner-tx-**before**-step-tx;
  step-tx-**before**-scanner-tx; typed absolute before **and** after a scanner increment; backfill
  collision (legacy + exact rows). Each asserts `SUM(qty_owned)`/`SUM(qty_wanted)` conservation per
  card (`999`+`999-druid-d` totals 3 when a scan and a `+1` both land, never 2). **Mutation check:**
  substituting (a) a naive rename and (b) rev 3's read-before-tx absolute write **both** make the
  suite fail - a bare "concurrent" test without these is insufficient. **Foil-read tests** (a
  `999-druid-op:f` and a `'001:f'` row count as foil in `ownWantMap`, `qtyFor`, and the Overview
  query, and buildability still sums them); `ownedMap` sums identically across old and new keys
  (buildability unaffected); existing card-grammar and compare-engine suites over the enriched rows
  (frozen-row compatibility, assumption 5).
- `npm run test:ui`: printing-rail selection state and the Collection printing-grouping logic
  extracted as pure modules per the established pattern ([BUILD.md](../../BUILD.md) test section).
- `npm run build`; `npm run compile:codex -- --check`; `npm run check:docs`.
- Idempotency: run `update:catalog` twice; second run must report "no changes" and leave the
  tree clean (`git status` empty).

**Native, on device - required (invariant 8; a browser pass is not native proof, and a phone
browser is not the shipping WebView either - evidence names device, OS, WebView version, and
build type per AGENTS §5):**

1. **Upgrade reseed with real data (the headline test):** install the current build 43 release
   APK, create decks/collection/notes/matches, install the new release APK over it → splash
   shows seed progress once, then: decks intact with correct entries and covers, collection
   quantities intact per set bucket, marginalia resolve, matches intact.
2. Fresh install: seeds v3 clean; counts match the pipeline report (1,109 cards, 212 articles,
   835 FAQs).
3. The City of Glass example, exactly as the owner phrased it (criterion 3).
4. **Owned-row upgrade + conservation (criterion 5, the profile-owned headline):** a build-43
   install carrying owned rows across every legacy key - `''`, `'foil'`, `'001'`, `'001:f'`, and a
   `'999'` row on a multi-printing card (e.g. Druid) - upgrades; the boot backfill runs;
   **total owned/wanted per card is identical before and after** (inspect `owned_cards`), with
   single-set rows now stored under their exact printing and the ambiguous `'999'` row left as the
   "unspecified promo" bucket; then editing a legacy-resolved printing (`+`) folds it into the
   exact key rather than creating a second row - `ownedMap` totals 2, not 3.
5. **Multi-art promo:** own Druid across `999-druid-d` and `999-druid-op` (and a Sorcerer promo);
   My Collection shows a row per printing with its own art; the quantities are independent.
6. Printing rail: multi-printing card (Apprentice Wizard - 001/002/999), single-printing card
   (no rail), foil-only promo art renders (City of Glass 999), rainbow-only avatar art renders
   (an `-op` avatar), Winter River now has art.
7. Zero-image sweep (`cx-no-images`): Codex detail with rail, My Collection binder/list, the
   ownership sheet - legible, stable, no broken images; a printing with no scan shows the
   card-identity fallback.
8. Airplane-mode boot and five-pillar walk after reseed (offline-first release condition).
9. Interrupted seed: force-stop during first-boot seeding → relaunch → seed completes, no
   half-catalog (transaction rollback observed via counts).
10. Scanner regression: scan a card and confirm it files under its exact printing when the set is
    unambiguous, and under the set bucket (read-resolving to the representative) when it is not
    ([ownedRepository.js:194-206](../../src/store/ownedRepository.js#L194)).
11. Performance spot-check: cold boot time and seed duration vs build 43 on the same device;
    Codex A-Z scroll and My Collection scroll remain smooth with the larger variants payload.

**Accessibility:** rail thumbnails ≥ 48 dp targets with `aria-label` naming set + product;
selection state announced (`aria-pressed`); caption text ≥ AA contrast (uses existing ink
tokens); reduced-motion honours the existing fade conventions.

### Final approval evidence (Codex's list, returned with the implementation)

The ownership increment is not complete until the implementation report returns:

1. **The exact ownership SQL diff** - the `ownedPrintingDeltaStatements(...)` builder and the delta
   and absolute-set writers as written.
2. **Conservation-test output** including the **two mutation failures** (naive rename and rev-3
   read-before-tx both go red against the suite).
3. **Stale-journal failure output from both `npm run build` and `npm run android`** (plus
   `compile:codex --check`, `check:docs`, `update:catalog`).
4. **Recovery output** - `--recover` (or git restore) clears the journal and every gate proceeds.
5. **All standard gates** - `test:codex`, `test:query`, `test:ui`, `test:catalog`, `build`,
   `check:docs`.
6. **The native before/after `owned_cards` inspection** proving per-card quantity conservation
   across the on-device upgrade (device, OS, WebView, build type named per AGENTS §5).

## Security, privacy, performance, and operations

**Input trust.** The drop and the API are third-party content entering a bundled catalog. All
card/rule/FAQ prose enters the DB through positional-parameter statements
([catalog.js:15-20](../../src/store/catalog.js#L15)) - no inline SQL, immune to quotes,
semicolons, and comment sequences in prose (the native splitter's known hazard). Rendering of
rules/FAQ text goes through the existing canon/link renderer (React text nodes, no HTML
injection path); `[[..]]`/`((..))` extraction never evaluates content. Variant `src` URLs are
stored but never fetched by the app (offline-first; no CDN dependency enters the bundle). The
pipeline runs at build time on the developer machine; it makes exactly one class of network
call (the documented Curiosa endpoint) and sends nothing.

**Privacy.** No telemetry, no user data, no PII anywhere in this change.

**Performance and size budget.**

- **Art payload:** ~1,599 WebPs at the current ~41 KB average ≈ **63-66 MB vs 47 MB today**;
  APK grows from ~66 MB to roughly **82-85 MB** (BUILD.md already documents card art as the
  dominant size factor and calls further reduction a product decision). The exact figure is
  printed by the pipeline and recorded in the completion report. If the owner wants it flatter,
  the single lever is encode quality; a re-run re-encodes everything deterministically.
  Flagged as an owner-visible consequence (risk 3), not an open design fork.
- **Seed cost:** rows grow from ~1,104+210+734 to 1,109+281+835 (+ link edges); the seed is one
  transaction with splash progress ([catalog.js:59-94](../../src/store/catalog.js#L59)); device
  timing measured in verification 9.
- **Session memory:** the parsed catalog cache holds richer `_variants`; bounded (~1,600
  variant objects across 1,109 frozen rows). No per-keystroke cost changes - the cache design
  exists precisely to absorb this ([catalogCache.js:8-31](../../src/store/catalogCache.js#L8)).
- **Pipeline runtime:** ~1,600 sharp encodes; minutes, not hours; narrated per stage.

**Operations.** The 3.2 GB drop stays out of git (gitignore in Increment 0). The pipeline is a
devDependency-only concern (`sharp` declared at last); CI-free by design - it runs on the
owner's machine, and its outputs are ordinary reviewable commits. Release remains: run pipeline
→ review diff/report → gates → device evidence → changelog + build bump → `assembleRelease`.

## Documentation impact

Per AGENTS §5 / constitution §13 - every source-of-truth document dispositioned:

| Document | Disposition |
|---|---|
| `COMPENDIUM_DATA_MODEL.md` | **Update.** §4 `cards`: the enriched `variants` entry shape and the printing model (one row per name, printings as variants, per-printing `image`); the catalog version token's new form (`src/store/catalogVersion.json`, generated) and reseed semantics; a new subsection documenting the catalog-update pipeline (with its stage/validate/journal-promote commit protocol) as the standing content path; note `image_slug` = default printing art. **§6 `owned_cards` (rev 5):** the widened `variant_slug` vocabulary (exact printing base, `:f` foil, legacy set-code rows canonicalised by an idempotent boot backfill and reconciled by a fixed parameterised SQL statement set through `tx()`, quantity conserved, no schema change), stated alongside the existing forward-only/transactional notes |
| `COMPENDIUM_ARCHITECTURE.md` | **Update.** §4.B storage shape note ("catalog … updatable as data" becomes concrete: the `CATALOG_DROP` convention and one-command update as the standing process); §6 expandability gains the measured example (a set update = a drop + one command) and records that set labels/order are **derived from catalog data**, not hardcoded |
| `COMPENDIUM_FEATURE_MATRIX.md` | **Update.** Codex capability row: card detail gains the printing switcher (one entry per name preserved); Collection §3: "printing-aware ownership" sharpened from set-bucket to **exact printing** (record and see the specific promo owned), with per-printing art; cross-cutting: a "catalog content update" capability row naming the pipeline and its owner |
| `BUILD.md` | **Update.** New section "Update the catalog": the drop folder, `npm run update:catalog`, what the report means, the reminder checklist (changelog + build bump), the art-payload note updated (file count/size, new nomenclature), and the `catalog:assert-clean` journal preflight (why `build`/`android`/`compile:codex`/`check:docs` can hard-fail with a mixed-tree message and how `--recover` clears it) |
| `CATALOG_DROP/README.md` | **New deliverable.** The non-engineer runbook (also summarized in BUILD.md) |
| `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` | **Reviewed - no change required.** No process or agent-behavior change |
| `CLAUDE.md` | **Reviewed - likely no change.** Quality-gate list is unchanged (`test:catalog` is additive and documented in BUILD.md); pointer file by design |
| `docs/proposals/catalog-update-pipeline.md` | This document; Approval record maintained |

`npm run check:docs` runs at completion; note its schema-version assertion is untouched
(SCHEMA_VERSION stays 10) and all new local links must resolve.

## Risks and unanswered questions

| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | Reseed at the new size fails or stalls on a real device (native splitter quirks, transaction size, low-storage devices) | Low | High | Same parameterized single-`tx()` path that shipped v2; interrupted-seed device test; retry-safe token ordering | Claude |
| 2 | A future API shape change silently corrupts a merge instead of failing | Med | High | Field-by-field response validation; the no-card-lost and sane-count hard gates; nothing written until all stages pass | Claude |
| 3 | APK grows ~+17 MB and testers notice | High (certain) | Low-Med | Reported precisely by the pipeline; quality lever documented; owner accepts or tunes | Owner |
| 4 | The `owned_cards` widening loses or double-counts a quantity in a backfill collision or a concurrent scanner/stepper edit (the Blocker's failure mode) | Low | **High** | Edit writes are a **fixed parameterised SQL statement set** through `tx()` (no quantity read into JS, no `db.js` change), aligned with the scanner's additive upsert; the **statement-level** conservation suite runs the exact SQL against sql.js across both interleavings and must fail against a naive rename and the rev-3 read-before-tx design; device before/after inspection | Claude |
| 4b | An ambiguous-pair pre-existing row shows the representative promo, not the one actually owned, until assigned | Low (24 pairs, few promo rows in alpha) | Low | Backfill leaves it as an explicit "unspecified promo" the user assigns; new rows are always exact | Owner |
| 4c | The two-vocabulary parse mis-classifies a row (a legacy `'999'` read as exact, or vice versa) | Low | Med | Shape discriminator is unambiguous; the **pipeline rejects** any base matching `/^\d{3}(:f)?$/` (Codex Minor), so no exact base can ever look legacy; `test:query` covers all forms | Claude |
| 4d | An interrupted pipeline promote ships a mixed catalog, including via `npm run android` (which runs `vite build` directly, bypassing `prebuild`) | Low | **High** | Stage/validate/journal-promote with the version token written last; `catalog:assert-clean` via `prebuild`/**`preandroid`**/`precompile:codex`/`precheck:docs` hard-fails `build`/`android`/`compile:codex`/`--check`/`check:docs`, and `update:catalog` asserts internally (Codex Major); tests prove all five paths block on a stale journal and `--recover` clears them | Claude |
| 5 | Link-graph regeneration cannot byte-reproduce the committed file (unknown original generator) | Med | Med | **Hard** Increment 1 gate (Codex Major): a mismatch **stops** for a separately-reviewed curated-baseline design, never a report-note escape | Claude |
| 6 | A future drop introduces a new set code | Low (future) | Low | Set labels/order are **derived** from catalog data (Codex Major), so a new set needs no source edit; an unnamed code is a hard pipeline failure | Claude |
| 7 | CSV export conventions drift in future drops (headers, continuation rows) | Med (future) | Low | Header classification + row-level errors fail the run with the exact location; README tells the operator what a valid export looks like | Claude |
| 8 | Token duplication (open question 1) confuses scanner/search results for Foot Soldier printings | Low | Low | Default keeps both; report lists the overlap every run until resolved | Owner |
| 9 | The larger frozen-variant payload regresses a hot path (Refine, search) on old devices | Low | Med | Verification 9 measures scroll/search on device; the cache absorbs parse cost by design | Claude |

**Open questions - all five settled by the owner (rev 2); recorded closed so they are not
re-raised:**

1. **Foot Soldier consolidation → RESOLVED: keep both.** The nine local token cards AND the
   API's unified `Foot Soldier` are retained; the merge stage reports the overlap on every run.
   No card_id migration, so locked decision 1 holds.
2. **Promo granularity → RESOLVED: widen to exact printings now** (Option H). Redesigned in
   Proposed design §3 and the `owned_cards` widening subsection.
3. **APK size → RESOLVED: accept ~82-85 MB**, no byte budget. Encode quality stays at the
   current corpus weight; the pipeline reports the figure.
4. **Reverse faces → RESOLVED: stay unbundled.** Avatar card backs are not shipped; no UI shows
   them.
5. **Folder name → RESOLVED: `CATALOG_DROP`.**

None outstanding. The §12 checkpoints (Increment 1 dry-run, before Increment 2 device reseed,
before Increment 4 the profile-owned widening) remain.

## Self-Critique

**The strongest case this design is wrong (rev 5).** Three revisions running I proposed a write
mechanism that did not survive contact with the actual constraints - "no writes" (rev 2), then an
in-tx read (rev 4) our `tx()` cannot express. Codex supplied the fixed-SQL set that finally fits,
and it is correct, but the honest read is that the correctness now lives in **five hand-written SQL
statements whose interaction I am asserting** rather than in a mechanism I can point at and call
obviously safe. The `ON CONFLICT` accumulation, the notes `CASE`, the fold-before-delta ordering,
and the delete-at-zero all have to compose exactly right, and a subtle error there is a silently
lost or doubled owned copy - the §2 harm. The whole defence is that the conservation suite runs the
**exact statements** (not a model) and is required to go red against both a naive rename and the
rev-3 design before it is trusted; if that suite is weak, nothing else catches a bad statement.
Secondary residual, carried from rev 4: this changes a **long-standing write path** (`useOwnedLedger`
computed absolutes for every collection edit, not just promos) to a delta model, so the optimistic
mirror must reconcile-on-drain watertightly or a rapid double-tap shows a transient wrong number -
visual, not a data bug, but a real behaviour change to a shared control the reviewer should weigh.

**The second-strongest case.** The commit protocol adds a stateful moving part (a journal, a
staging tree, a `--recover` path) to what was "regenerate some files", and it runs on the owner's
machine, not CI. The build-wide preflight closes the dangerous half - no packaging path, `android`
now included via `preandroid`, can *silently* ship a mixed tree - but it does so by adding a failure
the operator must understand and clear, and its own edge modes (staging deleted out from under
`--recover`; a journal left by a run force-quit and forgotten) still fall on a non-engineer, now as
a *blocked build* rather than a bad ship. That is the right trade (a blocked build is loud and
safe), and the hook wiring depends on npm firing `pre<script>` for every packaging entry point,
which is why the tests must exercise `build` **and** `android` explicitly, not assume one covers the
other. Atomicity across ~1,600 files and four directories is not free, and the simpler design I
rejected in a sentence - promote into a fresh `public/cards@<hash>/` directory selected by one
pointer the app reads - remains the fallback if the journal proves fiddly.

**The highest-consequence assumption if false.** Assumption 3 (link-graph reproducibility). If
the committed `link_graph.json` was hand-touched or produced by rules I cannot reconstruct, the
regenerated graph will differ, and the differences flow into "Mentioned in", "Cards mentioned",
and the `examples` filter - quiet semantic drift in reference navigation, precisely the kind of
regression that looks fine in a demo. The Increment 1 byte-reproduction gate turns this from a
silent risk into a loud one, and - **consistent with the hard gate, no manual-review escape** - a
mismatch **stops implementation** and requires a separately-reviewed curated-baseline proposal
revision rather than a hand-reviewed diff waved through. That is deliberately not a "document the
delta and proceed" path; the gate exists precisely because I cannot certify by eye that 678 edges
are all intentional.

**The simpler alternative I rejected, and whether fairly.** Skip the per-printing feature
entirely: run the data update, keep one art per card, ship in a week with a fraction of this
document. It was rejected because the owner explicitly locked the feature (decisions 2-3), but
it is worth stating that the *pipeline* half of this proposal delivers most of the user value
(five cards, current rules, 100 new FAQs, errata) and none of the UI risk - which is exactly why
the implementation plan lands it first as Increment 2, independently releasable. If the UI half
stalls in review, the catalog still ships.

**Hidden coupling most likely missed.** Frozen catalog rows. `catalogCache` freezes rows and
shares them across every consumer ([catalogCache.js:28-31](../../src/store/catalogCache.js#L28));
the printing helpers must not tag rows (`Object.freeze` will silently no-op writes in loose mode
or throw in strict). The design keeps them pure (compute-and-return), but a reviewer should
watch any implementation that tries to memoize per-row. Second candidate: `deckPoster.js` builds
image URLs from `avatar.image_slug` by hand ([deckPoster.js:44-71](../../src/store/deckPoster.js#L44)) -
it resolves through catalog rows so the rename is safe, but it bypasses `cardImageUrl`, meaning
the zero-image gate does not govern posters; pre-existing, unchanged, noted.

**The failure most likely to escape the test plan.** The upgrade reseed on a *low-storage or
slow* device. Every automated gate runs the seed on sql.js against a fresh store; the device
tests use healthy hardware. A tester's phone at 95% storage doing a 1,109-card reseed inside a
WebView is the case nobody's suite reaches - and its failure mode (boot stuck at the splash, or
a rolled-back seed retrying every launch) reads as "the update broke the app". Mitigations are
real but partial: single transaction (no half state), retry-safe token, progress narration. The
interrupted-seed device test (verification 9) is the closest proxy and must not be skipped under
time pressure - it is the test I would skip if I were rushing, which is why it is named here.
**The rev-5 co-candidate** is still a **conservation bug under concurrency**, now narrowed further:
the suite runs the *exact* five statements against sql.js under two barriered orderings, so it is no
longer a model - but sql.js in a `node --test` process serialises transactions on one thread, while
the device runs them through the native plugin's own connection semantics. The statement set is
plain SQLite with no engine-specific behaviour, so the risk is low, but "the SQL that conserved in
sql.js also conserves under the native plugin's transaction handling" is asserted, not proven by the
JS suite - which is exactly why verification 4 inspects `owned_cards` totals before and after **on
hardware**, not just the rendered count. A structural argument I got subtly wrong looks identical to
a correct one until the totals disagree.

**Evidence that would change the decision.**
- Increment 1's dry run shows deltas materially different from this document's measured numbers
  → stop, re-verify the drop before anything is rewritten.
- Link-graph reproduction fails (the hard Increment 1 gate) → stop and revise this proposal with a
  separately-reviewed curated-baseline / intentional-migration design, not a report note.
- The statement-level conservation suite cannot be made to hold (or does not fail against the naive
  rename and rev-3 mutation checks) → the widening does not ship until the SQL set is corrected; the
  catalog + Codex switcher (Increments 1-3) still ship without it.
- The owned-row upgrade test shows any quantity not conserved → halt Increment 4; the widening does
  not ship until pre-existing ownership is provably intact.
- The journal commit protocol proves fiddly for the operator in practice → switch to a
  pointer-selected versioned art directory (the fallback named in the Self-Critique).
- Device reseed exceeds a few seconds on mid hardware → move the seed off the splash-critical
  path (staged seeding) before shipping, as a follow-up proposal.

## Approval record

| Gate | Disposition | Date |
|---|---|---|
| Proposal review (Codex), rev 1 | Superseded by rev 2 | |
| Owner decisions on the five open questions | **Resolved** (see below); folded into rev 2 | 2026-07-16 |
| Proposal review (Codex), rev 2 | **Changes required** - 1 Blocker, 4 Majors, 1 Minor; all accepted and resolved in rev 3 (see below) | 2026-07-16 |
| Proposal review (Codex), rev 3 | **Changes required** - 2 findings (1 Blocker still open) + 1 Minor; all accepted and resolved in rev 4 (see below) | 2026-07-16 |
| Proposal review (Codex), rev 4 | **Changes required** - 2 findings, **with the concrete fix supplied for each**; both accepted and resolved in rev 5 (see below) | 2026-07-16 |
| Proposal review (Codex), rev 5 | **Approved with non-blocking follow-ups** - two implementation-level SQL corrections applied to §3 above (`created_at = MIN(owned_cards.created_at, excluded.created_at)` so the fold keeps the earliest; null-safe `COALESCE` notes merge); the builder must reject a null/absent legacy key and `legacySlug === exactSlug`. No rev 6 required. | 2026-07-16 |
| Architecture approval (human) | Pending | |

Codex rev-4 findings, each resolved in rev 5 (Codex supplied the concrete SQL and the wiring):

| Finding | Resolution |
|---|---|
| **Blocker - "read the quantity inside the tx" is not implementable with `tx(statements)`** | Adopted Codex's fix: the delta edit is a **fixed parameterised five-statement set** (ensure-exact / fold-legacy / delete-legacy / apply-delta / delete-at-zero) run through the existing `tx()` - no `query()` before `tx()`, **no `db.js` change**; `legacySlug`/`exactSlug` computed before the tx; notes-merge keeps the exact note, takes the legacy note only when the exact is empty; `qty_wanted` folded; the typed absolute-set path uses statements 1-3 + an absolute `UPDATE` (last-writer-wins). A pure builder `ownedPrintingDeltaStatements(...)` is tested by running the **exact statements** against sql.js, and the naive-rename and rev-3 read-before-tx substitutions must both fail (Proposed design §3, Verification) |
| **Major - `npm run android` bypasses the `prebuild` gate** | Adopted Codex's fix: a reusable `catalog:assert-clean` script wired via `prebuild`/**`preandroid`**/`precompile:codex`/`precheck:docs`; `update:catalog` calls the assertion internally (recovery must handle, not be blocked by, the journal). Tests prove a stale journal blocks `build`, `android`, `compile:codex --check`, `check:docs`, and `update:catalog`, and `--recover`/restore clears them |

Codex confirmed resolved (no action): the barriered conservation contract (both orderings + both
mutation checks); absolute-set last-writer-wins; the shared journal assertion across
compile:codex/`--check`/check:docs/build; the Self-Critique link-graph consistency.

Codex rev-3 findings, each resolved in rev 4:

| Finding | Resolution |
|---|---|
| **Blocker (still open) - stepper's read-then-absolute loses a concurrent increment** | `+`/`-` become **transactional deltas** - one `tx()` folds any legacy row, reads the exact row in-tx, applies `±1`, commits; no read outside the tx, aligned with the scanner's additive upsert. The typed absolute-set path reconciles in-tx and overwrites (last-writer-wins, stated). The conservation suite forces **both barriered interleavings** and must fail against a naive rename *and* the read-then-absolute design (Proposed design §3, Implementation §4, Verification) |
| **Major - promote journal only gated `update:catalog`** | A shared `assertNoPendingPromote()` is a **build-wide preflight** - `prebuild`, `compile:codex`/`--check`, and `check:docs` all hard-fail while the journal exists; tests prove a normal build hard-fails until `--recover`/restore clears it |
| **Minor - Self-Critique link-graph inconsistency** | The Self-Critique's link-graph paragraph now matches the hard gate: a mismatch stops implementation for a separately-reviewed curated-baseline revision, no manual-review escape |

Codex confirmed resolved and shipping (no action): the boot canonicalisation and
ambiguous-rows-explicit model; foil classification with tests; the hard link-graph gate; derived
set labels/order with a hard-fail on missing names; reserved-key rejection.

Codex rev-2 findings, each resolved in rev 3:

| Finding | Resolution |
|---|---|
| **Blocker - double-count on edit** | Boot backfill canonicalises unambiguous legacy rows + a first-edit reconciliation folds a legacy row into the exact key in one `tx()`; conservation is the tested invariant (Proposed design §3, Data migration, conservation suite). The `999`+`999-druid-d` case totals 2 |
| **Major - exact foil rows misread** | Every `variant_slug='foil'` card-level read now also matches `:f`; tested with legacy and exact keys (also fixes the pre-existing `'001:f'` quirk) |
| **Major - pipeline not atomic** | "Write at end" replaced by a stage/validate/journal-promote commit protocol; the version token is written last; a stale journal hard-fails the next run with recovery; injected-failure tests prove either the whole old or whole new generation survives |
| **Major - link-graph soft escape** | Byte-reproduction is a **hard** Increment 1 gate; a mismatch stops for a separately-reviewed curated-baseline design, never a report note |
| **Major - unknown set warning-only** | Set labels/order derived from catalog data (`catalogSets()`); an unnamed set code is a hard pipeline failure |
| **Minor - discriminator** | The pipeline rejects any printing base that is empty, `'foil'`, or `/^\d{3}(:f)?$/`; tested |

Codex also confirmed independently (no action): `card_id` stability + the no-disappearance gate
preserve all profile targets with no schema migration; the seed writes catalog tables only; the
SQL seed is one native-safe parameterized `tx()` with token-last retry-safety; the device test set
is appropriate with the ownership-transition cases now added.

Owner decisions of record (locked before drafting): one card per name with stable `card_id`;
printings as enriched variants with per-printing local art; the City of Glass acceptance example;
CSV/API source split; CATALOG_VERSION reseed; one-command non-engineer pipeline; the renamed drop
folder with README; ships in 1.0.2-alpha with a celebratory What's New.

Owner decisions on rev-1 open questions (all **resolved**, 2026-07-16):

1. **Foot Soldier:** keep both the nine local token cards and the API's unified card; report the
   overlap every run.
2. **Promo granularity:** widen `owned_cards` to the **exact printing now** (Option H) - the
   material change; redesigned in Proposed design §3 and the `owned_cards` widening subsection,
   with no schema migration, no `db.js` change, a lossless conservation-proven boot backfill, and
   edit writes expressed as a fixed parameterised SQL statement set through `tx()` (rev 5).
3. **APK size:** accept ~82-85 MB, no byte budget.
4. **Reverse faces:** stay unbundled.
5. **Drop folder name:** `CATALOG_DROP`.

No decisions outstanding. §12 checkpoints stand: Increment 1 dry-run review **including the hard
link-graph reproduction gate**; before Increment 2 (catalog reseed on device); **before Increment 4
(the profile-owned ownership widening, which carries the blocker's fix and the conservation
suite)**.
