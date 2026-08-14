import fs from 'fs';
import { PNG } from 'pngjs';
const files = fs.readdirSync('tl').filter(f => f.endsWith('.png')).sort();
let prev = null;
const out = [];
for (const f of files) {
  const p = PNG.sync.read(fs.readFileSync('tl/' + f));
  const g = new Float64Array(p.width * p.height);
  for (let i = 0; i < g.length; i++) { const j = i << 2; g[i] = p.data[j] * .3 + p.data[j+1] * .6 + p.data[j+2] * .1; }
  if (prev) { let d = 0; for (let i = 0; i < g.length; i++) d += Math.abs(g[i] - prev[i]); out.push({ f, d: Math.round(d / g.length * 10) / 10 }); }
  prev = g;
}
// print frames whose diff is a local burst (start of activity)
for (let i = 0; i < out.length; i++) {
  if (out[i].d > 3) console.log(out[i].f, out[i].d);
}
