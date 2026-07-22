// The app-wide artCache singleton: the pure core (artCache.js) wired to the native io adapter
// (artCacheAdapter.js) and the CDN/zero-image config (cardArt.js). This is what the render sites and
// the useArtSource hook import in Phase 2b. Inert until then.
//
// The manifest is a MUTABLE holder filled by loadArtManifest() at boot, so the singleton can be created
// at import time (before the manifest is fetched) and the core's later reads see the loaded entries.
// With an absent manifest (not yet shipped, or an offline first-run) a key has no entry, so it degrades
// to the REMOTE candidate and then the deterministic fallback - legacy is NOT reachable without the
// manifest's legacyKey. Once the manifest loads, the full local -> remote -> legacy -> fallback chain applies.
import { createArtCache } from './artCache.js';
import { makeArtIo, artConvertFileSrc, initArtIo } from './artCacheAdapter.js';
import { isNative } from '../native.js';
import { imagesDisabled, artUrl, legacyUrl } from './cardArt.js';

const BASE = import.meta.env.BASE_URL;
const manifest = { objects: {} };

/** Fetch the shipped slim art manifest ({ objects: { slug: {key, legacyKey, bytes} } }) into the holder. */
export async function loadArtManifest() {
  try {
    const res = await fetch(`${BASE}catalog/art-manifest.json`);
    if (res.ok) { const m = await res.json(); if (m && m.objects) manifest.objects = m.objects; }
  } catch { /* not shipped yet / offline: empty holder -> remote then deterministic fallback, never a crash */ }
  return manifest;
}

let seq = 0;
export const artCache = createArtCache({
  io: makeArtIo(),
  manifest,
  isNative,
  imagesDisabled,
  remoteUrl: artUrl,
  legacyUrl,
  convertFileSrc: artConvertFileSrc,
  rand: () => `${Date.now().toString(36)}${(seq++).toString(36)}`,
});

/** Boot init: prepare native dirs + cache the Data root, sweep crash-orphan scratch, load the manifest.
 *  Safe on web (no native calls) and native. Call once from the app boot (Phase 2b wires it in). */
export async function initArtCache() {
  if (isNative()) { await initArtIo(); await artCache.sweepScratch(); }
  await loadArtManifest();
}
