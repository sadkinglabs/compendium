// Convert the full-res card-art drop to CDN-sized WebP.
//
// The drop (CATALOG_DROP/Card Images high res) is ~3.2 GB of full-res PNG - one scan per finish
// (`-s` standard, `-f` foil, `-r`/`-rf` rainbow, `-s-r`/`-f-r` reverse faces). This turns each into
// a width-normalised WebP that lands on R2, so the app can serve per-finish art without bundling
// any of it. Filenames are preserved (finish suffix intact), so `001-abundance-b-f.png` becomes
// `001-abundance-b-f.webp` - the foil stays distinct from `-s`. The catalog repoint (a later step)
// maps each variant to its real slug.
//
// Idempotent: an already-converted file is skipped, so a re-run only fills gaps. Output lives under
// CATALOG_DROP (gitignored), never in the repo or the APK.
//
// Run:  node scripts/catalog/cdn-convert.mjs [--limit N]
import { readdir, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SRC = 'CATALOG_DROP/Card Images high res';
const DEST = 'CATALOG_DROP/cdn-art';
const WIDTH = 745;        // crisp on a phone detail/zoom view; fine downscaled in rows
const QUALITY = 80;
const CONCURRENCY = 8;

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const LIMIT = arg('--limit') ? parseInt(arg('--limit'), 10) : Infinity;

async function main() {
  const sharp = (await import('sharp')).default;
  if (!existsSync(SRC)) { console.error(`Source not found: ${SRC}`); process.exit(1); }
  await mkdir(DEST, { recursive: true });

  const all = (await readdir(SRC)).filter((f) => f.toLowerCase().endsWith('.png'));
  const jobs = [];
  let skipped = 0;
  for (const png of all) {
    if (jobs.length >= LIMIT) break;
    const out = path.join(DEST, png.replace(/\.png$/i, '.webp'));
    if (existsSync(out)) { skipped++; continue; }
    jobs.push({ src: path.join(SRC, png), out, name: png });
  }

  console.log(`drop: ${all.length} PNG · already done: ${skipped} · to convert: ${jobs.length} · ${WIDTH}px q${QUALITY}`);
  if (!jobs.length) { console.log('nothing to do.'); return report(DEST); }

  const started = Date.now();
  let done = 0; let failed = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        await sharp(job.src).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: QUALITY }).toFile(job.out);
      } catch (e) {
        failed++; console.error(`  FAIL ${job.name}: ${e.message}`);
      }
      done++;
      if (done % 200 === 0 || done === jobs.length) {
        const secs = (Date.now() - started) / 1000;
        const rate = done / Math.max(secs, 0.001);
        const eta = Math.round((jobs.length - done) / Math.max(rate, 0.001));
        console.log(`  ${done}/${jobs.length}  (${rate.toFixed(1)}/s, eta ${eta}s)`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  console.log(`converted ${done - failed}/${jobs.length} in ${((Date.now() - started) / 1000).toFixed(1)}s · failures: ${failed}`);
  await report(DEST);
}

async function report(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.webp'));
  let bytes = 0;
  for (const f of files) bytes += (await stat(path.join(dir, f))).size;
  console.log(`OUTPUT: ${files.length} webp · ${(bytes / 1048576).toFixed(1)} MB total · avg ${(bytes / Math.max(files.length, 1) / 1024).toFixed(1)} KB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
