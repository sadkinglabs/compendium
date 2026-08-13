# Proposal: cached art paints on the first frame

## Status and classification

**Draft.** Risk: **Standard** - rendering and perceived performance on a governed boundary. No schema
change, no user data touched, no new persistence of user content.

Owner/approver: project owner. Author: Claude Code. Reviewer: Codex.

> **REVIEW BUDGET: TWO ROUNDS MAXIMUM, and ideally one.** This is a cosmetic rendering fix on a
> well-understood boundary - no data at risk, no schema, no destructive path, fully revertible by
> deleting two small changes. Owner instruction: do not over-engineer it. Raise what would break the
> app or mislead a user; leave anything that is merely tidier. If a finding would make the change
> larger rather than safer, say so and let the owner weigh it rather than treating it as required.

Branch `art-first-paint`, folding in the previously queued `art-fade-fix`. The two were logged as one
symptom and are two distinct causes; fixing either alone leaves the complaint standing.

## Problem and success criteria

**The complaint, in the owner's words:** images pop in - "a quick flash of missing image then back in
immediately", most visible on avatars. If the image is cached, it should be visible immediately.

It is not a caching failure. The bytes are on disk. **What is missing is that the app cannot use them
on the first frame**, for two unrelated reasons.

### Cause 1 - the cache index is cold at every launch (NEW, this is the "missing image" flash)

`ArtImg` renders `null` while `src` is null (`ArtImage.jsx:52`), so whatever sits behind it - the
monogram disc, the deterministic gradient - shows through. `src` comes from `peek()`, which is
**synchronous** and therefore can only consult an in-memory memo:

```js
function peek(key) {                       // artCache.js:69
  if (!key || imagesDisabled()) return null;
  if (!isNative()) return remoteCand(key); // web: always immediate
  return resolved.get(key) || null;        // native: memo only
}
```

`resolved` is written **only** by the async `resolve()` (`artCache.js:92,115`), and `initArtCache()`
does not seed it. So the memo is **empty at every launch**: the first sighting of each key renders
nothing, an async `io.stat` runs, and only then does the image appear.

**The file was there the whole time. The knowledge that it was there is what the app throws away.**

Two consequences that confirm the diagnosis rather than merely fitting it:
- It is **native-only**. On web `peek` returns a candidate immediately, which is why this is invisible
  in the browser.
- It is **once per key per launch**, not per navigation - `resolved` is a module singleton that
  survives pillar switches.

### Cause 2 - the fade replays on every remount (already diagnosed 2026-08-10)

`ArtImage` holds `loaded` in **component state** (`ArtImage.jsx:68`). A pillar switch unmounts the
pillar, so on return `loaded` resets, `shown` is false, and the `<img>` paints at `opacity: 0` behind
a shimmer with a `.3s` transition - for every card, every time. Only the animation re-runs; the bytes
are local.

Measured on device (Pixel 9 Pro XL, build 218): returning to Home with art cached, deck panels are
black at t=0, fully painted by 400ms, byte-identical at 400ms and 1.9s.

### Success criteria

1. **Art already on disk paints on the first frame after a relaunch**, with no empty-source gap.
2. **Art already painted this session does not shimmer or fade again** on a later mount.
3. **A genuine first load still shimmers and fades.** The reverse regression is the one that matters:
   silently dropping the loading affordance would make a slow CDN fetch look like a broken image.
4. **Graceful degradation still holds, and its harness still works.** The property is
   ENGINEERING_CONSTITUTION §3.6: missing art must never make the app unusable. `imagesDisabled()` is
   not a user-facing mode - nothing in the app writes `cx-no-images`, and BUILD.md documents setting it
   by hand as the way to VERIFY the property. So this change must keep `peek`/`resolve` returning
   early on that flag, because that switch is how the invariant is exercised, and must not make any
   surface depend on art being present.
5. No additional network requests, and no additional disk reads on the hot path.

### Non-goals

- Changing where art is stored, how it is fetched, or the CDN boundary.
- Preloading or prefetching art that has not been requested.
- Touching the `artUrl` seam that `check:source` guards.

## Evidence

| Concern | Location |
|---|---|
| Renders nothing without a source | `src/components/ArtImage.jsx:52` (`ArtImg`) |
| Fade held in component state | `src/components/ArtImage.jsx:68,82` (`ArtImage`) |
| Synchronous peek, memo only | `src/store/artCache.js:69-73` |
| Memo written only by async resolve | `src/store/artCache.js:92,115` |
| Boot does not seed the memo | `src/store/artCacheInstance.js` - `initArtCache()` |
| First-paint decision, already pure and tested | `src/store/artSource.js` - `initial()`, `reduce()` |
| The seam that must not be bypassed | `scripts/check-source-guards.mjs` - `artUrl` allow-list |

## Options considered

