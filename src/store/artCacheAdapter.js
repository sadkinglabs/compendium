// The native `io` adapter for artCache - the ONLY Capacitor-touching code in the art boundary, so the
// cache core (artCache.js) stays a pure, DOM-free, unit-tested module. Everything here runs on device;
// on web the boundary never calls it (artCache short-circuits to remote URLs). LIVE: the singleton is
// wired into the render sites and caches CDN-served card art on device.
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

/**
 * The io adapter passed to createArtCache. Paths are Directory.Data-relative ('art/<key>', 'art-tmp/…').
 * `fs`/`getHttp` are injectable so the download ORCHESTRATION (the real fallback decision, not a replica)
 * is unit-tested with fakes; production uses the imported Filesystem and the window CapacitorHttp.
 */
export function makeArtIo({ fs = Filesystem, getHttp = nativeHttp, dir = DIR } = {}) {
  const ensureParent = async (p) => {
    const parent = p.replace(/\/[^/]+$/, '');
    if (parent && parent !== p) { try { await fs.mkdir({ path: parent, directory: dir, recursive: true }); } catch { /* exists */ } }
  };
  const hasExactSize = async (path, bytes) => {
    try { const s = await fs.stat({ path, directory: dir }); return (s.size || 0) === bytes; } catch { return false; }
  };
  const deleteIfPresent = async (path) => { try { await fs.deleteFile({ path, directory: dir }); } catch { /* gone */ } };

  return {
    stat: async (path) => {
      try { const s = await fs.stat({ path, directory: dir }); return { size: s.size }; }
      catch { return null; }
    },
    size: async (path) => {
      try { const s = await fs.stat({ path, directory: dir }); return s.size || 0; }
      catch { return 0; }
    },
    // Fetch `url` into `path`, returning true ONLY when the file ends at EXACTLY expectedBytes. Validation
    // decides when to fall back: a truncated (or 404/500-body) downloadFile fails the exact-size check, so
    // CapacitorHttp is really attempted; an HTTP non-2xx or wrong-decoded-size result is rejected, never
    // promoted. (Codex Phase-2a Major 1.)
    download: async (url, path, expectedBytes) => {
      await ensureParent(path);
      // Preferred: native downloadFile straight to disk.
      try {
        await fs.downloadFile({ url, path, directory: dir });
        if (await hasExactSize(path, expectedBytes)) return true;
      } catch { /* fall through */ }
      await deleteIfPresent(path);   // clear a truncated/partial write before the fallback

      // Fallback: CapacitorHttp (CORS-immune on device) -> base64 -> writeFile, then re-validate.
      const http = getHttp();
      if (!http) return false;
      try {
        const res = await http.get({ url, responseType: 'blob' });   // base64 string on native
        if (!res || res.status < 200 || res.status >= 300) return false;   // a 404/500 body is not an image
        if (typeof res.data !== 'string' || !res.data) return false;
        await fs.writeFile({ path, data: res.data, directory: dir });
        if (await hasExactSize(path, expectedBytes)) return true;
        await deleteIfPresent(path);   // wrong decoded size: do not leave the partial behind
        return false;
      } catch { await deleteIfPresent(path); return false; }
    },
    rename: async (from, to) => { await ensureParent(to); await fs.rename({ from, to, directory: dir, toDirectory: dir }); },
    delete: async (path) => { await deleteIfPresent(path); },
    deleteTree: async (path) => { try { await fs.rmdir({ path, directory: dir, recursive: true }); } catch { /* already gone */ } },
    list: async (path) => {
      try { const r = await fs.readdir({ path, directory: dir }); return (r.files || []).map((f) => ({ name: f.name, size: f.size || 0 })); }
      catch { return []; }
    },
  };
}
