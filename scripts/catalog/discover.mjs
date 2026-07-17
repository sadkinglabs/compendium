// Discover the drop: scan CATALOG_DROP recursively, classify each .csv by its
// header row (so the exact export file names do not matter), and collect every .png
// as a card scan. Ambiguity - two CSVs with the same header, or a CSV whose header
// matches neither expected shape - is a named failure, not a guess. An absent input
// is legal (that stage keeps the current data).
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv.mjs';
import { CODEX_HEADER } from './rules.mjs';
import { FAQ_HEADER } from './faqs.mjs';

function walk(dir, out = { csv: [], png: [] }) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (/\.csv$/i.test(entry)) out.csv.push(full);
    else if (/\.png$/i.test(entry)) out.png.push(full);
  }
  return out;
}

const headerMatches = (header, want) =>
  header.length >= want.length && want.every((h, i) => (header[i] || '').trim().toLowerCase() === h.toLowerCase());

export function discover(dropDir) {
  const found = walk(dropDir);
  let rulesCsv = null;
  let faqCsv = null;
  for (const path of found.csv) {
    // Parse only the FIRST LINE for the header - slicing an arbitrary prefix can cut
    // a later quoted field mid-string and make the parser (correctly) reject it.
    let firstRow;
    try {
      const text = readFileSync(path, 'utf8');
      const firstLine = text.slice(0, (text.indexOf('\n') + 1) || text.length);
      firstRow = parseCsv(firstLine)[0] || [];
    } catch { firstRow = []; }
    if (headerMatches(firstRow, CODEX_HEADER)) {
      if (rulesCsv) throw new Error(`two rules CSVs found (${rulesCsv} and ${path}); leave only one in the drop`);
      rulesCsv = path;
    } else if (headerMatches(firstRow, FAQ_HEADER)) {
      if (faqCsv) throw new Error(`two FAQ CSVs found (${faqCsv} and ${path}); leave only one in the drop`);
      faqCsv = path;
    } else {
      // Unclassifiable CSV: report but do not fail (could be an unrelated file).
    }
  }
  return {
    rulesCsv,
    faqCsv,
    pngPaths: found.png,
    pngNames: found.png.map((p) => p.replace(/^.*[\\/]/, '')),
    csvPaths: found.csv,
  };
}
