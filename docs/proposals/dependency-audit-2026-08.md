# Dependency and toolchain audit - 2026-08-09

**Status:** Discovery artifact, **revision 2**. Not a proposal, requests no approval, changes no code.
Revision 1 was returned by Codex as **Changes required**; the corrections are marked inline.
**Purpose:** establish, with evidence, which **direct** dependencies are behind current, what each one is
blocked by, and which can actually move. **Scope correction (Codex):** revision 1 presented itself as a
"full-tree" audit while assessing direct dependencies only. It is not full-tree. Transitive npm and Gradle
dependencies are **not** dispositioned here; §8 lists what that leaves open, and Increment B now carries a
one-off resolved-dependency and advisory review after `cap sync`.

It is the input to sequencing the Capacitor 8 work ([capacitor-8-upgrade.md](./capacitor-8-upgrade.md))
and anything after it.

## Method

Every "latest" figure below was resolved from the authoritative source on 2026-08-09, not from memory:

- npm: `npm outdated --json` against the installed tree, plus `npm view <pkg> version engines peerDependencies`.
- Maven: `maven-metadata.xml` from `dl.google.com/dl/android/maven2` and `repo1.maven.org`, filtered to
  stable (alpha/beta/rc excluded).
- Gradle: `services.gradle.org/versions/current`.
- Node: `nodejs.org/dist/index.json`.
- Capacitor's own declared baselines: extracted from the published tarballs of `@capacitor/cli` 6.2.0,
  7.4.4 and 8.5.0 (`assets/android-template.tar.gz`) and from each plugin's `android/build.gradle`.
- Android 16 behavior: `developer.android.com` behavior-changes and adaptive-apps pages.

Where a version is recommended to stay put, the **blocker is named and evidenced**. "Newer exists" is not
by itself a reason to move, and "it works today" is not by itself a reason to stay.

---

## The organising principle: four tiers by who controls the version

This is the finding that makes the rest of the audit legible. The dependencies are not one pool. They fall
into four groups with genuinely different rules, and the mistake to avoid is applying "go to latest" across
all of them.

| Tier | What it is | Rule |
|---|---|---|
| **1. Vendor-constrained** | Versions that ten **vendored Gradle modules** under `node_modules` are compiled against: the androidx set, Cordova framework, and the AGP/Gradle ceiling those modules tolerate | **Corrected (Codex):** treat Capacitor 8's template as a *starting suggestion*, then verify each artifact's own `minCompileSdk`/`minAGP` and pick the newest that fits. Deference alone produced two wrong answers (Kotlin, Lifecycle) and one unnecessary one (Cordova) |
| **2. Ours alone (native)** | Only our app module consumes them: Compose, CameraX, ML Kit, ONNX Runtime, Firebase, coroutines | Free to move to latest, constrained only by our own code and by the couplings in §4 |
| **3. Web runtime** | Ships inside the WebView: React, react-dom, sql.js, fflate, qrcode-generator | Free to move; risk is our own UI code |
| **4. Build tooling** | Never ships: Vite, plugin-react, TypeScript, sharp, firebase-tools, aws4fetch, static-copy, assets | Free to move; risk is the build and the gates |

---

## 1. Deferrals - things that will not move in this programme, with the reason

Three. **Terminology correction (Codex Major 7):** revision 1 called these "hard blockers" and said AGP 9
and TypeScript 7 were "unavailable to us". That is too strong and it matters, because overstating a
constraint turns a judgement call into a fact nobody re-examines. Both have documented escape hatches. They
are **deliberate deferrals with named triggers**, not impossibilities. Only 1.3 is a genuine
correctness-risk hold.

### 1.1 TypeScript 7 would break `check:types` today

`scripts/check-types.mjs` imports `typescript` and drives the **programmatic compiler API**
(`ts.createProgram`, diagnostics classification, the fail-closed closure check). TypeScript 7.0 is the Go
native port and **ships without a stable programmatic API**; Microsoft has said a new - and *different* -
API arrives in 7.1, and published `@typescript/typescript6` as a compatibility shim precisely because
tooling that imports the API cannot yet migrate.

