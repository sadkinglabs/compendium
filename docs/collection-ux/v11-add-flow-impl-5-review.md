# Codex review - add-flow implementation, increment 5 (re-review)

**Branch:** `collection-add-flow`, pushed at `dd04fd0`.

## Re-review: your four Majors + Minor + perf, addressed (`4b08df1..dd04fd0`)

- **Major 1 (finish for all ignored resolved rows).** The planner now models every recognized line
  as a row with a set that is FIXED or a CHOICE, and ONE finish policy governs both: a fixed row
  follows the batch finish unless the line carried an explicit `[Foil]` lock; foil-only files forced
  foil; a Foil batch over a no-foil fixed set visibly SKIPS it. `resolveWantList` fixes only the SET
  and defers finish. `Finish for all` shows whenever any line is not explicitly locked. Tests: mixed
  resolved/choice, resolved-only, explicit `[Foil]`, forced foil-only, fixed-set no-foil skip.
- **Major 2 (dismissal race).** Phase machine `idle | reading | committing` mirrored in a ref; one
  `requestClose` for Cancel/backdrop/drag/back that abandons + reports zero before Confirm. New
  `GothicSheet` `dismissible` prop (default true) - mid-commit the sheet is non-dismissible (back is
  consumed, not leaked), controls lock, `aria-busy` set. The "close at any time" wording is corrected
  to a stated point of no return once the transaction begins. No trivial-helper-as-evidence.
- **Major 3 (rows converging on one printing double-counted).** `planWantDraft` canonically merges
  the commit plan by `(card, set, foil)`, concatenating parts; `addCount`/`commitItems` derive from
  the merged plan. Tests: resolved+chosen converge, two choices converge, foil/non-foil stay two.
- **Major 4 (unknown-only paste never reviewed).** `hasReviewContent` (pure, tested unknown-only /
  flagged-only / header-only); review opens whenever anything is recognized/unknown/flagged.
- **Minor.** `Set for all` reports pressed state (`aria-pressed` + gold treatment) when every
  eligible row resolves to that set; production injects `catalogSetRank`; `#c9b487` -> design tokens.
- **Perf.** `resolveWantList` batches unique names via chunked `IN (...)` into a map; rows carry
  `contentVisibility:auto` + `containIntrinsicSize`.

Mutation-checked as you asked: disabling the canonical merge fails the convergence tests; ignoring
the batch finish fails the finish-mode tests.

**Re-review range:**

```
git fetch origin
git diff 7912b1f..dd04fd0          # against the increment-5 base
git diff 49349ac..dd04fd0          # just the corrective pass
```

---

## Original handoff (context)

**Pushed at `49349ac`** (superseded).

**What this is:** the whole-paste wishlist flow (brief §3.2 / §3.5) - the first primarily-visible
increment. A pasted wishlist becomes ONE draft the user resolves over the whole paste, committed by
ONE `addWantedItemsBulk` transaction. Two commits: the store/pure foundation (`a701170`) and the
`WishlistImportSheet` component + wiring (`49349ac`).

**Review range:**

```
git fetch origin
git diff 7912b1f..49349ac          # 8 files
git log --oneline 7912b1f..49349ac
```

New source: `batchWantPlan.js` (pure draft planner), `wantImport.js` (`resolveWantList`),
`WishlistImportSheet` (in `Collection.jsx`). Modified: `ownedRepository.js` (the folded-in
alias-merge Minor), the wishlist wiring in `Collection.jsx`.

## Also folded in: your approved increment-4 Minor

`previewCollectionText` (owned import) now merges resolved lines by canonical identity
`(card_id, resolved setCode, resolved foil)`, so `Card [Beta]` + `Card [002]` are ONE review row /
one printing, while `Card [Beta]` + `Card [Beta] [Foil]` stay two. `resolveWantList` uses the same
identity. Tests added on both paths (`[Beta]`+`[002]` -> one item/two copies).

## Where to attack hardest

**The pure planner (`batchWantPlan.js`).** Every sheet decision is computed here so it is provable
without a DOM. The invariants that must not regress:

