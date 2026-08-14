import fs from 'fs';
import { PNG } from 'pngjs';
// Transient vertical-seam detector: for each frame, per-column vertical-edge
// energy E(x) = sum_y |gray(x,y)-gray(x+1,y)| over y in [300, 2700) (skips the
// bugreport overlay + nav). A seam = column whose energy SPIKES vs its own
// neighbourhood AND vs the same column in the previous frame.
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
let prevE = null;
for (const f of files) {
  const p = PNG.sync.read(fs.readFileSync(dir + '/' + f));
  const W = p.width, H = Math.min(p.height, 2700);
  const E = new Float64Array(W - 1);
  for (let y = 300; y < H; y += 2) {
    const row = (y * W) << 2;
    let prev = p.data[row] * .3 + p.data[row+1] * .6 + p.data[row+2] * .1;
    for (let x = 1; x < W; x++) {
      const i = row + (x << 2);
      const g = p.data[i] * .3 + p.data[i+1] * .6 + p.data[i+2] * .1;
      E[x-1] += Math.abs(g - prev);
      prev = g;
    }
  }
  // local spike score: E(x) minus median of window +-24 (excluding x itself-ish)
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
