# Collection v11 - Add and Wishlist surfaces think in collector items

**Status:** Design + implementation brief, awaiting adversarial review (Codex) and owner approval.
**Scope:** UI and pure-helper layers only. The v11 storage model, the want writers, and the
serialisation chains are settled and reviewed; nothing in this brief changes
`owned_cards`, the repositories' write semantics, or the schema.
**Change class:** Standard (multi-surface UI redesign, no schema change). Invariants touched:
none structurally; durable offline-first writes and transactional user-data operations are
preserved because every write in this design goes through the existing
`queueWantWrite` / `enqueueWrite` chains and existing repository writers.

---

## 1. Problem restatement

Schema v11 made the want grain **collector item = card_id + set + finish** (`001`, `001:f`,
`002`, `002:f`, `uncategorised`, `uncategorised:f`). The backend stores, serialises, and reads
that grain correctly. The ADD and WISHLIST surfaces still present the card-name grain, and on
device that produced five concrete failures:

1. **Search results are one row per card.** There is no way to express "the Beta one" at the
   moment of selection. A card in Alpha and Beta renders one row, and the printing question is
   deferred to an after-the-fact modal.
2. **The query's set intent is thrown away by the add.** `set:beta` filters which cards appear
   (`cardQuery.js` builds an opaque predicate; `AddCardsSheet` applies it as a post-filter) but
   the add path (`ListDetail.addStep` -> `wantTarget`) never sees it. So `set:beta` -> Select
   all -> Add asked "which printing?" for every multi-set card in the result.
3. **Batch disambiguation is per-card and modal.** The `addPick` FIFO feeds
   `WantPrintingSheet` one card at a time. At N = 402 that is 402 sequential modals, each also
   presenting a foil toggle, with no way to abandon the remainder except force-quitting the app.
4. **The wishlist item sheet re-asks the set.** Tapping an "Albespine Pikemen - Alpha" row calls
   `onPeek(c.card_id)` with no set, so `CollectionCardSheet` mounts name-level and renders the
   printing SegTabs picker for a row whose printing is already decided.
5. **Wishlist rows collapse finish.** A row's status line reads "1 of 5 wanted" with no
   indication of how that splits between non-foil and foil, even though the ledger stores them
   as separate items.

## 2. The interaction model

### Principles

- **P1 - A row is a collector item, not a card name.** Wherever the user picks something to
  want, the thing on screen already carries `card_id + set`, and finish is carried by the
  surface's declared finish mode. Selecting a row selects the printing. There is no
  "which printing?" follow-up for anything the user picked off a row.
- **P2 - The query scopes the rows, and the rows ARE the intent.** `set:beta` does not merely
  filter cards; it filters *printings*. After it, only Beta rows exist, so Select all -> Add
  files Beta items directly. Set intent is never re-asked because it never left the selection.
- **P3 - Finish is a mode, never a question.** Non-foil is the product default (§7.4,
  `DEFAULT_WANT_FOIL`). Foil is an explicit toggle the user turns on before adding - one
  deliberate act that governs the adds that follow, not a per-card prompt.
- **P4 - Questions only for genuinely unknowable batches, answered once.** The only remaining
  ambiguous path is text import (a pasted name list has no printings). Its remainder resolves
  in ONE checklist sheet with apply-to-all controls, dismissible at any time, committing only
  on confirm.
- **P5 - A surface opened AT an item never re-asks what the item is.** The set pill replaces
  the set picker whenever the entry point already named the printing.

### Per surface, in one line each

- **AddCardsSheet (wishlist mode):** per-printing rows with set pills; a sheet-level Foil
  toggle; every add writes an exact item.
- **Batch resolver:** one checklist sheet for the text-import remainder; "set for all" +
  "finish for all" + per-row override; Cancel always available; commit is one action.
- **Wishlist detail:** one row per (card, set) showing non-foil and foil want counts
  distinctly; tapping a row opens the card sheet AT that set.
- **CollectionCardSheet:** picker only when opened name-level on a multi-set card; heart is
  the non-foil want toggle for the printing on show; foil want shown as a distinct mark.

## 3. Per-surface specification

### 3.1 AddCardsSheet - per-printing rows and direct filing

`AddCardsSheet` gains a `grain` prop: `'card'` (default, unchanged - custom lists stay
card-grain because a `card_list_entries` row means "any printing", see `ANY_PRINTING` in
`printings.js`) or `'item'` (the Wishlist passes this).

#### Row expansion (item grain)

The pool query is unchanged (`getPool({ q: parsed.name })`, token cards filtered, clauses
post-applied). A new pure helper then expands each card into one row per printing:

```
expandItemRows(cards, setTerms) ->
  [{ card, set: '002', setName: 'Beta', key: `${card_id}|002` }, ...]
```

- One row per entry in the card's `sets` JSON, ordered by `setRank`.
- `setTerms` is the new channel from `parseQuery` (see build plan item 1): the raw values of
  every `set:` / `s:` token. When non-empty, a printing row survives only if
  `"${code} ${name}"` matches a term with the same `cqText` semantics the clause uses today
  (codes alp/bet/art/got/dra/pro and names both keep working). The card-level `set:` clause
  is redundant in item grain and is skipped there to avoid double filtering with subtly
  different semantics; all other clauses still apply per card.
- A card whose `sets` array is empty produces one **refusal row** (see §4).

#### Row layout

```
+--------------------------------------------------------------+
| [art] Frontier Settlers                            [+ Add]   |
|       (ALPHA)  want 2                                        |
+--------------------------------------------------------------+
| [art] Frontier Settlers                            [+ Add]   |
|       (BETA)   want 1 · ✦ 1                                  |
+--------------------------------------------------------------+
```

- Name line unchanged. Second line: the set pill (`listSetPill` style, always shown in item
  grain, including single-set cards - consistency is what teaches the grain), then this
  item's membership: `want N` (gold mono, `var(--gold-num)`) when the non-foil item has a
  want, `✦ N` when the foil item does. Both may appear.
- Membership is keyed per item: the Wishlist hands the sheet its item-keyed goal map
  directly (`${card_id}|${canonical slug}`), not the card-collapsed `cardMembership` memo.
  The `cardMembership` memo in `ListDetail` remains only for `grain='card'` callers.
- The row's inline stepper (Frost - / count / +) appears when the row's item in the
  **current finish mode** has a count > 0; otherwise the `+ Add` pill. `onStep` becomes
  `onStep(card, delta, item)` where `item = { set: row.set, foil: finishMode }` - always
  resolved, never null, in item grain.

#### The Foil toggle

Header line, item grain only:

```
| Search the library - e:water set:beta…        [input]        |
|  128 printings            [ Foil ✦ ]  [ Select ]             |
```

- A real `<button>` with visible text `Foil ✦`, `aria-pressed`, sitting left of Select.
  Off: ghost treatment (`var(--ink-muted)` text, `var(--hair-16)` border). On: filled gold
  (`var(--gold-leaf)` background, ink text) - same on/off grammar as the finish toggle in
  `WantPrintingSheet`.
- Resets to off every time the sheet opens. Foil is a deliberate act each session.
- While on: every add (single `+ Add`, stepper, and batch commit) targets the foil item;
  the count line reads `128 printings · adding foil`; the batch button reads
  `Add N foil cards`.
- The count line says `N printings` in item grain (`N cards` stays in card grain).

#### Selection, Select all, Add

- Selection is keyed by row key (`${card_id}|${set}`), storing `{ card, set }`. Two
  printings of one card are two independent checkboxes.
- `Select all · N` selects every shown printing row (refusal rows excluded). With
  `set:beta` active the shown rows are exactly the Beta printings, so this is "everything
  in Beta" by construction - the headline failure cannot occur because there is nothing
  left to ask.
- Commit: one optimistic state write for the whole batch (a single `applyGoal` pass -
  402 separate map clones and re-renders is jank we do not need), then one
  `persist(rowKey, +1)` per item on its existing per-card `queueWantWrite` chain.
  `addStep` is called with the row's item, so it takes the `item != null` path and never
  consults `wantTarget` - the FIFO is unreachable from this surface.
- Toast (exact strings, via the existing `batchAddSummary` shape but item-grain adds can
  no longer produce `choice-required`):
  - all applied, non-foil: `Added 402 cards`
  - all applied, foil mode: `Added 12 foil cards`
  - with refusals present: `Added 400 cards · 2 had no printing listed`
  - single `+ Add` taps stay toast-silent; the inline count is the feedback (unchanged).

#### What `set:beta -> Select all -> Add` now does, end to end

1. `parseQuery` returns `setTerms: ['beta']` and no name needle.
2. Expansion yields one row per Beta printing - 402 rows, each already `card_id + '002'`.
3. Select all marks 402 rows; Add writes 402 non-foil Beta items (`002`), one toast:
   `Added 402 cards`. Zero questions. The sheet stays open, counts now show `want 1`.

### 3.2 Batch resolution - the checklist for a genuinely ambiguous remainder

