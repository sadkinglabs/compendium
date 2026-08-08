# Work in flight

The ledger of **unmerged branches** - what each one is, where it stopped, and what it needs to finish.
Git records what changed; this records **what is left and how to resume**. Without it, a branch that was
"paused for one quick thing" becomes an orphan nobody can safely delete or restart.

**Keep it honest:**

- Add a row when a branch starts; delete the row when it merges to `main`.
- Update **Next step** whenever work pauses - that is the whole point of the file.
- Verify before trusting: `git log --oneline main..<branch>` shows a branch's unique commits, and
  `git merge-base --is-ancestor <a> <b>` proves whether one branch is already contained in another.
- A branch fully contained in another (0 unique commits) is safe to delete; say so in **Status**.

## Open

### `card-recogniser` - snapshot card scanner (image recognition + OCR)

**Status:** feature-complete and device-validated; housekeeping outstanding. Contains all of
`scanner-phase2a` (verified: 0 unique commits there, so that branch is safe to delete).
**Built:** pure-snapshot scanner (one-tap capture -> card-aware crop -> DINOv2-small int8 visual match ->
OCR promotes/offers the named card -> user confirms -> existing result sheet); in-scanner search-by-name;
correction-driven on-device hardening (a confirmed card the index ranked wrong stores its embedding as a
user prototype, persisted, vectors never pixels); gilt shutter + violet reading arc.
**Done since:** reveal choreography (Gilt Impression stamps the captured still) and automatic confirmation
when the visual index and OCR independently name the same card - 9 of 10 device scans now skip the pick
list; search-field focus fix; the OCR-strip era pipeline and its reliability harness retired (nothing in
production referenced them; ~1,500 lines out); as-built deviations recorded and superseded prose
consolidated in the Rev 6 proposals.
**Next step:** send the as-built deviations to Codex for review (two relax rules it set: OCR may OFFER a
card outside the visual pool, and dual-signal agreement auto-confirms without the sealed false-confirm
bound). Then measure the signed-release APK, and merge. Still owed long-term: a fresh sealed corpus and
the false-confirm bound that would properly authorise auto-confirmation.
**Docs:** `docs/proposals/card-recogniser-*.md` (Rev 6 + its interaction design are authoritative).

### `android-16kb-compat` - Android 16 KB page-size compatibility

**Status:** 6 of 7 native libraries fixed. Branched from `card-recogniser`, so it carries the scanner too.
**Built:** minSdk 22 -> 29 (below 23 AGP force-compresses native libs, which fails the check), release ABI
narrowed to `arm64-v8a`, CameraX 1.3.4 -> 1.4.1, ONNX Runtime 1.20.0 -> 1.22.0. Verified with
`zipalign -c -P 16` plus an ELF `PT_LOAD` alignment check.
**Next step:** `libsqlcipher.so` is still 4 KB-aligned. It comes from `@capacitor-community/sqlite` 6.0.2,
which pins the legacy `net.zetetic:android-database-sqlcipher:4.5.3`. Substituting the modern artifact
directly does NOT work (different package namespace; it crashes at startup - already tried and reverted).
The fix is the Capacitor 8 upgrade below.

### `catalog-update-pipeline` - catalog drop + one-command update process

**Status:** PARKED since 2026-07-17 with ~30 unmerged commits. The oldest orphan; confirm it is still
wanted before investing.
**Next step:** review what remains relevant (README, `.gitignore` hardening for signing secrets, catalog
recovery runbook), then either finish and merge or close it out deliberately.

## Planned, not started

### Capacitor 6 -> 8 upgrade

**Why:** closes the last 16 KB library. `@capacitor-community/sqlite` 8.1.1 uses the aligned
`net.zetetic:sqlcipher-android:4.17.0`; every plugin in use has a current v8 release.
**Requires:** Java 21, compileSdk 36, minSdk >= 24 (already 29), AGP/Gradle bumps.
**Risk:** High - a major upgrade of the SQLite plugin against a live v11 schema holding real user data.
Touches the durable-write and forward-only-schema invariants. Needs a proposal, its own branch, a device
database backup, and post-upgrade verification that collection, decks and matches all still read.

## Retired

- `scanner-phase2a` - OCR scanner hardening. Fully absorbed into `card-recogniser`; safe to delete.
