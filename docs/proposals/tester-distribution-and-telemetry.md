# Proposal: Ship builds to testers, collect feedback they consented to send

## Status and classification

**Superseded** by [`telemetry-consent.md`](./telemetry-consent.md). Withdrawn 2026-07-16 after
Codex review returned *Changes required* with a blocker: this proposal's own withdrawal
condition (Option D falls to Option B if in-app feedback requires a Google sign-in) was already
answered true by Firebase's documentation, which I marked as a Low-confidence device test
rather than looking up. Retained as the decision record for why in-app feedback was cut and
why telemetry was split out to land on its own.

Subsequent evidence, found while writing the successor, would have withdrawn it anyway: the
shipped merged manifest declares `AD_ID` and five other permissions, all from
`firebase-analytics`. The privacy claims below ("no PII by construction", "anonymous usage
counts") are **false** and are preserved unedited as part of the record.

Risk: **High**
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner

Classified High-risk, not Standard. Section 6 of the constitution names three qualifying
conditions and this change meets all three independently: **native plugin/build changes**
(a new Capacitor plugin, a product flavor, a new manifest permission), **new dependencies**
(the Firebase App Distribution tester SDK), and **security/privacy work** (telemetry consent
and user-authored feedback leaving the device).

## Problem and success criteria

Three problems, one seam.

1. **Distribution is tribal knowledge.** `npm run distribute` works but only if you
   remember to bump `version`, remember to write the changelog entry, remember to copy the
   APK from `android/app/build/outputs/apk/release/` into `dist-apk/`, and remember which
   env var names the testers. None of that is in `BUILD.md`; it lives in a script header
   comment. Every step is a silent failure if skipped.
2. **Feedback has no channel.** A tester who finds something wrong has to leave the app,
   remember the build number, and describe a screen from memory.
3. **Telemetry is on by accident.** `android/app/build.gradle:113-120` pulls in Analytics
   and Crashlytics, and there is no init code anywhere in `src/` or the Kotlin sources
   because both SDKs auto-initialize via content providers. The app is collecting session,
   screen-view, and crash data today with no disclosure and no way to stop it. That was
   never decided; it is what the SDKs do when you add them.

### Acceptance criteria

- A tester shakes the device, sees a screenshot and a note field, taps Send, and the report
  appears in the Firebase console attached to the exact build.
- Nothing is transmitted from the feedback flow before that tap.
- Settings has a telemetry toggle whose off state actually stops collection and survives
  relaunch, with the disclosure text beside it.
- `npm run distribute` describes what it is about to do, waits for confirmation, and refuses
  to run at all if the target build has no changelog entry.
- `build` never decreases. The APK installs over build 37 on every existing tester device.
- The tester SDK is absent from any artifact that could reach Google Play.
- Airplane mode: app boots, all pillars work, nothing blocks on a network call.

### Non-goals

- Google Play release, Play Data Safety declaration, or a published privacy policy. Alpha only.
- GDPR consent-gating. Every tester is in Australia today (confirmed by the owner). This
  proposal makes going GDPR-shaped a one-file change; it does not do it.
- Analytics event design. No custom events are added here. This change only takes control of
  what the SDK already does by default.
- iOS. No iOS target exists.
- Replacing the in-app changelog. It remains the release-notes surface for testers.

## Evidence and current architecture

| Fact | Location |
|---|---|
| Analytics + Crashlytics deps, guarded on `google-services.json` | [android/app/build.gradle:113-120](../../android/app/build.gradle#L113-L120) |
| google-services + Crashlytics plugins applied | [android/app/build.gradle:125-134](../../android/app/build.gradle#L125-L134) |
| No init code for either SDK | `grep -ril "analytics\|crashlytics" src/ android/app/src/` returns nothing |
| Firebase project `compendium-9f090`, app id `1:826456458750:android:7579b3bf31bc5508f4ecaf` | `android/app/google-services.json` (gitignored) |
| Distribution script, reads app id from google-services.json | [scripts/distribute.mjs](../../scripts/distribute.mjs) |
| `firebase-tools ^15.23.0` already a devDependency | [package.json:45](../../package.json#L45) |
| Permissions today: INTERNET, CAMERA, VIBRATE | `android/app/src/main/AndroidManifest.xml` |
| `versionCode`/`versionName` read from package.json | [android/app/build.gradle:9,26-27](../../android/app/build.gradle#L9) |
| `build` is versionCode and must never go backwards | [BUILD.md:59-63](../../BUILD.md#L59-L63) |
| Update gate rule `seen < entry.build <= current` | [src/store/changelog.js:74](../../src/store/changelog.js#L74) |
| Missing changelog entry fails quietly, by design | [BUILD.md:73-77](../../BUILD.md#L73-L77) |
| Custom Capacitor plugin precedent (Kotlin) | [android/app/src/main/java/com/sadkinglabs/compendium/scanner/CardScannerPlugin.kt](../../android/app/src/main/java/com/sadkinglabs/compendium/scanner/CardScannerPlugin.kt) |
| App-global (non-profile) state precedent and its rationale | [src/store/changelog.js:4-14](../../src/store/changelog.js#L4-L14) |
| Settings modal, per-profile toggles via `getSettings`/`setSetting` | [src/App.jsx:870-890](../../src/App.jsx#L870-L890) |
| `src/components/FeedbackHosts.jsx` is toasts/confirms, not tester feedback | [src/components/FeedbackHosts.jsx:1-4](../../src/components/FeedbackHosts.jsx#L1-L4) |

### The two consent stories are not the same story

This is the design's spine, so it is stated before the design.

**Feedback** is user-initiated, per-instance, and inspectable. The user performs a gesture,
sees the exact payload (a screenshot of the current screen plus their own words), and taps
Send. Consent is carried by the gesture. A toggle would add nothing a reasonable person
would read.

**Telemetry** is silent, continuous, and invisible. There is no gesture, so consent must be
carried by a toggle plus a disclosure, or it is not carried at all.

Treating these identically is what produced the current state, where the invisible one
shipped with the visible one's justification.

### Why "reset the build" was rejected

The owner initially asked for distribute to bump `version` and reset `build` to 1. The
intent (distribution is a version-level event) is adopted in full. The reset is not, because
it breaks three things:

1. **The APK stops installing.** Testers are on versionCode 37. Android refuses a lower
   versionCode over a higher one. Build 1 fails to install on every existing device.
2. **The update gate goes silent, permanently.** `pendingEntries` filters on
   `seen < entry.build <= current` ([src/store/changelog.js:74](../../src/store/changelog.js#L74)).
   A tester with `seen = 37` installing build 1 evaluates `1 > 37 === false`, so the entry is
   dropped. They see nothing on the release you most wanted to announce, and nothing again
   until the counter climbs back past 37. No test goes red. The symptom is silence, which is
   exactly the failure mode [BUILD.md:73-77](../../BUILD.md#L73-L77) already warns about.
3. **It stops doing its job.** BUILD.md:62 calls `build` "the number to quote in a bug
   report: it identifies the exact APK, where the version alone cannot." A resetting counter
   identifies an APK only in combination with `version`, which is the property it exists to
   avoid.

Decision (owner-approved): **`build` is monotonic forever.** `version` is what testers read;
`build` is the APK fingerprint. They are not coupled.

## Assumptions and confidence

| # | Assumption | Confidence | Validation |
|---|---|---|---|
| 1 | The App Distribution tester SDK requires the tester to sign in with the Google account their invite went to, before feedback can be sent. | **Low** | Read current Firebase docs, then confirm on a real device with a real tester account. **Blocking** — see Risks. |
| 2 | `setAnalyticsCollectionEnabled` / `setCrashlyticsCollectionEnabled` persist across process death, so the toggle need not be re-applied on every boot. | Medium | Docs, then device test: toggle off, force-stop, relaunch, confirm still off. |
| 3 | Manifest flags `firebase_analytics_collection_enabled=false` / `firebase_crashlytics_collection_enabled=false` suppress the content-provider autopilot, leaving the app as the only thing that enables collection. | Medium | Docs, then device test with the toggle off from a clean install. |
| 4 | The tester SDK's update check fails silently offline and does not block the boot path. | **Low** | Airplane-mode device test. Invariant 6 is a release condition, so this is a gate, not a nice-to-have. |
| 5 | The feedback screenshot captures the Capacitor WebView contents, not a black rectangle. WebViews are a known screenshot-capture edge case. | **Low** | Device test. If it captures black, in-app feedback loses most of its value and the decision should be revisited. |
| 6 | A product flavor can carry the tester SDK without disturbing the existing `capacitor.build.gradle` include or the Compose/Kotlin JVM-target pinning at [build.gradle:35-43](../../android/app/build.gradle#L35-L43). | Medium | Build both flavors; confirm the release flavor's APK contains no `appdistribution` classes. |
| 7 | Every tester is in Australia and stays there for the life of this alpha. | Medium (owner-stated, owner expects it to change) | Owner-confirmed. The design assumes this fails eventually, which is why the consent gate is centralized. |

Assumptions 1, 4, and 5 are Low and all three are device-verifiable in under an hour. **They
should be verified before implementation starts, not after** — 1 and 5 can each independently
sink the in-app feedback approach, in which case the rejected email-intent option becomes
correct and most of this proposal is wasted work. See Implementation plan, Increment 0.

## Affected systems and invariants

| Surface | Change |
|---|---|
| `android/app/build.gradle` | New `tester`/`play` product flavors; tester SDK dep scoped to `tester` |
| `AndroidManifest.xml` | `POST_NOTIFICATIONS`; two Firebase collection-disable meta-data flags |
| New: `TelemetryPlugin.kt` | Capacitor bridge for the consent gate, following `CardScannerPlugin.kt` |
| New: `src/telemetry.js` | The single consent gate. Named to avoid collision with the existing `FeedbackHosts.jsx` (toasts) |
| `src/App.jsx` | One new Settings row, in a new PRIVACY section |
| `src/content/` | Disclosure copy as data (invariant 7) |
| `scripts/distribute.mjs` | Interactive; version bump; changelog gate; APK copy; flavor-aware |
| `BUILD.md` | Distribution flow documented for the first time |
| `COMPENDIUM_ARCHITECTURE.md` | Telemetry consent as an app-global singleton; the flavor split |

### Invariants

**Invariant 3 (durable offline-first writes).** Holds, and improves on the status quo. The
consent stamp goes to `@capacitor/preferences` (native SharedPreferences), which
[src/store/changelog.js:4-14](../../src/store/changelog.js#L4-L14) already establishes as the
app-global singleton tier. Not `localStorage`, not React state.

**Invariant 4 (forward-only schema evolution).** **Untouched, deliberately.** Consent does not
go in the per-profile `settings` table, so there is no migration and no `SCHEMA_VERSION` bump.
The reasoning is quoted from changelog.js and applies verbatim: consent is a property of this
install on this device, not of a profile. Putting it in `settings` would buy two defects.
First, telemetry would flip on and off as you switch profiles, which is incoherent when the
Firebase installation id is per-device. Second, and worse, **a profile exported from another
device would carry that device's consent decision to this one** — a privacy bug dressed as a
data-model convenience.

**Invariant 6 (graceful degradation / zero-image / offline).** **This is the invariant most at
risk.** Three SDKs that talk to the network are being added to an app whose founding
constraint is offline-first. Mitigations: manifest flags mean collection is off until the app
turns it on; the update check must be proven non-blocking offline (assumption 4); airplane
mode is an explicit gate in the verification plan, not a spot check.

**Invariant 8 (cross-runtime integrity).** The toggle is web UI driving native SDKs. There is
no Firebase in the browser dev runtime. `src/telemetry.js` must no-op cleanly on web
(`Capacitor.isNativePlatform()` guard) so `npm run dev` neither crashes nor lies about the
toggle's effect. A browser-only success proves nothing here; every claim in this proposal
needs Android evidence.

**Invariants 1, 2, 5, 7.** Not touched. No catalog/profile boundary crossing, no profile-scoped
reads or writes, no multi-record domain operation, and the disclosure copy is data in
`src/content/` rather than a UI conditional.

## Options considered

### A. Status quo

Keep Analytics + Crashlytics on autopilot, no feedback channel, distribute by hand.
**Rejected.** The undisclosed collection is the actual problem and it does not fix itself.

### B. Email intent + Crashlytics only

A "Send feedback" row in Settings opening a `mailto:` with version, build, and device
pre-filled. No SDK, no permission, no flavor split, no offline risk.

**Rejected, but it is the strongest rejected option and it should stay on the table.** It is
one increment against roughly six. It cannot capture a screenshot, which is most of the value
when the report is "this looks wrong". The owner's judgement is that shake-to-send has enough
lower friction to change whether reports actually get sent, and friction is the binding
constraint with a handful of alpha testers.

If assumption 1 (Google sign-in required) or assumption 5 (WebView screenshots come out black)
proves true, B's disadvantages mostly evaporate and this proposal should be withdrawn in its
favour. That is why Increment 0 exists.

### C. In-app feedback, tester SDK in every build

What the owner picked, minus the flavor split.
**Rejected on the failure mode, not the effort.** It relies on remembering to strip the SDK
before the first Play release. This repository has already demonstrated, twice, that
"remember to" is not a control: `google-services.json` alone silently switched on two data
collectors, and BUILD.md documents a release-note step whose only defence is memory. Shipping
shake-to-screenshot to real users is not a mistake worth leaving to recall.

### D. In-app feedback behind a flavor split — **proposed**

C, with the tester SDK confined to a `tester` flavor. Costs one gradle concept and a
distribute script that knows which variant to build. Makes the bad outcome unreachable rather
than merely unlikely, which is §4.4 (make invalid states difficult to represent).

### E. Community Firebase Capacitor plugin (`@capacitor-firebase/*`)

**Rejected.** A large third-party dependency tree for what is two method calls behind a
bridge. `CardScannerPlugin.kt` already establishes the in-repo pattern; §4.1 and §4.2 both
point at a ~40-line plugin over a new dependency.

## Proposed design

### 1. Consent gate — one module, one owner

```
src/telemetry.js                    the ONLY caller of the bridge
  isTelemetryEnabled()  -> boolean  reads @capacitor/preferences, default true
  setTelemetryEnabled(on)           writes Preferences, then calls native
  applyTelemetryConsent()           called once on boot, after Preferences is readable

android/.../TelemetryPlugin.kt      @CapacitorPlugin(name = "Telemetry")
  setEnabled(on: Boolean)           setAnalyticsCollectionEnabled + setCrashlyticsCollectionEnabled
```

Nothing else in the codebase touches a Firebase collection flag. Going GDPR-shaped later is
then a change to one default in one file, plus a first-run prompt — not an archaeology dig.
That is the entire reason the indirection exists, and it is justified by the owner's stated
expectation that the tester base leaves Australia.

**Default.** `true` for AU-only alpha, per owner decision. The default is a named constant in
`src/telemetry.js` so the change is a one-line diff with a test.

**Manifest floor.** Both collection flags are `false` in the manifest, so the SDK autopilot is
off and `applyTelemetryConsent()` on boot is the only thing that turns collection on. Today it
enables immediately; under GDPR it would wait for a prompt. Same code either way. This also
means a boot that crashes before the gate runs collects nothing, which is the fail-safe
direction.

**Data minimisation.** No custom events, no Crashlytics custom keys, no user-authored strings,
no profile names, no deck names, no card lists. Default SDK behavior only. This is a review
checklist item (AGENTS.md §7, "could logs or errors expose profile content?"), and it is the
part that makes the jurisdiction question small in every jurisdiction at once.

### 2. Settings

A new `PRIVACY` section below `ACCESSIBILITY`, using the existing `Toggle` component from
[src/App.jsx:879-890](../../src/App.jsx#L879-L890) with its `hint` slot carrying the disclosure.

**Note a real wrinkle for the reviewer:** every existing toggle in `SettingsModal` is
per-profile (`getSettings`/`setSetting` against the `settings` table). This one is app-global.
Two rows, same sheet, different scopes, no visual difference. The mitigation is the section
header (`PRIVACY` vs `ACCESSIBILITY`) plus hint copy that says "on this device". If the
reviewer thinks that is too subtle, the alternative is a separate surface, which costs a
navigation step for one row. Flagged rather than resolved.

Disclosure copy lives in `src/content/` as data (invariant 7). Draft:

> **Anonymous usage & crash reports** — On, on this device. Sends crash reports and anonymous
> usage counts to the developer. Never your decks, collection, profile name, or anything you
> have typed. Turn this off any time; it takes effect immediately.

### 3. Feedback

Tester SDK, `tester` flavor only, shake to trigger. No toggle: consent is the Send tap.

`POST_NOTIFICATIONS` is requested contextually (not at boot) and a denial is non-fatal — it
costs the "new build available" notification, nothing else. This is the app's second runtime
permission after camera, and it is the reason the flavor split matters: the `play` flavor
must not declare it, so the manifest entry is scoped to the `tester` source set rather than
`main`.

**The screenshot carries real data.** It captures whatever is on screen: profile name,
collection, deck lists. The user sees it before sending, which is what makes it consented, but
it makes console feedback images user data. Two consequences: the disclosure copy for feedback
says so at the point of sending, and feedback images get deleted from the console once
actioned. The latter is an operational commitment with no technical enforcement, which is
noted as residual risk rather than claimed as solved.

### 4. Distribute

Interactive by default, per owner instruction: **describe what will happen before it happens.**

```
$ npm run distribute

  Compendium — distribute to testers

  Version    1.0.1-alpha  ->  1.0.2-alpha     (patch; --minor, --major, or --version=X)
  Build      37           ->  38              (monotonic; never resets)
  Notes      from changelog.js entry, build 38:
             "Shake to send feedback, and you can now turn telemetry off."
  Variant    testerRelease                    (includes the feedback SDK)
  APK        dist-apk/compendium-1.0.2-alpha.apk
  To         group:alpha-testers
  Then       git tag v1.0.2-alpha

  Proceed? [y/N]
```

Order of operations, and why:

1. **Preflight, before any mutation.** Clean git tree; changelog entry exists for the target
   build; `google-services.json` present; recipients resolvable. All checks run and report
   together, so you fix everything once rather than discovering failures one rebuild apart.
2. **The changelog gate is the point.** BUILD.md:73-77 documents that a missing note fails
   quietly and the only defence is remembering. Distribute is the exact moment to make it
   fail loudly. **Refuse to proceed**, do not warn.
3. Confirm. Nothing has changed on disk yet, so `N` is a true no-op.
4. Bump `version` and `build` in package.json. Single source; gradle and vite both follow.
5. `npm run android` then `assembleTesterRelease`.
6. Copy to `dist-apk/`. Currently manual and forgettable.
7. Ship, using **the changelog entry's own `notes` field** as `--release-notes`, so the
   release note is authored once instead of twice.
8. `git commit` the bump + `git tag`.

`--yes` skips the prompt for future CI. Not used now.

## Implementation plan

**Increment 0 — de-risk before building. Blocking.**
Verify assumptions 1, 4, and 5 on a real device with a throwaway `tester` flavor: does
feedback require Google sign-in, does the SDK block boot offline, does the WebView screenshot
come out black? **If 1 or 5 fails, stop and reopen Option B.** Roughly an hour, and it gates
everything below. No production code.

Each increment below is independently verifiable and independently revertible.

1. **Manifest floor + consent gate, no UI.** Flags to `false`; `TelemetryPlugin.kt`;
   `src/telemetry.js`; boot wiring. Verifiable: clean install collects nothing until the gate
   runs. This increment alone fixes the undisclosed-collection problem and is worth landing
   even if everything after it is abandoned.
2. **Settings row + disclosure copy.** Verifiable: toggle off, force-stop, relaunch, still off.
3. **Flavor split.** `tester` + `play`, no SDK yet. Verifiable: both build; `capacitor.build.gradle`
   and the Compose JVM-target pinning survive; `play` APK is unchanged from today's.
4. **Tester SDK + POST_NOTIFICATIONS**, scoped to the `tester` source set. Verifiable: shake
   works on `tester`; `play` APK contains no `appdistribution` classes.
5. **Distribute rewrite.** Verifiable: dry run on a scratch branch; the changelog gate
   actually refuses.
6. **Docs.** BUILD.md + architecture, per the documentation impact gate.

Checkpoint after 3 (the build-touching one) and after 5 (the mutation-heavy one), per §12.

## Data migration and compatibility

**Not applicable, deliberately, and this is a design outcome rather than an absence.**

No schema change and no `SCHEMA_VERSION` bump, because consent lives in
`@capacitor/preferences` rather than the per-profile `settings` table (see Invariant 4 above).
No export format change: `profileTransfer` is untouched, and consent is deliberately not
exportable, since carrying one device's consent decision to another device is the bug this
avoids.

**Version compatibility.** The APK installs over build 37 because `build` stays monotonic.
Existing installs keep their changelog seen-stamp and their profiles. A tester upgrading from
37 to 38 gets telemetry enabled on first boot (the default) and the changelog entry announcing
it, in the same session.

## Rollback and recovery

| Increment | Rollback | Point of no return |
|---|---|---|
| 0 | Nothing built | None |
| 1-2 | Revert; SDKs return to autopilot | None |
| 3-4 | Revert to a single variant | None |
| 5 | Revert the script | None |
| **Ship** | **None.** A distributed APK cannot be recalled. | **Step 7.** |

The real point of no return is distribution itself, and there is no technical rollback for it.
Recovery is a follow-up build with a higher `build`, which is the ordinary path and works
precisely because `build` is monotonic. The reset design would have made this recovery
impossible, since the corrective build could not have installed over the broken one.

Partial failure in distribute: preflight and confirmation both precede any disk mutation, so
an abort before step 4 leaves nothing behind. A failure between the version bump (4) and the
ship (7) leaves package.json bumped and nothing distributed. That is safe but confusing, so
the script must say so explicitly on failure and name the recovery (`git checkout package.json`,
or re-run). A bumped-but-unshipped build number is harmless: it burns an integer.

## Verification plan

**Automated.** `npm run test:query` for the consent gate default and persistence, and for
`pendingEntries` under the monotonic-build assumption (a regression test asserting the
reset scenario would have gone silent, so the reasoning is encoded rather than remembered).
Unit tests for the distribute preflight, especially that the changelog gate refuses.
`npm run test:codex`, `npm run build`, `npm run check:docs` per the standing gates.

**Native (Android), required — a browser pass proves nothing here.** Per invariant 8 and
BUILD.md, every claim below needs device evidence:

1. Clean install, toggle off from first boot: no Analytics or Crashlytics traffic.
2. Toggle off, force-stop, relaunch: still off (assumption 2).
3. Toggle on, forced crash: report arrives. Toggle off, forced crash: report does not.
4. Shake, send, confirm arrival attached to the right build.
5. Screenshot legibility: WebView content, not black (assumption 5).
6. `POST_NOTIFICATIONS` denied: feedback still sends; only the update notification is lost.
7. **Airplane mode: boot, all five pillars, no blocking, no visible error** (invariant 6 and
   assumption 4). This is a release condition.
8. Install build 38 over 37 on a device that already has 37: succeeds, and the changelog
   modal shows build 38's notes.
9. `play` flavor APK: `appdistribution` classes absent, `POST_NOTIFICATIONS` absent. Verified
   by inspecting the built artifact, not by reading the gradle file.

**Accessibility.** The new toggle needs `aria-pressed` and a real label, matching the existing
`Toggle`. Disclosure text at 200% font scale must not clip.

**Regression.** Card scanner still works (shares the Compose/CameraX/JVM-target config the
flavor split touches). Zero-image mode. Profile export/import.

## Security, privacy, performance, and operations

**Legal.** Australia only, today. The Privacy Act's APPs bind "APP entities"; ss 6C/6D carve
out small business operators (turnover ≤ $3M), so the owner is very likely outside the Act
entirely. Tranche 2 is expected to remove that exemption — the Attorney General confirmed in
February 2026 that it is "progressing" — but there is no bill and no date, and some secondary
sources wrongly claim it is already gone. Independently of the Act: Firebase's own terms
require disclosure and consent where law requires it, and Play's Data Safety declaration will
have to match actual behavior at release. **Not legal advice.** The design does not lean on
the exemption: it discloses and provides a working off switch regardless, which is what makes
the analysis boring rather than load-bearing.

**The jurisdiction assumption will fail.** The owner expects the tester base to leave
Australia. GDPR has no small-business exemption and default-on telemetry without prior consent
is not compliant. The mitigation is structural, not a promise: one gate, one default constant,
one prompt to add. Data minimisation means that even when the assumption fails, there is no
personal data in the analytics payload to argue about.

**Sensitive data.**

| Path | Carries | Consent | Control |
|---|---|---|---|
| Analytics | Session/screen counts. No PII by construction. | Toggle, default on, disclosed | Settings |
| Crashlytics | Stack traces, device model. No custom keys. | Same | Settings |
| Feedback | **Screenshot (may show profile name, decks, collection) + user's own words** | The Send tap | Not sent unless sent |

Feedback is the only path carrying real user content, and it is the only one with per-instance
informed consent. That is the right pairing. The residual exposure is the Firebase console,
where images accumulate; deletion after actioning is an operational commitment with no
technical enforcement.

**Performance.** Three SDKs on the boot path of an offline-first app. Analytics and Crashlytics
are content-provider-initialized regardless of the flags; the flags stop collection, not
loading. APK growth and cold-start cost both need measuring on the `tester` flavor, and the
`play` flavor must be unchanged from today's baseline. Measured, not asserted (§4.7, AGENTS §7).

**Operations.** `firebase login` is the owner's personal account; a service account would be
needed for CI, out of scope. App Distribution must be enabled in the console and the
`alpha-testers` group must exist — [scripts/distribute.mjs:36-40](../../scripts/distribute.mjs#L36-L40)
falls back to that group name and it is not clear it has ever been exercised. Preflight should
check it rather than discover it at upload.

## Documentation impact

| Document | Disposition |
|---|---|
| `BUILD.md` | **Updated.** Distribution is currently undocumented. Add the flow, the flavors, the changelog gate, and the monotonic-build rule restated where the reset temptation recurs. |
| `COMPENDIUM_ARCHITECTURE.md` | **Updated.** Telemetry consent as an app-global singleton alongside `activeProfileId` and the changelog stamp; the tester/play boundary; the runtime posture change from "no network at all". |
| `COMPENDIUM_FEATURE_MATRIX.md` | **Updated.** Two new capabilities: in-app feedback (tester builds) and the telemetry toggle. |
| `COMPENDIUM_DATA_MODEL.md` | **Reviewed — no change required.** Concrete reason: no table, no schema version, no export format change; consent is Preferences-tier, which this document does not own. |
| `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` | **Reviewed — no change required.** No process change proposed. |

## Risks and unanswered questions

| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | Feedback requires Google sign-in; testers won't bother; the channel is dead on arrival | Med | **High** | Increment 0. If true, withdraw for Option B. | Claude |
| 2 | WebView screenshot captures black | Med | **High** | Increment 0. If true, most of the value is gone; reopen B. | Claude |
| 3 | SDK update check blocks boot offline (invariant 6, release condition) | Low | **High** | Increment 0 + airplane-mode gate | Claude |
| 4 | Flavor split disturbs the Compose/CameraX JVM-target pinning; scanner breaks | Med | Med | Increment 3 in isolation; scanner regression test | Claude |
| 5 | Someone runs `assembleRelease` and ships the wrong variant | Med | Med | Distribute owns variant selection; `play` verified by artifact inspection | Claude |
| 6 | Console feedback images accumulate as user data | Med | Low | Delete after actioning. **No technical enforcement — accepted residual risk.** | Owner |
| 7 | Tester base leaves AU before the gate is GDPR-shaped | Med | Med | One-file change by construction; minimisation limits exposure | Owner |
| 8 | `alpha-testers` group may not exist; never exercised | Med | Low | Preflight check | Claude |

**Decisions still required from the human:**

1. **The flavor split** (Option D over C). Assumed, not confirmed — the owner did not answer
   when asked. This is the proposal's headline decision and the one most worth rejecting if
   the reasoning does not land.
2. **Two scopes in one Settings sheet** (app-global telemetry beside per-profile
   accessibility). Accepted as flagged, or split to its own surface?
3. **Disclosure copy.** Drafted above; owner's voice, owner's call.
4. **Increment 0 gating.** Confirmation that an hour of device work precedes implementation,
   and that a Low-confidence assumption failing means withdrawing rather than pressing on.

## Self-Critique

**The strongest case that this is wrong.** Compendium's founding constraint is strict
offline-first with zero external dependencies. This proposal adds a third network SDK to that
app and dresses it in enough process to feel principled. The honest read of the evidence is
worse than "we are making a tradeoff": Analytics and Crashlytics got in **by accident**, via a
gitignored JSON file, and nobody noticed until someone read the gradle file today. That is not
a tradeoff, that is erosion. A proposal that responds to erosion by adding a fourth thing and
a build flavor may be sophisticated rationalisation. The disciplined move might be to delete
Analytics entirely, keep Crashlytics, ship the email intent, and stop pretending an
offline-first alpha for a handful of friends needs a telemetry pipeline at all.

**The simpler alternative I am not taking seriously enough.** Option B is one increment. This
is six plus a device-testing session. The entire delta is a screenshot and a shake. For a
tester base small enough to fit in one group chat, "text me a screenshot" has *lower* friction
than shake-to-send, requires no SDK, no permission, no flavor, no sign-in, and no Firebase
console retention question. I rejected B on friction grounds while proposing a flow whose
first step may be a Google sign-in wall (assumption 1). If that assumption is true, **B is
strictly better and this document was a waste**. Increment 0 exists because I do not trust my
own rejection of B.

**Hidden coupling.** Three that would not show up in review of any single file. (a) The
distribute script must know the variant name; if the two drift, the wrong APK ships and the
symptom is a feedback channel that silently does nothing. (b) The changelog gate couples
distribute to `CHANGELOG`'s shape — an entry key rename breaks distribution, and nothing in
`changelog.js` hints that a build script reads it. (c) The flavor split lands on top of the
Compose/CameraX JVM-target pinning at [build.gradle:35-43](../../android/app/build.gradle#L35-L43),
whose comment already records that getting it wrong produces "Inconsistent JVM-target". The
scanner is the thing most likely to break, and it is nowhere near the surface this change is
nominally about.

**The failure most likely to escape tests.** Offline boot. Every test in this repo runs in
node or a browser; neither has Firebase, so `src/telemetry.js` no-ops in all of them and every
test stays green regardless of what the SDKs do on a real device. The airplane-mode check is
manual, which means it is the check most likely to be skipped when the change looks done. And
its failure mode is the invisible kind this codebase keeps producing: not a crash, but a
second of dead app on a tester's phone in a card shop with bad reception, reported as "feels
slow" if it is reported at all. **Zero-image and offline operation are release conditions, and
this is the change most likely to violate one without anything going red.**

**Second most likely to escape.** The default. `true` is a constant with a unit test asserting
`true`. When the tester base goes international, that test is the thing standing between the
codebase and a GDPR violation, and it will be read as "this test asserts the default" rather
than "this test asserts a jurisdictional bet". The test needs a comment saying *why* it is
true, or it is a tripwire pointed the wrong way.

**A weakness in my own framing.** I have leaned hard on "consent is in the gesture" to justify
giving feedback no toggle. It is a good argument and I believe it. But it is also *exactly*
the argument that would let the next SDK in, and I should notice that I found it persuasive
within one message of the owner proposing it. The check that keeps it honest is narrow:
nothing transmits before the tap, and the payload is fully visible at the moment of the tap.
If either stops being true — a background upload, a queued send, a preview that does not show
what is actually sent — the argument collapses and the toggle comes back. That should be a
review invariant, not a thing I remember.

**Evidence that would change the decision.**

- Feedback requires Google sign-in (assumption 1) → withdraw, take Option B.
- WebView screenshots come out black (assumption 5) → withdraw, take Option B.
- SDK blocks boot offline with no clean workaround (assumption 4) → withdraw entirely; invariant 6 is not negotiable for a feedback convenience.
- Flavor split destabilises the scanner build → reconsider C with a hard release checklist, or B.
- Owner says testers will just text him → **B, and this document should be deleted rather than filed.**

## Approval record

| Gate | Disposition | Date |
|---|---|---|
| Proposal review (Codex) | Pending | — |
| Architecture approval (human) | Pending | — |

Not to be implemented before both. Increment 0 is device verification of Low-confidence
assumptions and touches no production code; it may proceed on the owner's word alone, and its
results may withdraw this proposal before it is ever reviewed.
