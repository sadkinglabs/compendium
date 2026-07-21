# Collection cohesion: FAB, refine, bulk mode, and Unspecified triage

**Status:** design brief, **v2 — model settled**. Revised after Codex design review and two
owner rulings. This is the agreed shape; a §8 proposal has not been written yet.

## 0 · What changed in v2, and why

Codex reviewed v1 as a UX and architecture critique. It was right on nearly everything, and
two of its catches were better than the original design. Recorded so the reasoning is not lost:

| v1 said | v2 says | Why |
|---|---|---|
| Element/rarity as **sort keys** | Explicit **Group by: None / Element / Rarity**, alphabetical within each group | v1 leaked the wrong abstraction into RefineSheet, query state and tests. These are sectioned rendering modes, not orderings. |
| A-Z rail **replaces** search | Rail **plus header-invoked** search; rail only in ungrouped alphabetical mode | A rail cannot do partial-name matching, and 26 vertical touch targets is poor phone ergonomics. The owner's actual objection was permanent dock space, which header invocation solves. **Owner ruling.** |
| Header overflow on set drill **and** list detail | List detail **only** | No set-level command exists yet. A near-empty dots menu weakens the pattern. Revisit when one exists. |
| "Add one copy of each" / "Mark as owned" | **"Add 1 to each"** / **"Ensure at least 1"** | "Mark as owned" hides the preservation behaviour that is the entire point of the second variant. |
| Selection **derived** from the active filter | Selection **snapshotted** from the current filtered result | Live derivation lets a filter change silently add or remove rows from a pending destructive operation. This was a correctness bug, not a polish note. |
| Undo as one **inverse delta** | Undo stores **before and committed-after per row**, restores only where current still equals committed-after, reports conflicts | An inverse delta is not safe for "Ensure at least 1" (it cannot know which rows it actually changed) and can silently overwrite intervening edits. |
| To Be Sorted as an **inbox with a count** | **Quiet pseudo-set** under My Collection, strong triage action, no nagging | `variant_slug=''` cannot distinguish pending-triage from accepted-unspecified, so a count would be dishonest about data the user already accepted. An honest inbox needs persisted triage status or import provenance, i.e. v11. **Owner ruled: not paying v11 for it now.** |
| Overview as import front door | Overview summarises and offers Scan/Import; **triage lives under My Collection** | Two competing home screens inside one pillar. The set plates stay the navigational and emotional centre. |

One v1 claim was simply wrong and is withdrawn: that To Be Sorted was "nearly free because the
semantics are already correct." That holds for a quiet pseudo-set. It does not hold for the
inbox the owner originally described.

---

## 1 · Why this exists

The Collection redesign shipped a new IA (Overview / My Collection / Lists, with a set drill
under My Collection). The FAB did not follow it: the same pillar offers different FAB shapes
with overlapping actions, and the set drill carries both a search bar and a filter FAB doing
partly the same job.

Target rule: **on any Collection screen the FAB means "get cards in", filters are docked at the
bottom, and everything else is a header action.**

## 2 · Current state, verified

The FAB is **not** a global context-mutating system. `src/components/Fab.jsx` portals into a
dock slot (`src/components/BottomDock.jsx:15`); each screen declares its own.
`className="fab-stacked"` places a second FAB one height above the docked one
(`src/theme/decks.css:131`). So "which FAB on which screen" is a call-site change.

| Location | Today |
|---|---|
| `Collection.jsx:374-377` | Overview: menu — Add with camera; Import from text |
| `Collection.jsx:643` | Set drill: filter FAB, badge = active filter count |
| `Collection.jsx:644-647` | Set drill: **stacked** menu — Add with camera; Import from text |
| `Collection.jsx:1372-1383` | List detail: dots menu — Add cards; Add from text; Edit; Duplicate; Export as text; Get missing cards; Delete |
| `Collection.jsx:637` | Set drill: `SearchPill` in the dock search slot |
| `ListsIndex` `:1036`, `:1039` | List creation via per-section "+ New" buttons |

`RefineSheet` (`src/components/RefineSheet.jsx`) is shared by Collection
(`Collection.jsx:650-666`), Codex (`Codex.jsx:114-129`) and DeckAddCards
(`DeckAddCards.jsx:152`). Facets are prop-gated; **sort keys are a module constant**
(`RefineSheet.jsx:20`).

## 3 · FAB by screen

| Screen | Docked FAB | Stacked FAB | Header |
|---|---|---|---|
| Overview | camera | — | — |
| My Collection (sets home) | camera | — | — |
| Set drill | filters/sorts (badge) | camera | search glyph; bulk mode |
| Lists index | **+** → list creation wizard | — | — |
| List detail | filters/sorts (badge) | camera | search glyph; bulk mode; overflow |

Single action means a plain `Fab` with `items === null`.

**Camera teaches "Scan", not "add here".** The destination varies by context, so the
confirmation must name where cards landed. Until the native preferred-set hint exists, scanning
from a set drill must **not** imply the set was auto-assigned.

**List detail keeps its overflow.** Edit / Duplicate / Export as text / Get missing cards /
Delete are list-level, not card-level. Export as text is load-bearing: the owner uses it to
generate buy lists from what is missing in a deck or set. It must survive and should gain reach
(export the current selection, export what is missing).

## 4 · Refine sheet, scoped to Collection

Inside a set, drop **set** (we are in one), **threshold**, **totals**.
Keep **elements**, **rarity**, **type**, **artist**, and the ownership lead section
(Owned / Not owned / Wishlisted, `Collection.jsx:653-660`).

