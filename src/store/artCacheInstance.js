// The app-wide artCache singleton: the pure core (artCache.js) wired to the native io adapter
// (artCacheAdapter.js) and the CDN/zero-image config (cardArt.js). This is what the render sites and
// the useArtSource hook import in Phase 2b. Inert until then.
//
// The manifest is a MUTABLE holder filled by loadArtManifest() at boot, so the singleton can be created
// at import time (before the manifest is fetched) and the core's later reads see the loaded entries.
// With an absent manifest (not yet shipped, or an offline first-run) a key has no entry, so it degrades
// to the REMOTE candidate and then the deterministic fallback. Once the manifest loads, the local ->
// remote -> deterministic-fallback chain applies (Phase 5 removed the bundled 'legacy' step).
import { createArtCache } from './artCache.js';
import { makeArtIo, artConvertFileSrc, initArtIo } from './artCacheAdapter.js';
import { isNative } from '../native.js';
import { imagesDisabled, artUrl } from './cardArt.js';

const BASE = import.meta.env.BASE_URL;
const manifest = { objects: {} };

/** Fetch the shipped art manifest into the holder. It is the FULL manifest ({ tier, objects: { slug:
 *  {key, sha256, md5, bytes, srcSha256, recipeId, encoder} } }) - one file serves the app and the
 *  pipeline's skip oracle - but artCache reads only key/bytes and ignores the rest. */
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
  convertFileSrc: artConvertFileSrc,
  rand: () => `${Date.now().toString(36)}${(seq++).toString(36)}`,
});

/** Boot init: prepare native dirs + cache the Data root, sweep crash-orphan scratch, load the
 *  manifest, then warm peek()'s memo from disk. Safe on web (no native calls) and native.
 *  Call once from the app boot (Phase 2b wires it in). */
export async function initArtCache() {
  if (isNative()) { await initArtIo(); await artCache.sweepScratch(); }
  await loadArtManifest();
  // AFTER the manifest, necessarily: seeding admits a file only when its size matches the manifest's
  // byte count, so with an empty holder it would admit nothing. One directory list; the log line is
  // the Increment 2 measurement (visible in logcat via the WebView console bridge).
  const t0 = Date.now();
  const seeded = await artCache.seedFromDisk();
  if (seeded > 0) console.info(`art: seeded ${seeded} cached entries in ${Date.now() - t0}ms`);
}
