// Release-APK smoke gate: does the installed app actually START and RENDER?
//
// WHY THIS EXISTS. A latent circular import blanked the whole app on launch in the MINIFIED
// release build while every other gate was green - all four test:* suites, check:types,
// check:docs and `npm run build`. The unminified build was fine, so nothing short of running
// the real signed artifact could see it. `check:cycles` closes the cycle case; this closes the
// general one: whatever the cause, if the app does not render, this fails.
//
// WHAT IT ASSERTS. For each route it drives, the rendered accessibility tree must contain the
// expected text. That is deliberately a RENDER assertion, not an absence-of-errors assertion:
// the failure we actually shipped logged one error and drew nothing, and a gate that only
// greps logs would have to be told which errors are fatal. "Did the screen draw the thing"
// needs no such judgement.
//
// Console errors are ALSO reported when Capacitor is forwarding them (loggingBehavior:
// 'production'), but their absence is never treated as evidence of health, because a stock
// release build does not forward console at all.
//
// PORTABILITY. Elements are located by their text and tapped at the centre of their reported
// bounds, never at hard-coded pixels, so this survives a different device or display size.
//
// KNOWN LIMITATION - IT CANNOT DRIVE FAB MENUS. `.fab-menu` transitions from scale(.18) to
// scale(1), and the WebView accessibility tree keeps reporting the PRE-transition geometry:
// 93 device px wide for a menu whose min-width is 170 CSS px. Tapping the reported centre
// hits the wrong item; tapping the true visual centre dismisses the menu.
//
// A human tap works correctly, so rendering and hit-testing agree - only the a11y tree is
// stale. That still matters for assistive tech, but it is NOT a user-facing hit-test bug, and
// this gate must never be used to conclude a FAB menu is broken. Routes therefore stay on nav
// tabs, chips and tiles; anything behind a FAB menu needs a human.
//
// Requires: a connected device with the app already installed (npm run android, then install
// the release APK). Run: npm run check:smoke
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = 'com.sadkinglabs.compendium';

/* ---------------- pure helpers (unit-tested) ---------------- */

/** Parse a uiautomator dump into [{ text, bounds }]. Nodes without text are dropped. */
export function parseUi(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<node\b([^>]*)>/g)) {
    const attrs = m[1];
    const text = /\btext="([^"]*)"/.exec(attrs)?.[1] || '';
    const b = /\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(attrs);
    if (!text || !b) continue;
    out.push({
      text,
      bounds: { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] },
    });
  }
  return out;
}

export function centerOf(bounds) {
  return { x: Math.round((bounds.x1 + bounds.x2) / 2), y: Math.round((bounds.y1 + bounds.y2) / 2) };
}

/** All rendered text as one lowercased haystack, for substring assertions. */
export function screenText(nodes) {
  return nodes.map((n) => n.text).join(' ␟ ').toLowerCase();
}

/**
 * Locate a tap target by text. EXACT matches win over substring matches.
 *
 * That precedence is not cosmetic. With substring-first, a route tapping "Decks" matched the
 * Home screen's "YOUR DECKS 2 All" section header instead of the bottom-nav tab, opened a
 * deck, and every following route failed against the wrong screen. Nav labels are exact
 * strings, so preferring them makes the common case unambiguous.
 */
export function findNode(nodes, label) {
  const want = String(label).toLowerCase();
  return nodes.find((n) => n.text.toLowerCase().trim() === want)
      || nodes.find((n) => n.text.toLowerCase().includes(want))
      || null;
}

/** Which of `expect` are missing from the rendered text. */
export function missingFrom(nodes, expect) {
  const hay = screenText(nodes);
  return expect.filter((e) => !hay.includes(String(e).toLowerCase()));
}

/**
 * The routes. One per pillar, plus the Collection set drill - the surface that actually broke,
 * and the one most exercised by the current increment.
 *
 * `tap` entries are matched by text, so they describe intent rather than geometry. Keep the
 * expectations to durable chrome (pillar names, section rubrics) rather than user data, so the
 * gate does not depend on what happens to be in the tester's collection.
 *
 * Each path is SELF-CONTAINED from the bottom nav rather than assuming where the previous
 * route left off. Re-tapping the current tab is a no-op, and the cost is a few extra taps; the
 * benefit is that one broken route reports one failure instead of cascading into every route
 * after it and burying the real cause.
 */
