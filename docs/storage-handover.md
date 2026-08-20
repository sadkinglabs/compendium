# Collection Storage — handover

**Branch:** `collection-storage`, 31 commits off `main`. **Build:** 1.1.0-alpha 285, installed on the
owner's Pixel 9 Pro XL. **Written:** 2026-08-18, by the outgoing agent, for whoever finishes this.

Read this, then `docs/storage-decision-ledger.md`, then Appendix A of
`docs/proposals/collection-storage.md`. In that order. The third one is the reason the second one
exists.

> **Successor update, 2026-08-18.** Sections 4, 5 and 9 below describe the state received at build
> 285. The replacement working diff has since fixed the empty-detail crash (the missing `EmptyCta`
> import), completed the card ledger, direct filing, inline return to Unfiled, scoped bulk filing,
> Codex read-only summary, delete-profile enumeration and documentation, while leaving the reviewed
> storage core intact. The automated 1/2/1 acceptance fixture and repository/UI/app/type/cycle/source/
> docs/build gates pass. An installed-app owner pass and independent final diff review are still
> required; until those happen this addendum records implementation, not release approval.

---

## 1. The one thing to understand before touching anything

**The data layer is sound and verified. The UI is not.** The line is clean:

| | State |
|---|---|
| `src/store/storage*.js`, `canonicaliseBoot`, `profileTransfer`, the routed writers | Reviewed, tested, device-verified against a real 1838-copy collection |
| `src/pillars/CollectionStorage.jsx` and its wiring in `Collection.jsx` | Built three times, wrong three times, one open crash |

Do not let a UI rewrite drag the store with it. If you revert, revert `fea9b78` and after; keep
everything before it.

---

## 2. The model, in one paragraph

Every owned copy is in exactly one **place**. "Unfiled" is a place. The collection is what the
places add up to:

    qty_owned = SUM(storage_allocations.qty for that owned row)

`qty_owned` stays a materialised column every reader already uses, but it is now the SUM this model
maintains rather than a second number that can drift. Filing **moves** a copy between places; it
never claims it against a separate total. That is why there is no conflict resolution anywhere: the
question "which copy left?" cannot arise, because a decrease always names its place.

Consequences worth having in your head before you read code: a global decrease takes from Unfiled
**only** and refuses rather than reaching into a binder; total removal (set-to-zero) is the
exception and takes the filing with it, because when every copy leaves there is nothing to
attribute; a key move (triage, canonicalisation) **re-parents** allocations so copies keep their
container.

---

## 3. What is done and trustworthy

**Increment 1 — schema v12 and the transactional core.** `storage_containers`,
`storage_allocations`, native FK enforcement verified at open (the DB refuses to open without it),
the boot backfill, canonicalisation re-parenting. `storageRepository.js` is DOM-free, node-testable,
and returns *statements* rather than executing them, so callers compose them into transactions they
already own — that property is load-bearing and worth preserving.

**Every writer that moves `qty_owned` is routed**, in one transaction with its places:

| Module | Paths |
|---|---|
| `ownedRepository.js` | `writeQty`, `setFoil`, `writeSetRow`, `addCopies`, `addOwnedCopiesInSet` — nine exported writers |
| `ownedImportRepository.js` | the absolute row batch, the read-free resolved import |
| `triageRepository.js` | the key move, re-parenting |
| `wantedBulkRepository.js` | none — wants hold no copies, proven inert rather than assumed |

Statement **order** inside a transaction is a correctness property: clears and removals, then the
counts, then the places. A clear must precede the row DELETE it enables under `RESTRICT`; a place
must follow the row it resolves.

**Increment 2 — export/import**, with the incoming graph validated rather than trusted: over-placement
clamped, duplicate places merged, malformed counts sanitised once and stored as sanitised.

**Device evidence, build 278–282, the owner's real collection:** 995 owned rows, 1838 copies, 1838
placed, 0 out of balance, 0 legacy v10 keys, 0 duplicate places. Triage verified to re-parent into
the same container. A bulk Set-to-0 over filed copies succeeded — that path would have thrown a
foreign-key error before `db4c3ae`.

---

## 4. What was NOT done at handover (closed in the successor diff)

- **Received gap — Increment 4, the per-card ledger.** This is the feature. Q16: steppers in the card sheet against
  a live remainder. Until it exists, a user cannot put a card into a place at all — the current UI
  only browses places. `placeStatements` and `planPlaceRemoval` are built, tested, and have no caller.
- **Received gap — Increment 5, bulk Put Away** from Unfiled (Q14).
- **Received gap — Increment 6, docs**, including storage in the delete-profile confirmation (Q29).
- The two behaviours that most need device time and have never had it: a decrease **refusing**
  because copies are filed, and triage preserving containers, both unreachable on the owner's own
  profile because it has no binders until increment 4 exists.

---

## 5. The crash received at handover (closed: missing `EmptyCta` import)

**Tapping a place row on the Storage surface crashed the app** (owner, build 285). Not diagnosed.

