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
    build: 63,
    version: '1.0.2-alpha',
    date: '2026-07-17',
    notes: 'Steadier quantity edits in your Collection.',
    changes: [
      { kind: 'fixed', text: 'Tapping a wishlist or list quantity quickly now lands on the right number, and editing the same card from more than one place no longer trips over itself.' },
    ],
  },
  {
    build: 62,
    version: '1.0.2-alpha',
    date: '2026-07-17',
    notes: 'A match in progress now survives you leaving the app.',
    changes: [
      { kind: 'fixed', text: 'A game in progress is saved the moment you switch away, so if the phone closes the app in the background you can pick the match back up exactly where you left off.' },
    ],
  },
  {
    build: 61,
    version: '1.0.2-alpha',
    date: '2026-07-17',
    notes: 'A quiet safety net under the life counter.',
    changes: [
      { kind: 'fixed', text: 'The 20-life cap is now enforced everywhere the counter sets a total, including when you resume a saved match - so a game can never return with an impossible life total.' },
    ],
  },
  {
    build: 60,
    version: '1.0.2-alpha',
    date: '2026-07-17',
    notes: 'The latest Sorcery release is in, and your collection now knows its sets.',
    changes: [
      { kind: 'added', text: 'The newest cards, rules, and rulings are here, with updated card art throughout. Five new cards join the catalogue, and the Codex, decks, and collection all know them.' },
      { kind: 'added', text: 'Cards printed in more than one set now show a printing switcher in the Codex: tap a set to flip the art to that printing and see who illustrated it. Every card also credits its artist.' },
      { kind: 'added', text: 'Your collection tracks which set your copies are from. Own your Alpha and Beta copies separately, each with its own art. Copies whose set you have not recorded sit in an Unspecified bucket you can file at your leisure.' },
      { kind: 'changed', text: 'Importing a card list now opens a review first: reprinted cards let you choose which set they belong to before adding, single-set cards file themselves, and anything unrecognised is listed rather than quietly dropped.' },
    ],
  },
  {
    build: 43,
    version: '1.0.2-alpha',
    date: '2026-07-16',
    notes: 'Version 1.0.2. The duelling table got most of the attention this time.',
    changes: [
      { kind: 'added', text: 'Matches now open with First Light: the table wakes, you roll to see who goes first, and the life totals settle before play begins.' },
      { kind: 'changed', text: 'Finishing a match is calmer and harder to trigger by accident. End Match only becomes available once the game has gone quiet, and the winner gets its own moment on screen before the counter returns.' },
      { kind: 'added', text: 'You can record a match by hand after it happened: choose the avatar for each side, the final life, and who won. Timed games feed your stats; untimed ones are counted honestly, without inventing a length they never had.' },
    ],
  },
  {
    build: 42,
    version: '1.0.1-alpha',
    date: '2026-07-16',
    notes: 'Codex highlighting is gone; your notes, links, and bookmarks stay.',
    changes: [
      { kind: 'changed', text: 'Removed passage highlighting in the Codex. Highlights anchored to exact wording, so a rules rewrite left them stranded - not worth keeping. Your marginalia notes, links, and bookmarks are untouched.' },
    ],
  },
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
