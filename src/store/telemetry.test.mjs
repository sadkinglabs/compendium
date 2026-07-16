import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normaliseConsent, isOn, needsDisclosure, UNSET, GRANTING, GRANTED, DENIED } from './telemetry.js';

// WHAT THIS FILE CAN AND CANNOT TEST
//
// The consent authority is TelemetryPlugin.kt, and node has no Firebase, no
// SharedPreferences, and no Capacitor bridge. So the runtime behaviour that actually
// matters - does the SDK stop, does the report get deleted, does an interrupted deny
// converge - is UNTESTABLE HERE and is verified on a device instead. Anything in this
// file that appears to prove the feature works is lying to you; see the device matrix
// in docs/proposals/telemetry-consent.md.
//
// What IS worth pinning here is the fail-safe direction, and the structural property
// that survived four revisions of review: only two surfaces may grant consent.

test('recognised states pass through', () => {
  assert.equal(normaliseConsent('granted'), GRANTED);
  assert.equal(normaliseConsent('denied'), DENIED);
  assert.equal(normaliseConsent('unset'), UNSET);
  assert.equal(normaliseConsent('granting'), GRANTING);
});

// `granting` = consent given, pre-consent cleanup not yet PROVEN complete. It is the
// state that stops elapsed time being mistaken for evidence, and the UI must not
// collapse it into either neighbour: as `unset` it would re-ask someone who already
// said yes; as `granted` it would claim a guarantee reconcile has not yet earned.
test('granting reads as ON but does not re-ask', () => {
  assert.equal(isOn(GRANTING), true, 'the user consented and Analytics is already running');
  assert.equal(needsDisclosure(GRANTING), false, 'they have answered - asking again would be a bug');
});

test('only unset asks, and only granted/granting are on', () => {
  assert.deepEqual(
    [UNSET, GRANTING, GRANTED, DENIED].map(needsDisclosure), [true, false, false, false]);
  assert.deepEqual(
    [UNSET, GRANTING, GRANTED, DENIED].map(isOn), [false, true, true, false]);
});

// Fail-safe is the OFF direction. A corrupt write, a renamed state, a native error
// returning undefined - all must degrade to "ask again and collect nothing", never to
// "assume yes". If someone ever makes the default GRANTED, this is the test that says no.
test('anything unrecognised collapses to unset, never to granted', () => {
  for (const bad of [undefined, null, '', 'GRANTED', 'Granted', 'true', true, 1, 'yes', {}, [], 'denyed']) {
    assert.equal(normaliseConsent(bad), UNSET, `${JSON.stringify(bad)} must collapse to unset`);
  }
});

// `null` (web: no Firebase to consent to) must stay distinct from `unset` (native:
// telemetry exists, unanswered). Collapsing them strands the disclosure open on every
// `npm run dev`: the modal shows because reconcile said unset, and the accept button
// cannot dismiss it because grantConsent no-ops on web too. Found on device, from a
// screenshot, after the automated gates were all green - which is the point.
test('null is not unset: web must not be asked to consent', () => {
  assert.notEqual(normaliseConsent(null), null,
    'normalise still collapses null to unset - that is correct INSIDE the native path. ' +
    'The distinction is reconcile()\'s early return, checked below.');
  const src = readFileSync(fileURLToPath(new URL('./telemetry.js', import.meta.url)), 'utf8');
  assert.match(src, /if \(!isNative\(\)\) return null;/,
    'reconcile() must return null (not applicable) on web, not UNSET. See the comment above it.');
});

// ---------------------------------------------------------------------------
// The rev-2 blocker-3 regression test.
//
// Revision 2 claimed granting was "unrepresentable" outside the first-run disclosure
// while ALSO specifying a Settings toggle that grants. Both could not be true, and
// Codex caught the contradiction. The honest property is weaker and needs enforcing
// by something, because the type system will not do it:
//
//   grantConsent() is reachable from exactly TWO surfaces, and BOTH show the user the
//   disclosure text before they choose.
//
// A third caller is not automatically wrong - it is wrong if it grants without showing
// what is being agreed to. This test cannot read a UI, so it fails on ANY new caller
// and makes a human justify it. Deleting or loosening this test to make a build pass
// removes the only thing guarding the property.
// ---------------------------------------------------------------------------
const SRC = new URL('../', import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, SRC)), 'utf8');

