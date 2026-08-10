# Proposal: Whole-app backup and restore (Increment A)

## Status and classification

**Revision 4.** Supersedes revision 3. Codex round 2 returned it as **Changes required** (hash preimage,
stale text); round 3 required a final semantic sweep of the active operational sections. Both are applied
here.
Status: **Draft, in review.** No production code changed.

### What changed from revision 3 (Codex rounds 2 and 3)

| Revision 3 | Revision 4 | Finding |
|---|---|---|
| Writer hashed the envelope before `integrity` was attached; reader stripped only `integrity.digest`, leaving `integrity.algorithm` in its preimage | **One named preimage, `unsigned`** - the envelope including `integrity.algorithm`, excluding `integrity.digest` - hashed identically by writer and reader | Round 2, Blocker 6. Every valid archive would have failed its own integrity check |
| Duplicated Stage 4 and Stage 5 | Renumbered; stages run 0-7 | Round 2, Major 8 |
| Programme intro and Stage 7 called A's APK "B's rollback binary"; risk table cited the wrong stages; open decisions still offered starter cleanup | All corrected. A supplies the **rollback source baseline**; the risk table cites Stages 0/1/4; the starter-cleanup decision is gone | Round 3, Major 10 |

### What changed from revision 2 (Codex round 1)

| Revision 2 | Revision 3 | Finding |
|---|---|---|
| Sequential reads, no protection | **`snapshot()`: a read transaction plus an exclusive write gate at the `db.js` boundary**, because the connection is shared and an unrelated write would otherwise join the snapshot's transaction | Blocker 1 |
| Per-profile transaction + in-memory compensation, accepting a permanent partial restore while claiming atomicity | **One transaction over all database restoration** (size-measured in Stage 0), with a **durable `_meta` journal + startup recovery** as the fallback. In-memory compensation removed | Blocker 2 |
| Starter profile auto-deleted under four conditions | **Removed. Nothing is ever deleted.** The condition was unreachable - `createProfile()` always writes a `settings` row - and relaxing it would delete on a heuristic | Major 1 |
| Digest over `payload` only; no size bounds | **Digest over the whole canonical envelope except `digest`**; explicit file/profile/table/row bounds checked before parse and write; exactly-one-default and active-index cardinality validated | Major 2 |
| "Back up everything", status line "last backup 2h ago" | **"Backup prepared"**, "last prepared". `saveTextFile` cannot see whether the user saved the file, so no durability is claimed | Major 3 |
| Completeness test guarded the exporter | **Schema-derived all-table sentinel round trip**, failing if *either* side omits a table or field, plus characterization tests for both historical `importProfile` bugs **written before** the extraction | Major 4 |

Risk: **High** (Constitution §6).
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner.

High-risk on three triggers: it reads and writes **persisted user data across every profile**, it introduces
an **export/import format** that outlives the code that wrote it, and it is a **destructive-adjacent**
operation (a restore writes into a live database). It is *not* high-risk for the reasons revision 1 gave -
it introduces no native plugin, no scheduler, and no new dependency.

> **Why a full rewrite.** Revision 1 (2026-07-16) was written against schema v9 and is materially stale.
> Its central motivation - that export silently loses every highlight - **no longer exists**: anchored
> highlights were removed as a feature in schema **v10** (`src/store/schema.js:341-356` drops `anchors`,
> `annotations`, and `highlights`). Two of the three "current transfer gaps" it enumerated have since been
> **closed in production**: the import boundary now refuses future-version bundles
> (`src/store/importBoundary.js:18,50`) and the destination profile is now created **inside** the import
> transaction, so a failed import leaves no orphan (`src/store/profileTransfer.js:102-120`). Revision 1 also
> asserted that no `backup_rules.xml` / `data_extraction_rules.xml` exist; **both ship today**
> (`android/app/src/main/res/xml/`). Carrying that draft forward would have designed around problems that
> are already solved and missed the ones that are not.

**This is Increment A of a two-increment programme.** Increment B is the Capacitor 6 -> 8 / Android 16
upgrade (`capacitor-8-upgrade.md`). A ships first because B's recovery story depends on it: A's merged
`main` commit is the **rollback source baseline** B rebuilds its recovery artifact from, and A's backup file
is the data safety net for B's device work. **A does not produce B's rollback binary** - that carries B's
own `versionCode` and so cannot exist until B begins.

---

## Problem and success criteria

Compendium's authoritative store is one SQLite file inside the app sandbox. Three mechanisms touch the
question "can the user get their data back", and they are routinely conflated. They are **not**
substitutes for one another:

| Mechanism | What it actually is | Status | Why it is not enough |
|---|---|---|---|
| **Android Auto Backup** | Platform-managed cloud backup and device-to-device transfer. `android:allowBackup="true"` (`AndroidManifest.xml:5`) with both rules files shipped (`res/xml/backup_rules.xml`, `res/xml/data_extraction_rules.xml`), which include the database and exclude the re-downloadable art cache. | **Live today** | Not user-invocable, not user-verifiable, silently capped (app data above the platform quota is simply not backed up), and it restores only through a specific OS flow the user may never take. We do not control it and cannot prove it worked. |
| **Per-profile transfer** | `exportProfile` / `importProfile` (`src/store/profileTransfer.js:29,74`), surfaced as Export / Import in the profile sheet (`src/App.jsx:559-560`). | **Live today, and complete at v11** | Covers **one** profile per file. Carries no app-global state, and drops `is_default`, `system`, and the profile's own timestamps. A user with three profiles must remember to run it three times, and a restore reconstructs neither which profile was default nor which was active. |
| **Whole-app backup protocol** | This proposal. | **Does not exist** | - |

There is therefore **no single artifact a user can produce that represents their whole installation**, and
no way to verify that whatever they produced is intact before they need it.

### Acceptance criteria

1. **Completeness.** One file contains every row of every profile-owned table for every profile, plus the
   app-global state that is meaningful off-device. Enforced by a **schema-derived all-table sentinel round
   trip** that fails if either export or restore omits a table or field, not by a hand-maintained list.
2. **Consistency.** The archive is produced from a **single consistent database snapshot**. No write can
   land between two of its reads, and no unrelated write can be enrolled into the snapshot's transaction.
   Proven by a concurrency regression test.
3. **Integrity.** The file carries a digest over its **whole canonical envelope except the digest field**,
   so provenance shown to the user is covered too. A truncated, edited, or corrupted file is **refused on
   read**, never partially applied.
4. **Bounded.** File size, profile count, per-table row count and total row count are checked against
   explicit ceilings **before** parsing into memory and before any write.
5. **Versioning.** The file declares a bundle format and a schema version. A file from a **newer** build is
   refused loudly; a file from an **older or equal** build restores.
6. **Atomic restore, process-death safe.** Either the whole restore is visible or none of it is, **including
   across process death**. There is no reachable state in which the app cannot tell whether a restore
   completed.
7. **Correct profile and default handling.** After a restore the database holds **exactly one** default
   profile and the restored data is reachable. **No profile is deleted by any code path in this feature.**
8. **Fresh-environment recovery is proven, not asserted.** The restore is exercised on a **disposable**
   environment that has never held this data, and the result is verified against counts recorded before
   the backup.
9. **Honest reporting.** The UI never claims durability it cannot verify. Success wording is "backup
   prepared"; a backup that could not be built or verified is reported as failed.
10. **No new runtime dependency, no network, no WASM.** Strict offline-first is preserved.
11. **Web and native both work**, or the unavailable half says so plainly rather than appearing to work.

