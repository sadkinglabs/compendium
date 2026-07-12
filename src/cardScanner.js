// Native card-scanner bridge. The heavy lifting - camera, title-strip OCR, fuzzy
// match, and the recognition overlay - lives in the Kotlin `CardScanner` plugin
// (Compose + CameraX + bundled ML Kit, fully offline). JS supplies the catalog,
// owns every DB write (ownedRepository stays the single source of truth), and
// drives Codex navigation. On web / in the preview it degrades to a graceful stub.
import { registerPlugin } from '@capacitor/core';
import { query } from './store/db.js';
import { addOwnedCopies, addOwnedCopiesInSet, addWantedCopies } from './store/ownedRepository.js';
import { parseDeckShare } from './store/deckShare.js';
import { importDeckShare, addScannedToDeck } from './store/deckRepository.js';
import { toast } from './feedback.js';
import { isNative } from './native.js';

const CardScanner = registerPlugin('CardScanner', {
  web: {
    isAvailable: async () => ({ available: false }),
    scan: async () => ({ action: 'unavailable' }),
    addListener: async () => ({ remove() {} }),
    removeAllListeners: async () => {},
  },
});

// The catalog the native matcher indexes: id + name + orientation + sets (for the
// collection-mode printing picker). ORDER BY is_site, card_id keeps reprints adjacent
// so the native de-dupe-by-name is deterministic (prevents the identical-name deadlock).
async function catalogForScan() {
  const rows = await query('SELECT card_id, name, is_site, sets FROM cards ORDER BY is_site ASC, card_id ASC;');
  return rows
    .filter((r) => r.card_id && r.name)
    .map((r) => {
      let sets = [];
      try { sets = JSON.parse(r.sets || '[]'); } catch { /* keep [] */ }
      return { id: r.card_id, name: r.name, isSite: !!r.is_site, sets };
    });
}

/**
 * Launch the scanner. It auto-detects the target and, on close, reports one terminal
 * outcome: a card (Codex), a shared deck (compendium://deck), or a shared match
 * (compendium://match). JS owns all writes/nav - the deck is imported here (never on
 * the native side). Callbacks: `onOpenCard(id,name)`, `onOpenDeck(id,name)`,
 * `onImportMatch(url)`. `mode`: 'universal' (default - the Home/Decks identify-and-act
 * overlay) or 'collection' (a focused build-your-collection loop: identify, pick a
 * quantity, Add, keep scanning). Safe on web (shows a hint and returns).
 */
export async function launchScanner({ onOpenCard, onOpenDeck, onImportMatch, onChanged, deckId = null, mode = 'universal' } = {}) {
  if (!isNative()) {
    toast('Card scanning is available in the installed app.');
    return;
  }
  const { available } = await CardScanner.isAvailable().catch(() => ({ available: false }));
  if (!available) {
    toast('No camera available on this device.', { tone: 'danger' });
    return;
  }

  // A recognised card's set is a catalogue attribute: a card printed in exactly ONE
  // set can only BE that set, so file it there (not the Unspecified bucket). Cards
  // reprinted across sets (Alpha/Beta) are ambiguous from the name alone, so they
  // fall back to Unspecified. Built once, up front (card_id -> [{name,code}]).
  const setsById = new Map();
  try {
    const setRows = await query('SELECT card_id, sets FROM cards;');
    for (const r of setRows) { try { setsById.set(r.card_id, JSON.parse(r.sets || '[]')); } catch { /* skip */ } }
  } catch { /* fall back to Unspecified for all */ }
  const soleSet = (cardId) => { const s = setsById.get(cardId); return s && s.length === 1 && s[0]?.code ? s[0].code : null; };

  // Add-actions stream in while the scanner stays open. Writes are ATOMIC (+N upsert)
  // so overlapping same-card taps can't lose an increment; failures are counted and
  // surfaced once the scanner closes (the WebView is behind the Activity, so a toast
  // mid-scan wouldn't be seen).
  let failed = 0, deckAdded = 0, deckBlocked = 0;
  const sub = await CardScanner.addListener('scanAction', async (ev) => {
    try {
      const n = Math.max(1, ev.qty || 1);   // collection/deck modes pick a quantity; universal +1s
      if (ev.action === 'deck') {
        // Deck mode: file the card in its home zone, capped by the rarity copy limit.
        const res = deckId ? await addScannedToDeck(deckId, ev.cardId, n) : { ok: false };
        if (res.ok) deckAdded += n; else deckBlocked += 1;
      } else if (ev.action === 'collection') {
        // Collection mode sends the chosen printing (ev.set: auto for single-set,
        // user-picked for a reprint). Universal +1 sends none -> auto-file if the
        // card is single-set, else Unspecified.
        const set = ev.set || soleSet(ev.cardId);
        if (set) await addOwnedCopiesInSet(ev.cardId, set, n);
        else await addOwnedCopies(ev.cardId, n);   // multi-set + no pick -> Unspecified
      } else if (ev.action === 'wishlist') await addWantedCopies(ev.cardId, n);
    } catch { failed += 1; }
  });

  try {
    const cards = await catalogForScan();
    const res = await CardScanner.scan({ cards, mode });
    if (res?.action === 'codex' && res.cardId) {
      onOpenCard?.(res.cardId, res.name);
    } else if (res?.action === 'deckUrl' && res.url) {
      const payload = parseDeckShare(res.url);
      if (!payload) { toast("That QR isn't a Compendium deck.", { tone: 'danger' }); }
      else {
        try {
          const d = await importDeckShare(payload);
          toast(`Imported "${d.name}"${d.missing ? ` · ${d.missing} unknown` : ''}`);
          onOpenDeck?.(d.id, d.name);
        } catch { toast("Couldn't import that deck.", { tone: 'danger' }); }
      }
    } else if (res?.action === 'matchUrl' && res.url) {
      onImportMatch?.(res.url);
    }
  } catch (e) {
    const code = String(e?.code || e?.message || '');
    if (/permission/i.test(code)) toast('Camera permission is needed to scan cards.', { tone: 'danger' });
    else if (!/cancel/i.test(code)) toast('Scanner error.', { tone: 'danger' });
  } finally {
    try { await sub.remove(); } catch { /* noop */ }
    if (deckAdded > 0) { onChanged?.(); toast(`Added ${deckAdded} card${deckAdded === 1 ? '' : 's'} to the deck`); }
    if (deckBlocked > 0) toast(`${deckBlocked} card${deckBlocked === 1 ? '' : 's'} hit the rarity limit`, { tone: 'danger' });
    if (failed > 0) toast(`${failed} scanned add${failed === 1 ? '' : 's'} didn't save`, { tone: 'danger' });
  }
}
