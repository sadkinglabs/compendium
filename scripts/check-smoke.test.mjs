// Tests for the release-APK smoke gate.
//
// The device is faked, so these test the gate's JUDGEMENT rather than Android. The cases that
// matter are the ones proving it FAILS: a blank screen, a missing marker, an unreachable tap
// target, and a JS console error. A smoke gate that cannot fail is worse than none, because it
// converts "we did not check" into "we checked and it was fine".
// Run: npm run check:smoke
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUi, centerOf, findNode, missingFrom, screenText, parseDevices, isScreenOn, isLocked, parseInstalled, buildMismatch, run } from './check-smoke.mjs';

const node = (text, x1 = 0, y1 = 0, x2 = 100, y2 = 50) =>
  `<node text="${text}" bounds="[${x1},${y1}][${x2},${y2}]" />`;
const doc = (...nodes) => `<?xml version='1.0'?><hierarchy>${nodes.join('')}</hierarchy>`;

const silent = { log: () => {}, err: () => {} };
const noSleep = () => Promise.resolve();

/** A fake device that returns a scripted dump per call. */
const AWAKE = 'mWakefulness=Awake\n  Display Power: state=ON';

const GOOD_PKG = 'versionCode=42 minSdk=29\n    flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]';

function fakeAdb(dumps, { logcat = '', power = AWAKE, window_ = '', pkg = GOOD_PKG } = {}) {
  const calls = [];
  let i = 0;
  return {
    calls,
    adb(args) {
      calls.push(args.join(' '));
      if (args[0] === 'logcat' && args[1] === '-d') return logcat;
      if (args[1] === 'dumpsys' && args[2] === 'power') return power;
      if (args[1] === 'dumpsys' && args[2] === 'window') return window_;
      if (args[1] === 'dumpsys' && args[2] === 'package') return pkg;
      if (args[1] === 'cat') return dumps[Math.min(i++, dumps.length - 1)];
      return '';
    },
  };
}

test('parseUi extracts text and bounds, dropping textless nodes', () => {
  const nodes = parseUi(doc(node('Home', 0, 0, 100, 50), '<node bounds="[0,0][1,1]" />', node('Codex', 100, 0, 200, 50)));
  assert.deepEqual(nodes.map((n) => n.text), ['Home', 'Codex']);
  assert.deepEqual(nodes[0].bounds, { x1: 0, y1: 0, x2: 100, y2: 50 });
});

test('centerOf is the middle of the bounds', () => {
  assert.deepEqual(centerOf({ x1: 10, y1: 20, x2: 30, y2: 60 }), { x: 20, y: 40 });
});

test('findNode matches a substring, case-insensitively', () => {
  const nodes = parseUi(doc(node('MY COLLECTION')));
  assert.ok(findNode(nodes, 'my collection'));
  assert.ok(findNode(nodes, 'Collection'));
  assert.equal(findNode(nodes, 'Decks'), null);
});

test('an EXACT match wins over an earlier substring match', () => {
  // Caught on a real device: tapping "Decks" hit the Home screen's "YOUR DECKS 2 All" section
  // header instead of the nav tab, opened a deck, and every later route failed against the
  // wrong screen. Nav labels are exact strings, so exact must win.
  const nodes = parseUi(doc(node('YOUR DECKS 2 All', 0, 100, 400, 150), node('Decks', 500, 2900, 600, 2950)));
  const hit = findNode(nodes, 'Decks');
  assert.equal(hit.text, 'Decks');
  assert.equal(hit.bounds.y1, 2900, 'should be the nav tab, not the section header');
});

test('substring matching still works when there is no exact node', () => {
  const nodes = parseUi(doc(node('402 cards')));
  assert.ok(findNode(nodes, 'card'));
});

test('screenText joins with a separator so adjacent nodes cannot fake a match', () => {
  // Without a separator, ["over", "view"] would satisfy an expectation of "overview" - a
  // false pass built from two unrelated labels.
  const nodes = parseUi(doc(node('over'), node('view')));
  assert.ok(!screenText(nodes).includes('overview'));
});

test('missingFrom reports only what is absent', () => {
  const nodes = parseUi(doc(node('Overview'), node('Lists')));
  assert.deepEqual(missingFrom(nodes, ['overview', 'lists']), []);
  assert.deepEqual(missingFrom(nodes, ['overview', 'my collection']), ['my collection']);
});