### Non-goals (deliberately, per the owner's "leanest MVP first" directive)

Revision 1 proposed a scheduler, tiered GFS retention, an optional passphrase, a Storage Access Framework
native plugin, and pinned pre-migration snapshots. **None of that is carried forward into this increment.**
Each is a separate decision, and none of them is needed to make a user's data recoverable:

- **No scheduler / automatic backups.** Backup is a user action.
- **No retention or rotation.** The file goes wherever the user's share sheet sends it; managing versions
  is the user's filesystem's job in v1.
- **No SAF folder picker and no new native plugin.** Delivery reuses `saveTextFile`
  (`src/native.js:65-79`: Filesystem cache + Share sheet on device, blob download on web) and the existing
  file picker (`src/store/profileTransfer.js:210`).
- **No encryption.** See Security below: this is a real, named exposure that the owner is accepting for
  the MVP, not an oversight.
- **No pre-migration snapshot hook in `db.js`.** The boot path stays untouched.
- **No destructive "replace everything" restore.** See Options / R - merge plus default adoption makes a
  fresh-install restore land correctly without ever building a path that can delete live data.
- **No schema change.** `SCHEMA_VERSION` stays 11 and `MIGRATIONS` is not edited.
- **iOS.** No iOS project exists.

---

## Evidence and current architecture

### What a profile actually owns at v11

Read from `src/store/schema.js` (the executable authority). **Seventeen** profile-owned tables plus the
`profiles` row itself:

| Group | Tables |
|---|---|
| Decks | `decks`, `deck_entries`, `deck_history` |
| Codex marginalia | `saved`, `notes`, `collections`, `collection_items`, `links` |
| Collection pillar (v8) | `owned_cards`, `card_lists`, `card_list_entries` |
| Play | `matches`, `match_log_entries`, `resume` |
| Home | `dashboard_blocks`, `dashboard_layouts` |
| Preferences | `settings` |

Catalog tables (`cards`, `rules`, `faqs`, `link_graph`, `catalog_meta`) carry no `profile_id` and are
shared, read-only content. `highlights`, `annotations`, and `anchors` were **dropped in v10** and no longer
exist.

### What the live per-profile export already covers

`exportProfile` (`src/store/profileTransfer.js:29-64`) emits **all seventeen tables**. Its gaps are narrow
and specific:

| Gap | Evidence |
|---|---|
| `profiles.is_default` is not exported | `profileTransfer.js:43` emits only `{name, avatar, accent}` |
| `profiles.system`, `created_at`, `updated_at` are not exported | same line |
| No app-global state (`activeProfileId`, `changelogSeenBuild`) | grep: neither appears in the bundle |
| The per-profile dashboard-seeded flag is reconstructed heuristically, not carried | `profileTransfer.js:200-203` via `shouldMarkDashboardSeeded` |
| One profile per file | `exportProfile(profileId)` signature |

### What the import path already guarantees (and revision 1 wrongly said it did not)

| Property | Evidence | Confidence |
|---|---|---|
| **Future-version bundles are refused loudly.** `MAX_SUPPORTED_SCHEMA = 11`; a higher `schemaVersion` throws `ImportRejected`. | `src/store/importBoundary.js:18,50` | High |
| **Malformed and non-Compendium files are refused before anything is created.** All validation is in-memory against no database. | `importBoundary.js:8-12,50-56` | High |
| **Shape validation** of every iterated collection, so a non-array cannot throw part-way through. | `importBoundary.js:26-32` (`ITERATED_COLLECTIONS`) | High |
| **The profile row is created inside the same transaction as its data**, so a failure leaves no orphan. | `profileTransfer.js:102-120`, single `tx(stmts)` at `:205` | High |
| **Every id is re-keyed** through `deckMap`/`colMap`/`matchMap`/`listMap`, so two imports never collide and no id crosses a profile boundary. | `profileTransfer.js:122-127` | High |
| **Hostile input is bounded**: `safeHref` on `curiosa_url`, `sanitizeBlockConfig` on dashboard `urls`, `normalizeDurationSec` on match duration, every write parameterized. | `profileTransfer.js:17-25,131,162,170` | High |
| **Exactly one default is re-asserted every boot.** | `src/store/profileRepository.js:39-41` | High |
| **The default profile cannot be deleted**, and neither can the last profile. | `profileRepository.js:111-112` | High |

**Design consequence:** the whole-app protocol must **reuse** this machinery, not reimplement it. A second
validator or a second re-key path would drift, and the drift would only ever appear on restore - the least
exercised path in the app. This is the same argument `importBoundary.js:14-15` already makes about sharing
the pure planner with boot canonicalisation.

### App-global state that is not profile-owned

| State | Where it lives | Back it up? |
|---|---|---|
| `activeProfileId` | Capacitor Preferences (`profileRepository.js:11`) | **Yes** - carried as an index into the bundle's profile list, so it survives id re-keying |
| `changelogSeenBuild` | Capacitor Preferences (`changelog.js:26`) | **Yes**, clamped to the restoring build |
| `dash_seeded:<profileId>` | `catalog_meta` (`homeRepository.js:30-36`) - a **per-profile** flag stored in a catalog table | **Yes**, carried inside each profile unit and re-keyed. Without it a faithfully restored dashboard is repopulated with starter widgets |
| Telemetry consent | Native `SharedPreferences`, owned by `TelemetryPlugin` | **No, deliberately.** `COMPENDIUM_ARCHITECTURE.md:155` states consent is device-owned and must never travel with imported data. A restore must not import another device's consent decision |
| `_meta.schema_version`, `_meta.owned_cards_canonical_version` | `_meta` table | **No.** Derived from the code that is running; restoring them would let a bundle lie about the database it is being written into |
| Catalog tables and `catalog_meta.version` | DB, seeded from the APK | **No.** Shared read-only content, re-seeded on the restoring device |
| Card-art cache (`files/art`, `files/art-tmp`) | Filesystem | **No.** Derived, content-hashed, re-downloadable; already excluded from Auto Backup |
| Ongoing (unfinished) match snapshot | `localStorage` (`src/store/ongoingMatch.js:14`) | **No.** Invariant §3.3 states `localStorage` is not an authoritative store; a half-finished match is session state |
| Codex/Home section collapse, zero-image toggle | `localStorage` | **No.** UI-only |

---

## Assumptions and confidence

| # | Assumption | Confidence | Validation |
|---|---|---|---|
| 1 | **No `SCHEMA_VERSION` bump is needed.** Every column the protocol reads already exists; the format is read-time logic; app-global keys are Preferences, not schema. | **High** | The only fields added beyond today's export (`is_default`, `system`, timestamps, `dash_seeded`) all already exist. If a reviewer finds a needed column, the feature acquires its own migration and re-enters §12. |
| 2 | `crypto.subtle.digest('SHA-256', ...)` is available in both runtimes. | **High** (raised 2026-08-10) | Requires a secure context. `@capacitor/android` defaults `androidScheme` to **HTTPS** (`CapConfig.java:39`) and `capacitor.config.json` sets no `server.androidScheme` override, so the WebView origin is `https://localhost` - a secure context. The dev server is `http://localhost`, also potentially-trustworthy. This no longer forks the design; it is **confirmed on the first device build** (Stage 6). If it is unavailable, backup **fails loudly** rather than writing an unverifiable file (see Proposed design). |
| 3 | One `tx()` covering **all** profiles is a workable statement-set size. | **MEASURED - confirmed 2026-08-10** | The owner's real profile restores as **1,479 statements / 0.38 MiB**. Synthetic scaling puts a heavy collector at 8 MiB for one profile. Options / H (one transaction) is adopted; **Options / J is not built**. See Stage 0 result below. |
| 4 | The on-device database fits well inside the Android Auto Backup quota. | **Low** | Catalog JSON totals ~2.9 MB excluding the art manifest, so the seeded database plus user data is plausibly under the platform's 25 MB app-data cap - but this is inference from source sizes, not a measurement. **Measured on the emulator in the verification plan and reported, not acted on.** Auto Backup is not the mechanism this proposal relies on either way. |
| 5 | A debug build on an emulator is a valid disposable environment for restore. | **High** | Restore is JavaScript and identical in both build types. The release ABI filter is scoped to `buildTypes.release` (`android/app/build.gradle:88`), so **debug keeps all four ABIs** and an x86_64 emulator runs it. This is exactly why that scoping decision was made. |

