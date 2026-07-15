# Proposal: A What's New changelog gate on update, and a coherent home for Credits and Settings

## Status and classification

**Status:** **Approved** (human, 2026-07-16), revision 3
**Risk:** Standard
**Owner:** Claude Code (lead engineer)
**Reviewer:** Codex / ChatGPT (principal engineer, adversarial review)
**Approver:** Human project owner

Classified Standard rather than Trivial: it introduces a new persisted app-global key, a new boot-time gate, and it moves two existing entry points. Not High-risk: no schema change, no migration, no user-data mutation, and no touch to the catalog/profile boundary.

### Revision 3 changelog

The owner settled the Settings chassis disagreement **against** the author, and directed the delivery order.

**Decision: Settings becomes a `CenteredModal`, opened over an open Profiles sheet.** The author's revision 2 objection is withdrawn. Two errors in it, both worth recording because they point the same way:

1. **The author priced the wrong thing.** Revision 2 treated "closing Settings returns to the app root" as a neutral consequence of close-then-open. It is not neutral; it is a regression. The user reaches Settings *from* Profiles, so Profiles is the correct destination on close. Discarding the originating context is a real cost that revision 2 recorded as a design note rather than weighing.
2. **The author had the risk inverted.** Revision 2 argued modal-over-sheet was the untested configuration needing device evidence. **It is the configuration already shipping.** `CreditsModal` (`CenteredModal`, `z-index: 700`, `ui.jsx:256`) opens today from `SettingsSheet` (`GothicSheet`, `z-index: 200`, `GothicSheet.jsx:33`), which is modal-over-sheet in production. The *author's* close-then-open sheet-swap is what had no precedent. Revision 2 asked for device proof of the proven pattern while proposing a novel one.

The owner's stated reasoning: the modal leaves the sheet open beneath it, which is a clear division of hierarchies and matches how settings changes are surfaced in the app. This is correct and is now the design. `COMPENDIUM_ARCHITECTURE.md:192` (M3 bottom sheets) and the thumb-reach argument are noted and overridden by the owner's product authority; per `ENGINEERING_CONSTITUTION.md:1`, an explicit human decision for the current change outranks local convention.

**Mechanism, verified (`GothicSheet.jsx:17`, `ui.jsx:259`):** both chassis register a `registerBackConsumer`, and `back.js` is LIFO. With Profiles mounted and Settings opened over it, hardware back peels Settings first and lands on Profiles. The desired contract falls out of existing machinery with no new code.

**Delivery order (owner-directed): two commits.** See "Implementation plan".

**Also corrected in revision 3:** the proposal had **no Implementation plan section**, which `ENGINEERING_CONSTITUTION.md:8` requires. Revisions 1 and 2 both omitted it and neither the author nor the reviewer noticed. Added.

### Revision 2 changelog

Four Majors and one Minor were raised. All five are accepted; each was independently verified against the code before acceptance.

| Finding | Disposition |
|---|---|
| Major: proposed test would not run | **Accepted.** Verified: `test:codex` is `scripts/codex/**/*.test.mjs`; the suites are `scripts/codex/**`, `src/store/**`, `src/pillars/**`. `src/content/**` is discovered by nothing. Fixed by moving the tested logic to `src/store/`. |
| Major: eligibility semantics contradict | **Accepted.** The contradiction was real and mine. Adopted the recommended `seen < entry.build <= current`. |
| Major: do not approve stacked sheets | **Accepted.** Profiles closes before Settings opens. Risk row, device fallback, and the "verify on device" hedge are deleted, not downgraded. |
| Major: documentation impact incomplete | **Accepted.** Verified `COMPENDIUM_DATA_MODEL.md:56` reads "One `activeProfileId` key". `DATA_MODEL` and `BUILD.md` added to the affected table. |
| Minor: hardware-back ownership misdescribed | **Accepted.** Verified `CenteredModal` registers its own consumer (`ui.jsx:259`) and `runBackConsumers()` precedes the declarative stack (`App.jsx:288`). The `backStack` row was dead code; removed. |
| Recommendation: replace `SettingsSheet` with `SettingsModal` | ~~Declined~~ → **Accepted in revision 3.** The reviewer was right and the author was wrong. See the revision 3 changelog above. |

## Problem and success criteria

### Problem

Compendium is in alpha distribution to testers. When a tester installs a new build there is no way to learn what changed. `build` already increments on every device install (`BUILD.md:44-63`) and is already printed in Credits, so the app knows precisely which build a user last ran, but it does nothing with that knowledge. The tester's only signal that anything changed is noticing it themselves.

A second, adjacent problem surfaced while scoping this: **Credits is buried and Settings is mis-homed.** Credits sits at Settings > About > Credits, three taps deep, behind a sheet whose subject is accessibility toggles. Settings is reached by tapping the wordmark while on Home, which is a discoverability dead end (nothing indicates the wordmark is tappable, and the binding is invisible on every other pillar). Neither belongs where it is, and the changelog needs a permanent home that is not "the modal you already dismissed".

### Success criteria