**Grouping is its own control, separate from sort:**
- `Group by: None | Element | Rarity`
- Within every group, alphabetical.
- Element and rarity are **not** sort keys and must not be modelled as such.

**Rarity needs an explicit rank** — Ordinary < Exceptional < Elite < Unique, a real
scarcity/price order. Defined once, the way `setRank` is defined once in `setCompletion.js`.

`RefineSheet` takes **caller-supplied** sort keys and grouping options rather than Collection
getting a fourth sheet chassis.

## 5 · Search and the A-Z rail

- The permanent dock search bar leaves the set drill.
- A **search glyph in the header** opens search on demand.
- A vertical **A-Z index rail** in the Manuscript language (gold, Cinzel) appears **only in
  ungrouped alphabetical mode**.
- Element and rarity grouping use **visible section headers and ordinary scrolling**. No
  adaptive alphabet; four to six sections do not need an index.
- Search also appears inside bulk mode on list detail.

## 6 · Bulk mode

Entered from a header button on set drill and list detail. The need, in the owner's words:
collect **all the cards in a set**, or **all the Ordinary cards in this set**, or **one copy of
each selected card**, without hundreds of taps.

**Selection is created from the current filtered result, then snapshotted.** "Select all 42
results" captures those rows. Later filter changes must never silently add or drop selected
cards. Bulk mode composes with the refine sheet instead of inventing a parallel predicate
language, and inherits future facets for free.

Actions: Select all / none; select all missing; select all owned; **Add 1 to each**;
**Ensure at least 1**; **Remove 1 from each** (confirm + undo); add selected to a list;
wishlist selected; export selection as text.

### The bulk write boundary

A separate bulk repository command is correct and does **not** fracture the durability model:
`ownedStepController` is a single-row *interaction* controller, while the underlying contract is
authoritative transactional persistence with honest confirmation. The boundary must:

1. capture the active profile once;
2. validate and deduplicate every (card, printing) target;
3. compute before/after values **inside** the transaction;
4. commit all rows atomically;
5. broadcast once after commit;
6. refresh/reseed affected UI only after success;
7. prevent per-row quick-add edits while the bulk command is active.

Four hundred row mutations in one transaction is reasonable in shape but **requires device
timing**. Do not split into batches: that reintroduces the partial-failure problem the
transaction exists to avoid.

### Undo

The undo record holds **each row's before and committed-after values**, not an inverse delta.
Restore a row only if its current value still equals the committed-after value; report conflicts
rather than overwriting. Session-scoped undo needs no schema change. Durable undo across
restart would need persisted operation history and likely v11 — **out of scope**.

## 7 · Unspecified triage

**Model (owner ruling): a legitimate quiet pseudo-set, not an inbox.**

- Unspecified stays a real pseudo-set under **My Collection, beside the real set plates**.
- It carries a strong **"Sort printings"** action.
- **No count-to-zero nagging.** `variant_slug=''` is a legitimate durable state ("I own this,
  I do not know or care which printing"), and the app cannot distinguish that from pending
  triage without new state. An unread-style badge would be dishonest.
- Overview summarises recent activity and offers Scan/Import. It does **not** become a second
  collection home; the set plates keep that role.

**Triage rules:**
- Group triage **by card**, and allocate quantities **across printings**. Do not assume all
  copies of a card share one printing.
- Automatically resolve **only single-printing cards**.
- Treat existing owned printings as **ranked suggestions, never proof**.
- Allow bulk assignment only when **every** selected card is actually printed in the target set
  (the intersection of valid candidate sets).
- Bulk mode (§6) operates inside Unspecified.

**Where `''` comes from today** (unchanged, and now intentional rather than a bug):
`importPlan.js:24` seeds cards printed in 2+ sets (or 0) to `''`; `importPlan.js:38` and
`ownedRepository.js:324` re-apply a `|| ''` fallback; the scanner does the same at
`cardScanner.js:100`. Undeterminable printing goes to Unspecified by design.

Existing semantics are already correct and stay: `setCompletion.js:41` excludes `''` from set
completion (a maybe-Alpha card cannot complete Beta); `homeRepository.js:284` counts it in
"Cards collected" (you do own it). The one-time cleanup at `ownedRepository.js:244-256` remains.

**Text import keeps working as one paste.** Scoping it to a set was rejected: a 100-card paste
spanning many sets would force manual pre-sorting, which is the chore the feature exists to
avoid. It stays reachable from Overview and from list detail.

**Scanner disambiguation is separate and smaller.** Scanning from inside Beta should rank or
preselect Beta in the native picker. This is a *hint*, explicitly not an attribution default.
It requires Kotlin work: `cardScanner.js:107` passes `{cards, mode, deckCounts}` into the
plugin, so it needs Capacitor/Android device evidence, not a browser pass.

## 8 · Constraints

- Invariants (`ENGINEERING_CONSTITUTION.md` §3): touches **durable offline-first writes** and
  **transactional user-data operations**. Profile isolation and the catalog/profile boundary
  must hold. Schema stays **v10**; nothing here may require a migration.
- No new sheet chassis. The cohesion pass exists to reduce them.
- Manuscript language (`DESIGN_SYSTEM.md`) governs the rail, bulk chrome and triage. New tokens
  are welcome where they earn their place.
- Zero-image mode must degrade gracefully on every new surface.
- No flowery naming in code.

## 9 · Open, deferred

- Set-level header overflow, once a set-level command exists.
- Durable cross-restart undo (v11).
- An honest pending/accepted triage distinction (v11, import provenance).
- Device timing for a 400-row transaction — required evidence before merge, not a nice-to-have.
