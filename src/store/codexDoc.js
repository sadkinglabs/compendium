// Codex document loader - reads the build-time compiled document model
// (public/catalog/codex_documents.json, produced by scripts/compile-codex.mjs)
// ONCE and caches it in-module. This is a read-only BUNDLED asset shipped in the
// APK; it is deliberately NOT stored in the mutable SQLite DB, so a user write
// never re-serialises the whole document corpus. Documents are keyed docType:docId
// ('rule:power', 'card:apprentice_wizard'), matching how annotations reference
// their target (target_type, target_id).
const BASE = import.meta.env.BASE_URL;
let bundlePromise = null;

function loadBundle() {
  if (!bundlePromise) {
    bundlePromise = fetch(`${BASE}catalog/codex_documents.json`)
      .then((r) => r.json())
      .catch((e) => { bundlePromise = null; throw e; });   // let a transient failure retry
  }
  return bundlePromise;
}

/** One Document by (docType, docId), or null if absent (e.g. a card with no rules text). */
export async function getDoc(docType, docId) {
  const b = await loadBundle();
  return b.docs[`${docType}:${docId}`] || null;
}

/** Several Documents in one bundle load. pairs = [[docType, docId], ...]. */
export async function getDocs(pairs) {
  const b = await loadBundle();
  return pairs.map(([t, id]) => b.docs[`${t}:${id}`] || null);
}

/** Compiled FAQ link data by faq id: { q:{canon,links}, a:{canon,links} } or null. */
export async function getFaqs(ids) {
  const b = await loadBundle();
  return ids.map((id) => b.faqs?.[id] || null);
}
