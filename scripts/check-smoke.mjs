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
    // content-desc too: icon buttons and nav items often carry no text, and a marker that
    // exists only as an accessible label ("Back to sets", "Select cards") is exactly the kind
    // that is unique to one screen rather than global chrome.
    const desc = /\bcontent-desc="([^"]*)"/.exec(attrs)?.[1] || '';
    const b = /\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(attrs);
    if ((!text && !desc) || !b) continue;
    out.push({
      text: text || desc,
      desc,
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

/**
 * Which of `expect` are missing from the rendered text.
 *
 * An entry may be an ARRAY, meaning "any one of these" - for a destination whose
 * marker legitimately differs by data state. It is deliberately narrow: every
 * alternative must still be unique to the destination, so a route cannot pass on
 * text the previous screen also shows. Without it a route has to pick one state's
 * marker and then fails on a fixture that is merely different, not broken.
 */
export function missingFrom(nodes, expect) {
  const hay = screenText(nodes);
  const has = (e) => hay.includes(String(e).toLowerCase());
  return expect.filter((e) => (Array.isArray(e) ? !e.some(has) : !has(e)));
}

/**
 * MARKERS MUST BE UNIQUE TO THE DESTINATION. The first version expected 'play' for the Play
 * route and 'card' for the set drill - both permanently present in the bottom nav or in almost
 * any card list. A tap that silently did nothing left the previous screen up, and its text
 * satisfied the next assertion: the gate reported green while going nowhere.
 *
 * So every marker below is chosen to be ABSENT from the screen the route arrives from, and
 * several are accessible labels rather than visible text because those are naturally
 * screen-specific.
 */
export const ROUTES = [
  { name: 'Home (launch)', tap: [], expect: ['welcome back'] },
  { name: 'Codex', tap: ['Codex'], expect: ['marginalia'] },
  { name: 'Decks', tap: ['Decks'], expect: ['library'] },
  // 'quick match' was unreachable as a marker: it is a FAB MENU ITEM, and the menu
  // renders aria-hidden while closed, so its subtree is not in the a11y tree - and
  // the FAB trigger's own aria-label does not reach this WebView's tree either (the
  // same measured defect OverflowMenu.jsx:171-181 works around). The Play route was
  // therefore red while Play itself rendered perfectly. 'win rate' is the hero
  // donut's label: verified on-device as present on Play and ABSENT from Home, which
  // is what the doctrine above requires.
  //
  // Two markers, because Play has two legitimate destinations: the populated hub
  // shows the win-rate donut, an empty profile shows the "No Matches Yet" blank
  // state (Play.jsx:124). Requiring only the first made the gate fixture-dependent -
  // a fresh profile failed a route that had rendered perfectly. BOTH alternatives
  // are absent from Home, so this still cannot pass on a tap that went nowhere.
  { name: 'Play', tap: ['Play'], expect: [['win rate', 'no matches yet']] },
  { name: 'Collection > Overview', tap: ['Collection'], expect: ['cards owned', 'decks buildable'] },
  { name: 'Collection > My Collection', tap: ['Collection', 'My Collection'], expect: ['non-foil owned'] },
  { name: 'Collection > set drill', tap: ['Collection', 'My Collection', 'BETA'], expect: ['back to sets', 'select cards'] },
  { name: 'Collection > Lists', tap: ['Collection', 'Lists'], expect: ['wanted lists', 'card lists'] },
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

/**
 * The installed build's identity, from `dumpsys package`. The gate previously checked only
 * that the package EXISTED, so it would happily certify a stale or debug APK - the "green
 * gate, broken artifact" failure it was built to stop, one level up.
 */
export function parseInstalled(dumpsysPackage) {
  const s = String(dumpsysPackage);
  const versionCode = Number(/versionCode=(\d+)/.exec(s)?.[1] ?? NaN);
  // flags=[ ... DEBUGGABLE ... ] marks a debug build; a release APK must not carry it.
  const debuggable = s.includes('DEBUGGABLE');
  return { versionCode, debuggable };
}

/** @returns null when the build matches, else a human-facing reason it does not. */
export function buildMismatch(installed, expectedVersionCode) {
  if (!Number.isFinite(installed.versionCode)) return 'could not read the installed versionCode';
  if (installed.debuggable) return 'the installed build is DEBUGGABLE - this gate certifies release APKs only';
  if (installed.versionCode !== expectedVersionCode) {
    return `installed versionCode ${installed.versionCode} != package.json build ${expectedVersionCode} - a stale APK is on the device`;
  }
  return null;
}

export function parseDevices(output) {
  return String(output).split('\n').slice(1)
    .map((l) => l.trim()).filter(Boolean)
    .filter((l) => /\sdevice$/.test(l))
    .map((l) => l.split(/\s+/)[0]);
}

/* ---------------- the gate ---------------- */

export async function run({ adb, sleep, routes = ROUTES, expectedBuild = null, log = console.log, err = console.error }) {
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

  // Certify the RIGHT artifact. Checking only that the package exists let a stale or debug
  // APK pass as a verified release - the same class of false confidence, one level up.
  if (expectedBuild != null) {
    const why = buildMismatch(parseInstalled(adb(['shell', 'dumpsys', 'package', PKG])), expectedBuild);
    if (why) {
      err(`check:smoke FAILED - ${why}.`);
      err('  Install the current release APK and run again.');
      return 1;
    }
  }

  adb(['logcat', '-c']);

  // From here a dump can exist on the device, so everything below runs in a try/finally.
  // An exception from uiautomator, cat, a tap or the launch poll used to skip cleanup and
  // leave a file full of card names, the profile name and collection counts on shared storage.
  try {

  // RESTART BEFORE EVERY ROUTE. Routes used to share one long-lived session, so a tap that
  // silently failed left the previous screen up and its text could satisfy the next route's
  // assertion. A cold start makes each route's evidence its own.
  const launch = async () => {
    adb(['shell', 'am', 'force-stop', PKG]);
    adb(['shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1']);
    // Poll for readiness instead of paying a flat delay: the app is up when Home's marker
    // renders. Bounded, and reported honestly if it never arrives.
    for (let i = 0; i < 40; i += 1) {
      await sleep(500);
      const nodes = parseUi(readDump(adb, dumpPath));
      if (missingFrom(nodes, ['welcome back']).length === 0) return true;
    }
    return false;
  };

  for (const route of routes) {
    if (!(await launch())) {
      failures.push(`${route.name}: the app never reached Home after launch`);
      continue;
    }
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

  } finally {
    // Best effort, always: the dump holds whatever was on screen.
    try { adb(['shell', 'rm', '-f', dumpPath]); } catch { /* device may be gone */ }
  }
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
  const expectedBuild = Number(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).build);
  console.log(`check:smoke - driving ${wanted || serials[0]}, expecting build ${expectedBuild}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  run({ adb, sleep, expectedBuild }).then((code) => process.exit(code));
}
