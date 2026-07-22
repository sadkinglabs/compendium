# Codex review request - art-CDN Phase 1 (narrow final correction)

**Branch:** `art-cdn` (tip = latest commit). The rev-6 DESIGN is approved (do not reopen). This is the
narrow final correction to your "should move directly to approval" disposition: the `--limit`/repair
recovery bug is fixed, the CLI composition seam and worker-settlement are now mutation-checked, the
small hardenings are in, and **the live mutating `--check` canary was run and passes**. Phase 1 stays
**dormant** (stages + can publish additively; no catalog promote, no app change).

## Live canary result (the specific ask)

`node scripts/catalog/cdn-upload.mjs --check` **PASSES against real R2**: PUT ETag==MD5, a conflicting
conditional PUT (`If-None-Match: *`) **412s and the original survives** (overwrite protection is truly
enforced by the bucket), listing matches, public GET + content-type + immutable cache + body verified.
It also **caught a real bug** first: R2's ListObjectsV2 XML entity-encodes the ETag (`&quot;`), which
`list()` was not decoding - the audit would have failed on a phantom mismatch. Fixed and regression-tested
(`r2Client.test.mjs` now uses `&quot;`-encoded ETags). Real uploader dry run: `3087 to upload, 0 conflicting`.

## Range

```
git fetch origin && git checkout art-cdn
git diff 1b4d451..art-cdn                 # this correction (review this)
git diff acc16f4..art-cdn                 # the whole Phase-1 implementation, for context
```

## How this disposition was addressed

- **Major (`--limit` strands repair):** `runUpload` now refuses a finite `--limit` combined with
  `--repair-conflicts` when there are conflicts, **before any staging read or PUT** - repoints must be
  produced as one complete set. Two-conflict regression asserts rejection, no `readStaged`, only the
  plan listing (no PUT/HEAD), and no repair object created.
- **Minor (wiring test one layer early):** extracted `runCli({argv,env,signedFetch,plainFetch,
  readManifest,makeReadStaged,hashMd5,log})`; `main()` supplies only real deps. A composition test
  drives `runCli` with one manifest entry and asserts the observed request carries `If-None-Match: *` -
  so replacing `runUpload` with a bypass, or dropping the header, fails it.
- **Minor (settlement not proven):** the new counterfactual starts a slow sibling that flips
  `settled=true` only on completion and a second worker that rejects immediately, then asserts
  `activeWorkers===0` and `settled===true` after rejection. **Mutation-verified**: reverting `mapPool`
  to fail-fast `Promise.all` makes this test fail (checked, then restored).
- **Hardening:** staging uses `writeFileSync(tmp, buf, {flag:'wx'})` (exclusive create, full-buffer
  write, `finally` cleanup - no handle bookkeeping); `--limit` is parsed with `/^[1-9]\d*$/` so `1.5`
  is rejected, not silently truncated to 1.

## Previous increment (orchestration + evidence, for context)

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

`npm run test:catalog` **107 pass**, `check:cycles`, `check:types`, `check:docs`, production build, and
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
