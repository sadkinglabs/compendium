# Collection v11 - Add and Wishlist surfaces think in collector items

**Status:** Design + implementation brief, rev 2. Core model approved by the owner; this
revision folds in the finish-availability correction and three owner rulings, and goes back
to Codex for adversarial review.
**Branch:** `collection-add-flow`, off the schema v11 work.
**Scope:** UI and pure-helper layers, plus **one repository addition** - the transactional
bulk want writer `addWantedItemsBulk` (owner ruling, §3.6). No schema change; every other
write goes through existing writers and the existing `queueWantWrite` / `enqueueWrite`
chains.
**Change class:** Standard (multi-surface UI redesign + one repository writer). Invariants
touched: durable offline-first writes and transactional user-data operations - both
preserved; the bulk writer follows `importCollectionResolved`'s one-transaction,
confirmed-or-nothing discipline.

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
  ambiguous path is text import of lines that carry no printing. Its remainder resolves in ONE
  checklist sheet with apply-to-all controls, dismissible at any time, committing only on
  confirm.
- **P5 - A surface opened AT an item never re-asks what the item is.** The set pill replaces
  the set picker whenever the entry point already named the printing.
- **P6 - Finish follows the catalog.** Each catalog `variants[]` entry carries a `finish`
  field (`"Standard"` or `"Foil"`) alongside its `set`; some printings are foil-only
  (Winter River in Alpha) and some are non-foil-only. A finish is offered ONLY where the
  catalog lists a variant with it, decided by one pure helper:
  `printingFinishes(card, setCode) -> { nonFoil: bool, foil: bool }` (lives in
  `printingRows.js`, reads the card's `variants` JSON). An impossible collector item - a
  non-foil want of a foil-only printing - can never be expressed on any surface, let alone
  written. Fallback: a set listed in the card's `sets` with NO variants entry for it is
  treated as `{ nonFoil: true, foil: false }` - the conservative reading that matches the
  product default and cannot invent a foil that may not exist.
  Every surface below references P6 rather than re-deriving it.

### Per surface, in one line each

- **AddCardsSheet (wishlist mode):** per-printing rows with set pills; a sheet-level Foil
  toggle; every add writes an exact item; rows offer only the finishes their printing has.
- **Batch resolver:** one checklist sheet for the text-import remainder; "set for all" +
  "finish for all" + per-row override, all constrained by P6; Cancel always available;
  commit is one transaction.
- **Wishlist detail:** one row per (card, set) showing non-foil and foil want counts
  distinctly; tapping a row opens the card sheet AT that set.
- **CollectionCardSheet:** picker only when opened name-level on a multi-set card; a split
  want control with one segment per available finish - non-foil primary, foil direct.
- **Text export/import:** wishlist exports one line per collector item
  (`qty name [Set] [Foil]`) and the importer parses the same grammar, so a Compendium
  export re-imports losslessly.

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
  [{ card, set: '002', setName: 'Beta',
     finishes: { nonFoil: true, foil: true },   // printingFinishes(card, set), P6
     key: `${card_id}|002` }, ...]
```

- One row per entry in the card's `sets` JSON, ordered by `setRank`, each carrying its
  `printingFinishes` result.
- `setTerms` is the new channel from `parseQuery` (build plan item 1): the raw values of
  every `set:` / `s:` token. When non-empty, a printing row survives only if
  `"${code} ${name}"` matches a term with the same `cqText` semantics the clause uses today
  (codes alp/bet/art/got/dra/pro and names both keep working). The card-level `set:` clause
  is skipped in item grain to avoid double filtering with subtly different semantics; all
  other clauses still apply per card.
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
| [art] Winter River                                 [+ Add]   |
|       (ALPHA)  ✦ FOIL ONLY                                   |
+--------------------------------------------------------------+
```

- Name line unchanged. Second line: the set pill (`listSetPill` style, always shown in item
  grain, including single-set cards - consistency is what teaches the grain), then this
  item's membership: `want N` (gold mono, `var(--gold-num)`) when the non-foil item has a
  want, `✦ N` when the foil item does. Both may appear.
- **Finish availability on the row (P6):**
  - A **foil-only** printing carries a permanent `✦ FOIL ONLY` tag (gold mono,
    `var(--gold-num)`) beside its pill. Its add ALWAYS writes the foil item, in either
    finish mode - the foil item is the only honest one, and the tag says so before the tap.
  - A **non-foil-only** printing never writes a foil item. While the Foil toggle is ON,
    the row is dimmed (`var(--ink-faint)` name), tagged `NO FOIL PRINTING`, its `+ Add`
    is removed, and Select all skips it. Foil mode is a narrow explicit intent; silently
    downgrading it to non-foil would betray the mode, so the row opts out instead.
  - The asymmetry is deliberate: non-foil mode is a *default* that reality may override
    (foil-only rows add foil, visibly); foil mode is a *choice* that reality may refuse
    (non-foil-only rows sit out, visibly).
- Membership is keyed per item: the Wishlist hands the sheet its item-keyed goal map
  directly (`${card_id}|${canonical slug}`), not the card-collapsed `cardMembership` memo.
  The `cardMembership` memo in `ListDetail` remains only for `grain='card'` callers.
- The row's inline stepper (Frost - / count / +) appears when the row's item in the
  **current finish mode** (or the row's only finish, for single-finish printings) has a
  count > 0; otherwise the `+ Add` pill. `onStep` becomes `onStep(card, delta, item)` where
  `item = { set: row.set, foil }` - always resolved, never null, in item grain.

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
- While on: every add (single `+ Add`, stepper, and batch commit) targets the foil item
  where the printing has one (P6 exceptions above); the count line reads
  `128 printings · adding foil`; the batch button reads `Add N foil cards`.
- The count line says `N printings` in item grain (`N cards` stays in card grain).

#### Selection, Select all, Add

- Selection is keyed by row key (`${card_id}|${set}`), storing `{ card, set }`. Two
  printings of one card are two independent checkboxes.
- `Select all · N` selects every shown printing row (refusal rows and finish-incompatible
  rows excluded per P6). With `set:beta` active the shown rows are exactly the Beta
  printings, so this is "everything in Beta" by construction - the headline failure cannot
  occur because there is nothing left to ask.
- Commit: one optimistic state write for the whole batch (a single `applyGoal` pass -
  402 separate map clones and re-renders is jank we do not need), then ONE call to the new
  transactional `addWantedItemsBulk` (§3.6) with the full item list, tracked by the goal
  drain as a single promise. Single `+ Add` taps stay on the per-card `queueWantWrite`
  chains (one gesture, one chain - unchanged). `addStep` is called with the row's item, so
  it takes the `item != null` path and never consults `wantTarget` - the FIFO is
  unreachable from this surface.
- Toast (exact strings; item-grain adds can no longer produce `choice-required`):
  - all applied, non-foil mode: `Added 402 cards`
  - all applied, foil mode: `Added 12 foil cards`
  - non-foil mode including foil-only rows: `Added 402 cards · 3 filed as foil`
  - with refusals present: `Added 400 cards · 2 had no printing listed`
  - single `+ Add` taps stay toast-silent; the inline count is the feedback (unchanged).

#### Result scale and rendering

Per-printing expansion roughly doubles row count, and an empty query in this sheet already
returns the whole catalog - expanded, a few thousand rows in an Android WebView bottom
sheet. The rows keep `content-visibility: auto` + `contain-intrinsic-size` (the technique
the ~780-tile set drill already proves on device), and item grain additionally caps the
RENDERED list at **1,000 printings**:

- Below the cap: everything renders, `Select all · N` covers the full result.
- Above the cap: the first 1,000 rows render (pool order), the count line reads
  `2,431 printings · showing 1,000`, a footer row says
  `Refine the search to see the rest`, and Select all is disabled with the same hint.
  Selection is never allowed to include rows the user could not have seen.

1,000 is chosen because the largest single set expands to well under it, so every
set-scoped workflow (the 402 case) is untouched; only broad or empty queries hit the cap,
and a 2,000-want single tap is a footgun, not a workflow. No virtualization library; the
scrolling container stays transform-free (the sheet's animated element never carries the
scroll - Android WebView rule).

#### What `set:beta -> Select all -> Add` now does, end to end

1. `parseQuery` returns `setTerms: ['beta']` and no name needle.
2. Expansion yields one row per Beta printing - 402 rows, each already `card_id + '002'`.
3. Select all marks 402 rows; Add writes 402 Beta items in one `addWantedItemsBulk`
   transaction, one toast: `Added 402 cards`. Zero questions. The sheet stays open, counts
   now show `want 1`.

### 3.2 Batch resolution - the checklist for a genuinely ambiguous remainder

Ambiguity can now arise only where no printing was ever on screen: **text import of lines
without annotations** (§3.5) via `ListBulkAddSheet` -> `addStep(card, qty)` with
`item = null`. Compendium-origin pastes carry set + finish per line, so they largely skip
this sheet; it remains for foreign and bare `qty name` lists. Single-card asks from the
card sheet keep the existing single `WantPrintingSheet` (right-sized for one card). The
FIFO-of-modals for batches is replaced.

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
|   Winter River          ✦ FOIL ONLY    ×1    [Alpha]         |  v
|   ...                                                        |
|   ------------------------------------------------------    |
|   [ Cancel ]                [ Add 25 cards ]                 |
+--------------------------------------------------------------+
```

Behavior, exactly:

- **SET FOR ALL** lists the union of the queued cards' set codes, `setRank` order. Tapping
  `Beta` sets every row's choice to Beta **where the card is printed in Beta** (and where
  Beta supports the row's effective finish, P6); other rows keep their current choice and
  stay visually unresolved if they had none. The button's pressed state shows only while
  every resolvable row agrees with it.
- Rows start **unchosen** (no silent default set - defaulting is the original v10 defect).
  The confirm button is disabled with the count of unresolved rows in its label
  (`Choose a set for 3 more`) until every row has a choice. With one "set for all" tap
  covering every card (the common case - a batch from one binder), confirm enables
  immediately: two taps total for 400+ cards.
- **FINISH FOR ALL** is the batch finish, default Non-foil, applying to every row it CAN
  apply to (P6):
  - A row whose chosen set is foil-only files as foil regardless, tagged `✦ FOIL ONLY`.
  - With batch finish Foil, a row with no foil printing in any of its sets is tagged
    `NO FOIL PRINTING` and files as non-foil - stated on the row, never silent.
  - A row whose line carried an explicit `[Foil]` annotation (§3.5) has its finish LOCKED
    (✦ shown); FINISH FOR ALL does not alter it.
  - Per-row finish override beyond these cases is deliberately not offered - a
    mixed-finish paste is expressed with annotations, or as two pastes.
- Per-row segmented set control (`SegTabs`, same as `ImportTextSheet`'s review step - the
  existing prior art for exactly this) offering only the card's real sets, for the cards
  the bulk choice did not fit.
- Quantities are carried per entry from the queue (`entry.delta`) and shown (`×4`); the
  commit replays each with its original quantity - the dropped-quantity bug class stays
  fixed (see `addPickQueue.js` header).
- **Exits.** Cancel button, backdrop tap, and hardware back all close the sheet at any
  time. Closing commits nothing from the checklist; the unambiguous part of the paste was
  already applied before the sheet opened. Toast on dismiss: `25 cards skipped`. There is
  no state in which the user is trapped: one gesture always leaves.
- **Commit.** One button applies all rows: single optimistic state pass, then ONE
  `addWantedItemsBulk` transaction (§3.6). Toast: `Added 25 cards` (or
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

- A stepper renders **per finish that already has a want** on the group - never for a
  finish the group does not hold. Creating the first want of a finish is not this row's
  job (P3: the add sheet's finish mode, the card sheet's split control, or the resolver);
  adjusting and clearing an existing one is. This also satisfies P6 by construction: a
  finish the printing cannot have never acquires a want for the row to offer - and if
  imported data ever holds one anyway, the stepper still shows, because removing something
  the user can see must always be possible.
- The NF stepper (labeled WANT, ruby label as today) edits the NF item:
  `stepWantedForItem(cardId, { set, foil: false }, delta)` through `queueWantWrite` -
  exactly the current `persist` path with the item taken from the group, not from a
  card-level guess. The foil stepper (labeled `FOIL ✦`, gold label, visually secondary)
  does the same with `foil: true`.
- Stepping a finish to 0 removes that finish from the group. The remove-confirm rule
  applies per row: the last step below 1 on the LAST remaining finish of the row asks the
  existing confirm sheet.
- Uncategorised groups: steppers route through the card-level writers
  (`stepWanted` / `setWanted`) exactly as `persist` does today for a null set.

#### Opening a row

`onPeek(card.card_id, group.set)` for a real set - the card sheet mounts scoped and shows
the pill, not the picker (this machinery already exists: the `set` prop). Uncategorised
groups call `onPeek(card.card_id)` (name-level; triage is where those resolve). This is
the entire fix for failure 4 - one argument that is currently dropped.

### 3.4 CollectionCardSheet - when the picker appears, and the split want control

Picker visibility (mostly existing behavior, now stated as the contract):

| Entry condition | Top slot |
|---|---|
| Opened with `set` prop (wishlist row, set drill tile, scanner filing) | `SetPill` - never SegTabs |
| Name-level open (Codex, search, Overview), card in ONE set | `SetPill` |
| Name-level open, card in 2+ sets (or owned uncategorised copies exist) | `SegTabs` printing picker |

**The want control** (owner ruling: a direct foil-want control, not a display marker). The
single Wishlist button becomes a split capsule with **one segment per finish the shown
printing actually has** (`printingFinishes(card, effSet)`, P6):

```
Both finishes:   [  ♥ Wishlist   |  ✦ Foil  ]     [ + Add to list ]
Non-foil only:   [       ♥ Wishlist        ]      [ + Add to list ]
Foil only:       [    ♥ Wishlist ✦ Foil    ]      [ + Add to list ]
```

- Each segment is a real `<button>` with visible text and `aria-pressed` - two focusable
  controls inside one visual capsule (`ActionButton` treatment, shared border, a
  `var(--hair-16)` divider between segments). The non-foil segment is primary (wider,
  roughly 2:1). The ✦ renders in `var(--gold-num)` in both states.
- States: each segment independently reflects ITS item's want
  (`wantedItemsForCard` keyed by `canonicalPrinting(effSet, false)` / `(effSet, true)`).
  On = the existing ruby-filled `on` treatment; off = ghost. Both disabled while
  `wantedItems === null`.
- Writes, both segments through the same chain (`queueWantWrite(pid, cardId, ...)`):
  - non-foil on/off: unchanged (`addWantedForItem(cardId, { set: effSet, foil: false }, 1)`
    / the existing `clearWant` path).
  - foil on: `addWantedForItem(cardId, { set: effSet, foil: true }, 1, pid)`.
  - foil off: `setWantedForItem(cardId, { set: effSet, foil: true }, 0, pid)`.
- Gating is identical for both segments: an explicit selection or a scoped open names the
  item (the `explicitSet` rule - an automatic display default is not a choice). Name-level
  on a multi-set card with no explicit segment tap: EITHER segment opens the single-card
  `WantPrintingSheet`, with its finish toggle preset to the tapped segment's finish. Opened
  AT an item, neither segment can ever reach the picker (P5).
- A foil-only printing renders the single `Wishlist ✦ Foil` button bound to the foil item -
  the heart IS the foil want there, because that is the only want that can exist (P6).

### 3.5 Wishlist text - per-item export, symmetric import

Owner ruling: exports carry the collector item, and the importer parses the same grammar,
so export -> import round-trips losslessly. One new pure module,
`src/store/itemLineGrammar.js`, owns BOTH directions (format + parse) so they cannot drift.

#### Line grammar

```
line       := qty SP name (SP annotation)*
annotation := '[' token ']'
```

- `3 Albespine Pikemen [Beta]` - non-foil want, set Beta.
- `2 Albespine Pikemen [Beta] [Foil]` - foil want, set Beta.
- `4 Wild Boars` - bare line, no printing claim (Curiosa-compatible; import resolves it).
- Annotations are trailing bracketed tokens, parsed and stripped from the END of the line
  before name resolution (card names contain no brackets). Import accepts them in either
  order; export always emits set first, then finish.
- `[Foil]` (case-insensitive, at most once) sets finish = foil. Absent = non-foil.
- Any other bracketed token is a set annotation (at most one): matched case-insensitively
  against the set's full name (`Beta`) or numeric code (`002`), via `SET_LABEL`.

#### Import rules (wishlist bulk add path: `ListBulkAddSheet` -> resolver)

A new resolver, `resolveWantList(text)` (beside `resolveCardList` in the store layer),
returns `{ adds: [{ card, qty, item | null, lockedFinish | null }], unknown: [...] }`:

- **Annotated, valid:** set annotation names one of the card's catalog sets AND the finish
  exists for that printing (P6) -> `item` is resolved; `addStep(card, qty, item)` files it
  directly, no resolver sheet.
- **Bare line:** `item = null`; single-set cards resolve silently via `wantTarget`
  (finish non-foil, or foil where the printing is foil-only, P6); multi-set cards queue
  for `ResolvePrintingsSheet`. A bare line NEVER creates an uncategorised want - normal
  adds may not (settled rule); the checklist is the honest path.
- **Unknown set token** (`[Betta]`), or a set the card is not printed in, or a finish the
  printing does not have: the line is NOT dropped and NOT silently downgraded - it enters
  the resolver queue flagged with its reason (`unknown set "Betta"`,
  `no foil printing in Alpha`), and resolves in the checklist among the real options.
- `[Foil]` without a set annotation: the entry's finish is locked foil through resolution
  (`lockedFinish`), shown with ✦ in the checklist; FINISH FOR ALL does not alter it (§3.2).
- Unrecognised names: reported as today (`unknown`), never silently dropped.

#### Export

- `wishlistExportText()` emits one line per collector item, in wishlist row order:
  `3 Albespine Pikemen [Beta]`, then `2 Albespine Pikemen [Beta] [Foil]`. Uncategorised
  wants (migration leftovers) export as bare `qty name` - honest, since they claim no
  printing; on re-import they follow the bare-line rules above (the round-trip for them is
  an upgrade to a resolved item, by design, because writers may not recreate the
  unresolved state).
- Curiosa-facing surfaces (deck export, custom-list export, the missing-cards export) keep
  emitting bare `qty name` - they are card-grain and must stay paste-compatible.
- **Round-trip contract, tested:** for every resolved item, export -> `resolveWantList`
  reproduces exactly `(card_id, set, foil, qty)`. This is a unit test in
  `itemLineGrammar` + resolver tests (build plan item 6).

Compendium-origin pastes therefore carry their printings with them, and §3.2's resolver
becomes a rarity reserved for foreign or hand-typed lists.

### 3.6 The transactional bulk want writer (repository addition)

Owner ruling: built this round. New writer in `src/store/ownedRepository.js`:

```
addWantedItemsBulk(items, pid = activeProfileId())
  items: [{ cardId, set, foil, qty }]
  -> { items: n, copies: m }   confirmed by the transaction, or throws with nothing written
```

- **Validate first, write second:** every item passes `assertRealSetCode` (and qty > 0)
  before any statement is built; one bad item rejects the whole batch. No writer path can
  create an unresolved want (settled rule), including this one.
- Items are merged by `(cardId, canonicalPrinting(set, foil))` beforehand (qtys summed),
  then ONE `tx(stmts)` of the same upsert `addWantedForItem` uses
  (`ON CONFLICT ... DO UPDATE SET qty_wanted = qty_wanted + excluded.qty_wanted`), one
  `bump()` after commit - exactly `importCollectionResolved`'s discipline: one
  transaction, confirmed-or-nothing, one broadcast.
- **Merge semantics: `+=`, not MAX.** Select-all Add and paste replay are additive user
  gestures - the batch counterpart of the stepper and of `addWantedForItem`, which are
  both `+=`. MAX belongs to idempotent shortfall commands (`addMissingToWishlist`, where
  re-running "cover this deck" must not inflate), and stays there.
- **Why it may bypass the per-card `queueWantWrite` chains:** every statement is an atomic
  increment, no read-modify-write - the same argument that already licenses
  `addWantedForItem` for callers that cannot serialize. Overlap with a concurrent absolute
  `setWantedForItem` is the identical exposure text import has today; the goal drain
  reconciles the surface afterwards as it already does.
- Callers: the AddCardsSheet batch commit (§3.1) and the `ResolvePrintingsSheet` commit
  (§3.2). Single-item gestures stay on their chains.
- Tests (node, no DOM): conservation (sum of input qtys equals sum of row deltas), merge
  with pre-existing rows, duplicate items in one batch merge before writing, transaction
  failure leaves zero rows (inject a failing statement), profile scope (writes land only
  on the passed pid), rejection of uncategorised/legacy/`:f`-suffixed "set" values.

This removes the 402-writes-on-402-chains latency watchpoint from rev 1.

## 4. Edge cases

- **Single-set cards.** One row in the add sheet (with its pill); heart resolves silently
  (`wantTarget` single-set branch). Never asked, anywhere.
- **Catalog-unknown cards** (`sets` empty). The add sheet renders one dimmed,
  non-interactive row: name at `var(--ink-faint)`, tag `NO PRINTING LISTED` in place of the
  pill, no `+ Add`, excluded from Select all and from the count line. An honest item cannot
  be constructed, so nothing offers to construct one (the repository would throw anyway).
  The card sheet heart keeps its existing warn toast:
  `The catalog does not list a printing for this card`.
- **Foil-only and non-foil-only printings.** Real catalog states (28 foil-only, 25
  non-foil-only printings in the installed catalog; Winter River in Alpha is foil-only).
  Governed everywhere by P6 via `printingFinishes`: the add sheet tags and redirects
  (§3.1), the resolver constrains and states (§3.2), the wishlist row only ever steps
  wants that exist (§3.3), the card sheet offers one segment per real finish (§3.4), and
  import validates annotations against it (§3.5). No surface can express - and no writer
  will accept by this design - a non-foil Winter River.
- **Sets with no variants data.** A set listed in `sets` with no `variants` entry for it
  reads as non-foil-only (P6 fallback) - conservative, matches the product default, and
  cannot invent a foil.
- **Uncategorised wants from migration.** Never creatable by these surfaces (P4;
  `requireResolvedSet` throws). Displayed as an `Uncategorised` group in the wishlist,
  editable via card-level writers, resolved in triage (To Be Categorised). The add sheet
  never shows an uncategorised row because expansion only walks catalog sets. Exported as
  bare lines (§3.5).
- **Empty states.** Add sheet, no matches, set term active:
  `No printings match set:{term} - check the set name or code`. No matches otherwise:
  `No cards match` (unchanged). Wishlist empty state unchanged. Resolver sheet with an
  empty queue never opens (mount condition `queue.length > 0`, as today).
- **402-scale batches.** One optimistic state pass, one toast, ONE transaction (§3.6).
  Rendering scale is handled by the 1,000-printing render/select cap (§3.1).

## 5. Build plan

Ordered, each increment shippable and reviewable alone, on branch `collection-add-flow`.
Store-layer changes are flagged.

1. **`src/store/cardQuery.js` - expose set intent.** [store] `parseQuery` additionally
   collects the raw values of `set:` / `s:` tokens into `parsed.setTerms: string[]`
   (clauses unchanged, so every existing consumer is untouched). Unit tests: codes, names,
   quoted values, multiple set tokens.
2. **`src/store/printingRows.js` - pure expansion + finish availability.** [store, new
   file] `printingFinishes(card, setCode)` (P6, with the no-variants fallback),
   `expandItemRows(cards, setTerms)`, and the refusal-row predicate. Uses `cqText`-style
   matching (export the matcher from cardQuery rather than duplicating it) and `setRank`.
   Unit tests: multi-set unpack, set-term collapse, empty-sets refusal row, dedupe of a
   doubled catalog set entry, foil-only / non-foil-only / no-variants finishes.
3. **`addWantedItemsBulk`.** [store - the one repository addition]
   Per §3.6, with its full test list. Lands before any UI consumes it.
4. **`AddCardsSheet` item grain** (`src/pillars/Collection.jsx`). `grain` prop; per-printing
   rows, set pills, finish tags and P6 row behavior, item-keyed membership and selection;
   Foil toggle; `onStep(card, delta, item)`; the 1,000-row render/select cap; batch commit
   as one optimistic pass + one `addWantedItemsBulk` call (new `addBatch` beside `addStep`
   in `ListDetail`); toast strings from §3.1. Wishlist `ListDetail` passes `grain='item'`
   and the item-keyed map; custom lists pass nothing and behave exactly as before.
5. **Batch resolver.** [store, new file] `src/store/batchWantPlan.js`: pure plan for the
   checklist (union of set options, apply-to-all where printed-in and finish-compatible,
   per-row choice, locked finishes, unresolved count, commit list with original deltas).
   New `src/components/ResolvePrintingsSheet.jsx` rendering it (§3.2), committing through
   `addWantedItemsBulk`. `ListDetail` routes the text-import remainder to it (the
   `addPick` queue fills as today, the sheet consumes it whole); the per-card FIFO mount
   of `WantPrintingSheet` in `ListDetail` is removed. `WantPrintingSheet` remains solely
   the card sheet's single-card ask.
6. **Text grammar + symmetric import/export.** [store, new file]
   `src/store/itemLineGrammar.js` (format + parse, shared); `resolveWantList` beside the
   existing resolvers; `wishlistExportText` emits per-item lines; `ListBulkAddSheet`'s
   apply path consumes resolved items. Unit tests: grammar cases from §3.5, unknown-set
   and wrong-finish flagging, and the lossless round-trip contract.
7. **Wishlist rows.** [store, new file] `src/store/wishlistRows.js`:
   `groupWishlistDisplayRows`. `ListCardRow` gains the twin-finish status line and the
   per-existing-finish steppers; `ListDetail` keys rows by group, maps stepper callbacks
   to exact items, and passes `group.set` to `onPeek`. Remove `printingLabel`'s
   finish-on-the-pill string.
8. **`CollectionCardSheet` split want control** - §3.4: segments per available finish,
   foil writes through `queueWantWrite`, picker preset from the tapped segment.
9. **Copy, gates, docs.** Zero-image mode pass over the new rows; `npm run test:codex`,
   `test:query`, `test:app`, `check:types`, `check:cycles`, `build`, `check:docs`;
   `COMPENDIUM_FEATURE_MATRIX.md` (Collection add/wishlist rows, export format) and
   `COMPENDIUM_DATA_MODEL.md` (the new repository writer and the export/import line
   grammar) updated.

Dependencies: 4 needs 1, 2, 3; 5 needs 2, 3; 6 needs 2 (finish validation) and feeds 5's
locked-finish rows; 7 and 8 are independent of each other. Increments 1-3 are pure/store
and land without visible change.

## 6. Open questions for the owner

1. **Owned import annotations.** The line grammar (§3.5) now exists app-wide. Should the
   OWNED text import (Overview's `ImportTextSheet` -> `previewCollectionText`) also parse
   `[Set]` / `[Foil]` annotations this round, filing annotated owned copies directly
   instead of asking in its review step? Recommended yes (the parser is shared and the
   review step already handles the bare remainder), but it widens scope beyond the
   wishlist surfaces, so it is called out rather than assumed.
2. **The render/select cap.** 1,000 printings (§3.1) is chosen so every single-set
   workflow fits with heavy margin. Confirm the number, or name a different one - it is a
   constant, not an architecture.