**Verdict: defer; stay on TypeScript 6.0.3.** Microsoft publishes `@typescript/typescript6`, a side-by-side
compatibility package re-exporting the 6.0 API precisely so API-consuming tooling keeps working - so a TS 7
move is *possible* today by pinning our gate to that package. It is deferred because doing so buys nothing:
the gate's value is unchanged, and we would carry a compatibility shim until 7.1 arrives anyway.
**Trigger:** TypeScript 7.1 ships its API, at which point `check-types.mjs` is rewritten against it.

`check:types` is a fail-closed gate (`docs/proposals/check-types-gate.md`); silently losing it would be
worse than being a major behind.

### 1.2 AGP 9 is held by Capacitor's own vendored modules

AGP 9.3.1 is current and requires Gradle 9.5. AGP 9 removed `CommonExtension` parameterisation and enforces
strict DSL access; the legacy DSL opt-out (`android.newDsl=false`) is itself being withdrawn.

**All ten vendored Capacitor Gradle modules use the legacy DSL** - verified by grep across the published
8.x tarballs: `@capacitor/android`, `@capacitor-community/sqlite`, `@capacitor-community/keep-awake`, and
`@capacitor/{app,filesystem,haptics,keyboard,preferences,share,status-bar}` every one declares
`lintOptions`. We cannot edit them; `npm ci` and `cap sync` regenerate them.

**Verdict: defer; AGP 8.13.0 / Gradle 8.14.3, Capacitor 8's declared baseline.** AGP 9 does provide
temporary opt-outs (`android.newDsl=false` and the built-in-Kotlin escape hatches), so this is a
**deliberate deferral, not an impossibility** - revision 1 overstated it. It is deferred because those
opt-outs are themselves being withdrawn, so adopting AGP 9 by leaning on them would buy a migration we
would immediately have to redo, on ten modules we cannot edit.
**Trigger:** Capacitor ships modules on the AGP 9 DSL, or we need to target API 37 - whichever first.

### 1.3 ONNX Runtime is coupled to a prebuilt prototype index

`onnxruntime-android` is at 1.22.0; 1.28.0 exists. The device recogniser runs a DINOv2-small int8 model and
matches against a **prebuilt prototype index** shipped as `index.f16` / `index.json`.

> **Correction (Codex Major 7).** Revision 1 stated that the training venv "pins `onnx==1.22.0`". **That was
> wrong and I should not have written it.** I read `onnx 1.22.0` out of `pip list` - the *installed* state -
> and reported it as a *pin*. `scripts/recog/train/requirements.txt` pins torch, torchvision, timm, numpy,
> opencv-python-headless, pillow, open_clip_torch, ftfy and regex, and **pins neither `onnx` nor
> `onnxruntime`**. So the export toolchain is currently unpinned, which makes the model artifact less
> reproducible than the surrounding process assumes. Pinning the actual export and runtime packages is now
> a recorded follow-up in `WORK_IN_FLIGHT.md`; it does **not** require upgrading ONNX in this programme.

The runtime loader validates `index.json`'s `dim`, `count` and `sha256` - that is an **integrity check on
the index file, not a parity check on the model's outputs**. A minor change in ORT's int8 kernels could
shift embeddings slightly, degrade retrieval accuracy, and **no gate in the repository would catch it**;
the symptom would be "visual match got worse", discovered by feel.

**Verdict: keep ONNX Runtime pinned at 1.22.0 in this programme.** A bump is its own change requiring
`onnx_verify.py` parity plus a retrieval-accuracy run against the sealed set. Recorded rather than
bundled.

---

## 2. Tier 1 - selected from both sides of every compatibility pair

> **Method correction (Codex Blocker 3 / Major 6).** Revision 1 justified this table with "follow
> Capacitor 8's declared baseline". That reasoning had **already produced two wrong answers**: Kotlin
> 2.2.20 (which cannot legally sit under AGP 8.13.0) and Lifecycle 2.11.0 (which cannot build at all
> against compileSdk 36). Vendor deference is not evidence.
>
> Every AndroidX artifact publishes its own floor in
> `META-INF/com/android/build/gradle/aar-metadata.properties`. **Every row below is now checked against the
> artifact's own `minCompileSdk` and `minAndroidGradlePluginVersion`**, extracted from the AAR, and the
> Capacitor template is treated as a *starting suggestion* rather than an answer.

Our entire androidx block is still at the **Capacitor 6** template's values.

