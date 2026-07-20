# Codex re-review — delta since the last pass (branch `collection-ux-build`)

You have already reviewed this branch three times. This is a **delta brief**: what changed
since your last disposition, what to verify, and what is still deferred. The full context
remains in [`collection-ux-review-brief.md`](./collection-ux-review-brief.md).

Last disposition: *Changes required* — two Majors (combined-failure state; quick-add announcing
confirmation before persistence). Both are addressed below, along with owner-directed UX work
you have not seen.

---

## 1 · Your two Majors — verify the fixes

**(a) Combined failure was reported as "count restored".** `ownedStepController` now
distinguishes **three** outcomes at ladder exhaustion, each with its own message:

| reason | meaning | is the displayed count trustworthy? |
|---|---|---|
| `save-failed` | write failed, authoritative read succeeded | yes — genuinely restored |
| `unconfirmed` | write succeeded, read never did | provisional, likely correct |
| `save-failed-unresolved` | **both** failed | no — unresolved delta still on screen |

Test: *"write REJECTED and reads exhausted is its own state"* asserts the distinct reason **and**
that `pendingDelta` is still non-zero (i.e. we do not claim restoration).

**(b) Quick-add announced confirmation on tap.** Feedback is now split by what actually
happened. A tap gives a **pending** look only (dimmed, slightly pressed). The gold pop, tick
and toast fire from a per-row `{pending, ok, error}` status the grid derives from the
controller, where `ok` increments **only when a row's chain drains successfully**. Failure and
unconfirmed remain distinguishable via their own toasts.

Please check the seam I am least sure of: `Collection.jsx` `onChange` computes
`justConfirmed = was.pending && !pending && !st.error`. Is that transition detection correct
under interleaved rows and repeat taps?

---

## 2 · Changes you have NOT reviewed (owner-directed)

- **2-up grid** (was 3): the corner add button crowded the card title.
- **Quick-add restyled** to the FAB-menu palette via a new optional `variant` on `Frost`
  (dark frosted ground, gold hairline, gold glyph). Deliberately a variant, not a global
  restyle — `Frost` is also the inline ±  in list rows, the card sheet and `DeckAddCards`,
  which stay rose.
- **Cumulative burst toast**: `1 ×` → `2 ×` → `3 × <name> added`. A burst of taps often drains
  as ONE chain, so each confirmation credits every tap it covers; the run resets after a 2.6s
  pause. **I found and fixed an over-count while preparing this brief**: taps in a chain that
  drained with an *error* were not discarded and would be credited to the next successful
  confirmation. Worth an adversarial look at whether any other path leaks taps.
- **⚠ Toast host reworked — APP-WIDE, beyond this branch's scope.** `ToastHost` was remounting
  on every message (new key), replaying the entrance animation and reading as a stutter. Now:
  first message mounts and animates in; subsequent messages swap text on the **same key** (no
  remount, no replay); the last animates out on the reversed keyframe. This affects **every
  toast in Compendium**, not just Collection. Flagging it explicitly as scope.
- **Phantom scroll fixed**: the sets landing reserved 150px of bottom padding for a docked FAB
  and search pill that only exist in the drill.
- **Sticky header drift fixed**: the pillar root's 4px top padding meant the sticky drill
  header travelled 4px before pinning; a -4px top margin makes it start flush.
- **"Open in Codex" fully removed** (owner ruling) — block, prop, signature and caller.

---

## 3 · Still deferred (your own costed follow-ups, unchanged)

Not attempted; recorded rather than silently dropped:
- Manual **zero-image** pass across set tiles, drill, sheet and art viewer.
- **Full-set scroll / memory / image-load profiling** (~780 tiles) — `content-visibility` is
  plausible but not evidence at that workload.
- **Font-scaling and a11y traversal**.
- Deeper **tokenisation** of the viewer/sheet literals; splitting the ~1,300-line
  `Collection.jsx` into Overview / Cards / ListsIndex / ListDetail.

---

## 4 · Verification

`test:codex` 10 · `test:query` 169 · `test:ui` 97 · `test:app` 14 · `check:types` ·
`check:docs` · `build` — all PASS.

Device: **Pixel 9 Pro XL, Android 17 (SDK 37), WebView 150.0.7871.46**, signed release APKs
through build 95.

The stray untracked file you spotted is gone — it was mine, from a malformed shell command.
