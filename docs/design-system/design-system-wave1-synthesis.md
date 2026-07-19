# Design System — Wave 1 Synthesis (Master Evidence & Decision Ledger)

**Lead/coordinator synthesis of 3 independent read-only reviewers** (Foundations, Patterns & Interaction, Architecture Adversary). This is the frozen input to **Checkpoint A**. It **supersedes the original audit report** wherever they disagree — Wave 1's job was to catch overstatements before they became normative law, and it caught several material ones.

**Checkpoint A is NOT cleared.** Wave 2 (authoring) cannot begin until: (1) Codex returns a disposition with no unresolved Blocker/Major; (2) the owner rules or defers OD-1..20; (3) foil + both walled-subsystem calls are decided. *Silence is not approval — this applies to me too.*

---

## Part 1 — Corrections to the original audit (the point of this wave)

| # | Original audit claim | Wave 1 verdict | Correction to carry into Assert |
|---|---|---|---|
| K1 | §9 Bug: `Fab.jsx:113 var(--danger)` undefined → silent no-op | **REFUTED** | Working code. Resolves to `#e0907c` via `decks.css:32` (FAB always carries `cx-decks` scope, `Fab.jsx:31/95/109`). Reclassify as **shade-drift vs `--destructive`**, not a bug. |
| K2 | §9 Bug: `CardArt var(--hair-18)` undefined | **QUALIFIED (benign)** | Has inline fallback `rgba(220,184,111,.18)` = intent. No visible defect. Dead-token reference, not a rendering bug. |
| K3 | Haptics setting "needs-confirmation" | **VERIFIED inert** | `native.js:haptic()` reads no setting; ~45 callers ungated; toggle (`App.jsx:999`) does nothing. Truth-in-UI bug. |
| K4 | Headline: "colour ~55% tokenised" | **REFUTED** | By *occurrence*, colour is **~30%** tokenised; the 55% counted `--f-*` font tokens (46% of all `var()`) against colour-only literals. **Report per-axis: type ~95% / colour ~30% / scalar 0%.** |
| K5 | "Every element/rarity token has 0 consumers" | **OVERSTATED** | **Rarity tokens are ALIVE** (`--ordinary/…/--unique` via `var()` in 5 files through `RARITY_COLOR`). Only **element** tokens (`--air/--fire/…`) are dead. |
| K6 | Jade: token `#8fd3a8` vs "the real one" `#4db38a` | **OVERSTATED** | `--accent-jade` consumed **18×** > `#4db38a` literal 11×. Real bug: `tokens.css:280` writes `#4db38a` as a **fallback contradicting the token's own value**. |
| K7 | Decks/Play "redefine app token names" | **QUALIFIED** | Mostly a **parallel vocabulary** (`--text/--muted/--body/--surface/--border` have no `:root` twin). Only **three** true same-name divergent overrides: `--bg` (both), `--gold`, `--gold-head` (Play). Changes migration framing (rename-and-rewire, not value reconciliation). |
| K8 | `--violet-rgb 160,110,220` "matches no shipped hue / simply wrong" | **MIS-FRAMED** | Matches the **deck amethyst structure exactly** (`decks.css:24 --border rgba(160,110,220,.18)`, `bg-grad #2a1c44`). **Role** mismatch (structural vs accent), not a wrong value. Rename `--deck-amethyst`; do not "correct" the number. |
| K9 | "`backdrop-filter` banned over animating regions" | **OVERSTATED** | Ships at **13+ sites**. Real rule is narrow: banned only on a **full-viewport overlay above a continuously-animating region** (`counter.css:816`). |
| K10 | "Zero-image is a release gate" (implying automated) | **QUALIFIED** | **Manual documented gate** (`cardArt.js:24` localStorage toggle + `CLAUDE.md:55` UI-work exercise). **No automated CI/test** drives `cx-no-images`. Codify honestly as manual. |
| K11 | "ARCHITECTURE.md:83 doc-vs-code gap" | **DEEPER** | `:83` ("no screen invents colour") **contradicts its own §3.1:98-100**, which *blesses* `.cx-decks`/`.cx-life-tracker`. Internal doc contradiction. Also `:201` mandates ripple/state-layers + 48dp the code doesn't ship (→ OD-16, OD-15 are already violations, not fresh proposals). |
| K12 | Scope: "resolve the dangling `DESIGN_SYSTEM.md` reference" | **UNDER-SPECIFIED** | `check:docs` does **not** fail-closed today: `DESIGN_SYSTEM.md` isn't in `required[]`, and the dangling ref is a **CSS comment** the `.md`-only scanner never reads. Mechanical fix: **add to `required[]`**. |
| K13 | §10 candidate dispositions (ring/ghost-slot ADOPT) | **LOOPHOLE** | Promotion predicate "unifies drift / aligns with ethos" is subjective. **Ring passes** (Home×2 + Play donut recur). **Ghost-slot fails** cross-pillar recurrence — it's philosophy-justified, mockup-origin → keep it a **Pattern**, not a frozen Foundation. Require **≥2 shipping pillars** to promote a Candidate. |
| K14 | Foil spec (state-machine only) | **INSUFFICIENT (technique-blind)** | Add: **mandate pure CSS/SVG, forbid WebGL/`<canvas>`** (kills `webglcontextlost` by construction, preserves offline/battery); mask paths need **dual-syntax** (`-webkit-mask-composite` + `mask-composite`, per `decks.css:47-50`) + no-mask fallback; **per-frame re-raster budget** (animate `transform`/`opacity`/`background-position` on a pre-baked layer, not a live `mix-blend-mode` recompute); device-verify on **low-end Capacitor Chromium**. Mark foil **PROVISIONAL until device-verified**. |
| K15 | Gilt gradient "×3" | **UNDERSTATED** | **≥4 named variants + ~8 inline repeats.** Consolidation case is stronger. |
| K16 | Counts (~83 gold, ~96 brown, etc.) | Conservative | Occurrence basis higher: second gold **~99**, brown trio **100**, `#e3c589` **54**, `#efe7d8` **43**. Directionally identical. |
| K17 | (missing) dead **rgb-base tokens** | **NEW** | `--violet-rgb`, `--ruby-rgb`, `--jade-rgb` all **0 `var()` consumers** — minted to de-dupe, adopted by nobody. Distinct hygiene item (delete or wire). |
| K18 | Citations `ARCHITECTURE.md:NNN` | Hygiene | The file is **`COMPENDIUM_ARCHITECTURE.md`**; no `ARCHITECTURE.md` exists. Correct all cites. Also the "pixel-identical stepper" comment (`ownedUi.js:1`) is misattributed (line content accurate, claim wrong). |