| Artifact | Ours | Cap 8 template | Maven latest | Artifact's own floor | **Take** |
|---|---|---|---|---|---|
| `com.android.tools.build:gradle` | 8.6.0 | 8.13.0 | 9.3.1 | - | **8.13.0** (§1.2) |
| Gradle wrapper | 8.7 | 8.14.3 | 9.7.0 | - | **8.14.3** (§1.2) |
| `androidx.core:core` | 1.12.0 | 1.17.0 | 1.19.0 | 1.17.0 -> sdk36/agp8.9.1; **1.19.0 -> sdk37/agp9.1.0** | **1.17.0** - 1.19.0 is genuinely unusable, not merely off-template |
| `androidx.appcompat:appcompat` | 1.6.1 | 1.7.1 | 1.7.1 | sdk34 / agp1.0.0 | **1.7.1** (already latest) |
| `androidx.activity:activity` | 1.8.0 | 1.11.0 | 1.13.0 | 1.11.0 and 1.13.0 both sdk36 / agp8.9.1 | **1.13.0** - forced by `activity-compose` 1.13.0 and verified compatible |
| `androidx.activity:activity-compose` | 1.9.0 | - | 1.13.0 | sdk36 / agp8.9.1 | **1.13.0** |
| `androidx.lifecycle:lifecycle-*-compose` | 2.8.3 | - | 2.11.0 | 2.10.0 -> sdk35/agp8.6.0; **2.11.0 -> sdk37/agp9.1.0** | **2.10.0** - 2.11.0 excluded (Codex Blocker 3) |
| `androidx.fragment:fragment` | 1.6.2 | 1.8.9 | 1.8.9 | sdk34 / agp1.0.0 | **1.8.9** (already latest) |
| `androidx.coordinatorlayout` | 1.2.0 | 1.3.0 | 1.3.0 | - | **1.3.0** (already latest) |
| `androidx.webkit:webkit` | 1.9.0 | 1.14.0 | 1.16.0 | 1.14.0 -> sdk34 / agp8.1.1 | **1.14.0**; 1.16.0 unverified, not required |
| `androidx.core:core-splashscreen` | 1.0.1 | 1.2.0 | 1.2.0 | sdk35 / agp8.6.0 | **1.2.0** (already latest) |
| `androidx.camera:*` | 1.4.1 | - | 1.6.1 | sdk36 / agp8.9.1 | **1.6.1** |
| `androidx.compose:compose-bom` | 2024.06.00 | - | 2026.06.01 | members: sdk34-35 / agp8.1.1-8.6.0 | **2026.06.01** |
| `org.apache.cordova:framework` | 10.1.1 | 14.0.1 | 15.1.0 | **14.0.x supports API 24-35; 15.0.x supports 24-36** | **15.1.0, deviating from the template** - see below |
| `androidx.test.ext:junit` | 1.1.5 | 1.3.0 | 1.3.0 | - | **1.3.0** |
| `androidx.test.espresso:espresso-core` | 3.5.1 | 3.7.0 | 3.7.0 | - | **3.7.0** |
| `com.google.gms:google-services` | 4.4.2 | 4.4.4 | 4.5.0 | - | **4.4.4**, unless the build demands 4.5.0 |
| compileSdk / targetSdk / minSdk | 35 / 35 / 29 | 36 / 36 / 24 | - | - | **36 / 36 / 29 kept** |
| Java source/target | 17 | 21 | - | - | **21** |

### Cordova: why it is here, and why the template value does not work

**Compendium uses no Cordova plugins** - `android/capacitor-cordova-android-plugins/src/main/java/` holds
only a `.gitkeep`. But the framework is not optional: `@capacitor/android`'s own runtime declares
`implementation "org.apache.cordova:framework:$cordovaAndroidVersion"`, and `cap sync` regenerates the empty
bridge module unconditionally. It ships whether we use it or not.

Codex found the consequence: **cordova-android 14.0.x supports API 24-35, and 15.0.x supports 24-36.**
Capacitor 8's template pins 14.0.1, which does not cover our target of 36. We take **15.1.0** as a
deliberate, documented deviation. The risk is small precisely because the module is empty - nothing of ours
compiles against the Cordova API, and its minSdk 24 floor is below our 29 - and it is verified at Increment
3's `assembleDebug` rather than assumed.

