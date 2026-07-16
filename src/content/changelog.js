// The release notes, as data. Adding a release is an edit to this file and
// nothing else: ChangelogModal renders whatever it is handed and holds no
// per-version conditionals (invariant 7, content is data).
//
// `build` is the package.json build the entry shipped in, and is the value the
// seen-stamp compares against - not `version`, which moves rarely and is shared
// by several builds. Entries are ordered newest-first and that order is what the
// modal renders, so keep it.
//
// An entry may be authored ahead of the bump (notes are usually written before
// the install that ships them). pendingEntries() drops entries with a build
// above the running one, so a future-dated entry stays invisible on update until
// its build actually ships. Credits > What's New shows the whole list regardless.
//
// `kind` is one of: added | changed | fixed.
export const CHANGELOG = [
  {
    build: 39,
    version: '1.0.1-alpha',
    date: '2026-07-16',
    notes: 'A fifth of the download was code for processors no phone has.',
    changes: [
      { kind: 'changed', text: 'Compendium is 16 MB smaller to download. It was shipping the card scanner’s engine four times over, including twice for chips that only exist in emulators.' },
    ],
  },
  {
    build: 38,
    version: '1.0.1-alpha',
    date: '2026-07-16',
    notes: 'Compendium now asks before sending the developer anything, and it never asked before.',
    changes: [
      { kind: 'added', text: 'Diagnostics: crash reports and how often the app is opened are now yours to allow or refuse. Compendium asks once, and Settings can change it any time.' },
      { kind: 'fixed', text: 'Removed an advertising ID permission that Firebase had been adding to every build without anyone choosing it. Compendium has never used it, and now it cannot ask for it.' },
      { kind: 'fixed', text: 'Nothing at all is sent until you answer that question, including from earlier builds. Anything already waiting to send is deleted rather than held.' },
    ],
  },
  {
    build: 37,
    version: '1.0.1-alpha',
    date: '2026-07-16',
    notes: 'Settings and Credits found their proper homes, and the app can now tell you what changed.',
    changes: [
      { kind: 'added', text: 'What’s New: after an update, the notes for every version you missed, once.' },
      { kind: 'added', text: 'Tap the Compendium wordmark on Home for Credits, and the release notes any time.' },
      { kind: 'changed', text: 'Settings now opens from the profile sheet, over it, rather than from a hidden tap on the wordmark.' },
    ],
  },
];
