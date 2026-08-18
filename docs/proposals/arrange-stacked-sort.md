# Proposal: stacked sort keys in List Arrange, grouping stays one level

## Status and classification

**In review - revision 3.** Addresses Codex disposition "Changes required" (revision 2).
Risk: **Standard** (one surface plus a shared-primitive migration; presentation only, no schema, no writes)
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: project owner

Supersedes the Sort half of [`list-arrange.md`](./list-arrange.md); its grouping half stands unchanged.

**Revision history**
- **r1** - stacked sort across Lists and Collection refine. *Changes required.*
- **r2** - direction metadata contract; scope narrowed to Lists; `renderSignature` change withdrawn; total-order claim corrected. *Changes required.*
- **r3 (this)** - `asc` defined uniformly so `added: desc` no longer contradicts itself; reducer fails closed on an option object; descriptive `order` metadata replaced by a comparator registry with an exhaustiveness test; the implicit Name tie-break restored to the chain; increment 2 correctly described as an option-object migration of `DEFAULT_SORT_KEYS` and `RefineSheet` rendering; "Codex/Decks" corrected to **Deck Add Cards**; absence buckets enumerated exactly; identity reuses the established `rowKey`; DESIGN_SYSTEM wording de-overstated.

## Problem and success criteria

An alpha tester asked for arrangement to *stack*:

> "Any chance you can add a 3rd group or making the options stack? I would love to sort them by set+element+rarity like that when I go look for cards is in the same binder"

He is describing a binder walk: set dividers, elements clustered inside them, rarities ordered inside those. Today every arrangement control in the Collection is mutually exclusive - Group is one radio chip, Sort is another - so the deepest order he can express is one group plus one sort.

The owner has already answered him with the shape this proposal specifies: *grouping is not sorting, so you group by Set and stack the sorts.*

**Success criteria**

1. From an open list, "Group by Set" plus sort keys Element, then Rarity, then Name produces: set sections in set order; inside a section, cards clustered Air/Earth/Fire/Water; inside an element, Ordinary → Exceptional → Elite → Unique; inside a rarity, A to Z.
2. The order the keys are tapped is the priority order, and it is visible as a number on each chosen key.
3. Every sort key can be reversed independently, and each key starts in the direction its name promises - "Recently added" starts newest-first.
4. **Selecting a non-name key alone still orders alphabetically within it** - picking only Rarity leaves each rarity run A to Z, exactly as today.
5. The arrangement survives navigating away and back within the pillar, exactly as it does today.
6. Order and headers are the only things that change. Row identity, steppers, hearts, selection and every write path are untouched.
7. Deck Add Cards sorting is bit-for-bit unchanged by the shared-primitive migration.

**Non-goals**

- Nested/multi-level grouping. Rejected below; the tester's "3rd group" wording describes his goal, not the mechanism.
- **Collection refine (My Collection, set drill) adoption.** Deferred to a follow-up proposal - see option E.
- **Run dividers.** Deferred by owner decision.
- **`set` as a sort key.** Grouping already delivers set order for the tester's case, and adding it would introduce a second notion of "which set is this row" alongside the grouping one.
- Saving named arrangements per list, or persisting arrangement across an app restart. Neither exists today.
- Any change to filtering.

## Evidence and current architecture

Three surfaces arrange, and they disagree with each other:

