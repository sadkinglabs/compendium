// Peer-to-peer deck sharing - fully offline, no server. My Deck > Export > Compendium
// shows a QR + link (compendium://deck?d=...); the recipient's scanner (or a tapped
// link) imports it into a new deck. Mirrors matchShare.js, but a decklist is bigger,
// so the payload is DEFLATED (fflate) before base64url - a full deck stays a compact,
// reliably-scannable QR instead of a dense one.
//
// Encoding: card_id STRINGS (self-describing, survive catalog updates - card_id is the
// stable canonical key) for { name, avatar, spellbook[], atlas[] }. The importer drops
// any card_id its catalog doesn't know, so a version mismatch degrades gracefully.
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import { getDeck, getDeckCards } from './deckRepository.js';

const VERSION = 1;

// URL-safe base64 over raw bytes (no +, /, or = padding) so it survives inside a URL.
const bytesToB64u = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64uToBytes = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const entries = (list) => (list || [])
  .filter((e) => e.card_id && e.quantity > 0)
  .map((e) => [e.card_id, e.quantity]);

/** Build a shareable link + QR payload for a deck. Returns { link, payload, cards }. */
export async function buildDeckShare(deckId) {
  const deck = await getDeck(deckId);
  const zones = await getDeckCards(deckId);
  const payload = {
    v: VERSION,
    n: (deck?.name || 'Deck').slice(0, 80),
    a: deck?.avatar_card_id || null,
    s: entries(zones.spellbook),   // spellbook
    t: entries(zones.atlas),       // atlas (sites)
  };
  const encoded = bytesToB64u(deflateSync(strToU8(JSON.stringify(payload))));
  const cards = payload.s.reduce((n, [, q]) => n + q, 0) + payload.t.reduce((n, [, q]) => n + q, 0);
  return { link: `compendium://deck?d=${encoded}`, payload, cards };
}

/** Parse a deep link / pasted link / bare payload into a validated deck payload, or
 *  null if it isn't one of ours. */
export function parseDeckShare(input) {
  if (!input || typeof input !== 'string') return null;
  try {
    const s = input.trim();
    let d = null;
    if (/^compendium:\/\/deck\b/i.test(s)) d = new URLSearchParams(s.split('?')[1] || '').get('d');
    else d = s;   // a bare base64url payload
    if (!d) return null;
    const obj = JSON.parse(strFromU8(inflateSync(b64uToBytes(d))));
    if (!obj || typeof obj !== 'object' || obj.v !== VERSION || !Array.isArray(obj.s)) return null;
    return obj;
  } catch { return null; }
}
