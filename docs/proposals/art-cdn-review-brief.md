# Codex review request - art-CDN Phase 1 (orchestration + evidence increment)

**Branch:** `art-cdn` (tip = latest commit). The rev-6 DESIGN is approved (do not reopen). This
increment closes your latest Changes-required disposition: the uploader now executes its plan, the
production R2 path is executable-tested, staging uses a unique-temp lifecycle, and the docs are
reconciled. Phase 1 stays **dormant**: it converts + durably stages + can publish objects additively,
but promotes no catalog and changes no app behavior.

## Range

```
git fetch origin && git checkout art-cdn
git diff fb33ddc..art-cdn                 # this increment (review this)
git diff acc16f4..art-cdn                 # the whole Phase-1 implementation, for context
```

## How the disposition was addressed

- **Major (uploader ignored its plan):** the orchestration now executes **only `plan.put`** (plus
  `plan.conflicts` when `--repair-conflicts`) and **never reads staging or claims for a valid skip** -
  so an incremental drop whose remote object is valid but whose local staging was deleted just skips.
  Plan rows carry `{slug, entry}`. `--limit` caps **pending** work (validated positive integer) and
  repeated limited runs advance; the whole manifest is audited on the final (full-coverage) run.
- **Major (production safety boundary untested):** the network adapter and orchestration are extracted
  into importable modules - `r2Client.mjs` (request shapes over an injected `signedFetch`) and
  `uploadRunner.mjs` (plan execution). New tests drive the **real request sequence** against a fake
  client that models R2's conditional semantics: a create is a conditional PUT (`If-None-Match: *`),
  a 412 goes to HEAD, matching reuses, conflicting repairs/refuses, a 412->404 retries, and a **dry run
  issues zero PUT/HEAD**. A production-wiring test (`cdn-upload.test.mjs`) proves the CLI's own
  `buildClient` sends `If-None-Match: *` (no bypass). `--check` gains a **convergent** canary: it PUTs
  different bytes at the canary key with `If-None-Match: *`, requires a 412, and HEADs to prove the
  original survived - so it fails closed if the bucket does not actually enforce overwrite protection.
- **Major (temp lifecycle):** `convertFresh` writes through an **attempt-unique** temp
  (`cdn-art/.tmp/<slug>.<pid>.<seq>.tmp`) created **exclusively** (`wx`) and removed in `finally`;
  `mapPool` now awaits **all started workers to settlement** before rejecting and stops pulling new
  work on the first failure (a gated-concurrency test and a worker-failure test prove no conversion
  starts after a failure is observed).
- **Minor (docs):** `BUILD.md`, the `update-catalog.mjs` header, `CATALOG_DROP/README.md`, and
  `COMPENDIUM_ARCHITECTURE.md` now state the migration-dormant behavior (stage + prospective manifest,
  no promote) instead of the old "promotes / dry-run writes nothing"; this brief's stale counts and the
  now-closed "staging missing" note are removed.

## Gates

`npm run test:catalog` **104 pass**, `check:cycles`, `check:types`, `check:docs`, production build, and
the **real `npm run update:catalog -- --dry-run`** (3087 objects; 5 no-scan; 4 unmatched; 3 reverse
faces) all green. No `src/` app code touched.

## Where to attack

- **Plan execution:** can any code path still read staging or PUT for a `skip`? Does `--limit` ever
  re-slice the same prefix instead of advancing?
- **Adapter wiring:** is the conditional PUT truly on every create in production (not just the fake)?
  Does the 412->HEAD->reuse/conflict/retry sequence hold under the injected client's races?
- **Temp lifecycle:** can two concurrent runs collide on a temp, or a rejection be observed while a
  worker is still writing staging?
- **Convergent canary:** does it actually fail closed against a bucket with overwrite protection off?

## Not in scope (Phase 2+)

The atomic activation (runtime seam + `artCache`/`ArtImage` + 14 bypass sites, real upload, catalog
repoint + version bump + remote audit), Phase 3 pack + backup, Phase 5 unbundle, Phase 6 card sheet.
