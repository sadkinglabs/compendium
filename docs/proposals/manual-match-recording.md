# Proposal: manual match recording — untimed matches and neutral life defaults

## Status and classification

**Status: Approved with revisions** (2026-07-15) · Risk: **Standard**
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner

> Product decision approved: **untimed matches must not dilute the timed average**, and the
> displayed number will move. Implementation follows the zero-image gate, per Codex's
> priority order. Revisions **[C1]-[C5]** below.
>
> ### [C1] The proposal fixed the wrong function. There are TWO statistics implementations.
>
> **Verified in the tree:** the Play hub does not call `historyStats()`. It computes its own:
> ```js
> src/pillars/Play.jsx:66   const totalSec = matches.reduce((a, m) => a + (m.duration_sec || 0), 0);
> src/pillars/Play.jsx:148  fmtSpan(matches.length ? totalSec / matches.length : 0)   // labelled "AVG MATCH"
> ```
> **This is the number the owner reported.** My evidence section traced
> `playRepository.js:202` and never asked whether that value was the one on screen. It is
> not. Landing the proposal as written would have fixed a statistic nobody was looking at,
> passed every gate, and left the reported bug fully intact on the screen that reports it.
>
> This is the **"two implementations drifted"** family again - the same shape as the
> version/build drift resolved earlier this session (three sources collapsed to one). The
> fix is not to patch both sites; it is to **extract one pure calculation and call it from
> both**, which also gives the proposed fixtures something real to test:
> ```js
> export function computeMatchStats(matches) {
>   const timed = matches.filter((m) => Number(m.duration_sec) > 0);
>   const totalSec = timed.reduce((sum, m) => sum + Number(m.duration_sec), 0);
>   return {
>     totalSec,
>     timedCount: timed.length,
>     avgSec: timed.length ? totalSec / timed.length : null,
>     avgMin: timed.length ? Math.round(totalSec / timed.length / 60) : null,
>   };
> }
> ```
> Called from `historyStats()` **and** Play's display.
>
> **Pre-existing scope difference, to document rather than change:** Play loads at most
> **500** matches (`Play.jsx:47`, `listMatches(500)`) while `historyStats()` queries all of
> them. The two surfaces therefore describe different populations. Out of scope for this
> fix; it must not be silently "tidied" while extracting.
>
> ### [C2] Historical semantics, stated exactly
> ```
> duration_sec  > 0   -> timed
> duration_sec <= 0   -> untimed (historical value)
> duration_sec  null  -> untimed (current value)
> ```
> No migration. `<= 0` rather than `== 0` also absorbs any negative value already stored.
>
> ### [C3] The writer inventory was incomplete
> I listed `recordMatch`, `addManualMatch`, and the import path, and **omitted
> `updateMatch()`** - which writes the column and would have re-introduced `|| 0` on every
> edit. Scattered `?? null` expressions are the wrong shape anyway; use one helper:
> ```js
> export function normalizeDurationSec(value) {
>   if (value == null || value === '') return null;
>   const seconds = Number(value);
>   return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
> }
> ```
> Covers empty strings, `NaN`, negatives, and malformed imported payloads. **Every** writer
> routes through it: `recordMatch()`, `addManualMatch()`, `updateMatch()`, the imported-result
> state in `Play.jsx`, and the new form.
>
> ### [C4] Display semantics - the label is part of the fix
> "AVG MATCH" silently claims to cover all matches. Once the denominator excludes untimed
> records, the label must say so: **`AVG TIMED MATCH`**, or `AVG MATCH` with a
> `Timed matches only` sub-label. **With no timed matches, render `—`** - never `0s`, never
> `null`. `TIME PLAYED` is likewise known timed play; relabelling it is optional if the UI
> gets too verbose. *(This answers my own open question: a statistic silently describing a
> subset is honest arithmetic and a lie in a UI.)*
>
> ### [C5] Duration input requirements
> - Label: **`Duration (minutes, optional)`**
> - Numeric, decimals permitted.
> - Empty → `null`. **Zero or negative → untimed** (chosen explicitly over a validation
>   error: the field is optional, so refusing input to protect a statistic is the wrong
>   trade).
> - Positive minutes → rounded integer seconds. A sensible upper bound catches an
>   accidental extra digit.
> - **Expose it in the existing match-edit sheet too**, not add-only: `updateMatch()`
>   already writes the column, and add-only would mean a mistyped duration is permanent.
>
> ### Life defaults
> Approved. `0-0` is acceptable as neutral because `winner` is stored separately - but
> **device verification must confirm the form does not look like a 0-0 draw has already
> been selected.**

