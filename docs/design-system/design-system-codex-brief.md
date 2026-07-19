# Codex Review Brief — Design System, Phase 1 (Audit)

**To:** Codex (principal engineer / independent reviewer)
**From:** Claude (lead)
**Artifacts under review:** `design-system-audit-report.md` (primary) · `design-system-scope.md` (scope/plan)
**Your disposition is required before** the owner rules the OD batch and Phase 2 authors `DESIGN_SYSTEM.md`.

## 1. What this is (and isn't)
This is a **read-only discovery audit** of Compendium's de-facto design system across all 5 pillars + 5 cross-cutting dimensions, plus a proposed scope for authoring a governed `DESIGN_SYSTEM.md`. **No production code has changed.** You are reviewing the *soundness of the findings*, the *framing/dispositions*, and the *scope/sequencing* — not a diff. Per Constitution §8 / AGENTS §5 Phase C, treat the audit's conclusions as claims to falsify.

## 2. Locked owner decisions — do NOT relitigate these
These are settled by the human owner; challenge only if you find hard evidence they're unsafe:
- Breadth: **all 5 pillars audited up front**, then redesign Collection against the system (not the reverse).
- Token **adoption** (replacing raw literals in code) is a **separate later track**, out of this scope.
- Sequencing: **design system first, then Collection**; the UI-state extraction pass runs in parallel.
- **Holographic foil is IN** as the one owner-mandated new primitive.
- **Guardrail:** the system is derived from *shipping reality*; an element is a Foundation only if it recurs across pillars; mockup-only elements are Candidates dispositioned explicitly. This is **not a reskin**; no pillar's look changes as an output.

## 3. Claims to verify (falsifiable — check against repo evidence)
Independently confirm or refute, citing `file:line`:
1. **Scalar token layer has 0 consumers** — `--t-*/--s-*/--r-*/--i-*/--ls-*/--blur-*/--shadow-*` (~45 tokens). (grep for `var(--t-`, etc.)
2. **The "unified gold" claim is false** — `tokens.css:24-27` says gold unified on `220,184,111`, yet `203,167,95` still ships (`GothicSheet.jsx:41`, gilt frames, boot splash, `.cx-card-seal`).
3. **`CardRow.jsx` is orphaned** (zero imports) while 3+ divergent card rows ship.
4. **Stepper ships 3× in 2 palettes** (`Frost`, `StepBtn` rose `224,169,177` vs `ownedUi.stepBtn` ruby `210,88,115`).
5. **`counter.css` / `.cx-decks` redefine token *names/values*** shadowing `:root` (e.g. `--gold-head #e3c589` vs global `#e9d49a`; `--violet-rgb 160,110,220` matches no shipped violet).
6. **Confirmed bugs** (§9): `Fab.jsx:113` `var(--danger)` undefined (should be `--destructive`); `CardArt` `var(--hair-18)` undefined; Cinzel requested weight 800 but ships ≤700 (faux-bold); needs-confirmation: haptics setting possibly inert (`native.js:haptic()` doesn't read it).
7. **The ~35–45% token-driven overall figure** — sanity-check the methodology (575 hex + 500 rgba vs 859 `var()`), and say whether you'd state it differently.

## 4. Attack these (design/framing judgment)
1. **The Candidate dispositions (§10):** is "Ring = ADOPT (unifies Home's two win-rings)" defensible, or is a ring a gratuitous new primitive? Is the foil spec's fallback set (isolated overlay / static reduced-motion / user toggle / hero-only / device-verify) sufficient and correct for the Capacitor WebView, or is it missing a failure mode?
2. **The two "walled" subsystems** (Decks `.cx-decks`, Play `counter.css`): the report frames these as "sanction-as-documented-exception OR migrate." Which do you argue for, and what's the strongest case against your own choice? (This is the highest-leverage architectural call — it decides whether "one design system, enforced" is literally true or carries a carve-out.)
3. **The guardrail itself:** does "Foundation only if it recurs across pillars" actually prevent the reskin it's meant to, or is there a loophole (e.g. a Candidate smuggled in via the Collection redesign)?
4. **Sequencing:** is "design system first, then Collection, extraction in parallel" the correct order, or should adoption/authoring interleave differently to avoid rework?

## 5. The OD batch (§11) — give a recommendation on each
For **OD-1..20**, mark each: **agree / disagree (with the alternative) / needs-owner-only**. Prioritize a firm recommendation on the high-leverage ones: OD-1 (two golds), OD-2 (gothic-brown tokens), OD-5 (jade), OD-6 (violet two-tone + fix `--violet-rgb`), OD-12 (Decks/counter exception), OD-15 (44 vs 48dp). Flag any OD that is under-specified to decide.

## 6. Output format (AGENTS §5 Phase C)
Return, in descending severity:
```
### [Blocker|Major|Minor|Suggestion] <title>
- Evidence: <path:line> and observed behavior
- Failure scenario: <specific trigger>
- Consequence: <impact>
- Required outcome: <property to achieve>
```
Then: (a) an **OD recommendation table**; (b) an explicit **disposition** — *Approved* (audit sound, proceed to owner rulings + Phase 2), *Approved with non-blocking follow-ups*, or *Changes required* (with the specific findings that block). If you find no material weakness, state what you checked and why the evidence is sufficient — "looks good" is not a review.

## 7. Boundaries
- Do not demand a broad redesign; validate whether the audit is *correct and complete* and whether the scope/sequencing is *sound*.
- Do not treat the locked owner decisions (§2) as open unless you have hard safety evidence.
- Do not begin code adoption or author `DESIGN_SYSTEM.md` — that's Phase 2, after owner rulings.
- The deliverables live in the session scratchpad; they move to a `design-system` branch under `docs/` when authoring begins.
