// The native `io` adapter for artCache - the ONLY Capacitor-touching code in the art boundary, so the
// cache core (artCache.js) stays a pure, DOM-free, unit-tested module. Everything here runs on device;
// on web the boundary never calls it (artCache short-circuits to remote URLs). Inert until Phase 2b
// wires the singleton into the render sites.
//
// Two device-specific concerns handled here:
//   1. convertFileSrc must be SYNC (the cache returns a src immediately), but a Directory.Data path is
//      only known async. So initArtIo() caches the Data ROOT uri once; artConvertFileSrc then builds the
//      full uri synchronously and hands it to Capacitor.convertFileSrc.
//   2. download prefers Filesystem.downloadFile (straight to disk); if that fails/throws (the 6.0.4
//      reliability risk the proposal flags), it falls back to CapacitorHttp -> base64 -> writeFile, the
//      same CORS-immune native-HTTP path deckRepository.js already uses.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

const DIR = Directory.Data;
let rootUri = null;   // cached Directory.Data root for a synchronous convertFileSrc

/** Ensure the art dirs exist and cache the Data root uri. Call once at boot before the first resolve. */
export async function initArtIo() {
  for (const d of ['art', 'art-tmp']) {
    try { await Filesystem.mkdir({ path: d, directory: DIR, recursive: true }); } catch { /* already exists */ }
  }
  try { const u = await Filesystem.getUri({ path: 'art', directory: DIR }); rootUri = u.uri.replace(/\/art$/, ''); }
  catch { rootUri = null; }
}

/** A Directory.Data-relative path -> a WebView-loadable src. Sync (uses the cached root). */
export function artConvertFileSrc(relPath) {
  const uri = rootUri ? `${rootUri}/${relPath}` : relPath;
  return Capacitor.convertFileSrc(uri);
}

// The CapacitorHttp plugin off `window` (native only), mirroring deckRepository.js:532-536.
function nativeHttp() {
  if (typeof window === 'undefined') return null;
  const native = window.Capacitor?.isNativePlatform?.() === true;
  return native ? (window.CapacitorHttp || window.Capacitor?.Plugins?.CapacitorHttp || null) : null;
}

const ensureParent = async (p) => {
  const dir = p.replace(/\/[^/]+$/, '');
  if (dir && dir !== p) { try { await Filesystem.mkdir({ path: dir, directory: DIR, recursive: true }); } catch { /* exists */ } }
};

/** The io adapter passed to createArtCache. Paths are Directory.Data-relative ('art/<key>', 'art-tmp/…'). */
export function makeArtIo() {
  return {
    stat: async (path) => {
      try { const s = await Filesystem.stat({ path, directory: DIR }); return { size: s.size }; }
      catch { return null; }
    },
    size: async (path) => {
      try { const s = await Filesystem.stat({ path, directory: DIR }); return s.size || 0; }
      catch { return 0; }
    },
    download: async (url, path) => {
      await ensureParent(path);
      // Preferred: native downloadFile straight to disk.
      try {
        await Filesystem.downloadFile({ url, path, directory: DIR });
        const s = await Filesystem.stat({ path, directory: DIR }).catch(() => null);
        if (s && s.size > 0) return true;
      } catch { /* fall through to the CapacitorHttp fallback */ }
      // Fallback: CapacitorHttp (CORS-immune on device) -> base64 -> writeFile.
      const http = nativeHttp();
      if (!http) return false;
      try {
        const res = await http.get({ url, responseType: 'blob' });   // base64 string on native
        const data = res?.data;
        if (typeof data !== 'string' || !data) return false;
        await Filesystem.writeFile({ path, data, directory: DIR });
        return true;
      } catch { return false; }
    },
    rename: async (from, to) => { await ensureParent(to); await Filesystem.rename({ from, to, directory: DIR, toDirectory: DIR }); },
    delete: async (path) => { try { await Filesystem.deleteFile({ path, directory: DIR }); } catch { /* already gone */ } },
    deleteTree: async (dir) => { try { await Filesystem.rmdir({ path: dir, directory: DIR, recursive: true }); } catch { /* already gone */ } },
    list: async (dir) => {
      try { const r = await Filesystem.readdir({ path: dir, directory: DIR }); return (r.files || []).map((f) => ({ name: f.name, size: f.size || 0 })); }
      catch { return []; }
    },
  };
}