---

## Affected systems and invariants

| Surface | Change |
|---|---|
| **New `src/store/backup.js`** | Pure: build the payload, canonical JSON, whole-envelope digest, parse, bounds, cardinality validation. No DOM, no Capacitor - fully covered by `test:query` |
| `src/store/db.js` | **New `snapshot(fn)`** - a read transaction plus an exclusive write gate honoured by `run`, `tx` and `exec`. The narrowest place to make the archive consistent, because it is already the single choke point for every write (Blocker 1) |
| `src/store/profileTransfer.js` | `exportProfile` gains the missing profile columns and the `dash_seeded` flag; a new `buildProfileUnit` / `restoreProfileUnit` pair extracted from the existing export/import bodies so **one** implementation serves both the per-profile and whole-app paths |
| `src/store/importBoundary.js` | `validateBundle` extended to understand a `bundleFormat` envelope; the existing future-version and shape rules reused unchanged |
| `src/store/profileRepository.js` | A narrow `adoptDefaultProfile` used by the post-restore default step. **No deletion helper is added** (Major 1) |
| `src/App.jsx` | A Backup section in `SettingsModal` (`App.jsx:604`): "Back up everything", "Restore from backup", a restore preview, and an honest status line |
| `src/native.js` | None expected - `saveTextFile` already does device and web delivery. Its inability to observe the destination is handled by wording, not by changing it (Major 3) |
| `src/store/schema.js` | **Untouched** |
| Docs | See Documentation impact |

### Invariants (Constitution §3)

**1 - Catalog/profile boundary. HOLDS.** The bundle carries profile-owned rows and catalog **references**
(`card_id`, `target_id`, `rule_id`), never catalog content - the shape `exportProfile` already emits. The
one subtlety is `dash_seeded:<pid>`, which is a profile-owned fact that happens to be *stored* in
`catalog_meta`; it is carried as part of the profile unit and re-keyed, never as a catalog row.
*Verified by:* a test asserting no `cards` / `rules` / `faqs` / `link_graph` row and no non-`dash_seeded`
`catalog_meta` key ever appears in a bundle.

**2 - Profile isolation. HOLDS.** Each profile unit is self-contained and every id is re-keyed on restore
through the existing maps. No id crosses a profile boundary because each unit is restored under a freshly
generated `profile_id`.
*Verified by:* a multi-profile round-trip asserting that no row of profile A resolves under profile B.

**3 - Durable, offline-first writes. HOLDS AND IS STRENGTHENED.** The backup file is a **derived artifact,
never an authoritative store**. Nothing about normal operation changes; the only write path added is
restore, which goes through `tx()`. No network is involved at any point.
*Verified by:* an airplane-mode backup and restore.

**4 - Forward-only schema evolution. HOLDS AND IS STRENGTHENED.** No migration is added. The protocol
extends the **existing** future-version refusal (`importBoundary.js:18`) to the whole-app envelope, which is
the backstop `COMPENDIUM_DATA_MODEL.md` names as missing.
*Verified by:* a bundle stamped `schemaVersion: 12` must be refused, and a `bundleFormat: 3` bundle must be
refused, both without writing anything.

**5 - Transactional user-data operations. HOLDS.** Per-profile atomicity is inherited from
`importProfile`'s single `tx()`, now widened to cover every profile in one transaction (Options / H), and
the post-restore default/cleanup step is its own transaction.
*Verified by:* an injected failure at profile 2 of 3, after which the database contains none of the three.

**6 - Graceful asset degradation. HOLDS TRIVIALLY.** A bundle contains no images: avatars are preset refs
(`schema.js:61`) and card art is a CDN-backed cache. A restored reference to a card the device's catalog
lacks degrades to the existing unresolved-placeholder behavior (`schema.js:85`).
*Verified by:* restore with images disabled.

**7 - Content is data. HOLDS.** The exporter is driven by a table list derived from the schema rather than
scattered per-pillar logic.

**8 - Cross-runtime integrity. HOLDS, with the usual caveat.** The format and all validation are pure and
identical in both runtimes; only delivery differs (`saveTextFile` already branches). The checksum
availability question (Assumption 2) is genuinely runtime-specific and gets device evidence.

---

## Options considered

### Format
- **A. Raw `.db` file copy.** Rejected for the MVP. It cannot be produced from JavaScript, needs a native
  plugin, is not portable across schema versions, and on a release build cannot even be read off the device
  (`run-as` requires a debuggable build). Revision 1 flagged its consistency under WAL as an open question
  and never resolved it.
- **B (chosen). One JSON document, logical rows, versioned envelope.** Portable, diffable, verifiable in
  pure JavaScript, restorable through the machinery already hardened for imports, and testable without a
  device.

### Delivery
- **C. New SAF native plugin with a persisted folder.** Rejected for the MVP (owner directive: leanest
  first). It is the largest and riskiest part of revision 1 and it buys *convenience*, not *recoverability*.
- **D (chosen). Reuse `saveTextFile` (Filesystem cache + Share sheet on device, blob download on web) and
  the existing file-picker import.** Zero new native code, and the user chooses the destination - including
  a Drive or Nextcloud folder, which keeps the app itself entirely network-free.

### Integrity
- **E. Row counts only.** Rejected: catches truncation, misses corruption within a row.
- **F (chosen). SHA-256 over one explicitly named canonical preimage,** recomputed and compared on read.
  Canonicalisation (stable key order) is a pure function with its own tests. The preimage is
  `unsigned` - **the whole envelope including `integrity.algorithm`, excluding only `integrity.digest`** -
  so `exportedAt` and `appBuild` are covered, and writer and reader hash byte-identical documents.
- **G. Add a hash library.** Rejected: no new dependency. If Web Crypto is unavailable (Assumption 2),
  backup fails loudly - writing an unverifiable file would defeat criterion 3.

### Restore semantics
- **R1. Destructive "replace everything".** **Rejected for the MVP.** It is the only operation in the whole
  design that can destroy live data, and it exists to serve one case - restoring onto a device that already
  has data you want gone. That case can wait for its own proposal with its own forced pre-restore backup.
- **R2. Merge only (status quo semantics).** Insufficient alone: on a fresh install, merging leaves the
  auto-created starter profile (`profileRepository.js:27-33`) alongside the restored ones, holding
  `is_default=1` - and `deleteProfile` **refuses to delete the default** (`profileRepository.js:112`). The
  user ends a "full restore" with an empty profile they cannot remove. This is the concrete defect
  revision 1 missed.