| Surface | Group control | Sort control | In this batch? |
|---|---|---|---|
| **List Arrange** - the tester's screen ([`Collection.jsx:2285-2298`](../../src/pillars/Collection.jsx#L2285-L2298)) | single-select chips: None / Set / Rarity / Element | single-select chips: Name A-Z / Name Z-A / Rarity / Element / Recently added | **Yes** |
| **Deck Add Cards** ([`DeckAddCards.jsx:159-167`](../../src/pillars/DeckAddCards.jsx#L159-L167)) | none | **ordered stack already** - the only surface that passes `sort`/`setSort` | **Migration only, behaviour-preserving** |
| Codex card filters ([`Codex.jsx:135`](../../src/pillars/Codex.jsx#L135)) | none | **none** - passes neither `sort` nor `setSort`, so `RefineSheet` shows it no Arrange toggle at all | No |
| Collection refine ([`CollectionRefineSheet.jsx:104-119`](../../src/components/CollectionRefineSheet.jsx#L104-L119)) | single-select chips | single-select chips from `SORT_KEYS` | No - follow-up |

Revision 2 called the stack consumer "Codex/Decks". Verified wrong: **Deck Add Cards is the sole consumer**, and `RefineSheet` itself says so at [lines 105-106](../../src/components/RefineSheet.jsx#L105-L106) ("Codex re-sorts A-Z and supplies neither, so it sees no toggle").

**The stack primitives that already exist**

- [`SortRow`](../../src/components/RefineSheet.jsx#L70-L83) - exported; numbered badge, label, flip button.
- `toggleSort` / `flipSort` ([`RefineSheet.jsx:100-101`](../../src/components/RefineSheet.jsx#L100-L101)) - append-on-tap, remove-on-retap, flip. **`toggleSort` hardcodes `dir: 'asc'` on add.**
- `DEFAULT_SORT_KEYS` ([`RefineSheet.jsx:23`](../../src/components/RefineSheet.jsx#L23)) - **tuples**, `[key, label]`, and the renderer destructures tuples at [line 238](../../src/components/RefineSheet.jsx#L238). Adopting option objects necessarily migrates both.
- The deck-side multi-key comparator ([`deckRepository.js:396-408`](../../src/store/deckRepository.js#L396-L408)) - a `KEY` map of extractors chained in priority order with a name tiebreak.

**What the List has instead:** an inline branch chain ([`Collection.jsx:1961-1983`](../../src/pillars/Collection.jsx#L1961-L1983)) mirroring `rowComparator` ([`collectionFilter.js:112-127`](../../src/store/collectionFilter.js#L112-L127)). Direction is baked into the key string, which is why `Name A-Z` and `Name Z-A` are two chips.

**Every current non-name comparator already breaks ties by name ascending** - the `name` const at [`Collection.jsx:1960`](../../src/pillars/Collection.jsx#L1960) feeding the element and added branches, and `|| nameAsc(a, b)` inside `rowComparator`'s rarity branch. This is load-bearing behaviour that r2's chain would have dropped.

**Established row identity** ([`Collection.jsx:1885`](../../src/pillars/Collection.jsx#L1885)):

```js
const rowKey = (r) => (isWishlist ? (r.item_id ?? `${r.card_id}|`) : r.card_id);
```

Custom lists are card-grain; the Wishlist is collector-item grain, where `item_id` is `card_id|variant_slug` as minted by [`ownedRepository.js:1027`](../../src/store/ownedRepository.js#L1027). Revision 2 invented `card_id|set|variant_slug`; that is both novel and redundant, since `set` is *parsed from* `variant_slug` by `parsePrinting`.

**Ordering vocabularies, verified at source**

- `EL_ORDER = ['Air','Earth','Fire','Water','Multi','Neutral']` ([`elements.js:15`](../../src/store/elements.js#L15)).
- `RARITY_ORDER = ['Ordinary','Exceptional','Elite','Unique']` ([`rarity.js:9`](../../src/store/rarity.js#L9)); `rarityRank` returns `RARITY_ORDER.length` (4) for anything unknown ([`rarity.js:15-18`](../../src/store/rarity.js#L15-L18)); and `rarityRankFor` puts avatars at `rarityRank(undefined) + 1` = 5, dead last ([`collectionFilter.js:102`](../../src/store/collectionFilter.js#L102)). **Two distinct tail buckets, not one.**

**Grouping** is one level by construction: `groupCards` ([`collectionGrouping.js:41-85`](../../src/store/collectionGrouping.js#L41-L85)) returns a flat `[{key, label, cards}]` and takes the within-section comparator as an argument.

**Persistence.** None to disk. `collectionSession` is a module-level in-memory object, replaced wholesale on profile mismatch; the List writes `listArrange` to it at [`Collection.jsx:1957-1958`](../../src/pillars/Collection.jsx#L1957-L1958). **No schema change, no migration, no persisted-state registry entry.** Only the List's sort is session-backed; Collection refine initialises locally ([`useCollectionRefine.js:44`](../../src/components/useCollectionRefine.js#L44)).

**Scalar-consumer audit** (complete - every comparison against a sort value in `src/`):

| Site | Consumer | Surface | Effect |
|---|---|---|---|
| [`Collection.jsx:1961-1983`](../../src/pillars/Collection.jsx#L1961-L1983) | comparator branch chain | List | Replaced |
| [`Collection.jsx:2295`](../../src/pillars/Collection.jsx#L2295) | chip `active={arrange.sort === k}` | List | Replaced by `SortRow` |
| [`Collection.jsx:2281`](../../src/pillars/Collection.jsx#L2281) | FAB badge `arrange.sort !== 'name'` | List | **Must become `stack.length`** |
| [`CollectionRefineSheet.jsx:33`](../../src/components/CollectionRefineSheet.jsx#L33) | `sortActive = (sort && sort !== 'name-asc')` | Collection refine | Out of scope - surface keeps its scalar |
| [`Collection.jsx:939`](../../src/pillars/Collection.jsx#L939), [`1120`](../../src/pillars/Collection.jsx#L1120) | rail gates | Collection refine | Out of scope - surfaces keep their scalar |

**`renderSignature`** already passes `sort` inside a whole-object `JSON.stringify` ([`collectionAllModel.js:25-29`](../../src/store/collectionAllModel.js#L25-L29)), so distinct stacks serialise distinctly. **No production change**; a characterisation test only.

## Assumptions and confidence

1. The tester wants binder *order*, and set headers plus ordering satisfy him without labelled inner tiers. **Medium.** Validated by shipping and asking him.
2. Chaining up to ~4 comparators over a single list's rows (tens to low hundreds) is free. **High.** The ALL view is out of scope by construction.
3. No consumer outside the List reads `listArrange`. **High.** The audit table is exhaustive.
4. Migrating `DEFAULT_SORT_KEYS` to option objects is behaviour-preserving for Deck Add Cards. **High** - all four of its keys (`name`, `cost`, `element`, `th`) take `defaultDir: 'asc'`, matching today's hardcoded `'asc'`. Verified by characterisation tests against the actual exported options.

## Affected systems and invariants

- **UI:** List Arrange sheet and FAB badge; `RefineSheet` option rendering; `DeckAddCards` passes the migrated options.
- **Pure modules:** `collectionFilter.js` (comparator + registry), a new shared sort-stack reducer + option contract.
- **Repositories, schema, catalog, native/web runtimes, build:** untouched.
- **Invariants:** none of the eight engaged. Presentation-only reordering, no writes. Arrangement holds no profile-owned identifiers and lives in the profile-reconciled session object.

**Documentation classification** (all six source-of-truth documents):

| Document | Disposition | Reason |
|---|---|---|
| `COMPENDIUM_FEATURE_MATRIX.md` | **Updated** | List Arrange row: sort becomes multi-key |
| `DESIGN_SYSTEM.md` | **Updated** | Records stacked sorting as shipping in **List Arrange and Deck Add Cards**, with the option contract and default-direction rule. Explicitly notes Collection refine remains single-sort and parity is deferred - **not** an app-wide idiom |
| `docs/proposals/list-arrange.md` | **Updated** | Supersede note on its Sort half |
| `COMPENDIUM_ARCHITECTURE.md` | **Reviewed, no change** | No pillar ownership, dependency, boundary or runtime-posture change |
| `COMPENDIUM_DATA_MODEL.md` | **Reviewed, no change** | No table, repository, import/export format or schema version touched; arrangement never reaches SQLite |
| `BUILD.md` | **Reviewed, no change** | No new command, dependency, env var or gate |
| `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` | **Reviewed, no change** | No process or agent-behaviour change |

## Options considered

**A. Status quo.** Rejected: the binder order is not expressible.

**B. Nested grouping.** Rejected: up to 80 headers on a 100-card list; three pinned tiers eat a phone viewport; it erases the grouping-is-not-sorting boundary at [`RefineSheet.jsx:93-97`](../../src/components/RefineSheet.jsx#L93-L97); and `groupCards`' flat-section contract plus every caller would change.

**C. Single-select sort with Element and Set added.** A tenth of the work, two of three tiers. Rejected on review concurrence: cannot express Element → Rarity → Name.

**D. Collapse group and sort into one ordered key list.** Purest model; rejected - hides grouping behind a toggle, rewrites both sheets, no user-visible gain over E.

**E. Recommended: one grouping level, ordered sort stack, Lists only.** Codex's r1 counterproposal, adopted: the tester's criteria are met by the List, while the ALL grid's progressive render, rails and large-grid performance carry risk without requirement. Parity becomes a separately approved follow-up.

## Proposed design

**Grouping is unchanged.** One level, single-select.

**Sort becomes an ordered stack**, `[{key, dir}]`, rendered with `SortRow`. Direction moves out of the key name, so `Name A-Z` and `Name Z-A` collapse into one `Name` row with a flip.

The tester's request is then literally: **Group by Set · Sort: Element, Rarity, Name.**

### `asc` means one thing everywhere

Revision 2 contradicted itself: it set `added: defaultDir 'desc'` while defining ascending timestamps as newest-first. Corrected - **`asc` is always the natural forward order of the underlying value**:

| Key | `asc` means | `defaultDir` | Resulting first-tap behaviour |
|---|---|---|---|
| `name` | A → Z | `asc` | A → Z |
| `element` | palette forward: Air, Earth, Fire, Water, Multi, Neutral | `asc` | palette forward |
| `rarity` | scarcity forward: Ordinary → Unique | `asc` | Ordinary first |
| `added` | oldest → newest | **`desc`** | **newest first** |

Direction and default are now independent and non-contradictory: `added` sorts oldest-to-newest when ascending, and its option simply *defaults* to descending so the label tells the truth on first tap.

### The reducer fails closed

```js
// Takes the OPTION, not a key. There is no lookup, therefore no lookup failure,
// therefore no silent fallback to ascending.
toggleSort(stack, option) -> stack
```

The sheet already has the option object in hand when it renders the row, so passing it costs nothing. An option whose `defaultDir` is not exactly `'asc'` or `'desc'` is **rejected - the tap is ignored and the stack is returned unchanged** (and it throws in dev builds). Ascending is never substituted. This closes the path my own self-critique flagged in r2, by deleting the path rather than testing it.

### Comparators are a registry, not descriptive metadata

Revision 2's `order: 'palette'` string was decorative - nothing consumed it, so it was a drift surface. Removed. Option shape is now `{ key, label, defaultDir }`, and comparison lives in a private per-module registry keyed by `key`:

```js
const LIST_KEY_CMP = { name, element, rarity, added };   // collectionFilter.js, not exported
```

An **exhaustiveness test** asserts every option key has a registry entry and every registry entry is claimed by an option, so adding a key without a comparator (or vice versa) fails the gate rather than falling back at runtime.

Deck Add Cards keeps its existing `KEY` map at [`deckRepository.js:396-402`](../../src/store/deckRepository.js#L396-L402) - a second registry over precomputed row fields - with its own exhaustiveness test against `DECK_SORT_OPTIONS`. Two registries, because the two surfaces sort different row shapes; one shared *reducer* and one shared *option contract*, because those are genuinely common.

### The complete ordering chain

Revision 2 dropped the implicit alphabetical tie-break that every current comparator has. Restored, and specified in full:

1. **Selected keys**, in priority order, each with its own direction.
2. **Implicit Name ascending** when the selected keys tie. (A no-op when Name is itself selected, since a tie there means the names are equal.)
3. **Stable row identity** as the final total-order tie-break.

So selecting only Rarity leaves each rarity run alphabetical - today's behaviour, now criterion 4. Step 3 also covers Recently-added rows with equal or absent timestamps.

**Identity reuses the established contract**, not a new one: the List's own `rowKey` ([`Collection.jsx:1885`](../../src/pillars/Collection.jsx#L1885)) - `card_id` for custom lists, `item_id` (`card_id|variant_slug`) for the Wishlist, matching the repository's collector-item grain.

### Absence buckets, enumerated

- **Element ascending:** Air, Earth, Fire, Water, Multi, Neutral, then unrecognised values last.
- **Rarity ascending:** Ordinary, Exceptional, Elite, Unique, then unknown/missing, then **Avatar dead last** - preserving `rarityRankFor`'s two distinct tail buckets.
- **Descending reverses only the known ordered values.** Tail and absent buckets stay last, in their existing relative order (unknown before Avatar), in both directions.
- **Timestamp blanks stay last** in both directions.
- **Rows tied inside a tail bucket continue to the next key**, then Name, then identity.

Implementation follows from that statement: each key comparator classifies a value as known or tail; known-versus-tail always orders tail last regardless of direction; only known-versus-known is inverted by `desc`; tail-versus-tail compares ascending and, when equal, returns zero so the chain continues.

**Compatibility.** `stackComparator([])` = Name ascending, today's default. `normaliseSort` maps legacy values preserving direction:

| Legacy | Normalised | Preserves |
|---|---|---|
| `name` | `[]` | Name ascending (the default) |
| `name-desc` | `[{name, desc}]` | Z to A |
| `rarity` | `[{rarity, asc}]` | Scarcity forward |
| `element` | `[{element, asc}]` | Palette forward |
| `added` | `[{added, desc}]` | **Newest first** |

## Implementation plan

1. **Comparator core.** `stackComparator`, `normaliseSort`, `LIST_SORT_OPTIONS` and the private `LIST_KEY_CMP` registry in `collectionFilter.js`. *Checkpoint: `test:query` green; tests cover every legacy mapping, `defaultDir` on add, flipped direction, all absence buckets in both directions (including Avatar-last and unknown-before-Avatar), the three-step chain including implicit Name on a single non-name key, shuffle-stability with `rowKey` identity, two same-name Wishlist printings at standard and foil, and registry exhaustiveness.*
2. **Shared contract + reducer.** Migrate `DEFAULT_SORT_KEYS` → `DECK_SORT_OPTIONS` (option objects, all `defaultDir: 'asc'`), migrate `RefineSheet`'s tuple-destructuring renderer, extract `toggleSort`/`flipSort` into a pure module taking the option object, add the deck-side exhaustiveness test. *Checkpoint: characterisation tests drive the reducer with the **actual exported** `DECK_SORT_OPTIONS`; Deck Add Cards ordering identical before and after (criterion 7); `test:ui` green.*
3. **List Arrange adopts the stack.** Chips → `SortRow`; `listComparator` → `stackComparator` with `rowKey` as `identityOf`; FAB badge → `group + stack.length`. *Checkpoint: criteria 1-4 on device with a real mixed list, including "Recently added" proving newest-first, a flip proving untimestamped rows stay last, and a Rarity-only stack proving alphabetical runs.*
4. **Docs.** Feature matrix row; `DESIGN_SYSTEM.md` per the classification table above; supersede note in `list-arrange.md`.

Increments 1-2 are invisible to users; 2 is behaviour-preserving by contract and by test. Increment 3 alone satisfies the tester.

**Follow-up, separately proposed:** Collection refine parity, carrying its own acceptance scope for `sortActive`, the two rail gates, progressive render at scale and an ALL-view performance gate. Its rail gate should show the rail when grouping is none **and the stack is empty or its *leading* key is Name ascending** - trailing keys only order equal names and cannot break letter monotonicity. Tests: leading Name, trailing Name, Name descending.

## Data migration and compatibility

**Not applicable, with justification.** No table, column, index or export format is touched, and no arrangement state is written to disk: `collectionSession` is in-memory and reset wholesale on profile change. The only shape changes are React state values and an in-memory session mirror, both re-derived from defaults on launch. `normaliseSort` preserves *semantics* (notably newest-first) across the shape change and covers the single-run legacy-string case in a hot-reloaded dev build.

## Rollback and recovery

Code-only: `git revert` of any increment is complete recovery, no data to repair, no point of no return. Increments 1-2 are dormant additions with no user-facing caller - except increment 2's Deck Add Cards migration, whose blast radius is one surface's sort order, guarded by characterisation tests and revertable alone. Worst realistic case is a wrong *order* on screen, corrected by reopening Arrange.

## Verification plan

- **Automated:** the increment-1 and increment-2 tests above; both registry exhaustiveness tests; the `renderSignature` characterisation test (no production edit). Full gates: `test:codex`, `test:query`, `test:ui`, `test:app`, `check:types`, `check:cycles`, `check:source`, `check:docs`, `build`. `check:smoke` pre-merge on device.
- **Manual, on device:** the tester's case - Group by Set, Sort Element → Rarity → Name - read against expected binder order. Then: Rarity alone, confirming alphabetical runs; "Recently added" newest-first; flip it and confirm oldest-first *with untimestamped rows still last*; a list containing an avatar, confirming it sorts last under Rarity in **both** directions; remove a middle key; clear.
- **Regression:** Deck Add Cards sort identical (criterion 7). Codex card filters still show no Arrange toggle. Collection refine and both A-Z rails untouched. Selection, steppers and hearts still act on the right row after re-arranging. Two Wishlist printings of one card keep a stable order across re-renders.
- **Accessibility:** `SortRow`'s flip button has `aria-label`; the numbered badge must expose its priority to a screen reader, not convey it by glyph alone.
- **Zero-image mode** for section rendering.

## Security, privacy, performance, and operations

No new data, no network, no logging, no telemetry, no permissions, no native surface, no deployment implication. Arrangement is ephemeral UI state.

Performance: at most four chained comparisons per pair on a sort that already runs, over a single list's rows. The comparator is built once per arrangement in a `useMemo`; extractors allocate nothing. The large surface (ALL view) is out of scope and its performance gate moves with it.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|
| Increment 2 silently changes Deck Add Cards ordering | Low-medium | High - regresses a shipped surface for a feature it does not use | All deck keys default `asc`, matching today's hardcode; characterisation tests against the actual exported options; revertable alone | Claude |
| A key's direction contradicts its label | Low with the corrected contract | High | `asc` defined uniformly; `defaultDir` per option; reducer fails closed; per-key tests | Claude |
| Flipping a key floats absent values to the top | Low | Medium | Tail buckets ordered outside the inversion; enumerated buckets tested in both directions | Claude |
| Wishlist rows sharing a name shuffle between renders | Low | Medium | `rowKey` identity as terminal tie-break; same-name standard/foil test | Claude |
| Tester still wants labelled inner tiers | Medium | Low | Run dividers remain a follow-up, scoped to categorical keys | Owner |

**Open questions:** none blocking.

## Self-Critique

**The strongest case that this is wrong.** Unchanged and still real: the tester asked for three levels of *grouping* and gets one level plus ordering. If he navigates by scanning headers rather than cards, he will ask for headers again. The batch is now small enough that adding dividers later is not a rewrite, which is the honest mitigation - not that I am confident, but that being wrong is cheap.

**What three review rounds have actually exposed about my work.** Every finding has been the same species: I reason about code by its *description* rather than its *behaviour*. r1 - I called `renderSignature` broken without reading its `JSON.stringify`, and asserted session-backing for a surface that initialises locally. r2 - I wrote a direction contract whose own two paragraphs contradicted each other, and dropped a name tie-break that sits on the line above the comparator I quoted. r3 - I described the sole stack consumer as "Codex/Decks" when `RefineSheet`'s own comment says Codex supplies neither. The proposal is now correct where it has been checked; the rational inference is that it is still wrong where it has not been. The parts no reviewer has yet executed are the absence-bucket rules and the three-step chain, and those are prose about comparator behaviour - precisely the genre in which I have erred three times.

**Hidden coupling.** Increment 2 is now the riskiest step, and it grew in this revision: migrating `DEFAULT_SORT_KEYS` and the tuple-destructuring renderer touches a shipped surface (Deck Add Cards) that gains nothing from this feature. I have argued it is behaviour-preserving because all four deck keys default ascending. That argument is only as good as the claim that nothing else destructures those tuples, which I have grepped but not exhaustively proven across prop drilling.

**Simpler alternative I am not taking.** Option C remains a defensible landing spot at a tenth of the work and without touching Deck Add Cards at all. A reviewer who weighs the increment-2 blast radius heavily could reasonably prefer it.

**Failure most likely to escape tests.** No longer the direction default - the reducer now fails closed, which removes the path instead of testing it. The new candidate is the absence-bucket rule under `desc`: "reverse only the known values, keep tails last, preserve unknown-before-Avatar". A comparator that inverts its whole result passes any test whose fixture happens to lack an avatar or a null, and every list in casual testing lacks both. The mitigation is a fixture that deliberately contains an avatar, a rarity-less card and an untimestamped row, asserted in both directions - and the device check on a real list containing an avatar.

**Evidence that would change the decision.** The tester wanting labelled tiers reopens run dividers for categorical keys. Any measurable Deck Add Cards regression in increment 2 sends me back to a List-local comparator with no shared extraction.

## Approval record

- **Owner:** shape approved verbally - "grouping is not a sort though, so you'd group by set and then stack the sorts". Owner decision on r1: **defer run dividers**; any future divider proposal covers categorical leading keys only (Element, Rarity, Set), never Name or timestamps. Formal approval of r3 pending.
- **Reviewer (Codex), r1:** Changes required - six findings, all accepted and addressed in r2.
- **Reviewer (Codex), r2:** Changes required - all six r1 findings confirmed resolved; List-only scope split approved; five new findings, all accepted and addressed here:
  1. *Major, direction semantics contradict and fail open* - `asc` defined uniformly as natural forward order; `added` defaults `desc` to yield newest-first without redefining `asc`; reducer takes the option object and fails closed; invalid `defaultDir` rejected, never substituted; descriptive `order` metadata replaced by comparator registries with exhaustiveness tests.
  2. *Major, terminal chain omits the alphabetical tie-break* - three-step chain specified (selected keys → implicit Name ascending → identity), added as acceptance criterion 4.
  3. *Minor, extraction touches more than the reducer* - increment 2 rewritten as an option-object migration of `DEFAULT_SORT_KEYS` and `RefineSheet` rendering; "Codex/Decks" corrected to **Deck Add Cards** throughout; behaviour-preservation added as criterion 7 with characterisation tests against the actual exported options.
  4. *Minor, absence buckets* - enumerated exactly, including Avatar dead last as a bucket distinct from unknown, and descending reversing only known values.
  5. *Minor, use the established identity* - `rowKey` reused; the invented `card_id|set|variant_slug` withdrawn as novel and redundant.
  6. *Minor, "app-wide idiom" overstates* - DESIGN_SYSTEM disposition now records List Arrange and Deck Add Cards, with Collection-refine parity explicitly deferred.
- Implementation has not started.
