# §8 Proposal — Author `DESIGN_SYSTEM.md` + wire its governance

**Status:** Proposed (pre-authoring gate) · **Class:** High-risk (new cross-pillar normative source of truth + repository-governance change) · **Scope:** documentation only — **no `src/**` change**
**Owner:** Human · **Lead:** Claude · **Reviewer:** Codex
**Inputs (frozen — Checkpoint B):** `design-system-audit-report.md`, `design-system-wave1-synthesis.md` **Rev R3 + Checkpoint B freeze** (Codex-Approved; owner ruled OD-1..20 → approved items promoted to `[Target]`; `[Proposed Target]` now empty; internally reconciled), `design-system-scope.md`, `design-system-codex-brief.md` — all on `origin/design-system`.

---

## 0. Checkpoint B — frozen contract (locked before any normative prose)

**Document TOC (7 layers, fixed):** 1 Foundations · 2 Semantic · 3 Primitives · 4 Patterns · 5 Interaction · 6 Platform · 7 Governance.

**Canonical glossary (frozen terms):**
- **Pillar** — one of Home · Codex · Collection · Decks · Play.
- **Token** — a CSS custom property in `src/theme/tokens.css`.
- **Primitive** — a shared UI component (e.g. Sheet, Stepper, SectionLabel).
- **Pattern** — a recurring composition (rows, sheets, empty states, back).
- **Status** (every asserted entry declares one): **`[Shipping]`/Observed** (ships today — the ONLY vocabulary implementation may use) · **`[Exception]`** (ships today; sanctioned wall) · **`[Proposed Target]`** (recommended, pending owner ruling) · **`[Target]`** (owner-approved, not implemented) · **`[Candidate]`/Provisional** (unproven, deferred) · **`[Deprecated]`** (retire).
- **State machine:** `[Proposed Target]` →(owner approves)→ `[Target]` →(adoption track)→ `[Shipping]`.
- **Adoption** — replacing literals/consolidating primitives in `src/**`; a **separate later track**, out of this effort.

**OD ledger:** OD-1..20 = **owner-approved as recommended** (synthesis "Owner Rulings"); OD-12 = sanction both walls as current-state exceptions; OD-19 = clamp Cinzel to 700 (adoption-debt); foil = Candidate/Provisional.

**File allowlist + scope check (deny-by-default):**
- **Allowed (exact set):** `DESIGN_SYSTEM.md` (new, root) · `CLAUDE.md` · `AGENTS.md` · `COMPENDIUM_ARCHITECTURE.md` · `scripts/check-docs.mjs` · `scripts/check-docs.test.mjs` (new) · `package.json` (**the `check:docs`/`test:docs` script entries ONLY — no dependencies, no other config**) · `docs/design-system/**`.
- **Denied:** everything else — all `src/**` (incl. `src/theme/tokens.css`), any CSS/JSX/asset/token change, dependencies, and runtime/build config beyond the two named npm scripts.
- **Scope check (cross-platform, review-time).** `FREEZE_BASE` = the `design-system` tip at proposal approval. Before every commit and at final verification, inspect the **complete working state** with two plain git commands (cross-platform; no shell scripting): `git status --porcelain` (staged + unstaged + **untracked**) and `git diff --name-only FREEZE_BASE..HEAD` (committed). The author **and** Codex confirm every listed path is in the allowlist above; any path outside it (any `src/**`, dependency, or other config) → **stop Wave 2** + separate implementation proposal. This is an honest **review gate** — not a bespoke enforcement binary — which is proportionate because a documentation-only diff is trivially inspectable by eye.
- **check-docs fail-closed (cross-platform, minimal).** Refactor `check-docs.mjs` to a pure `checkDocs(root)` (injected filesystem root) beside its CLI entry. Add `scripts/check-docs.test.mjs` (`node:test`) with two cases against a temp fixture root: **present** (all `required[]` incl. `DESIGN_SYSTEM.md` → pass) and **missing** (`DESIGN_SYSTEM.md` absent → **fail**, proving fail-closed). Temp-dir + Node `fs` only — **no `chmod`, deterministic on Windows.** (The "unreadable" case is dropped: platform-fragile, low value.) Wire `"test:docs"` into `"check:docs"` so it can't fail-open; baseline `npm run check:docs`.

---

## 1. Problem & success criteria

