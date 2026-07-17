// Assemble a COMPLETE catalog generation from the drop + API, in memory, plus the
// helpers to serialise it to staging in each file's exact committed format and to
// hash it for the idempotent version gate. Kept separate from the orchestrator so
// both the dry run (report only) and the real run (write + promote) build the same
// generation the same way.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeCatalog, errataCount } from './curiosa.mjs';
import { compileRules } from './rules.mjs';
import { compileFaqs } from './faqs.mjs';
import { regenerateLinkGraph, assertReproducesCommitted } from './linkGraph.mjs';
import { planImages } from './images.mjs';
import { compileCorpus } from '../codex/compile.mjs';
import { cardSlug } from './slug.mjs';

// Per-file serialisers, each matching the committed on-disk format exactly (line
// endings are handled by git autocrlf, so these emit LF):
//   cards.json                minified, raw UTF-8
//   faqs.json                 2-space, raw UTF-8
//   articles / link_graph     2-space, ASCII-escaped (\uXXXX) like Python ensure_ascii
//   codex_documents.json      minified + trailing newline (matches compile-codex.mjs)
const asciiEscape = (s) => s.replace(/[-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
export const serializeCards = (obj) => JSON.stringify(obj);
export const serializeFaqs = (arr) => JSON.stringify(arr, null, 2);
export const serializeArticles = (arr) => asciiEscape(JSON.stringify(arr, null, 2));
export const serializeLinkGraph = (arr) => asciiEscape(JSON.stringify(arr, null, 2));
export const serializeCodex = (output) => JSON.stringify(output, null, 0) + '\n';
export const serializeVersion = (obj) => JSON.stringify(obj, null, 2) + '\n';
export const serializeSetCatalog = (obj) => JSON.stringify(obj, null, 2) + '\n';   // set code -> name (src/store/setCatalog.json)

/**
 * Build the full generation from loaded inputs. Throws on any hard gate:
 * link-graph reproduction, merge gates, and codex compiler invariant issues.
 * @returns { cards, articles, faqs, linkGraph, codex, imagePlan, hash, warnings, report }
 */
export function buildGeneration({
  currentCards, currentArticles, currentFaqs, committedLinkGraph, apiCards, rulesCsvText, faqCsvText, dropPngNames,
}) {
  // Cards
  const merge = mergeCatalog(currentCards, apiCards);
  const validCardIds = new Set(Object.keys(merge.cards).map(cardSlug));

  // Rules
  const rules = rulesCsvText
    ? compileRules(rulesCsvText, currentArticles)
    : { articles: currentArticles, report: { articles: currentArticles.length, subentries: currentArticles.reduce((n, a) => n + (a.subentries || []).length, 0), newArticles: [], newSubs: [], removedArticles: [], removedSubs: [], issues: [] } };

  // FAQs (a drop without a FAQ CSV keeps the current faqs)
  const faqs = faqCsvText
    ? compileFaqs(faqCsvText, validCardIds)
    : { faqs: currentFaqs || [], report: { faqs: (currentFaqs || []).length, unresolved: [], issues: [] } };
  const faqList = faqs.faqs;

  // Link graph: hard gate on the CURRENT inputs, then regenerate for the new corpus.
  const committedEdges = assertReproducesCommitted(currentArticles, committedLinkGraph);
  const linkGraph = regenerateLinkGraph(rules.articles);

  // Images: plan (annotates cards with per-printing + default image fields).
  const imagePlan = planImages(merge.cards, dropPngNames);
  const cards = imagePlan.cards;

  // Codex documents: recompile from the NEW articles/cards/faqs (pure). This is the
  // compiled artifact the app reads; a real run that changed the inputs but not this
  // would ship a stale codex and fail compile:codex --check.
  const { report: codexReport, ...codexOutput } = compileCorpus({
    articles: rules.articles,
    cards: Object.values(cards),
    faqs: faqList || [],
  });
  if (codexReport.issues.length) {
    throw new Error(`codex compiler invariant issue(s), refusing to promote a broken codex:\n  - ${codexReport.issues.slice(0, 20).join('\n  - ')}`);
  }

  const warnings = [
    ...rules.report.issues,
    ...faqs.report.issues,
  ];

  // Set code -> display name, straight from the merged catalog's set data. Written to
  // src/store/setCatalog.json so the runtime's set names are DATA, not hardcoded - a
  // new set's name arrives with its cards, no source edit. (Order is derived from the
  // numeric code at runtime; see src/store/sets.js.)
  const setCatalog = Object.fromEntries((merge.report.sets || []).map((s) => [s.code, s.name]));

  // Deterministic content hash over the exact serialised generation + codex buildHash
  // + the sorted image manifest. Same inputs -> same hash -> a re-run is a no-op. The
  // set catalog is NOT hashed: a new/renamed set always arrives with card changes,
  // which already move the hash, so hashing it too would only risk a spurious bump.
  const hash = createHash('sha256')
    .update(serializeCards(cards)).update('\0')
    .update(serializeArticles(rules.articles)).update('\0')
    .update(faqList ? serializeFaqs(faqList) : '').update('\0')
    .update(serializeLinkGraph(linkGraph)).update('\0')
    .update(imagePlan.manifest.join('\n')).update('\0')
    .update(String(codexOutput.buildHash))
    .digest('hex');

  return {
    cards,
    articles: rules.articles,
    faqs: faqList,
    linkGraph,
    codex: codexOutput,
    setCatalog,
    imagePlan,
    hash,
    warnings,
    report: {
      cards: merge.report,
      errata: errataCount(cards),
      rules: rules.report,
      faqs: faqs.report,
      linkGraph: committedEdges,
      newLinkGraphEdges: linkGraph.length,
      images: imagePlan.report,
      codex: { docs: codexReport.docs, blocks: codexReport.blocks, faqs: codexReport.faqs },
    },
  };
}

/** Write the generation's JSON (not images) into a staging catalog dir. */
export function writeStagingJson(gen, stagingCatalogDir) {
  mkdirSync(stagingCatalogDir, { recursive: true });
  writeFileSync(join(stagingCatalogDir, 'cards.json'), serializeCards(gen.cards));
  writeFileSync(join(stagingCatalogDir, 'articles_normalized.json'), serializeArticles(gen.articles));
  writeFileSync(join(stagingCatalogDir, 'faqs.json'), serializeFaqs(gen.faqs || []));
  writeFileSync(join(stagingCatalogDir, 'link_graph.json'), serializeLinkGraph(gen.linkGraph));
  writeFileSync(join(stagingCatalogDir, 'codex_documents.json'), serializeCodex(gen.codex));
}

/**
 * Validate the staged generation before promoting: no warnings, and every card
 * (and each variant) `image` either names a webp present in the manifest or is null.
 */
export function validateGeneration(gen) {
  const problems = [];
  if (gen.warnings.length) problems.push(`unresolved warnings:\n  - ${gen.warnings.join('\n  - ')}`);
  const manifest = new Set(gen.imagePlan.manifest);
  const allStrings = (a) => Array.isArray(a) && a.every((x) => typeof x === 'string');
  for (const [name, c] of Object.entries(gen.cards)) {
    if (c.image != null && !manifest.has(c.image)) problems.push(`${name}: card image ${c.image} is not in the staged art manifest`);
    for (const v of c.variants || []) {
      if (v.image != null && !manifest.has(v.image)) problems.push(`${name}: variant ${v.slug} image ${v.image} is not in the staged art manifest`);
    }
    // Runtime shape contract: the app lowercases element/subtype names, so these
    // MUST be plain string arrays, not the API's {id,name} objects. A regression
    // here black-screens every card view; refuse to promote it.
    if (!allStrings(c.elements)) problems.push(`${name}: elements must be name strings, got ${JSON.stringify(c.elements)}`);
    if (!allStrings(c.subTypes)) problems.push(`${name}: subTypes must be strings, got ${JSON.stringify(c.subTypes)}`);
    // Life is an avatar-only stat (the API sets 20 on non-avatars); refuse to ship it.
    if (c.life != null && !c.isAvatar) problems.push(`${name}: non-avatar has life ${c.life} (life is avatar-only)`);
  }
  if (problems.length) throw new Error(`staging validation failed:\n  - ${problems.slice(0, 20).join('\n  - ')}`);
  return true;
}