### Kotlin: the Capacitor baseline is not a supported pairing

**This finding reverses my initial recommendation and is the most consequential correction in the audit.**

The Kotlin Gradle plugin publishes an explicit compatibility matrix. The raw rows:

| KGP version | Gradle min-max | AGP min-max |
|---|---|---|
| 2.4.0-2.4.10 | 7.6.3-9.5.0 | **8.5.2-9.1.0** |
| 2.3.20-2.3.21 | 7.6.3-9.3.0 | 8.2.2-9.0.0 |
| 2.3.0 | 7.6.3-9.0.0 | 8.2.2-8.13.0 |
| 2.2.20-2.2.21 | 7.6.3-8.14 | **7.3.1-8.11.1** |

Capacitor 8's template pairs **AGP 8.13.0** with **Gradle 8.14.3**, and its one Kotlin-bearing module
declares **Kotlin 2.2.20**. But Kotlin 2.2.20's AGP ceiling is **8.11.1** - so *Capacitor's own declared
combination is outside Kotlin's supported window*. Following the vendor baseline for Kotlin would have
produced an unsupported toolchain, not a safe one.

**Kotlin 2.4.10 + AGP 8.13.0 + Gradle 8.14.3 is fully supported**: 8.13.0 falls inside 8.5.2-9.1.0 and
8.14.3 inside 7.6.3-9.5.0. Kotlin 2.4.10 is therefore not the adventurous choice here; it is the correct
one. (Kotlin 2.3.20-2.3.21 would also qualify; 2.4.10 is current and equally supported.)

### Kotlin 2.2.20 is Capacitor 8's declared default

You named 2.2.20 and I can now evidence it rather than take it on trust.
`@capacitor/filesystem@8.1.2/android/build.gradle:11` declares:

```gradle
ext.kotlin_version = project.hasProperty("kotlin_version") ? rootProject.ext.kotlin_version : '2.2.20'
```

That is the only Kotlin-bearing Capacitor module, and 2.2.20 is its default. **Latest stable Kotlin is
2.4.10.** Note the `project.hasProperty` guard: setting `rootProject.ext.kotlin_version` overrides it, so
2.2.20 is a default we *can* raise, not a ceiling we cannot. **This is an open question for you, §7.1** - I
am not choosing it for you.

The same file declares `kotlinxCoroutinesVersion` default **1.10.2**, while our app pins **1.8.1**. Both
land on one classpath and Gradle resolves to the highest, so **we already effectively run 1.10.2** while
the build file claims 1.8.1. That is a lie in our configuration and should be aligned explicitly whatever
else happens.

---

## 3. Tier 2 - ours alone (native)

| Artifact | Ours | Latest | Recommendation |
|---|---|---|---|
| `androidx.compose:compose-bom` | 2024.06.00 (runtime 1.6.8) | 2026.06.01 (runtime 1.11.4) | **2026.06.01.** Members require only sdk34-35 / agp8.1.1-8.6.0 - independent of Kotlin (§4.1) |
| `androidx.activity:activity-compose` | 1.9.0 | 1.13.0 | **1.13.0** (sdk36 / agp8.9.1). Pulls `activity` to 1.13.0 - declared explicitly |
| `androidx.lifecycle:lifecycle-runtime-compose` | 2.8.3 | 2.11.0 | **2.10.0, not 2.11.0.** 2.11.0 declares sdk37 / agp9.1.0 and cannot build here (Codex Blocker 3) |
| `androidx.camera:*` | 1.4.1 | 1.6.1 | **Movable.** 1.4.x carries a code comment asserting 16 KB alignment; 1.6.x must be re-verified from the assembled APK, which the upgrade already does. Low risk, real benefit |
| `com.google.mlkit:text-recognition` | 16.0.1 | **16.0.1** | **Already current.** No action |
| `com.google.mlkit:barcode-scanning` | 17.3.0 | **17.3.0** | **Already current.** No action |
| `org.jetbrains.kotlinx:kotlinx-coroutines-android` | 1.8.1 | 1.11.0 | Align to at least Capacitor's 1.10.2; 1.11.0 if we take latest Kotlin |
| `com.microsoft.onnxruntime:onnxruntime-android` | 1.22.0 | 1.28.0 | **Pinned - §1.3** |
| `com.google.firebase:firebase-bom` | 33.7.0 | 34.17.0 | **Movable, with a specific caution:** a BoM bump is exactly how `AD_ID` arrived unnoticed for 37 builds. The `checkReleaseForbiddenPermissions` gate covers it and the merged manifest is diffed |
| `com.google.firebase:firebase-crashlytics-gradle` | 3.0.2 | 3.0.7 | Movable, low risk |
| `net.zetetic:sqlcipher-android` | n/a (legacy `android-database-sqlcipher` 4.5.3) | 4.17.0 | **This is the whole point of the upgrade** |

