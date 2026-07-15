# Proposal: make the zero-image release gate runnable on the artefact we ship

## Status and classification

**Status: Approved with revisions** (2026-07-15) · Risk: **Standard**
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner

> **Decision: Option A**, explicitly - `localStorage['cx-no-images']`, defined as an
> **app-wide diagnostic preference**, not a profile setting.
>
> ### The profile-isolation objection is answered, not tolerated
> I framed Option A as "quietly violates profile isolation". **It does not.** Card artwork
> belongs to the **shared catalogue**, and the setting simulates an *application/device
> capability* - "render Compendium without image assets". It is not profile-owned user
> data, so app-wide storage is the correct home rather than an accepted compromise. §3's
> boundary is intact.
>
> ### [C1] My Option B analysis was wrong, and it was wrong in the direction that matters
> The proposal states Option B needs **no schema bump**. **That is incorrect.** `settings`
> is a **column-based SQLite table**, so a profile setting requires:
> - a schema migration **and a schema-version bump**;
> - changes to `DEFAULTS` and the settings-column whitelist;
> - a synchronous in-memory mirror for `cardArt.js`;
> - cold-start ordering that prevents an art flash;
> - a mirror refresh on profile switch;
> - a subscription or forced rerender for mounted consumers.
>
> I priced Option B as "may require a settings mirror" and called the migration question
> "not applicable". **Option B is materially larger than my proposal suggests**, and I
> presented the two as near-equals. Option A preserves the already-tested read path and
> makes the gate operable with the smallest coherent surface.
>
> ### [C2] Diagnostics, not accessibility
> **Not** beside `Reduce motion` / `High contrast`. Its own clearly labelled
> **DIAGNOSTICS** section:
> > **Card art**
> > Show bundled card illustrations. Turn off to verify every screen works from data alone.
>
> Behaviour, stated explicitly in the UI's own terms: stored **app-wide on this
> installation** · **applies across profiles intentionally** · default **on** ·
> `cx-no-images=1` means off · browser testing keeps using the same key ·
> **reverting the feature must clear the key.**
>
> ### [C3] Immediate application - the real risk, and my assumption 3 was the weak point
> `Toggle` updates its local Settings state and profile SQLite. **A `localStorage` write
> alone guarantees no rerender of mounted card-art consumers.** The revised design must
> name **one app-level rerender path**:
> - keep `cardImageUrl()` as the **synchronous single read point**;
> - write the key;
> - increment an existing app-wide presentation revision, or introduce a narrowly named
>   **`artRevision`**;
> - ensure all mounted pillar content re-evaluates `cardImageUrl()`.
>
> **Do not remount the application** if that would discard forms, scroll positions, or an
> ongoing match. **If a safe app-wide rerender cannot be guaranteed cheaply, an explicit
> "Restart Compendium to apply" is more honest than a switch that looks immediate and
> leaves stale images.** First implementation step: **prove whether an App rerender
> suffices for every current consumer.**
>
> ### [C4] Documentation impact - narrower than I proposed
> - **`BUILD.md`**: the UI path **plus** the `localStorage` browser escape hatch.
> - **`COMPENDIUM_FEATURE_MATRIX.md`**: **only if** this is intentionally a supported user
>   capability. It is diagnostic infrastructure, so it belongs in `BUILD.md` rather than
>   inflating the product capability matrix. *(My proposal asserted a Feature Matrix entry
>   as a completion gate. Withdrawn.)*
> - **Architecture / data model**: unaffected - installation-global diagnostic state, not
>   profile data.
>
> ### Open questions, now closed
> 1. **A or B?** → **A**, on the merits above.
> 2. **Visible to all users, or diagnostics-only?** → its own **DIAGNOSTICS** section.
> 3. **Keep `cx-no-images` as a browser escape hatch?** → **yes**, it is the same key.

## Problem and success criteria

**A release gate that cannot be exercised on a release build is not a gate.**

