// Phase-2a device probe for the native art-download path. Verifies BOTH candidate paths INDEPENDENTLY -
// Filesystem.downloadFile (primary) and CapacitorHttp -> writeFile (fallback) - each requiring an EXACT
// decoded byte count (not merely > 0) and, for HTTP, a 2xx status; then runs the real orchestrated
// io.download and returns its cached src so the panel can load it into an actual <img>. Records device
// details for the record. Behind a build-time flag (VITE_ART_SPIKE) so it is absent from normal builds;
// removed once the result is recorded. See docs/proposals/art-cdn-phase2-2a-review-brief.md.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { isNative } from '../native.js';
import { makeArtIo, artConvertFileSrc, initArtIo } from './artCacheAdapter.js';
import { artUrl } from './cardArt.js';

const DIR = Directory.Data;
const FILESYSTEM_VERSION = '6.0.4';   // @capacitor/filesystem pin

const deviceInfo = () => ({
  platform: Capacitor.getPlatform?.() ?? 'unknown',
  userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',   // carries model + Android + WebView(Chrome) version
  filesystem: FILESYSTEM_VERSION,
});

async function probeDownloadFile(url, expectedBytes) {
  const path = `art-tmp/spikeA.${Date.now()}.webp`;
  const out = { path: 'downloadFile' };
  try {
    const t = Date.now();
    await Filesystem.downloadFile({ url, path, directory: DIR });
    const s = await Filesystem.stat({ path, directory: DIR });
    out.size = s.size || 0; out.exact = out.size === expectedBytes; out.ok = out.exact; out.ms = Date.now() - t;
    out.src = artConvertFileSrc(path);
  } catch (e) { out.ok = false; out.error = String(e?.message || e); }
  finally { try { await Filesystem.deleteFile({ path, directory: DIR }); } catch { /* noop */ } }
  return out;
}

async function probeCapacitorHttp(url, expectedBytes) {
  const path = `art-tmp/spikeB.${Date.now()}.webp`;
  const out = { path: 'capacitorHttp' };
  try {
    const http = window.CapacitorHttp || window.Capacitor?.Plugins?.CapacitorHttp;
    const t = Date.now();
    const res = await http.get({ url, responseType: 'blob' });
    out.status = res?.status;
    if (res?.status >= 200 && res?.status < 300 && typeof res.data === 'string' && res.data) {
      await Filesystem.writeFile({ path, data: res.data, directory: DIR });
      const s = await Filesystem.stat({ path, directory: DIR });
      out.size = s.size || 0; out.exact = out.size === expectedBytes; out.ok = out.exact; out.ms = Date.now() - t;
    } else { out.ok = false; out.error = `status ${res?.status}`; }
  } catch (e) { out.ok = false; out.error = String(e?.message || e); }
  finally { try { await Filesystem.deleteFile({ path, directory: DIR }); } catch { /* noop */ } }
  return out;
}

/**
 * @param key           a real content key that EXISTS on the CDN
 * @param expectedBytes its manifest byte count (exact-size gate)
 */
export async function runArtDownloadSpike(key, expectedBytes) {
  const report = { device: deviceInfo(), key, expectedBytes, url: key ? artUrl(key) : null };
  if (!isNative()) { report.skipped = 'web (native-only probe)'; return report; }
  if (!key || !Number.isInteger(expectedBytes)) { report.error = 'pass a real CDN content key and its exact byte count'; return report; }
  await initArtIo();
  report.downloadFile = await probeDownloadFile(report.url, expectedBytes);   // primary, independently
  report.capacitorHttp = await probeCapacitorHttp(report.url, expectedBytes); // fallback, independently

  // The real orchestrated path (the one production uses), returning a promotable cached src for the <img>.
  const io = makeArtIo();
  const tmp = `art-tmp/spikeC.${Date.now()}.webp`;
  try {
    const ok = await io.download(report.url, tmp, expectedBytes);
    report.orchestrated = { ok, size: await io.size(tmp), src: ok ? artConvertFileSrc(tmp) : null };
    // NOTE: left in art-tmp so the panel can load report.orchestrated.src into an <img>; swept on next boot.
  } catch (e) { report.orchestrated = { ok: false, error: String(e?.message || e) }; }
  return report;
}

if (typeof window !== 'undefined') {
  try { window.__artSpike = runArtDownloadSpike; } catch { /* noop */ }
}
