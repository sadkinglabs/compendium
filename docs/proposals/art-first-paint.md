# Proposal: cached art paints on the first frame

**Revision 2** (2026-08-13). Rev 1 dispositioned *Changes required* - both fixes were wrong, in
different ways. This is the final review round per the budget below.

## Status and classification

**Draft, revision 2.** Risk: **Standard** - rendering and perceived performance on a governed
boundary. No schema change, no user data touched, no new persistence.

Owner/approver: project owner. Author: Claude Code. Reviewer: Codex.

> **REVIEW BUDGET: this is round two of two.** Owner instruction: do not over-engineer. Raise what
> would break the app or mislead a user; leave anything merely tidier. If a finding would make the
> change larger rather than safer, say so and let the owner weigh it.

Branch `art-first-paint`, folding in the previously queued `art-fade-fix`.

### What Rev 1 got wrong

1. **The optimistic `peek()` would have served unverified files.** `artCache.js:7` documents that a
   cached file is served only after exact-size validation against the manifest, and `resolve()`
   enforces it. Returning a local candidate without that check means truncated or wrong-but-decodable
   bytes paint silently, because `onError` catches decode failure and **not incorrect valid imagery**.
   I traded a documented fail-closed property for a first frame and did not notice.
2. **The fade fix aimed at a component the app never renders.** `ArtImage` has **zero call sites**.
   Live framed card art is `CardArt.jsx`, which uses the shared `useArtSource` hook but owns its own
   `loaded` state and the identical `.3s` fade, across **16 call sites** in Codex, Collection,
   deck-add and elsewhere. The change would have shipped, passed its tests, and altered nothing
   visible. The Rev 1 text inherited that claim from a 2026-08-10 ledger note and I repeated it
   without checking.
3. **Option D was rejected for a reason that is false.** I wrote that a boot scan "races the first
   render anyway". It does not: `initArtCache()` is **awaited in the boot effect** (`App.jsx`) before
   the app renders content.

## Problem and success criteria

**The complaint:** images pop in - "a quick flash of missing image then back in immediately", worst on
avatars. If the image is cached it should be visible immediately.

The bytes are on disk. What is missing is that the app cannot **use** them on the first frame, for two
unrelated reasons.

### Cause 1 - the cache index is cold at every launch

`peek()` is synchronous, so it can only consult the in-memory `resolved` memo (`artCache.js:69`). That
memo is written only by the async `resolve()` and `initArtCache()` never seeds it, so it is **empty at
every launch**. The first sighting of each key has no `src`; `ArtImg` renders `null`
(`ArtImage.jsx:52`) and the monogram disc shows through until an async `io.stat` completes.

**Native-only** - web `peek` answers immediately - and **once per key per launch**, since `resolved`
survives navigation.

### Cause 2 - the fade replays on every remount

`CardArt.jsx:18` holds `loaded` in component state. A pillar switch unmounts the pillar, so on return
`loaded` resets, `shown` is false, and the `<img>` paints at `opacity: 0` behind a shimmer with a
`.3s` transition - every card, every time. Only the animation re-runs; the bytes are local.

Measured on device (build 218): returning to Home with art cached, deck panels black at t=0, painted
by 400ms, byte-identical at 400ms and 1.9s.

### Success criteria

1. **Art already on disk paints on the first frame after a relaunch**, with no empty-source gap.
2. **Art already painted this session does not shimmer or fade again** on a later mount, **on the
   components the app actually renders**.
3. **A genuine first load still shimmers and fades** - including a re-download after a quarantine.
   This is the reverse regression, and it is the one that matters: dropping the loading affordance
   would make a slow CDN fetch look like a broken image.
4. **No file is served without manifest validation.** The fail-closed property at `artCache.js:7`
   survives this change intact.
5. **Graceful degradation still holds, and its harness still works.** ENGINEERING_CONSTITUTION §3.6:
   missing art must never make the app unusable. `imagesDisabled()` is not a user-facing mode -
   nothing writes `cx-no-images`, and BUILD.md documents setting it by hand to VERIFY the property. So
   `peek`/`resolve` must keep returning early on that flag, and no surface may assume art resolves.

### Non-goals

Changing where art is stored or how it is fetched; prefetching; touching the `artUrl` seam;
consolidating `ArtImage` and `CardArt`, or migrating call sites.

## Evidence

| Concern | Location |
|---|---|
| Renders nothing without a source | `src/components/ArtImage.jsx:52` (`ArtImg`) - **this one IS used**, by avatars |
| `ArtImage` (framed) - **no call sites** | `src/components/ArtImage.jsx:63` |
| The LIVE framed path, own `loaded` + fade, 16 call sites | `src/components/CardArt.jsx:14,18,26` |
| Synchronous peek, memo only | `src/store/artCache.js:69-73` |
| Memo written only by async resolve | `src/store/artCache.js:92,115` |
| Exact-size validation against the manifest | `src/store/artCache.js:54` (`validSize`), enforced at `:90` |
| Boot seam, awaited before render | `src/store/artCacheInstance.js` - `initArtCache()`; `src/App.jsx` boot effect |
| Directory listing WITH sizes already exists | `src/store/artCacheAdapter.js:94` - `list()` returns `{name, size}` |
| Invalidation hooks that already exist | `src/store/artCache.js:154` (`quarantine`), `:166` (`clear`) |