## Problem and success criteria

Two defects in manually-recorded matches, reported by the project owner.

### (a) A manually-added match silently corrupts the average-length statistic

There is no duration field in the Add Match form, so every manual match stores `duration_sec = 0`. The statistic then divides by **every** match:

```js
// src/store/playRepository.js:195-202
const totalSec = ms.reduce((a, m) => a + (m.duration_sec || 0), 0);
avgMin: total ? Math.round(totalSec / total / 60) : 0,
```

`total` is *all* matches. A manual match contributes **0 seconds to the numerator and 1 to the denominator**, so it drags `avgMin` toward zero. Record ten tracked 30-minute matches (`avgMin` = 30) and add ten manual ones, and the app reports 15 — a number that describes no match anyone played. **The statistic is not merely imprecise; it is wrong, and it gets more wrong the more the app is used as intended.**

**This is two defects, not one**, and only fixing the visible half would leave the bug:
1. **The form cannot record a duration** (no field exists).
2. **The statistic conflates "untimed" with "zero minutes"** — so even *with* a field, anyone who skips it still drags the average.

### (b) The Add Match form presumes a result

```js
// src/pillars/Play.jsx:393
const blank = () => ({ winner: 'player', pLife: 20, eLife: 0, … });
```

A blank form opens claiming **you are on 20 and your opponent is on 0** — a specific, flattering, almost-certainly-wrong scoreline. The owner's instruction: start both at 0.

**Success criteria**

1. `avgMin` reflects only matches that were actually timed.
2. An untimed match never moves `avgMin` in any direction.
3. The manual form can record a duration, and leaving it empty is a first-class outcome, not a zero.
4. A blank Add Match form presumes no result: both life totals 0.
5. Existing stored matches need no migration and no user action.
6. Live-tracked matches are completely unaffected.

**Non-goals**

- Back-filling durations for existing manual matches. They were never known.
- Changing `timePlayedMin` (a *sum*, which is correctly indifferent to the denominator).
- Making duration mandatory.
- Any change to the live tracker's timing.

## Evidence and current architecture

- `src/store/schema.js:153` — `winner TEXT, duration_sec INTEGER, notes TEXT`. **`duration_sec` is nullable.** The column can already express "unknown"; the code refuses to.
- `src/store/playRepository.js:55` and `:89` — both writers coerce: `m.durationSec || 0`. **This is where the information is destroyed**, before it reaches a nullable column.
- `src/pillars/Play.jsx:499` — `durationSec: payload.durationSec || 0` (the import path does it too).
- `src/pillars/Play.jsx:393` — `blank()`; the form carries `date` and `time`, which are the match's **time of day**, not its length. There is no duration input.
- `src/pillars/Play.jsx:273` — `MatchSheet` (edit) loads values via `getMatch`, so `blank()`'s defaults do not apply to editing an existing match. **(b) is confined to the Add path.**
- `src/store/playRepository.js:169` — `updateMatch` recomputes deck ledgers in one atomic tx; any write change must respect that boundary.

**The fact the fix turns on:** `duration_sec = 0` is **unambiguous**. A match of zero seconds cannot occur — the live tracker cannot produce one, and no user means "it lasted no time". So **every existing `0` already means "untimed"**, and reading `> 0` as "timed" is correct for all historical rows. **No migration, no schema change, no version bump.**

## Assumptions and confidence

1. **No stored match legitimately has `duration_sec = 0`.** Confidence: **high**. The live tracker writes elapsed seconds; a sub-second match is not reachable through the UI. Validation: query the device's DB for `duration_sec = 0` rows and confirm they are all manual/imported.
2. **`avgMin` is displayed where a changed value will be noticed.** Confidence: **medium**. It is a user-visible statistic and this change will move it — for most users *upward*, possibly sharply. **This is a product change, not just a bug fix**, and it should be approved as such.
3. **`0` and `null` are interchangeable to every existing reader.** Confidence: **medium-high** — `|| 0` is used at each read site, so `null` is already tolerated. Validation: grep every `duration_sec` reader before landing.
4. **Both life fields at 0 will not read as "a draw at 0-0".** Confidence: **medium**. `winner` is a separate control, so the data is coherent — but two zeroes may look like a recorded result rather than an empty field. See Risks.

