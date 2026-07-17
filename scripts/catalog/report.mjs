// Human-readable run report. A non-engineer should be able to read this and know
// what changed and whether it is safe to ship.
const list = (arr, n = 12) => {
  const a = arr || [];
  if (!a.length) return 'none';
  return a.slice(0, n).join(', ') + (a.length > n ? ` … (+${a.length - n})` : '');
};

export function formatReport(r, { dryRun = false } = {}) {
  const L = [];
  L.push('');
  L.push(dryRun ? '=== Catalog update DRY RUN (nothing written) ===' : '=== Catalog update ===');
  if (r.cards) {
    L.push(`Cards:      ${r.cards.total} total  (+${r.cards.added.length} new, ${r.cards.updated.length} updated, ${r.cards.localOnly.length} local-only)`);
    if (r.cards.added.length) L.push(`  new:      ${list(r.cards.added)}`);
    if (r.cards.localOnly.length) L.push(`  local-only (kept, not on API): ${list(r.cards.localOnly)}`);
  }
  if (r.errata != null) L.push(`Errata:     ${r.errata} cards whose rules text begins UPDATED`);
  if (r.rules) {
    L.push(`Rules:      ${r.rules.articles} articles + ${r.rules.subentries} sub-entries  (+${r.rules.newArticles.length} new articles, +${r.rules.newSubs.length} new sub-entries)`);
    if (r.rules.removedArticles.length) L.push(`  removed article ids (marginalia may target these): ${list(r.rules.removedArticles)}`);
    if (r.rules.removedSubs.length) L.push(`  removed sub-entry ids: ${list(r.rules.removedSubs)}`);
  }
  if (r.faqs) L.push(`FAQs:       ${r.faqs.faqs}${r.faqs.unresolved?.length ? `  (${r.faqs.unresolved.length} UNRESOLVED)` : ''}`);
  if (r.linkGraph != null) L.push(`Link graph: ${r.linkGraph} edges (byte-reproduction gate PASSED)${r.newLinkGraphEdges != null ? `; new corpus ${r.newLinkGraphEdges}` : ''}`);
  if (r.codex) L.push(`Codex:      ${r.codex.docs} docs, ${r.codex.blocks} blocks, ${r.codex.faqs} faqs (recompiled, invariants OK)`);
  if (r.images) {
    L.push(`Images:     ${r.images.converted} webp planned  (${r.images.keptFoilOnly} foil-only kept, ${r.images.droppedFoilDupes} duplicate foils dropped, ${r.images.skippedReverse} reverse faces skipped)`);
    if (r.images.noScan.length) L.push(`  no scan (will show generated art): ${r.images.noScan.length} - ${list(r.images.noScan, 6)}`);
    if (r.images.unmatchedScans.length) L.push(`  scans matching no printing: ${r.images.unmatchedScans.length} - ${list(r.images.unmatchedScans, 6)}`);
  }
  if (r.warnings?.length) { L.push('Warnings:'); for (const w of r.warnings) L.push(`  ! ${w}`); }
  L.push('');
  if (dryRun) {
    L.push('Dry run only: no files were written and no promotion was performed.');
  } else {
    L.push('Next: review `git diff`, add a changelog entry, bump the build on install (see BUILD.md).');
  }
  L.push(r.ok === false ? 'RESULT: STOPPED (see errors above)' : 'RESULT: OK');
  return L.join('\n');
}
