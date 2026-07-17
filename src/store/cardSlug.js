// The catalog's card key, in one place with no imports so both the runtime
// (catalog.js seed, which sets cards.card_id) and the build-time pipeline
// (scripts/catalog/*, which resolves FAQ card names and card art) compute it
// identically. If these ever diverged, a FAQ or a printing would key to a card
// id that does not exist. Curiosa-style: lowercase, drop apostrophes, collapse
// every other non-alphanumeric run to a single '_', trim leading/trailing '_'.
export function cardSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
