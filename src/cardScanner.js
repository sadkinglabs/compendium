// Native card-scanner bridge. The heavy lifting - camera, title-strip OCR, fuzzy
// match, and the recognition overlay - lives in the Kotlin `CardScanner` plugin
// (Compose + CameraX + bundled ML Kit, fully offline). JS supplies the catalog,
// owns every DB write (ownedRepository stays the single source of truth), and
// drives Codex navigation. On web / in the preview it degrades to a graceful stub.
import { registerPlugin } from '@capacitor/core';
import { createScannerRegistry } from './store/scannerBridgeRegistry.js';
import { query } from './store/db.js';
import { addOwnedCopies, addOwnedCopiesInSet, addWantedForItem } from './store/ownedRepository.js';
import { parseDeckShare } from './store/deckShare.js';
import { importDeckShare, addScannedToDeck, copyLimit } from './store/deckRepository.js';
import { toast } from './feedback.js';
import { isNative } from './native.js';

const CardScanner = registerPlugin('CardScanner', {
  web: {
    isAvailable: async () => ({ available: false }),
    scan: async () => ({ action: 'unavailable' }),
    addListener: async () => ({ remove() {} }),
    respond: async () => {},
    removeAllListeners: async () => {},
  },
});

// The catalog the native matcher indexes: id + name + orientation + sets (for the
// collection-mode printing picker). ORDER BY is_site, card_id keeps reprints adjacent
// so the native de-dupe-by-name is deterministic (prevents the identical-name deadlock).
async function catalogForScan() {
  const rows = await query('SELECT card_id, name, is_site, sets, rarity, rules_text FROM cards ORDER BY is_site ASC, card_id ASC;');
  return rows
    .filter((r) => r.card_id && r.name)
    .map((r) => {
      let sets = [];
      try { sets = JSON.parse(r.sets || '[]'); } catch { /* keep [] */ }
      // limit = the deck-building copy cap (rarity, or 99 for "any number of"),
      // so deck-mode can gate the stepper at scan time without a DB round-trip.
      return { id: r.card_id, name: r.name, isSite: !!r.is_site, sets, limit: copyLimit(r) };
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
export async function launchScanner({ onOpenCard, onOpenDeck, onImportMatch, onChanged, deckId = null, deckName = '', mode = 'universal' } = {}) {
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
  // Which finishes each printing actually EXISTS in. A want names a collector item, and some printings
  // are foil-only - every Promotional card is - so wanting a "standard" copy of one asks for an item the
  // catalog does not contain and the write fails. Scanning a promo into the wishlist errored for exactly
  // this reason.
  const finishesById = new Map();   // card_id -> Map(setCode -> { standard: bool, foil: bool })
  try {
    const setRows = await query('SELECT card_id, sets, variants FROM cards;');
    for (const r of setRows) {
      try { setsById.set(r.card_id, JSON.parse(r.sets || '[]')); } catch { /* skip */ }
      try {
        const bySet = new Map();
        for (const v of JSON.parse(r.variants || '[]')) {
          const code = v?.set;
          if (!code) continue;
          const cur = bySet.get(code) || { standard: false, foil: false };
          if (String(v.finish).toLowerCase() === 'foil') cur.foil = true; else cur.standard = true;
          bySet.set(code, cur);
        }
        finishesById.set(r.card_id, bySet);
      } catch { /* skip */ }
    }
  } catch { /* fall back to Unspecified for all */ }
  // Prefer a standard copy; fall back to foil when that is the only way the printing exists.
  const wantFinish = (cardId, set) => {
    const f = finishesById.get(cardId)?.get(set);
    if (!f) return false;
    return f.standard ? false : !!f.foil;
  };
  const soleSet = (cardId) => { const s = setsById.get(cardId); return s && s.length === 1 && s[0]?.code ? s[0].code : null; };

  // Deck mode: the deck's CURRENT per-card counts, so the recognition sheet can
  // cap the quantity stepper at (copy limit − already in deck) and never let the
  // user pick more than will fit. The native side keeps this live as adds stream
  // in this session, so re-scanning the same card sees the reduced headroom.
  const deckCounts = {};
  if (mode === 'deck' && deckId) {
    try {
      const rows = await query('SELECT card_id, SUM(quantity) n FROM deck_entries WHERE deck_id=? GROUP BY card_id;', [deckId]);
      for (const r of rows) deckCounts[r.card_id] = r.n;
    } catch { /* empty deck / query failure -> no headroom info, native falls back to the limit */ }
  }

  // Add-actions stream in while the scanner stays open. Writes are ATOMIC (+N upsert)
  // so overlapping same-card taps can't lose an increment; failures are counted and
  // surfaced once the scanner closes (the WebView is behind the Activity, so a toast
  // mid-scan wouldn't be seen).
  // JS owns the session id AND every durable write, so JS is the only party that can say a write
  // committed. Each add is admitted through the registry (dedupe, one mutation in flight, id-reuse
  // rejection), performed, and then ACKNOWLEDGED back to native, which reports success only from that
  // ack. Without this the sheet claimed "Added" before the write had happened - or ever failed.
  const sessionId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const registry = createScannerRegistry();
  const ack = async (ev, ok, extra = {}) => {
    try { await CardScanner.respond({ sessionId, requestId: ev.requestId, ok, ...extra }); } catch { /* native gone */ }
  };

  let failed = 0, deckAdded = 0, deckBlocked = 0;
  const sub = await CardScanner.addListener('scanAction', async (ev) => {
    // FAIL CLOSED: an event without correlation, or from another session, is not something this
    // session can honestly acknowledge - so it is never written. Treating an uncorrelated event as
    // "legacy and therefore fine" is exactly the fire-and-forget behaviour this replaced.
    if (!ev.requestId || !ev.sessionId || ev.sessionId !== sessionId) return;
    const fingerprint = `${ev.action}|${ev.cardId}|${ev.set || ''}|${ev.qty || 1}`;
    const gate = registry.admit(ev.requestId, true, fingerprint);
    if (gate.action === 'ignore') return;
    if (gate.action === 'replay') { await ack(ev, gate.ack?.ok !== false, gate.ack?.extra || {}); return; }
    if (gate.action === 'reject') { await ack(ev, false); return; }
    let ok = false;
    let extra = {};
    try {
      const n = Math.max(1, ev.qty || 1);   // collection/deck modes pick a quantity; universal +1s
      if (ev.action === 'deck') {
        // Deck mode: file the card in its home zone, capped by the rarity copy limit.
        const res = deckId ? await addScannedToDeck(deckId, ev.cardId, n) : { ok: false };
        if (res.ok) deckAdded += n; else deckBlocked += 1;
        ok = !!res.ok;
        if (ok) {
          // Return the AUTHORITATIVE count so the sheet's remaining headroom reflects what the
          // database actually holds, not what native assumed it would.
          try {
            const rows = await query(
              'SELECT SUM(quantity) n FROM deck_entries WHERE deck_id=? AND card_id=?;', [deckId, ev.cardId],
            );
            const n2 = rows?.[0]?.n;
            if (n2 != null) extra = { deckCount: Number(n2) };
          } catch { /* count is a nicety; the ack itself is what matters */ }
        }
      } else if (ev.action === 'collection') {
        // Collection mode sends the chosen printing (ev.set: auto for single-set,
        // user-picked for a reprint). Universal +1 sends none -> auto-file if the
        // card is single-set, else Unspecified.
        const set = ev.set || soleSet(ev.cardId);
        if (set) await addOwnedCopiesInSet(ev.cardId, set, n);
        else await addOwnedCopies(ev.cardId, n);   // multi-set + no pick -> Unspecified
        ok = true;
      } else if (ev.action === 'wishlist') {
        // A want names its collector item. The sheet sends the chosen set (auto for a single-set
        // card, picked for a reprint, and the button is disabled until one exists), so this
        // never has to guess. Without a set the card is not in the catalog, and there is no
        // honest item to want - so it counts as a failure rather than reporting success.
        const wset = ev.set || soleSet(ev.cardId);
        if (wset) {
          await addWantedForItem(ev.cardId, { set: wset, foil: wantFinish(ev.cardId, wset) }, n);
          ok = true;
        }
        else failed += 1;
      }
    } catch { failed += 1; }
    registry.resolve(ev.requestId, { ok, extra }, true);
    await ack(ev, ok, extra);
  });

  // The resolved reduced-motion preference (user setting OR OS `prefers-reduced-motion`,
  // both folded into the body class by appearance.js). Passed into the native scanner so
  // its reveal honours the app-wide reduced-motion contract with deterministic still states.
  const reduceMotion = typeof document !== 'undefined' && document.body.classList.contains('reduce-motion');

  try {
    const cards = await catalogForScan();
    const res = await CardScanner.scan({ cards, mode, deckCounts, reduceMotion, sessionId, deckName });
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