Two genuinely good pieces of news: **ML Kit's two artifacts are already at latest**, and the scanner's two
largest risks (ONNX pinned, ML Kit current) require no movement at all.

---

## 4. Couplings - things that cannot move independently

### 4.1 Compose BOM is NOT coupled to the Kotlin version (correction)

Revision 1 asserted "whatever Kotlin version is chosen, the Compose BOM must be chosen with it". **Codex is
right that this is wrong**, and the AAR metadata confirms it: the Compose *compiler* (a Kotlin plugin) and
the Compose *libraries* are independently versioned. BOM 2026.06.01's members declare only:

| Artifact (BOM 2026.06.01) | `minCompileSdk` | `minAGP` |
|---|---|---|
| `compose.runtime:runtime-android` 1.11.4 | 34 | 8.1.1 |
| `compose.ui:ui-android` 1.11.4 | 35 | 8.6.0 |
| `compose.material3:material3-android` 1.4.0 | 35 | 8.6.0 |

All comfortably inside compileSdk 36 / AGP 8.13.0, **independent of the Kotlin version**. The only real
constraint in this direction is that the Compose compiler plugin enforces a *minimum runtime*, which 1.11.4
satisfies. So BOM 2026.06.01 is selected on its own evidence, and would have been valid under Kotlin 2.2.20
too. The by-era reasoning in revision 1 reached a defensible answer for an incorrect reason.

### 4.2 Vite ↔ plugin-react

`@vitejs/plugin-react@6` declares `peerDependencies: { vite: '^8.0.0' }`. **They move together or not at
all.** Both require Node `^20.19 || >=22.12`; local Node is 24.16.0, so the engine is satisfied.
`vite-plugin-static-copy@4` requires Node `^22 || >=24` and peers Vite `^6 || ^7 || ^8`, so it is compatible
with either side.

### 4.3 ONNX Runtime ↔ the training venv ↔ the prototype index

Covered in §1.3. The device runtime, the `onnx` package in `scripts/recog/train/.venv`, and the shipped
`index.f16` form one unit. Move all three together with parity evidence, or none.

---

## 5. Tier 3 and 4 - web runtime and build tooling

| Package | Ours | Latest | Verdict |
|---|---|---|---|
| `react` / `react-dom` | 18.3.1 | 19.2.8 | **Clear to move.** See below |
| `sql.js` | 1.11.0 | 1.14.1 | Movable, patch-level. Web-only backend; `test:query` covers it |
| `fflate`, `aws4fetch` | current | current | No action |
| `qrcode-generator` | 1.4.4 | 2.0.4 | Movable. The 2.x major is **packaging** (proper ESM `exports` + types); the classic `qrcode(0,'M')` / `addData` / `make` / `getModuleCount` / `isDark` API our one consumer uses is unchanged. One file, 20 lines |
| `vite` | 6.4.3 | 8.2.1 | Movable, **with plugin-react** (§4.2) |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.5 | Movable, **with vite** |
| `vite-plugin-static-copy` | 2.3.2 | 4.1.1 | Movable |
| `typescript` | 6.0.3 | 7.0.2 | **BLOCKED - §1.1** |
| `sharp` | 0.32.6 | 0.35.3 | Movable. Build-time only (catalog art + brand assets); needs Node >=20.9, we have 24.16.0 |
| `firebase-tools` | 15.23.0 | 15.26.0 | Movable, minor |
| `@capacitor/assets` | 3.0.5 | 3.0.5 | Already current |
| Node | 24.16.0 | 26.7.0 (LTS 24.19.0 Krypton) | **Stay on the 24 LTS line.** Capacitor 8 CLI needs >=22; nothing needs 26 |

### React 19: the codebase is already clean

