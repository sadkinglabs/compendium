# Collection v11 - Add and Wishlist surfaces think in collector items

**Status:** Design + implementation brief, rev 4. Rev 3 was reviewed by Codex (one blocker,
six majors) and re-ruled by the owner (Rainbow finish, per-item art, printing origins).
This revision resolves all of them and returns to Codex.
**Branch:** `collection-add-flow`, off the schema v11 work.
**Change class: HIGH-RISK** (reclassified from Standard per Codex Major 8). This work
changes profile-owned durable writes, transactional behaviour, the text import/export
format, and native SQLite execution paths. No schema migration is required, but that does
not make durable-write and format changes Standard. The full High-risk proposal contract
(assumptions, alternatives, compatibility, rollback, security, native parity,
documentation impact, Self-Critique, approval record) is §7.
**Repository surface touched** (rev 3's "one repository addition" was an undercount):
- `addWantedItemsBulk` - NEW bulk want command, barrier-protected (§3.6).
- `planWantedItemBatch` - NEW pure batch validator used inside the command (§3.6).
- `importCollectionResolved` - CONTRACT EXTENSION: items gain `foil` (§3.5, Codex Major 4).
- `parseQuery` - restructured output, back-compatible `clauses` retained (§3.1, Major 7).
**Invariants touched:** durable offline-first writes, transactional user-data operations,
cross-runtime integrity (web sql.js vs native executeSet). How each still holds is
specified in §3.6 and §7.

---

## 1. Problem restatement

Schema v11 made the want grain **collector item = card_id + set + finish** (`001`, `001:f`,
`002`, `002:f`, `uncategorised`, `uncategorised:f`). The backend stores, serialises, and reads
that grain correctly. The ADD and WISHLIST surfaces still present the card-name grain, and
on-device testing plus review produced six concrete failures:

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
6. **Rows show the wrong art for the item.** A promo want renders the STANDARD printing's
   art (found on device). The catalog carries per-variant images (3,083 of 3,088 variants),
   and promo Foil and Rainbow variants even have distinct art (Druid: Foil
   `999-druid-d.webp`, Rainbow `999-druid-op.webp`) - none of it reaches the item-grain
   rows.

## 2. The interaction model

### Principles

- **P1 - A row is a collector item, not a card name.** Wherever the user picks something to
  want, the thing on screen already carries `card_id + set`, and finish is carried by the
  surface's declared finish mode. Selecting a row selects the printing. There is no
  "which printing?" follow-up for anything the user picked off a row.
- **P2 - The query scopes the rows, and the rows ARE the intent.** `set:beta` does not merely
  filter cards; it filters *printings*. After it, only Beta rows exist, so Select all -> Add
  files Beta items directly. Set intent is never re-asked because it never left the selection.
- **P3 - Finish is a mode, never a question - and intent is NEVER downgraded.** Non-foil is
  the product default (§7.4 of the v11 proposal, `DEFAULT_WANT_FOIL`). Foil is an explicit
  toggle the user turns on before adding - one deliberate act that governs the adds that
  follow, not a per-card prompt. An explicit foil intent that reality cannot satisfy is
  refused visibly (skipped / asked), never silently filed as non-foil.
- **P4 - Questions only for genuinely unknowable batches, answered once.** The only remaining
  ambiguous path is text import of lines that carry no printing. Its remainder resolves in ONE
  checklist sheet with apply-to-all controls, dismissible at any time, committing only on
  confirm.
- **P5 - A surface opened AT an item never re-asks what the item is.** The set pill replaces
  the set picker whenever the entry point already named the printing.
- **P6 - Finish follows the catalog, through one exhaustive normalizer.** The catalog has
  THREE finish labels, verified against the installed `public/catalog/cards.json`:
  `Standard` (1,539 variants), `Foil` (1,528), `Rainbow` (21, all in set 999 Promotional).
  Owner ruling: **Rainbow is a flavour of foil.** One normalizer owns the mapping:

  ```
  normalizeFinishLabel(label) -> 'nonFoil' | 'foil'
    'Standard'          -> 'nonFoil'
    'Foil' | 'Rainbow'  -> 'foil'
    anything else       -> throws  (FAIL CLOSED - never silently bucketed)
  ```

  `printingFinishes(card, setCode) -> { nonFoil: bool, foil: bool }` is built ON this
  normalizer (in `printingRows.js`) - no scattered string comparisons anywhere else. A
  **catalog-contract test** enumerates every distinct `variants[].finish` label in
  `cards.json` and FAILS if the set is not exactly `{Standard, Foil, Rainbow}`, so a
  future catalog drop with a fourth finish stops the build instead of silently mis-filing.
  Storage is untouched: the ledger was always binary (`:f` or not); Rainbow is catalog
  metadata only, so no migration exists or is needed.
  Consequences, stated: the 4 printings with BOTH a Foil and a Rainbow variant (Sorcerer,
  Spellslinger, Druid, Witch - all set 999) collapse into ONE foil collector item,
  consistent with v11's settled decision not to track product-level catalog-variant
  ownership. The 17 Rainbow-only promos become foil-only items, handled exactly like
  Winter River. What the collapse gives up visually, P7 and the origin line (§3.4) give
  back.
  Fallback: a set listed in the card's `sets` with NO variants entry for it reads as
  `{ nonFoil: true, foil: false }` - conservative, matches the product default, cannot
  invent a foil.
- **P7 - Art follows the collector item.** Every item-grain surface renders the art of the
  printing-and-finish it represents, resolved by one pure helper (`printingArt`, §3.7): a
  non-foil want shows the printing's standard art, a foil want the printing's foil art, a
  promo want the promo art. This fixes failure 6 and is the owner's chosen lever for
  visual foil/promo distinction now that Rainbow collapses into foil.
- **P8 - A recognized paste is ONE draft with ONE commit boundary.** Nothing from a paste
  is written until the user confirms the whole plan; Cancel, backdrop, and hardware back
  write ZERO. Unknown card names may be surfaced and excluded, but every recognized line
  shares the single commit (Codex Major 6 - rev 3's "apply the unambiguous part first"
  made Cancel a partial import, and is withdrawn).

### Per surface, in one line each

- **AddCardsSheet (wishlist mode):** per-printing rows with set pills and per-item art; a
  sheet-level Foil toggle; every add writes an exact item; rows offer only the finishes
  their printing has.
- **Batch resolver:** one checklist sheet over the WHOLE paste draft; "set for all" +
  "finish for all" + per-row override, all P6-constrained, never downgrading intent;
  Cancel writes zero; Confirm is one transaction.
- **Wishlist detail:** one row per (card, set) showing non-foil and foil want counts
  distinctly, wearing the item's art; tapping a row opens the card sheet AT that set.
- **CollectionCardSheet:** picker only when opened name-level on a multi-set card; a split
  want control with one segment per available finish; art follows set AND finish; an
  "obtainable from" origin line for the printing on show.
- **Text export/import:** wishlist exports one line per collector item
  (`qty name [Set] [Foil]`) and the importer parses the same grammar; owned import
  accepts the same annotations optionally, pickers as fallback.

## 3. Per-surface specification

### 3.1 AddCardsSheet - per-printing rows and direct filing

`AddCardsSheet` gains a `grain` prop: `'card'` (default, unchanged - custom lists stay
card-grain because a `card_list_entries` row means "any printing", see `ANY_PRINTING` in
`printings.js`) or `'item'` (the Wishlist passes this).

#### Query output (Codex Major 7 - structured, not sniffed)

`parseQuery` cannot stay predicate-only for this: clauses are opaque functions, so a
caller cannot tell which came from `set:`. The output becomes:

```
parseQuery(raw) -> { name, clauses, itemClauses, setTerms, scopes }
  clauses      unchanged - EVERY clause including set, for existing card-grain callers
               (full back-compat; no current consumer changes)
  itemClauses  every clause EXCEPT set - what item grain applies per card
  setTerms     the set tokens as normalized matchers (built with the same cqText
               semantics: quoted values, comma-AND within one value)
```

Row-grain semantics of `setTerms`, defined and tested (they were undefined in rev 3):

- **Across separate `set:` tokens: OR.** `set:alpha set:beta` keeps a printing row if it
  matches EITHER term. Cross-token AND is meaningless at row grain - one printing cannot
  be both Alpha and Beta - so it is defined as OR, stated, and tested.
- **Within one value, comma stays AND** (existing `cqText` behavior), applied to the ONE
  printing's `"${code} ${name}"` label: `set:"bet, beta"` requires both needles on the
  same label.
- Codes (alp/bet/art/got/dra/pro), names, and numeric codes keep working - the matcher is
  the same `cqText` the clause uses today, exported from `cardQuery.js` rather than
  duplicated.

#### Row expansion (item grain)

The pool query is unchanged (`getPool({ q: parsed.name })`, token cards filtered,
`itemClauses` post-applied per card). A pure helper then expands each card into one row
per printing:

```
expandItemRows(cards, setTerms) ->
  [{ card, set: '002', setName: 'Beta',
     finishes: { nonFoil: true, foil: true },   // printingFinishes(card, set), P6
     key: `${card_id}|002` }, ...]
```

- One row per entry in the card's `sets` JSON, ordered by `setRank` within a card, cards
  in pool order (name ascending by default). **Ordering is deterministic and applied
  BEFORE the render cap** - a test asserts the same input yields the same first-1,000
  slice every time.
- A printing row survives `setTerms` per the OR/AND semantics above. When `setTerms` is
  non-empty, item grain skips the set clause (it is represented by `setTerms`) and
  applies only `itemClauses` - one filter, one semantics.
- A card whose `sets` array is empty produces one **refusal row** (see §4).
- Row art is `printingArt(card, set, finishMode)` (P7, §3.7) - a Beta row wears Beta art,
  a promo row wears promo art, and in foil mode the foil art where it differs.

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
    (Rainbow-only promos land here via the normalizer.)
  - A **non-foil-only** printing never writes a foil item. While the Foil toggle is ON,
    the row is dimmed (`var(--ink-faint)` name), tagged `NO FOIL PRINTING`, its `+ Add`
    is removed, and Select all skips it. Foil mode is explicit intent, and intent is never
    downgraded (P3) - the row opts out visibly instead.
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
  where the printing has one (P6 row rules above); the count line reads
  `128 printings · adding foil`; row art switches to the foil variant's art where the
  catalog has distinct art (P7).
- The count line says `N printings` in item grain (`N cards` stays in card grain).

#### Selection, Select all, Add - and the copy that admits `+=`

- Selection is keyed by row key (`${card_id}|${set}`), storing `{ card, set }`. Two
  printings of one card are two independent checkboxes.
- `Select all · N` selects every shown printing row (refusal rows and finish-incompatible
  rows excluded per P6). With `set:beta` active the shown rows are exactly the Beta
  printings, so this is "everything in Beta" by construction.
- **The copy must reveal the additive semantics** (a repeated Select-all Add inflates by
  design - `+=`, §3.6 - and the words must not hide it):
  - Batch CTA: `Add +1 each · 402`
  - Success, single copy each: `Added one wanted copy to 402 printings`
  - Success, foil mode: `Added one wanted foil copy to 12 printings`
  - Non-foil mode that included foil-only rows:
    `Added one wanted copy to 402 printings · 3 filed as foil`
  - With refusals present: append ` · 2 had no printing listed`
  - Single `+ Add` taps stay toast-silent; the inline count is the feedback (unchanged).
- **Commit protocol (Codex Major 3 - the UI awaits the command):** the CTA enters a
  pending state (`Adding…`, disabled), ONE optimistic `applyGoal` pass is made, and the
  handler AWAITS `addWantedItemsBulk` (§3.6) directly - the goal drain is reconciliation,
  never the error surface. On success: past-tense toast, selection cleared, select mode
  exits. On failure (including the barrier failing closed): optimistic state is
  reconciled from an authoritative read, the user's SELECTION IS RETAINED (select mode
  stays on, checks intact, so the gesture can be retried or edited), and the toast says
  `Couldn't add - nothing was written` (`tone: 'danger'`). No past-tense copy is ever
  shown before the command resolves.

