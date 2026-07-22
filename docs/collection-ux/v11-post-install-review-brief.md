# Codex review brief - v11 post-install

**Branch:** `schema-v11-refurb`, pushed, in sync with origin at `99bb669`.

**Review range - three commits you have not seen:**

```
git fetch origin
git diff e35e4fb..99bb669          # 7 files, +230 / -26
git log --oneline e35e4fb..99bb669
```

Your last review (of `e35e4fb`) ended at "not safe to install" with four findings. This range
is (a) the fixes for those findings and (b) one device failure and its fix. It is small; read
it whole.

## Material change of state

**The app is installed on the Pixel at build 141 and the migration has RUN.** This review is
post-install. First boot canonicalised the live ledger in one transaction; it booted, so the
in-transaction assertion (a deliberate PK collision that fires if any legacy key survives)
passed - i.e. zero legacy keys remain and `_meta.owned_cards_canonical_version=11` was written
atomically. `check:smoke` renders 8 routes on the converted ledger. This is past the point of
no return; there is no down-migration.

## What changed, and what to scrutinise

**`3576668` - fixes for your four findings. Verify they are REAL, not merely present.** This
branch has twice shipped a "fix" that did not fix: a queue test that reproduced the intended
keys by hand rather than exercising the callers, and an anchored import edit that silently
no-opped. So:

1. **The write chain.** Both the card sheet and the Wishlist rows are meant to serialise want
   edits through ONE chain. They now both call `queueWantWrite(pid, cardId, fn)` in
   `ownedRepository.js`. Confirm there is no remaining `ownedRowKey`-keyed **want** write on
   either surface (the one left in `Collection.jsx` is an ownership write - confirm that too).
   The interleaving test in `wantedItems.test.mjs` now drives the production helper and has a
   counterfactual that finishes at 2 unqueued.
2. **The `useReducer` crash** (opened any card sheet -> ReferenceError, passed every gate). Fixed
   import. New `hookImports.test.mjs` sweeps every `.jsx` for hooks called without import;
   mutation-checked (removing the import fails the guard while `build` stays green). Judge
   whether the guard is sound and non-vacuous.
3. **Add variants** in `Collection.jsx`: existing unique want reused for any delta (not only
   removals); pending picks are a FIFO queue so a multi-select of several reprints asks about
   each; add-from-text routes through `addStep` so an ambiguous reprint opens the picker instead
   of being announced-then-failed. These are UI-state paths with no render test - scrutinise the
   logic directly.

**`99bb669` - the device failure.** The v11 migration was `SELECT 1;`. Native `exec()` maps to
Android `execSQL()`, which refuses queries; sql.js `run()` accepts them, so every gate passed
and it only failed on install. No data was at risk (version bumps after `exec` succeeds;
canonicalisation runs after `openDatabase` resolves). Migration 11 is now a real idempotent
`CREATE INDEX IF NOT EXISTS`. New `schemaExec.test.mjs` forbids any query-shaped statement in a
migration, requires `IF NOT EXISTS` on every `CREATE`, and checks `SCHEMA_VERSION`.
Mutation-checked. Assess whether the index is the right DDL and the guard closes the class.

## Honest limits of this evidence

- **No component has been render-tested.** The guards catch undefined identifiers and bad DDL;
  they do not prove the card sheet opens, the picker appears, or the Wishlist shows two rows.
  The human exercised boot + basic navigation on device; most interaction paths are unverified.
- Every gate is green (`test:query` 496, `test:ui` 136, `test:app` 17, `test:codex` 10, types,
  cycles, docs, build, smoke) - and on this branch green gates have repeatedly coexisted with
  runtime defects. Weight accordingly.

## Known-open, do NOT re-raise as new

- Wishlist **export is name-only** (cannot express set/finish). Deferred follow-up.
- Triage **loses a note** on a fully drained source row. Owner-accepted alpha debt, recorded in
  `triageRepository.js` with the fix.
- Boot-order test is line-based; injected-sequence version deferred as non-blocking.
- `Collection.jsx` splitting deferred.
- Completion milestones (set / master set / playset) unbuilt; **Alpha's non-foil denominator is
  a live wrong number** (403 achievable vs 404 denominator - Winter River is foil-only).

## Ask

Confirm the four fixes are genuine and the two guards hold, or name what is still wrong. This is
the final review gate before the branch is considered done; migration, schema and the device
install are not being reopened.
