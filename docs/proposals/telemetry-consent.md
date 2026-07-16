# Proposal: Take explicit control of the telemetry already collecting

## Status and classification

Draft (revision 4)
Risk: **High**
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner

High-risk: privacy work, a build change, and a native plugin change (constitution §6).
Supersedes the withdrawn [`tester-distribution-and-telemetry.md`](./tester-distribution-and-telemetry.md).

**Revision history.**

- **Rev 1** proposed deleting `firebase-analytics`. Owner-rejected: the aggregate diagnostic capability is worth keeping; Analytics reassessed before Play release.
- **Rev 2** kept both SDKs, added the manifest defence and a regression gate. Codex: *Changes required* — three blockers, all in the consent state machine.
- **Rev 3** rewrote the machine around boot reconciliation and a durable purge flag. Codex: *Changes required* — two blockers (non-atomic denial, unobservable deletion) plus the architecture fork my own Self-Critique had raised.
- **Rev 4** resolved all three as one lifecycle problem by gating Firebase initialization on consent (Fork A/Option G). **Increment 0 falsified its premise. Fork A is withdrawn — see the amendment below, which supersedes every Fork A section in this document.** There is no Rev 5 by owner instruction; this document stands amended.

---

## AMENDMENT — Increment 0 results and decision delta (2026-07-16)

**Status: Fork A (Option G) is WITHDRAWN. Approved for implementation in its simple form.**

### The measurement

Run on the owner's Pixel 9 Pro XL (Android 16), Firebase BoM 33.7.0 / Crashlytics 19.3.0.
Two virgin installs, identical device, network, and web layer; **the manifest was the only
difference.** Per-UID byte counters from `dumpsys netstats detail` (UID re-resolved after each
reinstall — it changes, and reading the stale one invalidated an earlier attempt).

| Virgin install, 3 min observation | Build 37 (as shipped) | Rig A (four flags = false) |
|---|---|---|
| **Bytes transmitted** | **13,666** | **0** |
| FirebaseApp init | yes | yes |
| Crashlytics init | yes | yes |
| Firebase Sessions | subscribed, publishing | `No Sessions subscribers` |
| Analytics | `App measurement collection enabled` | `App measurement disabled via the manifest` |
| Permissions incl. `AD_ID` | 12 | **12 — unchanged** |

The control was run first and specifically to prove the instrument could see a positive, because
an earlier negative had turned out to be an artifact of a too-short window. Rig A's zero was then
validated against a live process (pid alive, no crash, 33 lines of Capacitor/SQLite/Chromium
activity) — a crashed app also transmits zero bytes.

### What it changes