#### Result scale and rendering

Per-printing expansion roughly doubles row count, and an empty query in this sheet already
returns the whole catalog - expanded, a few thousand rows in an Android WebView bottom
sheet. The rows keep `content-visibility: auto` + `contain-intrinsic-size` (the technique
the ~780-tile set drill already proves on device), and item grain additionally caps the
RENDERED list at **1,000 printings** (owner-confirmed):

- Below the cap: everything renders, `Select all · N` covers the full result.
- Above the cap: the first 1,000 rows render (deterministic order, above), the count line
  reads `2,431 printings · showing 1,000`, a footer row says
  `Refine the search to see the rest`, and Select all is disabled with the same hint.
  Selection is never allowed to include rows the user could not have seen.

**Acceptance criterion (owner ruling): the cap is never silent.** Whenever the result
exceeds 1,000 printings, ALL THREE signals must be present and testable: (a) the count
line shows both numbers, (b) the refine footer renders after the last shown row, and
(c) Select all is disabled with that same reason. A truncated list with any of the three
missing is a defect, not a styling choice; the pure row-capping helper returns
`{ shown, total, capped }` so a unit test can assert the state, and the UI test asserts
the three signals render from it.

1,000 is chosen because the largest single set expands to well under it, so every
set-scoped workflow (the 402 case) is untouched; only broad or empty queries hit the cap.
No virtualization library; the scrolling container stays transform-free (the sheet's
animated element never carries the scroll - Android WebView rule).

