# Design System — Scope & Build Plan

**Status:** Scoping (pre-proposal) · **Class:** High-risk (app-wide; new governed artifact; touches foundational docs)
**Owner:** Human · **Lead:** Claude · **Reviewer:** Codex

## Objective
A single authoritative `DESIGN_SYSTEM.md`, **grounded in what all five pillars ship today**, that every agent must consult before UI work — ending the redesign loop by recording *decisions and constraints*, not just token values. `tokens.css` already claims to derive from this file; it does not exist. We are restoring it as the real, governed source of truth.

## Owner decisions locked
1. **Breadth:** all five pillars (Home · Codex · Collection · Decks · Play) fully audited and specified **up front**; the system is then used to redesign Collection.
2. **Adoption** (replacing raw literals like `#cba75f` with tokens in code): **separate later track**, not in this effort.
3. **Sequencing:** design system **first**, then Collection redesign. The UI-state extraction pass runs in parallel (logic-only, orthogonal).
4. **Holographic foil:** the owner *wants* it, but it is classified **Candidate / Provisional** — no implementation exists; design and implementation are **deferred** to a future device-verified implementation proposal. This effort may record only *outcome constraints* (offline, reduced-motion safe, zero-image safe, non-load-bearing degradation) — **not** a canonical technique or a verified fallback.

## The anti-reskin guardrail (core constraint)
- The system is **derived from shipping reality.** Two-pillar recurrence is **necessary but NOT sufficient** for **Foundation** status; promotion also requires a *recorded comparison* demonstrating: shared semantic role, compatible states + interaction, compatible accessibility contract, compatible platform/degradation behavior, and explicit owner disposition.
- Anything that appears **only in the new Collection mockup** — completion rings, wax-seals, corner brackets, fleuron rules, tooled plates, ghost slots — is a **Candidate**, dispositioned explicitly during Assert (Reuse / Compose / Adopt / Drop). It is **never assumed in.** Foil is owner-*wanted* but stays **Candidate / Provisional** (deferred), not an assumed-in Foundation; even Ring stays Candidate until its promotion comparison is recorded.
- **No screen's current look changes as an output of this doc.** Adoption is a later, behavior-preserving track. This effort documents and asserts; it does not restyle.

## Success criteria
- Every `tokens.css` token documented with meaning, constraint, and rationale.
- Every shared primitive cataloged: anatomy, states, tokens used, a11y/touch contract.
- **Drift ledger:** every raw color/spacing literal in the codebase mapped to a token — or flagged as a genuinely missing token.
- Every cross-pillar inconsistency **reconciled to one canonical choice** or recorded as an explicit owner decision.
- Platform constraints (zero-image, WebView paint, offline/no-CDN fonts, native/web parity) captured as first-class rules.
- Governance wired: owner assigned, addition process defined, foundational docs updated, `check:docs` extended.
- **Acceptance test:** a reviewer can reject invented color/primitives by citing the doc; and an agent can build a new screen from it **using only `[Shipping]`/Observed vocabulary**. `[Target]` entries require the adoption track first, and `[Candidate]`/`[Proposed Target]` entries require promotion or owner approval, before either may be used.

## Method
**Audit (read-only) → Assert (reconcile + decide) → §8 Proposal (Codex review + owner approval) → Author (write doc) → Govern (wire foundational docs).**
The **§8 proposal gates all normative authoring** — no `DESIGN_SYSTEM.md` prose or governance edit is written before the proposal is reviewed and approved.

### Phase 1 — Audit (parallel, read-only)
Structured reports across two axes:
- **Per-pillar (5):** Home, Codex, Collection, Decks, Play — for each: screens/views, tokens vs. raw literals used, primitives used, patterns, bespoke one-offs, and inconsistencies vs. other pillars.
- **Cross-cutting (5):**
  - **Tokens + drift** — full `tokens.css` inventory + every raw literal in the codebase (the drift ledger).
  - **Primitives/components** — `src/components/ui.jsx` + siblings: shared vocabulary, props, states.
  - **Typography + iconography** — `fonts.css`, type-scale usage, icon sources/fallbacks.
  - **Motion + interaction + M3** — animations, reduced-motion, haptics, back behavior, the M3-behavior-over-grimoire-looks contract.
  - **Platform constraints** — zero-image degradation, WebView gotchas, offline/font, native/web differences (from `BUILD.md`, code, memories).

### Phase 2 — Assert / synthesize
- Reconciled token inventory + primitive catalog.
- Resolve conflicts → canonical decisions; surface the ones needing an owner ruling.
- Disposition every Candidate element; **classify foil as Candidate/Provisional and record only its outcome constraints** (no canonical technique or verified fallback). New tokens/primitives are tagged **Target — approved, not implemented**; a distinct adoption-debt ledger keeps them separate from shipping vocabulary.

### Phase 3 — Author `DESIGN_SYSTEM.md` (seven layers)
Foundations · Semantic layer · Primitive catalog · Patterns · Interaction contract · Platform constraints · Governance.

### Phase 4 — Govern (the ramifications)
- `CLAUDE.md` source-of-truth table — add the design-language owner row.
- `COMPENDIUM_ARCHITECTURE.md` — its "one design system, enforced / no screen invents color" claim gets a real referent; design specifics move to the new doc.
- `AGENTS.md` — agents must consult `DESIGN_SYSTEM.md` before UI work; strengthen the UI review checklist.
- `check:docs` — resolve the (currently dangling) reference; later, a raw-hex lint.

## Checkpoints (owner decision points)
- **After Phase 1:** review audit findings + the cross-pillar conflict list *before* asserting.
- **During Phase 2:** any conflict without an obvious canonical answer → owner ruling (batched, not one-by-one).
- **Before any normative authoring (corrected — NOT before Phase 4):** after the OD rulings and the Checkpoint B input-freeze, the effort produces the **full §8 proposal** (alternatives, documentation-impact, rollback, verification, Self-Critique) and obtains **Codex review + owner approval before writing any normative `DESIGN_SYSTEM.md` content or governance edit.** Phase-1 audit is read-only discovery; *asserting and authoring* the cross-pillar source of truth is High-risk and must not precede the approved proposal.

## Non-goals
- Not a reskin; not a new aesthetic direction.
- Not code adoption (separate later track).
- Not behavior change; no pillar's current look changes here.

## Effort & cost
- **Phase 1 is a multi-agent, app-wide sweep (~10 parallel subagents).** Meaningful token spend — requires explicit go-ahead before launch.
- Phases 2–3 are synthesis + authorship (single-threaded, with owner checkpoints).

## Risks
- **Reskin-by-candidate** → mitigated by the Foundation-vs-Candidate guardrail.
- **Conflict overload / analysis paralysis** → mitigated by "assert one canonical choice" + batched owner rulings.
- **A doc nobody follows** → mitigated by governance wiring + the review-checklist enforcement + the acceptance test.