## Options considered

| Option | Verdict |
|---|---|
| A. Status quo | Rejected - the reported defect |
| B. Optimistic local candidate from `peek`, `onError` handles a miss | **REJECTED at review.** Serves unverified bytes; `onError` does not catch wrong-but-decodable imagery |
| C. Persist a verified key set and seed the memo at boot | Held in reserve. Adds a second index that can disagree with the filesystem; only worth it if D proves slow |
| **D. Seed the memo at boot from one `io.list('art')`, admitting only entries whose size matches the manifest** | **PROPOSED for cause 1.** Same validation as `resolve()`, batched. One call, no new index, no persistence, and it cannot race first paint because `initArtCache()` is awaited |
| E. Session `painted` set consulted by `ArtImage` | **Right idea, wrong target** - `ArtImage` is unrendered |
| **E'. Session `painted` set consulted by `CardArt`** | **PROPOSED for cause 2** |
| F. Lift `loaded` into React context | Rejected - more machinery than the problem needs |

## Proposed design

1. **`initArtCache()` seeds the memo.** One `io.list('art')` returns `{name, size}` per file. For each
   entry whose name is a manifest key and whose size equals `entryOf(key).bytes`, set
   `resolved.set(key, { kind: 'local', src: convertFileSrc('art/' + key) })`. Anything that does not
   match exactly is skipped and left to `resolve()`, which will delete and re-fetch it as it does
   today. **The validation rule is unchanged; only its timing is.**
2. **A module-level `painted` set**, recording keys whose `<img>` has fired `onLoad` this session.
   **`CardArt` consults it** on mount: a painted key renders at `opacity: 1` with no shimmer and no
   transition; an unpainted key behaves exactly as today. `ArtImage` gets the same treatment only
   because it shares the file - it is not the point of the change.
3. **`painted` is invalidated** by `quarantine(key)` (that key) and `clear()` (all keys), so a genuine
   re-download shimmers again. Without this, criterion 3 fails for exactly the case that matters.
4. **The decision lives in `artSource.js`** - pure, DOM-free, already unit-tested - so components stay
   zero-logic shells and tests can reach it.

## Implementation plan

Two changes and one device pass. Not staged further: each is a few lines, and gating them separately
would cost more ceremony than the change is worth.

| # | Increment | Gate |
|---|---|---|
| 1 | Boot seeding + `painted` set on `CardArt`, with tests | Unit: a size-matching file seeds the memo, a mismatching one does NOT; a painted key mounts at full opacity; **an unpainted key still shimmers**; **a quarantined key shimmers again**; `cx-no-images` still short-circuits |
| 2 | Device pass, with the boot cost measured **here** | Relaunch on a warm cache: no gap, and `initArtCache()` cost recorded. **Cleared cache: the loading affordance is still there** |
| 3 | Docs | Art-boundary note; retire the ledger row |

**Pre-chosen fallback:** if Increment 2 shows the boot scan is materially expensive on a full cache,
switch to option C rather than opening a new design round.

## Verification plan

- **Automated:** boot seeding admits only exact size matches; `artSource` paints from a seeded
  candidate on the first frame; a painted key skips the shimmer; an unpainted key does not; a
  quarantined key shimmers again; `cx-no-images` short-circuits before render and I/O.
- **Device:** relaunch with a warm cache - no empty-source gap on avatars or deck panels, boot cost
  recorded. Clear the art cache - shimmer and fade still present on a genuine first load.
- **Regression:** `check:source` still passes (the `artUrl` seam is untouched); `check:cycles`
  unchanged.

## Risks and unanswered questions

| Risk | Impact | Mitigation |
|---|---|---|
| Boot scan slow on a full cache | Medium | Measured at Increment 2; option C pre-chosen as the fallback |
| Dropping the shimmer hides a slow fetch | **Medium-high** | Criterion 3, with explicit tests for the unpainted AND re-download cases |
| `painted` grows unbounded | Low | Short strings, bounded by the catalog |
| A file changes on disk after seeding | Low | Same exposure as today once `resolve()` has memoized a key; the window is not widened |

## Self-Critique

**The strongest case against this:** the symptom is cosmetic. Nothing is lost or corrupted, and a user
who never relaunches never sees cause 1.

**What Rev 1 should teach the reader of Rev 2:** I proposed serving unverified files to save a frame,
and I proposed fixing a component nothing renders. Both passed my own reading because I checked the
mechanism and not the wiring - `grep '<ArtImage'` would have taken seconds and returns zero. Treat the
remaining claims here with that in mind; the diagnosis of cause 1 is verified by reading `peek`, but
the *fix* is only as good as the call-site check behind it.

**The failure most likely to escape tests:** the reverse regression. "Painted key skips the shimmer" is
easy to assert; "a genuinely slow first load still shows one" needs simulated latency, and the
quarantine case is easy to forget entirely - which is why it is a named gate rather than a note.

**Evidence that would change the decision:** a materially expensive boot scan sends this to option C.

## Approval record

| Date | Who | Disposition |
|---|---|---|
| 2026-08-13 | Owner | Both causes on one branch; no over-engineering; two review rounds maximum |
| 2026-08-13 | Codex | **Rev 1: Changes required** - 2 Majors, both valid |
| 2026-08-13 | Claude | **Rev 2** - both fixes replaced; final round |
| | Owner | Pending approval |