1. A tester who installs a build newer than the one they last ran sees the notes for **every** build in between, once, on first launch of the new build.
2. Dismissing it is durable: it does not reappear on the next launch, next profile switch, or app resume.
3. The notes remain reachable on demand afterwards, without tampering with stored state.
4. A tester can always answer "what changed since I last looked" without asking the project owner.
5. Changelog content is authored as **data**, not as UI (invariant 7).
6. Zero regression to the existing wordmark-is-the-home-button behavior on non-Home pillars.
7. **Closing Settings returns to Profiles**, the surface it was opened from, with Profiles never having been unmounted.

### Non-goals

- **Onboarding.** This is explicitly not onboarding and must not become it. See "The alpha welcome decision" below for the one place these overlap and why that overlap is deliberate and temporary.
- **Retroactive notes for builds 1 to 34.** No changelog data exists for the app's history and reconstructing it from git is out of scope. See Assumption 4.
- **Remote or catalog-delivered changelog content.** Notes ship in the bundle. The app is strictly offline-first with zero CDN dependency.
- **Per-entry read state, "new" badges, or dismissal analytics.**
- **Redesigning the Settings body.** Its chassis changes from `Sheet` to `CenteredModal` per the owner's decision; the font-scale slider and the three toggles are moved verbatim, not redesigned.

## Evidence and current architecture

### Version and build plumbing

`vite.config.js:11,25-28` reads `package.json` at config time and bakes two compile-time globals:

```js
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
define: {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __APP_BUILD__: JSON.stringify(String(pkg.build)),
}
```

`package.json:3-4` is currently `"version": "1.0.1-alpha"`, `"build": 35`. `android/app/build.gradle:9,26-27` reads the same file for `versionCode`/`versionName`.

**`__APP_BUILD__` is a string, not a number** (`String(pkg.build)` then `JSON.stringify`). This is load-bearing for this proposal and is called out again under Risks.

### Test suite discovery (verified, revision 2)

`package.json` scripts, read directly:

```
test:codex     node --test "scripts/codex/**/*.test.mjs"
test:query     node --test "src/store/**/*.test.mjs"
test:ui        node --test "src/pillars/**/*.test.mjs"
```

**Three globs, three directories.** `src/content/**` is owned by no suite, so revision 1's test would have been dead on arrival: `npm run test:codex` would have passed green while never discovering it. The existing precedent for a pure-logic test living under `src/store/` is `src/store/matchStats.test.mjs`, which tests a pure reducer, not a repository. That is the pattern this follows.

### Existing precedent for a run-once gate

None user-facing. `grep -i` for `first.?run|onboard|hasSeen|seen_?version|whats.?new|changelog` returns nothing. The nearest precedents are boot-time idempotent backfills at `src/App.jsx:118-135` (`migrateAnnotationsIfNeeded`, `backfillSingleSetOwned`), each wrapped in `try/catch` so a failure never blocks boot and simply retries next launch. That is the shape this gate should adopt.

### Persistence tiers, and which one this belongs to

| Tier | Where | Constraint |
|---|---|---|
| Per-profile SQLite `settings` | `src/store/schema.js:183-195`, accessors `src/store/playRepository.js:15-37` | Authoritative user data. Round-trips through `src/store/profileTransfer.js:61,142-150`. |
| `@capacitor/preferences` | Only use today: `activeProfileId` (`src/store/profileRepository.js:5,10,32,41,83`) | App-global native singleton. Inventoried at `COMPENDIUM_DATA_MODEL.md:56` as **"One `activeProfileId` key"**. |
| `localStorage` | `cx-`-prefixed UI state (`ongoingMatch.js:8`, `Collection.jsx:352`, `cardArt.js:23`) | "must not become a profile data store" (`COMPENDIUM_DATA_MODEL.md:65`) |

`COMPENDIUM_ARCHITECTURE.md:150` names the tier for exactly this case:

> Use **`@capacitor/preferences`** for small singletons (`app.json`, `activeProfileId`, per-profile `settings.json`) - it's native `UserDefaults`/`SharedPreferences`, survives reinstall-safe backup rules better than `localStorage`.

`docs/proposals/zero-image-toggle.md:114,128,140` is the repo's own prior reasoning on the localStorage-versus-profile-settings question for an app-wide flag, and it identifies the decisive cost of the profile tier: *"crosses the profile boundary - profile A's diagnostic follows profile B"*.

### The surfaces being moved

`src/App.jsx:326-332`, the wordmark, **already implements the requested navigation contract**:

```jsx
{/* Wordmark = the app's home button (platform convention). Only when
    already sitting on Home does it open Settings. */}
<button onClick={() => {
  const atHome = tab === 'home' && !viewDetail && !hasQuery && !addActive && !preMatch;
  if (atHome) setSettingsSheet(true); else goTab('home');
}} ... aria-label="Home / Settings">
```

The "logo drives back home from anywhere else" half is done and shipping. Only the `atHome` branch target changes.

- `SettingsSheet` (`src/App.jsx:~820-858`) is a `<Sheet>`; its `ABOUT` section (`:849-853`) is the sole caller of `onCredits`. Body is a font-scale slider plus three toggles.
- `CreditsModal` (`src/App.jsx:861-886`) is a `<CenteredModal maxWidth={350}>` and is the only consumer of `__APP_VERSION__` / `__APP_BUILD__` (`:874-875`).
- `ProfileSheet` (`src/App.jsx:701-799`) is a `<Sheet title="Profiles">` ending in an Export/Import button row (`:793-796`). This is where the Settings entry point lands.
- `backStack` (`src/App.jsx:270-287`) declares hardware-back precedence once, top of stack first, and `runBackConsumers()` runs **before** it (`:288`).

