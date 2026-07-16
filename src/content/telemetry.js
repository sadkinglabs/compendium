// The diagnostics disclosure, as data. Adding or editing a line is an edit to this
// file and nothing else - TelemetryDisclosure.jsx renders whatever it is handed and
// holds no copy of its own (invariant 7, content is data).
//
// EVERY CLAIM BELOW IS LOAD-BEARING AND MEASURED. This is the text a tester reads
// before deciding, so it is the one place in the app where a comfortable phrase is a
// lie. What the earlier drafts got wrong, and why the wording is what it is:
//
//   NOT "anonymous"   - Analytics keeps an app-instance id and Crashlytics an
//                       installation UUID. Both are real pseudonymous per-install
//                       identifiers; under GDPR a pseudonymous id IS personal data.
//                       The clearest way to see it: you CANNOT count "how often the
//                       app gets opened" anonymously - that number exists only because
//                       a persistent per-install id separates ten opens by one tester
//                       from one open by ten. Claiming anonymity while describing that
//                       feature contradicts itself in the same paragraph.
//                       "Nothing it sends identifies you personally" says the true
//                       thing: pseudonymous is not identifying. Requested as
//                       "completely anonymous" and corrected to this; see below.
//   NOT "immediately" - setCrashlyticsCollectionEnabled(false) does not apply until
//                       the NEXT RUN. "Next time you open the app" is the conservative
//                       floor: true for Crashlytics by documentation, true-or-better
//                       for Analytics. A privacy promise should fail toward honesty.
//   NOT "no data"     - stack traces, device model, and IP-derived country all go.
//                       The honest claim is "no profile content, no advertising id".
//
// "Until you choose, none of it runs" is literal, not marketing: measured at 0 bytes
// transmitted over 3 minutes on a virgin install, against 13,666 for build 37.

export const TELEMETRY_DISCLOSURE = {
  title: 'Diagnostics',
  intro: 'As part of the alpha testing program, Compendium can send the developer two things:',
  sends: [
    'a report when it crashes: what went wrong and what kind of device it happened on',
    'how often the app gets opened, and from which country',
  ],
  purpose: 'This helps us evaluate usage and troubleshoot app breaking issues.',
  never: 'It never sends your decks, your collection, your profile name, or anything you have typed, and it does not use an advertising ID. Nothing it sends identifies you personally.',
  control: 'Until you choose, none of it runs at all. You can change this any time in Settings.',
  accept: "That's fine",
  decline: 'No thanks',
};

// The Settings row. Shorter, but it carries the disclosure summary - that is what
// makes the row an approved granting surface rather than a bare switch. See THE ONE
// RULE in src/telemetry.js.
export const TELEMETRY_SETTING = {
  label: 'Diagnostics',
  hint: 'On this device. Crash reports and how often the app is opened. Never your decks, collection, or anything you have typed. Turning it off deletes what is still waiting to send, and takes full effect next time you open the app.',
};
