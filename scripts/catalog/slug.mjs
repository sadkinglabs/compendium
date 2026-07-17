// Slug schemes for the catalog pipeline.
//
// cardSlug (the card key) is the SHARED, import-free function the runtime seed
// also uses (src/store/cardSlug.js) so a FAQ or printing keys to the same card_id
// the seed writes. articleSlug is the Codex article/sub-entry id scheme, verified
// to reproduce every current id in public/catalog/articles_normalized.json.
export { cardSlug } from '../../src/store/cardSlug.js';

// articleSlug: lowercase; drop apostrophes/period/comma/plus; replace EACH other
// non-alphanumeric character with a single '-' (NON-collapsing, so
// "Ordering Ongoing Effects - The Layer System" -> "...effects---the-layer-system");
// then trim leading/trailing '-'. Verified against all 210 articles + 65 sub-entries.
export function articleSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/['’.,+]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A sub-entry id is parentId + '__' + articleSlug(label). */
export function subSlug(parentId, label) {
  return `${parentId}__${articleSlug(label)}`;
}
