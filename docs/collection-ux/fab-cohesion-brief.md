# Collection cohesion: FAB, refine, bulk mode, and the To Be Sorted inbox

**Status:** design brief for Codex. No code written, no proposal authored yet. The owner wants
the shape argued out before a §8 proposal exists.

**Codex, the role we are asking you to take here is two-handed, and both hands matter:**

- **As a creative UX expert** — challenge the interaction design itself, not just its safety.
  Where is this confusing? What will a collector with 3,000 cards actually do on day one, and
  does this serve them? Where are we adding a surface that should not exist? Propose better
  patterns where you have them; we would rather be told the idea is wrong than told it is risky.
- **As an architecture expert** — tell us how to wire it. Which seams, which modules, what is
  pure and testable versus what has to touch the DB, where the transaction boundaries sit, and
  what this does to the durability contract we spent three rounds getting right.

Please answer both. A review that only hardens a bad design has not helped us.

---

## 1 · Why this exists

The Collection redesign shipped a new information architecture (Overview / My Collection /
Lists, with a set drill under My Collection). The FAB did not follow it. Today the same pillar
offers different FAB shapes on different screens with overlapping actions, and the set drill
carries both a search bar and a filter FAB doing partly the same job.

The owner's goal is a single legible rule: **on any Collection screen, the FAB means "add
cards here", and everything else is either a filter (bottom, docked) or a header action.**

---

## 2 · Current state, verified

The FAB is **not** a global context-mutating system. `src/components/Fab.jsx` portals into a
dock slot (`#cx-dock-fab`, `src/components/BottomDock.jsx:15`) and each screen declares its own.
`className="fab-stacked"` places a second FAB one height above the docked one
(`src/theme/decks.css:131`). So "which FAB on which screen" is a call-site change.

Collection's current call sites:

| Location | Today |
|---|---|
| `Collection.jsx:374-377` | Overview: menu — Add with camera; Import from text |
| `Collection.jsx:643` | Set drill: filter FAB, badge = active filter count |
| `Collection.jsx:644-647` | Set drill: **stacked** menu — Add with camera; Import from text |
| `Collection.jsx:1372-1383` | List detail: dots menu — Add cards; Add from text; Edit; Duplicate; Export as text; Get missing cards; Delete |
| `Collection.jsx:637` | Set drill: `SearchPill` in the dock search slot |
| `ListsIndex` `:1036`, `:1039` | List creation via per-section "+ New" buttons, not a FAB |

`RefineSheet` (`src/components/RefineSheet.jsx`) is shared by Collection, Codex
(`Codex.jsx:114-129`) and DeckAddCards (`DeckAddCards.jsx:152`). Facets are prop-gated so
they can be dropped per caller, but **sort keys are a module constant** (`RefineSheet.jsx:20`:
Name, Mana Cost, Element, Threshold Amount).

---

## 3 · Target: FAB by screen

| Screen | Docked FAB | Stacked FAB | Header |
|---|---|---|---|
| Overview | camera (single action) | — | — |
| My Collection (sets home) | camera (single action) | — | — |
| Set drill | **filters/sorts** (badge) | **camera** (single action) | bulk mode; overflow |
| Lists index | **+** → list creation wizard | — | — |
| List detail | **filters/sorts** (badge) | **camera** (single action) | bulk mode (+ search); overflow |

Single action means a plain `Fab` with `items === null`, one tap, no menu. The point is that a
camera glyph on every Collection screen teaches one thing: this is how cards get in.

