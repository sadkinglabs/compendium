# Proposal: Curiosa re-sync - one-way refresh of an imported deck from its saved URL

## Status and classification

Merged to main 2026-08-14 by owner direction after a joint on-device pass (build 230).
Codex pre-merge review was waived by the owner; a post-merge review remains welcome.
Risk: **Standard** - mutates user deck data behind a confirm step; no schema change; additive UI.
Owner: project owner. Author: Claude (lead engineer). Reviewer: Codex (principal engineer).

## Problem and success criteria

Decks imported from Curiosa.io keep their source URL (`decks.curiosa_url`), but the link is
inert: to pick up upstream changes the user must re-import into a *new* deck and lose local
state (log, notes, name, variant picks, win/loss). Users have asked to re-poll the saved URL
and one-way-sync Curiosa -> Compendium in place.

Acceptance criteria:

1. A deck with a saved Curiosa URL offers a Sync action in its dashboard URL card.
2. Sync fetches the current Curiosa list and shows a diff (added / removed / quantity
   changed / avatar change / unrecognised names) before anything is written.
3. Confirming applies the whole change in **one transaction**; cancelling writes nothing.
4. The deck log records every applied sync. The deck name follows Curiosa (owner
   amendment 2026-08-14: versioned upstream names, e.g. "Fire v2", flow through),
   de-duplicated per the app-wide rule and loop-safe (a "(1)" suffix that lands back on
   the current name is no change, not a rename proposed on every sync). Notes are never
   modified.
5. Failures (bad URL, offline, deck deleted/private, malformed response) surface a clear
   message and leave the deck byte-for-byte untouched.
6. `variant_slug` (per-printing choice) survives on every entry the sync does not remove.

Non-goals (explicit, so omission is not oversight):

- **Undo last sync / pre-sync snapshot.** Owner decision 2026-08-14: v1 is transaction-only;
  regret-undo is a separately scoped follow-up (interacts with replace-only restore semantics).
- Syncing notes, archetype, or stats. Two-way sync. Automatic/background sync.
  (Name sync WAS a non-goal in the approved v1; the owner amended scope on 2026-08-14.)
- A `last_synced_at` column or any schema change (deck log timestamps cover it).

## Evidence and current architecture

- URL storage: `decks.curiosa_url` (src/store/schema.js:74), edited via `CuriosaUrlCard`
  (src/pillars/DeckDashboard.jsx:225).
- Fetch path exists: `curiosaQuery(proc, id)` (src/store/deckRepository.js:538) wraps three
  tRPC procedures (`deck.getById`, `deck.getDecklistById`, `deck.getSideboardById`) via
  CapacitorHttp on native / the Vite `/curiosa` proxy on web.
- Import precedent: `importCuriosaUrl` (deckRepository.js:560) maps Spell->spellbook,
  Site->atlas, sideboard->collection, resolves names case-insensitively against `cards`,
  inserts unresolved entries as `card_id NULL` placeholder rows, applies via `tx()`.
- Plan/confirm precedent: `planImportText` / `commitImportText` (deckRepository.js:625/656)
  and the two-phase review sheet in `ImportTextSheet` (src/pillars/Decks.jsx:103) - the
  exact interaction and visual idiom (Section/Line rows) the diff sheet reuses.
- Deck log: `logHistory` + `HISTORY_CAP` trim (deckRepository.js:200-209); dashboard already
  re-renders log and zones off a `rev` counter (DeckDashboard.jsx:488).
- `deck_entries` columns: id, deck_id, zone, card_id, quantity, **variant_slug**.

Observed constraints:

- A wholesale delete-and-reinsert would reset `variant_slug` on cards the user didn't change
  upstream. The apply step must therefore be a **delta**, not a replace.
- Placeholder rows store no card name (`card_id NULL`, no name column), so they cannot be
  reconciled against remote names on a later sync.
- `curiosaQuery`'s native branch never inspects HTTP status; a 404 currently surfaces as a
  TypeError deep in payload unwrapping.

## Assumptions and confidence

1. Curiosa's unofficial tRPC endpoints keep their current shape. **Medium.** Validated at
   runtime: the plan step type-checks the payload (deck name string, array decklist) and
   fails with the "couldn't read Curiosa's response" message rather than a wrong diff.
2. For resolved cards, (deck_id, zone, card_id) is effectively unique locally. **Medium** -
   `changeQty` maintains one row, but a Curiosa list with duplicate rows would have imported
   as duplicates. Mitigation: the diff aggregates both sides by (zone, card_id) and commit
   normalises duplicates into a single row.
3. Sideboard entries all belong in `collection` regardless of category, matching import.
   **High** (mirrors `importCuriosaUrl`, side passed with `cat=null`).
4. Native CapacitorHttp path behaves as on import. **Medium** - browser proxy success is not
   native proof; device check required before merge (BUILD.md posture).

## Affected systems and invariants

- Repositories: `src/store/deckRepository.js` (new plan/commit functions, hardened
  `curiosaQuery`). New pure module `src/store/curiosaDiff.js`.
