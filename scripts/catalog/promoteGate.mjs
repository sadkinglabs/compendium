// PUBLISH-BEFORE-PROMOTE gate. After Phase 5 there is no bundled art fallback, so a catalog may be
// promoted ONLY once every object its manifest references is published on R2 and a whole-manifest audit
// is green. This module is the pure orchestration over injected seams (the R2 upload runner, a repoint
// fold, a regenerate, and the journaled promote), so the exact ordering and the fail-closed
// counterfactuals are unit-tested - update-catalog's main() supplies the real network + disk.
//
// Contract enforced here:
//   - build -> validate (caller) -> UPLOAD + whole-manifest AUDIT -> stage + journaled PROMOTE.
//   - promote() is called AT MOST ONCE, and ONLY on a green whole-manifest audit.
//   - a conflicting remote object fails BEFORE promotion (no journal, no committed catalog change).
//   - a partial (--limit) upload cannot promote.
//   - repair may proceed ONLY by folding its replacement keys back into the prospective manifest,
//     regenerating the catalog, and re-auditing - never by promoting an un-audited repointed manifest.

/**
 * @param manifest    the prospective art manifest (the object this run would ship)
 * @param gen         the built+validated generation for `manifest`
 * @param uploadOnce  async ({ manifest }) -> runUpload result (real R2 client in prod; a fake in tests)
 * @param repoint     (manifest, repoints) -> manifest'   (apply from->to key repoints; pure)
 * @param regen       (manifest') -> { manifest, gen }     (rebuild the generation from a repointed manifest)
 * @param promote     ({ manifest, gen }) -> void          (stage + journaled promote; the ONLY promote)
 * @param maxRounds   bound on the repair fold loop (a non-converging repair must fail, not spin)
 * @returns { manifest, gen, res } on a promoted release; throws (no promote) otherwise.
 */
export async function publishThenPromote({ manifest, gen, uploadOnce, repoint, regen, promote, log = () => {}, maxRounds = 4 }) {
  let m = manifest;
  let g = gen;
  for (let round = 0; round <= maxRounds; round += 1) {
    const res = await uploadOnce({ manifest: m });
    if (res.refusedConflicts) {
      throw new Error(`${res.refusedConflicts.length} conflicting remote object(s) - nothing promoted. Rerun with --repair-conflicts (create-only; never overwrites).`);
    }
    if (res.counts && res.counts.failed) {
      throw new Error(`${res.counts.failed} upload(s) failed - nothing promoted.`);
    }
    if (res.remaining > 0) {
      throw new Error(`${res.remaining} object(s) still pending (a --limit batch) - a partial upload cannot promote. Re-run without --limit.`);
    }
    if (res.auditDeferred === 'repoints') {
      if (round >= maxRounds) throw new Error('repair did not converge - nothing promoted.');
      log(`  folding ${res.repoints.length} repair repoint(s) into the prospective manifest and regenerating…`);
      m = repoint(m, res.repoints);          // new content keys for the repaired objects
      ({ manifest: m, gen: g } = regen(m));  // cards.json + the version hash follow the repointed keys
      continue;                              // re-audit the repointed manifest (repair objects already PUT)
    }
    if (!res.audit || !res.audit.ok) {
      const n = res.audit && res.audit.problems ? res.audit.problems.length : 'no';
      throw new Error(`remote audit failed (${n} problem(s)) - nothing promoted.`);
    }
    promote({ manifest: m, gen: g });        // GREEN whole-manifest audit: the single promote
    return { manifest: m, gen: g, res };
  }
  /* unreachable: the loop returns or throws each round */
  throw new Error('publishThenPromote: exhausted repair rounds without a decision.');
}

/**
 * --recover: an interrupted promote must not be finished until the remote is RE-AUDITED against the
 * staged manifest, so a recovery can never resurrect a catalog whose art is not fully published. A
 * failed or unavailable audit leaves the journal pending.
 * @param stagedManifest  the manifest from the interrupted run's staging tree
 * @param auditOnce       async ({ manifest }) -> { ok, problems? }   (list + whole-manifest audit; NO upload)
 * @param recover         () -> recover result   (finishes the journaled promote)
 */
export async function recoverWithAudit({ stagedManifest, auditOnce, recover, log = () => {} }) {
  const audit = await auditOnce({ manifest: stagedManifest });
  if (!audit || !audit.ok) {
    const n = audit && audit.problems ? audit.problems.length : 'no';
    throw new Error(`recover: remote audit failed (${n} problem(s)) - the journal stays pending, nothing recovered.`);
  }
  log('recover: remote audit green; finishing the staged promotion.');
  return recover();
}

/** Apply repair repoints (from-key -> to-key) to a manifest's object keys. Pure; returns a new manifest. */
export function repointManifest(manifest, repoints) {
  const map = new Map(repoints);
  const objects = {};
  for (const [slug, e] of Object.entries(manifest.objects)) {
    objects[slug] = map.has(e.key) ? { ...e, key: map.get(e.key) } : e;
  }
  return { ...manifest, objects };
}
