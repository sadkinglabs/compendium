# Codex review - add-flow implementation, increment 5

**Branch:** `collection-add-flow`, pushed at `49349ac`.

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

`test:query` 649, `test:ui` 148, `test:app` 17, `test:codex` 10, `check:cycles` 125 modules,
`check:types`, `check:docs`, `build`. No control bytes.

## Not in scope

Increments 6-7 (the item-grain `AddCardsSheet` and the wishlist rows + split card-sheet want
control) and increment 8 (docs + native device sweep). The wishlist DETAIL rows still render the
pre-v11 way; this increment only changes the paste/resolve path into the wishlist.
