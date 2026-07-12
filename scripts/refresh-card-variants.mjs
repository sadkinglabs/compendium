// One-time-ish catalog refresh: pull every card's printings from Curiosa's
// card.search tRPC API and merge the NEW set model into public/catalog/cards.json:
//   - `sets`     -> distinct sets with the current NUMERIC codes (001 Alpha,
//                   002 Beta, 004 Arthurian Legends, 005 Dragonlord, 006 Gothic,
//                   999 Promotional). No 003.
//   - `variants` -> one entry per physical printing { slug, set, setName, finish,
//                   src, artist } - the per-set x finish granularity the Collection
//                   redesign tracks ownership against.
// Everything else (rulesText, thresholds, and crucially the LOCAL `image` slug)
// is preserved, so the app keeps showing its bundled offline art. The cloudfront
// `src` is stored for the future CDN image migration.
//
// Run: node scripts/refresh-card-variants.mjs   (writes cards.json + a .bak)
import { readFileSync, writeFileSync } from 'fs';

const CARDS = 'public/catalog/cards.json';
const API = 'https://curiosa.io/api/trpc/card.search';
const HEADERS = { 'User-Agent': 'Mozilla/5.0', Origin: 'https://curiosa.io', Referer: 'https://curiosa.io/cards' };

const slugify = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

async function fetchPage(cursor) {
  const json = { query: '', sort: 'name', set: '*', filters: [], limit: 100, collection: false, direction: 'forward' };
  if (cursor != null) json.cursor = cursor;
  const input = encodeURIComponent(JSON.stringify({ 0: { json } }));
  const res = await fetch(`${API}?batch=1&input=${input}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} at cursor ${cursor}`);
  return (await res.json())[0].result.data.json;   // { cards, nextCursor }
}

async function fetchAll() {
  const out = [];
  let cursor = null, page = 0;
  do {
    const { cards, nextCursor } = await fetchPage(cursor);
    out.push(...cards);
    cursor = nextCursor;
    if (++page > 60) throw new Error('pagination runaway');
    process.stdout.write(`\r  fetched ${out.length} cards (page ${page})…`);
  } while (cursor != null);
  process.stdout.write('\n');
  return out;
}

function shapeFromApi(card) {
  const variants = (card.variants || []).map((v) => ({
    slug: v.slug,
    set: v.setCard?.set?.code || null,
    setName: v.setCard?.set?.name || null,
    finish: v.finish || 'Standard',
    src: v.src || null,
    artist: v.artist?.name || null,
  })).filter((v) => v.set);
  // Distinct sets, ordered by numeric code (999 Promotional sorts last naturally).
  const seen = new Map();
  for (const v of variants) if (!seen.has(v.set)) seen.set(v.set, { name: v.setName, code: v.set });
  const sets = [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { sets, variants };
}

async function main() {
  console.log('Fetching cards from Curiosa…');
  const api = await fetchAll();
  const byName = new Map(), bySlug = new Map();
  for (const c of api) { byName.set(c.name, c); if (c.slug) bySlug.set(c.slug, c); }
  console.log(`API returned ${api.length} cards.`);

  const cards = JSON.parse(readFileSync(CARDS, 'utf8'));
  writeFileSync(CARDS + '.bak', JSON.stringify(cards, null, 0));

  let matched = 0; const unmatched = [];
  for (const [name, card] of Object.entries(cards)) {
    const hit = byName.get(name) || bySlug.get(slugify(name));
    if (!hit) { unmatched.push(name); continue; }
    const { sets, variants } = shapeFromApi(hit);
    if (!sets.length) { unmatched.push(name + ' (no variants)'); continue; }
    card.sets = sets;         // NEW numeric-coded sets
    card.variants = variants; // per-printing set x finish (+ future cloudfront src)
    matched++;
  }

  writeFileSync(CARDS, JSON.stringify(cards, null, 0));
  console.log(`\nMerged: ${matched}/${Object.keys(cards).length} cards updated.`);
  if (unmatched.length) console.log(`Unmatched (${unmatched.length}):`, unmatched.slice(0, 30).join(', ') + (unmatched.length > 30 ? ' …' : ''));
  // Quick sanity print
  const aw = cards['Apprentice Wizard'];
  console.log('\nApprentice Wizard sets:', JSON.stringify(aw.sets));
  console.log('Apprentice Wizard variants:', aw.variants.length, 'e.g.', JSON.stringify(aw.variants[0]));
}
main().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