test('parseDevices returns only ready devices', () => {
  const out = 'List of devices attached\nABC123\tdevice\nDEF456\toffline\nGHI\tunauthorized\n';
  assert.deepEqual(parseDevices(out), ['ABC123']);
});

test('parseDevices handles an empty list', () => {
  assert.deepEqual(parseDevices('List of devices attached\n\n'), []);
});

test('PASSES when every route renders its markers', async () => {
  const { adb } = fakeAdb([doc(node('WELCOME BACK'))]);
  const code = await run({
    adb, sleep: noSleep, ...silent,
    routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }],
  });
  assert.equal(code, 0);
});

test('FAILS on a blank screen - the exact failure this gate exists for', async () => {
  // The app is running, adb answers, the view tree is empty. Every other gate was green when
  // this shipped.
  const { adb } = fakeAdb([doc()]);
  const code = await run({
    adb, sleep: noSleep, ...silent,
    routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }],
  });
  assert.equal(code, 1);
});

test('FAILS when a route renders but is missing its marker', async () => {
  const { adb } = fakeAdb([doc(node('Something else'))]);
  const code = await run({
    adb, sleep: noSleep, ...silent,
    routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }],
  });
  assert.equal(code, 1);
});

test('FAILS when a tap target cannot be found', async () => {
  const { adb } = fakeAdb([doc(node('Home'))]);
  const code = await run({
    adb, sleep: noSleep, ...silent,
    routes: [{ name: 'Codex', tap: ['Codex'], expect: ['rules'] }],
  });
  assert.equal(code, 1);
});

test('FAILS on a JS console error even when the screen rendered', async () => {
  const { adb } = fakeAdb([doc(node('WELCOME BACK'))], {
    logcat: 'E Capacitor/Console: Uncaught ReferenceError: Cannot access K before initialization\n',
  });
  const code = await run({
    adb, sleep: noSleep, ...silent,
    routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }],
  });
  assert.equal(code, 1);
});

test('a quiet logcat is NOT treated as evidence of health', async () => {
  // A stock release build does not forward console at all, so silence proves nothing. The
  // render assertion must still be what decides the outcome.
  const { adb } = fakeAdb([doc()], { logcat: '' });
  const code = await run({
    adb, sleep: noSleep, ...silent,
    routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }],
  });
  assert.equal(code, 1, 'blank screen must fail regardless of a clean log');
});

test('taps the centre of the located node, not a fixed coordinate', async () => {
  // The first dump must satisfy the launch readiness poll (Home's marker), since every route
  // now cold-starts the app before driving it.
  const home = doc(node('WELCOME BACK'), node('Codex', 200, 400, 300, 500));
  const { adb, calls } = fakeAdb([home, home, doc(node('Marginalia'))]);
  await run({
    adb, sleep: noSleep, ...silent,
    routes: [{ name: 'Codex', tap: ['Codex'], expect: ['marginalia'] }],
  });
  assert.ok(calls.includes('shell input tap 250 450'), `tap not issued at the node centre: ${calls.join(' | ')}`);
});

test('the app is force-stopped and the log cleared before driving', async () => {
  // Otherwise a stale error from a previous run is attributed to this one.
  const { adb, calls } = fakeAdb([doc(node('WELCOME BACK'))]);
  await run({ adb, sleep: noSleep, ...silent, routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }] });
  assert.ok(calls.some((c) => c.includes('force-stop')));
  assert.ok(calls.includes('logcat -c'));
});

test('every route is reported, not just the first failure', async () => {
  const msgs = [];
  const { adb } = fakeAdb([doc(node('nope'))]);
  const code = await run({
    adb, sleep: noSleep, log: () => {}, err: (m) => msgs.push(String(m)),
    routes: [
      { name: 'A', tap: [], expect: ['aaa'] },
      { name: 'B', tap: [], expect: ['bbb'] },
    ],
  });
  assert.equal(code, 1);
  const text = msgs.join('\n');
  assert.match(text, /A:/);
  assert.match(text, /B:/);
});

/* ---------------- screen state ---------------- */

test('isScreenOn reads the awake/on case', () => {
  assert.equal(isScreenOn(AWAKE), true);
});