#### What `set:beta -> Select all -> Add` now does, end to end

1. `parseQuery` returns `setTerms: [beta-matcher]` and no name needle.
2. Expansion yields one row per Beta printing - 402 rows, each already `card_id + '002'`,
   each wearing its Beta art.
3. Select all marks 402 rows; the CTA reads `Add +1 each · 402`; Add awaits ONE
   barrier-protected `addWantedItemsBulk` transaction; toast:
   `Added one wanted copy to 402 printings`. Zero questions.

### 3.2 Batch resolution - one draft, one commit (rewritten per Codex Majors 5 and 6)

Ambiguity can now arise only where no printing was ever on screen: **text import**
(§3.5). The rev 3 flow (apply the unambiguous part immediately, resolve the remainder)
is WITHDRAWN: it made Cancel a partial import. The paste is now one draft (P8):

```
paste -> resolveWantList(text) -> draft { resolved[], needsChoice[], unknown[] }
   needsChoice empty:  review summary -> Confirm commits ONE bulk transaction
   needsChoice not empty:  ResolvePrintingsSheet opens over the WHOLE draft
```

Nothing is written before Confirm, wherever Confirm lives. `batchAddSummary`'s
"Added X, choose printings for Y more" split toast retires on this path - there is no
partial application left to report. The `addPickQueue` pure helpers survive as the
draft's data shape (entries keep their original quantities - the dropped-quantity bug
class stays fixed). Single-card asks from the card sheet keep the existing
`WantPrintingSheet` and its immediate single write - a tap is its own commit boundary;
P8 governs pastes.

New sheet: `ResolvePrintingsSheet`, receiving the ENTIRE draft:

```
+--------------------------------------------------------------+
|                     CHOOSE PRINTINGS                         |
|   25 of 37 recognized cards were printed more than once.     |
|   Pick a set for all of them, then adjust below.             |
|   12 already-resolved lines are included in this add.        |
|                                                              |
|   SET FOR ALL      [ Alpha ] [ Beta ] [ Promo ]              |
|   FINISH FOR ALL   [ Non-foil ] [ Foil ]                     |
|   ------------------------------------------------------    |
|   Albespine Pikemen              ×4    [Alpha][Beta]         |  ^
|   Frontier Settlers              ×2    [Alpha][Beta]         |  | scrolls
|   Winter River          ✦ FOIL ONLY    ×1    [Alpha]         |  v
|   Wax Golem   [Foil] impossible  ×1  [Use non-foil] [Skip]   |
|   ------------------------------------------------------    |
|   [ Cancel ]        [ Add 36 printings · skipping 1 ]        |
+--------------------------------------------------------------+
```

Behavior, exactly:

- **SET FOR ALL** lists the union of the queued cards' set codes, `setRank` order. Tapping
  `Beta` sets every row's choice to Beta **where the card is printed in Beta AND Beta
  supports the row's effective finish** (P6); other rows keep their current choice and
  stay visually unresolved if they had none. The button's pressed state shows only while
  every resolvable row agrees with it.
- Rows start **unchosen** (no silent default set - defaulting is the original v10 defect).
- **FINISH FOR ALL** is the batch finish, default Non-foil, and it NEVER downgrades
  intent (P3, Codex Major 5a):
  - A row whose chosen set is foil-only files as foil regardless, tagged `✦ FOIL ONLY` -
    an upgrade forced by reality, shown.
  - With batch finish Foil, a row with no foil printing in ANY of its sets is marked
    `SKIPPED · NO FOIL PRINTING` and EXCLUDED from the commit - visible, counted in the
    CTA, reversible by changing the batch finish. It is never silently filed as non-foil.
  - A `[Foil]` line annotation is a valid `lockedFinish` ONLY when at least one of the
    card's printings supports foil under the normalizer (Codex Major 5b). When no
    printing does, the lock is impossible and the row demands an explicit per-row choice:
    `[Use non-foil]` `[Skip]` buttons (real buttons, visible text). No permanent lock, no
    silent resolution.
  - Per-row finish override beyond these cases is deliberately not offered - a
    mixed-finish paste is expressed with annotations, or as two pastes.
- Per-row segmented set control (`SegTabs`, the `ImportTextSheet` review prior art)
  offering only (set, finish)-valid options for that row's effective finish.
- **Confirm gating:** the CTA stays DISABLED while any INCLUDED row lacks a complete,
  valid (card, set, finish) triple - label `Choose a set for 3 more` until then. When
  ready: `Add 36 printings` (` · skipping 1` appended when skips exist). Skipped rows are
  excluded, never blocking.
- **Exits (P8):** Cancel button, backdrop tap, and hardware back all close at any time
  and write ZERO - the resolved lines included in the draft are abandoned with it.
  Toast: `Nothing added`. One gesture always leaves, and leaving never half-commits.
- **Commit:** ONE `addWantedItemsBulk` transaction over resolved + chosen - skipped
  (§3.6), awaited by the CTA with the same pending/failure contract as §3.1 (failure
  retains the sheet state for retry). Success toast, quantity-honest:
  `Added 31 wanted copies across 24 printings`.
- Scroll container: an inner `div` with `max-height` + `overflow-y: auto` (the
  `ImportTextSheet` pattern). The animated sheet element never carries the scroll -
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

- **Thumb art is the item's art (P7):** `printingArt(card, set, finish)` where finish is
  non-foil when the group holds a non-foil want, else foil - the primary finish fronts a
  mixed group, and a foil-only group (including Rainbow-only promos) wears its foil art.
  This replaces the current default-art thumb, which is failure 6 on this surface.
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
- **Accessible names carry the item** (acceptance evidence, increment 7): the stepper
  buttons are named `Want Beta non-foil, one more` / `Want Beta non-foil, one fewer` /
  `Want Beta foil, one more` etc. - TalkBack must distinguish the four buttons on a
  two-finish row.
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

