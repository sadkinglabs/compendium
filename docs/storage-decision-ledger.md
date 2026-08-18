# Storage: every decision, against what I actually built

Compiled 2026-08-18 from the design session transcript
(`2bb3eac1-6aa5-4211-8b02-a5a5d907a9e2.jsonl`, 102 owner turns) and the approved proposal
`docs/proposals/collection-storage.md`. Every row is quoted evidence, not recollection.

Scope: **increment 3, the first UI**. Increments 1 and 2 (data layer, export/import) are separately
reviewed, gated and device-verified, and nothing below touches them.

---

## The root cause

The proposal cites `(Q1)`, `(Q7)`, `(Q13)`, `(Q30)` and a dozen more as settled authority. **Their
content was recorded nowhere in the repository** - it lived only in the design conversation. So the
implementation was written against citation numbers whose text had never been read. **Six of the
nine divergences below trace directly to that.**

Fixed: the thirty answers, their four owner amendments, and the supersessions from the r3 model
reversal are now recorded in the proposal as **Appendix A**. A citation resolves.

The other three divergences have no such excuse - they contradict text that was in the proposal body
all along.

---

## Divergences: nine

### Placement and chassis

| Decision | Evidence | Built |
|---|---|---|
| Storage sits **inside My Collection**, Sets on top, Storage **below**; "keeps the chip row at **three**" | owner, transcript 2855, agreed *in preference to a fourth chip* | A **fourth chip**. I rebuilt the option that was explicitly rejected in the same exchange |
| Container detail on **the same chassis as list detail** | **Q21**; Reuse inventory | A bespoke header and back button written from scratch |
| Container contents **searchable and arrangeable**, inheriting stacked sort "for free" | **Q21**; criterion 3; Reuse inventory names `stackComparator`, `SortRow`, `LIST_SORT_OPTIONS` | Neither. A plain list |

### The logic

| Decision | Evidence | Built |
|---|---|---|
| Unfiled is **pinned FIRST**, visually distinct | **Q15** | Placed **last**, under a section header |
| The name is **"Unfiled"**; "Loose" was rejected outright | owner, turn 83 | Section header **"LOOSE"**, plus "loose" three more times in copy |
| A kind **can change after creation** - "cards move from a deck into a box constantly" | **Q8** | Kind picker **hidden when editing**, and I wrote a comment justifying the opposite |
| Names need **not** be unique; **warn** on duplicate | **Q9** | Duplicates **rejected outright** |
| A container has **one short optional description line** | **Q12** | Column exists in the repository; **the sheet never collects it** |
| Ordering is **manual** via `sort_order` | **Q10** | `sort_order` written on create; **no reorder UI** |
| Kinds are Binder / Box / **Deck** / Other | **Q7** | Labelled "Deck box" |

That is ten rows for nine divergences - the Unfiled position and the word "Loose" are one screen,
two mistakes.

---

## Correct

| Decision | Evidence |
|---|---|
| Every copy in exactly one place; the collection is what the places add up to | the r3 reversal, and the only reason the tester's ask is representable |
| No drain, no conflict resolution, no guessing which copy left | Q4 as superseded; the resurrected policy was deleted in `6d63d67` |
| Delete returns copies to Unfiled with a confirmation stating the count; never deletes a card | **Q26** - 13 tests, the merge case verified by four counterfactuals |
| Unfiled is a real stored row, not derived | the r3 reversal |
| Colour folded in, from a closed allow-list, as a general primitive | owner: *"fold colour in now"*, superseding **Q11** |
| Zero state empty with a create prompt | **Q30** |
| Quantity on every container row | transcript 2860 - "without the number it reads as duplication or a bug" |
| No nesting, no capacity, no deck join | explicit non-goals |

---

## What increment 3 cannot do, and I should have said so

The story the feature exists for -

> "if I have 4 copies of a card from Beta, I would like to allocate 1 copy to my Beta binder,
> 2 to my whatever deck, and 1 in my storage box"

- **cannot be done in what I built.** Per **Q16** the primary gesture is a **stepper in a per-card
ledger with a live remainder**, which is increment 4. Sequencing is per the approved plan, so the
deferral is legitimate; presenting a Storage screen without saying it cannot yet store anything was
not.

Related framing error of my own making: I described increment 5 as a "move flow" / "put-away flow"
in commits and in conversation. **Q16 rejects a move gesture explicitly** - four copies legitimately
sit in three containers at once, and calling it a move teaches the user the opposite. The words
should be allocate and file.

`placeStatements` and `planPlaceRemoval` were built and tested in increment 1 and still have no
caller.

---

## The correction, in order

1. Delete the fourth chip and the `view: 'storage'` route; render Storage as a section **below** the
   Sets grid inside My Collection.
2. Rebuild container detail on the list-detail chassis, inheriting its header, overflow, search and
   stacked sort.
3. Unfiled **first**, visually distinct. Remove every instance of "loose".
4. Kind editable after creation (**Q8**); duplicate names **warn**, not refuse (**Q9**); collect the
   description line (**Q12**); "Deck" not "Deck box" (**Q7**).
5. Manual reorder (**Q10**).
6. Then increment 4: the per-card ledger with a live remainder, which is what makes the feature work
   at all.

`storageDirectory.js` and its 13 tests, and `SwatchPicker`, are unaffected by all of it and stay.

---

## Process

I read §199 in the session, quoted the reuse inventory in the session, and still built a fourth chip
with a bespoke detail screen. Three failures, in order of how much they cost:

1. **I never diffed the build against the spec before presenting it.** The check that catches all
   nine takes minutes and belongs before "here it is".
2. **I treated unresolvable citations as if they were resolved.** Reading `(Q15)` and building
   anyway is guessing with extra confidence. The appendix removes the excuse; the habit was the
   defect.
3. **I let the plan's increment boundaries stand in for the user's goal.** Shipping a Storage screen
   that cannot store is defensible against §450 and indefensible against the tester's sentence.
