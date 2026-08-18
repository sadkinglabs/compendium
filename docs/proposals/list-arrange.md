# List Arrange - grouping and sorting inside Collection > Lists

> **SUPERSEDED IN PART (2026-08-18).** The **Sort** half of this proposal - single-select
> Name / Rarity / Element / Recently added chips - is superseded by
> [`arrange-stacked-sort.md`](./arrange-stacked-sort.md), which makes sort an ordered STACK
> (tap order sets priority, each key flips direction independently) after an alpha tester asked
> to arrange a list by set, then element, then rarity. "Name Z-A" is gone as a separate option:
> direction is now a flip on the row. The **Grouping** half of this document stands unchanged -
> grouping remains one level, single-select, and the reasoning below for why grouping is not
> sorting is exactly why it was not nested.

Status: PROPOSAL - awaiting owner go. Classification: **Standard** (one surface gains an existing capability; no schema, no repositories touched). Owner rulings taken 2026-08-15: stacked filter FAB opener · canonical-printing set rule · sort options included.

## The ask (owner, verbatim intent)

A generated list is opaque as a flat A-Z run; grouped by set or rarity it reads at a glance. Rows already show rich information - the job is coherent grouping at the user's discretion, with anchored headers for orientation, in the app's refine language (a bottom sheet), drawing from the sheets already designed.

## Design

**Opener (RULED):** a stacked filter FAB above the + FAB - the exact pattern My Collection's edit mode already ships (`.fab-stacked`, decks.css:134), carrying the filters glyph like every Collection refine opener, with a badge when arrangement is active. One refine language, one opener, everywhere in Collection.

**Sheet:** an Arrange-only bottom sheet reusing the SHIPPED CollectionRefineSheet Arrange-page primitives (its Chip rows and section labels - the sheet the owner pointed at). Two rows:
- **Group by:** None · Set · Rarity · Element. `groupCards` (`collectionGrouping.js`) already implements none/element/rarity with the multi-element and no-element buckets solved; it gains a `set` mode. Card-grain rows group under the **canonical printing's set** (RULED - the same canonical rule the catalog uses, matching the set pill the row already shows); wishlist rows are item-grain and group under their exact printing.
- **Sort (within groups):** Name · Rarity · Recently added (RULED: options included) - the same trio the shipped Collection Arrange page offers, so the two sheets stay siblings. Recently added uses the rows' created_at (wishlist tidy already surfaces it).

**Anchored headers:** section headers render in the drill's existing section-label recipe (Cinzel caps + fade hairline + count) and become `position: sticky`, pinning just below the list's AppBar band so the current group is always named while scrolling. Element groups lead with the shared ElementPip; set groups with the set label; rarity groups with the rarity name.

**State:** groupBy/sort live in the Collection nav-session cache (the same place the drill's q survives an unmount) - returning to a list finds it arranged as you left it; a fresh session starts at None/Name. No persistence to disk, no schema.

**Row semantics unchanged:** steppers, hearts, edit mode, remove, peek - the rows themselves are untouched; only their order and the headers between them change. Totals/progress unaffected (grouping is presentation).

## Invariants + docs

No schema, no writes, no profile-boundary contact; zero-image safe (headers are text + the shared pip with its ▲ fallback). FEATURE_MATRIX gains the capability note; DESIGN_SYSTEM's refine-sheet section gains the Arrange-only variant note. Perf: grouping is an in-memory pass over already-loaded rows (the same `groupCards` cost My Collection pays); lists are far smaller than the catalog.

## Verification

Unit: `groupCards` set-mode + canonical-set bucketing tests beside the existing grouping tests. Device (agent-run + owner eyes): grouped-by-set wishlist with sticky headers mid-scroll; rarity and element groupings; sort switches; edit-mode + steppers inside a grouped list; zero-image pass; stacked-FAB open/badge.

## Self-critique

The sticky-header offset under the AppBar band is the one fiddly bit (the band's height is content-derived); it will be measured, not guessed, and verified on glass. Element grouping of multi-element cards follows the shipped bucketing ("Multiple"), which may surprise a user expecting a card under each of its elements - consistent with My Collection is the right default, flagged in case you ever want duplication instead.
