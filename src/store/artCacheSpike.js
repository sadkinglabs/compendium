// Phase-2a device probe for the native art-download path. Tests BOTH candidate paths independently -
// Filesystem.downloadFile (preferred) and the CapacitorHttp -> writeFile fallback - plus convertFileSrc,
// and reports which worked, the byte size, and the elapsed ms. Exposed on window.__artSpike so it can be
// invoked from a WebView debugger in a DEBUG build (release builds have no console; there the adapter's
// built-in fallback plus the 2b install-time render is the verification). Remove once recorded.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { isNative } from '../native.js';
import { artConvertFileSrc, initArtIo } from './artCacheAdapter.js';
import { artUrl } from './cardArt.js';

const DIR = Directory.Data;

/** Run the probe against a real content key (must exist on the CDN). Returns a plain report object. */
export async function runArtDownloadSpike(key) {
  const report = { native: isNative(), key, url: key ? artUrl(key) : null };
  if (!isNative()) { report.skipped = 'web (native-only probe)'; return report; }
  if (!key) { report.error = 'pass a real content key present on the CDN'; return report; }
  await initArtIo();
  const url = report.url;

  // Path A: Filesystem.downloadFile straight to disk.
  const a = `art-tmp/spikeA.${Date.now()}.webp`;
  try {
    const t = Date.now();
    await Filesystem.downloadFile({ url, path: a, directory: DIR });
    const s = await Filesystem.stat({ path: a, directory: DIR });
    report.downloadFile = { ok: (s.size || 0) > 0, size: s.size || 0, ms: Date.now() - t };
    report.src = artConvertFileSrc(a);   // does the cached file yield a loadable WebView src?
  } catch (e) { report.downloadFile = { ok: false, error: String(e?.message || e) }; }
  finally { try { await Filesystem.deleteFile({ path: a, directory: DIR }); } catch { /* noop */ } }

  // Path B: CapacitorHttp -> base64 -> writeFile.
  const b = `art-tmp/spikeB.${Date.now()}.webp`;
  try {
    const http = window.CapacitorHttp || window.Capacitor?.Plugins?.CapacitorHttp;
    const t = Date.now();
    const res = await http.get({ url, responseType: 'blob' });
    const data = res?.data;
    if (typeof data === 'string' && data) {
      await Filesystem.writeFile({ path: b, data, directory: DIR });
      const s = await Filesystem.stat({ path: b, directory: DIR });
      report.capacitorHttp = { ok: (s.size || 0) > 0, size: s.size || 0, ms: Date.now() - t };
    } else { report.capacitorHttp = { ok: false, error: 'no base64 data' }; }
  } catch (e) { report.capacitorHttp = { ok: false, error: String(e?.message || e) }; }
  finally { try { await Filesystem.deleteFile({ path: b, directory: DIR }); } catch { /* noop */ } }

  report.capacitorVersion = Capacitor.getPlatform?.();
  return report;
}

if (typeof window !== 'undefined') {
  try { window.__artSpike = runArtDownloadSpike; } catch { /* noop */ }
}