### 3.4 CollectionCardSheet - picker contract, split want control, item art, origins

Picker visibility (mostly existing behavior, now stated as the contract):

| Entry condition | Top slot |
|---|---|
| Opened with `set` prop (wishlist row, set drill tile, scanner filing) | `SetPill` - never SegTabs |
| Name-level open (Codex, search, Overview), card in ONE set | `SetPill` |
| Name-level open, card in 2+ sets (or owned uncategorised copies exist) | `SegTabs` printing picker |

**Art follows set AND finish (P7).** The sheet's `imageForSet` (set-only, `-s$` slug
sniffing) is replaced by `printingArt(card, effSet, finish)` (§3.7). The finish shown
follows the want context the sheet is displaying: default non-foil; when the printing is
foil-only, or the user is interacting with the foil segment, the foil art. The credited
artist keeps following the printing on show (`artistForSet` migrates to read the same
selected variant).

**The origin line (owner requirement).** Every catalog variant carries a `product` field
(all 3,088 do). A quiet line renders under the set pill for the printing on show:

```
        ( PROMOTIONAL )
   Obtainable from Dust · Organized Play
```

- Content: `printingProducts(card, effSet, foil)` (§3.7) - all origins for the collector
  item. A collapsed foil+rainbow promo lists BOTH variants' origins (Druid's foil item ->
  `Dust · Organized Play`), which is the acquisition information that recovers what the
  finish collapse gives up.
- **Shown only when the origins are informative:** the line renders whenever the item's
  origin list is anything other than exactly `['Booster']`. A `Booster` line on a regular
  set card is noise on nearly every card in the app; a promo's `Box Topper` or
  `Kickstarter` is exactly what the player needs. (Promos get it always in practice;
  regular-set preconstructed/box-topper variants earn it too.) Rule is data-driven, not
  set-number-driven.
- Style: `var(--f-ui)`, 12px, `var(--ink-muted)`, centered, ` · ` separators. It is static
  text - no interactive role, no bare aria-label (the Android empty-content-desc gotcha
  applies to controls); TalkBack reads the sentence as written, which is why the copy is
  a sentence (`Obtainable from Dust · Organized Play`) and not a bare tag cloud.
- Zero-image mode: unaffected (text). Layout reserves no fixed slot - the line is simply
  absent when suppressed; the art block above it is what keeps stable height.

**The want control** (owner ruling: a direct foil-want control). The single Wishlist
button becomes a split capsule with **one segment per finish the shown printing actually
has** (`printingFinishes(card, effSet)`, P6):

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
  `WantPrintingSheet`, with its finish toggle preset to the tapped segment's finish.
  Opened AT an item, neither segment can ever reach the picker (P5).
- A foil-only printing renders the single `Wishlist ✦ Foil` button bound to the foil item.
- **`WantPrintingSheet` learns finish availability (Codex Major 5, tail):** today it
  offers the same finish for every set. It receives per-set `printingFinishes` and must
  make invalid combinations unpickable: with Foil selected, sets without a foil variant
  are dimmed and non-tappable (`no foil` note on the row); with Non-foil selected,
  foil-only sets likewise; a finish no set supports does not render as a toggle option.
  It can therefore never emit an invalid (set, finish) pair.

### 3.5 Text grammar - per-item export, symmetric import, corrected writer contract

One new pure module, `src/store/itemLineGrammar.js`, owns BOTH directions (format +
parse) so they cannot drift.

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
- **Malformed input is defined, not accidental** (tested, increment 5): duplicate
  `[Foil]` -> line flagged to review/resolver (reason `duplicate finish`); two set
  annotations -> flagged (`two sets named`); empty brackets `[]` and unmatched `[` ->
  the bracket text is treated as part of the free-text name (which then resolves or
  reports as unknown - never a crash); annotation token longer than 64 characters ->
  flagged; qty outside 1..999 -> flagged (`quantity out of range`), never clamped
  silently. Unknown FUTURE annotations are by construction unknown-set flags - they
  surface in review, they never silently drop (forward compatibility, §7.3).

#### Wishlist import (`resolveWantList`, feeding the §3.2 draft)

Returns the whole-paste draft: `{ resolved, needsChoice, unknown }`:

- **Annotated, valid:** set names one of the card's catalog sets AND the finish exists for
  that printing (P6) -> a `resolved` entry carrying the exact item.
- **Bare line:** single-set cards resolve silently (finish non-foil, or foil where the
  printing is foil-only, P6); multi-set cards -> `needsChoice`.
- **Unknown set, set the card lacks, or finish the printing lacks:** -> `needsChoice`,
  flagged with the reason (`unknown set "Betta"`, `no foil printing in Alpha`), resolved
  in the checklist among real options. Never dropped, never silently downgraded (P3),
  never an uncategorised want.
- `[Foil]` without a set: `lockedFinish: 'foil'` ONLY if some printing of the card
  supports foil; otherwise the impossible-annotation row (§3.2: `Use non-foil` / `Skip`).
- Unrecognised names: `unknown`, surfaced and excluded from the commit (P8 allows this -
  they were never recognized rows).
- NOTHING writes until the draft's single Confirm (P8).

#### Owned import (owner ruling: optional annotations, pickers as fallback) - and the writer fix

The same grammar extends to the OWNED text import (Overview's `ImportTextSheet` ->
`previewCollectionText` -> `planCollectionImport` review). Annotations are OPTIONAL:

- A line with a valid `[Set]` annotation - the set is one of the card's catalog sets, and
  the line's finish exists for that printing (P6) - files that exact owned printing
  directly, skipping the review step for that line. `[Foil]` files the foil ownership row.
- A BARE line, or one with an unknown set, a set the card is not printed in, or a finish
  the printing does not have, falls through to the EXISTING owned review step and its
  per-card set pickers - never dropped, never silently resolved.

**Writer contract fix (Codex Major 4 - rev 3's "importCollectionResolved is untouched"
was wrong and is withdrawn).** `importCollectionResolved` accepts only
`{card_id, qty, setCode}` and hardcodes `canonicalPrinting(setCode, false)` - under rev 3
a `2 Card [Beta] [Foil]` line would have persisted as Beta NON-foil, a ledger lie. The
contract extends:

```
importCollectionResolved(items)
  items: [{ card_id, qty, setCode, foil = false }]
  writes canonicalPrinting(setCode, foil) when setCode is present,
         else UNCATEGORISED_FOIL when foil, else UNCATEGORISED
```

