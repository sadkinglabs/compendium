// Capacitor-native bridges with web-safe fallbacks (handoff §6: prefer native
// plugins over web shims). Every call is a no-op or graceful web equivalent in
// the browser, so the dev preview keeps working.
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

export const isNative = () => Capacitor.isNativePlatform();

/** One-time native chrome setup (status bar tint to the grimoire ground). */
export async function initNative() {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#120d09' });
    await StatusBar.show();   // recover if a crash left the bar hidden mid-immersive
  } catch { /* status bar not available */ }
}

/** Haptic tap — native impact on device, navigator.vibrate on web. */
export function haptic(kind = 'light') {
  if (isNative()) {
    const style = kind === 'medium' ? ImpactStyle.Medium : kind === 'heavy' ? ImpactStyle.Heavy : ImpactStyle.Light;
    Haptics.impact({ style }).catch(() => {});
  } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(kind === 'heavy' ? 18 : kind === 'medium' ? 12 : 6); } catch { /* noop */ }
  }
}

/** Register a hardware back-button handler (native only). Returns an unsubscribe. */
export function onBackButton(handler) {
  if (!isNative()) return () => {};
  let sub;
  App.addListener('backButton', (info) => handler(info)).then((s) => { sub = s; });
  return () => { try { sub?.remove?.(); } catch { /* noop */ } };
}

/** Exit the app (native only — used when back has nowhere left to go). */
export function exitApp() { if (isNative()) App.exitApp(); }

/** Save a text file. Native: Filesystem (cache) + Share sheet. Web: blob download. */
export async function saveTextFile(filename, text, mime = 'application/json') {
  if (isNative()) {
    try {
      const res = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
      try { await Share.share({ title: filename, url: res.uri }); } catch { /* user dismissed */ }
      return 'shared';
    } catch { return 'failed'; }
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

/** Share a canvas as a PNG. Native: Filesystem cache + Share sheet. Web: download. */
export async function shareImage(canvas, filename, title) {
  if (isNative()) {
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    try {
      const res = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
      await Share.share({ title, files: [res.uri], dialogTitle: title });
      return 'shared';
    } catch { return 'cancelled'; }
  }
  return new Promise((resolve) => canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000); resolve('downloaded');
  }, 'image/png'));
}

/** Hide/show the status bar (immersive match mode). Native only; web no-op. */
export async function setImmersive(on) {
  if (!isNative()) return;
  try { if (on) await StatusBar.hide(); else await StatusBar.show(); } catch { /* not available */ }
}

/** Keep the screen awake (Web Wake Lock API — works in the WebView too). */
let wakeLock = null;
export async function setKeepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* unsupported or blocked */ }
}
