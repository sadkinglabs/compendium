# Codex review brief — `collection-ux-build`, complete diff

**Ask:** full adversarial review of the branch against `main`, then a disposition. You have
reviewed parts of this branch six times; this is the whole thing end to end, including work you
have not seen (two new quality gates, a new design-system primitive, the FAB remap, and four
bug fixes found on device after your last pass).

```bash
git diff main...HEAD          # 66 files, +7557 / -468
git log --oneline main..HEAD  # 68 commits
```

Everything below is landed and device-verified unless stated otherwise.

---

## 1 · What this branch is

The Collection pillar redesign: a sets landing with per-set drill, permanent steppers (no edit
mode), a card art viewer, grouping, and the store-side foundation for bulk selection. Plus two
gates that exist because this branch shipped a build that started and then blanked.

Foil was built and then **reverted entirely** (`e698f75`) on owner ruling — real foil printings
use different artwork, so a procedural overlay on the base image was never going to represent
one. The commits are in history; the code is not in the tree.

## 2 · The parts you have already dispositioned

Approved, unchanged since: the durability core (`ownedStepController`, `ownedStepGrid`), the
exclusive write barrier and admission gate, the bulk command and its undo contract, the
unconfirmed-result semantics, and the milestone/counterfactual testing rules.

**Please re-read only for integration damage**, not correctness.

## 3 · What is NEW since your last review

### 3.1 Two quality gates

`check:cycles` — Tarjan SCC over `src/**`, fails on any circular import. Dynamic `import()` is
deliberately not an edge.

`check:smoke` — drives the installed **release APK** and asserts each route rendered. It exists
because a latent `GothicSheet ↔ ui.jsx` cycle blanked the app on launch in the **minified**
build while every gate was green, `npm run build` included. It asserts what drew, not the
absence of logged errors; it wakes the screen and reports screen-off/locked as their own
failures; it cannot drive FAB menus (documented, with the reason).

**Attack these two hardest.** They are now the thing standing between a green run and a broken
APK, so a false green here is worse than a bug in a feature.

### 3.2 `OverflowMenu` — new `[Shipping]` primitive

`src/components/OverflowMenu.jsx`, registered in `DESIGN_SYSTEM.md` §3/§4 with its first
consumers. Encodes one hard rule: **no `transform: scale()` on the panel**, because the `Fab`
menu scales from `.18` and the WebView a11y tree keeps reporting that pre-transition box (a
170px menu reports itself at ~36px). Fingers are unaffected; assistive tech and automation are
not.

### 3.3 The FAB / overflow split

Owner's rule: **FAB is filter/sort + camera; overflow is editing and bulk.**

| Screen | FAB | Overflow |
|---|---|---|
| Overview | camera | typed import |
| My Collection | camera | — |
| Set drill | filters + camera (stacked) | export missing |
| Lists index | `+` (creation) | — |
| List detail | add cards | 6 list commands |

**Known deviation:** list detail is not a camera FAB. `launchScanner` has only `collection`
and `deck` modes, so a camera there would silently add to the collection rather than the list.

### 3.4 Four bugs found on device after your last pass

1. **Element grouping crashed the drill.** `cards.elements` is a JSON *string*; `elemKey` called
   `.filter` on it. Rarity grouping worked, which is why the first device test missed it.
   Normalised in `elements.js`.
2. **Clear crashed the refine sheet** — orphaned `setSort([])` after that state was removed.
3. **Owned meant two different things.** Completion counted non-foil; the filter counted
   `owned + foil`. A Beta collection read 401/402 while "Not owned" returned zero results, so
   the one card owned only in foil was unfindable. The filter now follows completion.
4. **Avatars were bucketed as "Unknown"** — they genuinely have no rarity; they get their own
   section now.

## 4 · Where I want adversarial attention

1. **`check:smoke` false-green.** Can it pass while the app is broken? Route expectations are
   substrings of rendered text; a stale screen from a failed tap could satisfy the next route.
2. **The owned = non-foil change** (`collectionGroups.js`). It changes filter semantics for
   every Collection surface. Is aligning to completion right, or should a foil-only card be a
   third state rather than "not owned"?
3. **`Collection.jsx` is ~1400 lines** and grew again. You costed splitting it before and I
   deferred; say if that is now blocking.
4. **Grouping vs the A-Z rail.** `letterIndex` ships and is tested but has **no consumer** —
   the rail is Phase 4. That violates the lifecycle rule you enforce for tokens; is dead-but-
   tested store code the same offence?
5. **Session cache.** `session.groupBy` joined a module-level mutable object. Does that survive
   profile switching correctly?
6. **The set-drill export follows the active filter.** Defensible or surprising?

## 5 · Known-unfinished, deliberately

- **Phase 5 (bulk mode UI)** — the store side is complete, reviewed and tested; nothing calls
  `applyBulkOwned` yet. It is dead code in the shipped app today.
- **Phase 4** — header search glyph and the A-Z rail.
- **Phase 6** — Unspecified triage.
- Stale FAB-menu a11y bounds (pre-existing, shared component).
- `Collection.jsx` split.

## 6 · Verification

`test:codex` 10 · `test:query` 275 · `test:ui` 97 · `test:app` 14 · smoke unit 25 ·
`check:types` · `check:cycles` · `check:docs` · `build` — all pass.

`check:smoke` 8/8 routes on the **minified release**, build 127, Pixel 9 Pro XL,
WebView 150.0.7871.46.

Device evidence for the bulk transaction (build 105, real 486-row database): 400 upserts in one
transaction 43.8ms, 1000 upserts 129.7ms, before-read 7.5ms, read-back 5.4ms.

## 7 · Process notes worth your judgement

Three times on this branch a test passed while proving nothing: a barrier that was a 4-second
deadlock, concurrency tests that passed with the barrier removed, and ordering assertions that
could not distinguish a working barrier from a deadlocked one. The response was to make
counterfactuals automated — `lostUpdateScenario()` runs the same scenario against a
pass-through barrier and asserts the increment IS lost.

I also twice diagnosed a crash from a symptom's shape rather than reading the error: a mangled
minified name sent me hunting import cycles when the unminified build named the variable
immediately, and a phone with its screen off was reported as a blank app. Both produced real
fixes, but the method was wrong and cost hours. If you see that pattern elsewhere in the diff,
say so.
