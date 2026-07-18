// Hardware-back precedence for the App shell. back.js's registered consumers (FAB menus and the
// sheet/modal chassis) run FIRST and LIFO; ONLY when they all decline does the App consult these
// FALLBACK orderings. Named *Fallback for exactly that reason - they do not resolve the consumer
// half of the system, only what happens after it declines. Pure and table-tested. Run: npm run test:app
//
// This owns the ORDER (the app-wide-back invariant worth a test); the ACTIONS stay in App /
// LifeCounter. A reorder regression here - e.g. a row slipped above `match`, so BACK exits a live
// match instead of peeling its modal - is silent and app-wide, which is why the order is a tested
// contract rather than an inline array.

// App-level fallback precedence, highest first. Rows marked (shadowed) are normally peeled by a
// self-registering chassis (GothicSheet/Sheet or CenteredModal, via registerBackConsumer) BEFORE
// this runs; they are KEPT as a declared fallback in case a layer is ever rendered without that
// chassis, so hardware-back still has a defined action. Adding a layer = one row here (order =
// precedence). The keys are the contract App's state object and action map must both use.
export const APP_BACK_ORDER = [
  'match',        // peel counter internal UI, else minimize (see resolveCounterBackFallback)
  'preMatch',
  'deckWizard',
  'importMode',   // (shadowed: Sheet -> GothicSheet)
  'matchImport',  // (shadowed: Sheet -> GothicSheet)
  'resultPaste',  // (shadowed: CenteredModal)
  'searchHelp',   // (shadowed: CenteredModal)
  'credits',      // (shadowed: CenteredModal)
  'settings',     // (shadowed: CenteredModal)
  'profileSheet', // (shadowed: Sheet -> GothicSheet)
  'add',
  'query',
  'detail',
  'deckEdit',
  'deckOpen',
  'tabHome',
];

/**
 * The App-fallback layer BACK should peel for the given nav state, or null if none matches
 * (App then falls through to home-api / double-back-to-exit). Highest precedence wins.
 * @param {Record<string, boolean>} state  a flag per APP_BACK_ORDER key (truthy = that layer is open)
 * @returns {string|null}
 */
export function resolveAppBackFallback(state) {
  return APP_BACK_ORDER.find((key) => state[key]) || null;
}

// The `match` row's own internal precedence: BACK in a live match peels the counter's open layers
// (a confirm dialog, then the end screen, then a secondary sheet, then an open FAB menu), and only
// when none is open does it minimize - preserving the resumable match. Mirrors LifeCounter.closeTopmost.
export const COUNTER_BACK_ORDER = ['confirm', 'end', 'sheet', 'fab'];

/**
 * Which counter layer BACK peels, or 'minimize' when none is open.
 * @param {Record<string, boolean>} layers  truthy = that counter layer is open
 * @returns {'confirm'|'end'|'sheet'|'fab'|'minimize'}
 */
export function resolveCounterBackFallback(layers) {
  return COUNTER_BACK_ORDER.find((k) => layers[k]) || 'minimize';
}
