// Transient vertical-seam detector (decks-swap-artifacts forensics). Usage:
//   node scripts/diag/seam.mjs <dir-of-frame-pngs>
// For each frame, per-column vertical-edge energy E(x) = sum over sampled rows of
// |gray(x,y) - gray(x+1,y)|, y in [300, 2700) (skips the screenrecord --bugreport
// overlay and the nav bar). A seam = a column whose energy SPIKES both against its
// own neighbourhood median AND against the same column in the previous frame.
// Deps: sharp (already in devDependencies for the icon pipeline).
import fs from 'node:fs';
import sharp from 'sharp';

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/diag/seam.mjs <framesDir>'); process.exit(2); }
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
let prevE = null;
for (const f of files) {
  const { data, info } = await sharp(`${dir}/${f}`).greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = Math.min(info.height, 2700);
  const E = new Float64Array(W - 1);
  for (let y = 300; y < H; y += 2) {
    const row = y * W;
    let prev = data[row];
    for (let x = 1; x < W; x++) {
      const g = data[row + x];
      E[x - 1] += Math.abs(g - prev);
      prev = g;
    }
  }
  const spikes = [];
  for (let x = 24; x < W - 25; x++) {
    const nb = [];
    for (let k = -24; k <= 24; k += 4) if (Math.abs(k) > 4) nb.push(E[x + k]);
    nb.sort((a, b) => a - b);
    const med = nb[nb.length >> 1];
    const local = E[x] - med;
    const transient = prevE ? E[x] - prevE[x] : 0;
    if (local > 12000 && transient > 8000) spikes.push({ x: x + 1, local: Math.round(local), transient: Math.round(transient) });
  }
  if (spikes.length) {
    spikes.sort((a, b) => b.local - a.local);
    console.log(f, JSON.stringify(spikes.slice(0, 4)));
  }
  prevE = E;
}