**Problem.** Compendium has no governed design system. `tokens.css:1` claims to derive from a `DESIGN_SYSTEM.md` that does not exist; the source-of-truth table (`CLAUDE.md`) has no design-language owner; `COMPENDIUM_ARCHITECTURE.md:83` asserts "one design system, enforced / no screen invents colour" — currently aspirational. Consequences (Wave-1 verified): ~30% colour tokenisation, a 0-consumer scalar layer, a second gold shipping ~99× against the "unified" claim, one control (stepper) shipping 3×/2 palettes, an orphaned `CardRow`, and two walled subsystems. Every new screen re-litigates settled questions because nothing records that they were settled.

**Success criteria (testable):**
- **SC1** `DESIGN_SYSTEM.md` exists at repo root, structured as the 7 frozen layers, grounded in Wave-1 evidence (every claim traceable to a cite).
- **SC2** Every asserted entry carries a status; `[Target]`/`[Candidate]`/`[Proposed Target]` are never presented as usable; only `[Shipping]`/Observed is buildable-from (acceptance criterion).
- **SC3** The owner OD rulings are reflected exactly (OD-12 exceptions; OD-19 clamp-to-700 as debt; foil Candidate; the OD-3/5/7 role-approved-impl-deferred nuance).
- **SC4** Governance wired: source-of-truth row added (`CLAUDE.md` + `AGENTS.md`), `ARCHITECTURE.md:83` given a referent + the two-exceptions note, `check:docs` requires `DESIGN_SYSTEM.md` (fail-closed) with a focused test seam.
- **SC5** Full traceability recorded: audit finding → OD ruling → doc section → governance reference.
- **SC6 (acceptance test)** A reviewer can reject an invented colour/primitive by citing the doc; an agent can build a screen from it using only `[Shipping]` vocabulary.

**Non-goals.** Not a reskin; no pillar's look changes. No `src/**` edit (adoption is the later track). No new schema/data/build. Foil is **not** designed or built here.

## 2. Evidence & current architecture
Grounded in the Wave-1 synthesis (Rev R3, Codex-Approved) and its 3 reviewer packets. Key load-bearing facts: scalar tokens 0-consumer; colour ~30% tokenised (per-axis method published); `203,167,95`/`#cba75f` second gold ~99×; brown trio ~100×; stepper `Frost`/`StepBtn` (rose) vs `ownedUi.stepBtn` (ruby); `CardRow.jsx` 0 imports; `.cx-decks`/`.cx-life-tracker` scoped palettes; `check:docs` (`scripts/check-docs.mjs`) does not require the file today; the platform strengths (zero-image manual gate `cardArt.js:24`; GothicSheet WebView paint recipe; narrow backdrop-filter rule). Corrections already applied: Fab `--danger` is scoped shade-drift (not a bug); `--hair-18` benign; jade token alive (16×); `--violet-rgb` = deck-amethyst structural role.

## 3. Options considered
1. **Author `DESIGN_SYSTEM.md` as a governed doc with the Target/adoption-debt split** *(proposed)* — records shipping reality + owner-approved targets without changing pixels; unblocks Collection; enforceable via `check:docs`.
2. **Status quo / no doc** — rejected: the loop continues; `tokens.css:1` stays dangling; ARCHITECTURE:83 stays aspirational.
3. **Fold the system into `COMPENDIUM_ARCHITECTURE.md`** — rejected: bloats architecture, no clean governance owner, `tokens.css` still references a missing `DESIGN_SYSTEM.md`.
4. **Author + adopt in one pass** (replace literals now) — rejected: couples documentation to an app-wide behaviour-changing refactor; violates the behaviour-preserving guardrail and the owner's adoption-deferred decision.