Ambiguity can now arise only where no printing was ever on screen: **Add from text**
(`ListBulkAddSheet` -> `addStep(card, qty)` with `item = null`). Single-card asks from the
card sheet's heart keep the existing single `WantPrintingSheet` (it is the right size for
one card). The FIFO-of-modals for batches is replaced.

New sheet: `ResolvePrintingsSheet` (mounted by `ListDetail` where the `WantPrintingSheet`
FIFO mount sits today). It receives the ENTIRE pending queue at once, not the head.

```
+--------------------------------------------------------------+
|                     CHOOSE PRINTINGS                         |
|   25 cards were printed more than once. Pick a set for       |
|   all of them, then adjust any card below.                   |
|                                                              |
|   SET FOR ALL      [ Alpha ] [ Beta ] [ Promo ]              |
|   FINISH FOR ALL   [ Non-foil ] [ Foil ]                     |
|   ------------------------------------------------------    |
|   Albespine Pikemen              ×4    [Alpha][Beta]         |  ^
|   Frontier Settlers              ×2    [Alpha][Beta]         |  | scrolls
|   Sacred Scarabs                 ×1    [Alpha][Beta][Promo]  |  v
|   ...                                                        |
|   ------------------------------------------------------    |
|   [ Cancel ]                [ Add 25 cards ]                 |
+--------------------------------------------------------------+
```

Behavior, exactly:

- **SET FOR ALL** lists the union of the queued cards' set codes, `setRank` order. Tapping
  `Beta` sets every row's choice to Beta **where the card is printed in Beta**; rows not
  printed in Beta keep their current choice and stay visually unresolved if they had none.
  The button's pressed state shows only while every resolvable row agrees with it.
- Rows start **unchosen** (no silent default set - defaulting is the original v10 defect).
  The confirm button is disabled with the count of unresolved rows in its label
  (`Choose a set for 3 more`) until every row has a choice. With one "set for all" tap
  covering every card (the common case - a batch from one binder), confirm enables
  immediately: two taps total for 400+ cards.
- **FINISH FOR ALL** is a display of the batch finish, default Non-foil, applying to every
  row. Per-row finish override is deliberately NOT offered - a mixed-finish paste is two
  pastes. This matches P3: one deliberate act.
- Per-row segmented set control (`SegTabs`, same as `ImportTextSheet`'s review step - the
  existing prior art for exactly this) for the cards the bulk choice did not fit.
- Quantities are carried per entry from the queue (`entry.delta`) and shown (`×4`); the
  commit replays each with its original quantity - the dropped-quantity bug class stays
  fixed (see `addPickQueue.js` header).
- **Exits.** Cancel button, backdrop tap, and hardware back all close the sheet at any
  time. Closing commits nothing from the checklist; the unambiguous part of the paste was
  already applied before the sheet opened. Toast on dismiss: `25 cards skipped`. There is
  no state in which the user is trapped: one gesture always leaves.
- **Commit.** One button applies all rows: single optimistic state pass, per-card persists
  on their chains (same mechanics as §3.1 commit). Toast: `Added 25 cards` (or
  `Added 25 foil cards`).
- The pre-sheet toast from the paste keeps `batchAddSummary`'s honest split:
  `Added 12, choose printings for 25 more`.
- Scroll container: an inner `div` with `max-height` + `overflow-y: auto` (the
  `ImportTextSheet` pattern). The animated sheet element itself never carries the scroll -
  the Android WebView transform + overflow rule.

### 3.3 Wishlist detail - rows carry set once and finish twice

`wishlistCards()` already returns one row per collector item with `item_id`, `set`, `foil`,
`quantity`, `owned`. The display layer groups those items by `(card_id, set)` via a new pure
helper:

```
groupWishlistDisplayRows(items) ->
  [{ key: `${card_id}|${set}`, card, set,
     nf:   { itemId, want, owned } | null,
     foil: { itemId, want, owned } | null }]
```

Sorted by name, then `setRank(set)` (uncategorised bucket last). React keys use the group
key - two finishes of one printing are ONE row; two sets of one card remain two rows.

#### Row layout (read mode)

```
+--------------------------------------------------------------+
| [thumb] Albespine Pikemen                             WANT   |
|         (BETA)  1 of 3 wanted · ✦ 0 of 2 foil           3+2✦ |
+--------------------------------------------------------------+
| [thumb] Frontier Settlers                             WANT   |
|         (ALPHA)  2 of 2 wanted · COMPLETE                2   |
+--------------------------------------------------------------+
```

- Set pill: the group's set (`SET_LABEL[set]`), or `Uncategorised` for migration leftovers.
  The pill names the set ONLY - finish never rides on the pill any more (today's
  `printingLabel` emits `Beta · Foil`; that string retires with the per-item rows).