- **R3. Merge, plus default adoption, plus a strictly-conditioned starter cleanup.** **Withdrawn - it was
  dead code and Codex was right to kill it.** The cleanup fired only if the starter profile was "empty
  across all seventeen tables", but `createProfile()` unconditionally writes a `settings` row
  (`profileRepository.js:73-74`), so the condition **can never be true**. The promised cleanup would never
  have run; and the obvious repair - relaxing the condition - would mean deleting a profile on a heuristic
  guess that the user had not customised it. Neither outcome is acceptable, and no provenance machinery is
  worth adding for a cosmetic tidy.
- **R4 (chosen). Merge, plus default adoption. No automatic deletion of anything, ever.** After a successful
  restore, one transaction moves `is_default` to the restored profile that carried it. The pre-existing
  starter thereby becomes **non-default**, and `deleteProfile` already permits deleting a non-default
  profile when others exist (`profileRepository.js:111-112`) - so the user can remove it in two taps if they
  want to, and keep it if they do not. **The design now contains no code path that deletes a profile.**
  Restore is purely additive plus one flag move.

### Multi-profile atomicity
- **H. One transaction spanning all database restoration. CHOSEN, subject to measurement.** Revision 2
  rejected this on an *unmeasured* assumption about `executeSet` statement-set size. Codex correctly refused
  that: the proposal simultaneously claimed atomic restore in its acceptance criteria and accepted a
  permanent partial restore in its design, which is a contradiction, not a trade-off.
  **Increment 0 now measures it first** (Stage 0 below): build the statement set for the owner's real data,
  record the count and serialised size, and attempt one `executeSet`. If it succeeds within a sane bound,
  all profiles restore in a single transaction and atomicity is a property of SQLite rather than of our
  bookkeeping. Preferences (`activeProfileId`, `changelogSeenBuild`) are applied **after** the commit and
  are separately recoverable, since they are derivable from the restored database.
- **J (fallback, only if H is measured unsuitable). A durable restore journal with startup recovery.**
  Not an in-memory compensation list: a row in `_meta` recording the restore id, the bundle digest, and the
  profile ids created so far, written **inside** each profile's transaction. On boot, if a journal row exists
  without a completion marker, `openDatabase()` finishes or unwinds it deterministically before the UI
  loads. The user is told what happened. In-memory compensation is **removed from the design entirely** -
  it cannot survive the process death that is the whole failure mode.
- **I. Per-profile transaction plus in-memory compensating delete. Rejected** (was chosen in revision 2).
  A process kill between profiles leaves a partial restore that nothing can classify afterwards: on reopen
  the app cannot tell a half-finished restore from a deliberate partial import.

---

## Proposed design

### Bundle format v2

```jsonc
{
  "app": "compendium",
  "bundleFormat": 2,              // 1 (or absent) = today's single-profile bundle
  "schemaVersion": 11,            // row-shape version; refuse if > MAX_SUPPORTED_SCHEMA
  "appBuild": 214,                // provenance - INSIDE the digest (see below)
  "exportedAt": "2026-08-09T…",   // provenance - INSIDE the digest (see below)
  "integrity": { "algorithm": "SHA-256", "digest": "<hex>" },   // over everything except `digest`
  "payload": {
    "appGlobal": {
      "activeProfileIndex": 0,    // index into payload.profiles, NOT an id - survives re-keying
      "changelogSeenBuild": 213
    },
    "profiles": [
      {
        "profile": {              // every column, unlike today's {name, avatar, accent}
          "name": "…", "avatar": "…", "accent": "gold", "system": "sorcery",
          "is_default": 1, "created_at": "…", "updated_at": "…"
        },
        "dashSeeded": true,       // the catalog_meta dash_seeded:<pid> flag, carried explicitly
        "decks": [], "deck_entries": [], "deck_history": [],
        "saved": [], "notes": [], "collections": [], "collection_items": [], "links": [],
        "owned_cards": [], "card_lists": [], "card_list_entries": [],
        "matches": [], "match_log_entries": [], "resume": null,
        "dashboard_blocks": [], "dashboard_layouts": [],
        "settings": null
      }
    ]
  }
}
```

The envelope (`app`, `bundleFormat`, `schemaVersion`, `integrity`) is readable without touching `payload`,
so a file can be identified and refused before any of its content is interpreted.

**Back-compatibility.** A file with `bundleFormat` absent or `1` is today's single-profile bundle and is
imported by the existing path, unchanged. One reader handles both.

### Completeness is enforced by a round-trip test, not by discipline

Revision 2 specified this guard too narrowly and I flagged it against myself; Codex independently required
the stronger form. The weak version asserted only that the **exporter's** table constant matches the set of
profile-owned tables parsed from `src/store/schema.js`. That is satisfiable by adding a table to the
exporter and forgetting `restoreProfileUnit` - the archive would then contain the data and never give it
back, which is the worst failure this feature can have.

The gate is therefore a **schema-derived all-table sentinel round trip**:

1. Parse the profile-owned table set out of `src/store/schema.js`.
2. Seed a profile with at least one row carrying a distinctive sentinel value in **every** table and every
   nullable column that the format claims to carry.
3. Export, restore into a second profile, and assert every sentinel is present and correctly re-keyed.
4. The test **fails if either export or restore omits a table or a field.**

A future migration that adds a profile-owned table and updates only one side of the pair turns it red.

### Backup must read a consistent snapshot

Revision 2 built the archive from sequential `query()` calls with nothing protecting them, inheriting the
shape of today's `exportProfile` (`profileTransfer.js:29-64`). Codex is right that this is a correctness
defect, not a performance one: a scan write, deck save, or profile switch landing between two table reads
produces an archive whose rows disagree with each other **and whose checksum is perfectly valid**. Silent
inconsistency in the artifact whose whole job is recovery.

Two mechanisms are required together, and the second is the subtle one.

**1. A read transaction.** The plugin exposes `beginTransaction` / `commitTransaction` /
`rollbackTransaction` on the connection (`@capacitor-community/sqlite` definitions `:1386-1398`), and sql.js
takes `BEGIN` / `COMMIT` directly. `db.js` gains a `snapshot(fn)` that opens a transaction, runs `fn`'s
reads, and commits.

**2. A write gate at the `db.js` boundary - because the connection is shared.** This is the part a
transaction alone does not solve. Both backends use **one connection**, so a write issued during the
snapshot does not merely race the reads, it *joins the snapshot's transaction* and is committed or rolled
back with it. Excluding only Collection writes is insufficient: `withExclusiveCollectionWrites`
(`collectionWrites.js:150`) governs the Collection queue, while deck saves, match recording, and profile
mutations go straight to `run()`/`tx()`.

So `snapshot()` takes an exclusive gate that **every** `run()`, `tx()` and `exec()` in `db.js` respects.
`db.js` is already the single choke point for all writes, which is what makes this a narrow, testable change
rather than an audit of every caller. Writes issued during a snapshot await the gate; they are delayed, never
dropped, and never silently enrolled in someone else's transaction.

```text
backupAll():
  body = await snapshot(async () => {                      # exclusive write gate + read transaction
    payload = { appGlobal, profiles: [buildProfileUnit(p) for p in listProfiles()] }
    return { app, bundleFormat: 2, schemaVersion: SCHEMA_VERSION, appBuild, exportedAt, payload }
  })
  # THE canonical preimage. Named once, used by writer and reader alike.
  unsigned = { ...body, integrity: { algorithm: 'SHA-256' } }        # digest ABSENT
  digest = await sha256Hex(canonicalJson(unsigned))        # THROWS if Web Crypto is absent
  file   = { ...unsigned, integrity: { algorithm: 'SHA-256', digest } }
  verify: parseBackup(JSON.stringify(file)) round-trips and re-verifies
  saveTextFile('compendium-backup-YYYYMMDD-HHMMSS.json', …)
```