What is known: both places showed 0 copies, so it happened on an **empty** container. Every
automated run died in the harness before reaching a place with contents, so `StorageDetail` has
never opened successfully under observation.

What is contaminated: the logcat at the time is flooded with `uiautomator` dumps because I was
driving the device while the owner was using it. There is no usable stack trace, and I cannot rule
out that my automation contributed. **Reproduce it cleanly on an idle device before theorising.**

Where I would look first, in order — all guesses, none verified:

1. `StorageDetail`'s `siblings` state, added last, populated in `load()`.
2. `AppBar`'s `eyebrowColor` being handed `containerColourVar(...)` — a `var()` string where other
   callers pass a literal token.
3. The `useEffect` that calls `onBack()` when `meta === null`, which can fire during the first
   render pass before `load()` resolves.

---

## 6. Where the decisions live — read this before designing anything

**The thirty design answers (Q1–Q30) are cited all through the proposal and were recorded nowhere in
the repo until today.** They existed only in the design conversation. Six of the nine original UI
divergences trace directly to building against citation numbers whose text had never been read.

They are now **Appendix A** of `docs/proposals/collection-storage.md`, with the owner's four
amendments and the supersessions marked. Superseded answers matter as much as live ones — Q4's drain
policy, Q11's no-colour, Q13/Q15's derived Unfiled, Q28's version — because the r3 model reversal
changed the shape of the feature after those answers were given.

`docs/storage-decision-ledger.md` tracks every decision against what was actually built.

**Live rulings the UI must satisfy** (all in Appendix A, listed here because they are the ones that
were violated):

- Storage is the **third segment** of My Collection: `All · Sets · Storage`. The chip row stays at
  three. (Owner, amended 2026-08-18, superseding "below the sets grid".)
- Container detail uses **the same chassis as list detail** — `AppBar variant="sub"`, `SearchPill`,
  the filter FAB for Arrange, `SortRow` over `LIST_SORT_OPTIONS`. (Q21.)
- Unfiled is **pinned first**, visually distinct. (Q15.)
- The word is **"Unfiled"**. "Loose" was rejected by name and must not appear in copy.
- Kind is **editable after creation** (Q8). Duplicate names **warn**, never refuse (Q9). A container
  has **one optional description line** (Q12). Ordering is **manual** (Q10). Kinds are Binder / Box /
  **Deck** / Other (Q7).
- Allocation is a **stepper**, never a "move to folder" — four copies legitimately sit in three
  places at once, and a move gesture teaches the opposite. (Q16.)

---

## 7. Traps

**Reuse before writing.** The proposal has a reuse inventory naming the exact components. The app
opens every refine surface with a stacked filter FAB, creates with an add FAB, uses `EmptyCta` for
empty states, and puts `OverflowMenu` in **headers only**. I invented replacements for all four and
the owner caught each one on screen. Grep for an existing usage before adding a control.

**`ListRow` is a clickable `<div>`.** A button nested inside it never receives the tap.

**The bucket is not the key.** `''` is *both* the UI's uncategorised bucket *and* the v10 legacy key,
so no guard can distinguish them by value. Only canonical slugs may reach the persistence boundary;
`assertCanonicalSlug` enforces it at write sites. This cost a silent no-op in `undoBulkOwned` before
that module was deleted.

**Fixtures that cannot fail.** A seeded owned row with copies and no allocation is a state v12 cannot
produce, and it makes every decrease look like a conflict. Seed as the backfill leaves them. The
original increment-1 bug survived because fixtures had been "fixed" by deleting the very state that
exposed it.

**Verify tests can fail.** Every assertion in `src/store/storage*` was checked by deleting its
production code and watching the test go red. Green means nothing until you have seen it red.

**Device tests: the owner runs them.** Never drive the phone while they are holding it. I did, and it
polluted the only crash log we had.

---

## 8. Gates

```
npm run test:query   1151    npm run check:types
npm run test:ui       213    npm run check:cycles
npm run test:app       17    npm run check:source
npm run test:codex     10    npm run check:docs
npm run build                npm run check:smoke   (device, 8/8 on 285)
```

All green at 285. `package.json` has an uncommitted `build` bump — the standing rule is +1 per device
install.

Review artefacts (`CODEX-*.md`, `docs/*.diff`) are deliberately untracked; do not commit them.

---

## 9. Outgoing recommendation at handover (historical)

Reproduce the crash on an idle device first — it is the only unknown that blocks everything else.
Then decide whether to keep `CollectionStorage.jsx` or rewrite it against §6; it is roughly 400 lines
and the decisions are now written down, so a rewrite is cheap and probably cleaner than patching mine.

Then build increment 4. Browsing places is not the feature; putting a card into one is. The tester's
sentence is the acceptance test:

> "if I have 4 copies of a card from Beta, I would like to allocate 1 copy to my Beta binder, 2 to my
> whatever deck, and 1 in my storage box."

Until that works end to end on a device, Storage is not shippable — and the owner should be shown it
working before being told it is done. That last part is where today went wrong.
