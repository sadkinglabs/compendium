# Proposal: durable autosave for a live match (survive an OS kill)

## Status and classification

**Status: Draft — awaiting review** · Risk: **High** (durable persisted state + runtime-specific behavior requiring device evidence)
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner
Date: 2026-07-17 · Roadmap item §16 #1 from [`ui-state-optimisation.md`](./ui-state-optimisation.md). **No implementation has begun.**

## Problem and success criteria

**A live match is persisted only at explicit minimize, so an OS kill loses it.** `saveOngoing` has exactly one caller — `App.jsx:243 minimizeMatch` (verified: `git grep saveOngoing`). While the life counter is open and the user has *not* tapped minimize, nothing is written. Android routinely kills backgrounded apps; when it kills a live match, the entire in-progress game — life totals, log, and banked elapsed time — is gone. This is in tension with the **durable-offline-first invariant** (Constitution §3.3) and the Play resume contract (Feature Matrix §5.2: *"Minimizing a match preserves enough state to resume"* — but only minimizing does).

By contrast, [`db.js`](../../src/store/db.js) already flushes the SQLite store on `pagehide`/`visibilitychange`; the ongoing-match `localStorage` path simply never got the same treatment.

**Success criteria**

1. Backgrounding a live match writes a resumable snapshot; if the app is then killed, relaunch offers **Return to Match** and resumes life/log/elapsed exactly.
2. **No behavior change to any existing flow** — minimize, resume, record, exit, new-match, and profile switch behave as they do today.
3. Profile isolation holds: the autosave is written under the active profile's key.
4. No double-record and no fabricated completed match (the `recorded` flag survives the autosave→resume round-trip).
5. Verified on the installed release WebView by a real background→kill→relaunch→resume test.

**Non-goals**

- Surviving a *foreground* crash between background events (see §Residual — a periodic autosave is a possible later increment; this addresses the dominant *backgrounded-then-killed* case).
- Any change to the snapshot shape (`SNAP_VERSION` stays 1) or to `ongoingMatch.js`.
- Any UI change.

## Evidence and current architecture

- `ongoingMatch.js` — `saveOngoing(snap)` is a single **synchronous** `localStorage.setItem` inside try/catch; key is profile-scoped (`cx-ongoing-match:${activeProfileId()}`). `loadOngoing()` validates + `restoreSide`-style clamping happens downstream in `matchLife` on resume.
- `App.jsx:243` — `minimizeMatch = (snap) => { setOngoing(snap); saveOngoing(snap); setMatch(null); }`. The `setMatch(null)` is what tears down the live counter and returns Home. **Autosave must reuse only the `saveOngoing` half — no teardown.**
- `App.jsx:85` seeds `ongoing` in a `useState` initializer via `loadOngoing()`; `:236/:247/:250/:251` `clearOngoing()` on start-new / resume / exit / new-from-end. `recordMatchResult` (`:249`) deliberately does **not** clear (the counter stays open, `recorded` flag set).
- **Cold-boot reconciliation bug — must be fixed for this proposal to work (Codex review, author-confirmed).** `loadOngoing()` at `:85` runs during *first render*, before `initProfiles()` in the boot effect (`:134`). `loadOngoing → KEY() → activeProfileId()` throws when `activeId` is null (`profileRepository.js:16`); `loadOngoing`'s try/catch swallows it and returns `null` (`ongoingMatch.js:31`). Boot never re-reads it afterward, so **after a real process death the ongoing snapshot is never loaded and _Return to Match_ never appears.** Same-process minimize→resume works today only because `minimizeMatch` sets App `ongoing` in memory (`:243`); the cold-boot read path is broken. Autosave writes a snapshot that, without this fix, nothing reads — so the fix is in-scope, not optional.
- `LifeCounter.jsx:137-145` — `buildSnapshot()` is synchronous and computes `elapsedSec()` to *now* (`:136`); `snapRef.current` always points at it. So a snapshot taken at background time has correct elapsed.
- `LifeCounter.jsx:222-241` — the mount effect already registers a `visibilitychange` listener (`onVisible`, re-asserts wake-lock/immersive on return) with clean teardown. The autosave hooks the same effect.
- `LifeCounter` unmounts on minimize (`setMatch(null)`), so its listeners exist **only while a match is live** — the autosave cannot fire for a minimized or ended match.

