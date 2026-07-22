// The app-wide artCache singleton: the pure core (artCache.js) wired to the native io adapter
// (artCacheAdapter.js) and the CDN/zero-image config (cardArt.js). This is what the render sites and
// the useArtSource hook import in Phase 2b. Inert until then.
//
// The manifest is a MUTABLE holder filled by loadArtManifest() at boot, so the singleton can be created
// at import time (before the manifest is fetched) and the core's later reads see the loaded entries. An
// absent manifest (not yet shipped, or offline first-run) degrades safely: unknown keys resolve to the
// remote candidate / bundled legacy, never a crash.
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
  } catch { /* not shipped yet / offline: empty holder -> remote or legacy fallback, never a crash */ }
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