## Affected systems and invariants

- **Invariants:** none of the eight are touched. No catalog/profile boundary, no profile isolation change, no schema evolution (the column already permits null), no new transaction boundary (`updateMatch`'s atomic tx is respected as-is), no image path, no cross-runtime concern.
- **Data:** write-shape change only — `null` instead of `0` for unknown durations, going forward.
- **UI:** one new optional input; one changed default.
- **Docs:** `COMPENDIUM_FEATURE_MATRIX.md` — manual recording gains duration capture. `COMPENDIUM_DATA_MODEL.md` — record that `duration_sec` null/0 means *untimed* and that `avgMin` is over timed matches only. **Completion gate.**

## Options considered

| Option | Verdict |
|---|---|
| **Status quo** | Rejected. The statistic is wrong and degrades with use. |
| **Add a duration field only** | **Rejected — this is the trap.** It looks like the fix and leaves the bug: every user who skips the optional field still drags `avgMin` to zero. It addresses the reported symptom and not the defect. |
| **Fix the denominator only** | Partial. Correct immediately and needs no UI, but leaves manual matches permanently untimed with no way to say otherwise. |
| **Both** (proposed) | Accepted. The denominator fix is the correctness fix; the field is the capability. |
| **Make duration mandatory** | Rejected. Punishes the common case (recording a match from memory, hours later) to protect a statistic. |
| **Migrate existing `0` rows to `null`** | Rejected as unnecessary. `> 0` reads correctly over both, and a migration would be write traffic across every user's history to change nothing observable. Forward-only, per §3. |
| **Treat untimed as the median/mean of timed matches** | Rejected. Inventing data to make an average prettier is worse than a smaller sample. |

## Proposed design

**1. The statistic — the correctness fix.**
```js
// Untimed is not zero-length. duration_sec is 0 (historical) or null (new) when the
// match was recorded by hand, and a zero-second match cannot exist - so `> 0` reads
// correctly over every row ever written, with no migration.
// avgMin must divide by the matches it actually SUMMED, or every untimed match drags
// it toward zero. `total` is not that number.
const timed = ms.filter((m) => m.duration_sec > 0);
const totalSec = timed.reduce((a, m) => a + m.duration_sec, 0);
…
avgMin: timed.length ? Math.round(totalSec / timed.length / 60) : null,
```
**`null`, not `0`**, when nothing is timed: "no timed matches" and "an average of zero minutes" are different statements and the UI must be able to tell them apart. **This makes `avgMin` nullable — its consumers must be found and handled.** `timePlayedMin` keeps summing `totalSec` and is unaffected, correctly: a sum of timed matches is exactly what it claims to be.

**2. Stop destroying the information.** `m.durationSec || 0` → `m.durationSec ?? null` at `playRepository.js:55`, `:89`, and `Play.jsx:499`. `0` and `null` both read as untimed, so this is safe for existing rows and honest for new ones.

**3. The field.** An optional **Duration (minutes)** input in `AddMatchSheet`, stored as `minutes * 60`. Empty ⇒ `null` ⇒ untimed. Minutes, not seconds: nobody recalls a match to the second, and false precision invites the same fiction this proposal exists to remove.

**4. The defaults.** `blank()` → `pLife: 0, eLife: 0`. One-line change; `winner` still defaults to `'player'` and is a deliberate choice, not a presumed scoreline.

## Implementation plan

1. Grep every `duration_sec` / `durationSec` reader; confirm `null` is tolerated at each. **Checkpoint — if any reader breaks on `null`, stop and re-scope.**
2. Find every `avgMin` consumer; handle `null` ("—" or hidden, matching how the screen treats other absent stats).
3. Land the statistic fix (1) + the write fix (2). **Verify:** ten timed + ten untimed matches ⇒ `avgMin` equals the timed average, unmoved by the untimed.
4. Land the duration field (3) and the defaults (4).
5. Device check: add a manual match with and without a duration; confirm `avgMin` moves only for the timed one, and that the live tracker still records normally.
6. Docs (Feature Matrix, Data Model) + full gates.

Increments 3 and 4 are independently shippable; **3 is the bug fix and should not wait for 4.**

## Data migration and compatibility

**No migration.** The column is already nullable (`schema.js:153`), so **no schema version bump**. Old rows (`0`) and new rows (`null`) both read as untimed via `> 0` — the compatibility argument rests entirely on assumption 1 (no legitimate zero-second match), which step 1 of the plan validates against real data. Old app versions reading new rows would apply `|| 0` and behave exactly as they do today. Forward-only, per §3.

## Rollback and recovery

Code-only revert; no data recovery needed. Rows written with `null` are read as `0` by the old code — i.e. exactly the current behaviour. **No point of no return.** The only irreversible act is a user typing a duration, which is data they chose to record and which the old code ignores harmlessly.

## Verification plan

- **Automated:** `test:query` covers `src/store/**`. **`computeStats` is a pure function over rows and is the natural unit test** — fixtures for all-timed, all-untimed, and mixed, asserting the mixed case equals the all-timed average. This is the first real test of the defect and should exist before the fix.
- **Manual/native:** step 5 on device.
- **Regression:** the live tracker's own timing path, untouched, re-verified.
- **Accessibility:** the new input follows the form's existing label/hint pattern.

## Security, privacy, performance, and operations

No new data category — duration is already stored. No network, no permission, no telemetry. `filter` + `reduce` over a match list is unchanged in complexity.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **`avgMin` visibly jumps for existing users** | **High — it is the point** | Medium | Intended: the old number was wrong. Worth the owner knowing it will move, possibly a lot. |
| A reader breaks on `null` where `0` was assumed | Medium | Medium | Step 1 gates the change; `avgMin`'s own nullability is handled in step 2. |
| A legitimate `duration_sec = 0` exists | **Low** | **High — it would be silently reclassified as untimed** | Step 1 queries real data rather than trusting assumption 1. |
| Two zeroes read as a recorded 0-0 result | Medium | Low | `winner` is a separate control. If it reads badly on device, empty inputs with a `0` placeholder are the fallback. |

**Unanswered:** should `avgMin` be labelled to say it covers timed matches only? A statistic silently describing a subset is honest arithmetic and a potential lie in a UI — but this may be over-thinking a stats row. **Owner's call.**

## Self-Critique

**The strongest case that this is wrong:** the owner called these "quick ones", and (b) *is* — one line. But (a) is not, and I should be clear that I am proposing something larger than what was asked. The request was "there is no time field"; **the actual defect is the denominator**, and the field alone would leave the bug in place while appearing to fix it. If the reviewer thinks the statistic is unimportant enough to leave wrong, then the field alone is defensible and much cheaper — **I would disagree, because a wrong number that degrades with use is worse than no number.**

**Hidden coupling:** making `avgMin` nullable pushes a new case into every consumer, and I have not yet enumerated them. If it is rendered as `{avgMin} min` somewhere, `null` prints "null min" — a fresh visible bug from a correctness fix, which is a bad trade and exactly how this lands badly. Step 2 exists for that reason and the plan should not proceed past it on optimism.

**Simpler alternative:** keep `avgMin` at `0` when nothing is timed instead of `null`. One fewer case, but it reinstates the very conflation the proposal removes — "no data" rendered as "zero minutes". I reject it, and note it is a small, arguable call.

**The failure most likely to escape tests:** assumption 1 being false on **someone else's** device — an imported match, a Curiosa-sourced record, or a share payload carrying `durationSec: 0` for a real match. My local DB proves nothing about theirs, and the reclassification would be silent, permanent, and invisible in any test I can write. **This is the weakest link in the proposal and it is not fully closable**; step 1's query narrows it, it does not eliminate it.

**Evidence that would change the decision:** any real row with `duration_sec = 0` that represents a played match ⇒ the `> 0` shortcut is unsafe and a real migration (or an explicit `is_timed` column) is required. A reviewer showing `avgMin` is consumed somewhere that cannot express absence ⇒ reconsider `null`.

## Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted | 2026-07-15 |
| Codex (reviewer) | *pending* | |
| Human (approver) | *pending* | |
