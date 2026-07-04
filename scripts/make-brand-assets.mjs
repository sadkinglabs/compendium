// Generates the source brand images (icon foreground/background/composed + splash)
// for @capacitor/assets, rasterised from SVG via sharp. The mark is the wordmark's
// gold rounded-diamond on a black grimoire ground - matches the in-app brand.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const GOLD = '#dcb86f';
const out = (p) => { mkdirSync(dirname(p), { recursive: true }); return p; };

// A gold rounded-diamond (rotated square), optionally with a small solid gem centre.
const diamond = (side, stroke, gem) => `
  <rect x="${512 - side / 2}" y="${512 - side / 2}" width="${side}" height="${side}" rx="${side * 0.11}"
        fill="none" stroke="${GOLD}" stroke-width="${stroke}" transform="rotate(45 512 512)"/>
  ${gem ? `<rect x="${512 - gem / 2}" y="${512 - gem / 2}" width="${gem}" height="${gem}" rx="${gem * 0.14}" fill="${GOLD}" transform="rotate(45 512 512)"/>` : ''}`;

const ground = `
  <defs>
    <radialGradient id="wash" cx="50%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#2a2010"/>
      <stop offset="55%" stop-color="#0b0906"/>
      <stop offset="100%" stop-color="#000000"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#wash)"/>`;

const svg = (inner) => Buffer.from(
  `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`);

// Foreground for the adaptive icon: mark only, sized to the safe centre (~66%).
const foreground = svg(`<g filter="url(#s)">${diamond(430, 34, 122)}</g>
  <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="0" stdDeviation="14" flood-color="${GOLD}" flood-opacity="0.35"/>
  </filter></defs>`);
const background = svg(ground);
// Composed legacy/round icon: ground + a slightly larger mark.
const composed = svg(`${ground}${diamond(470, 38, 132)}`);
// Splash: same ground, smaller centred mark.
const splashSvg = Buffer.from(
  `<svg width="2732" height="2732" viewBox="0 0 2732 2732" xmlns="http://www.w3.org/2000/svg">
     <defs><radialGradient id="w" cx="50%" cy="40%" r="70%">
       <stop offset="0%" stop-color="#1c150b"/><stop offset="60%" stop-color="#000"/><stop offset="100%" stop-color="#000"/>
     </radialGradient></defs>
     <rect width="2732" height="2732" fill="url(#w)"/>
     <g transform="translate(842,842) scale(1.02)">
       <rect x="${512 - 210}" y="${512 - 210}" width="420" height="420" rx="46" fill="none" stroke="${GOLD}" stroke-width="30" transform="rotate(45 512 512)"/>
       <rect x="${512 - 58}" y="${512 - 58}" width="116" height="116" rx="16" fill="${GOLD}" transform="rotate(45 512 512)"/>
     </g>
   </svg>`);

const jobs = [
  ['assets/icon-foreground.png', foreground, 1024],
  ['assets/icon-background.png', background, 1024],
  ['assets/icon-only.png', composed, 1024],
  ['assets/splash.png', splashSvg, 2732],
  ['assets/splash-dark.png', splashSvg, 2732],
];
for (const [path, buf, size] of jobs) {
  await sharp(buf).resize(size, size).png().toFile(out(path));
  console.log('wrote', path);
}
