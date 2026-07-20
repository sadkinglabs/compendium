// Tests for the release-APK smoke gate.
//
// The device is faked, so these test the gate's JUDGEMENT rather than Android. The cases that
// matter are the ones proving it FAILS: a blank screen, a missing marker, an unreachable tap
// target, and a JS console error. A smoke gate that cannot fail is worse than none, because it
// converts "we did not check" into "we checked and it was fine".
// Run: npm run check:smoke
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUi, centerOf, findNode, missingFrom, screenText, parseDevices, run } from './check-smoke.mjs';

const node = (text, x1 = 0, y1 = 0, x2 = 100, y2 = 50) =>
  `<node text="${text}" bounds="[${x1},${y1}][${x2},${y2}]" />`;
const doc = (...nodes) => `<?xml version='1.0'?><hierarchy>${nodes.join('')}</hierarchy>`;

const silent = { log: () => {}, err: () => {} };
const noSleep = () => Promise.resolve();

/** A fake device that returns a scripted dump per call. */
function fakeAdb(dumps, { logcat = '' } = {}) {
  const calls = [];
  let i = 0;
  return {
    calls,
    adb(args) {
      calls.push(args.join(' '));
      if (args[0] === 'logcat' && args[1] === '-d') return logcat;
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
  const { adb, calls } = fakeAdb([doc(node('Codex', 200, 400, 300, 500)), doc(node('Rules'))]);
  await run({
    adb, sleep: noSleep, ...silent,
    routes: [{ name: 'Codex', tap: ['Codex'], expect: ['rules'] }],
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
