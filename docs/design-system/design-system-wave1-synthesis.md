# Design System — Wave 1 Synthesis (Master Evidence & Decision Ledger) — **Rev R3**

**Lead/coordinator synthesis of 3 independent read-only reviewers** (Foundations, Patterns & Interaction, Architecture Adversary), **revised per Codex Wave-1 disposition (Changes Required).** Supersedes the original audit where they disagree.

**Checkpoint A is NOT cleared.** Wave 2 authoring cannot begin until: (1) Codex clears the focused re-review; (2) the owner rules or defers OD-1..20; (3) foil + both walled-subsystem calls are decided. *Silence is not approval — including mine.*

---

## Revision R2 → R3 — resolution of Codex's findings (Phase D)
Rev R2 accepted all six original Majors; **Rev R3** resolves the one Major Codex kept open on re-review (Target status pre-empting the OD rulings). All accepted, none rebutted.
1. **Target-vs-shipping conflation → pending-vs-approved (R2 + R3)** → the taxonomy separates **`[Proposed Target]`** (recommended, pending the owner's OD ruling — NOT approved, NOT usable) from **`[Target]`** (owner-approved, *currently EMPTY* until an OD is ruled). Every token/primitive is tagged; the **Adoption-Debt Ledger** (Part 4b) holds the pending items; `var(--gilt)`/`Ring`/`ListRow` are `[Proposed Target]`/`[Candidate]`, never presented as available. Implementation may use only `[Shipping]`/Observed vocabulary (acceptance criterion clarified in scope).
2. **Foil overstated** → reclassified **Candidate/Provisional** everywhere (Parts 4/6/7); only *outcome constraints* recorded, **no canonical technique or verified fallback**. The K14 CSS/SVG/mask/raster details are demoted to *candidate outcome notes*, not law.
3. **OD-19 dropped** → **restored as the Cinzel-800 decision** (Part 3); the `--danger`/`--hair-18` corrections revert to findings K1/K2, not an OD.
4. **Proposal gate too late** → the full **§8 proposal now gates before any normative authoring** (after Checkpoint B input-freeze), not before Phase 4. (Primary fix in `design-system-scope.md`; mirrored in Part 7.)
5. **Promotion rule insufficient** → two-pillar recurrence is **necessary, not sufficient**; added shared-semantic-role / compatible-states / compatible-a11y / compatible-platform / explicit-owner criteria (Part 4). **Ring → Candidate** until that comparison is recorded.
6. **Scope-guard self-contradiction** → **`tokens.css` removed from the allowlist** (Part 5); its stale-comment fix moves to adoption-debt. All `src/**` denied.

Minors accepted: metric methods published + blended figure dropped (Part 2); jade `var()` count corrected 18→**16**; K11 re-described as doc-vs-shipping-reality (not internal self-contradiction); CardRow = visual/data input only, not canonized (OD-13a); OD-20 states the *invariant* not the wiring; check:docs **test seam** defined (Part 5).

---

## Part 1 — Corrections to the original audit (evidence ledger)

| # | Original audit claim | Wave 1 verdict | Correction |
|---|---|---|---|
| K1 | §9 Bug: `Fab.jsx:113 var(--danger)` undefined | **REFUTED** | Working code — resolves to `#e0907c` via `decks.css:32` (FAB always in `cx-decks` scope, `Fab.jsx:31/95/109`). **Finding, not an OD:** shade-drift vs `--destructive`. |
| K2 | §9 Bug: `CardArt var(--hair-18)` undefined | **QUALIFIED (benign)** | Inline fallback `rgba(220,184,111,.18)` = intent; no defect. **Finding, not an OD:** dead-token reference (adoption-debt). |
| K3 | Haptics "needs-confirmation" | **VERIFIED inert** | `native.js:haptic()` reads no setting; ~45 callers ungated; toggle (`App.jsx:999`) does nothing. Truth-in-UI bug. |
| K4 | "colour ~55% tokenised" | **REFUTED** | ~30% by occurrence; 55% counted `--f-*` font tokens against colour-only literals. Report per-axis (Part 2). |
| K5 | "Every element/rarity token dead" | **OVERSTATED** | **Rarity tokens ALIVE** (`--ordinary/…/--unique` via `var()`, 5 files). Only **element** tokens (`--air/--fire/…`) dead. |
| K6 | Jade token `#8fd3a8` the "dead loser" | **OVERSTATED** | `--accent-jade` consumed **16×** (not 18) > `#4db38a` literal 11×. Real bug: `tokens.css:280` `#4db38a` fallback contradicts the token's own value. |
| K7 | Decks/Play "redefine app token names" | **QUALIFIED** | Mostly a **parallel vocabulary** (`--text/--muted/--body/--surface/--border` have no `:root` twin). Only **three** true same-name overrides: `--bg` (both), `--gold`, `--gold-head` (Play). |
| K8 | `--violet-rgb 160,110,220` "simply wrong" | **MIS-FRAMED** | Matches the **deck amethyst structure** exactly (`decks.css:24`). **Role** mismatch → rename `--deck-amethyst`; don't "correct" the number. |
| K9 | "`backdrop-filter` banned over animation" | **OVERSTATED** | Ships at 13+ sites. Narrow rule: banned only on a **full-viewport overlay above a continuously-animating region** (`counter.css:816`). |
| K10 | "Zero-image is a release gate" | **QUALIFIED** | **Manual** documented gate (`cardArt.js:24` localStorage + `CLAUDE.md:55`). **No automated CI/test.** |
| K11 | "ARCHITECTURE.md:83 internal contradiction" | **RE-DESCRIBED** | `COMPENDIUM_ARCHITECTURE.md:83` asserts shared tokens / no invented colour; `:98-111` documents the CSS **namespaces + selector hazards** (it does **not** "bless" private palettes). The gap is **doc-asserts-X vs shipping-CSS-does-Y**, a doc-vs-reality discrepancy — not the doc contradicting itself. |
| K12 | "resolve the dangling reference" | **UNDER-SPECIFIED** | `check:docs` doesn't fail-closed today: `DESIGN_SYSTEM.md` not in `required[]`; dangling ref is a CSS comment the `.md`-only scanner never reads. Fix: **add to `required[]`** + a test seam (Part 5). |
| K13 | §10 candidate dispositions | **LOOPHOLE** | "unifies drift / aligns with ethos" is subjective → strengthened promotion rule (Part 4). |
| K14 | Foil spec (state-machine only) | **RE-SCOPED** | Foil is **Candidate/Provisional** (Major 2). Record only *outcome constraints*: offline, reduced-motion safe, zero-image safe, non-load-bearing degradation. CSS/SVG-vs-WebGL, masks, raster budget are **candidate design inputs for a future implementation proposal, NOT normative technique.** |
| K15 | Gilt gradient "×3" | **UNDERSTATED** | ≥4 named variants + ~8 inline repeats. |
| K16 | Counts conservative | Higher on occurrence basis: second gold ~99, brown trio 100, `#e3c589` 54, `#efe7d8` 43. |
| K17 | dead **rgb-base tokens** | **NEW** | `--violet-rgb/--ruby-rgb/--jade-rgb` = 0 `var()` consumers. Deprecate or wire. |
| K18 | `ARCHITECTURE.md` cites | Hygiene | File is `COMPENDIUM_ARCHITECTURE.md`. "pixel-identical stepper" comment (`ownedUi.js:1`) misattributed. |

**Solid, no correction:** scalars dead; unified-gold false; counter.css same-name collisions; Cinzel-800 faux-bold (EB Garamond ships 400/500/600 so only Cinzel-800 is faux); orphaned `CardRow`; stepper 3×/2-palette; dock-slot ×3; sub-44 offenders; platform strengths (with K9/K10 precision).

---

## Part 2 — Tokenisation metric (per-axis; blended figure withdrawn)
Per Codex-Minor, the blended "35–45%" is **withdrawn** (its "design decision" denominator wasn't rigorously defined). The per-axis conclusion is sound and reproducible:
- **Type/family:** ~95% tokenised — `rg -oI 'var\(--f-' src` = 568.
- **Colour:** **~30%** tokenised by occurrence — colour `var()` ≈637 vs literals (hex6 758 + hex3 25 + rgba 722 + rgb 7) ≈1512.
- **Scalars** (`--t/-s/-r/-i/-ls/-blur/-shadow`): **0%** — `rg 'var\(--(t|s|r|i|ls|blur|shadow)-' src -g '!**/tokens.css'` = 0.

*Method note:* counts are ripgrep **occurrences** (`-oI`), denominator = all of `src/`, excluding token *definitions* in `tokens.css` and the offscreen-canvas renderer `deckPoster.js` (which cannot read CSS vars). Fallback-treatment of compound declarations is by literal occurrence, not by declaration. The DESIGN_SYSTEM.md report must publish these commands.

---

## Part 3 — OD-1..20 rulings packet (owner rules or defers each)

**Status legend:** `[Shipping]` available now (the only usable vocabulary) · `[Exception]` ships today, sanction pending OD-12 · `[Proposed Target]` **recommended, pending this OD's owner ruling — not approved, not usable** · `[Candidate]` provisional · `[Deprecated]` retire. The **Produces** column shows each ruling's *proposed* outcome; a `[Proposed Target]` becomes `[Target]` only on owner approval (Checkpoint B). ★ = high-leverage.

| OD | Decision | Reconciled recommendation (conf.) | Produces |
|---|---|---|---|
| **★1** | Two golds | Recognize 3 gold **roles** — brand `--gold-rgb`, gilt `--gilt` (203,167,95), numeral `#e3c589`; retire the false "unified" claim. **Do NOT migrate** (=reskin). (H) | `--gilt`/numeral names **[Proposed Target]**; "unified" comment **[Deprecated]** |
| 2 | Gothic-brown chrome (~100) | Preserve as a **separate semantic family**: `--edge-brown`/`--hair-warm`/`--surface-brown`. (H) | **[Proposed Target]** |
| 3 | Muted warm ink `#8a8175` (84) | Approve a **warm-muted role**; choose migrate-to-`--ink-faint` vs new token **only after visual + high-contrast comparison** (not migration-first). (M) | role **[Proposed Target]**; impl choice deferred |
| 4 | Head/body ink near-dupes | Approve as **[Proposed Target]** *conditional on* visual + contrast verification before adoption. (M) | **[Proposed Target]** |
| 5 | Jade `#8fd3a8`/`#4db38a`/`#63c9a3` | Retain `--accent-jade` (16× consumed); **classify `#4db38a` win-semantics** (→ OD-7) before replacing it. (M) | keep token; `#4db38a` → OD-7 |
| 6 | Violet two-tone + `--violet-rgb` | Name `--violet-chrome`/`--violet-content`; **rename `--violet-rgb`→`--deck-amethyst` (structural)**, don't "correct" the number. (H) | names **[Proposed Target]**; wrong-role name **[Deprecated]** |
| 7 | Status semantics | Separate `--win`/`--loss` from accents; **do not conflate loss / danger / destructive without semantic review**. (M) | **[Proposed Target]** pending semantic review |
| 8 | Stepper colour | One **Stepper contract** + canonical `--accent-ruby` role; visual adoption deferred. (M) | **[Proposed Target]**, pairs w/ OD-13 |
| 9 | Scalar tokens | Retain the scalar **target** + define **text-style recipes**, clearly marked unimplemented. (M) | **[Proposed Target]** |
| 10 | Motion tokens | Define a small **semantic** motion vocabulary; map existing motion roles before adoption. (M) | **[Proposed Target]** |
| 11 | z-index ladder | Define a **semantic** `--z-*` ladder incl. portal/top-layer ownership. (M) | **[Proposed Target]** |
| **★12** | Decks + Play walls | **Sanction both as documented CURRENT-STATE exceptions, not permanent ideals**; migration = a separate device-verified proposal. Reconcile only the `--violet-rgb` role + document the 3 same-name overrides. (H) | **[Exception]** |
| 13 | Primitive-consolidation catalog | Assert consolidation **targets, not implementation equivalence**; dock-slot hook + one Stepper lowest-risk. (H) | **[Proposed Target]** |
| 13a | Orphaned `CardRow.jsx` | **Use as visual/data INPUT only**; the canonical `ListRow` derives from the **strongest shipped semantics (native `<button>`/`<a>`)** — do **not** canonize CardRow wholesale. (H) | `ListRow` **[Proposed Target]**; CardRow input-only |
| 14 | `.cx-ov-*` out of tokens.css | **Deferred hygiene — NO CSS relocation in Wave 2** (it's `src/**`). Record for adoption. (M) | adoption-debt |
| **★15** | Touch floor 44 vs 48dp | Retain **48dp as the [Proposed Target] floor**; record current 44/34/30px as **debt**; do NOT amend the doc down. RefineSheet numeric cluster = re-layout, not slop-pad. (M-H) | **[Proposed Target]** + debt |
| 16 | State-layer / `:active` | Document bespoke shipped feedback as **[Shipping]/Observed**; missing M3 state-layers as **[Proposed Target]/debt**. (M) | mixed |
| 17 | Focusable row wrapper | Define accessible row behavior using **native semantics** where possible. (M) | **[Proposed Target]** |
| 18 | `:focus-visible` | Define a shared `--focus-ring` requirement; implementation deferred. (M) | **[Proposed Target]** |
| **19** | **Cinzel-800 (RESTORED)** | Cinzel is requested at weight 800 but ships ≤700 → faux-bold (`counter.css:879,891` +). **Recommend clamp usage to 700** unless evidence justifies bundling an 800 font asset. (M) | decision |
| 20 | Haptics gate | **Invariant:** require **centralized gating** (one choke point); leave state injection + dependency direction to the implementation proposal. (H) | invariant |

**Not an OD (reverted to findings):** K1 Fab shade-drift, K2 `--hair-18` dead-token → adoption-debt.
**Every OD is OWNER-ONLY.** Locked decisions (breadth / adoption-deferred / sequencing / foil-wanted / guardrail) are copied verbatim, reopened only on new evidence.

---

## Part 4 — Frozen assertion input (status taxonomy)

**Status states — every asserted entry MUST declare one. CRITICAL: nothing is "approved" until the owner rules the relevant OD; recommendations are `[Proposed Target]`, never `[Target]`. Implementation/Wave 2 may use ONLY `[Shipping]`/Observed vocabulary.**

- **`[Shipping]` / Observed** — verified shipping fact; the ONLY vocabulary implementation may use directly: scalars 0-consumer; colour ~30% tokenised; second gold ~99; brown trio 100; `#e3c589`/`#efe7d8` near-dupes; stepper 3×/2-palette; gilt ≥4 variants; dock-slot ×3; sheet/rubric forks; orphaned `CardRow`; sub-44 offenders; Cinzel-800 faux-bold; haptics inert; the bespoke `:active` feedback.
- **`[Exception]`** — **ships today** (Observed fact); its **sanction as a documented exception is a recommendation pending OD-12**, not yet approved: `.cx-decks` amethyst; `.cx-life-tracker` scope; violet chrome/content two-tone; the 3 same-name overrides.
- **`[Proposed Target]`** — **recommended, pending the owner's OD ruling. NOT approved, NOT usable.** On owner *approval* it promotes to `[Target]` at the Checkpoint B freeze: `--gilt`, numeral gold, `--edge-brown/--hair-warm/--surface-brown`, warm-muted ink, `--win/--loss`, `--dur/--ease`, `--z-*`, scalar target + text-recipes, `--focus-ring`; primitives Stepper, Sheet-merge, TrophyCardScaffold, ListRow(+focusable), `useDockSlot`, gilt/danger buttons, ModalScaffold.
- **`[Target]`** — **explicitly owner-approved, NOT implemented.** *Currently EMPTY — no OD has been ruled.* Filled at the Checkpoint B freeze from the `[Proposed Target]` items the owner approves; still requires the adoption track before it is usable.
- **`[Candidate]`/Provisional** (unproven, design + implementation deferred): **foil**; **Ring** (recurs but promotion criteria unrecorded — see rule below); ghost-slot (→ Pattern); wax-seal blob / fleuron / corner brackets (→ drop/compose).
- **`[Deprecated]`** (retire): false "unified on 220,184,111" comment; `--violet-rgb` wrong-role name; dead rgb-base tokens; `#4db38a` contradicting jade fallback; 47px stale comment; inert Haptics toggle.

**State machine:** `[Proposed Target]` --(owner approves the OD)--> `[Target]` --(adoption track)--> `[Shipping]`. `[Candidate]` --(recorded promotion comparison + owner)--> `[Proposed Target]`. An owner *deferral or rejection* keeps an item `[Proposed Target]` or drops it — it **never silently becomes `[Target]`**.

**Candidate→Foundation promotion rule (governance).** Two-pillar recurrence is **necessary but NOT sufficient.** Promotion also requires all of: (a) **shared semantic role**; (b) **compatible states + interaction**; (c) **compatible accessibility contract**; (d) **compatible platform/degradation behavior**; (e) **explicit owner disposition** — recorded as a written comparison. **Ring** recurs (Home×2 + Play donut) but its states/semantics/track/inner-size **differ** (`#4db38a` vs `--accent-jade`; 44 vs 51 vs 76px inner) → stays **[Candidate]/Pattern** until the comparison is recorded. **Foil** has zero shipping instances → **[Candidate]/Provisional**, cannot be a Foundation.

### Part 4b — Adoption-Debt Ledger (`[Proposed Target]` items — recommended, PENDING owner OD ruling)
*None of these is owner-approved yet — each awaits its OD ruling, then the adoption track. Never reference as usable; only `[Shipping]`/Observed vocabulary is usable. On owner approval an item becomes `[Target]` at the Checkpoint B freeze.*

| Proposed Target (pending OD) | Replaces / closes (shipping reality) | Adoption cost |
|---|---|---|
| `--gilt`/`--gilt-rgb`, numeral gold token | ~99 raw `203,167,95`/`#cba75f` + `#e3c589` (54) | find/replace, behaviour-preserving |
| `--edge-brown`/`--hair-warm`/`--surface-brown` | ~100 raw browns | find/replace |
| warm-muted ink token/role | `#8a8175` (84) | pending visual/hc compare |
| `--win`/`--loss`, unify `--crimson` | status literals | small |
| `--dur/--ease`, `--z-*`, scalar target + text-recipes | ~125 motion literals; hardcoded z; ~506 `font:` shorthands | large (later track) |
| `--focus-ring` + `:focus-visible` | `outline:none` inputs | additive |
| Stepper / Sheet-merge / ListRow / TrophyCardScaffold / useDockSlot / gilt+danger buttons / ModalScaffold | 3×/2-palette steppers; Sheet vs BottomSheet; 6 row idioms; dock-slot ×3; scattered buttons | per-primitive refactor |
| touch-floor 48dp | 44 recipe + 34/30 offenders | additive hit-areas |
| Cinzel-800 clamp-to-700 (OD-19) | 12 `font-weight:800` on Cinzel | one-line usages |
| centralized haptic gate (OD-20) | inert toggle | one choke point |
| `.cx-ov-*` relocation (OD-14); tokens.css:1 comment | tokens.css hygiene | deferred |

---

## Part 5 — Governance / file-impact map (Wave 2 allowlist — documentation only)
**Allowed:** `DESIGN_SYSTEM.md` (new, root); `CLAUDE.md:30-36` (+source-of-truth row); `AGENTS.md:231-237` (+mirror row) & `:299` (strengthen the one UI line → "must cite DESIGN_SYSTEM.md"); `COMPENDIUM_ARCHITECTURE.md:83` (give clause-1 a referent + a "two documented exceptions" note; move design specifics to pointers — **describe as doc-vs-shipping discrepancy per K11**); `scripts/check-docs.mjs` (**add `DESIGN_SYSTEM.md` to `required[]`** → fail-closed) **plus a focused validator test** — the test seam injects a fixture root and covers **present-file → pass** and **missing/unreadable-file → fail** (the validator currently runs against the working dir with no focused tests).
**Denied — no exceptions (this is the adoption track / behaviour change):** **all `src/**`** — including `src/theme/tokens.css` (the `:1` comment fix moves to adoption-debt), any CSS token replacement, JSX consolidation, `cardArt.js`/`GothicSheet.jsx`/`back*.js`, deps, runtime/build config, visual redesign, migrations. **Any `src/**` path in the Wave-2 diff = scope-guard failure → stop and file a separate implementation proposal.**

## Part 6 — Seven-layer blueprint (each entry carries a status)
1. **Foundations** — reconciled token roles + rationale/constraint: brand `--gold-rgb` `[Shipping]` + `--gilt`/numeral `[Proposed Target]` (OD-1, retire "unified" `[Deprecated]`); warm-brown family `[Proposed Target]` (OD-2); warm-muted ink `[Proposed Target]` (OD-3); `--win/--loss` `[Proposed Target]` (OD-7); `--dur/--ease` `[Proposed Target]` (OD-10); `--z-*` `[Proposed Target]` (OD-11); scalar **target-only** + text-recipes `[Proposed Target]` (OD-9). Per-axis metric (Part 2). Deprecate dead rgb-bases.
2. **Semantic** — single-accent rule + the two `[Exception]` walls (`--deck-amethyst` structural; chrome/content two-tone; Play scope-local `--bg/--gold/--gold-head`). Status colours separated from wayfinding.
3. **Primitives** — consolidation **[Proposed Target]** catalog (OD-13, *targets not equivalence*): Stepper, Sheet-merge, TrophyCardScaffold, **ListRow (native-semantics base, CardRow = input only)** (+focusable OD-17), SectionLabel, gilt/danger buttons, ModalScaffold, useDockSlot; `CardArt` = `[Shipping]` zero-image reference primitive. **Ring = `[Candidate]`** (promotion criteria unrecorded). `CardRow` adopt-or-delete recorded.
4. **Patterns** — rows, sheets (GothicSheet WebView paint recipe as `[Shipping]` hard pattern), rubric, empty/zero-image + BlankState, add-as-place, two-tier LIFO back. **Ghost-slot = Pattern**, not Foundation.
5. **Interaction** — motion tiers `[Proposed Target]`, reduced-motion law `[Shipping]`, graded haptics `[Shipping]` + centralized-gate invariant `[Proposed Target]` (OD-20), state-layer: bespoke `[Shipping]` + M3 `[Proposed Target]` (OD-16), `:focus-visible` `[Proposed Target]` (OD-18).
6. **Platform** — §7 as hard law with K9/K10 precision: zero-image = **manual** gate; **narrow** backdrop-filter rule; `mix-blend-mode` single non-load-bearing use (engine-sensitive). **Foil = `[Candidate]`/Provisional** — record only outcome constraints (offline, reduced-motion safe, zero-image safe, non-load-bearing degradation); **no canonical technique, no verified fallback** — those await a device-verified implementation proposal.
7. **Governance** — owner assigned; **strengthened promotion rule** (Part 4, necessary+sufficient criteria); addition/disposition process; `check:docs` `required[]` + **test seam**; the acceptance test.

## Part 7 — Sequencing (with the corrected proposal gate)
Order: **OD rulings → Checkpoint B input-freeze → full §8 proposal (Codex review + owner approval) → THEN author DESIGN_SYSTEM.md + governance edits → verification → Codex diff review.** The §8 proposal (alternatives, doc-impact, rollback, verification, Self-Critique) precedes *any* normative prose (Major 4). Collection redesign follows; UI-state extraction runs parallel; adoption deferred. **Trap:** never freeze foil or any single-pillar-origin element as Foundation before device verification — they stay `[Candidate]`.

---

## Checkpoint A — status
- [x] Taxonomy distinguishes **`[Proposed Target]`** (recommended, pending owner ruling) from **`[Target]`** (owner-approved — *currently EMPTY, no OD ruled*); implementation may use only `[Shipping]`/Observed; Adoption-Debt Ledger holds the pending items (Part 4/4b).
- [x] Foil = **Candidate/Provisional**; OD-19 restored; promotion rule strengthened; allowlist denies all `src/**`; proposal gate precedes authoring; metric per-axis.
- [x] High-leverage claims verified/qualified (Part 1).
- [ ] **Codex focused re-review** clears: status taxonomy & target ledger · foil classification · corrected OD-19 · proposal sequencing · promotion criteria · exact Wave-2 allowlist. *(External — pending.)*
- [ ] **Owner rules/defers OD-1..20** (Part 3). *(External — pending.)*
- [ ] **Foil (Candidate) + walled-subsystem (OD-12) calls decided.** *(External — pending.)*

**Wave 2 remains blocked.** Silence is not approval.
