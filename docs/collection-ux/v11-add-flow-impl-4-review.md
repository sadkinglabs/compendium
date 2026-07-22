# Codex review - add-flow implementation, increment 4

**Branch:** `collection-add-flow`, pushed at `f386113`.

**What this is:** the text line grammar and the hardened OWNED text-import writer, against the
rev-4.1 brief §3.5. No new components - the existing Import to Collection sheet now files annotated
lines directly and carries foil, because the store layer beneath it changed. Increment 4 is the
second durable-write increment (the first was the want command).

**Review range:**

```
git fetch origin
git diff b75e0d1..f386113          # 10 files
git log --oneline b75e0d1..f386113
```

New source: `bulkWriteContract.js`, `itemLineGrammar.js`, `ownedImportRepository.js`. Modified:
`ownedRepository.js` (previewCollectionText annotation-aware; old writer removed), `importPlan.js`
(routing + foil), `wantedBulkRepository.js` (re-exports the extracted contract), `Collection.jsx`
(new writer, pid capture, honest failure copy).

## Where to attack hardest

**The hardened writer (`ownedImportRepository.js`).** This replaces a shipping writer that wrote
without a barrier or validation. Same protocol as the want command, so please confirm the same
guarantees hold here and I did not weaken any in the port:

- `planOwnedItemBatch` rejects the WHOLE batch before SQL. Can any impossible item reach the
  upsert? The owned-only asymmetry is deliberate: an EMPTY setCode is VALID (uncategorised owned),
  a nonempty setCode must be in the card's sets AND carry the finish via the strict
  `printingFinishes`. Is the uncategorised branch a hole - e.g. can a forged item smuggle a bad
  card_id through the empty-setCode path? (It still requires the card to exist; please verify.)
- The write-outcome contract: an apply-then-reject `tx()` must yield `transaction`/`unknown`,
  broadcast, and never claim nothing-written. Is `ranTransaction` set at the right instant?
- The counterfactual (guarded 3 / control 2) and the production-wiring test are the load-bearing
  ones. I mutation-checked the wiring test - it FAILS when production is rewired to a pass-through
  (verified, then restored). Please confirm the two counterfactual arms force the two orderings and
  that the control cannot reach 3.

**The resolution seam (`previewCollectionText` -> `planCollectionImport` -> `buildImportItems`).**
The chain that turns text into write items. Attack the routing:

- `resolveLinePrinting` decides DETERMINED (files directly) vs review. P6 is implemented here: a
  bare single-set line resolves to foil when the sole printing is foil-only (Winter River), so it
  files 001:f, not a non-foil phantom the writer would reject and fail the whole batch on. Is there
  a line shape that resolves to an item the writer then rejects (a preview/writer disagreement)?
  The strict `printingFinishes` throw is caught here and read as "not determined" - is that the
  right degradation, and does it match what the writer will strictly re-check?
- The merge key is `(name, set annotation, finish)`, so `2 Card [Beta]` and `1 Card [Beta] [Foil]`
  stay distinct. Any way two genuinely different collector items collapse, or one splits?
- `buildImportItems` emits an explicit boolean `foil` on every item; the writer rejects a
  non-boolean. Confirm no path emits a non-boolean or drops foil.

**The grammar (`itemLineGrammar.js`).** Pure, catalog-free.

- Annotations peel from the END in either order; empty `[]` and an unmatched `[` stay in the name;
  duplicate `[Foil]`, two sets, and an over-long token are FLAGGED not dropped; qty out of range is
  flagged not clamped. The exhaustive malformed enumeration is increment 5's evidence (the resolver
  consumes these flags); increment 4 pins the well-formed grammar + the format/parse round trip. Is
  the peel loop safe against a pathological input (only brackets, nested-looking `[a[b]`)?
- `formatItemLine` emits set then finish so a re-import round-trips. Confirmed by a round-trip test.

**The extracted contract (`bulkWriteContract.js`).** `bulkWriteError` + the two bounds moved out of
`wantedBulkRepository.js`, which now re-exports them. This touches a file you already approved - the
intent was one definition both commands share rather than owned importing from wanted. Is the
extraction faithful (no behavior change) and the re-export sound?

## Gates (all green)

`test:query` 605, `test:app` 17, `check:cycles` 123 modules, `check:types`, `check:docs`, `build`.
No control bytes. Native/device evidence stays deferred to increment 8 per the brief (no automated
gate exercises native SQLite); the end-to-end test drives the real chain against in-memory sql.js.

## Not in scope

The visible surfaces (increments 5-7): the wishlist paste resolver + `ResolvePrintingsSheet`, the
item-grain `AddCardsSheet`, and the wishlist rows / split want control. The owned review sheet's
finish handling for a foil-only set the user explicitly picks non-foil is an increment 5-7 UI
refinement; the store layer already rejects the impossible item rather than filing a phantom.