**The digest covers `unsigned`: the whole canonical envelope including `integrity.algorithm` and excluding
only `integrity.digest`.** Revision 2 hashed only `payload`, leaving `appBuild` and `exportedAt` - the
provenance the restore preview *shows the user* - editable without invalidating the file.

Revision 3 fixed that but introduced a worse bug, which Codex caught: the writer hashed the envelope
*before* `integrity` was attached, while the reader hashed the envelope with only `integrity.digest`
removed - leaving `integrity.algorithm` in the reader's preimage and not the writer's. **Every valid archive
would have failed its own integrity check.** Naming one preimage, `unsigned`, in one place and having both
sides use it is the whole fix; the pseudocode above is deliberately explicit about it because this is
exactly the kind of detail that reads as obviously-fine and is not.

Round-trip verification happens **before** the file is handed on, so a backup that cannot be read back is
reported as failed rather than delivered. If `sha256Hex` throws, the operation fails plainly; it never falls
back to writing an unverifiable file.

### Bounds, checked before anything is allocated or written

The existing import boundary validates shape, not size (`importBoundary.js`). A whole-app archive is a much
larger attack and accident surface than a single profile, so restore enforces explicit ceilings **before**
parsing into memory and before any write: total file bytes, profile count, per-table row count, and total
row count. Exceeding any bound is a loud refusal naming the bound. The limits are constants in `backup.js`
with a stated rationale, generous against real data (the owner's collection is the calibration point) and
finite against a hostile or corrupt file.

Two cardinality rules join them, because neither is currently enforced anywhere:

- **Exactly one `is_default`** across the bundle's profiles. Zero or many is a refusal, not a repair.
- **`activeProfileIndex` is in range** of `payload.profiles`, or absent.

### Restore

```text
restoreAll(text):
  reject if text.length > MAX_FILE_BYTES            # BEFORE parse
  env = parseBackup(text)                           # JSON parse, envelope shape
  reject if env.app !== 'compendium'
  reject if env.bundleFormat > 2                    # LOUD, nothing written
  reject if env.schemaVersion > MAX_SUPPORTED_SCHEMA    # reuses importBoundary
  unsigned = env with integrity.digest DELETED (integrity.algorithm RETAINED)   # same preimage as the writer
  reject if sha256Hex(canonicalJson(unsigned)) !== env.integrity.digest
  reject if any profile unit fails the ITERATED_COLLECTIONS shape check
  reject if any bound is exceeded (profiles, per-table rows, total rows)
  reject unless exactly one profile carries is_default=1
  reject unless activeProfileIndex is absent or in range

  PREVIEW to the user: N profiles, per-profile deck/card/match counts, exportedAt, appBuild.
  Nothing is written until the user confirms.

  # ONE transaction over ALL database restoration (Options / H), size-validated in Stage 0.
  stmts = []
  for unit in env.payload.profiles:
     stmts += planProfileUnit(unit)          # pure planner; no I/O, no ids allocated from the DB
  stmts += adoptDefault(env)                 # move is_default to the restored profile that carried it
  await tx(stmts)                            # commits entirely, or changes nothing at all

  # AFTER the commit, outside any transaction, idempotent, and separately recoverable:
  Preferences.set(activeProfileId, createdIds[env.payload.appGlobal.activeProfileIndex])
  Preferences.set(changelogSeenBuild, min(bundle value, current build))
```

Atomicity is now a property of the single transaction rather than of our own bookkeeping. Preferences are
applied last **and are derivable from the restored database**, so a process death between the commit and the
preference write costs at most "the wrong profile is active", which `initProfiles()` already resolves on the
next boot (`profileRepository.js:29-47`).

**No profile is ever deleted.** Restore adds profiles and moves one flag. The starter profile becomes
non-default and the user may delete it or keep it (Options / R4).

`changelogSeenBuild` is **clamped** to the running build: restoring a higher value from a newer device would
permanently hide release notes the user has not seen.

### Stage 0 result: the single transaction is confirmed (2026-08-10)

Measured with `scripts/backup/measure-restore-size.mjs`, which drives the **real** `importProfile` against
in-memory sql.js and captures the exact statement set through `db.js` `tx()` - the same set that would be
handed to `executeSet` on device - then executes it to prove it valid against schema v11, with the real
catalog seeded so v11 canonicalisation is live.

| Dataset | Rows | Statements | Serialised set |
|---|---|---|---|
| **The owner's real profile** | 1,470 | **1,479** | **0.38 MiB** |
| synthetic, light x3 profiles | 2,874 | 2,958 | 0.71 MiB |
| synthetic, moderate x3 | 22,905 | 23,373 | 5.61 MiB |
| synthetic, heavy collector x3 | 102,486 | 103,857 | 24.39 MiB |

**Decision: Options / H. One transaction over all database restoration.** The real figure is ~15x below
the "moderate" synthetic and roughly two orders of magnitude below anything that would strain a bridge
call. Even a 20x growth in the owner's collection stays inside single-MiB territory.

**Options / J (durable `_meta` journal + startup recovery) is therefore NOT built.** That is the outcome
worth naming: revision 2 assumed this measurement's answer, guessed it the wrong way, and designed
boot-time recovery machinery around the guess. Measuring first deleted that machinery from the scope
instead of shipping it.

Two honest limits on the number:
- It is **one** profile. A whole-app restore is the sum across profiles; at 0.38 MiB each, that stays
  comfortable for any plausible profile count.
- sql.js execution time (22 ms) says **nothing** about native `executeSet` across the Capacitor bridge.
  The claim being made here is about **set size**, not speed. Restore duration is observed on device in
  Stage 6, and the UI shows progress regardless.

If a future dataset ever approached the heavy-collector row of that table, Options / J below is the
reviewed fallback and this measurement is the trigger to revisit.

### If the single transaction ever proves unsuitable (not the current case)

Stage 0 measured it and it fits. If the owner's real data cannot go through one `executeSet`, the fallback is a
**durable restore journal**, not in-memory compensation:

```text
_meta['restore_journal'] = { restoreId, digest, phase: 'in-progress', profileIds: [...] }
```

written **inside** each profile's transaction, and cleared inside the last one. `openDatabase()` inspects it
before the UI loads: an in-progress journal is completed or unwound deterministically, and the user is told.
This is a schema-free use of the existing `_meta` table, so it still adds no migration. It is documented as
the fallback rather than the plan because a design that needs boot-time recovery is strictly worse than one
that does not, and we should only pay for it if the measurement says we must.

`restoreProfileUnit` is the existing `importProfile` body, extracted so both paths share one implementation
of re-keying, sanitisation, and the derived deck W-L recomputation (`profileTransfer.js:185-196`).

### UI

A **Backup** section in `SettingsModal` (`src/App.jsx:604`), beside the existing per-profile Export/Import
in the profile sheet rather than replacing it:

- **Prepare backup** - builds, verifies, and hands the file to the share sheet.
- **Restore from backup** - file picker -> preview -> confirm -> result.
- A status line, worded honestly (below).

Copy states plainly that the file is **not encrypted** (Security, below).

#### "Prepared", not "stored" - the app cannot see where the file went

`saveTextFile` (`native.js:65-79`) writes to `Directory.Cache`, opens the Android share sheet, and
**swallows dismissal** - `catch { /* user dismissed */ }` - then returns `'shared'` regardless. So the app
literally cannot distinguish "saved to Drive" from "user hit back". Revision 2's "last backup: 2h ago"
status line would therefore have been capable of asserting a backup exists when none does, which is worse
than showing nothing: it is a false safety signal on the one feature whose entire purpose is safety.

Accordingly:

- The success wording is **"Backup prepared"**, followed by an instruction to save it somewhere durable and,
  ideally, reopen it once to confirm it arrived.
- The status line records **"last prepared"**, never "last backed up" or "stored".
- No timestamp is written that could be read as proof of a durable copy.
- A "stored" claim is only ever recorded if a future increment gains a destination the app can verify by
  reading back (the deferred SAF work). This increment does not, and says so.

The cache file is left for the OS to reclaim; it is not a backup and is not presented as one.

---

## Implementation plan

**Stage 0 - Measure, before designing around a guess.** Two measurements that gate the design, taken on the
owner's real data before any feature code is written:
1. **Statement-set size.** Build (do not execute) the full restore statement set for the current database;
   record statement count and serialised size; execute it once against a scratch profile set on a debug
   build. This decides Options / H versus J - single transaction, or durable journal.
2. **Web Crypto availability** in the Capacitor WebView (Assumption 2), since the integrity design depends
   on it and the failure mode is "backup refuses to run".
*Checkpoint:* report both. If H is unsuitable, the journal design enters scope and is reviewed before it is
built.

**Stage 1 - Characterization tests, before touching `importProfile`.** Codex required this ordering and it
is right: the extraction in Stage 2 modifies a function whose comments record two separately paid-for bugs.
Write, against today's code:
- a test reproducing the **disconnected import boundary** bug (`profileTransfer.js:75-78`) - an imported
  want must not multiply on the first heart tap;
- a test reproducing the **orphan-profile** bug (`:102-112`) - an injected mid-import failure must leave no
  profile behind;
- the **schema-derived all-table sentinel round trip** described above, against the existing per-profile
  export/import.
*Verify:* all three pass on unmodified code. They are the safety net for Stage 2, so they must exist first.
*Releasable:* yes - tests only.

**Stage 2 - The pure core.** `src/store/backup.js`: canonical JSON, whole-envelope digest, envelope build and
parse, bounds, cardinality validation. No UI, no wiring.
*Verify:* `test:query` only. Nothing is reachable from the app.

**Stage 3 - `db.js` snapshot support.** `snapshot(fn)` plus the exclusive write gate honoured by `run`,
`tx` and `exec`. Narrow and central by design.
*Verify:* `test:query` including a **concurrency regression test** - a write issued during a snapshot must
neither appear inside the snapshot's transaction nor be lost; it lands after the snapshot commits.

**Stage 4 - Shared unit extraction.** Extract `buildProfileUnit` / `planProfileUnit` from `exportProfile` /
`importProfile`; add the missing profile columns and `dashSeeded`; extend `validateBundle` for the envelope.
**The existing per-profile Export/Import must behave identically after this stage.** Stage 1's tests are the
characterization and must pass unchanged.
*Checkpoint:* this is the stage that touches live import code.

**Stage 5 - Backup, restore, and the Settings UI.** `backupAll`, `restoreAll`, `adoptDefault`, the preview
modal, the honest status line.
*Verify:* `test:query` for atomicity and default handling; `test:ui` for the preview state.

**Stage 6 - Verification, including the disposable environment.** See below.

**Stage 7 - The handoff to Increment B.** With A merged: bump `build`, run `npm run android`,
`./gradlew assembleRelease`, install on the owner's device, take a whole-app backup of the real data, and
**archive the signed APK outside `android/app/build/`** as `dist-apk/compendium-baseline-b<build>.apk`.

Two things are handed over, and they are not the same artifact:
- **The backup file** - B's data safety net.
- **The rollback source baseline** - this merged `main` commit, recorded by SHA. B rebuilds it at B's own
  `versionCode` to produce the recovery binary; that binary is built in B's Increment 0 and exercised in
  B's Increment 9. **The APK archived here is the baseline being replaced, not the rollback binary.**

---

## Data migration and compatibility

**No `SCHEMA_VERSION` bump** (Assumption 1). No table is created, altered, or backfilled. The feature is
read-time logic plus one new pure module.

| Incoming file | Behavior |
|---|---|
| `bundleFormat` 2, `schemaVersion <= 11`, checksum valid | Restore all profiles |
| `bundleFormat` 2, `schemaVersion > 11` | **Refused loudly.** Nothing written |
| `bundleFormat > 2` | **Refused loudly.** A newer format may mean things this build cannot interpret |
| `bundleFormat` absent or 1 | Today's single-profile bundle; imported by the existing path |
| Checksum mismatch | **Refused loudly** as corrupt |
| `app !== 'compendium'` | Refused, as today (`importBoundary.js:53`) |

**Idempotency and retry.** Restore re-keys every id, so restoring the same file twice yields two independent
sets of profiles rather than a collision or a merge. That is the existing, tested property of
`importProfile`, extended to N profiles. It is also why a failed-then-retried restore is safe: the
compensation removed the first attempt's rows, and even if it had not, the second attempt cannot collide
with them.

**Forward compatibility of the artifact.** A v2 file written today and read by a future build is governed by
that build's `MAX_SUPPORTED_SCHEMA`, which is forward-only by design.

---

## Rollback and recovery

| Layer | Mechanism |
|---|---|
| Code | Feature branch; `main` untouched until verified. Stages 1-3 are additive; **Stage 4** is the characterized refactor of live import code and is the one that needs review attention |
| A bad restore | Restore is **additive**. It never overwrites or deletes anything: **the design contains no profile-deletion path at all** (Options / R4). The only non-additive act is moving `is_default` to the restored profile that carried it |
| A failed multi-profile restore | Nothing to undo: one transaction commits entirely or not at all (Options / H). If Stage 0 forces the journal fallback (J), boot-time recovery resolves it deterministically and tells the user |
| The artifact | A v2 file read by a reverted build is refused as an unknown `bundleFormat` rather than partially applied - the file outlives the code, and the format says so |

**Point of no return: none.** No migration, no destructive mode, no prune. The nearest thing is the starter
cleanup, which is conditioned on the profile being empty.

**The honest limit.** This feature does not retroactively protect anything. Until it ships, the only
recovery paths are the per-profile export and Android Auto Backup - which is exactly why it is Increment A
and why the Capacitor upgrade waits behind it.

---

## Verification plan

### `test:query` (pure, the bulk of the safety net)

- **Completeness (the headline gate):** the schema-derived all-table sentinel round trip. A synthetic table
  added to the schema fails it; a table dropped from **either** the export planner or the restore planner
  fails it; a field silently discarded by the restore planner fails it.
- **Characterization, written in Stage 1 against unmodified code:** the disconnected-import-boundary bug
  (`profileTransfer.js:75-78`) and the orphan-profile bug (`:102-112`). Both must still pass after the
  Stage 4 extraction.
- **Concurrency (new, Blocker 1):** a write issued *during* a snapshot (a) does not appear in the archive,
  (b) is not enrolled in the snapshot's transaction, and (c) is not lost - it lands after the commit. Also:
  a snapshot that throws releases the write gate.
- **Canonical JSON:** stable key order; key insertion order does not change the digest; nested arrays and
  `null`s are stable.
- **Integrity:** the digest covers the whole envelope - editing `exportedAt` or `appBuild` **invalidates**
  the file (this is the revision-2 behavior that reversed); any row change invalidates it; a truncated file
  is refused.
- **Bounds (new, Major 2):** oversize file, too many profiles, too many rows in one table, and too many rows
  overall are each refused **before** any write, and each asserts the database is untouched.
- **Cardinality (new, Major 2):** zero defaults refused; two defaults refused; out-of-range
  `activeProfileIndex` refused; absent `activeProfileIndex` accepted.
- **Versioning:** `schemaVersion` 12 refused; `bundleFormat` 3 refused; `bundleFormat` 1 imported through
  the legacy path; `app` mismatch refused; a malformed file refused. **Each asserts the database is
  untouched afterwards.**
- **Isolation:** after restoring two profiles, no row of A resolves under B.
- **Atomicity:** an injected failure while restoring profile 2 of 3 leaves the database **exactly** as it
  was - no profile, no row, no flag change.
- **Default handling:** the restored default is adopted; exactly one default afterwards; **and a test
  asserting no code path in `backup.js` or the restore planner emits a `DELETE FROM profiles`.**
- **App-global:** `activeProfileIndex` resolves through re-keying; `changelogSeenBuild` clamps.

### `test:ui`

Restore-preview state: counts, the confirm gate, and that nothing is dispatched before confirmation.

### Disposable-environment restore (acceptance criterion 8)

Per Assumption 5, the disposable environment is a **debug build on an emulator** - valid because restore is
JavaScript and identical across build types, and possible because the arm64-only filter is release-scoped
(`android/app/build.gradle:88`).

1. On the owner's device (release build): record profile count and per-profile deck / owned-card / match
   counts, then take a whole-app backup.
2. Install the **debug** build on a **fresh emulator** with no prior data. Confirm it boots to the starter
   profile.
3. Restore the backup file. Confirm: every profile present; every count matches step 1; exactly one default,
   and it is the restored one; **the starter profile is still present but is now non-default, and can be
   deleted by the user** (nothing deletes it automatically); the active profile is the one that was active;
   art and card references resolve or degrade visibly.
4. Restore the **same file a second time** onto the same emulator. Confirm it produces a second independent
   set rather than corrupting the first (idempotency by re-keying).
5. Truncate the file by 100 bytes and restore. Confirm it is refused and **nothing changed**.
6. Edit one row's value by hand and restore. Confirm the checksum refuses it.
7. Measure `/data/data/com.sadkinglabs.compendium/databases/compendiumSQLite.db` and report it against the
   25 MB Auto Backup quota (Assumption 4). **Reported, not acted on.**

### Device (release APK, owner's device)

- Backup writes and shares successfully; the reported profile and row counts match the database.
- **Web Crypto availability** confirmed (Assumption 2) - the operation succeeds and produces a digest.
- Airplane mode: backup and restore both succeed with no network.
- Zero-image mode: restore preview and result are usable with all images absent.
- Accessibility: the Backup section and the restore-confirm are reachable and labelled, meet the touch
  target floor, and remain legible at 200% font scale.

### Web

`npm run dev`: backup downloads as a blob, restore reads through the file picker, both refuse the same bad
inputs.

### Stated gaps

Restore onto a device with a **different catalog version** is exercised only insofar as the emulator's
catalog matches; a genuinely divergent catalog is not tested here and relies on the existing
unresolved-placeholder behavior.

---

## Security, privacy, performance, and operations

**The exposure, stated plainly.** The bundle is **plaintext** and leaves the app sandbox through the share
sheet. It contains `matches.opponent_name` (`schema.js:151`) - a social graph of **third parties who did not
consent to anything** - plus user-authored free text in `notes.body`, `decks.notes`, `deck_history.text`,
and `owned_cards.notes`. If the user sends it to a synced cloud folder, that content sits on someone else's
server in the clear.

This is a **deliberate MVP tradeoff under the owner's "leanest first" directive, not an oversight.** The
mitigation in v1 is honesty: the UI states that the file is not encrypted before the share sheet opens.
Optional passphrase encryption is the **first** follow-up this proposal recommends, and it becomes more
important, not less, if a scheduler is ever added - an unattended backup landing in a synced folder is a
different risk from one the user consciously sends.

**Input validation.** A restore file is untrusted input. It reuses every existing guard - `safeHref`,
`sanitizeBlockConfig`, `normalizeDurationSec`, shape checks - and every write is parameterized, so the
quote-unaware native statement splitter (`src/store/db.js:161-186`) is never reachable with user content. A
hostile file is a data problem, not an injection one. The checksum is an **integrity** control, not an
authenticity one: it detects corruption, and it does not make a hand-crafted file trustworthy. That is why
validation runs regardless of whether the checksum matched.

**Telemetry consent is never in the file.** Restoring another device's consent decision would be a privacy
defect; the architecture already states consent is device-owned.

**Performance.** Backup is a handful of `SELECT`s per profile plus one hash over a few MB. Restore is
per-profile `executeSet` batches. Both are explicit user actions with a progress state; neither runs at boot
and neither touches first paint. Timings are measured on the owner's real data, not asserted.

**Operations.** No new dependency, no BoM, no manifest change, no permission. The forbidden-permission gate
is unaffected. `distribute.mjs` is untouched.

---

## Documentation impact

| Document | Disposition |
|---|---|
| `COMPENDIUM_DATA_MODEL.md` | **Update.** Document bundle format v2, the whole-app protocol, the integrity and version gates, and the app-global keys that are and are not carried. Correct the "current transfer gaps" section: two of its three gaps are already closed in code. |
| `COMPENDIUM_FEATURE_MATRIX.md` | **Update.** Add a "Backup and restore" capability row; move "Profile transfer" off "Partial" if its remaining gaps close here. |
| `COMPENDIUM_ARCHITECTURE.md` | **Update.** Record `backup.js` as a pure store module, the app-global key tier, and that the backup file is a derived artifact and never an authoritative store. |
| `BUILD.md` | **Update.** How to take and verify a backup; the disposable-emulator restore procedure; the note that debug keeps all four ABIs specifically so an emulator can serve as that environment. |
| `DESIGN_SYSTEM.md` | **Reviewed.** The Settings section and preview modal reuse the existing sheet chassis and tokens; updated only if a new pattern proves necessary. |
| `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` | **Reviewed - no change required.** Process unchanged. |
| `docs/WORK_IN_FLIGHT.md` | **Update.** Add the branch row at start; remove on merge. |

---

## Risks and unanswered questions

| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | A future migration adds a profile-owned table and the exporter is not updated, so backups silently omit it | Med | **High** | The schema-derived completeness test is designed for exactly this and fails closed | Claude |
| 2 | Web Crypto unavailable in one runtime, so backup cannot produce a checksum | Low | Med | Fail loudly; never write an unverifiable file. Confirmed on device before the format is fixed | Claude |
| 3 | **Stage 4's** refactor of live import code regresses the existing per-profile Import | Med | **High** | **Stage 1's** characterization tests are written first, against unmodified code, and must pass unchanged; checkpoint at that stage | Claude |
| 4 | Stage 0 shows one transaction is unworkable, so the journal fallback enters scope late | Med | Med | Measured before any feature code is written, so the design fork happens at the cheapest point | Claude |
| 5 | Plaintext bundle in a synced cloud folder exposes opponent names | Med | Med | Explicit UI statement; encryption is the first follow-up | **Owner (accepted)** |
| 6 | The user restores onto a device whose catalog differs, and references do not resolve | Med | Low | Existing unresolved-placeholder degradation; stated as a tested gap | Claude |
| 7 | A large collection makes the whole-restore statement set too big for `executeSet` | Low | Med | Measured on the owner's real data in **Stage 0**, before any feature code exists; the durable journal (Options / J) is the reviewed fallback | Claude |

**Decisions requested from the owner:**

1. **Confirm the destructive "replace everything" restore stays out of the MVP** (Options / R4). The design
   is merge plus default adoption, with **no deletion path of any kind**: after a fresh-install restore the
   starter profile remains, non-default, and the user may delete it or keep it. If the owner wants "wipe
   this device and restore the backup", that is a separate proposal with a forced pre-restore backup.
2. **Confirm plaintext for v1** and that the UI stating so is adequate mitigation (Risk 5).
3. **Where should the Backup section live** - inside Settings (recommended, since it is app-wide) or in the
   profile sheet beside the per-profile Export (where users may look first)?

---

## Self-Critique

**The strongest case this design is wrong.** It builds a *file format* when the failure it is defending
against may be a *habit* problem. A manual backup is only as good as the user's memory of taking one, and
the most likely real-world sequence is: this ships, the owner takes one backup to test it, and the phone
breaks eleven months later. Revision 1's scheduler was ugly and over-built, but it was aimed at that exact
failure, and cutting it means the honest description of this increment is "a correct backup you must
remember to take." I think that is still the right call for the MVP - a correct manual backup strictly
dominates no backup, and the scheduler is worthless if the format is wrong - but a reviewer should not let
me pretend the recoverability problem is solved when what is solved is the *artifact* problem.

**The assumption with the highest consequence if false.** Assumption 3, that **one** transaction can carry
every profile's statements. If the owner's real data is too large for a single `executeSet`, the design
falls back to the durable journal (Options / J), which trades SQLite's atomicity for boot-time recovery code
we have to get right ourselves - strictly worse, and a real design change rather than a tweak. Revision 2
guessed the answer and built the weaker design around the guess; **Stage 0 now measures it before any
feature code exists**, so the fork happens at the cheapest possible point. That is an improvement in
process, not a guarantee about the answer.

**The simpler alternative I may be dismissing unfairly.** Add `is_default`, `system`, timestamps, and the
app-global keys to the *existing* per-profile bundle, and add a "back up all profiles" button that simply
writes N files. No new format, no envelope, no checksum, no compensation, no new module - maybe a tenth of
the work. It fails criterion 1 (one artifact) and criterion 3 (integrity), and N files is a worse thing to
hand a panicking user a year later. But it would close most of the actual gap in an afternoon, and if the
owner's appetite is smaller than this proposal assumes, it is the honest fallback.

**Coupling the analysis might have missed.** Stage 2 refactors `importProfile`, which is the single most
hardened and most commented function in the store - its comments record two separate bugs already paid for
(the disconnected boundary at `profileTransfer.js:75-78`, and the orphan-profile fix at `:102-112`). Pulling
its body into a shared unit risks re-opening exactly those, and the whole-app path would not necessarily
reveal it, because the per-profile path is the one with the history. That is why Stage 2's gate is "the
existing tests pass unchanged" rather than "the new tests pass" - but existing tests only cover what someone
already thought to test.

**The failure most likely to escape the plan.** A backup that is *complete today* and *incomplete after the
next feature*. Every test in Stage 1 will be green, the completeness test will be green, and then someone
adds a table in a migration and adds it to the exporter constant to make the test pass **without adding it
to `restoreProfileUnit`** - so it backs up and never comes back. The completeness test as specified
guards the export side only. It should assert the **round-trip**: that every table in the schema-derived set
is both written and read back with rows. I am flagging this against my own design because the narrower
version is the one I would have written by default.

**Evidence that would change the decision.**
- Web Crypto unavailable in the WebView -> the integrity design changes (a small vendored hash, or an
  explicit "unverified" format, which I would rather refuse than ship).
- A single profile exceeds a safe `executeSet` size -> per-profile atomicity needs a different mechanism.
- The owner's appetite is smaller than assumed -> the N-files fallback above.
- Codex demonstrates that Stage 2's extraction cannot preserve `importProfile`'s guarantees -> keep two
  call paths and accept the duplication, against the usual preference, because that function's history
  outweighs the tidiness argument.

---

## Approval record

| Gate | Disposition | Date |
|---|---|---|
| Proposal review (Codex) - revision 1 | Superseded | 2026-08-09 |
| Proposal review (Codex) - revision 2 | **Changes required** - 2 blockers, 4 majors | 2026-08-09 |
| Proposal review (Codex) - revision 3 | **Changes required** - hash preimage, stale text | 2026-08-10 |
| Proposal review (Codex) - revision 4 | **Changes required** - stale active instructions only; "once that exact semantic sweep is complete, the architecture is approval-ready" | 2026-08-10 |
| Semantic sweep | Complete. Every active section Codex cited is corrected; superseded facts survive only in revision tables explicitly labelled as such | 2026-08-10 |
| **Architecture approval (human project owner)** | **APPROVED** | **2026-08-10** |

**What the approval covers, stated precisely.** The owner has approved the architecture and may proceed to
implementation of the approved design. Codex issued its final disposition as *conditionally* approval-ready
pending the semantic sweep; the sweep is now complete but **Codex has not re-inspected it**. Per
`AGENTS.md` §4, the remaining gate is the **final review of the actual diff**, which is unaffected: Codex
reviews the implementation independently when it exists. Any divergence discovered during implementation
stops at the §12 checkpoints rather than being absorbed silently.


### Owner decisions recorded (2026-08-09) - do not re-litigate

1. Build a real app-level backup/restore protocol **in addition to** per-profile export.
2. Rewrite this document from current schema-v11 source evidence; the previous draft is materially stale.
3. Distinguish Android Auto Backup, per-profile transfer, and the new explicit whole-app protocol.
4. **Leanest manual all-profile MVP first.** Do not carry forward scheduler, GFS retention, encryption, or
   SAF complexity from revision 1.
5. Specify completeness, app-global state, format and versioning, validation, checksum/integrity,
   future-version refusal, atomic restore, profile/default handling, privacy, recovery, and fresh-install
   verification.
6. Test restore on a disposable/fresh environment.
7. After approval and implementation, produce and archive a signed baseline APK; it becomes the rollback
   binary for the Capacitor 8 upgrade (Increment B).

### Owner directive -> section map

| Directive | Where it is answered |
|---|---|
| Rewrite from current evidence | Status note; Evidence and current architecture (whole section rebuilt against v11) |
| Distinguish the three mechanisms | Problem and success criteria, the three-row table |
| Leanest MVP; drop scheduler/GFS/encryption/SAF | Non-goals; Options C/D |
| Completeness | Criterion 1; "Completeness is enforced by a test"; Verification `test:query` |
| App-global state | "App-global state that is not profile-owned"; `payload.appGlobal` |
| Format and versioning | Bundle format v2; Data migration and compatibility |
| Validation | Restore pseudocode; reuse of `importBoundary` |
| Checksum / integrity | Options E/F/G; `integrity` envelope field; Verification |
| Future-version refusal | Criterion 3; compatibility table; invariant 4 |
| Atomic restore | Criterion 4; Options H/I; invariant 5 |
| Profile / default handling | Criterion 7; Options R1/R2/R4; `adoptDefault` (no deletion path exists) |
| Privacy | Security section; Risk 5 |
| Recovery | Rollback and recovery |
| Fresh-install verification | Criterion 6; Assumption 5; disposable-environment procedure |
| Signed baseline APK archived; **rollback source baseline** handed to B (B builds its own rollback binary) | Implementation plan, Stage 7 |