- Nothing defaults to a silent set - an unchosen row has `status: 'unchosen'` and BLOCKS the CTA
  (`ready:false`). Is there any row shape that reaches a committable state without an explicit set?
- Finish is never downgraded (P3): a foil-only chosen set files forced foil (`forcedFoil`); a Foil
  batch marks a no-foil row `skipNoFoil` (excluded, counted, reversible), never files it non-foil.
  An impossible `[Foil]` lock (`lockedFinish:'foil'` + `anyFoil:false`) is `lockImpossible` until an
  explicit `nonFoil`/`skip` override. Can a downgrade slip through any combination of batch finish,
  per-row choice, and override?
- A want is NEVER uncategorised - there is no Unspecified option here (unlike the owned import).
- Parts expand so `999 + 999` reaches the writer as two contributions; `addCount` counts collector
  items, not the expanded parts. Confirm the count/label honesty.

**The resolver (`wantImport.js`).** `resolveWantList` returns `{ resolved, needsChoice, unknown,
flagged }`. Single-set lines resolve silently (P6 foil-only upgrade); a bare multi-set line becomes
`needsChoice` (never silently one set, never uncategorised); an annotation naming a set that lacks
the finish becomes `needsChoice` with a reason and the intended `lockedFinish`; malformed lines are
`flagged`; unknown names surfaced. The 2000-line ceiling is enforced before any catalog query. Is
there a line that resolves to an item the durable writer would then reject (a preview/writer
disagreement)? Note `resolveWantList` reads finishes permissively (via `expandItemRows`) and
`addWantedItemsBulk` re-checks strictly - is that the right split, and does any resolvable row fail
the strict re-check?

**The component (`WishlistImportSheet`).** Thin over the planner. Confirm captures the profile at
the gesture and carries the write-outcome contract (indeterminate failure reported honestly, sheet
retained, never auto-retried). The commit set is exactly `planWantDraft(...).commitItems`.

## A limitation to weigh, not hide

**There is no DOM render harness in this repo.** `test:ui` runs `node --test` over pure `.mjs`
modules; nothing renders React (no jsdom / testing-library - checked). So the brief's "exit parity
verified in the component test" cannot be a render test here. It is instead:

- **Structural:** `BottomSheet` -> `GothicSheet` routes backdrop tap and hardware back to `onClose`;
  `onClose` only resets state; the SOLE writer is `confirm()`, gated on `view.ready`. No exit path
  reaches a write.
- **Device evidence (this increment, still owed):** the actual Cancel/backdrop/back gesture parity
  and the TalkBack pass over the checklist are manual on the Pixel - aria labels and `aria-pressed`
  are in place. I have not run that pass yet; flagging it rather than claiming it.

If you want a stronger executable guarantee than "structural", I can extract the confirm-gate and
exit contract into a pure helper and test it - tell me if that is worth a follow-up.

## Gates (all green)

`test:query` 650, `test:ui` 148, `test:app` 17, `test:codex` 10, `check:cycles` 125 modules,
`check:types`, `check:docs`, `build`. No control bytes.

## Device pass - the standing gate before increment 6

Per your direction, the Pixel / TalkBack pass runs BEFORE increment 6 (this is the first visible
implementation of patterns increment 6 reuses). It is manual on the owner's device; the checklist:
Cancel/backdrop/drag/back write zero and toast "Nothing added"; Confirm-in-progress locks controls
and dismissal; TalkBack announces Finish-for-all and Set-for-all pressed state, each set option,
forced-foil and skipped rows; keyboard focus containment/restoration; a large ambiguous paste
scrolls without blank rows; unknown-only / flagged-only / all-resolved / mixed / all-skipped drafts.

## Not in scope

Increments 6-7 (the item-grain `AddCardsSheet` and the wishlist rows + split card-sheet want
control) and increment 8 (docs + native device sweep). The wishlist DETAIL rows still render the
pre-v11 way; this increment only changes the paste/resolve path into the wishlist.