`ENGINEERING_CONSTITUTION.md` §3 names *graceful zero-image degradation* as a non-negotiable invariant, and `BUILD.md:134` documents how to verify it: set `localStorage['cx-no-images'] = '1'`. That instruction assumes a devtools console.

**Verified on the device, this session:** the shipped release build exposes **no WebView devtools socket**. `capacitor.config.json` declares no `webContentsDebuggingEnabled`, and `android/app/build.gradle` is not debuggable (`minifyEnabled true`, release signing). Launching build 33 and inspecting `/proc/net/unix` returns no `webview_devtools_remote_*` entry. **There is no supported path to set that flag on the artefact users receive.**

So the gate has only ever been run in a browser — a different engine, a different WebView, a different image pipeline — and the invariant has never been observed where it must hold. Codex's outstanding requirement ("verify `cx-no-images` on build 33 or a subsequent release build") is **currently unsatisfiable**, and that is the actual finding.

**Success criteria**

1. Zero-image mode is reachable **on a release build, on device, with no tooling**.
2. It persists across app restarts and survives the existing `cardArt.js` read path unchanged.
3. Toggling is **immediate and reversible** — no reinstall, no data loss, no profile change.
4. The Codex checklist becomes runnable end to end: fresh match ash → ceremony → colour → taps → DD → recovery → resume.
5. Zero change to how art is resolved when the flag is off.

**Non-goals**

- Changing `cardArt.js`'s resolution logic or any fallback artwork.
- A per-pillar or per-surface image switch. One flag, app-wide, as today.
- Shipping `webContentsDebuggingEnabled` in release. Explicitly rejected below.
- Making this a user-facing *feature* pitched as a data saver. It is a diagnostic that users may use.

## Evidence and current architecture

- `src/store/cardArt.js:23-25` — the flag already exists and is already the single read point:
  ```js
  // Toggle via localStorage['cx-no-images'].
  try { return localStorage.getItem('cx-no-images') === '1'; } catch { return false; }
  ```
  **This proposal adds a way to write it. It does not invent a mechanism.**
- `src/App.jsx:846-848` — the Settings surface and the exact pattern to follow:
  ```jsx
  <Toggle label="High contrast" k="high_contrast" hint="Brighter text and stronger outlines." />
  <Toggle label="Reduce motion" k="reduced_motion" hint="Minimise animations and transitions." />
  <Toggle label="Haptics"      k="haptics"       hint="Subtle vibration on key taps." />
  ```
  Three sibling appearance/diagnostic switches. A fourth is not a new concept.
- `src/appearance.js:34-35` — `reduced_motion` is a **profile setting** ORed with an OS media query, applied as a body class. **This is the precedent that matters, and it raises the one real design question below** (§Options): settings here live in the profile, but `cx-no-images` lives in `localStorage`.
- `BUILD.md:134` — documents the flag; must change if the mechanism gains a UI.
- Device evidence (this session): build 33 installed (`versionCode=33`, `versionName=1.0.1-alpha`), no devtools socket, app launched and confirmed running.

## Assumptions and confidence

1. **`Toggle` writes profile settings, not `localStorage`.** Confidence: **high** (`k="reduced_motion"` → `s?.reduced_motion` in `appearance.js`). **This is the crux — see Options.** Validation: read `Toggle`'s implementation before writing a line.
2. **`cardArt.js`'s reader is synchronous and called during render.** Confidence: **high** — it is a `try/catch` around `localStorage.getItem`, which is synchronous. A profile-settings read may not be, which is exactly why the storage choice is not cosmetic.
3. **Flipping the flag re-renders affected surfaces.** Confidence: **low**. `cardArt.js` is read at call time; nothing subscribes to `localStorage`. A toggle that requires an app restart to take effect would satisfy criterion 1 but not criterion 3. **Validation: prove it on device; if it needs a remount, say so and design for it.**
4. **No migration is needed.** Confidence: **high** — absent flag reads as `false`, the current behaviour.

## Affected systems and invariants

