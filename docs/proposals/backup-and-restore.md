# Proposal: Backup and restore - a durable, all-profiles, off-device safety net

## Status and classification

Draft (revision 1)
Risk: **High**
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner

High-risk under constitution §6, five triggers at once: persisted-data/schema surface, an import/export format change, a native plugin and build change, security/privacy work (a plaintext social graph leaving the sandbox), and a new pattern (a scheduler with retention). When several classes apply, the higher governs.

Product decisions are already made and are recorded verbatim in **Options considered** so they are not re-litigated. This document is the plan and the implementation design, not a re-opening of the decisions.

---

> **Amendment (2026-07-16): Stage 1 superseded.** The anchored-highlights feature was
> removed entirely - see [remove-highlights.md](./remove-highlights.md) (implemented,
> schema v10). Stage 1 of this proposal (fixing the highlight export gap) no longer
> applies: there are no `annotations`, `anchors`, or `highlights` tables to carry. When
> this proposal is picked up, drop `annotations` / `anchors` / `legacy_highlights` from
> bundle format v2 and the annotation data-loss motivation below, and set the version
> gate to schema 10. The other transfer gaps (version gate, orphan profile) are
> unaffected. The sections below predate that removal and are left as the historical
> record.

## Problem and success criteria

Compendium is an offline-first application whose only copy of a user's decks, collection, annotations, matches, and profiles lives in one plaintext SQLite file inside the app sandbox. There is today **no path that reliably gets that data off the device**, and the one transfer path that exists silently loses data.

Three concrete failures motivate this:

