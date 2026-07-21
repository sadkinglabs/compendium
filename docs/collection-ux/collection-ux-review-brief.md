# Codex review brief — Collection UX redesign (branch `collection-ux-build`)

**You are the principal / adversarial reviewer.** This is an *actual-diff* review of a large,
device-verified branch. Disposition: **Approved**, **Approved with follow-ups**, or **Changes
required**.

Governing artifacts: [`collection-ux-proposal.md`](./collection-ux-proposal.md) (the approved
§8 proposal) and `DESIGN_SYSTEM.md`. Baseline: `main` @ `05e6ebb`.

---

## 1 · What landed

The six approved phases, in order:

| Phase | What |
|---|---|
| 0 | Ring + warm-brown tokens defined `[Target]` (unconsumed) |
| 1a/1b/1c | pure `buildSetCompletion`; `Ring` primitive; `SetsHome` landing + per-set drill |
| 2a/2b/2c | pure `ownedStepController`; `useOwnedLedger` routed through it; **edit mode killed** |
| 3 | ownership lens (pulled forward into 2c, then **removed** — see §3) |
| 4 | card sheet un-gated (landed inside 2c as a necessary consequence) |
| 5 | three distinct list grammars + token cleanup |
| 6 | coverage/export consistency pass |

**Owner-directed additions BEYOND the approved proposal** (flagged deliberately — please review
them as scope, not just as code):
- Set hero art as bundled assets (`public/sets/*.webp`), incl. **generated** α/β/star logos.
- A full **tile reskin** of the sets landing (adopted from an owner-supplied spec).
- A **full-screen card art viewer** with gyro parallax and a FLIP pop from/to the sheet.
- **Wishlist became a toggle** (was a stepper).
- Card view only (Ledger/Binder toggle removed); ownership lens removed.
- "Open in Codex" **dropped** from the card sheet.

---

## 2 · What the owner most wants your judgement on

Please structure your findings against these eight. They care about them in roughly this order.

### (1) UX — is the flow right, and is adding a card cheap?
The thesis is **add-is-a-place-not-a-mode**. Count the taps from launch to "I own this card"
and say whether the flow is honest about intent. Sets landing → tile → set grid → tile `+`
(missing cards) or card sheet steppers. Is anything ceremonial? Is the drill's back/return
obvious? Does the sheet make it clear *which printing* it is editing?

### (2) Is the three-list logic sound and legible?
Wishlist (pinned, a *state*, heart, `owned_cards.qty_wanted`) vs **Wanted lists** (goals with
per-card targets, `card_lists kind='wanted'`) vs **Card lists** (groupings, `kind='custom'`).
Each now has a distinct grammar (heart / completion bar / fanned thumbs). Is the *conceptual*
split clear to a user, and is the code's handling of the virtual wishlist (`__wishlist__`
sentinel reusing `ListDetail`) sound?

### (3) Is the add logic sound and correct?
This is the **highest-risk area** — see §4 below. Owned writes are per-printing
(`owned_cards.variant_slug` = set code, `:f` foil, `''` unspecified).

### (4) Dead code from the restructure
Several surfaces were removed (edit mode, list view, the lens, the page ring, Open-in-Codex).
I swept what I noticed — `ViewToggle`, `VIEW_KEY`, `showSteppers`, `EyeGlyph`, `CountRing`,
`cx-deal`/`cx-view-fade` CSS, `--ring-halo`, the `onOpenCodex` plumbing. **Please look for what
I missed**, including now-unreachable branches inside `groupCollection` (it still accepts an
`editMode` param no caller sets) and any orphaned exports in `CollectionCardViews.jsx`.

### (5) Hardcoded values that should be tokens
New tokens were minted (`--gilt-rgb`, `--gold-num`, `--ink-muted-warm`, `--ink-dim/-dimmest`,
`--tile-*`, `--shadow-tile`, `--track-neutral`, `--completion-fill`, `--rule-warm`). I unified
**three** stray Collection pinks onto `--accent-ruby` (`#d24d78`, `#e0899e`, `#c76d85`) and the
deprecated jade `#63c9a3` (OD-5). **The new surfaces are NOT fully tokenised** — `SetsHome`,
`CardArtViewer` and the sheet still carry raw literals (shadows, glows, some inks). Call out
what should be routed, and whether any *new* token is really a near-dupe of an existing one.

### (6) Extraction opportunities
Which of these deserve to be shared primitives rather than living in Collection?
`Ring`, `ActionButton`, the completion bar, the tile shell, `CardArtViewer`, `ListFan`,
`buildSetCompletion`, `ownedStepController`. Note that `Collection.jsx` is **~1,300 lines** and
holds Overview, Cards, ListsIndex and ListDetail.