1. **Assumption 1 is FALSE.** [firebase-android-sdk#5025](https://github.com/firebase/firebase-android-sdk/issues/5025)
   does not reproduce at these versions. Firebase initializes and transmits nothing.
   **Initialization is not transmission**, and Fork A existed entirely because rev 4 assumed it was.
2. **Criterion 3 is satisfied by four manifest flags.** No `CompendiumApplication`, no
   `FirebaseInitProvider` removal, no custom init, no init gating.
3. **Option F's rejection is void.** Rev 4 rejected native reconciliation on assumption 1. With
   the premise gone, normal provider initialization plus reconciliation is sufficient.
4. **The four permission removes survive, now measured.** Rig A declares all 12 permissions
   including `AD_ID`: the flags remove nothing. The two-mechanism requirement is evidence, not inference.
5. **Blocker 1 survives, narrowed.** The flags are the *initial default*; a persisted runtime
   override beats them after the first grant. Reconciliation is still required — but only for
   granted-then-denied installs, and Crashlytics' disable is next-run either way, so the native
   enforcement point buys far less than rev 4 claimed.
6. **Blocker 2 survives.** Disabled Crashlytics still writes crashes to disk, so a grant must
   delete before enabling.
7. **The `denying` state is unnecessary** under the approved ordering: denial persists only after
   the SDK disable overrides are written, so the next process starts disabled and cleanup cannot
   race an enabled provider.

### Approved design (supersedes Proposed design §§1-5 and 7 where they conflict)

Normal Firebase initialization. Three-state native-owned consent: `unset | granted | denied`.

```
grantConsent():                      denyConsent():
  1. deleteUnsentReports()             1. disable Analytics + Crashlytics
  2. resetAnalyticsData()              2. persist consent = denied
  3. persist consent = granted         3. attempt deleteUnsentReports()
  4. enable Analytics + Crashlytics    4. resetAnalyticsData()

boot reconcile():
  granted -> enable both
  unset   -> disable both; deleteUnsentReports()
  denied  -> disable both; deleteUnsentReports()
```

Interruption safety, per Codex: persisting `granted` before enabling is safe because the next boot
sees permission to enable but collection stays off until reconciliation. In `denyConsent`, the
Settings UI must not show "off" until steps 1-2 succeed — if interrupted before `denied` is
stored, the previous `granted` remains visible, so **the attempted change failed rather than
creating a privacy lie.** Because boot deletes unsent reports for both `unset` and `denied`, and
`grantConsent` deletes again before enabling, **crashes captured while unset or denied can never
be submitted** (the owner's recorded requirement).

### Removed from implementation scope

`CompendiumApplication`, `FirebaseInitProvider` removal, `FirebaseApp.initializeApp()`, the
`denying` state, and Increment 0(b)/(c) — all moot. Assumptions 2, 3 and 6 are void with them.

### The process note worth keeping

Rev 4's own Self-Critique put it at "roughly even odds that Firebase stays quiet with the flags
off, in which case Codex's simpler Option F wins and most of this document is over-engineering
dressed as rigour." The measurement went to the doubt, not the design. **The Self-Critique was
right and the design was wrong, and only Increment 0 could tell them apart** — which is the
entire argument for gating Low-confidence premises before building on them, and the reason rev 1
was withdrawn for failing to.

---

## Problem and success criteria

**Compendium ships an advertising-ID permission set.** This is what build 37 — the APK on
testers' devices now — declares in its own merged manifest, attributed by the merger's blame
report:

| Permission | Added by | Disposition |
|---|---|---|
| `com.google.android.gms.permission.AD_ID` | `play-services-measurement-impl:22.1.2` | **Remove** |
| `android.permission.ACCESS_ADSERVICES_AD_ID` | `play-services-measurement-api:22.1.2` | **Remove** |
| `android.permission.ACCESS_ADSERVICES_ATTRIBUTION` | `play-services-measurement-api:22.1.2` | **Remove** |
| `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE` | `play-services-measurement:22.1.2` | **Remove** — unused install attribution (owner-approved) |
| `android.permission.ACCESS_NETWORK_STATE` | `play-services-measurement:22.1.2` | Keep — functional |
| `android.permission.WAKE_LOCK` | `play-services-measurement:22.1.2` | Keep — functional |

`AndroidManifest.xml` declares three permissions. The shipped APK declares twelve. All six come
from `firebase-analytics` at [android/app/build.gradle:118](../../android/app/build.gradle#L118),
because `play-services-measurement` *is* firebase-analytics. Crashlytics contributes **zero**.

Nobody decided this. It arrived via a BoM and a gitignored `google-services.json`, and there is
no init code anywhere because both SDKs auto-initialize through content providers. An
offline-first card companion currently requests permission to read a cross-app advertising
identifier.

Two problems follow: **no disclosure**, and **no control**.

### Acceptance criteria

1. The **release variant's merged manifest** contains no `AD_ID`, no `ACCESS_ADSERVICES_*`, and no install-referrer permission. Enforced on the Gradle release path. (Scope: the merged manifest is packaging's input, not the packaged APK � that is where these permissions enter, but the shipped artifact must be checked independently before a Play release.)
2. Advertising-ID *collection* is disabled at the SDK level, independently of the permission's absence.
3. **Until consent is granted, no FirebaseApp exists in the process.** No collection, no capture, no network — including Firebase Installations. Verified by observing traffic on a clean install, not inferred from flags.
4. Native SDK state matches recorded consent from process start, enforced natively, not by JavaScript.
5. Granting is reachable only from a surface displaying the disclosure text; every such surface is enumerated and tested.
6. Opting out is durable and converges without user action from an interruption at any step.
7. Crashes captured before consent are **deleted, never submitted** (owner-approved requirement).
8. The Settings control's stated semantics match measured device behavior.
9. No custom events, user IDs, user properties, Crashlytics custom keys, or logs.
10. Airplane mode: boot, five pillars, no blocking, no error.
11. Zero web-layer behavior change on `npm run dev`.

### Non-goals

- **In-app feedback, flavors, `POST_NOTIFICATIONS`, self-update.** Cut by owner decision.
- **Deleting Analytics.** Owner-rejected; see Options D. Reassessed before Play release.
- Play release, Data Safety declaration, published privacy policy.
- GDPR consent-gating. All testers in Australia (owner-confirmed). This design makes that a one-constant change.
- Custom Crashlytics breadcrumbs.
- Distribution script changes.

## Evidence and current architecture

| Fact | Location |
|---|---|
| Analytics + Crashlytics deps, guarded on `google-services.json` | [android/app/build.gradle:113-120](../../android/app/build.gradle#L113-L120) |
| No init code for either SDK | `grep -ril "analytics\|crashlytics" src/ android/app/src/` → nothing |
| Source manifest declares 3 permissions; **no `xmlns:tools`** | `android/app/src/main/AndroidManifest.xml` |
| Merged manifest declares 12; blame report attributes each | `android/app/build/outputs/logs/manifest-merger-release-report.txt` |
| Only two Activities exist | `AndroidManifest.xml` |
| **No `Application` subclass exists** — one must be created | `AndroidManifest.xml` has no `android:name` on `<application>` |
| App-module plugins are **not** auto-discovered | [MainActivity.java:11-14](../../android/app/src/main/java/com/sadkinglabs/compendium/MainActivity.java#L11-L14) |
| Custom Capacitor plugin precedent | `scanner/CardScannerPlugin.kt` |
| App-global (non-profile) state precedent and rationale | [src/store/changelog.js:4-14](../../src/store/changelog.js#L4-L14) |
| Settings modal; all current toggles are per-profile | [src/App.jsx:870-890](../../src/App.jsx#L870-L890) |
| Changelog modal + its seen-stamp — the *announcement* surface | [src/components/ChangelogModal.jsx](../../src/components/ChangelogModal.jsx), [src/store/changelog.js:74](../../src/store/changelog.js#L74) |
| `assembleRelease` is the shipping workflow; **no `build:android` npm script exists** | [BUILD.md](../../BUILD.md), [package.json](../../package.json) |
| Mechanical-gate precedent | `scripts/check-docs.mjs` |

### Verified SDK and platform semantics

| Behavior | Truth | Source |
|---|---|---|
| Android startup order | `Application.attachBaseContext()` → **`ContentProvider.onCreate()`** → `Application.onCreate()`. Providers run **before** `onCreate`. Ordering is behavioral, not contractually documented. | [Initialization order](https://rvprasad.medium.com/initialization-order-of-android-components-425db38d44cc) |
| `FirebaseInitProvider` | Initializes Firebase automatically via a content provider, before any app code except `attachBaseContext` | [FirebaseInitProvider](https://firebase.google.com/docs/reference/kotlin/com/google/firebase/provider/FirebaseInitProvider) |
| Removing it | `tools:node="remove"` on the provider, then `FirebaseApp.initializeApp(...)` manually. **Firebase documents the mechanism as a build-system escape hatch, NOT as a consent pattern** — "if you're happy with the way your Android app builds, you shouldn't need to implement any of the changes here." | [Take control of your Firebase init](https://firebase.blog/posts/2017/03/take-control-of-your-firebase-init-on/) |
| Installations network calls | **Reported** to hit `firebaseinstallations.googleapis.com` and transmit device info **despite** both collection flags being false, because the provider initializes Firebase first. **User report on an open issue; no maintainer confirmation found.** | [firebase-android-sdk#5025](https://github.com/firebase/firebase-android-sdk/issues/5025) |
| `firebase_analytics_collection_enabled=false` | Disables Analytics collection **by default** | [Analytics data collection (Android)](https://firebase.google.com/docs/analytics/android/configure-data-collection) |
| `google_analytics_adid_collection_enabled=false` | Disables **collection of the Advertising ID**. Docs **silent on the permission** | same |
| `google_analytics_default_allow_ad_personalization_signals=false` | Disables personalized advertising behavior by default | same |
| `setAnalyticsCollectionEnabled` | **Persists across executions; overrides the manifest value** | [Analytics data collection](https://firebase.google.com/docs/analytics/configure-data-collection) |
| `resetAnalyticsData()` | Clears analytics data from the device; **resets the app-instance ID** | [FirebaseAnalytics reference](https://firebase.google.com/docs/reference/android/com/google/firebase/analytics/FirebaseAnalytics) |
| `setCrashlyticsCollectionEnabled(false)` | **Does not apply until the next run.** Override **persists across launches** | [FirebaseCrashlytics reference](https://firebase.google.com/docs/reference/android/com/google/firebase/crashlytics/FirebaseCrashlytics) |
| `deleteUnsentReports()` | Deletes unsent reports; **only applies if automatic collection is disabled**. Completion **does not prove deletion** — a no-op also completes | same |
| Disabling collection | **Reports are still stored locally** and can be sent later | same |
| Analytics auto-collects | app-instance ID, **Advertising ID** (suppressed), IP-derived country/region, device model, OS, language, timezone | [Firebase data collection](https://support.google.com/firebase/answer/6318039) |
| Crashlytics auto-collects | Stack traces, application state, device metadata, Crashlytics installation UUID | [Play data disclosure](https://firebase.google.com/docs/android/play-data-disclosure) |

### Three findings, one lifecycle problem

Codex's rev-3 review named this correctly: the atomic-denial gap, the unobservable deletion, and
the enforcement point are **three faces of one problem** — the app was trying to govern an SDK
that had already started without it.

1. **The manifest value is the initial default, not a floor.** A persisted runtime override beats
   it forever after the first grant. (Rev 2's blocker.)
2. **Disabled means un-transmitted, not un-captured.** Crashlytics writes crashes to disk while
   off and uploads them when enabled. (Rev 3's blocker 2.)
3. **The SDK starts before the app does.** `FirebaseInitProvider` runs at provider-init, before
   `Application.onCreate` and long before the WebView. Any JS reconciliation is best-effort
   after the fact, and even native `onCreate` reconciliation is too late to prevent the
   Installations registration. (Rev 3's Self-Critique; Codex's architecture fork.)

**Rev 4's answer removes the premise rather than mitigating the symptoms: if consent is not
granted, Firebase is never initialized.** There is no override to fight, because there is no
FirebaseApp to hold one. There is no pre-consent crash to delete, because Crashlytics never
started to capture it. There is no reconciliation race, because there is nothing to reconcile.

### Suppressing the advertising ID takes two independent mechanisms

**Both are required: one disables SDK collection, the other removes the declared platform
capability.**

1. `google_analytics_adid_collection_enabled=false` stops the SDK **reading** the AdID.
2. `tools:node="remove"` stops the manifest **declaring** the permission. The flag does not do
   this — the docs do not claim it, and there are open reports of `AD_ID` merging in regardless.
   The declaration is what a Play reviewer and the Data Safety form see.

**Four removes, not one.** The permissions come from three artifacts. Stripping only `AD_ID`
leaves `ACCESS_ADSERVICES_AD_ID`, the Privacy Sandbox path to the same identifier.
`ACCESS_NETWORK_STATE` and `WAKE_LOCK` are functional and stay.

### The maintenance risk, and the answer to it

Four merger overrides that must survive every BoM bump is real fragility. "Remember to check the
merged manifest" is not a control — **this proposal exists because nobody read it.** Increment 5
makes it a build gate.

### App Distribution is unaffected

[scripts/distribute.mjs:33](../../scripts/distribute.mjs#L33) shells out to
`firebase appdistribution:distribute`: a console upload with **no SDK in the APK**.

## Assumptions and confidence

| # | Assumption | Confidence | Validation |
|---|---|---|---|
| 1 | **Firebase transmits to `firebaseinstallations.googleapis.com` on a clean install despite both collection flags being false.** The premise for gating init. | **Low** — one user report, no maintainer confirmation | **Increment 0.** Clean install, proxy the traffic. If FALSE, criterion 3 is achievable without gating init and the simpler native-reconcile design should be reconsidered before building this. |
| 2 | Removing `FirebaseInitProvider` + manual `FirebaseApp.initializeApp(context)` works with the google-services plugin's generated resources, and the Crashlytics gradle plugin still uploads R8 mapping. | **Low** | **Increment 0.** Both are load-bearing and neither is documented for this use. |
| 3 | Crashlytics initialized manually in `Application.onCreate` still catches crashes adequately (it misses only the provider-init→onCreate window). | Medium | Device: forced crash after manual init arrives. |
| 4 | The four removes plus the adid flag produce a release manifest with no ad permissions, and Analytics still functions. | Medium | Build and read the artifact; then the gate, permanently. |
| 5 | Removing `BIND_GET_INSTALL_REFERRER_SERVICE` does not break Analytics reporting. | Medium | Device test. One-line revert. |
| 6 | `setAnalyticsCollectionEnabled(false)` is immediate on Android. The Android page does not state timing. | Low | **Contained:** copy promises the next-run floor, true either way. Under Fork A, largely moot — a denied user has no FirebaseApp. |
| 7 | `resetAnalyticsData()` clears what matters. | High | **Moot by construction:** criterion 9 sets no user IDs or properties. |
| 8 | Testers remain in Australia for this alpha. | Medium (owner expects change) | Owner-confirmed. Design assumes it fails. |

**Assumptions 1 and 2 are Low and both gate the design.** Increment 0 resolves both before any
production code. If 1 is false, this proposal is more machinery than the problem needs and
should be revised down. If 2 is false, Fork A is not available and the fork reopens with only
the residual-accepting option left. **This is the same "verify the Low-confidence premise before
building on it" gate that rev 1 failed to apply and was withdrawn for.**

## Affected systems and invariants

| Surface | Change |
|---|---|
| `AndroidManifest.xml` | `xmlns:tools`; **`FirebaseInitProvider` removed**; 4 × permission removes; 4 × `<meta-data>` inside `<application>`; `android:name` pointing at the new Application class |
| **New `CompendiumApplication.kt`** | Reads native consent; initializes Firebase **only when granted**; runs the `denying` transition. The authority. |
| `android/app/build.gradle` | SDK deps unchanged. Adds the release-path verification task |
| New `TelemetryPlugin.kt` | Exposes native consent state to the WebView; performs transitions natively |
| `MainActivity.java` | `registerPlugin(TelemetryPlugin.class)` — app-module plugins are not auto-discovered |
| New `src/telemetry.js` | Thin client over the plugin. **Not the authority.** |
| New `src/components/TelemetryDisclosure.jsx` | The first-run disclosure |
| `src/content/` | Disclosure copy as data (invariant 7) |
| `src/content/changelog.js` | An entry **announcing** the change (announcement only — no control) |
| `src/App.jsx` | Mount the disclosure; one PRIVACY row in Settings |
| `BUILD.md`, `COMPENDIUM_ARCHITECTURE.md`, `COMPENDIUM_FEATURE_MATRIX.md` | See Documentation impact |

### Invariants

**3 (durable offline-first writes).** Holds, and the tier changes: consent now lives in a
**native SharedPreferences key written with `commit()`**, not `@capacitor/preferences`. Same
storage engine, but owned natively because the reader is `Application.onCreate`, which runs long
before any JS exists. This is consistent with [src/store/changelog.js:4-14](../../src/store/changelog.js#L4-L14)'s
reasoning about app-global singletons; it simply moves the owner to the layer that needs it first.

**4 (forward-only schema evolution).** **Untouched.** No migration, no `SCHEMA_VERSION` bump:
consent is not in the per-profile `settings` table. Changelog.js's reasoning applies verbatim —
this is a property of *this install on this device*. In `settings` it would flip telemetry as you
switch profiles, and worse, **a profile exported from another device would carry that device's
consent decision to this one**: a privacy bug wearing a data-model costume.

**6 (graceful degradation / offline).** **Materially improved.** An `unset` or `denied` install
has no FirebaseApp at all — strictly less network than today, and the closest this app has been
to its own offline-first claim since Firebase arrived. Airplane-mode boot remains a release gate.

**8 (cross-runtime integrity).** The authority is native; the WebView is a surface. On web,
`src/telemetry.js` reports a no-op state and every call is inert, so `npm run dev` neither
crashes nor lies. **Every claim needs Android evidence.** Note the new asymmetry: the privacy
boundary now exists *only* on Android, which is correct (there is no Firebase on web) but means
the browser runtime cannot exercise it at all.

**1, 2, 5, 7.** Untouched.

## Options considered

### A. Status quo
**Rejected.** It is the problem.

### B. Suppress AD_ID only, no consent surface
**Rejected.** Leaves undisclosed collection with no off switch.

### C. Delete `firebase-analytics`
Rev 1's proposal. **Owner-rejected**: the aggregate capability has no substitute here. Rev 1's
"custom breadcrumbs are strictly better" was wrong — a breadcrumb only exists attached to a
crash. Recorded as sound.

### D. Delete both SDKs
**Rejected** as C, plus: a tester's crash becomes "it closed itself" with no trace.

### E. JS boot reconciliation
Rev 3's design. **Rejected** by my own Self-Critique and Codex: the privacy posture depended on a
best-effort call in a runtime that can fail before it, and the manifest is not a backstop.

### F. Native reconciliation in `Application.onCreate`, provider retained
Codex's recommendation, and much better than E. **Rejected on assumption 1**: providers run
*before* `onCreate`, so Firebase has already initialized and (reportedly) registered an
installation before the app can intervene. Criterion 3 would have to be narrowed from "transmits
nothing" to "collects no analytics or crash data", and the owner would have to accept a fresh
install phoning home before being asked anything. **Reopens if Increment 0 shows assumption 1 is
false**, in which case F is simpler and should win.

### G. Gate initialization on consent — **proposed (owner-chosen)**
Remove `FirebaseInitProvider`; initialize Firebase natively in `Application.onCreate` **only when
consent is `granted`**. Dissolves the override problem, the pre-consent capture problem, and the
reconciliation race, by never starting the thing that causes them.

### H. `attachBaseContext` hook, provider retained
`attachBaseContext` does run before providers. **Rejected**: it would mean reaching into
Firebase's internal preference storage to pre-set an override before the SDK reads it — depending
on undocumented internals, in a hook whose ordering the sources themselves call "an undocumented
mess." G achieves the same guarantee through a documented mechanism.

### I. Community Firebase Capacitor plugin
**Rejected.** A dependency tree for a few method calls behind a bridge.

## Proposed design

### 1. Consent is one durable native value with four states

Codex's fix for the non-atomic denial: two independent keys cannot be written atomically, so the
transition must be a state, not a flag.

```
"unset"    no FirebaseApp. Show the disclosure.
"granted"  FirebaseApp initialized; both SDKs on.
"denying"  the user said no; cleanup not yet confirmed complete. No SDK enabled.
"denied"   terminal. No FirebaseApp, ever.
```

One key, `telemetry_consent`, in native SharedPreferences, written with **`commit()`** (synchronous
and durable) rather than `apply()`. Unrecognised or absent → `unset`. **Fail-safe is the off
direction, and under this design "off" means "does not exist."**

`denying` is the state rev 3 could not represent. It says *both* "the user declined" and "the
native side has not finished acting on it" in a single durable write.

### 2. `CompendiumApplication.onCreate` is the authority

```kotlin
// Runs BEFORE the Capacitor bridge, before MainActivity, before any JS.
// FirebaseInitProvider is removed from the manifest, so nothing has initialized
// Firebase before this point. That is the whole design.
override fun onCreate() {
    super.onCreate()
    when (consent()) {          // native SharedPreferences read
        GRANTED -> {
            FirebaseApp.initializeApp(this)
            setCollectionEnabled(true)          // assert; overrides persist
        }
        DENYING -> finishDenial()               // §3
        DENIED, UNSET -> {
            // Do nothing. No FirebaseApp. No Analytics, no Crashlytics,
            // no Installations, no network. Nothing to reconcile because
            // nothing was started.
        }
    }
}
```

There is no reconciliation, because there is no divergence to reconcile: nothing initializes
except by this method's decision.

### 3. `denying` → `denied`: crossing a confirmed process boundary

Codex's second blocker: `deleteUnsentReports()` completes successfully when it no-ops, so
"retry until it works" is unimplementable — the code cannot tell the first attempt failed.
The fix is to make the *state* carry the proof rather than the return value.

```
denyConsent()   — one native plugin method, so the window is adjacent instructions, not a bridge round-trip:
    prefs.edit().putString(CONSENT, "denying").commit()      // durable FIRST
    setCrashlyticsCollectionEnabled(false)                   // effective NEXT run
    setAnalyticsCollectionEnabled(false)
    // Deliberately do NOT purge here and do NOT write "denied".
    // Crashlytics is still effectively enabled this run, so a delete would
    // silently no-op and we would have no way to know.

finishDenial()  — Application.onCreate, state == "denying":
    FirebaseApp.initializeApp(this)     // inits with the persisted override = false
    if (!Crashlytics.isCrashlyticsCollectionEnabled()) {   // effectively off THIS run: proven, not assumed
        deleteUnsentReports()
        resetAnalyticsData()
        prefs.edit().putString(CONSENT, "denied").commit()  // only now
    } else {
        setCollectionEnabled(false)     // the deny's call never landed; try again
        // stay "denying"; next run crosses the boundary
    }
```

The state advances only from a run where collection was **observed** off at init, which is the
"confirmed process boundary" Codex asked for. `isCrashlyticsCollectionEnabled()` read at init
reports what Crashlytics actually started with — an observation, not an inference. Assumption 6
stops mattering: the loop converges by evidence rather than by hope.

Once `denied`, Firebase is never initialized again, so nothing can accumulate to purge.

### 4. Granting: `unset` → `granted`

Under Fork A, criterion 7 is satisfied **structurally rather than by deletion**: while `unset`,
Crashlytics never initialized, so there is no pre-consent crash on disk to submit. The owner's
requirement ("crashes captured before consent are deleted and must never be submitted") holds
because none were ever captured.

`deleteUnsentReports()` is nonetheless called on the first grant as a belt-and-braces measure,
covering the upgrade case where build 37's provider-initialized Crashlytics may have left reports
on disk. **That is the real payload of this step for existing testers.**

```
grantConsent()  — one native plugin method:
    FirebaseApp.initializeApp(context)              // first init, if not already
    setCollectionEnabled(false)                     // ensure a clean start
    deleteUnsentReports()                           // drop anything build 37 left behind
    prefs.edit().putString(CONSENT, "granted").commit()
    setCollectionEnabled(true)
```

**Ordering rule for every transition: order so an interruption leaves the more private state.**
`deny` records the decision first (an interruption leaves `denying`, which collects nothing and
retries). `grant` purges before recording (an interruption leaves `unset` — no FirebaseApp next
boot — having deleted reports it need not have; harmless).

### 5. Granting surfaces — enumerated

Rev 2 claimed granting was "unrepresentable" outside the disclosure and simultaneously specified
a Settings toggle that grants. **That claim is retracted**; the honest property is weaker:

> `grantConsent()` is the single native transition. It is reachable from exactly **two** surfaces,
> each of which displays the disclosure text: the first-run disclosure, and the labelled Settings
> control. Tests enumerate those two callers and assert no third exists.

Centralization plus a test, not a type-level guarantee.

**On the owner's question — consent from the What's New menu:** not needed, and not taken. An
upgrading tester from build 37 has no stored consent, so they are `unset`, so **the disclosure
already fires on their next launch**. The changelog needs no control to reach them. Three
surfaces, three jobs:

| Surface | Job |
|---|---|
| Changelog entry | **Announces** that the change happened |
| Disclosure modal | **Decides**, once, when `unset` |
| Settings PRIVACY row | **Holds** the permanent control and the permanent disclosure text |

A grant control inside a "here's what's new, tap OK" flow is the dark-pattern shape — the user is
in dismissal mode, not decision mode — and it would couple consent to the changelog's seen-stamp
logic ([src/store/changelog.js:74](../../src/store/changelog.js#L74)), which is subtle enough
already. The two modals collide on exactly one build, because the disclosure fires once ever.

### 6. Manifest

Rev 2's example was invalid (`<meta-data>` and `<uses-permission>` at the same level). Corrected,
and now also removing the provider:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
          xmlns:tools="http://schemas.android.com/tools">

    <application android:name=".CompendiumApplication" ... >

        <!-- Belt to the braces. The real guarantee is that FirebaseApp is never
             initialized unless consent is granted; these only shape the first init. -->
        <meta-data android:name="firebase_analytics_collection_enabled"   android:value="false" />
        <meta-data android:name="firebase_crashlytics_collection_enabled" android:value="false" />
        <meta-data android:name="google_analytics_adid_collection_enabled" android:value="false" />
        <meta-data android:name="google_analytics_default_allow_ad_personalization_signals"
                   android:value="false" />

        <!-- THE load-bearing line. Without this, Firebase initializes at provider time,
             before CompendiumApplication.onCreate, and registers an installation before
             the user has been asked anything. -->
        <provider
            android:name="com.google.firebase.provider.FirebaseInitProvider"
            android:authorities="${applicationId}.firebaseinitprovider"
            tools:node="remove" />

        <activity ... />   <!-- unchanged -->
    </application>

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <!-- From play-services-measurement* (= firebase-analytics), three artifacts, four
         entries: removing AD_ID alone leaves the Privacy Sandbox path to the same
         identifier. ACCESS_NETWORK_STATE and WAKE_LOCK are functional and stay. -->
    <uses-permission android:name="com.google.android.gms.permission.AD_ID" tools:node="remove" />
    <uses-permission android:name="android.permission.ACCESS_ADSERVICES_AD_ID" tools:node="remove" />
    <uses-permission android:name="android.permission.ACCESS_ADSERVICES_ATTRIBUTION" tools:node="remove" />
    <uses-permission android:name="com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE"
                     tools:node="remove" />
</manifest>
```

### 7. Disclosure

Shown once when consent is `unset`, after first paint, never blocking boot. Copy in
`src/content/` as data:

> **Diagnostics**
>
> Compendium can send the developer two things:
>
> - a report when it crashes: what went wrong, and what phone it happened on
> - how often the app gets opened, and from which country
>
> It never sends your decks, your collection, your profile name, or anything you have typed,
> and it does not use an advertising ID. It counts this installation separately from others,
> but it has no way to know who you are.
>
> Until you choose, none of it runs at all. You can change this any time in Settings.
>
> [ That's fine ]   [ No thanks ]

"Until you choose, none of it runs at all" is now literally true and is the one sentence Fork A
buys. No "immediately" (Crashlytics' disable is next-run). No "anonymous" (the app-instance ID and
Crashlytics installation UUID are real pseudonymous identifiers). **A privacy promise should fail
toward honesty.**

### 8. Settings

A `PRIVACY` section below `ACCESSIBILITY`, reusing the `Toggle` at
[src/App.jsx:879-890](../../src/App.jsx#L879-L890). On → `grantConsent()`, off → `denyConsent()`.
Hint text carries the disclosure summary, which is what qualifies it as an approved granting
surface (§5).

**Flagged for the reviewer:** every existing toggle in `SettingsModal` is per-profile; this one is
app-global, with no visual difference. Mitigated by the section header and "on this device" hint
copy. Flagged, not resolved.

### 9. The gate — on the release path, or it is theatre

No `build:android` script exists and `assembleRelease` is the documented workflow, so a
node-script check could be bypassed on exactly the build it protects. **Enforcement: a Gradle
verification task on the release variant, wired so `assembleRelease` cannot succeed without it.**

| Must fail when | Why |
|---|---|
| Any forbidden permission is present | The point |
| **`FirebaseInitProvider` is present** | Under Fork A this is now a privacy-critical absence, not a nicety |
| The manifest/artifact is missing | A gate that cannot find its input must not pass |
| The input is a debug or stale manifest | A false pass |
| The parser cannot determine a result | Ambiguity is failure |

The input path must come from **AGP's artifact API**, never a hardcoded `intermediates/` path: an
AGP upgrade that moves the path must break the build loudly, not silently pass. Inspecting the
final APK/AAB is stronger than the merged intermediate. Acceptance test is behavioral: **delete
one `tools:node="remove"` and `assembleRelease` must go red.**

## Implementation plan

**0. De-risk the Low-confidence premises. Blocking. No production code.** ✅ **DONE — see Amendment.**
   (a) **Ran. Assumption 1 FALSIFIED**: virgin install with the flags false transmits **0 bytes** over 3 minutes, against **13,666** for build 37. Fork A withdrawn.
   (b), (c) **Moot** — both existed only to de-risk Fork A.
   *Rev 1 was withdrawn for building on an unverified Low-confidence assumption. This is that lesson applied, and it paid for itself: the design it withdrew was the one being proposed.*

**1. Manifest: four collection/privacy flags, four permission removes, `xmlns:tools`.** No code.
   *Verify:* build; read the **release artifact**; the four are gone, `ACCESS_NETWORK_STATE`/`WAKE_LOCK` remain. **Removes the advertising ID and stops all pre-consent transmission — measured, and worth landing alone.**

**2. `TelemetryPlugin.kt` + `MainActivity` registration + native three-state consent.** No UI. Consent is `unset` for everyone → boot reconciliation disables both SDKs and deletes unsent reports, including for testers upgrading from build 37.
   *Verify:* **bridge smoke test** — `Telemetry.getConsent()` resolves, not "plugin not implemented" (that failure compiles clean). Upgrade from 37: collection stops.

**3. Disclosure + Settings + the grant path.** The first commit that can enable anything, and it necessarily contains the disclosure.
   *Verify:* the full device matrix, including interruption after every transition step.

**4. The Gradle release gate.**
   *Verify:* delete one `tools:node="remove"` → `assembleRelease` red. Rename the manifest → red, not green.

**5. Docs + changelog entry.**

Checkpoint after 1 (the manifest/privacy change) and 3 (the enable path), per §12.
**Implementation stops at the diff for final Codex review. No distribution.**

## Data migration and compatibility

**Not applicable, by design.** No schema change, no `SCHEMA_VERSION` bump: consent is a native
SharedPreferences key, not a `settings` row (Invariant 4). No export-format change;
`profileTransfer` untouched, and consent is deliberately **not** exportable.

**Upgrade behavior — this is the real migration, and it is a no-op by construction.** Installs
upgrading from build 37 have no consent key → `unset` → **`CompendiumApplication` never
initializes Firebase**. Whatever build 37 was doing stops at the process boundary, with no
override to unwind and no code to run. Existing testers are opted out by the act of upgrading and
opted back in only by choice. `grantConsent()`'s `deleteUnsentReports()` is what clears any
reports build 37 left on disk.

`build` stays monotonic (owner-approved), so the APK installs over 37 and the changelog gate at
[src/store/changelog.js:74](../../src/store/changelog.js#L74) behaves normally.

## Rollback and recovery

| Increment | Rollback | Notes |
|---|---|---|
| 1 | Revert manifest | **Privacy-negative** — AD_ID returns |
| 2 | Revert | **Privacy-negative after ship** — Firebase auto-init returns |
| 3-4 | Revert | Consent stays `unset`; Firebase never initializes; safe |
| 5 | Revert | Loses the gate, not the fix |
| Ship | Follow-up build with higher `build` | Monotonic versionCode is what makes this possible |

**Point of no return:** distribution. No technical rollback; recovery is a higher build, which
works precisely because `build` never resets.

## Verification plan

**Automated** (`npm run test:query` / JS): the disclosure renders only when consent is `unset`;
unrecognised values are treated as `unset`; **exactly two callers of `grantConsent()` exist**
(the rev-2 blocker-3 regression test); `src/telemetry.js` is inert on web. Plus `test:codex`,
`build`, `check:docs`.

**Native unit tests (new for this repo, per Codex):** the state machine in
`CompendiumApplication`/`TelemetryPlugin` — `unset`/`denied` must not initialize Firebase;
`denying` must not advance to `denied` unless collection is observed off; `denyConsent` must write
`denying` before touching the SDKs. **This is where the logic now lives, so JS tests alone would
test the wrong layer.**

**Native (Android, on device) — required. A browser pass proves nothing (invariant 8).**

1. **Proxied clean install, disclosure unanswered: zero Firebase traffic**, including Installations. Criterion 3. **The headline test.**
2. **Proxied upgrade from build 37: traffic stops.**
3. Release artifact: no `AD_ID`, no `ACCESS_ADSERVICES_*`, no install-referrer, **no `FirebaseInitProvider`**; `ACCESS_NETWORK_STATE`/`WAKE_LOCK` present.
4. Bridge smoke test: no "plugin not implemented".
5. Accept → forced crash → report arrives; sessions arrive. **Analytics works without install-referrer** (assumption 5) **and without the provider** (assumption 2).
6. Crash coverage: forced crash immediately after manual init arrives (assumption 3).
7. Decline → forced crash → force-stop → relaunch → nothing arrives.
8. **Pre-consent crash:** fresh install → crash while `unset` → relaunch → accept → **no report arrives.** (Structurally guaranteed here, but tested because the guarantee is the claim.)
9. **Upgrade + accept:** build-37 install with queued reports → upgrade → accept → **the old reports must not arrive** (this is what `grantConsent`'s delete is for).
10. **Interrupted deny:** stub the bridge to throw after the `denying` write → force-stop → relaunch → must converge to `denied` with deletion complete, no user action.
11. **Interruption after each native step** of both transitions, not just the happy path (criterion 6).
12. **`denying` with the disable never landed:** must observe collection on, decline to advance, and converge next run.
13. Toggle survives force-stop both directions.
14. **Airplane mode: boot, five pillars, no block, no error.** Release condition.
15. Install over 37 succeeds; changelog shows the announcement entry.
16. Scanner regression (shares the Kotlin/Compose config; and now an Application class exists where none did).
17. Gate proves itself: remove a `tools:node="remove"` → red; restore the provider → red.

**Accessibility:** disclosure and toggle need real labels and `aria-pressed`; copy must not clip
at 200% font scale.

## Security, privacy, performance, and operations

**What is collected**, enumerated rather than asserted:

| | When `granted` | When `unset` / `denied` |
|---|---|---|
| Analytics | app-instance ID (pseudonymous, per-install); IP-derived country/region; device model, OS, language, timezone; automatic events (`first_open`, `session_start`, `user_engagement`, `screen_view` at Activity granularity) | **Nothing. No FirebaseApp exists.** |
| Crashlytics | Stack traces; application state; device metadata; installation UUID | **Nothing. Never initialized, so nothing is captured to disk.** |
| Installations | Registers an installation | **Nothing.** |
| Never, in any state | **Advertising ID**; custom events, user IDs, user properties, custom keys, logs (criterion 9 — none exist); profile content | |

The honest claim is **"no profile content and no advertising identifier"**, not "no personal
data": the app-instance ID and Crashlytics installation UUID are pseudonymous per-install
identifiers, and under GDPR a pseudonymous ID *is* personal data. The copy reflects this.

`screen_view` resolves to `MainActivity` or `ScannerActivity` and nothing finer, because five
pillars run inside one WebView. A known, accepted limit of the capability being preserved.

**Legal (Australia).** Privacy Act APPs bind "APP entities"; ss 6C/6D exempt small business
operators (turnover ≤ $3M), so the owner is very likely outside the Act. Tranche 2 is expected to
remove that exemption — the Attorney-General confirmed in February 2026 it is "progressing" — but
there is no bill and no date, and secondary sources claiming it is already gone are wrong.
Independently: Firebase's terms require disclosure and consent where law requires it, and a
future Play Data Safety form must match actual behavior. **Not legal advice.** The design does not
lean on the exemption. Per Codex, the install-referrer rationale stays narrow: **unused install
attribution is being removed.** It does not by itself settle the Data Safety declaration, which
must still account for the app-instance ID, IP-derived location, and Crashlytics identifiers.

**The jurisdiction assumption will fail.** GDPR has no small-business exemption. Mitigation is now
structural in the strongest available sense: `unset` means Firebase does not exist, which is
already the GDPR posture. The change is the disclosure defaulting to no-choice rather than accept.

**Performance.** For `unset`/`denied` users, Firebase never loads: **faster cold start and less
memory than build 37**. For `granted` users, init moves from provider-time to
`Application.onCreate` — a few milliseconds later, at the cost of assumption 3's narrow crash
window. Measured against the build-37 baseline, not asserted (§4.7).

**Operations.** `google-services.json` stays. **The Crashlytics gradle plugin's mapping upload
must be re-verified** under manual init (assumption 2) — if it breaks, release crash reports
arrive unsymbolicated, which is a silent quality loss, not an error. **Analytics data already
collected in the console** — gathered undisclosed, including AdID-linked records — should be
deleted by the owner: a console action outside this change, and the one part of this problem code
cannot fix.

## Documentation impact

| Document | Disposition |
|---|---|
| `BUILD.md` | **Updated.** Consent states, the manual-init requirement, the release gate, and the rule that the **release artifact's** manifest is the one that ships — this proposal exists because nobody read it. |
| `COMPENDIUM_ARCHITECTURE.md` | **Updated.** Consent as a native app-global singleton; `CompendiumApplication` as the privacy boundary; runtime posture is "offline-first, with diagnostics that do not exist until invited". |
| `COMPENDIUM_FEATURE_MATRIX.md` | **Updated.** New capability: telemetry disclosure + control. |
| `COMPENDIUM_DATA_MODEL.md` | **Reviewed — no change required.** Concrete reason: no table, no schema version, no export-format change. Native-preferences tier, which this document does not own. |
| `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` | **Reviewed — no change required.** |

## Risks and unanswered questions

| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | **Assumption 1 is false** — Firebase does not phone home with flags off — so this machinery is unjustified | Med | Med | **Increment 0(a).** Revise toward Option F. | Claude |
| 2 | **Assumption 2 is false** — manual init breaks google-services or the mapping upload | Med | **High** | **Increment 0(b).** Fork reopens. | Claude |
| 3 | Manual init misses early crashes (assumption 3) | Med | Low | Accepted; the window is provider-init→onCreate | Owner |
| 4 | A BoM bump reintroduces an ad permission **or the provider** | **High** | High | The Gradle gate. This is the risk it exists for. | Claude |
| 5 | `google_analytics_adid_collection_enabled` never worked | Low | Med | **Largely mooted by Fork A**: no FirebaseApp when not granted. Residual only for granted users. | Claude |
| 6 | Removing the provider breaks another Firebase-dependent path we have not found | Low | Med | Only two SDKs are present; both are exercised in Increment 0(b) | Claude |
| 7 | Two scopes in one Settings sheet | Med | Low | Section header + "on this device" | Owner |
| 8 | Testers leave AU before the disclosure is GDPR-shaped | Med | Med | `unset` already means "does not exist" | Owner |
| 9 | "Reassess Analytics before Play" slips; the overrides become permanent | Med | Med | **No technical enforcement.** Note in BUILD.md. | Owner |
| 10 | Non-standard init rots against future Firebase versions | Med | Med | The gate catches the provider returning; it cannot catch semantic drift | Claude |

**Decisions required:** none outstanding. Prior decisions recorded: Analytics retained (rev 1);
install-referrer removed; pre-consent crashes deleted, never submitted; init gated on consent
(Fork A); no consent control in the What's New menu (§5).

## Self-Critique

**The pattern, still.** Four overclaims across four revisions, each favouring the conclusion I had
already reached: "strictly better" (rev 1, caught by the owner), "doing one is worse than doing
neither" (rev 2, caught by Codex), "unrepresentable" (rev 2, caught by Codex), and — in the
conversation that produced this revision — **"Firebase-sanctioned, not a hack"**, which I said out
loud before reading the post that says the opposite: *"if you're happy with the way your Android
app builds, you shouldn't need to implement any of the changes here."* I caught that one myself,
one message later, which is an improvement of about thirty seconds. Firebase documents this
mechanism as a build-system escape hatch. **Using it as a consent gate is a user's workaround from
an open issue, and this proposal now rests on it.** The reviewer should keep treating this
document's most quotable sentences as its least trustworthy.

**The strongest case that rev 4 is wrong.** The whole design pivots on assumption 1 — that Firebase
phones home despite the collection flags — and my evidence is **one user report on an open issue
with no maintainer confirmation.** On that basis I have proposed removing Firebase's standard
initialization path, adding an Application class the app has never had, and taking on a
non-standard init that must be re-verified against every future Firebase version (risk 10). If
Increment 0(a) shows Firebase stays quiet with the flags off, **Option F is simpler, standard, and
sufficient, and this revision is over-engineering dressed as rigour.** That is not a remote
possibility; it is roughly even odds. Increment 0 is not a formality and its result should be
allowed to embarrass this document.

**And rev 1 was withdrawn for exactly this.** It marked a Low-confidence assumption as a device
test when it was a documentation lookup, and Codex's blocker was that the withdrawal condition had
already been answered. I have now built rev 4 on two Low-confidence assumptions. The difference is
that Increment 0 blocks implementation and either can withdraw the design — but I should be honest
that "I put a gate in front of it this time" is a process improvement, not evidence that the
premise is true.

**The simpler alternative.** Owner-rejected, but still true: deleting `firebase-analytics` removes
six permissions, four overrides, the adid mechanism, risks 4, 5 and 10, the Gradle gate, and most
of this document, in one line. Everything here exists to preserve the aggregate capability. That is
a legitimate product call I am not relitigating — but the cost lands almost entirely on this
proposal's complexity, and the "reassess before Play" commitment that makes it defensible has **no
technical enforcement** (risk 9). If it slips, this machinery is permanent.

**What the design still cannot prove.** The permission removal is observable and gated forever.
"The SDK does not collect an identifier it lacks permission to read" is inferred, not measured
(risk 5) — though Fork A shrinks this to granted users only, since for everyone else there is no
SDK. And `isCrashlyticsCollectionEnabled()` is assumed to report what Crashlytics *initialized
with* rather than what was last *set*; §3's convergence proof depends on that distinction and I
have not verified it. **If it reports the setting rather than the effective state, the `denying`
loop advances on a false positive and rev 3's blocker 2 comes straight back in a new costume.**
Now Increment 0(c) — but worth noting it was missing until the Self-Critique found it, which is
the third time a load-bearing SDK semantic has turned out to be assumed rather than read.

**Hidden coupling.** (a) `grantConsent()`'s two approved callers are enforced by a test that must
be written to look for a third; a contributor adding one breaks the safety property silently. It
needs a comment at the definition. (b) `MainActivity.java` registration is invisible from the
Kotlin plugin. (c) **The provider removal is invisible from `CompendiumApplication`**: someone
reading the Application class sees `initializeApp` and reasonably assumes it is redundant with the
provider, deletes it, and silently restores auto-init for everyone. The gate catches that at
release; nothing catches it at review. This is the most likely way this design dies quietly, and
it needs a comment at both ends.

**The failure most likely to escape tests.** Airplane-mode boot, structurally: every automated JS
test runs in node or a browser, neither has Firebase. The new native unit tests help, but the
integration — Application, provider absence, real network — is manual, so it is the most likely
skipped when the diff looks finished, and its failure is invisible: a second of dead app on a
tester's phone in a card shop with bad reception, reported as "feels slow" if reported at all.

**Second most likely.** Tests 11 and 12 — interruption after each native step, and the `denying`
state where the disable never landed. They need a stubbed bridge, they are tedious, they will be
first to go under time pressure, and they are the only tests that exercise the design Codex
reasoned into existence from a crash I did not consider.

**Evidence that would change the decision.**

- **Increment 0(a): Firebase stays quiet with flags off** → Option F; withdraw most of this.
- **Increment 0(b): manual init breaks google-services or mapping upload** → Fork A unavailable; F with an accepted residual, or Option C.
- `isCrashlyticsCollectionEnabled()` reports the setting, not the effective state → §3 does not converge; redesign.
- `AD_ID` survives the removes → the removes are theatre; Option C returns.
- Owner drops "reassess before Play" → Option C's arithmetic returns; the overrides become permanent.

## Approval record

| Gate | Disposition | Date |
|---|---|---|
| Proposal review (Codex), rev 1 | **Changes required** — superseded | 2026-07-16 |
| Proposal review (Codex), rev 2 | **Changes required** — 3 blockers, 3 majors, 1 minor; all accepted | 2026-07-16 |
| Proposal review (Codex), rev 3 | **Changes required** — 2 blockers + architecture fork; all accepted | 2026-07-16 |
| Increment 0 (owner-authorised, no production code) | **Ran. Falsified assumption 1. Fork A withdrawn.** See the Amendment. | 2026-07-16 |
| Proposal review (Codex), rev 4 + Amendment | **Approved**, with implementation requirements | 2026-07-16 |
| Architecture approval (human) | **Approved.** Final design specified by the owner; no Rev 5 to be written | 2026-07-16 |
| Diff review (Codex), round 1 | **Changes required** — deletion not awaited before enabling; SDK failures swallowed before persisting; interruption tests absent; gate scope overstated. All accepted. | 2026-07-16 |
| Diff review (Codex), round 2 | **Changes required** — "completion-aware" was elapsed time, not evidence; native transitions concurrent. Both accepted. | 2026-07-16 |
| **Final diff review (Codex)** | **APPROVED** under a proportionate "good enough" standard | 2026-07-16 |
| Human approval to commit | **Approved.** Firebase console independently checked: one crash, consistent with the post-consent control. | 2026-07-16 |

### What the review rounds actually caught

Recorded because the pattern is the useful part, not the individual defects:

1. **Increment 0 falsified the design before it was built.** Fork A rested on one unverified
   user report; measurement said 0 bytes and deleted the most complex half of rev 4.
2. **Two blockers lived in paths a device could not reach.** Device probes proved the happy
   path and said nothing about failure. Only a fake SDK could reach them.
3. **The fake itself carried the bug.** Its first version modelled "deletion requested" as
   "deletion done" — the exact assumption the real SDK does not make — so the tests written
   to prove the fix could not fail on the race the fix was for, and their green ticks were
   cited as evidence. The current fake defers deletion by construction; reverting the
   machine to the old design turns **five tests red**, including the precise scenario.
4. **"Next boot" was elapsed time wearing evidence's clothes.** `granting` +
   `checkForUnsentReports()` replaced a plausible argument with an observable fact.

**Not verified, accepted as proportionate:** the `granting` retry loop on a device (needs a
process killed inside the SDK's deletion window; native fault-injection tests are the
appropriate evidence). **Inferred, not measured:** that `google_analytics_adid_collection_enabled=false`
stops the SDK reading an AdID — the permission's absence is proven and gated, the
non-collection is trusted.

**Distribution remains explicitly unapproved.** `npm run distribute` would ship the stale
versionCode-14 APK from `dist-apk/`; that bug is open and untouched by this change.

**Increment 0 did what it was built to do: it withdrew the design before the design was built.**

Owner decisions of record: Analytics retained (rev 1); install-referrer removed; **pre-consent
crashes deleted and rejected, never submitted**; `build` monotonic forever; no consent control in
the What's New menu; Fork A withdrawn on measured evidence.

**Implementation requirements (Codex, binding):** remove all Fork-A scope; implement the approved
transition ordering; test interruption after every transition step; test the four crash scenarios;
verify the final release artifact carries none of the four forbidden permissions; make
`assembleRelease` fail if one returns; run all applicable gates and installed-app verification;
**return the diff for final review before distribution. Do not distribute.**
