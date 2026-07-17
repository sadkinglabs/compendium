// Curiosa card source: fetch every card + its printings from the tRPC card.search
// API, and MERGE into the local catalog - updating existing cards (stats, rulesText,
// enriched per-printing variants) and ADDING genuinely new ones, while never dropping
// a local-only card (the token entries the API folds away).
//
// The FETCH is a thin wrapper over the tRPC card.search pagination (this stage
// supersedes the old refresh-card-variants script, which could only update existing
// cards, never add one); the MERGE is pure and is what the tests drive.
import { cardSlug } from './slug.mjs';

const API = 'https://curiosa.io/api/trpc/card.search';
const HEADERS = { 'User-Agent': 'Mozilla/5.0', Origin: 'https://curiosa.io', Referer: 'https://curiosa.io/cards' };

// A printing base is a variant slug minus its trailing finish token (-s / -f / -rf).
export function printingBase(slug) {
  return String(slug).replace(/-(s|f|rf)$/, '');
}

// Reserved keys a printing base must never collide with, or a legacy ownership
// bucket could be misread as an exact printing (rev 5 Codex Minor). Also rejects an
// empty base.
export function isReservedBase(base) {
  return base === '' || base === 'foil' || /^\d{3}(:f)?$/.test(base);
}

// The API returns elements as {id,name} objects, but the catalog stores - and the
// runtime lowercases (catalogCache: `x.toLowerCase()`) - a flat array of name
// strings ("Air","Fire"), exactly as every prior catalog generation did. Passing
// the objects through unflattened black-screens every card view. Normalise here.
export function elementNames(apiElements) {
  return (apiElements || []).map((e) => (typeof e === 'string' ? e : e?.name)).filter(Boolean);
}