// App.jsx is the ONLY module that may import grantConsent. TelemetryDisclosure takes
// it as a prop rather than importing it, which is why one importer wires two surfaces.
test('only App.jsx can reach grantConsent', () => {
  const importers = ['App.jsx', 'components/TelemetryDisclosure.jsx', 'components/ui.jsx', 'native.js']
    .filter((rel) => /grantConsent/.test(read(rel)));
  assert.deepEqual(importers, ['App.jsx'],
    'A new module reached grantConsent. Every surface that grants MUST show the disclosure text first. ' +
    'If this is intentional, say in review how the user sees what they are agreeing to before consenting.');
});

test('exactly two call sites grant consent: the disclosure and the Settings row', () => {
  const app = read('App.jsx');
  // Strip the import line - it names the symbol without being a granting surface.
  const body = app.replace(/^import .*grantConsent.*$/m, '');
  const calls = body.match(/grantConsent\(/g) || [];
  assert.equal(calls.length, 2,
    `Expected 2 grantConsent() call sites (TelemetryDisclosure onAccept, and SettingsModal putConsent), found ${calls.length}. ` +
    'Revision 2 claimed granting was "unrepresentable" outside the disclosure while shipping a Settings toggle that granted - ' +
    'Codex caught the contradiction. This count is the only thing standing between that property and a silent third surface.');
});

test('the Settings granting surface carries the disclosure text', () => {
  // What makes the Settings row an allowed granting surface is the hint, not the toggle.
  // If the hint is ever dropped to tidy the layout, the row becomes a bare switch that
  // grants - which is what build 37 effectively was.
  const app = read('App.jsx');
  assert.match(app, /TELEMETRY_SETTING\.hint/, 'the PRIVACY row must render the disclosure hint');
  const content = read('content/telemetry.js');
  assert.match(content, /never sends your decks/i, 'the hint must say what is never sent');
  assert.match(content, /next time you open the app/i,
    'the hint must state the next-run delay - setCrashlyticsCollectionEnabled(false) does not apply until the next run, ' +
    'so any copy promising "immediately" is false');
});

test('disclosure copy makes no claim the implementation cannot keep', () => {
  const content = read('content/telemetry.js');
  const copy = content.replace(/\/\/.*$/gm, '');   // strip the comments, which discuss these words
  assert.doesNotMatch(copy, /\banonymous\b/i,
    'Analytics keeps an app-instance id and Crashlytics an installation UUID. Both are pseudonymous ' +
    'per-install identifiers, and under GDPR a pseudonymous id IS personal data. "Anonymous" is false. ' +
    'Note you CANNOT count "how often the app gets opened" anonymously - that number exists only because ' +
    'a persistent per-install id distinguishes ten opens by one tester from one open by ten. ' +
    'Use "nothing it sends identifies you personally", which is true.');
  assert.doesNotMatch(copy, /\bimmediately\b/i,
    'Crashlytics disable applies on the NEXT RUN. "Immediately" is false.');
});

// The disclosure asks for a decision and must take only a decision. Tapping the scrim
// used to answer it: that left consent `unset` so nothing was collected - the fail-safe
// held - but a stray tap on the background is not consent, and off-by-accident must not
// be recorded the same way as off-by-choice. CenteredModal drives the backdrop tap, the
// close button AND hardware back from `onClose`, so passing it re-opens all three.
test('the disclosure cannot be dismissed without answering', () => {
  const src = read('components/TelemetryDisclosure.jsx');
  const modalTag = /<CenteredModal[^>]*>/s.exec(src)?.[0] || '';
  assert.ok(modalTag, 'expected a CenteredModal in TelemetryDisclosure');
  assert.doesNotMatch(modalTag, /onClose=/,
    'CenteredModal must NOT receive onClose here: it is what wires the backdrop tap, the close button, ' +
    'and hardware back. Passing it lets a stray tap answer a privacy question.');
  assert.match(modalTag, /closeButton=\{false\}/, 'the close button must stay off');
  assert.doesNotMatch(src, /onDismiss/,
    'a dismiss path re-introduces the bug: the modal must resolve only via onAccept or onDecline');
});