### Back-button ownership (corrected, revision 2)

`CenteredModal` (`src/components/ui.jsx:256-262`) already owns its own dismissal:

```js
const trapRef = useFocusTrap(open);
const closeRef = React.useRef(onClose); closeRef.current = onClose;
React.useEffect(() => { if (open) return registerBackConsumer(() => { closeRef.current?.(); return true; }); }, [open]);
```

Since `App.jsx:288` calls `runBackConsumers()` before consulting `backStack`, a `backStack` row for an open `CenteredModal` is **unreachable**. Revision 1 proposed one. It was dead code that would have implied a second, divergent dismissal path. Removed.

## Assumptions and confidence

1. **`build` is monotonic across every install a tester receives.** Confidence: **high**. It is the Android `versionCode`, which the platform itself refuses to move backwards on upgrade, and `BUILD.md:44-63` makes the +1-per-install rule a standing contract. Validation: read `versionCode` off two successive APKs.
2. **A tester never needs to see notes for a build they never ran.** Confidence: **high**. This is the definition of catch-up semantics and follows directly from the approved answer.
3. **`@capacitor/preferences` resolves before the changelog gate is evaluated.** Confidence: **high**. `initProfiles()` (`src/App.jsx:130`) already awaits Preferences during boot, so the plugin is warm. Validation: gate is placed after that await.
4. **Notes for builds 1 to 34 are not required.** Confidence: **medium**. The changelog data starts at the first build that ships this feature. Every tester's stored stamp will be absent on that first run, so they all take the fresh-install path regardless. Validation: human confirmation.
5. ~~Two stacked `<Sheet>`s render acceptably.~~ **Withdrawn in revision 2.** The design no longer co-mounts them, so the assumption is not made.

## Affected systems and invariants

