# Codex review brief: Curiosa re-sync (post-merge)

**Scope directive from the owner: this is a small feature that works - bolster it briefly,
do not re-engineer it.** The feature is merged to main (`8c4cb93`, feature commit
`5a0d360`), device-verified on build 230, and in daily-drivable shape. You are looking for
correctness holes and small hardening wins, not architecture.

## What to read

- The exact change: [`curiosa-resync.diff`](./curiosa-resync.diff) (code + tests only,
  881 lines; docs excluded).
- Design + decisions record: [`curiosa-resync.md`](./curiosa-resync.md) - the Self-Critique
  and Risks sections list what the author already distrusts.
- Code, in review order: `src/store/curiosaDiff.js` (pure diff), `deckRepository.js`
  (`curiosaQuery` hardening, `planCuriosaSync`, `commitCuriosaSync`, `uniqueDeckName`
  exclude-self), `src/pillars/DeckDashboard.jsx` (`CuriosaSyncSheet`, `CuriosaUrlCard`).

## The feature in five lines

A Sync pill on the deck's Curiosa URL card re-polls the saved URL. `planCuriosaSync` is a
read-only fetch + name-resolution + diff (name / adds / removes / qty / avatar /
unrecognised / over-copy-limit). A sheet shows the diff; confirming calls
`commitCuriosaSync`, which re-reads local state, re-derives deltas from the plan's
`remoteTarget`, and applies everything in ONE `tx()` including the deck-log row. Notes are
never written; the deck name follows Curiosa through the profile-unique dedup rule.

## Where adversarial eyes are most valuable (ranked)

1. **`commitCuriosaSync` delta builder.** Duplicate (zone, card) rows collapse into the
   first row; `changes` counts only when the aggregated total differs; the decks UPDATE is
   composed from `sets`/`setParams`. Look for: a remote/local shape that miscounts, deletes
   the wrong row, or escapes the single-transaction guarantee. The atomicity test injects a
   failure on the history INSERT only.
2. **Rename loop-safety under races.** Plan resolves the effective name via
   `uniqueDeckName(base, excludeId)`; commit re-dedups against fresh state. Is there an
   interleaving (deck created/renamed between plan and commit, case-only differences) that
   renames wrongly or re-proposes forever?
3. **`curiosaQuery` error classification.** Native branch now checks HTTP status; body
   errors map via `item.error?.json?.data?.httpStatus`; a null `deck.getById` means
   deck-gone (Curiosa answers dead ids with 200 + null + empty list - device-verified).
   Is there a 200-shape that still slips through to a wrong diff rather than an error?
4. **Placeholder rows (`card_id NULL`).** They are excluded from diff and commit and only
   counted. Convince yourself no sync path can delete, duplicate, or double-count them.
5. **Sheet is presentation-only.** Commit consumes `plan.remoteTarget`, never the rendered
   diff rows. Confirm no state can make the sheet show one thing and commit another
   (beyond the documented plan-staleness re-diff, which converges on the remote).

## Already decided - do not re-litigate

Owner decisions, recorded in the proposal: over-limit copies are written VERBATIM and
flagged, never capped; unresolved remote names are shown but skipped (anonymous NULL
placeholders can't be reconciled); no snapshot/undo in v1; collection-size (10/11)
overflow is accepted and not yet surfaced; name syncs, notes never.

## Evidence already in hand

33 new tests: `curiosaDiff.test.mjs` (pure diff, over-limit helper) and
`curiosaSync.test.mjs` (atomicity via injected mid-tx failure, idempotency, variant_slug
survival, duplicate collapse, rename dedup settling, profile-scope refusal, and two
regressions pinning the dead-URL-as-200+null classification for sync AND import). Full
gates green at merge: test:codex 10/10, test:query 1053/1053, test:app 17/17, check:types,
check:cycles (157 modules), build, check:docs. Device pass on build 230 covered: import,
in-sync breadcrumb, full diff sheet, verbatim over-limit write, offline error, dead-URL
error, cancel-writes-nothing.

## Requested disposition

Findings as **Blocking** (data loss / wrong write possible) / **Should-fix** (real but
contained) / **Nit**, each with file:line and a concrete failing scenario. Given the scope
directive, prefer the smallest correct fix over redesign; anything architectural goes in a
follow-up note, not a demand.