I scanned for every React 19 removal and found **none of them**:

- no `defaultProps` on function components
- no `propTypes`
- no `findDOMNode`
- no string refs, no `contextTypes` / `childContextTypes`
- no `forwardRef` at all (0 occurrences), so the `forwardRef` deprecation is moot
- `src/main.jsx` already uses `createRoot` from `react-dom/client`
- the only `react-dom` import anywhere is `createPortal` (9 files), which is unchanged in 19

**React 19 is a clean upgrade for this codebase.** That is an unusually good result and it is worth taking
on its own merits, independent of anything Android.

---

## 6. Android 16 / target API 36 - verified behaviour, including portrait

Corrected from the authoritative Android documentation. Three of these change what the Capacitor proposal
should say.

### 6.1 Portrait-only is safe on phones, and has an expiry date on large screens

You have specified portrait-only, always. The precise position:

- The orientation override applies **only to displays with smallest width >= 600dp** - tablets, unfolded
  foldables, and desktop windowing. **Phones are exempt**, so `android:screenOrientation="portrait"` keeps
  working on phones indefinitely.
- On >= 600dp displays, at target 36 the system ignores `android:screenOrientation`,
  `android:resizeableActivity`, `android:minAspectRatio`, `android:maxAspectRatio`, and
  `setRequestedOrientation()`.
- There is an **explicit opt-out**, valid at target 36, declared on the `<application>` or per `<activity>`:

  ```xml
  <property android:name="android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY"
            android:value="true" />
  ```

- **The opt-out is removed at API 37.** Apps targeting 37+ cannot opt out; restrictions are always ignored
  on >= 600dp displays.

**So: declare the property app-wide, and portrait holds everywhere at target 36.** The product fact you
should have is that this is a reprieve, not a settlement - when we eventually target 37, portrait becomes
unenforceable on tablets and unfolded foldables, and only there. That is a future decision, not this
increment's, and I am flagging it rather than acting on it.

### 6.2 Edge-to-edge has no opt-out at target 36

`windowOptOutEdgeToEdgeEnforcement` is disabled and has no effect on Android 16 devices for apps targeting
36. The app is already inset-aware via `env(safe-area-inset-*)` and `--kb`, so this is a verification item,
not a redesign - but there is no escape hatch if it goes wrong, which raises the stakes on that device row.

### 6.3 Predictive back does have an opt-out

`onBackPressed()` is no longer called and `KEYCODE_BACK` is not dispatched. Both Capacitor 6 and 8 already
use `OnBackPressedDispatcher` + `OnBackPressedCallback`, which is the supported path, and androidx.activity
1.11.0 is the matching runtime. A temporary opt-out exists
(`android:enableOnBackInvokedCallback="false"`) as a bounded fallback.

### 6.4 Two more target-36 changes, assessed and dismissed

- **`elegantTextHeight` deprecated and ignored** - affects Arabic, Thai, and several Indic scripts. The app
  is Latin-only. **Not applicable.**
- **Local network permission** (`NEARBY_WIFI_DEVICES`) - enforcement from 26Q2. The app talks to a
  Cloudflare R2 CDN over the public internet, not to LAN devices. **Not applicable**, but worth
  re-checking if anything local-network ever appears.

---

## 7. Owner decisions - resolved 2026-08-09

### 7.1 Kotlin: **2.4.10**

The compatibility evidence in §2 makes this the *supported* pairing rather than merely the newer one:
Kotlin 2.2.20 cannot legally sit under AGP 8.13.0. Consequences that follow automatically:

- `compose-compiler-gradle-plugin` **2.4.10** (confirmed present on Maven Central).
- Compose BOM moves to the **2026.0x** line - **2026.06.01** (runtime 1.11.4).
- `activity-compose` **1.13.0**, `lifecycle-runtime-compose` **2.11.0**.
- `kotlinx-coroutines-android` **1.11.0** (confirmed present).
- **A Tier-1 value gets pushed by a Tier-2 choice.** `activity-compose:1.13.0` requires
  `androidx.activity:activity:1.13.0`, above Capacitor's declared 1.11.0, and Gradle resolves upward
  silently. Increment B therefore sets `androidxActivityVersion = '1.13.0'` **explicitly** - the same
  principle as the coroutines fix: the build file must not misreport what ships.

