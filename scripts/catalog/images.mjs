// Image stage: map each printing to a bundled WebP, and (on a real promote) encode
// the PNG scans. The PLAN is pure over a set of drop file names and the merged
// cards, so the dry-run can report exact counts without touching sharp or the disk.
//
// Selection per printing base (finish-stripped slug): prefer the STANDARD scan,
// else the FOIL, else the RAINBOW (foils are dropped as duplicates, but a foil that
// is a printing's ONLY scan is kept as its art). Reverse-face scans (-s-r / -f-r,
// the avatar card backs) are never bundled. The webp is named `<base>.webp` and is
// shared by every finish of the printing. A printing with no scan gets image=null
// and falls back to the deterministic element art at render time.
import { printingBase } from './curiosa.mjs';

// Set display order is DERIVED from the numeric set code (codes are sequential by
// design), so the build needs no set table - a new set slots in automatically. This
// mirrors the runtime derivation in src/store/sets.js; non-numeric sorts mid-pack.
const setRank = (code) => (/^\d+$/.test(code) ? parseInt(code, 10) : 4.5);
const FINISH_RANK = { Standard: 0, Foil: 1, Rainbow: 2 };

// From a set of available drop base names (a Set of "<base>-<finish>" without .png),
// pick the source finish for a base, preferring standard.
function pickSource(base, dropFiles) {
  if (dropFiles.has(`${base}-s`)) return { finish: 's', src: `${base}-s.png` };
  if (dropFiles.has(`${base}-f`)) return { finish: 'f', src: `${base}-f.png` };
  if (dropFiles.has(`${base}-rf`)) return { finish: 'rf', src: `${base}-rf.png` };
  return null;
}

/**
 * Plan the art for the merged catalog.
 * @param cards merged cards object (name -> card)
 * @param dropFileNames array of PNG file names in the drop (with or without .png)
 * @returns { cards (annotated copy), manifest, report }
 */
export function planImages(cards, dropFileNames) {
  const dropFiles = new Set(dropFileNames.map((f) => f.replace(/\.png$/i, '')));
  const reverseScans = [...dropFiles].filter((f) => /-(s|f)-r$/.test(f));
  const usableBases = new Set([...dropFiles].filter((f) => !/-(s|f)-r$/.test(f)).map((f) => f.replace(/-(s|f|rf)$/, '')));

  const out = {};
  const manifest = new Set();       // webp names that will be produced
  const sources = {};               // webp name -> source PNG basename (for conversion)
  const usedScans = new Set();      // drop scans actually consumed
  let keptFoilOnly = 0;             // printings whose only scan is foil/rainbow
  const noScan = [];                // printings (card::base) with no scan and no fallback file

  for (const [name, card] of Object.entries(cards)) {
    const c = { ...card, variants: (card.variants || []).map((v) => ({ ...v })) };
    // distinct printing bases for this card
    const bases = new Map();        // base -> representative variant meta
    for (const v of c.variants) {
      const base = printingBase(v.slug);
      if (!bases.has(base)) bases.set(base, { set: v.set, finishRanks: [] });
      bases.get(base).finishRanks.push(FINISH_RANK[v.finish] ?? 9);
    }
    const baseImage = new Map();    // base -> webp name | null
    for (const [base] of bases) {
      const pick = pickSource(base, dropFiles);
      if (pick) {
        const webp = `${base}.webp`;
        manifest.add(webp);
        sources[webp] = pick.src;
        usedScans.add(pick.src);
        baseImage.set(base, webp);
        if (pick.finish !== 's') keptFoilOnly++;
      } else {
        baseImage.set(base, null);
        noScan.push(`${name}::${base}`);
      }
    }
    // annotate each variant with its printing's image
    for (const v of c.variants) v.image = baseImage.get(printingBase(v.slug));
    // card-level default image: lowest set rank, standard-preferred, slug order
    const ordered = [...c.variants].sort((a, b) =>
      setRank(a.set) - setRank(b.set) ||
      (FINISH_RANK[a.finish] ?? 9) - (FINISH_RANK[b.finish] ?? 9) ||
      String(a.slug).localeCompare(String(b.slug)));
    const def = ordered.find((v) => v.image) || ordered[0];
    c.image = def ? (baseImage.get(printingBase(def.slug)) || null) : null;
    out[name] = c;
  }

  // Drop scans that match no printing base in the catalog (excluding reverse faces).
  const catalogBases = new Set();
  for (const card of Object.values(cards)) for (const v of card.variants || []) catalogBases.add(printingBase(v.slug));
  const unmatchedScans = [...dropFiles]
    .filter((f) => !/-(s|f)-r$/.test(f))
    .filter((f) => !catalogBases.has(f.replace(/-(s|f|rf)$/, '')));
  const droppedFoilDupes = [...dropFiles].filter((f) => /-(f|rf)$/.test(f) && !usedScans.has(`${f}.png`) && catalogBases.has(f.replace(/-(s|f|rf)$/, '')));

  return {
    cards: out,
    manifest: [...manifest].sort(),
    sources,
    report: {
      converted: manifest.size,
      keptFoilOnly,
      droppedFoilDupes: droppedFoilDupes.length,
      skippedReverse: reverseScans.length,
      noScan,
      unmatchedScans,
      usableBases: usableBases.size,
    },
  };
}

/** Encode one PNG scan to a width-normalised WebP. Only used on a real promote. */
export async function convertOne(srcPath, destPath, { width = 380, quality = 78 } = {}) {
  const sharp = (await import('sharp')).default;
  await sharp(srcPath).resize({ width, withoutEnlargement: true }).webp({ quality }).toFile(destPath);
}