### (7) Review as a TESTER, not only an engineer
What breaks, what confuses, what is missing — and **what would each fix cost**? Specific things
I suspect: a 3-column grid of ~780 tiles (scroll + image load), the filter sheet's "Not owned"
chip still making an edited row vanish, gyro behaviour if the viewer opens mid-motion, and
zero-image mode across all the new surfaces.

### (8) Foil — read the constraint before answering
The owner wants the "Trainer Gallery Holofoil" look from `simeydotme/pokemon-cards-css`.

> **That repository is GPL-3.0.** Copying its code into Compendium and distributing an APK
> would make the whole app a derivative work: Compendium would have to be licensed GPL-3.0 with
> full source published, it would foreclose the iOS App Store (the VLC precedent), and anyone
> could legally fork and republish it. Its holo also depends on third-party textures (Vecteezy,
> aschefield101) with their own restrictive licences. **So the plan is NOT to copy it.** The
> owner has been briefed and accepts this.

The question for you is therefore: **is a clean-room implementation viable and what does it
cost?** Techniques are not copyrightable — only their code and assets are. Assess: can we get a
convincing holo from our own CSS with *procedurally generated* textures (the app is strictly
offline / no-CDN)? What is the WebView risk (blend modes are engine-sensitive and used exactly
once in the app today; `backdrop-filter` over animating regions is banned)? What is the frame
cost on a low-end device? Should it be confined to the art viewer (one card, deliberate) rather
than grids? Foil is `[Candidate]`/Provisional in `DESIGN_SYSTEM.md` with outcome constraints
already recorded (offline, reduced-motion safe, zero-image safe, non-load-bearing).

---

## 3 · Decisions already made — review the execution, not the call

These were owner rulings; don't relitigate them, but *do* flag if the code betrays them:
- **Edit mode is gone** (deliberate reversal of shipped `collection-redesign` P0).
- **Completion counts non-foil only.** Foil is reported per set but never in completion.
- **Rings on tiles → bars**, because a ring over set art fought the logos. The `Ring` primitive
  survives for the per-set drill header.
- **No separate completion colour** — `#d24d78` was rejected as a near-dupe; the pillar accent
  *is* the completion colour.
- **Card view only**; **no inline lens** (the filter sheet already owned ownership narrowing,
  and an always-on lens made a just-added card vanish).
- **Wishlist is a toggle**, not a quantity.
- The proposal's footnote *"owned is edited only in Collection"* was **deliberately dropped** —
  Phase 2 made it false.

---

## 4 · Where to dig hardest: the durable-write path

The redesign made writes **ambient** (a stepper on every tile, always live), so this is where a
defect costs real user data.

- `ownedStepController` (`src/store/ownedStepController.js`, 6 tests) implements the
  provisional/confirmed contract: displayed = `confirmedQty + pendingDelta` clamped at 0;
  reconcile ONLY when the row chain drains (`pendingCount → 0`) under a version guard; a
  mid-chain failure is recorded but provisional state is **not** cleared early; one
  authoritative read + one `notify` per drained chain; `isAlive` drops a post-unmount apply.
- `useOwnedLedger` (`src/components/OwnedControl.jsx`) holds **one controller per quantity**
  (owned/foil/wanted) and is the single stepper→store boundary.
- Underneath: `enqueueWrite` (`collectionWrites.js`) serialises per persisted-row key, bound to
  the profile captured at tap time.

**The honest limit, stated in the proposal:** the queue is in-memory, so durability is
*confirmed-on-resolve, not on-display*. Kill/reopen preserves every **confirmed** tap, not
every displayed one. **Please verify the code actually honours that contract** — particularly
the wishlist, which writes card-level to the `''` row while owned writes go to the per-set row,
i.e. two different chains that both touch `writeQty`.

⚠ **One unreproduced report:** the owner saw a sheet wishlist edit not reflected in the
Wishlist list. I traced `setWanted → writeQty (upserts '' row) → bump()` and
`wishlistCards() (SUM(qty_wanted) HAVING > 0)` and could not reproduce it by inspection. The
surface has since changed to a toggle. **If you can find a real path to that symptom, it is the
most valuable thing in this review.**

---

## 5 · Verification already done

`npm run build` · `check:types` · `check:docs` · **`test:query` 151** · **`test:ui` 97** — all
green on every commit. Device-verified on a Pixel 9 Pro XL through builds 71→88 (signed release
APKs, not debug).

**Not covered by automation, and worth your scepticism:** zero-image mode on the new surfaces,
the WebView behaviour of the art viewer's transforms, gyro, and the 3-column grid's scroll and
image load on a full set.
