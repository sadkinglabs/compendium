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

### `android-16kb-compat` - DO NOT MERGE

**Status:** superseded. Its single useful commit was cherry-picked onto `card-recogniser` and is now in
`main`; the branch itself diverged before later scanner work, so merging it would REGRESS the scanner.
**Next step:** delete it.

### `catalog-update-pipeline` - catalog drop + one-command update process

**Status:** PARKED since 2026-07-17 with ~30 unmerged commits. The oldest orphan; confirm it is still
wanted before investing.
**Next step:** review what remains relevant (README, `.gitignore` hardening for signing secrets, catalog
recovery runbook), then either finish and merge or close it out deliberately.

## Post-merge follow-ups (card recogniser, agreed with Codex)

Merged to `main` 2026-08-09. None of these blocks release of what shipped, but each is owed:

- **Sealed auto-confirm evidence.** The bar is fixed and finite: >= 150 independent auto-confirmed capture
  sessions with ZERO wrong identities, >= 75% auto-confirm coverage, >= 30 invalid/multi-card scenes with
  zero auto-confirms, sessions as the unit, thresholds frozen before the sealed set is opened. Sealed v1 was
  consumed as development data, so this needs a fresh collection. Until it exists, auto-confirm ships on a
  reasoned rule plus device evidence, not a measured false-confirm bound.
- **Accessibility matrix** - TalkBack, reduced motion and short layouts on device. Semantics and
  reduced-motion paths are written but unverified by a real screen reader.
- **Release peak-memory measurement** on the signed build.
- **Licences and attribution** for DINOv2 (Apache-2.0) and ONNX Runtime.
- **Capacitor 8** - closes `libsqlcipher.so`, the last library failing the 16 KB check. High-risk: a major
  SQLite plugin upgrade against a live v11 schema holding real user data.

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