Same one-transaction discipline as today. Annotated direct-file items are validated
against the catalog at plan time (set belongs to the card, finish available under the
normalizer); the uncategorised fallback remains ONLY for lines the user leaves unresolved
in the review step. A REQUIRED end-to-end repository test drives the real chain -
grammar -> `previewCollectionText` -> `planCollectionImport` -> `importCollectionResolved`
-> read the ledger back - and asserts exact stored slugs (`002`, `002:f`,
`uncategorised:f`), not just the pure plan.

**The owned/wanted asymmetry, restated because the two grains genuinely differ:**
uncategorised OWNED copies are a legitimate, first-class state (the To Be Categorised
pile; a scan with no set pick already lands there). The owned-import fallback may
legitimately END uncategorised if the user leaves a line unresolved. Wants are the
opposite: an uncategorised want may never be created by a normal writer, so the wishlist
draft forces a choice or a visible skip.

| Grain | Incomplete line falls to | May end uncategorised? |
|---|---|---|
| Want (wishlist paste) | `ResolvePrintingsSheet` - resolve or skip, one commit | Never |
| Owned (collection paste) | Existing review step with pickers | Yes - legitimate state |

#### Export

- `wishlistExportText()` emits one line per collector item, in wishlist row order:
  `3 Albespine Pikemen [Beta]`, then `2 Albespine Pikemen [Beta] [Foil]`. Uncategorised
  wants export as bare `qty name` (they claim no printing; re-import upgrades them
  through the draft, by design).
- Curiosa-facing surfaces (deck export, custom-list export, the missing-cards export)
  keep emitting bare `qty name` - card-grain, paste-compatible. No owned-side export
  emits annotations today; a future "export collection as text" surface inherits the
  grammar for free rather than being invented here.
- Owned-import success toast keeps its copies-across shape and honesty:
  `Added 527 copies across 402 cards` (existing wording family, quantities never implied
  idempotent).
- **Round-trip contract, tested:** for every resolved item, export -> `resolveWantList`
  reproduces exactly `(card_id, set, foil, qty)`.

### 3.6 The bulk want command - barrier-protected, catalog-validating (rewritten per Codex Majors 2 and 3)

