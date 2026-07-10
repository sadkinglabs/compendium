// Native card-scanner bridge. The heavy lifting - camera, title-strip OCR, fuzzy
// match, and the recognition overlay - lives in the Kotlin `CardScanner` plugin
// (Compose + CameraX + bundled ML Kit, fully offline). JS supplies the catalog,
// owns every DB write (ownedRepository stays the single source of truth), and
// drives Codex navigation. On web / in the preview it degrades to a graceful stub.
import { registerPlugin } from '@capacitor/core';
import { query } from './store/db.js';
import { addOwnedCopies, addWantedCopies } from './store/ownedRepository.js';
import { parseDeckShare } from './store/deckShare.js';
import { importDeckShare } from './store/deckRepository.js';
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

// The catalog the native matcher indexes: id + name + orientation. ORDER BY
// is_site, card_id keeps reprints adjacent so the native de-dupe-by-name is
// deterministic (prevents the identical-name ambiguity deadlock).
async function catalogForScan() {
  const rows = await query('SELECT card_id, name, is_site FROM cards ORDER BY is_site ASC, card_id ASC;');
  return rows
    .filter((r) => r.card_id && r.name)
    .map((r) => ({ id: r.card_id, name: r.name, isSite: !!r.is_site }));
}

/**
 * Launch the universal scanner. It auto-detects the target and, on close, reports one
 * terminal outcome: a card (Codex), a shared deck (compendium://deck), or a shared
 * match (compendium://match). JS owns all writes/nav - the deck is imported here (never
 * on the native side). Callbacks: `onOpenCard(id,name)`, `onOpenDeck(id,name)`,
 * `onImportMatch(url)`. Safe on web (shows a hint and returns).
 */
export async function launchScanner({ onOpenCard, onOpenDeck, onImportMatch } = {}) {
  if (!isNative()) {
    toast('Card scanning is available in the installed app.');
    return;
  }
  const { available } = await CardScanner.isAvailable().catch(() => ({ available: false }));
  if (!available) {
    toast('No camera available on this device.', { tone: 'danger' });
    return;
  }

  // Add-actions stream in while the scanner stays open. Writes are ATOMIC (+N upsert)
  // so overlapping same-card taps can't lose an increment; failures are counted and
  // surfaced once the scanner closes (the WebView is behind the Activity, so a toast
  // mid-scan wouldn't be seen).
  let failed = 0;
  const sub = await CardScanner.addListener('scanAction', async (ev) => {
    try {
      if (ev.action === 'collection') await addOwnedCopies(ev.cardId, 1);
      else if (ev.action === 'wishlist') await addWantedCopies(ev.cardId, 1);
    } catch { failed += 1; }
  });

  try {
    const cards = await catalogForScan();
    const res = await CardScanner.scan({ cards });
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
    if (failed > 0) toast(`${failed} scanned add${failed === 1 ? '' : 's'} didn't save`, { tone: 'danger' });
  }
}
