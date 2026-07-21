// Card-art resolution with deterministic, data-derived fallback (architecture §5).
// Images are progressive enhancement: every card renders from data alone.
const BASE = import.meta.env.BASE_URL;

// element -> gradient stops (fire amber, water teal, earth olive, air cyan)
const EL_STOPS = {
  fire:  ['#5a2410', '#240f06'],
  water: ['#1c4a5e', '#0a2030'],
  earth: ['#4a3a18', '#241c0c'],
  air:   ['#1d4a52', '#0a2226'],
};
const NEUTRAL = ['#3a2f1c', '#160f09'];

export const elementColor = { air: '#c4cdd6', earth: '#b35c33', fire: '#e0623f', water: '#4aa3d4' };   // app-wide: air grey, earth brown, fire red, water blue (mirrors tokens.css)

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// §5 test gate: when on, ALL card images are suppressed so the app must render
// from data + generated fallbacks alone. Toggle via localStorage['cx-no-images'].
function imagesDisabled() {
  try { return localStorage.getItem('cx-no-images') === '1'; } catch { return false; }
}

/** Full URL for a card's bundled image, or null when none is known/suppressed. */
export function cardImageUrl(card) {
  if (imagesDisabled()) return null;
  const slug = card?.image_slug;
  return slug ? `${BASE}cards/${slug}` : null;
}

// Set-hero art ships BUNDLED as app assets (public/sets/{code}.webp) - deliberately NOT
// via the card-image CDN, so the Collection landing works fully offline. Only these codes
// have art; Promotional (999) and any future set render name-forward with no hero. Heroes
// are decorative (the set name + Ring carry the meaning), so they honour zero-image mode.
const SET_HEROES = new Set(['001', '002', '004', '005', '006', '999']);

/** URL for a set's bundled hero image, or null when none exists / images are suppressed. */
export function setHeroUrl(code) {
  if (imagesDisabled()) return null;
  return SET_HEROES.has(code) ? `${BASE}sets/${code}.webp` : null;
}

/** URL for an element's threshold icon (public/icons), or null if suppressed/unknown. */
export function elementIconUrl(el) {
  if (imagesDisabled()) return null;
  const e = String(el || '').toLowerCase();
  return ['air', 'earth', 'fire', 'water'].includes(e) ? `${BASE}icons/${e}.png` : null;
}

/** A stable CSS background derived from element + name - same card, same art. */
export function cardFallbackArt(card) {
  let elements = [];
  try { elements = JSON.parse(card?.elements || '[]'); } catch { /* noop */ }
  const first = (elements[0] || '').toLowerCase();
  const [a, b] = EL_STOPS[first] || NEUTRAL;
  const ang = 140 + (hash(card?.name || card?.card_id || '') % 40); // 140–179°
  return (
    `radial-gradient(72% 46% at 50% 26%,rgba(240,230,200,.18),transparent 70%),` +
    `linear-gradient(${ang}deg,${a},${b})`
  );
}

/** Threshold pip runs for a card's elements (for the pip row). */
export function thresholdRuns(card) {
  let th = {};
  try { th = JSON.parse(card?.thresholds || '{}'); } catch { /* noop */ }
  const runs = [];
  for (const el of ['air', 'earth', 'fire', 'water']) {
    for (let i = 0; i < (th[el] || 0); i++) runs.push({ el, c: elementColor[el] });
  }
  return runs;
}
