// The telemetry consent client. Run: npm run test:query
//
// WHY THIS LIVES IN src/store/ AND NOT src/
//
// Two reasons, and the second is the load-bearing one. It is app-global device state
// like changelog.js's seen-stamp next door, so it belongs to the same tier. And
// test:query globs `src/store/**/*.test.mjs` - at src/telemetry.js its test would be
// matched by NO glob (test:codex is scripts/codex/**, test:ui is src/pillars/**) and
// would pass green forever by never running. changelog.test.mjs records the same trap.
// If you move this file, check the globs in package.json first.
//
// THIS FILE IS NOT THE AUTHORITY. TelemetryPlugin.kt is - it owns the consent value
// (native SharedPreferences) and every Firebase call. This is the surface that asks
// it questions and renders the answer. The split matters: consent must be readable
// and enforceable without a WebView, and it must survive whatever the web layer does.
//
// THE ONE RULE
//
// Consent moves to `granted` ONLY through grantConsent(), and grantConsent() is
// called from exactly TWO places, both of which show the user the disclosure text:
//   - src/components/TelemetryDisclosure.jsx   (the first-run modal)
//   - src/App.jsx SettingsModal PRIVACY row    (the labelled control, hint copy = the disclosure)
// This is enforced by a test that counts the callers, not by the type system. If you
// are adding a third caller, it must show the disclosure, or the property is gone and
// nothing will fail to tell you.
//
// WEB
//
// There is no Firebase in the browser dev runtime. Every call here no-ops and reports
// `unset`, so `npm run dev` neither crashes nor lies about having turned something off.
// A browser pass proves nothing about this file; only Android does.
import { registerPlugin } from '@capacitor/core';
import { isNative } from '../native.js';

const Telemetry = registerPlugin('Telemetry');

export const UNSET = 'unset';
/** Consent given, pre-consent cleanup NOT yet proven complete. Crashlytics stays off
 *  until a boot can prove the report queue is empty - see Consent.kt. Transitional, and
 *  the app must never treat it as `unset` (that would re-ask someone who already said
 *  yes) nor as `granted` (that would claim a guarantee it has not earned). */
export const GRANTING = 'granting';
export const GRANTED = 'granted';
export const DENIED = 'denied';

/** Anything unrecognised - including a native error - collapses to `unset`. Fail-safe
 *  is the OFF direction: `unset` shows the disclosure and collects nothing, so the
 *  worst case of a broken read is asking again.
 *
 *  Exported for the tests, which is the only pure logic in this file worth pinning -
 *  everything else is a bridge call whose real behaviour only exists on a device. */
export function normaliseConsent(value) {
  return value === GRANTED || value === DENIED || value === GRANTING ? value : UNSET;
}
const normalise = normaliseConsent;

/** What the toggle shows. `granting` reads as ON: the user did consent and Analytics is
 *  already running - only the Crashlytics half is still settling, which the disclosure
 *  describes as "takes full effect next time you open the app". */
export const isOn = (state) => state === GRANTED || state === GRANTING;

/** Does the disclosure still need answering? ONLY `unset`. `granting` means answered. */
export const needsDisclosure = (state) => state === UNSET;

/** The recorded decision. `unset` on web, and on any native failure. */
export async function getConsent() {
  if (!isNative()) return UNSET;
  try {
    return normalise((await Telemetry.getConsent())?.consent);
  } catch {
    return UNSET;
  }
}

/**
 * Assert SDK state against recorded consent. Call once per boot, after first paint.
 *
 * Not optional and not cosmetic: the manifest flags are the initial default only, and
 * a persisted runtime override beats them once anything has ever been granted. Without
 * this, a granted-then-denied install whose disable call was interrupted boots with
 * collection live and Settings reporting off.
 *
 * Fire-and-forget by design - this must never block the boot path of an offline-first
 * app.
 *
 * Returns `null` on web, meaning NOT APPLICABLE - distinct from `unset`, which means
 * "telemetry exists here and has not been answered". The caller shows the disclosure
 * only for `unset`. Collapsing the two would ask a browser to consent to a Firebase
 * that isn't there, and since grantConsent() also no-ops on web the accept button
 * could never dismiss it: a modal stuck open on every `npm run dev` session.
 */
export async function reconcile() {
  if (!isNative()) return null;
  try {
    return normalise((await Telemetry.reconcile())?.consent);
  } catch {
    return UNSET;   // native, but the bridge failed: ask again rather than assume
  }
}

/**
 * Turn telemetry ON. Only from a surface that has shown the disclosure - see THE ONE
 * RULE above.
 *
 * The plugin deletes any reports gathered before consent BEFORE enabling anything, and
 * REJECTS if it could not. Crashlytics deliberately does not start until the next boot:
 * the deletion is asynchronous and the SDK discards its own completion Task, so enabling
 * it now would race the delete and a pre-consent crash could upload after consent.
 *
 * On rejection this re-reads what is ACTUALLY stored, so the caller renders the truth
 * rather than an optimistic guess.
 */
export async function grantConsent() {
  if (!isNative()) return UNSET;
  try {
    return normalise((await Telemetry.grant())?.consent);
  } catch {
    return await getConsent();
  }
}

/**
 * Turn telemetry OFF.
 *
 * The plugin rejects if either SDK could not be disabled, and in that case `denied` is
 * NEVER persisted - so this returns the PREVIOUS state and the UI keeps showing ON.
 * That is deliberate and it is the whole point: the attempted change failed, which is
 * honest. Showing OFF while an SDK kept a live collection override would be a privacy
 * lie, which is the one thing this feature exists to prevent.
 */
export async function denyConsent() {
  if (!isNative()) return UNSET;
  try {
    return normalise((await Telemetry.deny())?.consent);
  } catch {
    return await getConsent();
  }
}