**The eviction problem.** List detail's seven actions lose their home. Edit / Duplicate /
Export as text / Get missing cards / Delete are list-level, not card-level, so bulk mode is the
wrong bucket. Proposal: a **dots overflow on the header**, beside the bulk-mode button. That
also gives set drill somewhere consistent for set-level actions later ("export this set's
missing cards as text").

**Export as text is load-bearing, not a leftover.** The owner uses it to generate buy lists
from what is missing in a deck or a set. It must survive the reshuffle, and it should arguably
gain reach (export the current selection, export what is missing).

---

## 4 · Refine sheet, scoped to Collection

Inside a set, drop: **set** (we are in one), **threshold**, **totals**.
Keep: **elements**, **rarity**, **type**, **artist**, and the existing ownership lead section
(Owned / Not owned / Wishlisted, `Collection.jsx:653-660`).

Sorts become **alphabetical, element, rarity**. Note the owner's clarification: element and
rarity are wanted as **grouping**, not merely ordering. Grouped section headers inside the
drill, not just a reordered flat list. That is a rendering change, not only a sort key.

**Rarity needs an explicit rank** (Ordinary < Exceptional < Elite < Unique — a real
price/scarcity order, not alphabetical). Define it once, the way `setRank` is defined once in
`setCompletion.js`.

**Architecture question for you:** `RefineSheet` now has three consumers with diverging needs.
Do sort keys become a caller-supplied prop, or does Collection get its own sheet? We lean
prop-supplied to avoid a fourth sheet chassis (the cohesion pass exists precisely to reduce
sheet chassis count), but say if that is the wrong call.

---

## 5 · Killing the search bar: the A-Z index rail

The search bar leaves the set drill. Replacing it: a **vertical A-Z index rail** down the edge,
in the Manuscript language (gold, Cinzel), tapping a letter jumps to that section.

Rationale: a set is 400+ cards and alphabetical is the default sort, so a rail is a
one-gesture jump with no keyboard and no vertical space cost. It also removes a surface that
duplicated the filter.

Search **returns inside bulk mode on list detail** (owner's spec), where the task is "find the
specific cards I want to act on".

**UX question for you:** does the rail genuinely replace search for a 400-card set, or does it
only serve people who already know the card's name and its first letter? Is there a case for
the rail adapting to the active grouping (jump by element, jump by rarity) rather than always
being alphabetical?

---

## 6 · Bulk mode

Entered from a button on the set-drill / list-detail header. The user need, in the owner's
words: collect **all the cards in a set**, or **all the Ordinary cards in this set**, or **one
copy of each selected card**, in one action rather than hundreds of taps.

**Proposed mechanism: selection derives from the active filter.** "All Ordinary in this set" is
filter to Ordinary, then Select All. Bulk mode composes with the refine sheet rather than
inventing a parallel predicate language, and it inherits every future facet for free.

Actions:
- Select all / none, plus **select all missing** and **select all owned** (more useful than raw
  select-all at 400 cards)
- **Add one copy of each** (additive: 3 becomes 4)
- **Mark as owned** (set to at least 1: 0 becomes 1, 3 stays 3)
- **Remove one copy of each** (destructive — confirm plus undo)
- **Add selected to a list**, **wishlist selected** (makes bulk mode feed the Lists pillar)
- **Export selection as text**

The additive/mark distinction is deliberate: after a booster box you want the first, after
"I checked, I own all of these" you want the second. Users will conflate them, so the wording
has to carry the difference.

**The architecture question we most want you on.** Bulk writes must not go through
`ownedStepController` as N pending chains — that contract is built for one row, one optimistic
delta, one reconcile. A 400-row bulk op wants one repository call, one transaction, one
confirmation, and one undo record holding the inverse delta. Please rule on:

1. Is a separate bulk write path correct, or does it fracture a durability contract we
   deliberately centralised?
2. What is the right failure semantics for a partial bulk write? All-or-nothing in one tx is
   simplest, but 400 rows inside one transaction on a mid-range device is a claim we have not
   measured.
3. How does undo interact with the provisional/confirmed model? Undo of an unconfirmed bulk op
   is a state we have not had before.
4. Does the grid's per-row controller need to be told its underlying data changed underneath it?

---

## 7 · To Be Sorted (new — the owner's proposal)

**The behaviour.** Overview becomes the app's front door for getting cards *in*. A user with a
large existing collection bulk-imports (text or camera) from here, and anything whose printing
cannot be determined lands in a **To Be Sorted** queue shown on Overview. They triage it later,
and cards leave the queue into their real sets. Overview thus carries "here is where you import
everything, and here are your pending actions".

**Why this is the right shape.** The alternative we considered and rejected was scoping text
import to a set so the current set supplies attribution. The owner's objection is decisive: a
100-card paste spanning many sets would force manual pre-sorting before importing, which is
exactly the chore the feature exists to avoid. Deferring the decision to a triage queue lets
the import stay one paste.

**This is much cheaper than it looks, because the bucket already exists.** To Be Sorted is the
`variant_slug = ''` bucket, and its current semantics are already the ones we want:

- `setCompletion.js:41` **excludes** `''` from set completion. A card that might be Alpha
  cannot complete Beta. Correct today.
- `homeRepository.js:284` sums `qty_owned` unfiltered, so `''` **does** count toward "Cards
  collected". You own the card, you just do not know the printing. Also correct today.
- It is already grouped (`collectionGroups.js:47-62`), already a pseudo-set filter chip
  (`Collection.jsx:554-555`), already selectable in the card sheet
  (`CollectionCardSheet.jsx:245-261`).

So the bucket was never the defect. **The defect is that it has no exit and no front door.**
What is new is (a) surfacing it on Overview as an inbox, (b) a triage flow out of it, and
(c) renaming it from a failure state to a queue.

**Where it comes from.** `importPlan.js:24` seeds every card printed in 2+ sets (or 0 sets) to
`''`; `importPlan.js:38` and `ownedRepository.js:324` each re-apply a `|| ''` fallback. The
scanner does the same at `cardScanner.js:100`. Under the new model these stop being bugs and
become the intended default: **undeterminable printing goes to the queue.**

**Legacy data comes along for free.** Existing `''` rows simply are the queue's initial
contents. The one-time cleanup at `ownedRepository.js:244-256` (which rescues only single-set
rows) stays as-is and remains correct.

**Scanner disambiguation is a separate, smaller thing.** When scanning from inside Beta, the
native picker should rank/preselect Beta rather than offering Alpha first. This is a
*disambiguation hint*, explicitly **not** an attribution default — filing an Alpha-only card as
Beta because of where the user was standing would be worse than the queue. Note this requires a
Kotlin change: `cardScanner.js:107` passes `{cards, mode, deckCounts}` into the plugin, so a
preferred-set hint needs native work and Capacitor/Android evidence, not a browser pass.

**Open design questions for you:**

1. **Queue or bucket?** If users are expected to empty it, Overview should surface the count
   like unread mail. If some will legitimately live there forever ("I do not know the printing
   and do not care"), nagging is hostile. We lean queue-with-an-honest-exit: an explicit "keep
   unsorted" so the count can truthfully reach zero. Is there a better third option?
2. **Triage ergonomics.** A 300-card queue triaged one card at a time is a new chore replacing
   the old one. What makes this fast? Group by card and resolve all copies at once? "All of
   these are Beta" over a multi-select? Infer from what the user already owns? Should bulk mode
   (§6) simply work inside the queue?
3. **Does To Be Sorted belong on Overview at all,** or is it a fourth destination under My
   Collection alongside the set plates? Overview-as-inbox is the owner's intent; argue it if you
   disagree.
4. **Is "Overview as front door" in tension with the sets-home plates** being the emotional
   centre of the redesign? We do not want two competing home screens inside one pillar.

---

## 8 · Constraints

- Invariants (`ENGINEERING_CONSTITUTION.md` §3): this touches **durable offline-first writes**
  (bulk + undo) and **transactional user-data operations**. Profile isolation and the
  catalog/profile boundary must hold. Schema is v10; say if any of this needs v11.
- No new sheet chassis. The cohesion pass exists to reduce them, not add a fifth.
- Manuscript language (`DESIGN_SYSTEM.md`) governs the rail, bulk mode chrome and queue.
  Flag any new token this needs; the owner is open to new tokens when they earn their place.
- Zero-image mode must degrade gracefully on every new surface.
- No flowery naming in code. "Reliquary" is fine in conversation, never in an identifier.

## 9 · What we are asking for

A disposition on the design **and** the wiring. Specifically: the FAB map (§3), the shared
`RefineSheet` question (§4), whether the rail replaces search (§5), the bulk write path (§6,
the highest-risk item), and the To Be Sorted model (§7). Where you think the interaction is
wrong, say so before you tell us how to build it safely.