- UI: `src/pillars/DeckDashboard.jsx` (Sync pill in `CuriosaUrlCard`, new diff sheet).
- Schema: none. Catalog: read-only name resolution. Native: CapacitorHttp reuse.

Invariants (Constitution §3):

- **Transactional user-data operations** - the entire apply (entry deltas, avatar update,
  `updated_at` touch, history insert, history trim) is a single `tx()` statement batch.
  Verified by a test asserting an injected mid-batch failure leaves the deck unchanged.
- **Durable offline-first writes** - all writes go through the existing db layer; the only
  network dependency is the read (plan) phase, which fails closed with a plain message when
  offline. Nothing is written before confirm.
- **Catalog/profile boundary** - catalog is read for name resolution only; all writes are
  profile-scoped deck data. Unchanged posture.
- **Forward-only schema evolution** - no schema change.
- **Cross-runtime integrity** - fetch differs per runtime by existing design; the write path
  is runtime-identical parameterized statements (no DDL, native splitter not exercised).

## Options considered

1. **Status quo** - re-import to a new deck. Loses log/notes/name/variants; the exact pain
   reported. Rejected.
2. **Wholesale replace** (delete all entries, reinsert remote). Simplest convergence, but
   destroys `variant_slug` on untouched entries and rewrites rows needlessly. Rejected.
3. **Delta sync with diff-confirm** (chosen) - converge resolved entries to the remote
   target with per-row deltas inside one transaction.
4. **Snapshot + auto-undo in v1.** Deferred by owner decision; the transaction removes the
   corruption risk, and regret-undo is a distinct feature with restore-semantics coupling.
5. **`last_synced_at` column.** Rejected for v1: the deck log already timestamps syncs; a
   nullable column is a clean later migration if the URL card should render it inline.

## Proposed design

**Pure diff (new `src/store/curiosaDiff.js`, DOM-free and network-free):**

`computeCuriosaDiff(current, remote)` where `current` is the deck's aggregated resolved
entries `[{zone, cardId, qty, name}]` and `remote` is the normalised target
`{avatarCardId|null, entries: [{zone, cardId, qty, name}]}`. Returns
`{adds, removes, changes, avatar: {fromId, toId}|null, unchangedCount, isEmpty}`.
Both sides aggregate by (zone, cardId). Local `card_id NULL` placeholder rows are excluded
from the diff and left untouched (counted, surfaced as a note).

**Repository (`deckRepository.js`):**