export const ROUTES = [
  { name: 'Home (launch)', tap: [], expect: ['welcome back'] },
  { name: 'Codex', tap: ['Codex'], expect: ['rules', 'cards'] },
  { name: 'Decks', tap: ['Decks'], expect: ['library'] },
  { name: 'Play', tap: ['Play'], expect: ['play'] },
  { name: 'Collection > Overview', tap: ['Collection'], expect: ['overview', 'my collection', 'lists'] },
  { name: 'Collection > My Collection', tap: ['Collection', 'My Collection'], expect: ['sets'] },
  { name: 'Collection > set drill', tap: ['Collection', 'My Collection', 'BETA'], expect: ['card'] },
  { name: 'Collection > Lists', tap: ['Collection', 'Lists'], expect: ['wishlist'] },
];

/* ---------------- device driver ---------------- */

function makeAdb(binary, serial) {
  return (args) => execFileSync(binary, ['-s', serial, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function resolveAdb() {
  const candidates = [
    process.env.ADB,
    path.join(os.homedir(), 'AppData/Local/Android/Sdk/platform-tools/adb.exe'),
    path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb'),
    path.join(os.homedir(), 'Android/Sdk/platform-tools/adb'),
    'adb',
  ].filter(Boolean);
  for (const c of candidates) {
    try { execFileSync(c, ['version'], { stdio: 'ignore' }); return c; } catch { /* next */ }
  }
  return null;
}

/**
 * Is the display actually on? `dumpsys power` reports both a wakefulness state and a display
 * power state; either being off means uiautomator returns an EMPTY view tree.
 *
 * This matters more than it sounds. A screen-off phone produces exactly the same signal as a
 * blanked app - no nodes - and the gate's headline failure is "NOTHING RENDERED". Reporting a
 * dark screen as a rendering fault sends you hunting a bug that does not exist; it cost me an
 * hour of chasing a boot crash that was never happening.
 */
export function isScreenOn(dumpsysPower) {
  const s = String(dumpsysPower);
  if (/Display Power:\s*state=OFF/i.test(s)) return false;
  if (/mWakefulness=(Asleep|Dozing)/i.test(s)) return false;
  if (/mScreenOn=false/i.test(s)) return false;
  return /mWakefulness=Awake/i.test(s) || /Display Power:\s*state=ON/i.test(s);
}

/** True when the lock screen is up - the app is running but nothing of it is visible. */
export function isLocked(dumpsysWindow) {
  return /mDreamingLockscreen=true|mShowingLockscreen=true|isStatusBarKeyguard=true/i.test(String(dumpsysWindow));
}

export function parseDevices(output) {
  return String(output).split('\n').slice(1)
    .map((l) => l.trim()).filter(Boolean)
    .filter((l) => /\sdevice$/.test(l))
    .map((l) => l.split(/\s+/)[0]);
}

/* ---------------- the gate ---------------- */

export async function run({ adb, sleep, routes = ROUTES, log = console.log, err = console.error }) {
  const dumpPath = '/sdcard/cx-smoke.xml';
  const failures = [];

  // WAKE THE SCREEN FIRST, and refuse to run in the dark. A dark or locked phone yields an
  // empty view tree, which is indistinguishable from a blanked app - so without this the gate
  // confidently reports a rendering failure that never happened.
  if (!isScreenOn(adb(['shell', 'dumpsys', 'power']))) {
    adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
    await sleep(1200);
  }
  if (!isScreenOn(adb(['shell', 'dumpsys', 'power']))) {
    err('check:smoke FAILED - the device screen is OFF and would not wake.');
    err('  Every route would look like a rendering failure, and none of it would mean anything.');
    return 1;
  }
  if (isLocked(adb(['shell', 'dumpsys', 'window']))) {
    err('check:smoke FAILED - the device is LOCKED, so the app is not visible.');
    err('  Unlock the phone and run again; a locked screen looks exactly like a blank app.');
    return 1;
  }

  adb(['shell', 'am', 'force-stop', PKG]);
  adb(['logcat', '-c']);
  adb(['shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1']);
  await sleep(9000);

  for (const route of routes) {
    for (const label of route.tap) {
      const before = parseUi(readDump(adb, dumpPath));
      const node = findNode(before, label);
      if (!node) {
        failures.push(`${route.name}: could not find "${label}" to tap`);
        break;
      }
      const { x, y } = centerOf(node.bounds);
      adb(['shell', 'input', 'tap', String(x), String(y)]);
      await sleep(3500);
    }
    const nodes = parseUi(readDump(adb, dumpPath));
    if (!nodes.length) {
      // The signature failure: the app is running but drew nothing at all.
      failures.push(`${route.name}: NOTHING RENDERED (empty view tree - the app drew a blank screen)`);
      continue;
    }
    const missing = missingFrom(nodes, route.expect);
    if (missing.length) failures.push(`${route.name}: missing ${missing.map((m) => `"${m}"`).join(', ')}`);
    else log(`  ok  ${route.name}`);
  }

  // Reported for diagnosis; never used as evidence of health, since a stock release build
  // does not forward console to logcat at all.
  let consoleErrors = [];
  try {
    consoleErrors = String(adb(['logcat', '-d']))
      .split('\n').filter((l) => /E Capacitor\/Console/.test(l));
  } catch { /* logcat unavailable - not fatal */ }

  if (consoleErrors.length) {
    err('\ncheck:smoke - JS console errors on device:');
    for (const l of consoleErrors.slice(0, 10)) err(`  ${l.trim()}`);
    failures.push(`${consoleErrors.length} JS console error(s)`);
  }

  if (failures.length) {
    err(`\ncheck:smoke FAILED - ${failures.length} problem(s):`);
    for (const f of failures) err(`  - ${f}`);
    return 1;
  }
  log(`check:smoke OK - ${routes.length} routes rendered on device`);
  return 0;
}

function readDump(adb, dumpPath) {
  adb(['shell', 'uiautomator', 'dump', dumpPath]);
  return adb(['shell', 'cat', dumpPath]);
}

/* ---------------- entry ---------------- */

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const binary = resolveAdb();
  if (!binary) {
    console.error('check:smoke FAILED - adb not found. Set ADB=/path/to/adb or add it to PATH.');
    process.exit(1);
  }
  let serials;
  try {
    serials = parseDevices(execFileSync(binary, ['devices'], { encoding: 'utf8' }));
  } catch (e) {
    console.error(`check:smoke FAILED - could not list devices: ${e.message}`);
    process.exit(1);
  }
  // Fail closed on both zero and many: a gate that silently picks a device is a gate that can
  // silently test the wrong thing. ANDROID_SERIAL is the explicit opt-out - one phone attached
  // over BOTH usb and wireless debugging shows up as two entries, which is common enough that
  // refusing to run without an escape hatch just makes the gate unusable.
  const wanted = process.env.ANDROID_SERIAL;
  if (wanted && !serials.includes(wanted)) {
    console.error(`check:smoke FAILED - ANDROID_SERIAL=${wanted} is not attached.`);
    if (serials.length) console.error(`  attached: ${serials.join(', ')}`);
    process.exit(1);
  }
  if (!wanted && serials.length !== 1) {
    console.error(`check:smoke FAILED - expected exactly 1 connected device, found ${serials.length}.`);
    if (serials.length) console.error(`  ${serials.join('\n  ')}`);
    console.error('  Set ANDROID_SERIAL=<serial> to choose one.');
    process.exit(1);
  }
  const adb = makeAdb(binary, wanted || serials[0]);
  try {
    adb(['shell', 'pm', 'path', PKG]);
  } catch {
    console.error(`check:smoke FAILED - ${PKG} is not installed on ${serials[0]}.`);
    console.error('  Build and install the release APK first (see BUILD.md).');
    process.exit(1);
  }
  console.log(`check:smoke - driving ${wanted || serials[0]}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  run({ adb, sleep }).then((code) => process.exit(code));
}