| Option | Verdict |
|---|---|
| **A. Status quo** | Rejected - this is the reported defect |
| **B. Optimistic local candidate.** `peek` returns `convertFileSrc('art/<key>')` on native without checking the file, and the existing `onError` chain handles a miss | **PROPOSED for cause 1.** The local URI is derivable from the key alone; `resolve()` only goes async to VERIFY. The fallback machinery already exists and is tested |
| C. Persist the known-good key set and seed the memo at boot | Viable and more conservative, but it adds a second index that can disagree with the filesystem - a staleness problem where B has none. Held as the fallback if B's error path proves noisy |
| D. Warm the memo by listing `art/` at boot | Rejected - a directory scan on the boot path, and it races the first render anyway |
| **E. Session-level painted set.** A module-level set of keys already painted this session; a key in it renders at full opacity with no shimmer | **PROPOSED for cause 2** |
| F. Lift `loaded` into a React context | Rejected - more machinery than the problem needs, and it re-renders consumers on every image load |

**Why B is safe:** a wrong optimistic guess costs one failed image load, which `onError` already
handles by advancing the candidate chain - the same path a corrupted or deleted file takes today. The
cost is bounded and the machinery is not new.

**Why B might be wrong, honestly:** on a fresh install with no art downloaded, EVERY key guesses wrong
and every image fires an error before falling back. That is a lot of wasted `<img>` churn on exactly
the device state that is already slowest. Increment 2 observes it on a cleared cache, and option C is
the pre-chosen fallback if it is material.

## Proposed design

1. **`peek()` returns a local candidate optimistically on native.** Not a new URL source - the same
   `convertFileSrc('art/<key>')` composition `resolve()` already performs, so the `artUrl` seam is
   untouched and the allow-list does not change.
2. **`resolve()` keeps verifying.** The optimistic candidate is a first-frame guess, not a promotion;
   the memo still records only verified results, and a miss still falls through the existing chain.
3. **A module-level `painted` set** records keys whose `<img>` has fired `onLoad` this session.
   `ArtImage` consults it on mount: a painted key renders at `opacity: 1` with no shimmer and no
   transition; an unpainted one behaves exactly as today.
4. **The decision stays in `artSource.js`** - pure, DOM-free and already unit-tested - so the
   components remain zero-logic shells and the tests can reach it.

## Implementation plan

Two changes and one device pass. Deliberately not staged further - each piece is a few lines, and
gating them separately would cost more ceremony than the change is worth.

| # | Increment | Gate |
|---|---|---|
| 1 | Optimistic `peek` + `painted` set, with tests | Unit: warm-cache key paints on the first frame; a painted key mounts at full opacity; **an unpainted key still shimmers and fades**; an optimistic miss advances the candidate chain; zero-image unchanged |
| 2 | Device pass, and the fresh-install measurement taken **here** rather than as its own increment | Relaunch on a warm cache: no gap. **Cleared art cache: the loading affordance is still there**, and the error-path churn is observed rather than assumed |
| 3 | Docs | Art-boundary note; retire the ledger row |

**The one thing that stays a decision point:** if Increment 2 shows fresh-install error churn is
material, switch cause 1 to option C (persist the verified key set) rather than shipping the
optimistic path. That is a fallback already chosen, not a new design round.

## Verification plan

- **Automated:** `artSource` decides first paint from a peeked candidate; a painted key skips the
  shimmer; an unpainted key does not; the `cx-no-images` flag still short-circuits before any render or
  I/O; an optimistic miss advances the candidate chain exactly as a corrupt file does today.
- **Device:** relaunch with a warm cache and confirm no empty-source gap on avatars or deck panels;
  clear the art cache and confirm the shimmer and fade still appear on a genuine first load.
- **Regression:** `check:source` still passes - the `artUrl` seam is not bypassed. `check:cycles`
  unchanged.

## Risks and unanswered questions

| Risk | Impact | Mitigation |
|---|---|---|
| Fresh install fires an error per image | Medium - churn on the slowest device state | Observed at Increment 2; option C is the pre-chosen fallback |
| Dropping the shimmer hides a slow CDN fetch | **Medium-high** - a genuine load would look broken | Success criterion 3, with an explicit test for the reverse regression |
| `painted` grows unbounded | Low | Keys are short strings and bounded by the catalog; measure at Increment 2 |

**A note on the optimistic path and §3.6.** Rendering an `<img>` that may fail is not a degradation
risk in itself - `onError` already falls through to the deterministic placeholder, which is the same
path a deleted file takes today. What would breach §3.6 is any surface that assumes art resolves; this
change adds none.

## Self-Critique

**The strongest case against this:** the symptom is cosmetic. Nothing is lost, nothing is corrupted,
and a user who never relaunches never sees cause 1. Option B trades a guaranteed-correct async check
for a guess that is right almost always, and "almost always" is doing real work in that sentence - on
a fresh install it is wrong every single time.

**The failure most likely to escape tests:** the reverse regression. A test that a painted key skips
the shimmer is easy; proving a genuinely slow load still shows one requires simulating latency, and if
that test is weak the app will look broken on exactly the network conditions where feedback matters
most.

**Evidence that would change the decision:** if Increment 2 shows the fresh-install error churn is
material, option C - persisting the verified key set - is the better trade despite the second index.

## Approval record

| Date | Who | Disposition |
|---|---|---|
| 2026-08-13 | Owner | Directed that both causes be fixed on one branch |
| | Codex | Pending |
| | Owner | Pending approval of this proposal |