test('isScreenOn detects a dark display', () => {
  assert.equal(isScreenOn('mWakefulness=Awake\n  Display Power: state=OFF'), false);
  assert.equal(isScreenOn('mWakefulness=Asleep'), false);
  assert.equal(isScreenOn('mWakefulness=Dozing'), false);
  assert.equal(isScreenOn('mScreenOn=false'), false);
});

test('isScreenOn is false for output it cannot interpret', () => {
  // Fail closed: guessing "probably on" reintroduces the exact false failure this prevents.
  assert.equal(isScreenOn(''), false);
  assert.equal(isScreenOn('nonsense'), false);
});

test('isLocked spots the keyguard', () => {
  assert.equal(isLocked('mDreamingLockscreen=true'), true);
  assert.equal(isLocked('mShowingLockscreen=true'), true);
  assert.equal(isLocked('mDreamingLockscreen=false'), false);
});

test('a screen that will not wake FAILS as screen-off, not as a render failure', async () => {
  // The misdiagnosis this prevents: a dark phone yields an empty view tree, identical to a
  // blanked app, and the gate used to call that "NOTHING RENDERED". It cost an hour of
  // hunting a boot crash that was never happening.
  const msgs = [];
  const { adb } = fakeAdb([doc()], { power: 'mWakefulness=Asleep' });
  const code = await run({
    adb, sleep: noSleep, log: () => {}, err: (m) => msgs.push(String(m)),
    routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }],
  });
  assert.equal(code, 1);
  const text = msgs.join('\n');
  assert.match(text, /screen is OFF/);
  assert.doesNotMatch(text, /NOTHING RENDERED/, 'must not blame the app for a dark screen');
});

test('a LOCKED device fails with its own message', async () => {
  const msgs = [];
  const { adb } = fakeAdb([doc(node('WELCOME BACK'))], { window_: 'mShowingLockscreen=true' });
  const code = await run({
    adb, sleep: noSleep, log: () => {}, err: (m) => msgs.push(String(m)),
    routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }],
  });
  assert.equal(code, 1);
  assert.match(msgs.join('\n'), /LOCKED/);
});

test('it tries to WAKE a sleeping screen before giving up', async () => {
  let woken = false;
  let power = 'mWakefulness=Asleep';
  const adb = (args) => {
    if (args.includes('KEYCODE_WAKEUP')) { woken = true; power = AWAKE; return ''; }
    if (args[1] === 'dumpsys' && args[2] === 'power') return power;
    if (args[1] === 'dumpsys' && args[2] === 'window') return '';
    if (args[0] === 'logcat' && args[1] === '-d') return '';
    if (args[1] === 'cat') return doc(node('WELCOME BACK'));
    return '';
  };
  const code = await run({
    adb, sleep: noSleep, ...silent,
    routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }],
  });
  assert.equal(woken, true, 'should have sent a wake keyevent');
  assert.equal(code, 0, 'and then proceeded normally');
});

/* ---------------- build identity ---------------- */

test('parseInstalled reads versionCode and the debuggable flag', () => {
  assert.deepEqual(parseInstalled('versionCode=127 targetSdk=35\n    flags=[ HAS_CODE ]'),
    { versionCode: 127, debuggable: false });
  assert.equal(parseInstalled('versionCode=9\n    flags=[ DEBUGGABLE HAS_CODE ]').debuggable, true);
});

test('buildMismatch accepts the intended release build', () => {
  assert.equal(buildMismatch({ versionCode: 127, debuggable: false }, 127), null);
});

test('buildMismatch REJECTS a stale APK', () => {
  // The gate used to check only that the package existed, so an old install passed as a
  // verified release - the same false confidence it was built to prevent, one level up.
  const why = buildMismatch({ versionCode: 120, debuggable: false }, 127);
  assert.match(why, /stale APK/);
});

test('buildMismatch REJECTS a debuggable build', () => {
  assert.match(buildMismatch({ versionCode: 127, debuggable: true }, 127), /DEBUGGABLE/);
});

test('buildMismatch fails closed when the versionCode is unreadable', () => {
  assert.match(buildMismatch({ versionCode: NaN, debuggable: false }, 127), /could not read/);
});