- Status line: non-foil first, always, when an NF want exists: `{owned} of {want} wanted`.
  Foil appended only when a foil want exists: `· ✦ {owned} of {want} foil` with the ✦ in
  `var(--gold-num)`. A group with only a foil want shows just `✦ 1 of 2 foil wanted`.
  COMPLETE (jade) appears when every existing finish target on the row is met.
- Right rail figure: `3` for NF-only; `3 +2✦` when both exist (`+2✦` smaller, gold); `2✦`
  for foil-only.

#### Row layout (edit mode)

```
| [thumb] Albespine Pikemen        WANT          FOIL ✦        |
|         (BETA) 1 of 3 · ✦ 0 of 2  [-] 3 [+]    [-] 2 [+]     |
```

- The NF stepper (labeled WANT, ruby label as today) edits the NF item:
  `stepWantedForItem(cardId, { set, foil: false }, delta)` through `queueWantWrite` -
  exactly the current `persist` path with the item taken from the group, not from a
  card-level guess.
- A second, visually secondary stepper (labeled `FOIL ✦`, gold label) renders **only when
  a foil want already exists** on the group. Creating the first foil want is not this
  row's job (P3 - it happens in the add sheet's foil mode or the card-sheet ask's finish
  toggle); stepping an existing one to adjust or clear it is.