## Assumptions and confidence

1. **`visibilitychange → hidden` fires before Android kills a backgrounded WebView.** Confidence: **high** (standard web/WebView behavior; it's the same signal `db.js` relies on). Validated by the device test.
2. **`localStorage.setItem` completes synchronously during the `hidden`/`pagehide` window.** Confidence: **high** (synchronous API; this is *why* the match path is simpler than `db.js`'s async IndexedDB flush).
3. **`buildSnapshot()` is safe to call at background time and yields correct elapsed.** Confidence: **high** (pure ref reads + `elapsedSec()` to now).
4. **Writing `localStorage` without setting App's `ongoing` state is correct — *given the boot-order fix*.** Confidence: **high** with the fix. Nothing reads App `ongoing` while a match is live (the counter overlay is up), and the fix makes boot reconcile from `localStorage` after `initProfiles()`. **Without** the fix the feature is inert on cold boot (the reconciliation bug above), so the fix is a required part of this proposal.

## Affected systems and invariants

- **Durable, offline-first writes (§3.3):** directly strengthened — this is the point.
- **Profile isolation (§3.2):** `saveOngoing` keys by `activeProfileId()` at write time; a live match belongs to the active profile. Preserved. (Switching profiles mid-live-match is not reachable — the counter is a full-screen overlay; unchanged by this proposal.)
- **Transactional user-data ops (§3.5):** a single synchronous `setItem`; atomic. On quota/security failure it silently no-ops (pre-existing `saveOngoing` behavior) — no partial write.
- **Cross-runtime integrity (§3.8):** the trigger (`visibilitychange`/`pagehide`) is runtime-sensitive — hence the mandatory device test.
- **No double-record (Feature Matrix §5.2):** the `recorded` flag is in the snapshot and survives autosave→resume, so a recorded match can't be recorded again.
- **App boot orchestration:** the `ongoing` initializer moves out of first render into a post-`initProfiles()` reconciliation — a change to boot ordering that also fixes a pre-existing cold-boot bug the autosave depends on (see Risks).
- **Schema/format:** unchanged (`SNAP_VERSION` = 1, same shape).

## Documentation impact

Per Constitution §13, every source-of-truth document is classified:

| Document | Disposition |
|---|---|
| [`COMPENDIUM_FEATURE_MATRIX.md`](../../COMPENDIUM_FEATURE_MATRIX.md) | **Update.** The Play / life-counter capability (§5.1) should state that an active match is snapshotted when the app backgrounds and survives process death; the §5.2 invariant "minimizing preserves enough state to resume" broadens from *minimize* to *background/kill*. |
| [`COMPENDIUM_DATA_MODEL.md`](../../COMPENDIUM_DATA_MODEL.md) | **Update.** The ongoing-match snapshot's persistence *lifecycle* changes (written on background/`pagehide`, not only minimize) and its cold-boot, profile-scoped reconciliation should be stated where the snapshot is described. No table/schema change; `SNAP_VERSION` unchanged. |
| [`COMPENDIUM_ARCHITECTURE.md`](../../COMPENDIUM_ARCHITECTURE.md) | **Assess → likely a one-line runtime-lifecycle note** on the LifeCounter-trigger / App-persistence boundary and the boot reconciliation order; if the doc does not describe the Play runtime at that depth, **reviewed, no change**. Confirm at implementation. |
| [`BUILD.md`](../../BUILD.md) | **Reviewed — no change.** Commands unchanged; its installed-app `adb`/release-build verification procedure is *used* by this proposal's device gate. |
| [`ENGINEERING_CONSTITUTION.md`](../../ENGINEERING_CONSTITUTION.md) | **Reviewed — no change.** No process change. |
| [`AGENTS.md`](../../AGENTS.md) | **Reviewed — no change.** No agent-workflow change. |

`npm run check:docs` is mechanical only; these are semantic assessments to reconcile at completion.

## Options considered

| Option | Verdict |
|---|---|
| **Status quo** (save only at minimize) | Rejected — the problem. |
| **Autosave on `visibilitychange→hidden` + `pagehide`, save-only** (proposed) | **Recommended.** Covers the dominant backgrounded-then-killed case; minimal; mirrors `db.js`. |
| Debounced autosave on every life change | Rejected for v1 — chattier `localStorage` writes for marginal gain over background-save; also covers foreground crashes, which are rarer. Viable *later* if evidence shows foreground kills matter. |
| Move autosave into `App` via a `counterApi.snapshot()` getter | Rejected — `LifeCounter` owns `snapRef` and already owns the visibility listener; adding an App-side getter + listener is more moving parts for no gain. |
| Also `setOngoing(snap)` in App on autosave | Rejected — App `ongoing` means "a *minimized* match to return to"; a live match isn't that. Writing only `localStorage` keeps that semantic clean; boot/switch reconcile from `localStorage`. |

## Proposed design

One new save-only callback prop, and two listeners in the existing mount effect.

**`App.jsx`:** pass the raw persister (no teardown, no state change):
```jsx
<LifeCounter … onMinimize={minimizeMatch} onPersist={saveOngoing} … />
```
`saveOngoing` is already imported and is a stable module reference.

**`LifeCounter.jsx`** (mount effect, `:222-241`): add a save-only helper and fold it into the visibility handler + a `pagehide` listener:
```js
const persist = () => onPersist?.(snapRef.current());
const onVisibility = () => {
  if (document.visibilityState === 'visible') {         // existing: re-assert wake-lock/immersive
    if (settings.keep_awake) setKeepAwake(true);
    if (settings.immersive) setImmersive(true);
  } else {                                              // NEW: backgrounded - durably capture the match
    persist();
  }
};
document.addEventListener('visibilitychange', onVisibility);
window.addEventListener('pagehide', persist);
// teardown: removeEventListener for both (added to the existing cleanup)
```
No other code changes. The counter keeps rendering; the user stays in the match; the snapshot is simply on disk now in case the app dies.

**`App.jsx` boot-order fix (required — the autosave is inert without it):** stop seeding `ongoing` in the `useState` initializer (which throws pre-`initProfiles`), and reconcile once profiles exist:
```js
const [ongoing, setOngoing] = useState(null);       // was: useState(() => loadOngoing())
// …in the boot effect, immediately after initProfiles() succeeds (App.jsx:134-135):
setOngoing(loadOngoing());
```
The existing profile-switch reload (`:292`) stays. This is the step that makes *Return to Match* appear after a process death, and it also fixes the pre-existing cold-boot bug for the *ordinary* minimize→kill case (not just autosave).

**Ownership:** `LifeCounter` owns the trigger (it owns `snapRef`); `App`/`ongoingMatch` own persistence (the callback boundary is unchanged in spirit — `LifeCounter` stays persistence-agnostic, calling a prop rather than importing `saveOngoing`).

## Implementation plan

1. **Boot-order fix (required, first):** `App.jsx:85` → `useState(null)`; add `setOngoing(loadOngoing())` immediately after `initProfiles()` succeeds in the boot effect (`:134-135`). Keep the profile-switch reload (`:292`).
2. Add the `onPersist` prop + the two listeners + teardown in `LifeCounter` (~6 lines) and wire `onPersist={saveOngoing}` in `App`.
3. Automated: `npm run test:ui`, `npm run build`, `npm run check:docs` (this is listener + boot wiring; it adds no pure logic to unit-test).
4. **Device (the load-bearing evidence — proves both the write AND the boot read path):** installed release build — start a match, change life to a distinctive value, **background** the app (Home), **kill** the process (`adb shell am kill com.sadkinglabs.compendium` / force-stop), **cold-launch**, confirm **Return to Match** appears and resumes the exact life/log/elapsed. Repeat for a quick match. Negative case: **cold boot with no live match** must show *no* Return to Match. Regression: normal minimize→resume, exit→(no resume), start-new-discards-ongoing all unchanged.
5. Zero-image + normal interaction spot-check (surface is touched).

## Data migration and compatibility

**Not applicable to schema** — snapshot shape and `SNAP_VERSION` unchanged. The only new behavior is *when* an existing write happens. Old installs with no autosaved snapshot are unaffected; a snapshot written by this build is readable by any build (same shape).

## Rollback and recovery

One-commit revert (remove the prop + listeners). No persisted-format change, so nothing to migrate back. A stale autosaved snapshot left by a reverted build is either resumed (valid, same shape) or cleared on the next exit/new — nil-cost.

## Verification plan

- **Automated:** `test:ui`, `build`, `check:docs` (and `test:query`/`test:codex` for completeness).
- **Device (required, High-risk):** the background→kill→relaunch→resume test above on the installed release WebView (Pixel 9 / WebView 150), recording device/OS/WebView/build. This is the only evidence that proves the core claim; a browser is not sufficient.
- **Regression:** minimize→resume, record→exit, exit→no-resume, start-new-discards-ongoing all unchanged.
- **Negative:** background with `localStorage` unavailable (private-mode analogue) must not throw (relies on `saveOngoing`'s existing try/catch).

## Security, privacy, performance, and operations

No new data collected; the snapshot already exists as a concept. Perf: one synchronous `setItem` of a small JSON per background event — negligible, no debounce needed. No dependency, no native change, no telemetry.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The boot-order fix regresses normal boot (double-load, or races the profile-switch reload) | Low | Medium | `loadOngoing` is idempotent + profile-scoped; the fix mirrors the existing `:292` switch reload; device test covers cold boot **with** a saved match and **with none** |
| `visibilitychange→hidden` doesn't fire before an Android kill in some OEM path | Low | High (no save) | Device test is the proof; `pagehide` is a second trigger |
| Foreground low-memory kill between background events loses the delta since last background | Low | Medium | Documented residual; periodic autosave is a later option (§Non-goals) |
| Autosave writes while a match is recorded-but-open → resume shows a recorded match | Low | Low | `recorded` flag blocks double-record; pre-existing minimize behavior is identical |
| Frequent background/foreground churn writes often | Low | Low | Synchronous, tiny, cheap; no user-visible effect |

**Open:** should v1 also debounce-save on life change to cover foreground crashes? Recommendation: no — ship the background/pagehide save, measure whether foreground kills are a real complaint first.

## Self-Critique

- **The miss this review caught (Blocker):** I designed the *write* path and never checked the *read* path on cold boot. Autosave would have written a correct snapshot that boot never loads after a process death — the feature would look finished and be inert. My own discovery pass had flagged this exact `loadOngoing`-before-`initProfiles` bug (App §5.7) and I failed to carry it into the design. The boot-order fix is now implementation step 1, and the device kill-test is precisely the case that would have exposed it — which is also why same-process minimize→resume "passing" earlier was not evidence for this scenario.
- **Strongest reason it's wrong:** the whole value rests on assumption 1 (`hidden` fires before the kill). If an OEM kills a backgrounded WebView without delivering `visibilitychange`, autosave never runs and the fix is inert. That's exactly why the device kill-test is mandatory and why `pagehide` is added as a second net — but I can't prove *every* OEM path, only the tested one.
- **Highest-consequence assumption:** that `buildSnapshot()` at background time yields a resumable snapshot. If any ref it reads isn't settled at background (e.g., mid-animation), a resume could be slightly off. Mitigation: it reads committed life refs + banked elapsed, not animation state; the device test exercises it.
- **Simplest rejected alternative:** save on every life change. Rejected as chattier, but it's strictly more durable; if the device test shows `hidden` is unreliable, that becomes the answer.
- **Coupling missed?** `onPersist` fires on every background even when nothing changed since the last save — harmless (idempotent overwrite), but worth noting it's not conditional.
- **Failure most likely to escape tests:** an OEM-specific kill path with no `visibilitychange`, on a device other than the test Pixel. Honest limitation.
- **Evidence that would change direction:** device test showing state not resumed after kill → escalate to per-change save.

## Approval requested

A save-only autosave of the live match on `visibilitychange→hidden` + `pagehide`, wired via a new `onPersist={saveOngoing}` prop, no teardown, no schema change. **High-risk** (durable state + runtime). Decisions: (1) approve the design and the background/pagehide scope (vs per-change save); (2) approve proceeding to implementation on this branch with the mandatory device kill-test as the completion gate. **No code written yet.**

### Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted | 2026-07-17 |
| Codex (reviewer) | **Changes required** — Blocker: cold-boot reconciliation; Major: docs-impact missing | 2026-07-17 |
| Claude Code (author) | **Revised** — boot-order fix folded into design/plan/affected-surface/risks/verification; Documentation-impact section added | 2026-07-17 |
| Codex (reviewer) | *pending narrow re-review* | |
| Human (approver) | *pending* | |