test('run() REFUSES to certify a stale install', async () => {
  const msgs = [];
  const { adb } = fakeAdb([doc(node('WELCOME BACK'))], { pkg: 'versionCode=1\n    flags=[ HAS_CODE ]' });
  const code = await run({
    adb, sleep: noSleep, expectedBuild: 127, log: () => {}, err: (m) => msgs.push(String(m)),
    routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }],
  });
  assert.equal(code, 1);
  assert.match(msgs.join('\n'), /stale APK/);
});

/* ---------------- the tap-does-nothing counterfactual ---------------- */

test('a tap that does NOTHING must fail, not inherit the previous screen', async () => {
  // The oracle bug: markers like "play" or "card" exist on almost every screen, so a silent
  // tap left the old screen up and satisfied the next assertion. Here the device never
  // changes screen; the route must still fail.
  const stuck = doc(node('WELCOME BACK'), node('Codex', 200, 2900, 300, 2950));
  const { adb } = fakeAdb([stuck]);
  const code = await run({
    adb, sleep: noSleep, ...silent,
    routes: [{ name: 'Codex', tap: ['Codex'], expect: ['marginalia'] }],
  });
  assert.equal(code, 1, 'an unchanged screen must not satisfy the destination marker');
});

test('every route relaunches, so one route cannot inherit another route state', async () => {
  const calls = [];
  const { adb } = fakeAdb([doc(node('WELCOME BACK'))]);
  const wrapped = (args) => { calls.push(args.join(' ')); return adb(args); };
  await run({
    adb: wrapped, sleep: noSleep, ...silent,
    routes: [
      { name: 'A', tap: [], expect: ['welcome back'] },
      { name: 'B', tap: [], expect: ['welcome back'] },
    ],
  });
  const stops = calls.filter((c) => c.includes('force-stop')).length;
  assert.ok(stops >= 2, `expected a relaunch per route, saw ${stops}`);
});

test('the screen dump is removed from shared storage', async () => {
  // It contains whatever was on screen: card names, profile name, collection counts.
  const calls = [];
  const { adb } = fakeAdb([doc(node('WELCOME BACK'))]);
  const wrapped = (args) => { calls.push(args.join(' ')); return adb(args); };
  await run({ adb: wrapped, sleep: noSleep, ...silent, routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }] });
  assert.ok(calls.some((c) => c.startsWith('shell rm -f /sdcard/')), 'dump file not cleaned up');
});

test('parseUi reads content-desc when a node has no text', () => {
  const nodes = parseUi('<hierarchy><node content-desc="Back to sets" bounds="[0,0][40,40]" /></hierarchy>');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].text, 'Back to sets');
});

test('the dump is removed even when a device command THROWS', async () => {
  // The structural fix was a try/finally, but only the happy path was covered - and this
  // branch has a history of green tests missing the case they were written for. Here adb
  // fails AFTER a dump can exist; cleanup must still run.
  const calls = [];
  let dumps = 0;
  const adb = (args) => {
    calls.push(args.join(' '));
    if (args[1] === 'dumpsys' && args[2] === 'power') return AWAKE;
    if (args[1] === 'dumpsys' && args[2] === 'window') return '';
    if (args[1] === 'dumpsys' && args[2] === 'package') return GOOD_PKG;
    if (args[1] === 'uiautomator') { dumps += 1; if (dumps > 1) throw new Error('device went away'); return ''; }
    if (args[1] === 'cat') return doc(node('WELCOME BACK'));
    if (args[0] === 'logcat') return '';
    return '';
  };
  await assert.rejects(
    run({ adb, sleep: noSleep, ...silent, routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }] }),
    /device went away/,
  );
  assert.ok(calls.some((c) => c.startsWith('shell rm -f /sdcard/')), 'cleanup must run on the failure path too');
});

test('cleanup failing does not mask the original error', async () => {
  const adb = (args) => {
    if (args[1] === 'dumpsys' && args[2] === 'power') return AWAKE;
    if (args[1] === 'dumpsys' && args[2] === 'window') return '';
    if (args[1] === 'dumpsys' && args[2] === 'package') return GOOD_PKG;
    if (args[1] === 'rm') throw new Error('cleanup also failed');
    if (args[1] === 'uiautomator') throw new Error('the real problem');
    if (args[0] === 'logcat') return '';
    return '';
  };
  await assert.rejects(
    run({ adb, sleep: noSleep, ...silent, routes: [{ name: 'Home', tap: [], expect: ['welcome back'] }] }),
    /the real problem/,
  );
});