Rev 3 let `addWantedItemsBulk` bypass the write queue on the atomic-increment argument.
Codex is right that this reopens the lost-update class v11 spent rounds killing: a queued
ABSOLUTE `setWantedForItem` (a stepper's set-to-N) interleaving with the bulk increment
loses one of them. `withExclusiveCollectionWrites` (`collectionWrites.js`) is the
established boundary for every command that writes in bulk, and this command uses it.

```
addWantedItemsBulk(items, pid)
  items: [{ cardId, set, foil, qty }]
  pid:   captured by the CALLER synchronously at the gesture, before any await
  -> { items: n, copies: m }  confirmed by the transaction, or throws with nothing written
```

**Protocol, in order (each step load-bearing):**

1. The gesture handler captures `pid = activeProfileId()` synchronously - a mid-flight
   profile switch cannot redirect the batch (the same rule `queueWantWrite` enforces).
2. Enter `withExclusiveCollectionWrites(fn)`. Admission closes; in-flight (admitted) row
   writes drain first; writes arriving after the gate park behind the holder. The barrier
   FAILS CLOSED: if the drain does not complete within its 4s budget the command rejects
   and NOTHING runs - a hung storage op costs a failed command, never a lost edit.
3. INSIDE the holder, read the catalog rows for the batch: one chunked, parameterized
   `SELECT card_id, sets, variants FROM cards WHERE card_id IN (...)` (the `cardSetsFor`
   400-parameter chunking pattern), building `catalogById`. Reading inside the holder
   means validation and write see one consistent world.
4. `planWantedItemBatch(items, catalogById)` - the PURE validator (Codex Major 3:
   `assertRealSetCode` is shape-only by its own contract; the durable boundary must check
   REALITY). It validates, for every item:
   - the card exists in the catalog;
   - the set belongs to THAT card's `sets`;
   - the requested finish exists for that printing under the Rainbow normalizer
     (`printingFinishes`, P6);
   - qty is a positive safe integer within the input bound (1..999 per item);
   - merged per-item totals remain safe integers.
   It merges duplicates by `(cardId, canonicalPrinting(set, foil))` (qtys summed) and
   returns the statement plan. ANY violation throws with the offending item named -
   the WHOLE batch is rejected BEFORE any SQL is built. This is what makes "an impossible
   collector item cannot be written" true below the UI, not just above it.
5. ONE `tx(stmts)` of the merged upserts
   (`ON CONFLICT ... DO UPDATE SET qty_wanted = qty_wanted + excluded.qty_wanted`) -
   parameterized statements on both runtimes (web sql.js and native `executeSet`, §7.6).
6. `bump()` broadcasts AFTER the commit. Parked row writes are admitted when the holder
   releases; they serialize behind the committed state instead of racing it.

- **Merge semantics: `+=`, not MAX.** Select-all Add and paste commit are additive user
  gestures - the batch counterpart of the stepper and of `addWantedForItem`. MAX belongs
  to idempotent shortfall commands (`addMissingToWishlist`) and stays there. The COPY
  admits the additive semantics everywhere (§3.1).
- **Callers:** the AddCardsSheet batch commit (§3.1) and the draft Confirm (§3.2).
  Single-item gestures stay on their per-card `queueWantWrite` chains.
- **UI contract:** callers AWAIT the command before any past-tense copy; on rejection
  they reconcile optimistic state from an authoritative read, RETAIN the user's
  selection/sheet state, and show the failure toast. The goal drain reconciles; it is
  never the error surface.

**Tests (node, deterministic, no sleeps):**

- **The counterfactual barrier test (required):** one rendezvous, run twice. Fixture: an
  item with want = 1; a queued absolute write (read-1-then-set-2, the stepper shape) and
  the bulk +1 command are interleaved through explicit promise gates (injected write
  fns - no timers). WITH the barrier: the absolute write drains first (2), the bulk
  increment lands on it - final **3**. WITHOUT the barrier (same rendezvous, barrier
  bypassed as the control arm): the bulk increment lands mid-flight and the absolute
  write clobbers it - final **2**, one increment lost. The test asserts BOTH exact
  finals; it fails if the guarded arm ever reports 2 or the control arm ever reports 3
  (which would mean the rendezvous no longer exercises the race).
- Whole-batch rejection: card unknown to the catalog; set not on the card; foil where
  `printingFinishes` says none (a non-foil Winter River); Rainbow-only promo accepts foil
  and rejects non-foil; qty 0, negative, fractional, > 999, and a merged overflow.
- Conservation: sum of input qtys equals the sum of applied row deltas.
- Merge: duplicates within one batch collapse before writing; existing rows accumulate.
- Transaction failure (injected failing statement) leaves ZERO rows changed.
- Profile scope: writes land only on the passed pid; a profile switch racing the command
  serializes behind the exclusive tail (holders are serialized against each other).
- Barrier timeout: a never-draining admitted write rejects the command; nothing written.

### 3.7 Per-item art and origins - one resolver, replacing the slug heuristics

Two pure helpers in `printingRows.js`, both reading `variants[]` filtered by set with
finishes classified by the P6 normalizer. Prior art studied and superseded:
`artForSet` (`CollectionCardViews.jsx`) and `imageForSet` (`CollectionCardSheet.jsx`)
both pick art by sniffing a `-s$` slug suffix - a heuristic from before finish metadata
was read at all. Both call sites MIGRATE to `printingArt` so the app has exactly one art
resolver; the heuristics are deleted, not joined.

```
printingArt(card, setCode, foil) -> image slug | null
```

Deterministic fallback chain, in order:

1. Variants of `setCode` whose normalized finish matches `foil`, having an `image`.
   When `foil = true` and the set has BOTH a Foil and a Rainbow variant (the 4 collapsed
   promos), **prefer the Rainbow variant's art** - the premium face fronts the collapsed
   foil item; that is the stated rule, not an accident of ordering.
2. Else variants of `setCode` with the OTHER finish, having an `image` (a Beta foil want
   still shows Beta art rather than Alpha art).
3. Else the card's default `image_slug`.
4. Else `null` - `CardArt` renders its existing `cardFallbackArt` placeholder.

Zero-image acceptance (owner requirement): the 5 imageless variants and full image-off
mode keep every row at stable height - the 5:7 frame and `contain-intrinsic-size` are
what hold the layout; the placeholder fills the frame. Evidence at the increment that
ships each surface.

```
printingProducts(card, setCode, foil) -> string[]
```

- Variants filtered exactly as `printingArt` step 1 (set + normalized finish - so a
  collapsed foil item aggregates its Foil AND Rainbow variants' products).
- Raw `product` values (all 11, verified): `Booster`, `Box_Topper`,
  `Preconstructed_Deck`, `Dust`, `Organized_Play`, `Draft_Kit`, `Welcome_Kit`,
  `Alpha_Investments`, `Team_Covenant`, `Kickstarter`, `Star_City_Games`. Rendered
  human-readable by underscore-to-space (`Box Topper`, `Organized Play`,
  `Star City Games`) - a transform, not a lookup table, so a new product value degrades
  to a readable label instead of a blank.
- Deduplicated, ordered by first appearance in the card's `variants` array
  (deterministic).
- Consumed by the card sheet's origin line (§3.4). No storage, no writers.

## 4. Edge cases

- **Single-set cards.** One row in the add sheet (with its pill); heart resolves silently
  (`wantTarget` single-set branch). Never asked, anywhere.
- **Catalog-unknown cards** (`sets` empty). The add sheet renders one dimmed,
  non-interactive row: name at `var(--ink-faint)`, tag `NO PRINTING LISTED` in place of the
  pill, no `+ Add`, excluded from Select all and from the count line. The card sheet heart
  keeps its existing warn toast. The bulk command independently rejects such items (§3.6) -
  the UI refusal is courtesy; the boundary refusal is the guarantee.
- **Foil-only, non-foil-only, and Rainbow printings.** Real catalog states (verified:
  Rainbow only in 999; 4 dual foil+rainbow cards; Rainbow-only promos are foil-only items).
  Governed everywhere by P6 via the normalizer: add sheet tags and redirects (§3.1),
  resolver skips or asks but never downgrades (§3.2), wishlist rows only step existing
  wants (§3.3), the card sheet and `WantPrintingSheet` offer only real combinations
  (§3.4), import validates annotations (§3.5), and the bulk command rejects impossible
  items at the durable boundary (§3.6). An unknown FUTURE finish label fails closed at
  the normalizer and is caught by the catalog-contract test before it ships.
- **Sets with no variants data.** Read as non-foil-only (P6 fallback) - conservative,
  matches the product default, cannot invent a foil.
- **Uncategorised wants from migration.** Never creatable by these surfaces
  (`requireResolvedSet` and `planWantedItemBatch` both throw). Displayed as an
  `Uncategorised` group in the wishlist, editable via card-level writers, resolved in
  triage. Exported as bare lines (§3.5).
- **Art gaps.** The 5 imageless variants and zero-image mode fall through `printingArt`'s
  chain to the framed placeholder at stable height (§3.7).
- **Empty states.** Add sheet, no matches, set term active:
  `No printings match set:{term} - check the set name or code`. No matches otherwise:
  `No cards match` (unchanged). Wishlist empty state unchanged. Resolver never opens over
  an empty draft.
- **Input bounds.** Paste size capped at 2,000 lines (beyond: refused with
  `That list is too long - paste up to 2,000 lines`); per-line qty 1..999 (out of range
  flags the line, §3.5); annotation tokens capped at 64 chars; merged batch totals
  validated as safe integers at the boundary (§3.6). All user text reaches SQL only as
  bound parameters - the grammar never builds SQL strings.
- **402-scale batches.** One optimistic pass, one awaited barrier-protected transaction,
  one honest toast. Rendering scale is the 1,000-printing cap with its three mandatory
  signals (§3.1).

## 5. Build plan

Codex's rev-4 order, adopted. Each increment is shippable and reviewable alone, on branch
`collection-add-flow`; store-layer changes are flagged; **acceptance evidence is listed at
the increment where the UI lands, not deferred to the end.**

1. **Rainbow semantics.** [store] `normalizeFinishLabel` (exhaustive, fail-closed) +
   `printingFinishes` built on it + the catalog-contract test (enumerate every distinct
   `variants[].finish` in `public/catalog/cards.json`; fail unless exactly
   `{Standard, Foil, Rainbow}`). Document the collapse consequence (§2 P6) in the data
   model doc. Evidence: tests, including the 4 dual cards and a Rainbow-only promo.
2. **Pure query + classification + art/origins.** [store] `parseQuery` structured output
   (`itemClauses`, `setTerms`) with defined OR/AND semantics and tests; `printingRows.js`
   (`expandItemRows`, refusal predicate, `printingArt`, `printingProducts`) with tests
   for the fallback chain, the Rainbow-art preference, dedupe, and ordering. Corpus test:
   run expansion + classification over the ENTIRE catalog and assert no throw and full
   finish-label coverage. Evidence: tests green; no behavior change visible.
3. **The bulk command.** [store] `planWantedItemBatch` + `addWantedItemsBulk` under
   `withExclusiveCollectionWrites`, per the §3.6 protocol, with the full test list
   INCLUDING the counterfactual rendezvous test (guarded 3 / control 2, exact). Evidence:
   tests; `npm run test:query` green.
4. **Owned-import writer contract.** [store] `importCollectionResolved` gains `foil`;
   `planCollectionImport` partitions annotated-and-valid lines into the direct-file
   bucket with catalog validation; the END-TO-END repository test (grammar -> preview ->
   plan -> writer -> ledger readback asserting exact slugs). Evidence: tests; the
   `2 Card [Beta] [Foil]` case stores `002:f`.
5. **One whole-paste plan.** [store + component] `itemLineGrammar.js`,
   `resolveWantList`, `batchWantPlan.js` (draft model, locked-finish validity, skip
   accounting), `ResolvePrintingsSheet` with atomic Cancel/Confirm (P8);
   `ListBulkAddSheet` becomes the draft's entry. Evidence: malformed-grammar cases
   (duplicate `[Foil]`, two set annotations, empty/unmatched brackets, 64-char token,
   qty 0/1000/fractional, unknown future annotation); round-trip test; exit parity
   (Cancel = backdrop = hardware Back = zero writes, verified in the component test);
   TalkBack pass over the checklist.
6. **Item-grain AddCardsSheet.** `grain` prop; per-printing rows with per-item art (P7);
   P6 row behavior; Foil toggle; item-keyed membership/selection; deterministic
   pre-cap ordering; the 1,000-row cap with its three mandatory signals; commit awaiting
   the bulk command with selection-retaining failure handling; the `+=`-honest copy.
   Evidence, immediately at this increment: **Pixel performance run** (release build:
   open sheet on empty query, scroll the capped 1,000-row list; `set:beta` 402-row list;
   no dropped-frame jank by inspection, no blank-on-scroll WebView artifacts);
   zero-image mode row stability; cap-signal test; 44px touch targets.
7. **Wishlist rows + card sheet.** `wishlistRows.js` grouping; `ListCardRow` twin-finish
   status line, per-existing-finish steppers, per-item thumb art; `onPeek(set)`; the
   split want control; the origin line (`printingProducts`, suppression rule);
   `printingArt` migration of `imageForSet`/`artForSet` (delete the slug heuristics);
   `WantPrintingSheet` finish availability. Evidence, at this increment: 200% font scale
   with two finish steppers visible and usable; TalkBack names
   (`Want Beta non-foil, one more` / `Want Beta foil, one more`; origin line reads as a
   sentence); 44px targets on both capsule segments; focus entry/restoration on sheet
   open/close; hardware Back and backdrop parity; zero-image stable heights.
8. **Docs, native, sweep.** `COMPENDIUM_FEATURE_MATRIX.md`, `COMPENDIUM_DATA_MODEL.md`
   (writers, grammar, Rainbow normalization, art resolver); full gate run
   (`test:codex`, `test:query`, `test:app`, `check:types`, `check:cycles`, `build`,
   `check:docs`); **native verification on device** (no automated gate exercises native
   SQLite): run the bulk command at 402 scale, the annotated owned import, and a paste
   Cancel on the installed release APK; `check:smoke` before merge.

Dependencies: 5 needs 1-3 (and 4 for the owned path); 6 needs 1-3; 7 needs 1-2 (its
writes stay on per-card chains). Increments 1-4 are pure/store and land without visible
change.

## 6. Resolved decisions

No open questions remain. Rulings on record:

1. **Owned import annotations - YES, optional, pickers as fallback.** Specified in §3.5,
   built in increments 4-5; the owned fallback may legitimately end uncategorised (owned
   only - the want side must always resolve or visibly skip).
2. **The render/select cap - 1,000, confirmed, clarity mandatory.** Three-signal
   acceptance criterion in §3.1; a silent truncation is a defect.
3. **Rainbow - a flavour of foil.** Exhaustive fail-closed normalizer + catalog-contract
   test (P6); the 4 dual promos collapse to one foil item; the 17 Rainbow-only promos are
   foil-only items. No storage change.
4. **Art follows the collector item.** P7 / §3.7; `printingArt` with the stated fallback
   chain and the Rainbow-art preference on collapsed items; the slug-sniffing helpers are
   replaced, not duplicated.
5. **Printing origins on the card sheet.** §3.4 / §3.7; `printingProducts`, shown
   whenever origins are anything beyond exactly `Booster`; display-only.
6. **Reclassified High-risk** with the full proposal contract below (Codex Major 8).

## 7. High-risk proposal contract

### 7.1 Assumptions and how each was validated

- Catalog finish labels are exactly `{Standard: 1539, Foil: 1528, Rainbow: 21}`, Rainbow
  only in set 999, dual foil+rainbow on exactly Sorcerer/Spellslinger/Druid/Witch, 5 of
  3,088 variants imageless, 11 distinct `product` values - VERIFIED by direct enumeration
  of the installed `public/catalog/cards.json` during this revision; the catalog-contract
  test makes the finish assumption self-checking forever.
- `withExclusiveCollectionWrites` semantics (admission close, admitted drain, fail-closed
  timeout, holder serialization) - read from `collectionWrites.js`, which documents and
  tests them; §3.6 builds on, not beside, that contract.
- `tx()` maps to parameterized execution on both runtimes (web sql.js statement loop;
  native `executeSet(statements, true)`) - read from `db.js`; see §7.6.
- `wishlistCards()` already returns per-item rows with `item_id`/`set`/`foil` - read from
  `ownedRepository.js`; the wishlist surface work is display-layer regrouping.
- Set codes are unique per card's `sets` array and `SET_LABEL` covers them - existing
  invariants of the catalog pipeline (`sets.js`).

### 7.2 Alternatives considered

- **Per-row finish picker instead of a sheet-level mode:** rejected - re-per-cards the
  decision P3 exists to batch; the 402 case degenerates again.
- **Virtualization library for the add list:** rejected - offline bundle cost and a new
  dependency against a solved problem (`content-visibility` + a communicated cap).
- **MAX merge for the bulk writer:** rejected - hides repeat-add mistakes by silently
  absorbing them; `+=` with honest copy keeps the ledger auditable and matches the
  stepper semantics. MAX remains where idempotence is the point (`addMissingToWishlist`).
- **Tracking Rainbow as a third stored finish:** rejected - the ledger is binary by the
  settled v11 decision; a third finish is a schema migration with product-variant scope
  creep, while normalize-to-foil plus per-item art and origins preserves the user-visible
  distinctions.
- **Keeping the slug-suffix art heuristics beside `printingArt`:** rejected - two art
  resolvers drift; the heuristics are deleted at the migration increment.
- **Bulk writes on per-card chains (rev 3):** rejected by Codex Major 2 - see §3.6.

### 7.3 Text-format compatibility and versioning

- The grammar is line-local and ADDITIVE: bare `qty name` remains valid forever
  (Curiosa-compatible), and every annotation is an optional trailing token. A future
  token added to exports is, to this build, an unknown set annotation: flagged into
  review/resolver, resolved by a human, never dropped - degradation is visible, not
  silent. A future change that cannot ride that path must define a NEW bracketed token
  and document it in `COMPENDIUM_DATA_MODEL.md`; there is deliberately no version header
  (a pasteable format must survive retyping).
- **Known cost, stated:** a Compendium export with annotations pasted into an OLDER build
  fails name resolution on annotated lines (the old parser treats `[Beta]` as part of the
  name) and reports them as unknown - surfaced, recoverable by stripping annotations, but
  not seamless. Accepted: exports target same-or-newer builds; Curiosa-facing exports are
  unchanged.

### 7.4 Rollback and recovery

- Increments 1-4 are pure/store and independently revertible; nothing user-visible
  depends on them until 5-7 land. Each increment is one reviewable commit; reverting a UI
  increment restores the previous surface without data impact.
- No schema change and no migration: rolling back the BUILD never strands data. Wants
  written by the new paths are ordinary v11 collector items, fully readable by the
  current release.
- The bulk command is confirmed-or-nothing; a mid-command crash leaves the transaction
  unapplied and the queue recoverable (the barrier holder's `finally` reopens admission).
- Recovery from a bad paste: `+=` semantics mean an accidental double-commit is visible
  (counts doubled) and reversible by the same surfaces (steppers, clear), and the honest
  copy makes it noticeable at commit time.

### 7.5 Security and input bounds

- All user text reaches storage as bound parameters only; the grammar builds data, never
  SQL. XSS posture unchanged (no user text rendered as HTML).
- Bounds (all defined in §4): 2,000 lines per paste, qty 1..999 per line, 64-char
  annotation tokens, safe-integer validation on merged totals at the durable boundary.
  Adversarial pastes (unmatched brackets, giant tokens, absurd quantities, unknown
  annotations) are covered by named tests at increment 5.
- The bulk boundary re-validates everything the UI already refused (card reality, set
  membership, finish availability, quantity sanity) - UI courtesy, boundary guarantee.

### 7.6 Cross-runtime (Android native vs web sql.js) parity

- The bulk transaction and the extended owned import use `tx()` exclusively:
  parameterized statements via `executeSet(..., true)` on native and the statement loop
  on web - the exact path `importCollectionResolved` already ships on device under v11.
- `exec()` is NEVER used for these writes: the native splitter is quote-unaware and
  `exec()` cannot run parameterized statements - the known native gotcha that bricked a
  v11 boot is stated here so no reviewer has to rediscover it.
- No automated gate exercises native SQLite; therefore increment 8 REQUIRES manual device
  evidence: the 402-item bulk command, an annotated owned import, and a Cancel that
  writes zero, all on the installed release APK, plus `check:smoke` before merge.

### 7.7 Documentation impact

- `COMPENDIUM_DATA_MODEL.md`: `addWantedItemsBulk` + `planWantedItemBatch`, the
  `importCollectionResolved` contract change, the line grammar, Rainbow normalization
  and the catalog finish contract, the single art resolver.
- `COMPENDIUM_FEATURE_MATRIX.md`: item-grain add flow, wishlist finish rows, split want
  control, origin line, export format.
- `DESIGN_SYSTEM.md`: the split-capsule control pattern and the finish/`FOIL ONLY` tag
  vocabulary, if accepted as reusable primitives.
- `check:docs` gates the mechanical parts as usual.

### 7.8 Self-Critique

- **Collection.jsx keeps growing.** Item grain lands more logic in a ~1,600-line file.
  Mitigated by pushing everything pure into `printingRows` / `batchWantPlan` /
  `wishlistRows` (the established UI-state extraction pattern), but the JSX surface
  itself still thickens; a future extraction of `AddCardsSheet` into its own file is
  likely owed and is NOT smuggled into this work.
- **The barrier makes big adds honestly slower.** Select-all Add now waits for in-flight
  stepper writes to drain (up to 4s worst case) and holds row writes during the
  transaction. That is the correct trade (a visible wait over a silent lost update), but
  it is a trade, and the pending CTA state exists because of it.
- **The dual-arm counterfactual test is intricate.** It encodes the race it protects
  against; if the queue internals change shape the control arm may need rework. Accepted:
  it is the only test that proves the barrier is load-bearing rather than decorative.
- **The suppression rule for the origin line** (`anything beyond exactly Booster`) is a
  judgment call; if players want provenance on every card it is a one-line rule change,
  and the helper does not care.
- **Row grouping by (card, set) hides the item_id grain one level down.** Two finishes
  share a row; the steppers re-derive the exact item. The mapping is pure and tested, but
  it is a place where a future edit could regress finish targeting - named here so review
  watches it.
- **The 1,000 cap is a heuristic**, owner-confirmed but not yet profiled; increment 6's
  Pixel run is where it earns or loses the number, and the three-signal criterion already
  covers whatever the value becomes.

### 7.9 Approval record

- Rev 1 core model (per-printing rows, set-scoped filing, foil as mode, checklist
  resolver, per-item wishlist rows): approved by owner, 2026-07 review cycle.
- Rev 2 rulings: direct card-sheet foil control; symmetric per-item export/import; bulk
  writer built this round - owner, same cycle.
- Rev 3 rulings: owned-import annotations optional with picker fallback; 1,000 cap with
  mandatory clarity - owner, same cycle.
- Rev 4 rulings (2026-07-22): Rainbow normalizes to foil with fail-closed normalizer and
  catalog-contract test; art follows the collector item; printing origins on the card
  sheet. High-risk reclassification per Codex review.
- PENDING: Codex adversarial review of rev 4; owner sign-off on the final disposition
  before any implementation begins.