- Stepping either finish to 0 removes that finish from the group (below the existing
  remove-confirm rule: the last step below 1 on the LAST remaining finish of the row asks
  the remove confirm, same as today's floor-at-1 behavior, applied per row not per item).
- Uncategorised groups: steppers route through the card-level writers
  (`stepWanted` / `setWanted`) exactly as `persist` does today for a null set.

#### Opening a row

`onPeek(card.card_id, group.set)` for a real set - the card sheet mounts scoped and shows
the pill, not the picker (this machinery already exists: the `set` prop). Uncategorised
groups call `onPeek(card.card_id)` (name-level; triage is where those resolve). This is
the entire fix for failure 4 - one argument that is currently dropped.

### 3.4 CollectionCardSheet - when the picker appears, and what the heart means

Picker visibility (mostly existing behavior, now stated as the contract):

| Entry condition | Top slot |
|---|---|
| Opened with `set` prop (wishlist row, set drill tile, scanner filing) | `SetPill` - never SegTabs |
| Name-level open (Codex, search, Overview), card in ONE set | `SetPill` |
| Name-level open, card in 2+ sets (or owned uncategorised copies exist) | `SegTabs` printing picker |

The heart (`Wishlist` action):

- Reflects and toggles the **non-foil want of the printing on show** (already true post-v11:
  `heartItem = { set: effSet, foil: false }`).
- Opened AT an item: the heart writes that item directly. `wantTarget` receives the scoped
  set and returns `kind: 'item'` - the `WantPrintingSheet` is unreachable from a scoped open.
- Name-level on a multi-set card with no explicit segment tap: heart opens the single-card
  `WantPrintingSheet` (unchanged - one card, so one small sheet is proportionate; its
  finish toggle remains the card sheet's foil-want opt-in for the ask case).
- New: a small foil marker on the Wishlist button when the shown printing's FOIL item has
  a want - the button label row gains `✦` in `var(--gold-num)` after the word `Wishlist`,
  with accessible text `Wishlist, foil wanted` on the button. Display only; the heart
  itself still toggles the NF item, and clearing a foil want happens on the wishlist row's
  foil stepper. (Read `wantedItemsForCard` - already fetched - for
  `canonicalPrinting(effSet, true)`.)

## 4. Edge cases

- **Single-set cards.** One row in the add sheet (with its pill); heart resolves silently
  (`wantTarget` single-set branch). Never asked, anywhere.
- **Catalog-unknown cards** (`sets` empty). The add sheet renders one dimmed,
  non-interactive row: name at `var(--ink-faint)`, tag `NO PRINTING LISTED` in place of the
  pill, no `+ Add`, excluded from Select all and from the count line. An honest item cannot
  be constructed, so nothing offers to construct one (the repository would throw anyway).
  The card sheet heart keeps its existing warn toast:
  `The catalog does not list a printing for this card`.
- **Foil-only printings.** The catalog does not model finish availability per printing
  (variant slugs mark scan type, not finish), and the want model deliberately allows either
  finish on any printing. No surface pretends to know a printing has no non-foil form;
  nothing to build here, stated so the reviewer does not go looking.
- **Uncategorised wants from migration.** Never creatable by these surfaces (P4;
  `requireResolvedSet` throws). Displayed as an `Uncategorised` group in the wishlist,
  editable via card-level writers, resolved in triage (To Be Categorised). The add sheet
  never shows an uncategorised row because expansion only walks catalog sets.
- **Empty states.** Add sheet, no matches, set term active:
  `No printings match set:{term} - check the set name or code`. No matches otherwise:
  `No cards match` (unchanged). Wishlist empty state unchanged. Resolver sheet with an
  empty queue never opens (mount condition `queue.length > 0`, as today).
- **402-scale batches.** One state pass, one toast; persists drain on per-card chains as
  they do for text import today. If write-queue latency at 400+ proves noticeable on
  device, a transactional `addWantedItemsBulk` (mirroring `importCollectionResolved`) is
  the named follow-up - flagged, not assumed.

## 5. Build plan

Ordered, each increment shippable and reviewable alone. Store-layer changes are flagged.

1. **`src/store/cardQuery.js` - expose set intent.** [store] `parseQuery` additionally
   collects the raw values of `set:` / `s:` tokens into `parsed.setTerms: string[]`
   (clauses unchanged, so every existing consumer is untouched). Unit tests: codes, names,
   quoted values, multiple set tokens.
2. **`src/store/printingRows.js` - pure expansion.** [store, new file]
   `expandItemRows(cards, setTerms)` and the refusal-row predicate. Uses `cqText`-style
   matching (export the matcher from cardQuery rather than duplicating it) and `setRank`.
   Unit tests: multi-set unpack, set-term collapse, empty-sets refusal row, dedupe of a
   doubled catalog set entry.
3. **`AddCardsSheet` item grain** (`src/pillars/Collection.jsx`). `grain` prop; per-printing
   rows, set pills, item-keyed membership and selection; Foil toggle; `onStep(card, delta,
   item)`; batch commit as one optimistic pass (new `addBatch` beside `addStep` in
   `ListDetail`, sharing its persist path); toast strings from §3.1. Wishlist `ListDetail`
   passes `grain='item'` and the item-keyed map; custom lists pass nothing and behave
   exactly as before.
4. **Batch resolver.** [store, new file] `src/store/batchWantPlan.js`: pure plan for the
   checklist (union of set options, apply-to-all where printed-in, per-row choice,
   unresolved count, commit list with original deltas). New
   `src/components/ResolvePrintingsSheet.jsx` rendering it (§3.2). `ListDetail` routes the
   text-import remainder to it (the `addPick` queue fills as today, the sheet consumes it
   whole); the per-card FIFO mount of `WantPrintingSheet` in `ListDetail` is removed.
   `WantPrintingSheet` remains solely the card sheet's single-card ask.
5. **Wishlist rows.** [store, new file] `src/store/wishlistRows.js`:
   `groupWishlistDisplayRows`. `ListCardRow` gains the twin-finish status line and the
   conditional foil stepper; `ListDetail` keys rows by group, maps stepper callbacks to
   exact items, and passes `group.set` to `onPeek`. Remove `printingLabel`'s
   finish-on-the-pill string.
6. **`CollectionCardSheet` foil marker** - the ✦ on the Wishlist button plus its
   accessible name; no behavior change to the heart.
7. **Copy, gates, docs.** Zero-image mode pass over the new rows; `npm run test:codex`,
   `test:query`, `test:app`, `check:types`, `check:cycles`, `build`, `check:docs`;
   `COMPENDIUM_FEATURE_MATRIX.md` (Collection add/wishlist rows) updated - the data model
   document needs no change because storage is untouched.

Dependencies: 3 needs 1 and 2; 4 and 5 are independent of each other; 6 is independent.
Increments 1 and 2 are pure and land without visible change.

## 6. Open questions for the owner

1. **Card sheet foil affordance.** This brief keeps foil-want creation out of the card
   sheet (add-sheet Foil toggle and the single-card ask's finish toggle are the only
   creators; the wishlist row's foil stepper adjusts). Is a direct "want the foil" control
   on the card sheet wanted, or is the ✦ display marker enough?
2. **Wishlist text export.** `wishlistExportText()` still emits `qty name`, which merges
   finishes and drops the set. Should it become one line per item
   (`3 Albespine Pikemen [Beta]`, `2 Albespine Pikemen [Beta] [Foil]`), keeping plain
   `qty name` for the Curiosa-compatible paths only? Affects the shop-list use case.
3. **Batch write hardening.** Accept per-item queued writes at 400+ scale for now, with
   the transactional bulk writer as a named follow-up - or require the bulk writer in this
   round (it would be the one repository addition)?
