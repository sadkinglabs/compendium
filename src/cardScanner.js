// Native card-scanner bridge. The heavy lifting - camera, title-strip OCR, fuzzy
// match, and the recognition overlay - lives in the Kotlin `CardScanner` plugin
// (Compose + CameraX + bundled ML Kit, fully offline). JS supplies the catalog,
// owns every DB write (ownedRepository stays the single source of truth), and
// drives Codex navigation. On web / in the preview it degrades to a graceful stub.
import { registerPlugin } from '@capacitor/core';
import { query } from './store/db.js';
import { stepOwned, stepWanted } from './store/ownedRepository.js';
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
 * Launch the full-screen scanner. `onOpenCard(cardId, name)` navigates to the card's
 * Codex page (App.open('card', ...)); Collection/Wishlist adds write via ownedRepository.
 * Resolves when the scanner closes; safe to call on web (shows a hint and returns).
 */
export async function launchScanner({ onOpenCard } = {}) {
  if (!isNative()) {
    toast('Card scanning is available in the installed app.');
    return;
  }
  const { available } = await CardScanner.isAvailable().catch(() => ({ available: false }));
  if (!available) {
    toast('No camera available on this device.', { tone: 'danger' });
    return;
  }

  // Add-actions stream in while the scanner stays open. Write SILENTLY - the WebView
  // sits behind the native Activity, so a JS toast wouldn't be seen; the scanner
  // shows its own Snackbar confirmation.
  const sub = await CardScanner.addListener('scanAction', async (ev) => {
    try {
      if (ev.action === 'collection') await stepOwned(ev.cardId, 1);
      else if (ev.action === 'wishlist') await stepWanted(ev.cardId, 1);
    } catch { /* best-effort; the scanner already confirmed via Snackbar */ }
  });

  try {
    const cards = await catalogForScan();
    const res = await CardScanner.scan({ cards });
    if (res?.action === 'codex' && res.cardId) onOpenCard?.(res.cardId, res.name);
  } catch (e) {
    const code = String(e?.code || e?.message || '');
    if (/permission/i.test(code)) toast('Camera permission is needed to scan cards.', { tone: 'danger' });
    else if (!/cancel/i.test(code)) toast('Scanner error.', { tone: 'danger' });
  } finally {
    try { await sub.remove(); } catch { /* noop */ }
  }
}
