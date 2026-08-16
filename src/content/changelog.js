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
    build: 259,
    version: '1.0.4-alpha',
    date: '2026-08-15',
    notes: 'Sheets you can actually throw away, advanced match counters, and a deck that syncs itself.',
    changes: [
      { kind: 'added', text: 'Advanced counters in a match: an opt-in band on the divider tracks mana and elemental thresholds for both players, so a game needing more than life totals no longer needs a second app.' },
      { kind: 'added', text: 'Lists can be arranged: group by set, rarity or element with anchored headers, and sort within each group by name, rarity, element or how recently you touched it.' },
      { kind: 'added', text: 'A deck saved from a Curiosa link can pull its changes again. It shows you the difference first and only writes once you confirm.' },
      { kind: 'added', text: 'Whole-app backup and restore: one file covering every profile, restorable on any device. Restoring returns the app to that snapshot, and a recovery point is taken first so you can step back out of it.' },
      { kind: 'added', text: 'Avatars can be added to a deck’s Collection straight from their card sheet, and Change avatar is reachable from Edit Deck.' },
      { kind: 'changed', text: 'Every bottom sheet has been rebuilt. Drag one down from anywhere to dismiss it, flick it away with a flick, or catch one mid-animation and change your mind. Closing is a real animation now instead of the sheet vanishing.' },
      { kind: 'changed', text: 'Waiting for a section to open shows the app’s mark rather than a stray ellipsis on an empty screen.' },
      { kind: 'changed', text: 'One header across every screen, with titles that shrink to fit instead of being cut off, and one search bar with the same behaviour everywhere.' },
      { kind: 'changed', text: 'Buttons and controls meet a 44px touch floor throughout, with a consistent press response.' },
      { kind: 'changed', text: 'The avatar picker was redesigned around a three-column grid that makes room for the keyboard as you type.' },
      { kind: 'changed', text: 'Deck text exports order the Spellbook as Avatar, Aura, Artifact, Minion then Magic. The on-screen deck keeps its own order.' },
      { kind: 'changed', text: 'The deck library and My Deck paint complete on the first frame, and art you have already seen appears instantly instead of fading in again.' },
      { kind: 'changed', text: 'Runs on the current Android toolchain, staying portrait on phones while tablets rotate freely.' },
      { kind: 'fixed', text: 'The frosted glass throughout the app is back. A build-tool bug had been silently stripping it.' },
      { kind: 'fixed', text: 'Hardware Back now closes Collection layers in order, and returning to Decks puts you back on the view you left.' },
      { kind: 'fixed', text: 'A “Missing for” list is an ordinary list again, so wanted tracking no longer calls a deck complete when it is a card short.' },
      { kind: 'fixed', text: 'In a match, a lost life point is shown in red, and dismissing a stepper can no longer cost you a life point by accident.' },
      { kind: 'fixed', text: 'Codex stays responsive while you type, and importing the same profile twice no longer leaves duplicate names behind.' },
    ],
  },
  {
    build: 199,
    version: '1.0.3-alpha',
    date: '2026-07-25',
    notes: 'See your whole collection at once, jump by letter, and a much lighter app.',
    changes: [
      { kind: 'added', text: 'My Collection has a new All view: a Sets / All toggle shows every card you can own in one grid, with the full search and refine tools behind it - one tile per printing.' },
      { kind: 'added', text: 'A full-screen art view renders the game’s artwork beautifully, with a special holographic treatment for foil cards.' },
      { kind: 'added', text: 'An A-Z rail runs down the side of your collection. Drag or tap a letter and the list jumps there when you let go, with a big letter riding beside your thumb.' },
      { kind: 'added', text: 'With cards selected you can now add them straight to an existing list - right next to Edit copies and New list.' },
      { kind: 'changed', text: 'The Sets and All headers now match, and your selected count and the Select button stay pinned to the top as you scroll.' },
      { kind: 'changed', text: 'The app is far smaller to download and update - about 23 MB, down from 90. Card art now streams from the cloud and is saved on your device as you view it, so give it a moment of internet on the first run to fill in the artwork; some cards may load a little slower the first time.' },
    ],
  },
  {
    build: 64,
    version: '1.0.2-alpha',
    date: '2026-07-17',
    notes: 'Steadier, safer quantity edits in your Collection.',
    changes: [
      { kind: 'fixed', text: 'Tapping a wishlist or list quantity quickly now lands on the right number, and editing the same card from more than one place no longer trips over itself.' },
      { kind: 'fixed', text: 'Emptying a card’s Unspecified owned copies no longer clears a wishlist entry for that same card.' },
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