/** API card -> { sets:[{name,code}], variants:[enriched] }. */
export function shapeFromApi(card) {
  // NOTE: no `src` - the API's CDN image URL must never ship (offline-first, §3)
  // and nothing reads it; per-printing art is the bundled webp added by planImages.
  const variants = (card.variants || []).map((v) => ({
    slug: v.slug,
    set: v.setCard?.set?.code || null,
    setName: v.setCard?.set?.name || null,
    finish: v.finish || 'Standard',
    product: v.product || null,
    artist: v.artist?.name || null,
    flavorText: v.flavorText || '',
  })).filter((v) => v.set && v.slug);
  const seen = new Map();
  for (const v of variants) if (!seen.has(v.set)) seen.set(v.set, { name: v.setName, code: v.set });
  const sets = [...seen.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  return { sets, variants };
}

const thresholdsFromApi = (c) => ({
  air: c.airThreshold || 0, earth: c.earthThreshold || 0, fire: c.fireThreshold || 0, water: c.waterThreshold || 0,
});

/** Build a full local-shaped card object for a genuinely new API card. */
function newCardFromApi(card) {
  const { sets, variants } = shapeFromApi(card);
  const type = card.type || null;
  return {
    name: card.name,
    type,
    subTypes: [],
    rarity: card.rarity || null,
    elements: elementNames(card.elements),
    cost: card.cost ?? null,
    attack: card.attack ?? null,
    defence: card.defense ?? null,
    // Life is an AVATAR-only stat. The API returns life: 20 on non-avatars (whole
    // Gothic set), which surfaced as a wrong "LIFE 20" on minions/sites. Null it
    // for everything that is not an avatar.
    life: type === 'Avatar' ? (card.life ?? null) : null,
    thresholds: thresholdsFromApi(card),
    rulesText: card.rulesText || '',
    isAvatar: type === 'Avatar',
    isSite: type === 'Site',
    sets,
    flavorText: '',
    image: null,
    variants,
  };
}

/**
 * Merge API cards into the local catalog object (keyed by display name).
 * Pure: returns a NEW cards object plus a report; never mutates the input.
 * Gates (throw on violation): no existing card_id disappears; no duplicate card_id;
 * the API total is within a sane band of local; every printing base is well-formed;
 * every set code used has a name.
 */
export function mergeCatalog(localCards, apiCards, { minApiFraction = 0.5 } = {}) {
  const localNames = Object.keys(localCards);
  if (apiCards.length < localNames.length * minApiFraction) {
    throw new Error(`Curiosa returned ${apiCards.length} cards, far below the local ${localNames.length}; refusing to gut the catalog. If the set really shrank, raise minApiFraction deliberately.`);
  }
  const byName = new Map();
  const bySlug = new Map();
  for (const c of apiCards) { byName.set(c.name, c); if (c.slug) bySlug.set(c.slug, c); }

  const out = {};
  for (const [name, card] of Object.entries(localCards)) out[name] = { ...card };

  const updated = [];
  const added = [];
  const localOnly = [];
  const badBases = [];
  const setNames = new Map();      // code -> name (for the unnamed-set gate)
  const noteSets = (variants) => { for (const v of variants) if (v.set) setNames.set(v.set, v.setName); };

  // Update existing / collect local-only
  for (const name of localNames) {
    const hit = byName.get(name) || bySlug.get(cardSlug(name));
    if (!hit) { localOnly.push(name); continue; }
    const { sets, variants } = shapeFromApi(hit);
    if (!sets.length) { localOnly.push(name); continue; }
    noteSets(variants);
    const c = out[name];
    c.type = hit.type ?? c.type;
    c.rarity = hit.rarity ?? c.rarity;
    c.elements = hit.elements ? elementNames(hit.elements) : c.elements;
    c.cost = hit.cost ?? c.cost;
    c.attack = hit.attack ?? c.attack;
    c.defence = hit.defense ?? c.defence;
    c.life = hit.type === 'Avatar' ? (hit.life ?? c.life) : null;   // avatar-only stat
    c.thresholds = thresholdsFromApi(hit);
    c.rulesText = hit.rulesText ?? c.rulesText;
    c.sets = sets;
    c.variants = variants;
    updated.push(name);
  }

  // Add genuinely new cards (cardSlug absent locally)
  const localSlugs = new Set(localNames.map(cardSlug));
  for (const card of apiCards) {
    const slug = cardSlug(card.name);
    if (localSlugs.has(slug) || out[card.name]) continue;
    const nc = newCardFromApi(card);
    if (!nc.variants.length) continue; // no printings -> not a real catalog card
    noteSets(nc.variants);
    out[card.name] = nc;
    added.push(card.name);
  }

  // Gate: no existing card_id disappears, no duplicate card_id
  const outSlugs = new Map();
  for (const name of Object.keys(out)) {
    const slug = cardSlug(name);
    if (outSlugs.has(slug)) throw new Error(`duplicate card_id "${slug}" from names ${JSON.stringify(outSlugs.get(slug))} and ${JSON.stringify(name)}`);
    outSlugs.set(slug, name);
  }
  const disappeared = localNames.map(cardSlug).filter((s) => !outSlugs.has(s));
  if (disappeared.length) throw new Error(`merge would drop existing card_id(s): ${disappeared.slice(0, 20).join(', ')}`);

  // Gate: every printing base well-formed
  for (const name of Object.keys(out)) {
    for (const v of out[name].variants || []) {
      const base = printingBase(v.slug);
      if (isReservedBase(base)) badBases.push(`${name}: ${v.slug} -> "${base}"`);
    }
  }
  if (badBases.length) throw new Error(`malformed printing base(s) that could be misread as a legacy ownership bucket: ${badBases.slice(0, 20).join('; ')}`);

  // Gate: every used set code has a name
  const unnamed = [...setNames.entries()].filter(([, n]) => !n).map(([code]) => code);
  if (unnamed.length) throw new Error(`set code(s) with no name in the API set data: ${unnamed.join(', ')} - a new set needs a one-time developer entry`);

  return {
    cards: out,
    report: {
      total: Object.keys(out).length,
      apiTotal: apiCards.length,
      updated,
      added,
      localOnly,
      sets: [...setNames.entries()].map(([code, nm]) => ({ code, name: nm })).sort((a, b) => a.code.localeCompare(b.code)),
    },
  };
}

/** Count cards whose rulesText marks them as errata'd. */
export function errataCount(cards) {
  return Object.values(cards).filter((c) => String(c.rulesText || '').startsWith('UPDATED')).length;
}

/* ---------------- network fetch (thin, hardened) ---------------- */

async function fetchPage(cursor) {
  const json = { query: '', sort: 'name', set: '*', filters: [], limit: 100, collection: false, direction: 'forward' };
  if (cursor != null) json.cursor = cursor;
  const input = encodeURIComponent(JSON.stringify({ 0: { json } }));
  const res = await fetch(`${API}?batch=1&input=${input}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Curiosa API HTTP ${res.status} (the card source may have moved; a developer needs to update scripts/catalog/curiosa.mjs)`);
  let body;
  try { body = await res.json(); } catch { throw new Error('Curiosa API returned non-JSON (the API shape may have changed)'); }
  const data = body?.[0]?.result?.data?.json;
  if (!data || !Array.isArray(data.cards)) throw new Error('Curiosa API shape changed: expected [0].result.data.json.cards[]');
  return data;
}

export async function fetchAllCards({ onProgress } = {}) {
  const out = [];
  let cursor = null;
  let page = 0;
  do {
    const { cards, nextCursor } = await fetchPage(cursor);
    out.push(...cards);
    cursor = nextCursor;
    if (++page > 60) throw new Error('Curiosa pagination runaway (>60 pages)');
    onProgress?.(out.length, page);
  } while (cursor != null);
  return out;
}