1. **No off-device copy that survives an uninstall.** [BUILD.md:108-114](../../BUILD.md#L108) records that a debug APK installed over a release build forces an uninstall, "which destroys that profile's on-device data." A dropped phone, a wipe, or a failed migration takes everything with it. `android:allowBackup="true"` at [AndroidManifest.xml:5](../../android/app/src/main/AndroidManifest.xml#L5) is a platform default that nobody chose, is undocumented, and (per the measurement flagged below) may be silently backing up nothing.
2. **The one export path loses data, both directions.** `exportProfile()` reads the frozen legacy `highlights` table ([profileTransfer.js:48](../../src/store/profileTransfer.js#L48)); the live highlight writer is `addAnnotation()` into `annotations`+`anchors` ([CodexDetail.jsx:225](../../src/pillars/CodexDetail.jsx#L225), `annotations.js:125-135`). A full round-trip loses **every** highlight a user has made. [COMPENDIUM_DATA_MODEL.md:412-420](../../COMPENDIUM_DATA_MODEL.md#L412) and [COMPENDIUM_FEATURE_MATRIX.md:181](../../COMPENDIUM_FEATURE_MATRIX.md#L181) already record this as a known integrity gap ("Partial").
3. **The forward-only migration invariant (§3.4) has no backstop.** [COMPENDIUM_DATA_MODEL.md:451](../../COMPENDIUM_DATA_MODEL.md#L451) states recovery after a bad migration "means forward repair or restoring a separately verified backup." No such backup exists to restore.

### Acceptance criteria

1. A user can produce, in a folder they choose, a single bundle that contains **every profile-owned row of every profile**, restorable on the same device or **any other device**, with no data class silently omitted (the completeness bar of [COMPENDIUM_DATA_MODEL.md:468](../../COMPENDIUM_DATA_MODEL.md#L468)).
2. Highlights survive a full export/import round-trip in both directions, including for testers whose highlights currently live only in the legacy `highlights` table.
3. A bundle from a **newer** schema than the running app is **refused loudly**, never partially applied. A bundle from an **older or equal** schema imports (forward-only, as today).
4. Every backup write is **verified** by read-back and a row-count check against the source before any older backup is pruned. Never prune-then-write.
5. Retention is a **pure function of the folder's filenames** to a keep/delete set, with no sidecar index, exhaustively unit-testable.
6. Before any schema migration runs on a device, a **pinned pre-migration snapshot** is taken and exempted from rotation (the §3.4 backstop).
7. `profiles.is_default` is carried through the bundle without ever producing two defaults on restore.
8. Settings surfaces backup state honestly: "last backup: verified, 2h ago", or the failure.
9. Web (`npm run dev`) neither crashes nor claims a capability it lacks; the folder/scheduler path is native-only and degrades to the existing manual share-sheet export.
10. No new runtime dependency, no WASM, no network. Strict offline-first is preserved.

### Non-goals

- **At-rest encryption of the primary database.** Killed (Options considered / D).
- **Cloud sync, an account, or any network call.** The destination folder may itself be a Drive/Nextcloud/Dropbox folder that *that* app syncs; Compendium never speaks to a network.
- **Splitting the catalog into a separate attached database** to fit the 25 MB Auto Backup quota. If the on-device measurement shows the DB exceeds the quota, that is its own future proposal and must not be smuggled into this one.
- **iOS.** The SAF plugin is Android-only; iOS keeps the manual share-sheet path. No iOS build ships today.
- **Automatic restore or merge-conflict resolution across two live devices.** Restore is user-initiated.

---

## Evidence and current architecture

| Fact | Location | Confidence |
|---|---|---|
| Export reads the legacy `highlights` table only | [profileTransfer.js:48](../../src/store/profileTransfer.js#L48) | High |
| Import writes the legacy `highlights` table only | [profileTransfer.js:108-109](../../src/store/profileTransfer.js#L108) | High |
| Live highlights are `addAnnotation()` -> `annotations`+`anchors` | [CodexDetail.jsx:225](../../src/pillars/CodexDetail.jsx#L225), `annotations.js:128-133` | High |
| Legacy `addHighlight()` has zero callers (dead writer) | [codexRepository.js:393](../../src/store/codexRepository.js#L393); `grep` finds only the definition | High |
| `highlights_migrated` backfill flag is **global**, in `catalog_meta`, not per-profile | `annotations.js:152,178` | High |
| Home dashboard widget still reads the legacy table; overview counts annotations - inconsistent | [homeRepository.js:243-245](../../src/store/homeRepository.js#L243) vs [homeRepository.js:322](../../src/store/homeRepository.js#L322) | High |
| `schemaVersion` is stamped but never read on import | [profileTransfer.js:41](../../src/store/profileTransfer.js#L41); `importProfile` never references `bundle.schemaVersion` | High |
| Import always creates a new profile; single transaction; profile created **before** the tx | [profileTransfer.js:73,85,170](../../src/store/profileTransfer.js#L73) | High |
| `profiles.is_default` (schema v3) is not exported (only name/avatar/accent) | [schema.js:212](../../src/store/schema.js#L212), [profileTransfer.js:42](../../src/store/profileTransfer.js#L42) | High |
| `initProfiles()` re-asserts exactly-one-default every boot | [schema.js:208-213](../../src/store/schema.js#L208) comment | Medium (comment, not read in full) |
| Avatars are preset refs `{kind:'initial'\|'card', value}`, never image bytes | [schema.js:61](../../src/store/schema.js#L61) | High |
| Existing hardening: `sanitizeBlockConfig` strips `javascript:`, `safeHref` guards `curiosa_url` | [profileTransfer.js:17-24,99,137](../../src/store/profileTransfer.js#L17) | High |
| No encryption anywhere: `androidIsEncryption:false`; every connection opened `'no-encryption'` | [capacitor.config.json:12](../../capacitor.config.json#L12), [db.js:190](../../src/store/db.js#L190) | High |
| Only file I/O is `@capacitor/filesystem` to `Directory.Cache`, then the Share sheet | [native.js:65-72](../../src/native.js#L65) | High |
| No SAF (`ACTION_OPEN_DOCUMENT_TREE`) capability anywhere | grep of `android/`, `src/` | High |
| Two app-module native plugins exist (scanner, telemetry); registered explicitly in `MainActivity` | [MainActivity.java:15-16](../../android/app/src/main/java/com/sadkinglabs/compendium/MainActivity.java#L15) | High |
| Plugin bridge pattern: `registerPlugin('Name', {web:{...}})` + native `@CapacitorPlugin` | [cardScanner.js:14](../../src/cardScanner.js#L14), [telemetry.js:35](../../src/store/telemetry.js#L35), [TelemetryPlugin.kt:19](../../android/app/src/main/java/com/sadkinglabs/compendium/telemetry/TelemetryPlugin.kt#L19) | High |
| Migrations run inside `openDatabase()` at boot, idempotent, version-gated | [db.js:20-45](../../src/store/db.js#L20) | High |
| Native `execute()` splitter is quote-unaware; parameterized `tx()`/`run()` are safe, `exec()` is comment-stripped DDL only | [db.js:152-198](../../src/store/db.js#L152) | High |
| `fflate` (zlib) is already a dependency; Web Crypto is a platform built-in | [package.json:35](../../package.json#L35) | High |
| Storage-shape doc already anticipates `lastBackupAt` as an app-global key | [COMPENDIUM_ARCHITECTURE.md:144](../../COMPENDIUM_ARCHITECTURE.md#L144) | High |
| `allowBackup="true"`; no `fullBackupContent`, no `dataExtractionRules`, no rules XML | [AndroidManifest.xml:5](../../android/app/src/main/AndroidManifest.xml#L5); grep of `android/app/src/main/res/xml` | High |
| targetSdk 35, minSdk 22 | [variables.gradle:2-4](../../android/variables.gradle#L2) | High |
| `SCHEMA_VERSION = 9`, forward-only migrations v1-v9 | [schema.js:6](../../src/store/schema.js#L6) | High |
| Release forbidden-permission Gradle gate exists and fails closed | [android/app/build.gradle:182-224](../../android/app/build.gradle#L182) | High |

### The annotation data-loss mechanism, exactly

Three facts compound into total, silent loss:

1. **Export** serialises `SELECT * FROM highlights` ([profileTransfer.js:48](../../src/store/profileTransfer.js#L48)). Live highlights are not there; they are in `annotations`+`anchors`. So export emits nothing for any highlight made through the current UI.
2. **Import** writes bundle `highlights` rows straight back into the legacy `highlights` table ([profileTransfer.js:108-109](../../src/store/profileTransfer.js#L108)). Nothing ever puts them into `annotations`, so nothing renders them ([CodexDetail.jsx:233-238](../../src/pillars/CodexDetail.jsx#L233) resolves `annotations`, not `highlights`).
3. **The one bridge that could have saved case 2** is `migrateAnnotationsIfNeeded()` (`annotations.js:151`), which backfills legacy rows into `annotations`. But it is idempotent on a **global** `catalog_meta` flag `highlights_migrated` (`annotations.js:152,178`). On any real device that flag is already `'1'`, so an imported legacy row is never backfilled. Even a per-import re-run would be wrong, because the flag is not keyed by profile.

This is why the fix (Stage 1) must route legacy `highlights` **through the annotation model on import**, not into the dead table, and must not depend on the global backfill flag.

### The current transfer gaps, as the data model already records them

[COMPENDIUM_DATA_MODEL.md:412-420](../../COMPENDIUM_DATA_MODEL.md#L412) enumerates exactly three, all in scope here:

1. `annotations`/`anchors` are not exported or imported. (Stage 1.)
2. `schemaVersion` is written but not used to reject future bundles. (Stage 2.)
3. The destination profile is created **before** the row-import transaction, so a failed import leaves an orphan empty profile. (Stage 2, folded into restore atomicity.)

---

## Assumptions and confidence

| # | Assumption | Confidence | Validation |
|---|---|---|---|
| 1 | The whole feature needs **no** `SCHEMA_VERSION` bump: `annotations`/`anchors` already exist (v7), `is_default` exists (v3), the version gate is read-time logic, and `lastBackupAt` is app-global preferences. | **High** | Re-read `schema.js`; the only tables touched already exist. If a reviewer finds a needed column, this becomes a schema change and re-enters §12 migration rules. |
| 2 | A raw copy of the single main DB file, taken after `PRAGMA wal_checkpoint(TRUNCATE)`, is a consistent, restorable pre-migration snapshot. | **Medium** | On-device: read `PRAGMA journal_mode`; confirm `-wal`/`-shm` are folded after the checkpoint and a copied file opens cleanly. This gates the pre-migration design (Stage 4). |
| 3 | `@capacitor/filesystem` cannot write to an `ACTION_OPEN_DOCUMENT_TREE` tree URI, so a small native plugin is required. | **High** | Its API only exposes the enumerated `Directory.*` roots ([native.js:9,68](../../src/native.js#L9)); tree URIs are SAF `content://` documents. |
| 4 | A persisted SAF tree-URI permission survives process death and app updates (not uninstall). | **High** | Documented Android behavior for `takePersistableUriPermission`; verified on device in Stage 3. |
| 5 | The on-device DB (which includes the seeded catalog tables) may exceed the 25 MB Android Auto Backup quota; our SAF folder backups are **not** subject to that quota. | **Low** on the size; **High** that SAF is unquotaed | On-device: measure `/data/data/com.sadkinglabs.compendium/databases/*.db`. Reported, not acted on here (Non-goals). |
| 6 | Web Crypto PBKDF2-HMAC-SHA256 @600k iterations + AES-256-GCM is available in the Capacitor WebView (Chromium) and fast enough for a one-off backup. | **Medium** | Device: time it on the min-spec target. Optional passphrase only. |
| 7 | `fflate` gzip lets backups be compressed with no new dependency. | **High** | Already a dependency ([package.json:35](../../package.json#L35)). |
| 8 | `initProfiles()` re-asserts exactly-one-default on boot, so a restored `is_default` cannot create a permanent two-default state as long as restore does not itself write two. | **Medium** | Read `initProfiles()` in full during Stage 2. |

Assumptions 2 and 5 are the two that gate design or scope. Both are on-device measurements, flagged in Verification.

---

## Affected systems and invariants

| Surface | Change | Stage |
|---|---|---|
| `src/store/profileTransfer.js` | Export/import `annotations`+`anchors`; route legacy `highlights` through the annotation model on import; carry `is_default`; read `schemaVersion`; make restore atomic (no orphan profile) | 1, 2 |
| `src/store/annotations.js` | A reusable "insert an annotation+anchor row from a bundle" path that does not touch the global flag | 1 |
| `src/store/homeRepository.js` | Fix the dashboard widget to read `annotations` (kind='highlight'), consistent with the overview count at [:322](../../src/store/homeRepository.js#L322) | 1 |
| **New `src/store/backup.js`** | Bundle v2 build/parse, the pure retention function, gzip, optional crypto envelope, verification. All pure/testable under `test:query` | 2, 4 |
| **New `src/store/backupFolder.js`** | Thin client over the native `Backup` plugin; web fallback to the existing share-sheet/file-picker path | 3 |
| **New `android/.../backup/BackupPlugin.kt` + `BackupStore.kt`** | SAF folder pick + persisted permission; list/write/read/delete documents; raw DB snapshot copy | 3, 4 |
| `android/.../MainActivity.java` | `registerPlugin(BackupPlugin.class)` - app-module plugins are not auto-discovered ([MainActivity.java:12-16](../../android/app/src/main/java/com/sadkinglabs/compendium/MainActivity.java#L12)) | 3 |
| `src/store/db.js` | A pre-migration hook: when `current < SCHEMA_VERSION` and a folder is configured, snapshot before `runMigrations()` | 4 |
| `src/App.jsx` | Fire-and-forget `maybeBackup()` after a successful load; Settings "Backup" section (folder pick, status line, Back up now, Restore); the restore-preview modal | 3, 4 |
| `android/app/src/main/res/xml/backup_rules.xml`, `data_extraction_rules.xml` + manifest wiring | Make `allowBackup` explicit for both Auto Backup (<=11) and device-transfer/cloud (12+) | 2 |
| App-global preferences | `lastBackupAt` and `lastBackupOk` (the [ARCHITECTURE.md:144](../../COMPENDIUM_ARCHITECTURE.md#L144) tier), never in `settings`, never exported | 4 |
| Docs | See Documentation impact | all |

### Invariants (§3), by number

**1 - Catalog/profile boundary.** Holds. A bundle carries only profile-owned rows plus catalog **references** (`card_id`, `rule_id`, `doc_id`), never catalog content - the same shape `exportProfile()` already emits ([profileTransfer.js:31-62](../../src/store/profileTransfer.js#L31)). Restoring onto a device with a different catalog re-resolves references at read time and degrades unknown ones visibly (existing behavior, [schema.js:86](../../src/store/schema.js#L86) "null = unresolved placeholder"). Verified by asserting no `cards`/`rules`/`faqs`/`link_graph`/`catalog_meta` rows appear in a bundle.

**2 - Profile isolation.** Holds. Import re-keys every id per profile via `deckMap`/`colMap`/`matchMap`/`listMap` ([profileTransfer.js:88-92](../../src/store/profileTransfer.js#L88)); the multi-profile bundle nests one such re-keyed unit per profile, so no id crosses a profile boundary. Annotations get the same treatment (new `annMap` for `annotations.id` -> `anchors.annotation_id`). Verified by a two-profile round-trip that asserts no row of profile A resolves under profile B.

**3 - Durable, offline-first writes.** Holds and is strengthened. Backups are **derived** artifacts, never the authoritative store ([COMPENDIUM_DATA_MODEL.md:396](../../COMPENDIUM_DATA_MODEL.md#L396) "derived artifacts, never authoritative stores"). The scheduler is fire-and-forget after a successful load and never sits in front of first paint (the telemetry `reconcile()` rule, [telemetry.js:83-84](../../src/store/telemetry.js#L83)). Write-and-verify-then-prune means a failed or partial write never destroys the prior good backup. Verified by an interrupted-write test that asserts the previous backup still parses.

**4 - Forward-only schema evolution.** Holds and is strengthened. This change adds **no migration** (Assumption 1). It adds the **read gate** that §12.2 of the data model says is missing: refuse `bundle.schemaVersion > SCHEMA_VERSION` loudly. And the pinned pre-migration snapshot is the "separately verified backup" that [COMPENDIUM_DATA_MODEL.md:451](../../COMPENDIUM_DATA_MODEL.md#L451) already names as the recovery path for a bad forward migration. Verified by a future-version bundle that must be rejected, and a snapshot-then-restore across a simulated migration.

**5 - Transactional user-data operations.** Holds and is improved. Restore of each profile is one `tx()` as today ([profileTransfer.js:170](../../src/store/profileTransfer.js#L170)); the orphan-profile gap ([DATA_MODEL.md:418](../../COMPENDIUM_DATA_MODEL.md#L418)) is closed by creating the profile inside the same transaction, or deleting it on failure. Multi-profile restore is per-profile atomic with an explicit all-or-nothing wrapper (see Proposed design). Verified by a mid-restore failure that must leave the database exactly as it was.

**6 - Graceful asset degradation.** Holds trivially. No backup ever contains an image: avatars are preset refs ([schema.js:61](../../src/store/schema.js#L61)), card art is APK assets ([BUILD.md:255](../../BUILD.md#L255)), so a backup and a restore are image-free by construction. Unknown card refs on restore degrade visibly.

**8 - Cross-runtime integrity.** Holds. The bundle format is identical on web and native. The SAF folder and scheduler are Android-only; web `backupFolder.js` reports "not available" and the manual export path ([native.js:65](../../src/native.js#L65)) still works, exactly as `telemetry.js`/`cardScanner.js` degrade ([telemetry.js:66-73](../../src/store/telemetry.js#L66), [cardScanner.js:48-52](../../src/cardScanner.js#L48)). Every native claim needs device evidence; a browser pass proves only the format logic.

**7 - Content is data.** Not materially affected.

---

## Options considered

### Destination

- **A. `@capacitor/filesystem` to a fixed app-external dir.** Rejected: no user control over location, and on modern Android scoped storage this is either app-private (lost on uninstall, defeating the purpose) or needs `MANAGE_EXTERNAL_STORAGE` (a Play-hostile permission). It also cannot land inside a Drive/Nextcloud folder.
- **B. Share sheet only (status quo, `saveTextFile`).** Rejected as the *primary* path (kept as the web/manual fallback): every backup is a manual, undirected user action; there is no folder to enumerate for retention, no scheduling, and the share sheet cannot be re-targeted to the same folder automatically.
- **C (chosen). Storage Access Framework, `ACTION_OPEN_DOCUMENT_TREE` + persisted URI permission.** The user picks any folder once. If it is a Drive/Nextcloud/Dropbox folder, *that* app syncs it - Compendium never touches a network, so offline-first is preserved. `@capacitor/filesystem` cannot write tree URIs (Assumption 3), so this needs a small native plugin, following the two-plugin precedent ([MainActivity.java:15-16](../../android/app/src/main/java/com/sadkinglabs/compendium/MainActivity.java#L15)). **Decision recorded so it is not re-raised:** the network abstinence is the whole reason SAF beats a built-in uploader.

### At-rest DB encryption (SQLCipher)

- **D. Enable SQLCipher on the primary database.** **Killed (decision made).** Platform File-Based Encryption plus the UID sandbox already cover at-rest; root defeats both anyway; a Keystore-wrapped key is device-bound, which would break cross-device restore (an explicit requirement); and it would undo the just-merged commits that removed `USE_BIOMETRIC`/`USE_FINGERPRINT` ([AndroidManifest.xml:109-127](../../android/app/src/main/AndroidManifest.xml#L109), commits `1ae0367`/`081a576`). The SQLCipher `.so` files that ship today ([android/app/build.gradle:75](../../android/app/build.gradle#L75) comment) stay dead weight, untouched here.

### `android:allowBackup`

- **E. Set `allowBackup="false"`.** Rejected: it removes the free platform-managed cloud/device-transfer safety net for no privacy gain that our own encrypted backups do not already provide better.
- **F (chosen). Keep `allowBackup="true"`, made explicit with both rules files.** `res/xml/backup_rules.xml` (`fullBackupContent`, Android <=11) and `res/xml/data_extraction_rules.xml` (`dataExtractionRules`, 12+, both `cloud-backup` and `device-transfer` enabled), plus a manifest comment block in the register of the existing telemetry/biometric ones. **Decision recorded:** Auto Backup is a belt to our braces; it is platform-managed and E2E-encrypted with the device PIN on Android 9+, and it is not our privacy boundary because it cannot be passphrase-encrypted. It also silently backs up nothing above a 25 MB app-data quota (Assumption 5), which is exactly why our SAF backups, unquotaed, are the real mechanism.

### Backup passphrase

- **G. Always encrypt.** Rejected: forgotten-passphrase loss is likelier than the threat, and mandatory encryption fights the anti-loss purpose of the feature.
- **H. Never encrypt.** Rejected: the match journal carries **opponent names** ([schema.js:151](../../src/store/schema.js#L151) `opponent_name`), a social graph of non-consenting third parties, and a plaintext bundle in a synced Drive folder puts that graph on someone else's server.
- **I (chosen). Optional passphrase, default off.** When on: Web Crypto PBKDF2-HMAC-SHA256 @600k iterations -> AES-256-GCM, no new dependency, no WASM (Argon2id rejected for the WASM cost). **It must never silently downgrade to plaintext:** if encryption is requested and fails, the write fails. Recorded.

### Rotation

- **J. Time-based (keep one per day/week).** Rejected: usage is bursty (a booster box scanned in one sitting; five matches at a tournament; then weeks quiet), so time-based burns slots on quiet days.
- **K. Count-based (keep last N).** Rejected: a burst collapses the whole window into one afternoon, so a mistake noticed three weeks later has no surviving pre-mistake backup.
- **L (chosen). Change-gated write + tiered GFS retention.** Hash-gate so an unchanged bundle writes nothing; keep last 3 regardless of date, plus the newest of each of the last 2 calendar weeks and last 2 calendar months, roughly 7 files, deduped so a casual user has 3-4. Depth is governed by time-to-notice: a deleted deck is noticed tomorrow, a botched collection mass-edit in three weeks. Plus pinned pre-migration snapshots (last 2), exempt from rotation. Recorded.

### Bundle scope

- **M. Keep per-profile bundles (status quo).** Rejected as the backup unit: a user with three profiles would have to remember to export three files. **N (chosen):** one bundle covers **all** profiles, while still importing an old single-profile bundle (back-compat, below).

---

## Proposed design

### Bundle format v2 (written out in full)

A backup is one JSON document. `bundleFormat` is new and is the gate's primary key; `schemaVersion` continues to describe the row shapes.

```jsonc
{
  "app": "compendium",
  "bundleFormat": 2,              // NEW. 1 = legacy single-profile (profileTransfer today).
  "schemaVersion": 9,            // row-shape version; refuse if > local SCHEMA_VERSION.
  "exportedAt": "2026-07-16T...", // informational; EXCLUDED from the change-hash.
  "appBuild": 41,               // provenance for a bug report; informational.
  "encryption": "none",         // "none" | "pbkdf2-aes-gcm-v1". Never absent.
  "profiles": [                   // ALL profiles, each a self-contained re-keyable unit.
    {
      "profile": { "name": "...", "avatar": "...", "accent": "gold", "is_default": 1 },
      "decks": [...], "deck_entries": [...], "deck_history": [...],
      "saved": [...], "notes": [...],
      "annotations": [...],       // NEW: rows from `annotations`
      "anchors": [...],           // NEW: rows from `anchors`, keyed by annotation_id
      "legacy_highlights": [...], // NEW NAME: the old `highlights` rows, imported via the
                                  //   annotation model, never back into the dead table.
      "collections": [...], "collection_items": [...],
      "owned_cards": [...], "card_lists": [...], "card_list_entries": [...],
      "links": [...],
      "matches": [...], "match_log_entries": [...],
      "dashboard_blocks": [...], "dashboard_layouts": [...],
      "resume": {...}|null, "settings": {...}|null
    }
  ]
}
```

When `encryption` is `"pbkdf2-aes-gcm-v1"`, the outer document is instead:

```jsonc
{
  "app": "compendium", "bundleFormat": 2, "encryption": "pbkdf2-aes-gcm-v1",
  "kdf": { "salt": "<base64>", "iterations": 600000, "hash": "SHA-256" },
  "iv": "<base64>",
  "ciphertext": "<base64>"   // AES-256-GCM over gzip(JSON payload-above)
}
```

The `app`/`bundleFormat`/`encryption` header stays cleartext so the reader can identify and gate the file **before** asking for a passphrase. Everything with user content is inside `ciphertext`.

Notes recorded so they are not re-derived:
- **The change-hash excludes `exportedAt`** (and, when encrypted, the random `salt`/`iv`), otherwise every backup differs and the change-gate never fires. Hash = SHA-256 over the canonical JSON of `profiles` (stable key order).
- **`legacy_highlights` is a rename, not a new table.** It carries the same rows the current bundle calls `highlights`, so an old bundle's `highlights` maps straight onto it (back-compat below).
- Plaintext bundles are gzipped for size (Assumption 7); the `.json` file is then gzip bytes with a small uncompressed header, or - simpler and chosen - the file is `compendium-backup-*.json.gz` for plaintext and `.enc` for encrypted, so the extension states the shape. (Minor; open to Codex.)

### Filenames are the state (no sidecar)

```
compendium-backup-YYYYMMDD-HHMMSS-<hash12>.json.gz      (or .enc)
compendium-premigration-vNN-YYYYMMDD-HHMMSS.db          (raw snapshot, pinned)
```

- `<hash12>` is the first 12 hex of the change-hash. The change-gate is then pure from the listing: if any existing filename carries the current hash, skip the write. Retention ignores the hash segment.
- Pre-migration snapshots are a **separate namespace** with their own retention (keep last 2), so the routine retention function never touches them.
- Timezone caveat recorded: filenames are stamped in device-local time; a folder synced across two devices in different zones could disagree on a week/month boundary by one file. Cosmetic, not data-affecting.

### Retention as a pure function (pseudocode)

```text
retain(filenames, now) -> { keep: Set, delete: Set }
  routine = filenames.filter(isRoutineBackup).map(parseTimestamp)   // ignore .db snapshots
  sortDescByTime(routine)
  keep = {}
  # Tier 1: the last three, unconditionally.
  keep += routine.slice(0, 3)
  # Tier 2: newest in each of the last two ISO calendar weeks (this week, last week).
  for w in [weekKey(now), weekKey(now - 7d)]:
      newest = firstWhere(routine, f => weekKey(f.time) == w)
      if newest: keep += newest
  # Tier 3: newest in each of the last two calendar months.
  for m in [monthKey(now), monthKey(now - 1month)]:
      newest = firstWhere(routine, f => monthKey(f.time) == m)
      if newest: keep += newest
  delete = routine - keep
  # Pre-migration snapshots: keep the two newest, exempt from the above.
  snaps = sortDescByTime(filenames.filter(isPreMigration))
  keep += snaps.slice(0, 2); delete += snaps.slice(2)
  return { keep, delete }
```

Tiers dedupe by identity (the newest file satisfies Tier 1, its week, and its month at once), so a user who backs up once a week holds 3-4 files, a daily user about 7. The function does no I/O and is total over any filename set, so it is exhaustively unit-testable (criterion 5) - this is the single most testable, highest-leverage safety property in the feature and gets the most tests.

### Write-and-verify, then prune

```text
backupNow(folder, buildBundle):
  bundle = buildBundle()                     # all profiles, format v2
  hash   = changeHash(bundle)
  if folder.list() has a name carrying hash: return { skipped: true }   # change-gate
  name = filename(now, hash)
  bytes = maybeEncrypt(gzip(json(bundle)))
  folder.write(name, bytes)                  # native SAF create+write
  back  = folder.read(name)                  # READ-BACK, same file
  assert parse(back) deep-equals bundle AND rowCounts(back) == rowCounts(bundle)
  # only now is the new backup proven:
  { keep, delete } = retain(folder.list(), now)
  for f in delete: folder.delete(f)          # prune LAST
  setPref(lastBackupAt=now, lastBackupOk=true)
```

If verification fails, the new file is deleted, `lastBackupOk=false` is recorded, nothing is pruned, and Settings shows the failure. Never prune-then-write (criterion 4).

### Pre-migration snapshot (the §3.4 backstop)

Hook the boot path in [db.js](../../src/store/db.js#L20). Migrations run inside `openDatabase()`; before `runMigrations()`, if `current < SCHEMA_VERSION` **and** a backup folder is configured:

```text
if pendingMigration and folderConfigured:
   run PRAGMA wal_checkpoint(TRUNCATE)        # fold -wal into the main file (Assumption 2)
   native.copyDatabaseFile(mainDbPath) -> folder as compendium-premigration-vNN-*.db
   (await it; block the migration, which already blocks boot, only this once per upgrade)
```

Recorded design tensions:
- **Format is a raw file copy, not a logical export.** The bundle exporter is compiled for the *new* schema; running it against the *old* on-disk schema would reference columns that do not yet exist. A byte copy is schema-agnostic and is exactly the "before" image. Restore of a `.db` snapshot is a file-replace followed by normal forward-migration replay on next boot. **This is the pre-migration design's one genuinely open question** (raw-copy vs a version-aware logical export); raw-copy is recommended at Medium confidence and flagged for Codex and the measurement in Assumption 2.
- **This is the one deliberate exception to "never during boot."** Routine backups run after a successful load; the pre-migration snapshot has no choice, because after the migration the old state is gone. It fires at most once per schema upgrade and the alternative is an unrecoverable migration.

### Restore, and its atomicity

Restore reads a bundle, shows a **preview before writing anything** ("3 profiles, 41 decks, 380 matches, from 14 March" - counts and `exportedAt`), then, on confirm:

```text
restore(bundle):
  gate: reject if bundle.app != 'compendium'
  gate: reject LOUDLY if bundle.schemaVersion > SCHEMA_VERSION      # criterion 3
  for each profileUnit in bundle.profiles:
     importOneProfile(profileUnit)   # existing re-key path, EXTENDED (below), one tx each
```

Two decisions the design makes explicit:

1. **Additive by default (re-key, never overwrite).** Each profile in the bundle becomes a **new** profile, preserving today's invariant that import never overwrites ([profileTransfer.js:73](../../src/store/profileTransfer.js#L73)). This is the safe default and needs no destructive confirm. A "replace everything on this device" mode is **deferred** (see the open decision) because wipe-then-restore is the one path that can lose current data, and it must be guarded by a forced pre-restore snapshot.
2. **`is_default` never creates two defaults.** The flag is carried in the bundle (criterion 7) but on an additive restore every imported profile is written with `is_default = 0`; `initProfiles()` keeps exactly one default on the next boot (Assumption 8). The carried value only matters for a future full-replace restore, where it reconstructs which profile was default; even then the boot invariant is the backstop.

**Orphan-profile fix ([DATA_MODEL.md:418](../../COMPENDIUM_DATA_MODEL.md#L418)):** `importOneProfile` creates the profile row inside the same `tx()` as its data, or, if `createProfile()` must run first for id allocation, deletes the profile on any failure so a failed restore leaves no empty husk.

### The native plugin surface (mirrors scanner/telemetry)

JS client `src/store/backupFolder.js`:

```js
import { registerPlugin } from '@capacitor/core';
const Backup = registerPlugin('Backup', {
  web: {                                  // graceful web fallback, like cardScanner.js:14
    pickFolder: async () => ({ available: false }),
    getFolder:  async () => ({ uri: null }),
    listBackups: async () => ({ files: [] }),
    writeBackup: async () => ({ ok: false }),
    readBackup:  async () => ({ text: null }),
    deleteBackup: async () => ({ ok: false }),
    copyDatabaseFile: async () => ({ ok: false }),
  },
});
```

Kotlin `BackupPlugin.kt` (thin bridge; logic and the persisted tree URI live in `BackupStore.kt`, so the bridge stays untestworthy like `TelemetryPlugin.kt`):

```kotlin
@CapacitorPlugin(name = "Backup")
class BackupPlugin : Plugin() {
  @PluginMethod fun pickFolder(call)      // ACTION_OPEN_DOCUMENT_TREE; takePersistableUriPermission; persist in BackupStore
  @PluginMethod fun getFolder(call)       // { uri, displayName } | { uri: null }
  @PluginMethod fun forgetFolder(call)    // releasePersistableUriPermission
  @PluginMethod fun listBackups(call)     // DocumentFile.listFiles() -> [{ name, size, modified }]  (the folder IS the state)
  @PluginMethod fun writeBackup(call)     // create document, write base64/text -> { name, bytesWritten }
  @PluginMethod fun readBackup(call)      // read a named document -> { base64 | text }
  @PluginMethod fun deleteBackup(call)    // delete a named document
  @PluginMethod fun copyDatabaseFile(call)// copy the app-private main DB file into the tree as a .db snapshot
}
```

Registered in `MainActivity` beside the other two ([MainActivity.java:15-16](../../android/app/src/main/java/com/sadkinglabs/compendium/MainActivity.java#L15)); forgetting the line compiles and ships and only fails at runtime with "plugin not implemented", so a bridge smoke test is part of Stage 3 verification (the lesson recorded in that file's comment). The `pickFolder` result arrives via `startActivityForResult`, so the plugin uses `@ActivityCallback`, the same Capacitor mechanism the scanner already uses for its Activity result.

---

## Implementation plan

Each stage leaves the repository releasable (§4.8) and is independently verifiable. Checkpoints (§12) after Stage 1 (a live data-loss fix that ships alone) and Stage 3 (the native/build fork).

**Stage 1 - Annotations/anchors fix, alone.** Self-contained, fixes a live data-loss bug, and blocks nothing downstream from being *correct*. No format version yet; still the per-profile bundle.
- Export `annotations`+`anchors` (re-keyed by a new `annMap`). Import them through the annotation model. Route bundle `highlights`/`legacy_highlights` rows through the same annotation-insert path (anchoring their text against the current doc canon exactly as `annotations.js:166-176` does), **not** into the dead `highlights` table, and **without** touching the global `highlights_migrated` flag.
- Fix [homeRepository.js:243-245](../../src/store/homeRepository.js#L243) to read `annotations` (kind='highlight'), consistent with [:322](../../src/store/homeRepository.js#L322). Report on the legacy-table read; do not leave the inconsistency.
- *Verify:* `test:query` round-trip - a profile with highlights exports and re-imports with every highlight rendering; a bundle carrying only legacy `highlights` rows imports as anchored annotations. Two-profile isolation.
- *Releasable:* yes - the existing export/import is simply more complete.

**Stage 2 - Bundle format v2, still on the manual share-sheet path.** Get a **correct, complete** backup before any scheduling machinery.
- All profiles in one bundle; `bundleFormat: 2`; read `schemaVersion` and refuse a newer bundle loudly; carry `is_default`; close the orphan-profile gap; gzip via `fflate`.
- Back-compat: importing a `bundleFormat` absent/1 bundle maps its single profile and its `highlights` onto one `profiles[]` unit's `legacy_highlights`.
- Wire `backup_rules.xml` + `data_extraction_rules.xml` and the manifest comment block (cheap, low-risk, makes `allowBackup` explicit).
- *Verify:* `test:query` - all-profiles round-trip; future-version bundle rejected; legacy single-profile bundle imported; mid-restore failure leaves the DB unchanged (orphan-profile fix).
- *Releasable:* yes - manual export/import is now complete and versioned; no native change ships yet except the inert XML.

**Stage 3 - SAF native plugin + folder picker.** The expensive, risky part, after the data model is proven.
- `BackupPlugin.kt` + `BackupStore.kt`, `registerPlugin` in `MainActivity`, `src/store/backupFolder.js` with the web fallback, Settings "Backup" section (pick folder, Back up now, Restore, status line), restore-preview modal.
- *Verify:* on-device - folder pick persists across force-stop and app update; write/read/list/delete against a real Drive folder; bridge smoke test (no "plugin not implemented"); restore preview and additive restore; web still falls back to share-sheet/file-picker.
- *Checkpoint* before this stage (native/build fork, §12).

**Stage 4 - Scheduler + rotation + pre-migration snapshot.** Near-trivial once a destination exists.
- `maybeBackup()` fire-and-forget after a successful load; the pure `retain()` function; write-and-verify-then-prune; change-hash gate; `lastBackupAt`/`lastBackupOk`; the pre-migration hook in `db.js` (gated on Assumption 2's measurement).
- *Verify:* `test:query` - `retain()` truth table over many synthetic filename sets; change-gate; on-device - a real schema-bump build produces a pinned snapshot before migrating, and the snapshot restores.

**Optional passphrase - recommended placement: fold the *format reservation* into Stage 2 and the *implementation* into Stage 4.** Stage 2's format already declares the `encryption` header and the encrypted envelope, so a v2 reader understands encrypted bundles from day one and never has to be revised for them. The actual PBKDF2/AES-GCM code, the passphrase UI, and "never downgrade to plaintext" land in Stage 4 beside the scheduler, because that is when unattended backups (the ones most likely to sit in a synced Drive folder) begin, which is when the opponent-name exposure becomes real. Justification recorded so the split is not re-questioned: reserving the fields early is free and prevents a format revision; building the crypto early would gold-plate a path (manual export) the user is present for.

---

## Data migration and compatibility

**No `SCHEMA_VERSION` bump (Assumption 1, High).** Every table this feature reads or writes already exists: `annotations`/`anchors` (v7), `is_default` (v3). `lastBackupAt`/`lastBackupOk` are app-global preferences ([ARCHITECTURE.md:144](../../COMPENDIUM_ARCHITECTURE.md#L144)), not `settings` rows, so they carry no schema or export weight and are deliberately not exported (same argument as `changelogSeenBuild`, [DATA_MODEL.md:68](../../COMPENDIUM_DATA_MODEL.md#L68)).

**Bundle-format compatibility.**

| Incoming bundle | Behavior |
|---|---|
| `bundleFormat` 2, `schemaVersion <= 9` | Import all profiles; re-key; anchor legacy highlights. |
| `bundleFormat` 2, `schemaVersion > 9` | **Refuse loudly** (criterion 3). Today it would silently drop unknown tables. |
| `bundleFormat` absent or 1 (legacy single-profile) | Import as one profile; its `highlights` become `legacy_highlights`; forward-only, as [profileTransfer.js:4](../../src/store/profileTransfer.js#L4) already promises. |
| `app != 'compendium'` | Reject, as today ([profileTransfer.js:74](../../src/store/profileTransfer.js#L74)). |
| Encrypted, wrong/absent passphrase | Fail loudly at decrypt; never partial-apply. |

**Pre-migration `.db` snapshot** is not a bundle; it is restored by file-replace and forward-migration replay, keeping migration forward-only.

**Idempotency and retry.** Restore re-keys ids ([profileTransfer.js:88-92](../../src/store/profileTransfer.js#L88)), so importing the same bundle twice yields two independent profiles, never a collision - the existing, tested property, extended to N profiles.

---

## Rollback and recovery

| Increment | Code rollback | Data consequence |
|---|---|---|
| Stage 1 | Revert `profileTransfer.js`/`annotations.js`/`homeRepository.js` | None to stored data. Reverting **re-opens** the highlight data-loss bug, so a revert is itself a regression to flag. |
| Stage 2 | Revert format code | A v2 bundle already written to a user folder cannot be read by a reverted app. Recorded as the point where an emitted artifact outlives the code. |
| Stage 3 | Revert plugin + Settings | A persisted SAF permission is orphaned harmlessly; no stored data touched. |
| Stage 4 | Revert scheduler/rotation/pre-migration hook | Existing backups remain valid files; only new-backup automation stops. |
| Restore action | n/a (a write) | Additive restore only **adds** profiles; the destructive full-replace mode is deferred precisely so no rollback claim rests on it. |

**Point of no return:** none introduced by this feature's own code. A restore is additive; a prune runs only after a verified write.

**Addressing the §12 irony head-on.** The constitution forbids claiming rollback after an irreversible migration without a verified backup path - and providing that path is the whole point of this feature. The honest state, recorded:
- Until **Stage 4** ships, forward-only migrations still have **no** backstop. This feature does not retroactively protect the migrations that ran before it existed.
- The pre-migration snapshot's restorability rests on Assumption 2 (Medium), an unverified on-device claim about WAL and file-copy consistency. **Until that measurement passes, the pre-migration snapshot must not be described to the user as a guaranteed recovery path.** A snapshot that cannot be cleanly reopened is a false promise, which is worse than an honest "no backstop yet."

---

## Verification plan

Mapped to the real gates: `npm run test:codex`, `npm run test:query`, `npm run test:ui`, `npm run build`, `npm run check:docs`.

**Browser-provable (`test:query`, pure logic - the bulk of the safety net):**
- `retain()` truth table: single file; three in one burst; daily for a month; one-per-week; empty; boundary crossings at week/month edges; pre-migration snapshots kept at 2 and pruned at 3; dedup where the newest satisfies all three tiers.
- Change-hash: identical content with different `exportedAt` hashes equal; any row change differs; encrypted-envelope salt/iv excluded.
- Format: all-profiles round-trip preserves every profile-owned table; `schemaVersion > local` rejected; legacy `bundleFormat` 1 imported; `app != 'compendium'` rejected.
- Annotations: a highlight made via `addAnnotation` survives round-trip and renders; legacy `highlights` rows import as anchored annotations without the global flag; two-profile isolation (no id of A under B).
- Restore atomicity: an injected failure mid-restore leaves the database exactly as before (orphan-profile fix).
- Crypto: encrypt then decrypt round-trips; wrong passphrase fails loudly; a requested-but-failed encryption never writes plaintext.

**Native, on device - required (invariant 8; a browser pass proves none of this):**
- Bridge smoke test: `Backup.getFolder()` resolves, not "plugin not implemented".
- SAF: pick a Drive folder; force-stop and relaunch - permission persists; app update - permission persists; write/read-back/list/delete a real bundle.
- Write-and-verify: kill the process mid-write; the prior backup still parses and no prune happened.
- Restore preview shows correct counts; additive restore adds profiles; `is_default` yields exactly one default after reboot.
- Pre-migration: a build that bumps `SCHEMA_VERSION` produces a pinned `.db` snapshot **before** migrating, and that snapshot reopens cleanly (Assumption 2).
- Airplane mode: back up to a local (non-synced) folder succeeds with no network; confirms offline-first.
- Web fallback: `npm run dev` - no crash; Settings shows the manual export path, not a dead folder picker.

**On-device measurements to report (not gates, but blocking their dependent designs):**
- `PRAGMA journal_mode` and whether `wal_checkpoint(TRUNCATE)` + file-copy reopens cleanly (Assumption 2 -> gates the pre-migration design).
- `/data/data/com.sadkinglabs.compendium/databases/*.db` size vs 25 MB (Assumption 5 -> informs the deferred catalog-split proposal; **not** acted on here).

**Accessibility:** the Settings section, restore-preview modal, and passphrase field need labels, 48dp targets, and legibility at 200% font scale; the restore confirm must be reachable and reversible by back.

---

## Security, privacy, performance, and operations

**Threat model.** The asset is a user's profile data; the sensitive sub-asset is **opponent names** in the match journal ([schema.js:151](../../src/store/schema.js#L151)), a social graph of non-consenting third parties. The new exposure the feature creates is a bundle leaving the UID sandbox into a user-chosen folder that a sync app may push to a third-party server.
- Mitigation: optional passphrase (PBKDF2 @600k -> AES-256-GCM) so the at-rest bundle in a synced folder is opaque; header stays cleartext only for identification, never content.
- The feature adds **no** network capability; the sync, if any, is another app the user already trusts with that folder.
- Auto Backup (Option F) uploads the plaintext DB to Google's cloud, E2E-encrypted with the device PIN on Android 9+; it is not passphrase-protectable and is therefore explicitly not the privacy boundary - our encrypted SAF bundle is.

**Input validation.** A restored bundle is untrusted input ([FEATURE_MATRIX.md:27](../../COMPENDIUM_FEATURE_MATRIX.md#L27), [ARCHITECTURE.md:156](../../COMPENDIUM_ARCHITECTURE.md#L156)). The existing guards carry forward and extend: `sanitizeBlockConfig` on dashboard `urls` ([profileTransfer.js:137](../../src/store/profileTransfer.js#L137)), `safeHref` on `curiosa_url` ([profileTransfer.js:99](../../src/store/profileTransfer.js#L99)), `normalizeDurationSec` on match duration ([profileTransfer.js:132](../../src/store/profileTransfer.js#L132)). New surface to validate: annotation `comment`/`color` and anchor `quote_*` fields are inserted parameterized (never interpolated), so the quote-unaware native splitter ([db.js:152](../../src/store/db.js#L152)) cannot be reached; a hostile bundle is a data problem, not an injection one.

**Performance.** Bundle build is a handful of `SELECT`s per profile (the current export cost, [profileTransfer.js:31-62](../../src/store/profileTransfer.js#L31)) times N profiles; gzip and optional crypto are one-off over a few MB. The scheduler is fire-and-forget after load and never blocks first paint (the `reconcile()` discipline, [telemetry.js:83](../../src/store/telemetry.js#L83)). The one deliberate boot cost is the pre-migration snapshot, once per schema upgrade. All performance claims to be measured against the device baseline, not asserted (§4.7).

**Operations.** No new dependency, no BoM, no `google-services` interaction. The SAF permission is user-granted at runtime, not a manifest `uses-permission`, so the forbidden-permission gate ([build.gradle:182](../../android/app/build.gradle#L182)) is unaffected. `distribute.mjs` is untouched.

---

## Documentation impact

Per AGENTS §5 and constitution §13. Every source-of-truth document assessed.

| Document | Disposition |
|---|---|
| `COMPENDIUM_DATA_MODEL.md` | **Update.** §12 "Current transfer gaps" (lines 412-420) - all three close; document bundle format v2, the all-profiles shape, the version gate, and the pre-migration snapshot. §14 recovery gains the concrete backstop. |
| `COMPENDIUM_FEATURE_MATRIX.md` | **Update.** Line 181 "Profile transfer - Partial" moves to Implemented once Stage 2 lands; add a new "Backup and restore" capability row (folder, schedule, retention, restore preview), modeled on the diagnostics row at line 187. |
| `COMPENDIUM_ARCHITECTURE.md` | **Update.** §4.C: a third native plugin (`Backup`) and the SAF runtime posture; `lastBackupAt`/`lastBackupOk` as app-global keys (line 144 already anticipates `lastBackupAt`). §4.D recovery gains the pre-migration snapshot. |
| `BUILD.md` | **Update.** How to verify the plugin on a device; the folder-pick flow; the two on-device measurements; the `backup_rules.xml`/`data_extraction_rules.xml` posture beside the existing telemetry/manifest section. |
| `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` | **Reviewed - no change required.** Process is unchanged; this is a feature under the existing governance. |

`npm run check:docs` must pass (schema version unchanged, links resolve, no superseded terminology).

---

## Risks and unanswered questions

| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | Pre-migration `.db` copy is inconsistent under WAL, so the backstop is a false promise (Assumption 2) | Med | **High** | Measure `journal_mode`; checkpoint-then-copy; do not advertise it as guaranteed until measured | Claude |
| 2 | On-device DB already exceeds the 25 MB Auto Backup quota, so Option F silently backs up nothing (Assumption 5) | Med | Med | Measure; if so, our SAF backups are the real mechanism and the catalog-split is a separate proposal | Owner |
| 3 | Full-replace restore (deferred) ships later and wipes current data on a mis-tap | Low (deferred) | **High** | Deferred; when built, force a pre-restore snapshot + a destructive confirm | Owner |
| 4 | A v2 bundle in a user folder outlives a reverted app and cannot be read | Med | Low | Format is additive and versioned; document the one-way step | Claude |
| 5 | Retention deletes a file the user still wanted (time-to-notice underestimated) | Low | Med | Change-gate keeps distinct states; tiers span 2 months; pre-migration pins are exempt | Claude |
| 6 | Passphrase forgotten -> encrypted backup unrecoverable | Med | Med | Default off; copy states plainly that a forgotten passphrase cannot be recovered | Owner |
| 7 | SAF folder deleted/moved by the user out from under the persisted URI | Med | Low | `listBackups` tolerates a vanished tree; Settings prompts to re-pick; the folder is the state, so a re-pick re-reads it | Claude |
| 8 | Two devices syncing one folder write conflicting filenames | Low | Low | Filenames carry timestamp+hash, so writes do not collide; retention is per-listing and self-heals | Claude |

**Decisions still required from the human** (surfaced deliberately rather than assumed):

1. **Restore semantics for a device that already has profiles.** The design ships **additive** (add all bundle profiles alongside existing, never overwrite) and **defers** a "replace everything" mode. Confirm additive-only for v1, or authorize the destructive full-replace mode (which then requires a forced pre-restore snapshot and a hard confirm). This is the single highest-consequence open decision.
2. **Pre-migration snapshot format:** raw `.db` file copy (recommended, Medium) versus a version-aware logical export. Depends on Assumption 2's measurement; wants a Codex read.
3. **The prompt trigger** ("something to lose"): first deck saved, or first cards logged, or either. Minor UX; a settings toggle exists regardless.
4. **Plaintext file shape:** `.json.gz` vs an uncompressed `.json` with a gzip-inside envelope. Minor; recommended `.json.gz`/`.enc` by extension.

---

## Self-Critique

**The strongest case this design is wrong.** The feature's reason to exist is recovery, and its recovery guarantee is the weakest-verified thing in it. The tiered retention, the format, the plugin - all are provable in a browser or on a bench. But "you can get back to before a bad migration" rests on Assumption 2, a Medium-confidence, unverified claim that a WAL database file-copied after a checkpoint reopens cleanly on another device. If that is false, Stage 4 ships a pinned snapshot that cannot be restored, and the one invariant this whole proposal was written to backstop (§3.4) is protected by a file that does not work. The mitigation - "do not advertise it until measured" - is honest but it means the headline benefit is provisional. A reviewer should treat the pre-migration snapshot as unproven until the device measurement lands, and should be suspicious that I have designed elaborate retention around a recovery artifact I have not yet confirmed is recoverable.

**The highest-consequence assumption if false.** Assumption 1 (no `SCHEMA_VERSION` bump). I have asserted it from reading which tables exist, but if annotations round-tripping turns out to need any new column - a per-annotation import provenance, say, or a column to distinguish an orphaned-on-import annotation from an orphaned-in-use one - the feature acquires its own forward migration, and a backup feature that itself migrates the schema is exactly the recursive hazard §12 warns about. I believe it holds, but it is the assumption whose failure most changes the shape of the work.

**The simpler alternative I may be dismissing unfairly.** Do Stage 1 and Stage 2 only, ship the manual all-profiles export through the existing share sheet, and stop. That closes the live data-loss bug and gives every user a complete, versioned, restorable backup with **zero native code, zero SAF, zero scheduler, zero retention** - which is where all the risk and most of the cost live. The honest case for the full design is that a manual backup nobody remembers to run is a backup that does not exist when the phone drops, and the pre-migration snapshot needs an automatic destination to fire. But if the owner's real need is "stop losing my highlights and let me get my data off the phone," Stages 1-2 meet it, and Stages 3-4 are a large investment in *unattended* backup that should be justified on its own, not carried by the data-loss fix. I would not object if the owner took Stages 1-2 now and treated 3-4 as a separate decision.

**Coupling I might have missed.** The pre-migration hook reaches into `db.js`'s boot path ([db.js:20-45](../../src/store/db.js#L20)), which is the most load-bearing, least-modified code in the store. Adding an awaited native call before `runMigrations()` couples first-paint latency and the backup plugin's availability to database open. If the plugin bridge is slow, absent, or hangs, it now sits in front of the schema upgrade, which sits in front of boot. That is the opposite of the "never block first paint" discipline everywhere else, justified only by "once per upgrade" - and a bug that makes it fire every boot would be a silent boot-time regression that no `test:query` can see, because none of them run the native plugin.

**The failure most likely to escape the tests.** Everything genuinely dangerous is native and manual: SAF permission persistence across an app update, the write-then-verify race under a real process kill, and the pre-migration snapshot on an actual schema-bump build. These are the tedious device tests that get skipped when the diff looks finished, and their failure mode is invisible until the day someone needs the backup - the worst time to discover it does not restore. The `retain()` unit tests will be green and comprehensive and will prove nothing about whether a single byte ever safely left the device.

**Evidence that would change the decision.**
- Assumption 2 fails (WAL copy does not reopen) -> pre-migration snapshot redesigns to a logical export or is cut from v1.
- Assumption 1 fails (a column is needed) -> the feature acquires a migration and re-enters §12 with its own snapshot-before-self hazard.
- Owner wants only the data-loss fix and manual export -> ship Stages 1-2, defer 3-4 to a separate proposal.
- Assumption 5 shows the DB over quota -> the catalog-split proposal becomes a prerequisite for Auto Backup being real, though it does not block our SAF path.

---

## Approval record

| Gate | Disposition | Date |
|---|---|---|
| Proposal review (Codex) | Pending | - |
| Architecture approval (human) | Pending | - |

Decisions recorded as settled (do not re-raise): SQLCipher killed (D); `allowBackup` stays true with both rules files (F); passphrase optional/default-off, PBKDF2->AES-GCM, never silent plaintext (I); SAF destination (C); all-profiles bundle with old single-profile back-compat (N); change-gated tiered GFS retention with pinned pre-migration snapshots (L); write-and-verify before prune; filenames are the state, no sidecar index; scheduler after load, not during boot (pre-migration snapshot the one exception).

Decisions requested (see Risks): restore additive-only vs authorize full-replace; pre-migration snapshot format; prompt trigger; plaintext file shape.