- **Invariant touched — graceful zero-image degradation (§3).** This change does not alter the degradation path; it makes it **observable**. That is the whole point: the invariant is currently unverifiable on the shipping runtime, which is a weaker position than any implementation detail.
- **Profile isolation:** *depends on the storage decision.* `localStorage` is app-wide and would leak the setting across profiles. If it becomes a profile setting, it follows the profile — which is arguably more correct and is why Option B exists.
- **Catalog/profile boundary:** untouched. Art resolution is a read concern.
- **UI:** one row in Settings.
- **Docs:** `BUILD.md:134` must stop instructing a devtools console. `COMPENDIUM_FEATURE_MATRIX.md` gains a user-visible capability. **Completion gate, not courtesy.**

## Options considered

| Option | Verdict |
|---|---|
| **Status quo** | **Rejected — this is the finding.** The gate is unrunnable on a release build. |
| **`webContentsDebuggingEnabled: true` in release** | **Rejected.** It makes every shipped build inspectable — an offline-first app whose entire local database becomes readable through `chrome://inspect` on any unlocked device. A permanent attack surface to serve an occasional test. Acceptable only as a temporary local build, never as a shipped default. |
| **Build 34 with the flag, verify, then remove** | Viable *today*, rejected as *the answer*. It re-blocks the gate the moment it lands, and every future verification pays the same cost. It treats a recurring need as a one-off. |
| **A Settings toggle writing `localStorage`** (**Option A**) | Candidate. Smallest change: `cardArt.js` is untouched, the read path is proven. Cost: app-wide, so it **crosses the profile boundary** — profile A's diagnostic follows profile B. |
| **A Settings toggle as a profile setting** (**Option B**) | Candidate, and probably correct. Consistent with `reduced_motion`/`high_contrast`, respects profile isolation. Cost: `cardArt.js`'s synchronous reader must reach profile settings, which may mean a cached mirror — a real design question, not a rename. |
| **A hidden gesture** (tap Credits ×7) | Rejected. Undiscoverable, undocumented, untestable by anyone who has not been told, and it is exactly the kind of thing that rots. |

**I am not choosing between A and B in this draft.** The honest reason: assumption 1 decides it, and I have not yet read `Toggle`'s implementation. **A** ships in an hour and quietly violates profile isolation. **B** is consistent and correct and may require a settings mirror for a synchronous reader. **This is precisely the kind of decision the constitution says not to make while coding**, so it is the first named question for the reviewer.

## Proposed design

Deliberately deferred pending the storage decision. Both options share:

- One `<Toggle>` in `App.jsx`'s appearance group, beside `Reduce motion`.
- **Copy:** label `Card art`, inverted so the switch reads positively (on = art shown, the default). Hint: `Turn off to check the app reads fully from data alone.` **No jargon, no "zero-image", no `cx-no-images`.** A user who finds it should understand it; an engineer who needs it will recognise it.
- `cardArt.js` keeps exactly one read point.
- Absent/unset ⇒ art on. The default never changes.

**Open:** whether flipping it re-renders live or needs a remount (assumption 3). If a remount is required, the toggle must say so rather than appear broken.

## Implementation plan

1. **Read `Toggle` and the settings write path.** Resolve Option A vs B. **Report the finding and the recommendation before writing code** — this is the checkpoint, and the proposal is not complete until it passes.
2. Add the toggle; wire it to the chosen store; keep `cardArt.js`'s reader as the single read point.
3. **Prove it on device, on a release build.** Toggle off → art gone across Codex, Collection, Decks, Play. Toggle on → art back. Restart → the setting held.
4. **Run the actual gate** — the eight-step Codex checklist, on the release build, which is the entire purpose.
5. Docs: `BUILD.md:134` rewritten to name the toggle (keeping the `localStorage` note only if Option A survives); `COMPENDIUM_FEATURE_MATRIX.md` updated.
6. Full gates.

## Data migration and compatibility

**Option A:** not applicable — `localStorage` key already exists and reads `false` when absent.
**Option B:** a new profile setting key. Forward-only; absent ⇒ art on. Existing profiles are unaffected because absence is the current behaviour. No transaction boundary beyond the existing settings write.

