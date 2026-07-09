// Peer-to-peer match sharing - fully offline, no server. At match end the
// tracking player shows a QR encoding a deep link (compendium://match?d=...);
// the opponent's phone camera opens Compendium straight onto an import screen.
//
// The payload is ALREADY MIRRORED to the opponent's perspective: their life and
// the tracker's life are swapped, the winner is flipped, the tracker becomes
// their opponent (name + avatar), and NO deck is carried (they attribute their
// own). So the import side is dumb - it just lands the payload in a review form.
import { getActiveProfile } from './profileRepository.js';
import { nowIso } from './ids.js';

const VERSION = 1;

// URL-safe base64 (no +, /, or = padding) so the value survives inside a URL.
const b64uEncode = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDecode = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
const flip = (w) => (w === 'player' ? 'opponent' : w === 'opponent' ? 'player' : 'draw');

/** Build the opponent-perspective share for a just-finished match.
 *  Inputs are from the TRACKER's point of view (player = me, opponent = them).
 *  Returns { link, payload }. */
export async function buildMatchShare({ winner, pLife, eLife, durationSec, playedAt, youAvatarName, oppAvatarName }) {
  const me = await getActiveProfile();
  const payload = {
    v: VERSION,
    winner: flip(winner),                       // I won -> they lost
    playerFinalLife: eLife ?? null,             // their own final life
    opponentFinalLife: pLife ?? null,           // my life becomes their opponent's
    playerAvatar: oppAvatarName || null,        // what I recorded as their avatar (they can change)
    opponentAvatar: youAvatarName || null,      // my avatar is now their opponent
    opponentName: (me && me.name) || 'Opponent',// the person who tracked it
    playedAt: playedAt || nowIso(),
    durationSec: durationSec || 0,
  };
  const link = `compendium://match?d=${b64uEncode(JSON.stringify(payload))}`;
  return { link, payload };
}

/** Parse an incoming deep link (or a pasted link / raw d value) into a validated
 *  mirrored-match payload, or null if it isn't one of ours. */
export function parseMatchShare(input) {
  if (!input || typeof input !== 'string') return null;
  try {
    let d = null;
    const s = input.trim();
    if (/^compendium:\/\/match\b/i.test(s)) {
      const q = s.split('?')[1] || '';
      d = new URLSearchParams(q).get('d');
    } else {
      d = s;   // assume a bare base64url payload (pasted)
    }
    if (!d) return null;
    const obj = JSON.parse(b64uDecode(d));
    if (!obj || typeof obj !== 'object' || obj.v !== VERSION) return null;
    if (!['player', 'opponent', 'draw'].includes(obj.winner)) return null;
    return obj;
  } catch { return null; }
}