### 7.2 Scope: **fold everything into one increment**

Option (a). The web tier travels with the native tier in a single job.

Recorded honestly, since I recommended otherwise: this puts a React major, a Vite major, a Kotlin major, a
Compose major, every Capacitor package, AGP, Gradle, Java, target API 36, CameraX and Firebase into one
reviewable change. The mitigation available to me is not to narrow the scope - that is the owner's call and
it is made - but to **order the work into individually gated steps inside the one job**, so a failure is
still attributable to the step that caused it. Increment B's plan is structured that way, and the ordering
is chosen so the cheapest, most independent steps run first.

### 7.3 CameraX and Firebase BoM: **in**

CameraX 1.4.1 -> 1.6.1 and Firebase BoM 33.7.0 -> 34.17.0 join Increment B. Both already have device
verification rows - the camera path, and the merged-manifest permission diff that exists precisely because
a Firebase BoM bump once shipped `AD_ID` unnoticed for 37 builds.

---

## 8. What I did not audit

Stated so the gaps are visible rather than assumed:

- **The recogniser training venv** (`scripts/recog/train/`) is partly pinned - Python 3.12.10,
  torch 2.11.0+cu128, numpy 2.5.1, timm 1.0.28 are pinned in `requirements.txt`. **But `onnx` and
  `onnxruntime` are not pinned there at all** (§1.3), so the exported model is not reproducible from the
  recorded requirements. It never ships, but pinning the export toolchain is **owed work**, recorded in
  `WORK_IN_FLIGHT.md`, and is a prerequisite for the ONNX trigger meaning anything.
- **Transitive npm dependencies.** Direct dependencies only. `npm audit` was not run. **Increment B now
  carries a one-off resolved-dependency and advisory review after `cap sync`** (Codex Major 6), scoped to
  *recording and dispositioning* what resolution actually produced - not to discretionary upgrades.
- **Transitive Gradle dependencies** pulled by the Capacitor modules (`androidx.room` 2.6.1,
  `androidx.security:security-crypto` 1.1.0-alpha06, `androidx.biometric` 1.1.0 via
  `@capacitor-community/sqlite`). We do not control them; note that `security-crypto` is an **alpha**
  version shipping in a release build, which is the plugin author's decision, not ours.
- **The 16 KB alignment of anything except the target artifact.** That is settled by the assembled-APK
  check in the upgrade proposal, which covers every `.so` regardless of origin.

---

## 9. Summary

| Category | Count | Detail |
|---|---|---|
| Already current, no action | 6 | ML Kit text + barcode, appcompat, fragment, coordinatorlayout, core-splashscreen, `@capacitor/assets` |
| **Deferred**, with a named trigger | 3 | TypeScript 7 (API lands in 7.1; `@typescript/typescript6` shim exists), AGP 9 (vendored modules use removed DSL; temporary opt-outs exist but are being withdrawn), ONNX Runtime (model/index parity - the one genuine correctness hold) |
| Vendor-constrained, selected on each artifact's own floor | 14 | The androidx block, AGP, Gradle, SDK levels, Java. **Cordova and Lifecycle deviate from the template on evidence** (§2) |
| Ours to move freely | 10 | React 19, Vite 8 + plugin-react, static-copy, sql.js, qrcode-generator, sharp, firebase-tools, CameraX, Firebase BoM, crashlytics-gradle |
| Coupled, must move as a set | 2 pairs | Vite ↔ plugin-react; ONNX ↔ export toolchain ↔ prototype index. **Kotlin ↔ Compose BOM was wrong** and is retracted (§4.1) - they are independently versioned |
| Owner decisions, all resolved | 3 | Kotlin **2.4.10**; **one job**, web tier folded in; CameraX and Firebase BoM **in** (§7) |

The single most reassuring result: **React 19 has no blockers in this codebase**, and the two scanner
dependencies most expensive to get wrong are either already current (ML Kit) or deliberately pinned with a
stated reason (ONNX Runtime).

The single most important correction to the existing plan: **AGP 9 and TypeScript 7 are deliberately
deferred, not unavailable**, and "cutting edge" therefore means *the newest version each artifact's own
published requirements permit* - not latest everywhere, and not vendor-deference either. §2's table is now
the method: check both sides of every pair.