## Rollback and recovery

Remove the toggle. The `localStorage` key (Option A) or setting (Option B) becomes inert and reads as `false`. No data is at risk; nothing is destroyed; **no point of no return.** A user left with art disabled and the toggle removed would be stranded — so if this is ever reverted, the flag must be cleared in the same change.

## Verification plan

- **Automated:** none meaningful. This is a UI switch over an existing read path; a unit test would assert React state and prove nothing about the gate.
- **Native:** the whole point. Steps 3-4 on a **release** build.
- **Web:** confirm the browser path still honours it.
- **Accessibility:** the `Toggle` primitive's existing semantics; one more row, same pattern.
- **Regression:** with the toggle *off* (art on), confirm nothing changed — the default path is the one 100% of users take.

## Security, privacy, performance, and operations

No new permission, no network, no telemetry, no CDN. **This proposal exists partly to avoid a security regression** (shipping an inspectable WebView). Zero-image mode is strictly less I/O. `localStorage` reads are synchronous and already on this path.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Option A silently breaks profile isolation** | **High if A is chosen** | Medium | Named here; step 1 decides deliberately rather than by momentum. |
| The toggle needs a remount to take effect | Medium | Low | Prove in step 3; state it in the UI if true. |
| A user turns art off and forgets why the app looks bare | Low | Low | Positive framing (`Card art`, on by default); it lives in Settings beside the other appearance switches. |
| Scope creep into a "data saver" feature | Low | Medium | Non-goal, stated. |

**Unanswered, and for the reviewer:**
1. **Option A or B?** Storage decides profile isolation. My lean is **B**, if the synchronous reader can be served without contortion.
2. Should the toggle be visible to all users, or only under a diagnostics section? I lean visible — a hidden gate rots, and zero-image mode is genuinely usable.
3. Does `cx-no-images` remain a supported `localStorage` escape hatch for browser testing even if B is chosen? I lean yes: it costs one `||` and keeps `BUILD.md`'s existing instruction true.

## Self-Critique

**The strongest case that this is wrong:** *it adds product surface to serve a test.* Users get a switch they did not ask for because our verification story is broken — and the cheaper honest answer is a temporary local build with `webContentsDebuggingEnabled`, verify, throw it away. That is genuinely less code and no permanent UI. **My rebuttal is that "temporary" has already failed once**: the gate has existed since the invariant was written and has never been run on a release build, because each verification needed bespoke setup nobody had time for. **A gate that is expensive to run does not get run** — that is the actual evidence here, and it is why I would spend product surface on it.

**Hidden coupling:** `cardArt.js` is read during render and knows nothing about React. Any store that is not synchronous couples image resolution to settings-load ordering — and a mis-ordered read on a cold start would flash art *off* and then on, or worse, cache the wrong answer. **That is the real risk in Option B and it is not visible from the proposal's surface.** It is also why I refuse to pick A vs B before reading `Toggle`.

**Simpler alternative I cannot dismiss:** ship nothing; add one line to `BUILD.md` saying the gate requires a locally-built inspectable release, and run it once per release. Honest, zero code, and it accepts that the gate is expensive. **If the reviewer prefers this, the counter-argument is only that it has already not happened.**

**The failure most likely to escape:** the toggle *appears* to work in the browser and on a debug build, and the release build's art path differs (Capacitor's `capacitor://localhost` scheme, `strip-native-wasm.mjs`, the static-copy plugin). Then the gate passes while the shipped runtime still fails — **the exact class of error I made when I called a Firefox check "verified on a Pixel 9 Pro XL"**. Mitigated only by step 3-4 running on a release build, and by nothing else.

**Evidence that would change the decision:** if `Toggle` turns out to write `localStorage` already, A is free and the profile-isolation objection needs a real answer rather than a shrug. If flipping it cannot re-render without a full remount, the toggle is a worse experience than a rebuild and this proposal weakens considerably.

## Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted | 2026-07-15 |
| Codex (reviewer) | *pending* | |
| Human (approver) | *pending* | |