- `planCuriosaSync(deckId)` - read-only. Reads `curiosa_url`, extracts the id (same regex as
  import), fetches meta + decklist + sideboard via `curiosaQuery`, resolves names against the
  catalog, builds the remote target (Spell->spellbook, Site->atlas, side->collection, remote
  duplicates merged), resolves the EFFECTIVE deck name (remote name de-duplicated against
  the profile's other decks, excluding this one - loop-safe by construction), and returns
  `{diff, remoteTarget, unknown: [{name, qty, zone}], placeholderCount, remoteName}`.
  Unresolved remote names go to `unknown` for display and are **not** applied (see
  Self-Critique for the deliberate divergence from import behaviour).
- `commitCuriosaSync(deckId, remoteTarget)` - re-reads current entries fresh, re-diffs
  against `remoteTarget` (immune to plan staleness, idempotent), then executes one `tx()`:
  UPDATE quantity for changed rows (preserving `variant_slug`), DELETE removed and duplicate
  rows, INSERT added rows, UPDATE avatar when the remote avatar resolved, touch
  `updated_at`, INSERT `deck_history` row `Synced from Curiosa (+A / -R / ~C)`, trim history.
  Returns the applied counts for the toast.
- `curiosaQuery` hardening: inspect HTTP status on the native branch (CapacitorHttp returns
  `status`); classify errors into: invalid URL, network unreachable, deck gone or private
  (4xx), malformed payload. Each maps to a distinct user message.

**UI (`DeckDashboard.jsx`):**

`CuriosaUrlCard` gains a `↻ Sync` pill beside Edit when a URL is saved. Tap -> busy label ->
`planCuriosaSync` -> diff sheet (Manuscript `Sheet` chassis, Section/Line idiom from
`ImportTextSheet`: Added in green, Removed in red, Changed in gold with `n× -> m×`, Avatar,
Unrecognised dimmed; app-wide one-sheet rule respected). Empty diff -> "Already in sync"
state, no commit offered. Confirm -> `commitCuriosaSync` -> toast + `onSynced` callback bumps
the dashboard `localRev` so zones and the log re-render. Errors -> danger toast, sheet stays.

## Implementation plan

1. **Increment 1:** `curiosaDiff.js` + `curiosaDiff.test.mjs` (pure unit tests: adds,
   removes, qty changes, duplicate aggregation, placeholder exclusion, empty diff).
   Checkpoint: `npm run test:query` green.
2. **Increment 2:** repository plan/commit + `curiosaQuery` status hardening + repository
   test covering commit atomicity and variant_slug preservation. Checkpoint: test:query,
   check:types, check:cycles green.
3. **Increment 3:** UI pill + diff sheet + rev wiring. Checkpoint: web manual pass via the
   Vite proxy, zero-image mode glance (sheet is text-only).
4. **Increment 4:** docs (feature matrix row), `npm run build`, `npm run check:docs`, native
   device evidence for the CapacitorHttp path. Checkpoint: full gate report, then merge.

## Data migration and compatibility

Not applicable in the schema sense: no new tables or columns, no migration. Compatibility
notes: decks with no `curiosa_url` show no Sync pill; decks whose URL fails the id regex get
the invalid-URL message; the commit is idempotent (re-running an applied plan is a no-op).

## Rollback and recovery

Code rollback: revert the feature commit(s); the feature is additive with no persisted
format change. Data recovery: the plan phase writes nothing; the commit is atomic, so
partial failure leaves the deck at its prior state. Point of no return is the transaction
commit; after it, the change is visible in the diff the user approved and itemised in the
deck log. Regret recovery is the deferred undo follow-up.

## Verification plan

- Automated: new unit tests (diff module, commit atomicity, duplicate normalisation,
  variant_slug survival); `npm run test:query`, `test:codex`, `test:app`, `check:types`,
  `check:cycles`, `build`, `check:docs` - exact results reported, none inferred.
- Manual web: sync an upstream-edited deck through the Vite proxy; verify diff accuracy,
  cancel-writes-nothing, log entry, rename dedup, notes untouched.
- Native: device run of the same flow (CapacitorHttp path), including airplane-mode failure
  message and a deleted-deck URL. Browser success is not native proof.
- Regression: existing import flows (`importCuriosaUrl`, text import, QR import) untouched
  by behaviour; covered by existing tests plus a smoke import.

## Security, privacy, performance, and operations

Same third-party surface as the existing import: unauthenticated reads of a public Curiosa
deck; the only data sent is the deck id already stored in the URL. Card names from the
response are rendered as text through React (no HTML injection path). Three sequential tRPC
requests per sync, user-initiated only; no polling, no telemetry. No deployment or pipeline
impact.

## Risks and unanswered questions

- **Upstream API drift** (likelihood medium, impact medium): payload shape checks fail
  closed with a "couldn't read Curiosa's response" message; owner: Claude.
- **Unresolved names are skipped, not preserved** (low/medium): a Curiosa card missing from
  the local catalog is reported in the diff but not stored. Mitigation: the diff sheet says
  so explicitly; the standing fix is a catalog update, after which the next sync picks the
  card up.
- **Curiosa permits over-limit copies** (owner decision 2026-08-14, found in device
  testing): the sync writes them VERBATIM - capping was rejected because it breaks the
  "deck matches the URL" contract and re-proposes the diff forever. The diff sheet shows
  an "Over the copy limit" section (totals across zones vs `copyLimit`) so the user
  confirms knowingly; the interactive editor still refuses to add beyond the cap. The
  collection-size cap (10/11) can likewise be exceeded by a large sideboard - accepted
  verbatim too, matching import; not currently surfaced (follow-up if wanted).
- **Plan staleness** (low/low): deck edited between plan and confirm; commit re-diffs
  against fresh state so the applied change converges correctly even then.
- Decision needed (minor): should an "already in sync" check write a
  `Checked Curiosa - already in sync` log row so last-checked is visible? Recommend yes.

## Self-Critique

Strongest case this design is wrong: it quietly abandons import's "nothing is lost"
principle - `importCuriosaUrl` keeps unresolved cards as placeholder rows; sync skips them.
The defence is that those placeholder rows are anonymous (no name stored), so a later sync
cannot tell them apart from one another and would duplicate them on every run; preserving
the principle properly requires persisting names on placeholder rows, which is a schema
change out of scope here. The divergence is deliberate, visible in the diff sheet, and
recoverable via catalog update. Hidden coupling: the diff sheet's correctness depends on
commit re-deriving deltas from `remoteTarget`, not consuming the displayed diff - a reviewer
should verify the sheet is presentation-only. Simpler alternative honestly considered:
wholesale replace - rejected on variant_slug destruction, which no test currently guards
elsewhere. Most likely failure to escape tests: a native-only payload difference in
CapacitorHttp (status handling, auto-parsed JSON vs string) - hence the explicit device
checkpoint. Evidence that would change the decision: if Curiosa exposes stable card ids we
could match on, name-based resolution and the placeholder compromise should be revisited.

## Approval record

Owner approved 2026-08-14 with both open decisions resolved as recommended: contents-only
sync and transaction-only v1 (no snapshot/undo). Scope amendment, owner-directed later the
same day: the deck NAME now syncs too (versioned upstream names flow through); the plan
resolves the effective name up front via the profile-unique dedup rule excluding the deck
itself, and the commit re-dedups against fresh state - notes remain untouched. Codex
adversarial review disposition: pending. Native device evidence: pending (pre-merge
checkpoint).