**Solid, no correction:** scalars dead (F-1/§2), unified-gold false (F-2), counter.css same-name collisions (F-5), Cinzel-800 faux-bold (F-7 — note EB Garamond ships 400/500/600 so only Cinzel-800 is faux), orphaned `CardRow` (P-1), stepper 3×/2-palette (P-2), dock-slot ×3 (P-3), sub-44 offenders (P-5), the platform *strengths* (with K9/K10 precision).

---

## Part 2 — Corrected headline metric
**~35–45% of design decisions are token-driven — but the blended number hides the truth. Report per axis:**
- **Type/family:** ~95% tokenised (`--f-*` consumed 568×).
- **Colour:** **~30%** tokenised by occurrence (≈637 `var()` vs ≈1512 literals).
- **Scalars** (size/space/radius/icon/ls/blur/shadow): **0%** — ~50 tokens, zero consumers.

---

## Part 3 — OD-1..20 rulings packet (owner rules or defers each)

High-leverage (two independent recommendations) marked ★. Full per-OD cards are in the three reviewer packets; consolidated recommendation below.

| OD | Decision | Reconciled recommendation (confidence) | Convergence |
|---|---|---|---|
| **★1** | Two golds — `#cba75f`/`203,167,95` vs `--gold-rgb` | **Mint `--gilt`/`--gilt-rgb`=203,167,95 + promote `#cba75f`/`#e3c589`; retire the false "unified" claim. Do NOT migrate (=reskin/adoption).** (H) | All 3 reviewers converge |
| 2 | Gothic-brown chrome (~100) | Mint `--edge-brown`/`--hair-warm`/`--surface-brown` (behaviour-preserving) (H) | Foundations |
| 3 | Muted warm ink `#8a8175` (84) | Migrate to `--ink-faint` if no regression (fixes `body.hc` gap), else mint `--ink-muted-warm` (M) | Foundations |
| 4 | Head/body ink near-dupes | Migrate `#efe7d8`→`--ink-head`, `#d8cebb`→`--ink-body-2` (M-H) | Foundations |
| 5 | Jade — `#8fd3a8` vs `#4db38a` vs `#63c9a3` | Keep `--accent-jade #8fd3a8` (already 18× consumed); fix the 11 `#4db38a` fallbacks + TEAL to `var()` (M) | Foundations |
| 6 | Violet two-tone + `--violet-rgb` | Name `--violet-chrome`/`--violet-content`; **rename `--violet-rgb`→`--deck-amethyst` (structural role), don't "correct" the number** (H) | Foundations + Architecture (K8) |
| 7 | Status semantics | Mint `--win`/`--loss`; unify `--crimson`→`--destructive`/`--danger` (M-H) | Foundations |
| 8 | Stepper colour — ruby vs rose | Standardise on `--accent-ruby`; wire dead `--ruby-rgb` as its alpha base (M) — pairs with OD-13 | Foundations + Patterns |
| 9 | Scalar tokens | **Target** = keep scale + add a composite **text-style layer** (`--type-*` recipes); refactor deferred (M) | Foundations |
| 10 | Motion tokens | Mint `--dur-*`/`--ease-*` (M3 `.4,0,.2,1` + house `.2,.9,.3,1` + one spring) (M) | Foundations (Interaction detail) |
| 11 | z-index ladder | Mint `--z-*` (4-6 rungs) (M) | Foundations |
| **13** | Primitive-consolidation catalog | Approve as **asserted target**, refactor deferred; dock-slot hook + one Stepper lowest-risk (H) | Patterns |
| 13a | Orphaned `CardRow.jsx` | Adopt as `ListRow` seed (if OD-13) else delete; don't keep a 0-consumer "canonical" (H) | Patterns |
| 14 | Move `.cx-ov-*` CSS out of tokens.css | Relocate so tokens.css is declarations-only (M, hygienic) | Patterns |
| **★15** | Touch floor 44 vs 48dp | **Assert 48dp as TARGET; record 44 + named offenders as adoption-track debt; do NOT amend the doc down. Fixing hit-areas is adoption (deferred).** RefineSheet numeric cluster needs re-layout, not slop-pad. (M-H) | Patterns + Architecture |
| 16 | State-layer / `:active` | Document the bespoke set (scale-for-cards / tint-for-controls). Note `ARCHITECTURE:201` already mandates ripple the code lacks (M) | Patterns + Architecture |
| 17 | Focusable row wrapper | Build into `ListRow` (couples OD-13); or accept touch-only (M) | Patterns |
| 18 | `:focus-visible` token | Mint `--focus-ring` + shared rule (M) | Patterns |
| 19 | §9 dead-token "bugs" | **Reclassified (K1/K2):** Fab = shade-drift → point to `--destructive`; `--hair-18` = define or inline. Neither urgent. (M) | Patterns |
| 20 | Haptics inert gate | Gate once inside `native.js:haptic()` (single choke point) (H) | Patterns |
| **★12** | Decks + Play walled subsystems | **SANCTION both as documented Semantic-layer exceptions; reconcile only the `--violet-rgb` role + document the 3 same-name overrides (`--bg`/`--gold`/`--gold-head`). Option B (migrate) = reskin, out of scope.** (H) | Architecture (lead) |

