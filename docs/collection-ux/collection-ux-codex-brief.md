# Codex review brief — Collection UX Redesign proposal

**You are the principal / adversarial reviewer.** This brief orients you; the artifact under review is [`collection-ux-proposal.md`](./collection-ux-proposal.md) (§8, High-risk). The design reference is [`collection-on-system-mockup.html`](./collection-on-system-mockup.html). Disposition options: **Approved**, **Approved with follow-ups**, or **Changes required**.

## What this is
A realignment of the **Collection** pillar to the merged `DESIGN_SYSTEM.md` (landed `05e6ebb`) and the six-screen on-system mockup. It is **not** a rebuild — `collection-redesign` P0–P4 already shipped to `main` (verified: `97e7e0b`, `fc3bf71` are ancestors of `main`), so ~70% of the target already exists. The proposal is a reconciliation plus one genuinely new surface (sets-home) and one governed design-system amendment (the completion Ring).

## Owner rulings already recorded (do not relitigate these — review the *engineering*, not the product calls)
- **Decision A (edit-mode reversal) — APPROVED.** Permanent steppers, no "+Add" mode. This deliberately supersedes the shipped P0 toggle. *"Add is a place, not a mode, is the whole point of this redesign."*
- **Ring promotion — APPROVED.** Build the completion Ring; `[Candidate] → [Proposed Target] → [Target]`.
- **Overview kept; sets-home is the new My Collection view. New/rewritten surfaces token-clean; new tokens sanctioned.**

Your job is not to re-open these decisions but to test whether the proposal *executes them soundly and safely*.

## Where to focus your skepticism (ranked)

1. **Phase 2 write-durability — the load-bearing assumption.** The proposal claims the always-live stepper model is fully served by the existing `enqueueWrite` → `settleCollectionWrites` queue (`collectionWrites.js`) + the `collectionGoalDrain` optimistic-reconcile controller, so removing edit-mode gating introduces **no** lost/duplicated/mis-scoped owned writes. Edit-mode may have masked a race (fewer, more deliberate writes). **Attack this:** is there a rapid-tap / unmount-mid-flush / offline-then-resume path where the per-row-key serialization or the goal-drain reconcile drops or double-applies a write? Is the durability *test plan* (§8) actually sufficient to prove the invariant, or is it hand-waving? This is a durable-offline-first + transactional-user-data invariant (§3) — treat a real gap here as Changes-required.

2. **The §5 governance amendment coupled to a feature branch.** The proposal promotes the Ring and builds the warm-brown `[Target]` tokens *inside* this feature, deviating from the standing "adoption is a separate later track." The author flagged this in self-critique. **Attack this independently of the feature:** does the §5.1 recorded comparison genuinely clear the §7 promotion bar (shared semantic role; compatible states/interaction; a11y contract; platform/degradation; owner disposition)? Is "fill = contextual accent, only `--ring-track` is new" honest, or does building the Ring on Collection surfaces quietly imply changing the untouched Home/Play instances? Does anything consume a token while it is still `[Proposed Target]` (ordering violation)?

3. **Scope containment (Decision C).** The proposal says only new/rewritten surfaces change, untouched components keep their literals. **Verify the boundary is real:** are the phases actually separable, and does Phase 0 (docs/tokens only) truly land the rulings before any surface consumes them? Is there latent pressure to migrate `Collection.jsx`'s existing components wholesale?

4. **Zero-image + WebView (§3 invariants).** Sets-home plates + binder rely on `CardArt`'s fallback; the Ring is SVG. Is the claim that an SVG stroke-dashoffset arc clears the §6 WebView rules (no blend-mode, no `backdrop-filter`-over-animation, no per-frame re-raster) correct? Is the reduced-motion story (static fill, no sweep) complete?

## Known deviations the author is declaring up front (so you don't have to "catch" them)
- Reverses a shipped, previously-approved decision (Decision A) — owner re-approved.
- Couples a governed-doc amendment to a feature branch (§5) — justified by "the Ring's first real consumer is this redesign," but called out as needing independent scrutiny.
- `Collection.jsx` is a ~1400-line single file; the proposal *recommends* but does not mandate extracting `SetsHome` + a pure grouping module. Judge whether that should be mandatory.

## What a clean pass looks like
No `src/**` has changed yet — this is proposal + design reference only. A pass means: the durability test plan is sufficient to protect the write invariants; the Ring promotion is legitimately earned under §7; token/phase ordering has no violations; and the scope boundary in Decision C is enforceable. Flag anything that would let a lost write or an ungoverned token slip through.
