// Image stage (rev 4+ content-addressed): map each variant to its per-finish art KEY from the art
// manifest. Foils are no longer collapsed - a variant with its own scan gets its own
// content-addressed key; a variant with no scan borrows a SIBLING finish of the same printing base
// (standard preferred); a printing with no scan at all is image=null and renders the deterministic
// element art. Reverse faces and conversion are the manifest engine's concern (artManifest.mjs) -
// this stage is a pure lookup over the finished manifest, so buildGeneration stays dry-runnable.
import { printingBase } from './curiosa.mjs';

// Set order is DERIVED from the numeric set code; mirrors src/store/sets.js EXACTLY: numeric codes
// ascending are release order, and '' plus any non-numeric (promotional) code sort LAST.
const setRank = (code) => (code && /^\d+$/.test(code) ? parseInt(code, 10) : Number.MAX_SAFE_INTEGER);
const FINISH_RANK = { Standard: 0, Foil: 1, Rainbow: 2 };

/**
 * Annotate cards with per-finish content-addressed image keys from the art manifest.
 * @param cards        merged cards object (name -> card)
 * @param artManifest  { objects: { slug -> { key, ... } } } from buildArtManifest
 * @returns { cards (annotated copy), report }
 */
export function planImages(cards, artManifest) {
  const objects = (artManifest && artManifest.objects) || {};
  const out = {};
  const report = { perFinish: 0, sharedSibling: 0, noScan: [] };

  for (const [name, card] of Object.entries(cards)) {
    const c = { ...card, variants: (card.variants || []).map((v) => ({ ...v })) };

    // Group this card's variants by printing base, for the sibling-finish fallback.
    const byBase = new Map();
    for (const v of c.variants) {
      const b = printingBase(v.slug);
      if (!byBase.has(b)) byBase.set(b, []);
      byBase.get(b).push(v);
    }
    const siblingKey = (v) => {
      const sibs = byBase.get(printingBase(v.slug)) || [];
      const ordered = [...sibs].sort((a, b) =>
        (FINISH_RANK[a.finish] ?? 9) - (FINISH_RANK[b.finish] ?? 9) || String(a.slug).localeCompare(String(b.slug)));
      for (const s of ordered) if (objects[s.slug]) return objects[s.slug].key;
      return null;
    };

    for (const v of c.variants) {
      if (objects[v.slug]) { v.image = objects[v.slug].key; report.perFinish++; }         // its own scan
      else { const k = siblingKey(v); v.image = k; if (k) report.sharedSibling++; }        // borrow a sibling
    }

    // Card-level default image: lowest set rank, standard-preferred, slug order - a real key.
    const ordered = [...c.variants].sort((a, b) =>
      setRank(a.set) - setRank(b.set) ||
      (FINISH_RANK[a.finish] ?? 9) - (FINISH_RANK[b.finish] ?? 9) ||
      String(a.slug).localeCompare(String(b.slug)));
    const def = ordered.find((v) => v.image) || ordered[0];
    c.image = def ? (def.image || null) : null;

    for (const [base, sibs] of byBase) if (!sibs.some((s) => objects[s.slug])) report.noScan.push(`${name}::${base}`);
    out[name] = c;
  }

  return { cards: out, report };
}