**Note:** every OD stays **OWNER-ONLY** — agents recommend; the owner rules. Locked decisions (breadth / adoption-deferred / sequencing / foil-in / guardrail) are copied verbatim and reopened only on new evidence.

---

## Part 4 — Frozen assertion input (the Checkpoint-A taxonomy)

- **Observed (verified shipping fact → normative or drift-ledger):** scalar tokens 0-consumer; colour ~30% tokenised; `203,167,95`/`#cba75f` second gold (~99); brown trio (100); `#e3c589`/`#efe7d8` near-dupes; stepper 3×/2-palette; gilt ≥4 variants; dock-slot ×3; sheet/rubric forks; orphaned `CardRow`; sub-44 offenders; Cinzel-800 faux-bold; haptics inert.
- **Exception (sanctioned wall, pending OD-12):** `.cx-decks` amethyst world; `.cx-life-tracker` counter scope; the violet chrome/content two-tone; the 3 same-name overrides.
- **Candidate (mockup-origin, NOT promoted — Pattern/Compose/Drop):** ghost-slot (→ Pattern, fails ≥2-pillar test); wax-seal blob (→ drop, reuse Star); fleuron ❧ (→ drop, use SectionLabel); corner brackets (→ drop/compose).
- **Owner-approved (mandated):** **foil — PROVISIONAL until device-verified**, with the K14 technique constraints.
- **Deprecated (retire):** the false "unified on 220,184,111" comment; `--violet-rgb` wrong-role name; dead rgb-base tokens; the `#4db38a` contradicting jade fallback; the 47px stale comment (`tokens.css:84`); the inert Haptics toggle (fix or remove).
- **Promotion rule (governance):** a Candidate→Foundation promotion **must cite ≥2 shipping pillars using it today** (closes the reskin loophole). Ring passes; ghost-slot does not.

