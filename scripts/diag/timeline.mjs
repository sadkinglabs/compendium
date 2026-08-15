// Timeline differ (decks-swap-artifacts forensics): locates activity bursts in a
// recording so the interesting full-resolution windows can be extracted. Usage:
//   ffmpeg -i rec.mp4 -vf "scale=168:374" -vsync 0 tl/f%04d.png
//   node scripts/diag/timeline.mjs [tlDir]
// Prints frames whose mean absolute difference from the previous frame exceeds a
// small threshold. Deps: sharp (already in devDependencies).
import fs from 'node:fs';
import sharp from 'sharp';

const dir = process.argv[2] || 'tl';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
let prev = null;
for (const f of files) {
  const { data } = await sharp(`${dir}/${f}`).greyscale().raw().toBuffer({ resolveWithObject: true });
  if (prev && prev.length === data.length) {
    let d = 0;
    for (let i = 0; i < data.length; i++) d += Math.abs(data[i] - prev[i]);
    const mean = d / data.length;
    if (mean > 3) console.log(f, Math.round(mean * 10) / 10);
  }
  prev = data;
}
