import { join } from 'node:path';

// The PRODUCTION catalog promotion file-plan: which staged files atomically replace which committed
// files, and in what order. ONE function, consumed by both update-catalog.mjs and its tests, so a
// test can never certify a topology production does not use.
//
// Phase 2 is JSON-ONLY. The art lives on the CDN (uploaded + audited by cdn-upload), so there is NO
// art directory to promote - the retired `artDir` journal shape must NOT appear here. public/cards/
// is left in place as the offline bundled-legacy fallback until Phase 5.
//
// catalogVersion.json is ALWAYS the last entry: it is the reseed trigger the app reads at boot, so
// an interrupt before it leaves the OLD version in force and the promote is recovered whole on the
// next run - never a half-repointed catalog paired with a new version token.

// The catalog JSON files writeStagingJson emits under staging/catalog, promoted to public/catalog.
export const CATALOG_JSON = [
  'cards.json',
  'articles_normalized.json',
  'faqs.json',
  'link_graph.json',
  'codex_documents.json',
];

// Absolute path inputs (from update-catalog.mjs):
//   stagingCatalog  staging/catalog dir holding the catalog JSON + art-manifest.json
//   staging         staging root holding setCatalog.json + catalogVersion.json
//   catalog         public/catalog (JSON destination)
//   manifestFile    public/catalog/art-manifest.json (shipped manifest destination)
//   setCatalogFile  src/store/setCatalog.json
//   versionFile     src/store/catalogVersion.json (reseed trigger)
export function productionPromotionPlan({ stagingCatalog, staging, catalog, manifestFile, setCatalogFile, versionFile }) {
  const files = [
    ...CATALOG_JSON.map((name) => ({ from: join(stagingCatalog, name), to: join(catalog, name) })),
    { from: join(stagingCatalog, 'art-manifest.json'), to: manifestFile },
    { from: join(staging, 'setCatalog.json'), to: setCatalogFile },
    { from: join(staging, 'catalogVersion.json'), to: versionFile },   // reseed trigger - LAST, always
  ];
  return { files };   // NO artDir key: Phase-2 promotes JSON only.
}