---

## Part 5 — Governance / file-impact map (Wave 2 allowlist — NO pixels)
**Allowed:** `DESIGN_SYSTEM.md` (new, root); `CLAUDE.md:30-36` (+source-of-truth row); `AGENTS.md:231-237` (+mirror row) & `:299` (strengthen the one UI line → "must cite DESIGN_SYSTEM.md"); `COMPENDIUM_ARCHITECTURE.md:83` (give clause-1 a referent + a "two documented exceptions" clause reconciling with §3.1; move design specifics out to pointers); `scripts/check-docs.mjs:6-13` (**add `DESIGN_SYSTEM.md` to `required[]`** → fail-closed); a focused check-docs validator test (confirm one exists first); optional `tokens.css:1` (make the reference real — honesty, not enforcement).
**Denied (scope guard — this is the adoption track / behaviour change):** all `src/**` value/component edits, CSS token replacement, JSX consolidation builds, `cardArt.js`/`GothicSheet.jsx`/`back*.js`, deps, runtime/build config, visual redesign, migrations. **Any denied path in the diff = scope-guard failure → stop and file a separate implementation proposal.**

## Part 6 — Seven-layer blueprint (what each layer asserts)
1. **Foundations** — reconciled tokens + rationale/constraint each: `--gold-rgb` **+ sanctioned `--gilt` + numeral gold** (OD-1); warm-brown trio (OD-2); warm-muted ink (OD-3); `--win`/`--loss` (OD-7); `--dur/--ease` (OD-10); `--z-*` (OD-11); scalar **target-only** + text-style layer (OD-9). Per-axis tokenisation metric. Deprecate the false "unified" claim + dead rgb-bases.
2. **Semantic** — single-accent rule **+ the two documented exceptions** (Decks amethyst `--deck-amethyst`, chrome/content two-tone; Play scope-local `--bg/--gold/--gold-head`). Status colours separated from wayfinding.
3. **Primitives** — consolidated catalog (OD-13): one Stepper, Sheet-merge, TrophyCardScaffold, ListRow (+focusable wrapper OD-17), SectionLabel, **Ring (Foundation — passes ≥2-pillar test)**, gilt-primary/danger buttons, ModalScaffold, useDockSlot; `CardArt` = zero-image reference primitive; `CardRow` adopt-or-delete recorded.
4. **Patterns** — rows, sheets (GothicSheet WebView paint recipe as hard pattern), rubric, empty/zero-image + BlankState, add-as-place, two-tier LIFO back. **Ghost-slot lives here (Pattern), not Foundations.**
5. **Interaction** — motion tiers, reduced-motion law, graded haptics (+ OD-20 gate), state-layer decision (OD-16), `:focus-visible` (OD-18).
6. **Platform** — §7 as hard law **with K9/K10/K14 corrections**: zero-image = manual gate; **narrow** backdrop-filter rule; `mix-blend-mode` single non-load-bearing use (engine-sensitive, unverified until installed WebView); **no-network/no-WebGL** substrate rule; foil spec with pure-CSS/SVG mandate + mask dual-syntax + no-mask fallback + re-raster budget. **Foil = PROVISIONAL.**
7. **Governance** — owner assigned; **≥2-pillar promotion rule**; addition/disposition process; `check:docs` extension (`required[]`); acceptance test.

## Part 7 — Sequencing (confirmed, one trap)
"System first → Collection after → extraction parallel → adoption deferred" is sound. **Trap:** do not **freeze foil or any single-pillar-origin primitive as Foundation before device verification and the redesign** — mark them **Provisional/Candidate** so the redesign validates them without re-opening the doc.

---

## Checkpoint A — status
- [x] Frozen assertion input distinguishes Observed / Candidate / Exception / Deprecated / Owner-approved (Part 4).
- [x] Every high-leverage factual claim verified or explicitly qualified (Part 1).
- [ ] **Codex disposition** — no unresolved Blocker/Major. *(External — pending.)*
- [ ] **Owner rules or defers OD-1..20** (Part 3). *(External — pending.)*
- [ ] **Foil + both walled-subsystem calls decided** (OD-12, foil PROVISIONAL). *(External — pending.)*

**Wave 2 remains blocked.** Silence is not approval.