| System | Change |
|---|---|
| `src/content/changelog.js` | **New.** Changelog entries as data. No logic. |
| `src/store/changelog.js` | **New.** The seen-build stamp (Preferences) and the pure `pendingEntries` selector. Under `src/store/` so `test:query` owns it. |
| `src/components/ChangelogModal.jsx` | **New.** `CenteredModal` render of a list of entries. Lazy. |
| `src/App.jsx` | Boot gate; one new state; one `dismissChangelog`; wordmark target swap; Settings entry point moved into `ProfileSheet`; `CreditsModal` gains a What's New row. |
| `src/store/changelog.test.mjs` | **New.** Runs under `npm run test:query`. |
| `COMPENDIUM_DATA_MODEL.md` | **Added revision 2.** §3 inventory at `:56` says "One `activeProfileId` key" and becomes wrong the moment a second key exists. Update, and classify the stamp as non-profile, non-exported, install-local. |
| `COMPENDIUM_ARCHITECTURE.md` | Persistence tier note (`:150`) and entry-point map (`:161`, `:239`, which both describe the profile sheet's contents). |
| `COMPENDIUM_FEATURE_MATRIX.md` | New capability row and status. |
| `BUILD.md` | **Added revision 2.** "Create or update the changelog entry" beside the `build` bump at `:44-63`. |
| `ENGINEERING_CONSTITUTION.md`, `AGENTS.md`, `CLAUDE.md` | Reviewed, no change required. |

**Invariants engaged:**

- **7, Content is data** (*directly*). Notes live in `src/content/changelog.js` as structured entries. The modal renders whatever it is handed and contains no per-version conditionals. Adding a release is a data edit.
- **3, Durable offline-first writes** (*adjacent, and deliberately not violated*). The seen-stamp is **not** user data; it is install-local device state, so Preferences is correct and SQLite would be wrong. The invariant's prohibition is on treating non-durable stores as authoritative for *user data*; this is not that. Losing this stamp costs one redundant modal.
- **1 and 2, catalog/profile boundary and profile isolation** (*preserved by construction*). The stamp is app-global and never enters the profile tier, so it cannot cross between profiles or ride a profile export to another device. Choosing the SQLite `settings` table would have broken this: a tester importing a profile from another device would inherit a foreign stamp and either miss notes or re-see them.
- **6, Graceful asset degradation** (*trivially held*). Text only. No card art, no avatars, no network.
- **8, Cross-runtime integrity** (*engaged*). `@capacitor/preferences` is native `SharedPreferences` on Android and falls back to `localStorage` on the browser dev runtime. Web success is not native proof; device evidence is required before this ships.
- **4, Forward-only schema evolution** (*not engaged*). No schema change. `SCHEMA_VERSION` stays 9.
- **5, Transactional user-data operations** (*not engaged*). No user-data write.

## Options considered

### Where the seen-stamp lives

| Option | Verdict |
|---|---|
| **`@capacitor/preferences`, app-global** | **Proposed.** The tier `COMPENDIUM_ARCHITECTURE.md:150` names for exactly this. Survives profile switch, profile import, and backup/restore correctly. Not user data, so `profileTransfer.js` is untouched. |
| Per-profile SQLite `settings` column | **Rejected.** Costs a migration plus a `SCHEMA_VERSION` bump plus an export/import round-trip change, and buys a *defect*: the flag becomes per-profile and profile-transferable. A tester with two profiles sees the modal twice; a tester importing a profile inherits another device's stamp. `zero-image-toggle.md:128` rejects an app-wide flag on this same reasoning. |
| `localStorage` | **Rejected.** Weaker survival across Android backup/restore than Preferences for no saving, and the repo's only Preferences key (`activeProfileId`) is the precedent for install-global singletons. |
| Stamp nothing; use a bundled build constant | **Rejected.** Cannot work. Nothing persists across the install boundary, so it would fire every launch. |

### Trigger comparison

| Option | Verdict |
|---|---|
| **Compare stored build to `__APP_BUILD__`** | **Proposed.** Integer, monotonic, already the `versionCode`. |
| Compare version strings | **Rejected.** `1.0.1-alpha` is semver-with-prerelease; correct comparison needs a parser, and multiple builds share one version string, so a tester installing build 36 and 37 of `1.0.1-alpha` would see nothing. |

### Surface

`CenteredModal` was chosen by the project owner. Recorded alternatives: a bespoke full-screen overlay in the `CreateDeckWizard` idiom (more room, but a new chassis for a screen shown once per release) and `<Sheet>` (free chassis, but reads as incidental and is the app's minor-picker surface). `CenteredModal` reuses the existing chassis, sits at the right altitude, and is the surface Credits already uses, which matters since the two now sit adjacent.

### Profiles-to-Settings transition (settled, revision 3)

| Option | Verdict |
|---|---|
| **Settings as `CenteredModal` over the open Profiles sheet** | **Approved by the owner.** `z-index: 700` modal over a `z-index: 200` sheet: a clear hierarchy, no equal-z contest, and Profiles is never unmounted, so closing Settings returns to it. **This is the configuration already shipping** (`CreditsModal` opens from `SettingsSheet` today), so it is the low-risk option, not the speculative one. Back is LIFO and lands on Profiles for free. |
| Two stacked `GothicSheet`s | **Rejected** (reviewer, accepted). Two scrims at `z-index: 200` resolved only by DOM order, two focus traps, double-darkening. Never proposed as final. |
| Close Profiles, then open Settings | **Rejected** (owner). The author's revision 2 design. It unmounts Profiles, so closing Settings dumps the user at the app root rather than back where they came from. That is a regression in the flow, and it invents a sheet-swap the app has no precedent for. |
| Nest Settings inside the Profiles sheet body | **Rejected.** Turns a flat sheet into a two-level in-sheet navigator, a pattern with no precedent in the app. |

## Proposed design

### Content, as data

`src/content/changelog.js`, newest first, no logic:

```js
// The changelog shown on update. Ordered newest-first; `build` is the
// package.json build the entry shipped in, and is what the seen-stamp
// compares against. Adding a release is a data edit, never a UI edit.
export const CHANGELOG = [
  {
    build: 36,
    version: '1.0.2-alpha',
    date: '2026-07-16',
    notes: 'Optional short prose intro, omitted on most entries.',
    changes: [
      { kind: 'added',   text: 'A What’s New screen on every update.' },
      { kind: 'changed', text: 'Settings now lives in the profile sheet.' },
      { kind: 'fixed',   text: '…' },
    ],
  },
];
```

`kind` is a closed set of `added | changed | fixed`, each with a token-driven accent, rendered by lookup rather than by branching. An unknown `kind` falls back to neutral ink rather than throwing.

### The stamp and the gate

Both live in `src/store/changelog.js`, so `test:query` discovers the test:

```js
// App-global, install-local device state - NOT profile-owned user data, and
// deliberately not in the settings table: a per-profile stamp would re-show the
// changelog on every profile switch and would ride a profile export onto another
// device. See docs/proposals/changelog-screen.md.
const SEEN_BUILD = 'changelogSeenBuild';
export async function getSeenBuild() { /* Preferences.get -> Number | null */ }
export async function setSeenBuild(build) { /* Preferences.set(String(build)) */ }
```

`getSeenBuild` returns `null` for absent **and** for unparseable, collapsing corruption into the fresh-install path.

### Eligibility, stated once (revision 2)

Revision 1 contradicted itself: the function returned `build > seen` while the tests asserted that a current build with no entry returns `[]`. Both could not hold. **The single rule is now:**

> **`seen < entry.build <= current`**, where absent `seen` is treated as negative infinity.

The upper bound excludes entries authored ahead of the shipped build (a real hazard, since notes get written before the bump). The lower bound is the catch-up semantics. Crucially, an entry is **not** conditioned on `current` having an entry of its own, so skipping notes for one release does not swallow the previous release's notes:

```js
// Entries the user hasn't seen. seen === null means a fresh install.
// Rule: seen < entry.build <= current. The upper bound drops entries authored
// ahead of the shipped build; the lower bound is what makes catch-up work.
export function pendingEntries(changelog, seen, current) {
  if (!Number.isFinite(current)) return [];              // defensive: bad __APP_BUILD__
  return changelog.filter((e) => e.build <= current && (seen === null || e.build > seen));
}
```

The worked example from the review: `seen = 35`, `current = 37`, changelog has 36 but not 37. **Returns entry 36.** Build 36's notes are real and unseen; the absence of notes for 37 is not a reason to withhold them. Revision 1's prose said "shows nothing and stamps nothing" here, which was wrong, and the accompanying test would have enforced the bug.

### The gate

Boot, slotted alongside the existing backfills at `src/App.jsx:129-134`, after `initProfiles()`:

```js
try {
  const seen = await getSeenBuild();
  const pending = pendingEntries(CHANGELOG, seen, Number(__APP_BUILD__));
  if (pending.length) setChangelog(pending);
  else if (seen === null) await setSeenBuild(Number(__APP_BUILD__));  // fresh install, nothing to show
} catch (e) { console.error('changelog gate failed', e); }
```

Wrapped in `try/catch` like every neighbouring backfill: a Preferences failure logs and shows nothing rather than blocking boot.

**Stamp on dismiss, not on show.** If the app is killed mid-read, the notes reappear. Re-showing is the benign failure; silently swallowing a release's notes is not.

**Downgrade is inert.** With `entry.build <= current`, a tester on build 37 who sideloads build 35 sees nothing new, so no dismiss fires, so the high-water mark is never written down. Re-upgrading behaves correctly.

### One dismissal path (revision 2)

There is exactly one, and every route reaches it:

```js
const dismissChangelog = async () => {
  setChangelog(null);
  try { await setSeenBuild(Number(__APP_BUILD__)); }
  catch (e) { console.error('changelog stamp failed', e); }   // benign: re-shows next launch
};
```

Passed as `CenteredModal`'s `onClose`. The scrim, the close button, Escape (via `useFocusTrap`), and Android hardware back (via the modal's own `registerBackConsumer`) all land on it. No `backStack` row: it would be unreachable behind `runBackConsumers()`, and a second path is exactly how the two routes drift apart.

**Opened from Credits, the same modal must not stamp**, since it is showing the full history on demand rather than reporting news. `onClose` is supplied by the call site: the gate passes `dismissChangelog`, Credits passes a plain close.

### The alpha welcome decision, and why it is deliberate

A fresh install has no stamp, so `pendingEntries` returns **every** entry at or below the current build, and a brand-new tester sees the app's whole recorded history.

The orthodox choice is to suppress this. A changelog implies a "before", and a user with no baseline has nothing to compare against; the first-run slot properly belongs to onboarding.

**We are deliberately not doing the orthodox thing, for the duration of alpha.** The project owner's reasoning, recorded here in substance for the reviewer: *while in alpha testing, it is a good thing for testers to know exactly what changes between versions.* An alpha tester is not a naive user. They are frequently someone who has run an earlier build on another device, or is joining a cohort mid-stream and needs the accumulated context to test against. The full history is the most useful thing to hand them, and the cost of being wrong is one dismissible modal.

**This is explicitly temporary.** The reviewer endorsed keeping the full history during alpha, and required that the decay be prevented by something other than good intentions. Accepted: **the 1.0 release checklist gains an explicit item to revisit or cap fresh-install history**, and the constant carries a comment pointing at it. This is the mitigation for the one failure mode neither of us can test for, which is that the rationale outlives the circumstances that justified it.

### Navigation restructure

Three moves. The first is a one-line swap, not new machinery:

1. **Wordmark on Home opens Credits** (was Settings), `src/App.jsx:326-332`. The `else goTab('home')` branch is untouched and already satisfies "the logo drives back home everywhere else". `aria-label` becomes `"Home / Credits"`; the comment above it and the stale one at `:451` ("the wordmark opens Settings") are corrected.
2. **Settings gains an entry point in `ProfileSheet`**, a full-width row below the Export/Import pair (`src/App.jsx:793-796`) under a small `APP` section label, matching the chevron-row idiom from the ABOUT section being deleted. Activating it **opens the Settings modal over the still-open Profiles sheet**; closing Settings reveals Profiles again. The profile chip is the app's account surface and Settings is account-adjacent; this also gives Settings a visible entry point rather than a hidden wordmark binding.
3. **Credits gains a What's New row**, opening the same `ChangelogModal` with the full `CHANGELOG` and a non-stamping `onClose`. `SettingsSheet` loses its ABOUT section and its `onCredits` prop entirely.

`ChangelogModal` is `lazy()`, per the cold-overlay rule at `src/App.jsx:34-37`.

### Settings becomes a modal (settled, revision 3)

`SettingsSheet` becomes `SettingsModal` on the `CenteredModal` chassis. The author argued to keep the sheet; the owner overruled it and the owner is right. The reasoning, and the disposition of each of the author's objections:

- **Hierarchy (owner, decisive).** A modal over a sheet is two distinct layers doing two distinct jobs: Profiles is the context, Settings is the thing acting on it. Profiles stays mounted underneath, so the user can see where they came from and closing Settings returns them there.
- **"It does not follow from the finding" (author, revision 2)** - **wrong.** It followed from a requirement the author did not weigh: preserving the return path. Close-then-open resolves the z-index contest by throwing away the originating context, which trades a rendering risk for a navigation regression.
- **"Modal-over-sheet is untested" (author, revision 2)** - **wrong, and backwards.** It ships today: `CreditsModal` opens from `SettingsSheet`, `z:700` over `z:200`. The novel configuration was the author's sheet-swap.
- **`COMPENDIUM_ARCHITECTURE.md:192` prefers bottom sheets (author)** - **noted and overridden.** M3 governs behaviour and a11y; the owner's hierarchy argument is a product decision, and `ENGINEERING_CONSTITUTION.md:1` ranks an explicit human decision above local convention. The architecture doc's entry-point map is updated to match rather than cited against the decision.
- **Thumb reach for the font-scale slider (author)** - **residual, and the one thing to actually check.** `CenteredModal` is vertically centered with `maxWidth: 360`; the slider currently sits in a bottom-anchored sheet. This is a real ergonomic delta on the app's accessibility surface, it is small, and it is the only part of the author's objection that survives. Verify on device at `font_scale` max; if it reads badly, the fix is `boxStyle`, not a chassis argument.

**Adopted in full:** the Settings row at the bottom of the Profile sheet under a section label, one dismissal handler, and verification of focus trapping, Escape, scrim, close button, and Android hardware back.

## Implementation plan

Two commits, in the owner's directed order. The split is along a real seam: **commit 1 ships surfaces and navigation with no new persistence; commit 2 adds the persisted stamp and the boot gate.** Each is independently verifiable, independently revertable, and leaves the app coherent. This also resolves the bundling objection the Self-Critique has raised since revision 1 - the navigation work and the gate are now separable in fact, not just in principle.

Branch: `changelog-and-settings-home`, off `main`.

### Commit 1 - Settings modal, Credits on the wordmark, changelog reachable

Everything a user can navigate to. No Preferences key, no boot-path change.

1. `src/content/changelog.js` - the `CHANGELOG` data with the first entry.
2. `src/components/ChangelogModal.jsx` - `CenteredModal`, takes `entries` and `onClose`, renders `added`/`changed`/`fixed` by token lookup. `lazy()`-imported.
3. `SettingsSheet` → `SettingsModal`: `Sheet` → `CenteredModal`, body verbatim, `ABOUT` section and `onCredits` prop deleted.
4. `ProfileSheet` - `APP` section label plus a full-width Settings row under Export/Import. Profiles stays mounted when Settings opens.
5. Wordmark `atHome` branch → `setCreditsOpen(true)`; `aria-label` → `"Home / Credits"`; correct the stale comments at `:326-327` and `:451`.
6. `CreditsModal` - a What's New row opening `ChangelogModal` with the full `CHANGELOG` and a **non-stamping** `onClose`.
7. Docs: `COMPENDIUM_FEATURE_MATRIX.md`, `COMPENDIUM_ARCHITECTURE.md` entry-point map (`:161`, `:239`).

**Checkpoint:** `npm run build`, `npm run check:docs`, `npm run test:ui`. Manual: every dismissal route on both modals; Settings opens over Profiles and closing it reveals Profiles; hardware back from Settings lands on Profiles, not Home; wordmark still goes Home from all four non-Home pillars, a Codex detail, an active search, and add-cards mode.

### Commit 2 - the update gate

8. `src/store/changelog.js` - `getSeenBuild` / `setSeenBuild` (Preferences) and the pure `pendingEntries`.
9. `src/store/changelog.test.mjs` - the nine named cases.
10. `src/App.jsx` - boot gate after `initProfiles()`, `dismissChangelog`, and the gate's **stamping** `onClose` wired to the same `ChangelogModal` commit 1 built.
11. Docs: `COMPENDIUM_DATA_MODEL.md` §3 Preferences inventory (`:56`), `BUILD.md` release step.

**Checkpoint:** all four gates plus `test:query`, with the runner's test names and counts pasted into the report to prove discovery. Manual browser: fresh, dismiss-then-reload, hand-set catch-up, Credits-does-not-stamp. **Device pass required before this is called done** (invariant 8); APK on request only.

**Point of no return:** none. Commit 1 is pure UI and reverts cleanly; commit 2's only artifact is one inert Preferences key.

## Data migration and compatibility

**No schema migration.** `SCHEMA_VERSION` stays 9; no table, no column, no export-format change; `profileTransfer.js` untouched.

The one compatibility surface is the **absent stamp**, which is precisely the state every existing install is in on first launch of this feature. That is not an error path, it is Assumption 4's path: everyone takes the fresh-install branch once and is stamped from then on.

Corrupt or non-numeric stored values collapse to `null` (fresh install) rather than throwing, so a bad write from any future version degrades to one redundant modal.

## Rollback and recovery

**Code rollback is clean.** Revert the commit. The orphaned `changelogSeenBuild` key is inert: nothing reads it, it is a few bytes, and a future re-land reads it correctly and *benefits*, since a tester who already dismissed will not be re-shown.

**No point of no return.** No user data is written at any stage.

**Partial failure:** a Preferences read failure logs and shows nothing (boot proceeds). A write failure on dismiss means the modal returns next launch, which is visible and harmless.

**Recovery:** none needed. Nothing recoverable is at stake.

## Verification plan

### Automated

**`src/store/changelog.test.mjs`, executed by `npm run test:query`** (glob `src/store/**/*.test.mjs`, verified above). Revision 1 placed this under a glob no suite owned; the corrected location is confirmed against `package.json` and follows `src/store/matchStats.test.mjs`, an existing pure-logic test in the same directory.

Named cases, all against `pendingEntries`:

| Test name | Asserts |
|---|---|
| `fresh install returns every entry at or below current` | `seen = null` |
| `catch-up returns only unseen entries, newest first` | `seen = 35`, `current = 38` |
| `current build with no entry still returns earlier unseen entries` | `seen = 35`, `current = 37`, changelog has 36 not 37 → **returns 36**. The revision 2 rule, pinned. |
| `entries authored ahead of the shipped build are excluded` | `current = 36`, changelog has 37 → `[]` |
| `seen equal to current returns nothing` | idempotence |
| `downgrade returns nothing` | `seen = 38`, `current = 35` |
| `non-numeric current returns empty rather than throwing` | `Number('x')` |
| **`numeric comparison, not lexicographic`** | **`seen = 9`, `current = 35` returns every entry in 10..35.** Under string comparison `'9' > '35'`, so this returns `[]` and the test fails. This is the boundary guard. |
| `changelog data is well formed` | every entry has numeric unique `build`, a `version`, strictly descending order, and every `change.kind` in `added\|changed\|fixed`. Catches a bad data edit, the most likely future defect. |

**Discovery will be proven, not assumed.** The `test:query` run output (test names and counts, before and after) will be pasted into the implementation report, so "the safeguard exists" and "the safeguard runs" are separately evidenced.

**Gates:** `npm run test:codex`, `npm run test:query`, `npm run build`, `npm run check:docs`, plus `npm run test:ui` for `src/pillars/cssScope.test.mjs`.

### Manual, browser

Fresh (cleared storage) shows all; dismiss then reload shows nothing; hand-set the key below current and reload to see catch-up; Credits > What's New always shows the full list **and does not stamp**; `window.__back()` (`src/App.jsx:100`) dismisses and stamps.

**Dismissal-route matrix, one row per route, each proving it reaches `dismissChangelog`:** scrim tap, close button, Escape, Android hardware back. Plus focus trap on open and focus restoration on close.

**Profiles-to-Settings transition:** the Settings row opens the modal **over** a still-mounted Profiles sheet; closing Settings by any route (scrim, close button, Escape, hardware back) reveals Profiles rather than the app root; the LIFO back order peels Settings before Profiles; focus returns into the Profiles sheet on close; the font-scale slider is reachable and draggable at `font_scale` max (the one surviving ergonomic question from the chassis change).

### Manual, device (required, not optional)

Per invariant 8 and `CLAUDE.md`, browser success is not proof. Needs: install build N, dismiss, confirm silent on relaunch; install build N+1, confirm notes for N+1 only; confirm the stamp survives force-stop and app update; run the dismissal-route matrix on-device for hardware back. **I will not build an APK for this; request it when you want the device pass run.**

### Accessibility

Focus trap and Escape come from `CenteredModal`; verify the scroll region is reachable at `font_scale` max and that `reduced_motion` is honoured.

### Cross-cutting regression

The wordmark still goes Home from all four non-Home pillars, and from a Codex detail, an active search, and add-cards mode (each is a term in the `atHome` guard).

## Security, privacy, performance, and operations

**Security:** changelog text is bundled, authored by us, and rendered as React children (escaped). **No `dangerouslySetInnerHTML`** under any circumstance, including for a Markdown-flavoured entry later. That would reintroduce the XSS class the Phase 0 audit closed.

**Privacy:** one integer, device-local. No telemetry, no network, no PII. Nothing leaves the device.

**Performance:** one Preferences read on boot, in a chain that already awaits Preferences for `activeProfileId`. Modal is `lazy()`. Changelog data is a few KB and is imported by the gate, so it is in the boot chunk. If it grows past a few KB it should move behind the lazy boundary with only the build numbers eagerly imported (foreseeable, not yet real).

**Operations:** `BUILD.md:44-63` gains "create or update the changelog entry" beside the `build` bump. The reviewer required this and was right: bumping `build` without adding an entry is silently benign (catch-up folds it into the next release with notes), which is the correct default but means **the release ritual now has a step that fails quietly**. A written step is the only thing standing between that and a forgotten release note.

## Risks and unanswered questions

| Risk | L | I | Mitigation |
|---|---|---|---|
| **`__APP_BUILD__` is a string.** `'9' > '35'` is `true` lexicographically. A missed `Number()` yields a gate that is correct for builds 10-99 and wrong at the boundary, passing every casual test. | Med | High | `Number()` at the single call site; `pendingEntries` rejects non-finite; the `seen = 9`/`current = 35` case fails loudly on regression **and now actually runs**. |
| ~~Stacked sheets~~ | - | - | **Eliminated.** Settings is a `CenteredModal` at `z:700` over the Profiles sheet at `z:200`, which is the modal-over-sheet stack already shipping (`CreditsModal` from `SettingsSheet`). No two-sheet configuration exists. |
| **Settings slider ergonomics on the modal chassis.** Vertically centered at `maxWidth: 360` rather than bottom-anchored, on the app's accessibility surface. | Low | Low | Device check at `font_scale` max; `boxStyle` if it reads badly. |
| **Fresh-install path degrades as the changelog grows.** A 20-release history in a `maxWidth: 360` modal is a wall of text. Bounded during alpha; unbounded after. | High (later) | Low | Explicit 1.0 release-checklist item to revisit or cap, per the review. |
| **Catch-up length in a 360px modal.** Three skipped builds is a long scroll in a small box. | Med | Low | Scroll region with the sheet-body treatment; if it reads badly on device, raise `maxWidth` before reaching for a different chassis. |
| **Deep-link collision.** `compendium://deck?d=` (`src/App.jsx:101`) can land while the gate fires, stacking the changelog over an import. | Low | Low | Both are dismissible and the deep-link state persists behind. Ship as-is; fix if seen. |
| **Losing the wordmark as the Settings entry point.** Anyone with the current binding in muscle memory finds Credits instead. | Low | Low | Population is small and known. Settings becomes *more* discoverable, not less. |

**Open questions: none.** All four decisions are settled: Settings chassis (modal over the open sheet, owner), stacked sheets (do not exist under that design), fresh-install cap (full history during alpha plus an explicit 1.0 checklist item), `BUILD.md` step (yes, required).

## Self-Critique

**The strongest case that this is wrong** was that the navigation restructure did not belong here: two changes bundled because they were convenient to decide together, pushing a contained feature into a diff that touches primary navigation. **Revision 3 acts on it** - the owner's two-commit split is exactly the seam I kept naming and kept not cutting. Surfaces ship first with no persistence; the gate follows. The objection is retired by construction rather than argued away.

**The pattern I should actually worry about.** Across three revisions my errors run one direction: I defended positions by asserting risk I had not measured. Revision 1 asserted a test path without running the glob, and asserted stacked sheets needed device evidence. Revision 2 asserted modal-over-sheet was untested while `CreditsModal` was doing it in production, and priced away a navigation regression to avoid a rendering risk that did not exist. Each time the assertion favoured the design I had already written. The tell is available in advance: **I was reasoning about the codebase from memory of my own proposal instead of reading it.** Both objections would have died in thirty seconds against `grep`. That is the habit to watch in implementation, where "I know what this does" is cheapest and wrongest.

**What revision 1 got wrong, and what that implies.** Two of the four Majors were self-inflicted in a way worth naming. The eligibility rule contradicted its own test plan, and the back-stack row contradicted a mechanism I had *correctly described three paragraphs earlier* ("focus trap and `registerBackConsumer` for free") and then added anyway. Both are the same defect: a proposal long enough that its sections stopped being checked against each other. The test-glob miss is worse, because it is the one that fails silently in the direction of false confidence. **A proposal that specifies its own safeguard and puts it where nothing runs it is more dangerous than one with no safeguard**, since the verification section reads green either way. I asserted a test path without running the glob. That is the habit to correct, and it is the reason revision 2 commits to pasting the runner output rather than claiming the tests exist.

**Hidden coupling:** the wordmark's `atHome` guard is a five-term expression encoding "no transient state is on top". I am not changing it, but I am changing what it gates. If a sixth transient state is added later and someone forgets this term, the wordmark opens Credits over it. That was true before, with Settings.

**The simpler alternative I am still not proposing:** no gate at all. Put What's New in Credits, tell testers to look. Zero new persistence, zero boot-path change. It fails success criterion 1 (testers will not look), but ~80% of the value here is the *content existing and being reachable*, and the gate is the expensive 20%. If the gate proves troublesome on device, shipping the Credits half alone is a real and respectable outcome.

**The failure most likely to escape tests:** the string-versus-number build comparison, which is why it has a dedicated case that now runs in a suite that discovers it. Second: stamping on show rather than on dismiss; both look identical in a passing test and diverge only when the app is killed mid-read. Third: the Credits-opened modal stamping when it should not, which no unit test covers because it is a call-site wiring question, and which would silently suppress the next release's notes for anyone who browsed the history. **That last one is new in revision 2 and is the one I would attack next.**

**Evidence that would change my mind:**

- If `versionCode` is not monotonic across the tester distribution channel (Assumption 1), the build-comparison design collapses and this needs a monotonic counter of its own.
- If the owner intends 1.0 onboarding sooner than I assume, the alpha-welcome decision should be capped now rather than checklisted, because the checklist will not arrive in time.
- If the font-scale slider is awkward on the modal chassis at max scale, that is a real regression on an accessibility surface and wants `boxStyle` before anyone reopens the chassis question.

## Approval record

| Role | Disposition | Date |
|---|---|---|
| Author (Claude Code) | Revision 1 submitted | 2026-07-16 |
| Reviewer (Codex) | **Changes required** - 4 Major, 1 Minor | 2026-07-16 |
| Author (Claude Code) | Revision 2: all 5 accepted and verified; chassis conversion declined | 2026-07-16 |
| Approver (human) | **Approved.** Settings chassis settled in the reviewer's favour: modal over the open Profiles sheet. Delivery in two commits, navigation and surfaces first. | 2026-07-16 |
| Author (Claude Code) | Revision 3: decision recorded, author's objection withdrawn, Implementation plan added (contract gap in revisions 1-2) | 2026-07-16 |

**Scope note:** approval covers the two commits in the Implementation plan. Anything implementation reveals as wrong stops for re-approval rather than being redesigned in flight (`CLAUDE.md`, the gate).