## 4. Proposed design
Author `DESIGN_SYSTEM.md` per the 7 frozen layers; each entry status-tagged; the **Adoption-Debt Ledger** carries every `[Target]` item (approved, not implemented) separately from `[Shipping]` vocabulary.
- **Foundations** — token roles + rationale/constraint: brand `--gold-rgb` `[Shipping]` + owner-approved `--gilt`/numeral `[Target]` (retire the "unified" comment `[Deprecated]`); warm-brown family, warm-muted ink, `--win/--loss`, `--dur/--ease`, `--z-*`, scalar target + text-recipes, `--focus-ring` all `[Target]`. Per-axis metric.
- **Semantic** — single-accent rule + the **two sanctioned `[Exception]` walls** (OD-12): `--deck-amethyst` structural + chrome/content two-tone; Play scope-local `--bg/--gold/--gold-head`. Status colours split from wayfinding.
- **Primitives** — consolidation **[Target]** catalog (targets, not implementation equivalence): Stepper, Sheet-merge, TrophyCardScaffold, **ListRow (native-semantics base; CardRow = input only)**, SectionLabel, gilt/danger buttons, ModalScaffold, useDockSlot; `CardArt` `[Shipping]` zero-image reference; **Ring `[Candidate]`** (promotion criteria unrecorded).
- **Patterns** — rows, sheets (GothicSheet WebView paint recipe as hard pattern), rubric, empty/zero-image + BlankState, add-as-place, two-tier LIFO back. **Ghost-slot = Pattern**, not Foundation.
- **Interaction** — motion tiers `[Target]`, reduced-motion law `[Shipping]`, graded haptics `[Shipping]` + centralized-gate invariant `[Target]`, state-layer (bespoke `[Shipping]` + M3 `[Target]`), `:focus-visible` `[Target]`. **Cinzel clamp-to-700** recorded as adoption-debt (OD-19).
- **Platform** — zero-image = **manual** gate; **narrow** backdrop-filter rule; `mix-blend-mode` single non-load-bearing use. **Foil = `[Candidate]`/Provisional** — outcome constraints only (offline / reduced-motion / zero-image / non-load-bearing), no canonical technique or verified fallback.
- **Governance** — owner assigned; **promotion rule** (2-pillar necessary + shared-role/states/a11y/platform/owner-disposition); addition/disposition process; `check:docs` `required[]` + test seam; the acceptance test.

**Governance wiring:** `CLAUDE.md` + `AGENTS.md` source-of-truth rows; `AGENTS.md:299` strengthened ("must cite `DESIGN_SYSTEM.md`; a reviewer may reject invented colour/primitive by citing it"); `COMPENDIUM_ARCHITECTURE.md:83` gets a referent + the two-exceptions note (described as doc-vs-shipping discrepancy) with design specifics moved to pointers; `scripts/check-docs.mjs` adds `DESIGN_SYSTEM.md` to `required[]`.

## 5. Implementation plan (Wave 2 — exclusive lanes)
1. **Checkpoint B freeze** (this doc §0) — TOC/glossary/taxonomy/OD-ledger/allowlist locked.
2. **Design-system author** (sole writer of `DESIGN_SYSTEM.md`) — the 7 layers, prioritised Foundations → resolved tokens → primitives → pillar patterns, landing as one coherent doc.
3. **Governance writer** (exclusive: `CLAUDE.md`/`AGENTS.md`/`COMPENDIUM_ARCHITECTURE.md`/`scripts/check-docs.mjs` + `scripts/check-docs.test.mjs` + the two `package.json` script entries).
4. **Semantic verifier** (read-only: audit→OD→doc-section→governance traceability).
5. **Checkpoint C** — integrated-draft audit: every OD maps to a normative statement / explicit exception / candidate label / recorded deferral; the draft must NOT claim literals were replaced or candidates adopted; Decks/counter/foil/touch-targets match the rulings exactly.

**Every increment: the author runs the §0 review-time scope check (`git status --porcelain` + diff vs FREEZE_BASE) and confirms only allowlisted paths; any disallowed path halts Wave 2.**

## 6. Data migration & compatibility
**Not applicable** — documentation only; no schema, data, persisted format, or runtime touched.

## 7. Rollback & recovery
Code rollback = revert the doc commit(s) on `design-system`. No data transformation → no recovery path needed; point of no return: none. `check:docs` change is additive and revertible.

## 8. Verification plan
- **Scope check (§0)** — author + Codex confirm the complete working state (`git status --porcelain` + diff vs FREEZE_BASE) touches only allowlisted paths; any disallowed path → stop.
- `git diff --check` — expect PASS.
- `npm run check:docs` — now runs the validator **and** `test:docs`; expect PASS. **Fail-closed is proven** by the `missing`/`unreadable` cases in `scripts/check-docs.test.mjs` (they fail if `DESIGN_SYSTEM.md` is absent or unreadable) — no manual file-removal needed.
- **Maintained-doc search** for conflicting gold / touch-target / primitive / subsystem claims across the source-of-truth docs.
- **Traceability**: audit finding → OD ruling → `DESIGN_SYSTEM.md` section → governance reference (semantic verifier).
- **Source-of-truth disposition** for all six docs (§ Documentation impact).
- **Runtime tests & build — Not applicable** (genuinely documentation-only diff): `test:codex/query/ui/app` and `npm run build` exercise no changed runtime surface. If any `src/**` file enters the diff, the scope guard has already failed and this line is void.

