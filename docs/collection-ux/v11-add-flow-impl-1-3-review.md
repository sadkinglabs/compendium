# Codex review - add-flow implementation, increments 1-3

**Branch:** `collection-add-flow`, pushed at `2403329`.

**What this is:** the first three (pure/store) increments of the add-flow build, against the
rev-4.1 brief you approved. No UI, no visible change yet - these land the data primitives the
surfaces will sit on. Increment 3 is the durable-write one.

**Review range:**

```
git fetch origin
git diff d9d2201..2403329          # 7 files, +910 / -3
git log --oneline d9d2201..2403329
```

Three commits: increment 1 (Rainbow finish semantics), increment 2 (structured query +
row/art/origin helpers), increment 3 (bulk want command). New source: `printingRows.js`,
`wantedBulkRepository.js`. Modified: `cardQuery.js` (structured output) + `COMPENDIUM_DATA_MODEL.md`.

## Where to attack hardest

**Increment 3 - the bulk want command (`wantedBulkRepository.js`).** This is the durable-write
piece and the one most able to reopen a defect class.

- The two concurrency tests were BOTH vacuous on the first pass and I fixed them only because the
  mutation check failed. Stated plainly so you verify the fixes are real, not that I say they are:
  1. The counterfactual was NOT sensitive to the barrier. The command writes with an atomic SQL
     `+=`, which has more await-depth than the racing absolute write, so the bulk wrote last
     regardless of the barrier - guarded gave 3 either way. The `lostUpdateScenario` determinism
     argument silently does not hold for an atomic-increment command. Rewritten with a gated tx +
     gated absolute write so guarded=3 / control=2 are deterministic and differ ONLY in
     `exclusive`. Please confirm the two arms genuinely force the two orderings and that a
     pass-through `exclusive` cannot reach 3 in the control arm.
  2. The production-wiring test passed even with production wired to pass-through (the exact trap
     you named). Rewritten to assert production BLOCKS behind a held barrier write, using a
     settle-bounded negative (the codebase's blessed shape in `collectionWritesExclusive.test`).
     Mutation-verified it fails under a pass-through. Please confirm the settle bound is anchored
     to a real milestone and the negative is sound.
- The write-outcome contract (`{ phase, writeState }`): a `tx()` that applies-then-rejects (the
  web commit-then-persist hazard) must yield `transaction`/`unknown`, broadcast, and never claim
  nothing-written. Is the `ranTransaction` flag set at the right instant - i.e. is there any
  throw path between "rows may have changed" and the flag that would mis-classify as `prewrite`?
- `planWantedItemBatch` validates card existence, set membership, finish availability (via the
  normalizer), and qty bounds, rejecting the whole batch before SQL. Can any impossible or
  uncategorised item reach the upsert? The catalog read is inside the holder - confirm validation
  and write see one world.

**Increment 1 - the fail-closed normalizer.** `normalizeFinishLabel` throws on any label outside
`{Standard, Foil, Rainbow}`; the catalog-contract test fails the build if the catalog gains a
fourth. Mutation-verified (forgetting Rainbow fails both the contract and the corpus). Is the
contract genuinely exhaustive, and is the non-throwing `finishCategory` (used by art/origins)
correctly NOT weakening the availability path (which must stay fail-closed)?

**Increment 2 - structured query + helpers.**
- `parseQuery` gains `setTerms` / `itemClauses` while `clauses` stays byte-compatible for existing
  consumers. `matchesSetTerms`: OR across `set:` tokens, comma-AND within one value. Any way a
  set token leaks into `itemClauses` (which would keep all a card's printing rows)?
- `printingArt` returns a SLUG, never a URL - rendering routes through `cardImageUrl` (the single
  bundled-vs-CDN seam) so this is CDN-ready by construction (the owner is planning an art CDN;
  data stays local). Confirm no hardcoded path leaked in.
- `printingRows.js` deliberately does NOT import `sets.js` (which pulls the set-catalog JSON and
  breaks raw `node --test`); `setRank` is injected with a numeric-code default that equals the
  app's `SET_RANK` for every set, and production passes the real one. Is that decoupling sound,
  or does the default risk drifting from `SET_RANK` for a future set code?

## Gates (all green)

`test:query` 545, `check:cycles` 120 modules, `check:types`, `build`. No control bytes. `test:ui`
/ `test:app` unaffected (no UI yet). Native/device evidence is deferred to increment 8 per the
brief, since no automated gate exercises native SQLite.

## Not in scope

The design (rev 4.1) is approved and unchanged. Increments 4-8 (owned-import writer, resolver
UI, the visible surfaces, docs/device sweep) are not built yet.
