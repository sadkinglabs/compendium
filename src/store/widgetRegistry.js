// The dashboard widget catalogue and the pure helpers over it. Persistence-free (no
// db import) on purpose, so it is safe to import anywhere - including unit tests and
// profileTransfer's ingress filter. homeRepository re-exports the public names, so
// the rest of the app keeps importing them from there. Run: npm run test:query

// The widget catalogue - 16 data-rich cards + two structural blocks (Title,
// Separator). `pillar` earns a faint hue on Home (codex gold · decks violet ·
// play jade); `configurable` widgets carry their own settings; `structural`
// blocks are chrome-less layout furniture. Every widget is renamable (the frame
// prefers block.config.name over this default title).
export const WIDGETS = [
  // Play
  { kind: 'winRate', title: 'Win Rate', pillar: 'play', blurb: 'Your record at a glance' },
  { kind: 'recentMatches', title: 'Recent Matches', pillar: 'play', blurb: 'Last games played' },
  { kind: 'nemesis', title: 'Nemeses', pillar: 'play', blurb: 'Head-to-head by opponent' },
  // Decks
  { kind: 'deckSpotlight', title: 'Deck Spotlight', pillar: 'decks', blurb: 'A featured deck, in full art' },
  { kind: 'yourDecks', title: 'Your Decks', pillar: 'decks', blurb: 'A rail of your decks' },
  // Codex
  { kind: 'featuredCard', title: 'Random Card', pillar: 'codex', rollable: true, blurb: 'A card to discover - roll for more' },
  { kind: 'cardOfDay', title: 'Card of the Day', pillar: 'codex', blurb: 'A daily card pick' },
  { kind: 'notes', title: 'Notes & Rulings', pillar: 'codex', blurb: 'Your latest marginalia' },
  { kind: 'folios', title: 'Folios', pillar: 'codex', blurb: 'Named sets of cards & rules' },
  { kind: 'randomRule', title: 'Random Article', pillar: 'codex', rollable: true, blurb: 'An article to revisit - roll for more' },
  // Collection
  { kind: 'collectionStats', title: 'Card Collection', pillar: 'collect', blurb: 'Owned, unique, wishlist & buildable decks' },
  // Neutral
  { kind: 'pinned', title: 'Bookmarks', pillar: null, blurb: 'Everything you bookmarked' },
  { kind: 'note', title: 'Note', pillar: null, configurable: true, blurb: 'A free-text note' },
  { kind: 'links', title: 'Links', pillar: null, configurable: true, blurb: 'External bookmarks' },
  // Structural
  { kind: 'title', title: 'Title', pillar: null, structural: true, configurable: true, blurb: 'A heading for a section' },
  { kind: 'separator', title: 'Separator', pillar: null, structural: true, blurb: 'A dividing line' },
];
export const widgetMeta = (k) => WIDGETS.find((w) => w.kind === k) || { kind: k, title: k };
export const isStructural = (k) => !!widgetMeta(k).structural;
export const isRollable = (k) => !!widgetMeta(k).rollable;
export const pillarOf = (k) => widgetMeta(k).pillar || null;

// Old Codex-era kinds → their nearest new widget, so dashboards saved before
// this rewrite keep rendering (remapped at read time, DB left untouched).
// normalizeKind resolves in a SINGLE pass, so every entry must point at a LIVE
// widget kind - never at another alias. When a kind is renamed (collections →
// folios), re-point the old aliases at the new target rather than chaining.
const ALIAS = {
  saved: 'pinned', duels: 'recentMatches', decks: 'yourDecks', random: 'featuredCard',
  randomArticle: 'randomRule', text: 'note', urls: 'links', stats: 'winRate',
  resume: 'recentMatches', collection: 'folios', collections: 'folios',
  // removed widgets fold into a nearby survivor so old dashboards keep rendering
  errata: 'notes', elementAffinity: 'yourDecks',
};
export const normalizeKind = (k) => ALIAS[k] || k;

// A widget type is supported if it, resolved through the alias map, is a defined
// widget. Checking the RESOLVED target (not merely "a key exists in ALIAS") means a
// future stale alias pointing at a removed widget is not falsely supported. Used to
// drop retired widget types (e.g. 'highlights') at every dashboard ingress and at
// render, so a persisted or imported block can never strand an unrenderable widget.
export const isSupportedWidget = (k) => WIDGETS.some((w) => w.kind === normalizeKind(k));

/* ---- dashboard-ingress filters (pure; applied by profileTransfer + homeRepository) ----
   All three exist as standalone helpers so the ingress behaviour is unit-testable without
   a database: they are the guard that stops a retired widget (e.g. 'highlights') stranding
   a dashboard through import, a saved layout, or a persisted row. */

/** Keep only blocks whose type is a supported widget. Accepts bundle rows or already-
 *  mapped blocks (both carry `.type`); tolerant of null/missing input. */
export const filterImportedBlocks = (blocks) => (blocks || []).filter((b) => isSupportedWidget(b?.type));

/** Drop unsupported entries from a saved-layout blocks SNAPSHOT (JSON text), returning
 *  JSON text. Unparseable or non-array input is returned unchanged. */
export function filterLayoutBlocks(blocksJson) {
  try {
    const arr = JSON.parse(blocksJson);
    if (!Array.isArray(arr)) return blocksJson;
    return JSON.stringify(arr.filter((b) => isSupportedWidget(b?.type)));
  } catch { return blocksJson; }
}

/** Whether an imported profile's dashboard should be marked already-seeded. True when a
 *  supported block survived import OR the bundle's dashboard was originally empty (a
 *  deliberate choice, honoured). False ONLY when the bundle HAD blocks and every one was
 *  unsupported (e.g. an old highlights-only dashboard) - so first load seeds the starter
 *  set rather than showing blank. */
export const shouldMarkDashboardSeeded = (bundleBlocks, importedBlocks) =>
  (importedBlocks || []).length > 0 || (bundleBlocks || []).length === 0;