## 9. Security / privacy / performance / operations
No app runtime, input, SQL, or data surface touched → no security/privacy/perf impact. The **only executable change** is the docs-validator (`scripts/check-docs.mjs`) + its new test + two `package.json` script entries — **no dependencies, no app build/runtime config**. A raw-hex `check:docs` lint is explicitly **deferred** (a future additive check, not in this diff).

## 10. Risks & open questions
- **R1** Normative overreach — a `[Target]` reads as usable. *Mitigation:* status on every entry + Adoption-Debt Ledger + Checkpoint C audit + the acceptance criterion.
- **R2** Hidden adoption — a `src/**` edit sneaks in. *Mitigation:* mechanical allowlist; any `src/**` path fails the guard.
- **R3** Sanctioning the two walls guts enforcement. *Mitigation:* they're **current-state exceptions, not ideals**; teeth come from denying *new* walls (promotion rule), not demolishing sanctioned ones (owner-ruled OD-12).
- *(Q1 resolved: repo inspection confirms `scripts/check-docs.mjs` has no test harness today; the validator-test contract in §0 creates it.)*

## 11. Self-Critique
1. **Strongest reason this is wrong:** a documentation-only design system with a large `[Target]`/adoption-debt ledger risks becoming aspirational shelf-ware — the exact failure it diagnoses — if the adoption track never funds. *Response:* the enforceable core is `[Shipping]`/Observed + `check:docs` fail-closed + the acceptance test; Targets are explicitly debt, not claims.
2. **Highest-consequence assumption if false:** that the diff stays documentation-only. If a `src/**` edit enters, "behaviour-preserving" is violated. *Guard:* mechanical allowlist + Checkpoint C.
3. **Simpler solution rejected fairly?** "Just add `DESIGN_SYSTEM.md` to `required[]` and stop" — fixes the dangling reference but records none of the reconciled decisions, so the loop persists. Rejected for under-delivery, but it *is* the minimal enforceable slice if scope must shrink.
4. **Coupling/regression missed:** editing `COMPENDIUM_ARCHITECTURE.md:83` and moving design specifics could break `check:docs`' own terminology/link checks or the pillar-count assertion — must be verified.
5. **Failure likely to escape tests:** a subtle status mislabel (a `[Target]` presented as usable) — mechanical tests won't catch semantics; the semantic verifier + Codex diff review are the backstop.
6. **Evidence that would change direction:** if `check:docs` can't be made to fail-closed cleanly, or the owner wants adoption folded in, the plan is revised before authoring.

## 12. Documentation impact
- `COMPENDIUM_ARCHITECTURE.md` — **Updated** (referent for :83 + two-exceptions note; design specifics → pointers).
- `CLAUDE.md` — **Updated** (source-of-truth row: design language → `DESIGN_SYSTEM.md`).
- `AGENTS.md` — **Updated** (mirror row + strengthened UI-review line :299).
- `DESIGN_SYSTEM.md` — **Created**.
- `scripts/check-docs.mjs` — **Updated** (`required[]` + injected-root refactor).
- `scripts/check-docs.test.mjs` — **Created** (present/missing/unreadable cases).
- `package.json` — **Updated** (`check:docs` + `test:docs` script entries only).
- `COMPENDIUM_DATA_MODEL.md` — **Reviewed, no change** (no schema/persistence/data touched).
- `COMPENDIUM_FEATURE_MATRIX.md` — **Reviewed, no change** (no capability/workflow/status change; Collection redesign is later).
- `BUILD.md` — **Reviewed, no change** (no command/build/env change; raw-hex lint deferred).

## 13. Approval record
- Codex review disposition: **—** (pending).
- Owner approval: **—** (pending).
- On approval → Wave 2 authoring (exclusive lanes, scope guard, Checkpoint C) → Codex diff review → merge.
