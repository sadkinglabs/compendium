# Compendium Design System — Phase 1 Audit Report

**For:** Codex (independent review) · **From:** Claude (lead) · **Owner:** Human
**Status:** Discovery complete (read-only). Feeds the Phase-2 *Assert* pass and the formal DESIGN_SYSTEM.md proposal.
**Method:** 10 parallel read-only sweeps — 5 pillars (Home, Codex, Collection, Decks, Play) + 5 cross-cutting (tokens/drift, primitives, type/icons, motion/M3, platform constraints). Grounded in shipping code; all claims cite `file:line`.
**Confidence:** High on inventory/counts (ripgrep-verified). Two items flagged **needs-confirmation** (haptics gate, a couple of "unused token" edge cases). Nothing here changes code — it records what *is*.

---

## 1. Executive summary — five headline findings

1. **The scalar half of the token system is dead.** Every scalar token family — type sizes `--t-*`, spacing `--s-*`, radii `--r-*`, icon sizes `--i-*`, letter-spacing `--ls-*`, blur `--blur-*`, shadow `--shadow-*` (~45 tokens) — has **zero `var()` consumers** anywhere in `src/`. Every font-size, padding, gap, radius, and icon dimension is a hand-typed px literal (504 `font:` shorthands alone). The scale ships as documentation, not a constraint.

2. **Colour is only ~55% tokenised, and the app's *most-used* colours have no token at all.** Raw totals: **575 hex + 500 rgba literals vs 859 `var()` refs.** The top untokenised values by frequency: `#cba75f`/`rgba(203,167,95)` a **second gold** (~83 uses), `#8a8175` muted grey (84), `#4a3c22`+`rgba(74,60,34)`+`rgba(42,33,20)` the **gothic-brown chrome** (~96), `#e3c589` bright-gold numeral (52), `#efe7d8` near-white ink (42). Honest verdict: **~35–45% of all design decisions resolve through a token.**

3. **The token file's own "unified" claim is false.** `tokens.css:24–27` states the gold scale was unified onto `--gold-rgb 220,184,111`. It was not: `203,167,95` still ships in `GothicSheet` (every sheet's top border), the gilt card frames, the boot splash, and `.cx-card-seal`. Similarly `counter.css` **redefines app token *names* with different values** (`--gold-head: #e3c589` vs the global `#e9d49a`; `--text: #efe7d8` vs `--ink-head #efe6d2`).

4. **Core controls ship in multiple incompatible implementations.** The quantity stepper exists **3× in 2 palettes** (`Frost`, `StepBtn` = light rose `224,169,177`; `ownedUi.stepBtn` = ruby token `210,88,115`) — its own comment claims it's "pixel-identical," which is false. Card rows exist **6×**; titled sheets **2×** (`Sheet` vs `BottomSheet`); trophy card sheets **2×** (copy-pasted); the section rubric **3×**; the gilt gradient **3×**. `CardRow.jsx` is **orphaned (zero imports)** yet three divergent card rows ship.

5. **The platform-constraint layer is strong and should be *codified as law*, not changed.** Zero-image degradation is a real release gate with a working `imagesDisabled()` toggle; the Android-WebView paint rules are documented and defended in code; reduced-motion and hardware-back are mature and test-gated. These are the "future-proof" rules the system must capture — and they directly answer the foil question (§7).

---

## 2. Token-layer reality (quantified)

- **Dead scalar tokens (0 consumers):** all `--t-*` (12), `--s-*` (11), `--r-*` (10), `--i-*` (5), `--ls-*` (4), `--blur-*` (3), `--shadow-*` (5); plus unused colour tokens `--surface-tile/-glass/-well-warm`, `--sheet-grad`, `--tint-07`, `--hair-06`, `--edge-gold-strong`, `--gold-deep/-antique`, `--ink-body-2/-status`, `--ruby-rgb/--violet-rgb/--jade-rgb`, `--link-violet`, `--destructive`, `--scrim`, and **every element/rarity token** (`--air/fire/…`, `--ordinary/…`) — card-data colour is resolved via JS hex maps, not the tokens (`CardRow.jsx`, `DeckStats.jsx`). (Source: tokens/drift audit, Part A.)
- **Alive tokens:** `--gold-leaf/--gold/--gold-head`, `--hair-08…40`, `--ink-head/-body/-muted/-faint`, `--accent-*`, the four `--f-*` families. `dashboard.css` is the cleanest file (near-100% tokenised) — proof the discipline is achievable.
- **No `z-index` tokens exist** — z is hardcoded app-wide (40/50/300/700 in tokens.css alone). Gap.
- **No motion tokens exist** — 0 `--dur/--ease/--motion`; 125 transition/animation/cubic-bezier literals across 7 files. Gap.

---

## 3. Colour conflicts — the palette truth (each needs an owner ruling)

| # | Concept | What ships | The problem |
|---|---|---|---|
| C1 | **Gold — brand** | tokens `--gold-leaf #dcb86f`/`--gold #cf9a4a`/`--gold-deep #c9a35a`/`--gold-head #e9d49a` **+** untokenised `#cba75f` (rubric caps, ~37) and `#e3c589` (numerals, ~52) **+** `rgba(203,167,95)` (~46, gilt/chassis/boot) | Three de-facto golds with only some tokenised; `203,167,95` contradicts the "unified on 220,184,111" claim (`tokens.css:26`). `GothicSheet.jsx:41`, `CollectionCardViews.jsx:16-19`, `.cx-card-seal` tokens.css:329. |
| C2 | **Gothic-brown chrome** | `#4a3c22` border (~32), `rgba(74,60,34,α)` hairline (~35), `rgba(42,33,20,α)` fill (~29) | **No token exists** for any of them, yet they're the standard input/segmented/divider/surface across every pillar. The gold `--hair-*` scale is a different hue. |
| C3 | **Muted ink** | `#8a8175` (~84), `#5c554b`, `#6b6254` | No token; between `--ink-muted #9a8b6a` and `--ink-faint #8f8168`. **A11y consequence:** because these are literals, `body.hc` high-contrast (which only lifts `--ink-*`) never reaches them → contrast-mode gap in Decks/Play/counter. |
| C4 | **Head/body ink** | `#efe7d8` (~42) ≈ `--ink-head #efe6d2`; `#d8cebb` ≈ `--ink-body-2` | Near-dup literals; `counter.css` even redefines `--text:#efe7d8`. |
| C5 | **Jade / win-green** | token `--accent-jade #8fd3a8` **vs** shipped `#4db38a` (donut, bars, win borders, live-dot) **vs** Collection `TEAL #63c9a3` | Three greens for one "win/ok" concept; `#4db38a` (the real one) has no token. |
| C6 | **Violet** | chrome `--accent-violet #c79ad0` (199,154,208) **vs** deck-content `#a08cc0` + bright `#c9a8e8` **vs** token `--violet-rgb 160,110,220` | The two-tone (chrome vs content) is **deliberate** (`deckdash.css:10`). But `--violet-rgb` matches **neither** shipped hue — the token is simply wrong. |
| C7 | **Rose vs ruby (steppers)** | `--accent-ruby #d25873`/`210,88,115` (ownedUi) **vs** light rose `224,169,177`/`#f0c8ce` (StepBtn/Frost) | Same control, two palettes. The "chrome-only ruby" law is really "chrome-only rose" in practice. |
| C8 | **Status semantics** | win `#4db38a`, loss `#c98f8f`, `--crimson #e0786a` (counter), `--destructive #a8584a` | No `--win`/`--loss` tokens; `--crimson` vs `--destructive` unreconciled; loss/destructive/ruby all differ. |
| C9 | **Element reds** | `--fire #e0623f` vs `--el-fire #d2645a`; `--earth`==`--el-earth` (dup) | Two "fire" tokens with different values; earth duplicated. |

---

## 4. Primitive duplication & missing primitives (the catalog to assert)

**Consolidate (should be one):**
- **Stepper ×3 / 2 palettes** → one `Stepper` on one ruby token. (`Frost` CollectionCardViews:57; `StepBtn` CollectionCardSheet:53; `ownedUi.stepBtn`:7.)
- **Titled sheet ×2** → merge `BottomSheet` (ui.jsx:244) into `Sheet` (Sheet.jsx) — title block byte-identical.
- **Trophy card sheet ×2** → extract `TrophyCardScaffold` (CardSheet ↔ CollectionCardSheet copy-paste at :96-101 ↔ :261-266).
- **Row ×6** → `ListRow` superset + a focusable wrapper; re-point MissingSheet/CollectionPicker/ListPicker that re-inline `.cx-row`. **`CardRow.jsx` is orphaned (0 imports)** — adopt or delete.
- **Section rubric ×3** → one `SectionLabel`/token (component vs `EYEBROW` const vs `.cx-ov-sec-title` CSS).
- **Gilt gradient ×3** → `--gilt`/`--gilt-frame` tokens.
- **Dock-slot portal ×3** → `useDockSlot(id)` hook (SearchPill/DockLeft/Fab copy the getElementById+retry).
- **Button recipes scattered** → shared gilt-primary + danger button (FeedbackHosts re-declares `btnGold/btnGhost/btnDanger` locally).
- **Modal scaffold ×2** → `ModalScaffold` (ChangelogModal + TelemetryDisclosure).

**Missing (recurring, never abstracted):** `Stepper`, gilt-primary CTA, danger button, meta-row builder, checkbox/check affordance, a unified small-pill family (5 variants), `ModalScaffold`, `useDockSlot`, an **accessible row wrapper** (every row is a non-focusable `<div onClick>`), and a **warm-brown hairline token**.

---

## 5. Typography & iconography

- **Type scale unused** (see §2). The intended family roles are honoured (Cinzel=display, EB Garamond=read, Hanken=UI, IBM Plex Mono=mono) and offline/no-CDN self-hosting is **confirmed** (`fonts.css`, 30 bundled woff2, `font-display:swap`).
- **Bug — faux weights:** Cinzel is requested at **800** (`counter.css:239,879,891,…`) but only ships **≤700** → the WebView synthesises bold. EB Garamond similar ≥600. **Decision: ship the weight file or clamp to 700.**
- **~15 recurring text styles** (rubric, hero numeral, card name, mono count…) are hand-written 504×; a **text-style/composite layer** is the missing abstraction.
- **Icons: two sources of truth.** A house set exists (`icons.jsx`, Lucide-style, stroke 2) but is undercut by **~130 inline SVGs across 20 files** with **stroke drift** (1.6/1.7/2.0/2.2/2.4/2.5/3.0). Element pips are **raster PNG** (4 files, no `multi` asset though `--multi` exists) with a `▲` glyph fallback.
- **Stale comment:** `tokens.css:84` lists `47px` as a bespoke numeral that **ships nowhere**.

---

## 6. Motion, interaction & the M3 contract

- **No motion tokens** — 14 ad-hoc durations, the "same" overshoot spring spelled two ways (`.34,1.4` vs `.34,1.5`), the true M3 easing `cubic-bezier(.4,0,.2,1)` used **exactly once**. High-leverage, low-risk normalisation target (`--dur-*`/`--ease-*`).
- **Strong (codify, don't change):** reduced-motion is consistent and thorough (class + media query + per-pillar still-fallbacks + JS branch); hardware-back is a mature two-tier LIFO + tested precedence (`back.js`/`navBack.js`, `test:app`), never exits a live match on first press; haptics use graded intensities semantically.
- **M3 gaps:** **ripple/state-layers are absent**, replaced by an inconsistent per-component `:active` (scale vs tint vs nothing). Touch-target floor is **44px** where the architecture doc says **≥48dp** (`ARCHITECTURE.md:201`). **No `:focus-visible` ring** anywhere (inputs `outline:none`).
- **needs-confirmation:** the per-profile `haptics` setting is stored but `native.js:haptic()` doesn't read it — possibly **inert**.

---

## 7. Platform constraints — the rules to codify (and the FOIL verdict)

These are **strengths**; the system's job is to make them explicit law for every new primitive.

- **Zero-image = release gate.** `imagesDisabled()` (`cardArt.js:24`) suppresses all art; `CardArt.jsx` paints a deterministic element-gradient fallback *behind* a self-removing `<img>`, box reserved by `aspect-ratio` (no layout shift). **Rule:** every primitive must be fully legible and correctly laid out with all images absent; functional info lives in text/vector, never the photo.
- **WebView paint.** Never put a transform-animation + overflow-scroll on the same element (the `GothicSheet` fix, `:22-52`; the counter rule, `counter.css:40`); nested scrollers get their own opaque `translateZ(0)` layer. `mix-blend-mode` is used **exactly once** (film-grain, toggleable, non-load-bearing); `backdrop-filter` is **banned over animating regions** (`counter.css:816`).
- **Offline/no-CDN** confirmed; **Rule:** no primitive may fetch a network resource — bundle or generate (CSS/SVG/`data:`).
- **Native/web:** `env(safe-area-inset-*)` + the `--kb` keyboard token (÷ `--ui-scale`) — never a native plugin or hand-rolled offset; every native capability is progressive enhancement with a web fallback. Engine-sensitive effects (blur/mask/blend) are **unverified until seen in the installed Chromium WebView** (`BUILD.md:178`).
- **A11y floor:** 44px hit-area pseudo, `--ui-scale` zoom, `body.hc` high-contrast (only reaches `--ink-*` tokens — hence C3's gap), reduced-motion still-fallbacks, dialogs `role=dialog`+focus-trap+back-registered.

**FOIL VERDICT (owner-decided IN; here is the mandated spec):** safe **only** as — (a) base state = the zero-image element-gradient fallback (never requires the photo); (b) an **isolated `pointer-events:none` overlay** (`isolation:isolate` + `translateZ(0)`) that never shares an element with a scroller; (c) a **static** sheen under `body.reduce-motion`; (d) pointer-tilt reads `--ui-scale`-corrected coords, disabled under reduced-motion; (e) suppressed/dimmed under `body.hc` where it overlaps text; (f) gated behind a user toggle mirroring `grain-off`; (g) animated only on the focused/hero card, **not** every grid tile (per-cell blend risks the full-screen re-raster the backdrop-filter ban avoids); (h) **verified in the installed WebView, not a phone browser.**

---

## 8. Per-pillar posture & the two "walled" subsystems

- **Decks** ships a full `.cx-decks` amethyst palette that **shadows `:root`** (`decks.css:17-38`) and a **third gold base** (`203,167,95`) — a near-verbatim "replicate, do not redesign" port. The **violet two-tone is deliberate and legitimate**; the token layer is what's wrong (`--violet-rgb` matches nothing).
- **Play/counter** (`counter.css`) runs its **own scoped token vocabulary** on `.cx-life-tracker` (`--text/--gold-head/--muted/--sk/--crimson`) — internally token-driven but the **values fork the global system**. It's also the motion + a11y-gap epicentre.
- **Home** keeps its Overview CSS (`.cx-ov-*`) **inside `tokens.css`** (lines 356–405) — tokens.css is not tokens-only. Home also ships two win-rings and two deck-card treatments that diverge from each other and from Decks.
- **Collection** rows bypass the shared `CardRow`/`--list-accent` entirely (bespoke gilt `LedgerRow`/`BinderTile`).

**Decision this forces:** are Decks-amethyst and the counter-scope **sanctioned, documented exceptions** to "one design system / no screen invents colour" (`ARCHITECTURE.md:83`), or migration targets? The doc currently claims enforcement that the code does not honour.

---

## 9. Confirmed bugs (distinct from drift — Codex should verify)

1. **`Fab.jsx:113` uses `var(--danger)` — undefined** (token is `--destructive`). Danger FAB menu items render with no colour override. Silent.
2. **`CardArt.jsx` references `var(--hair-18)` — undefined** (only the inline fallback works).
3. **Cinzel weight 800 requested, ships ≤700 → faux-bold** (multiple counter.css sites).
4. **Haptics setting may be inert** — stored but not read by `native.js:haptic()`. *(needs-confirmation)*
5. **Sub-44px touch targets:** RefineSheet operator (34), SortRow flip (30), `OwnedControl` stepper (30) lack the hit-expander.
6. **Element pips have no `multi` asset** despite `--multi #d4a83a` — multi-element cards fall to `▲`.
7. **`GothicSheet` radius 30px vs `--r-sheet 26px`; three unsynced sheet grounds** (`--surface-sheet` vs `--sheet-grad` vs shipped `#100c08`).
8. **`tokens.css:84` stale comment** (47px ships nowhere).

---

## 10. Candidate-element dispositions (the reskin guardrail, now grounded)

Every element the new Collection mockup introduced, judged against shipping reality:

| Mockup element | Verdict | Grounded rationale |
|---|---|---|
| **Holographic foil** | **ADOPT + spec** | Owner-decided in; §7 gives the mandatory constraint spec. New primitive, carefully bounded. |
| **Completion ring** | **ADOPT** | Not new in spirit — Home ships **two** conic-gradient win-rings + Play a rec-donut, all bespoke/Home-only and divergent. A shared `Ring` primitive (from tokens) both delivers the Collection need **and unifies existing ring drift**. |
| **Ghost / debossed empty slot** | **ADOPT (composed)** | Aligns with the zero-image/`BlankState` ethos; built from `--surface-well` + inset shadow + dashed hairline. A legitimate "missing" state. |
| **Wax-seal (blob shape)** | **DROP → Reuse** | Decoration only. Wishlist already = the house `Star`; keep star + ruby, drop the bespoke blob. |
| **Fleuron rule (❧)** | **DROP → Reuse** | The app's section rule is `SectionLabel` (Cinzel caps + fade hairline) — itself a consolidation target (§4). Use it; don't add a second divider idiom. |
| **Corner brackets / tooled plates** | **COMPOSE** | Rebuild "plate" from the card recipe (`--surface-card` + `--hair-*` + `--shadow-card`); drop the bespoke corner brackets. |
| **Masthead gradient text, fake status bar** | **DROP** | Mockup chrome, not app. |

Net additions to the system: **foil, ring, ghost-slot** — each either owner-mandated or unifying existing drift. Guardrail holds.

---

## 11. Batched owner decisions (the Phase-1 checkpoint)

Grouped so the human can rule in batches, not one-by-one.

**Colour (§3):**
- **OD-1 Gold:** promote `#cba75f` (rubric) + `#e3c589` (numeral) to tokens *and* decide the fate of `203,167,95` — migrate to `--gold-rgb`, or bless as a distinct `--gilt` gold? (Finishes or formally abandons the "unified" claim.)
- **OD-2 Gothic-brown:** mint `--edge-brown`/`--hair-warm`/`--surface-brown` (≈96 uses), or migrate onto the gold `--hair-*`?
- **OD-3 Muted ink:** mint a warm muted token for `#8a8175` (fixes the `body.hc` gap, C3), or migrate to `--ink-faint`?
- **OD-4 Head/body ink:** reconcile `#efe7d8`→`--ink-head`, `#d8cebb`→`--ink-body-2` (bump token value or migrate literals)?
- **OD-5 Jade:** canonical win-green = `#8fd3a8` (token) or `#4db38a` (shipped)? Retire the loser + Collection `TEAL`.
- **OD-6 Violet:** sanction the chrome/content two-tone as two named roles **and** fix `--violet-rgb` (matches nothing).
- **OD-7 Status:** mint `--win`/`--loss`; reconcile `--crimson` vs `--destructive`.
- **OD-8 Ruby vs rose:** one canonical stepper colour → one `Stepper`.

**Scalars & motion (§2, §6):**
- **OD-9 Scalar adoption:** adopt `--t/-s/-r/-i/-ls` app-wide (this is the *separate later track* already agreed), delete them, or add a composite text-style layer? Decide the *target*, defer the *refactor*.
- **OD-10 Motion tokens:** mint `--dur-*`/`--ease-*` (standardise on M3 `.4,0,.2,1` + house decelerate `.2,.9,.3,1` + one spring)?
- **OD-11 z-index tokens:** mint a `--z-*` ladder?

**Structure & primitives (§4, §8):**
- **OD-12 Decks amethyst + counter-scope:** sanctioned documented exceptions, or migration targets?
- **OD-13 Primitive consolidations:** approve the mergers in §4 as the asserted catalog (Stepper, Sheet, TrophyCardScaffold, ListRow, rubric, dock-slot, gilt/danger buttons, ModalScaffold)?
- **OD-14 tokens.css hygiene:** move Overview `.cx-ov-*` CSS out so tokens.css is tokens-only?

**A11y & behaviour (§6):**
- **OD-15 Touch floor:** align the recipe to 48dp, or amend the doc to 44 (WCAG 2.5.5 = 44, M3/Android = 48)?
- **OD-16 State-layer:** bless & standardise the bespoke `:active`, or build a real ripple/state-layer?
- **OD-17 Row keyboard access:** introduce a focusable row wrapper (fixes an app-wide `<div onClick>` gap) or accept touch-only?
- **OD-18 `:focus-visible`:** add a focus-ring convention/token, or out of scope?

**Bugs (§9)** are fixes, not decisions — except **OD-19 Cinzel 800** (ship weight vs clamp) and **OD-20 haptics gate** (confirm inert; decide where the gate lives).

---

## 12. Proposed DESIGN_SYSTEM.md shape & next steps

The evidence supports the seven-layer structure from the scope doc, now with concrete content:
1. **Foundations** — the reconciled token set (with the new colour tokens from OD-1..8, motion/z from OD-10/11), each with rationale + constraint.
2. **Semantic layer** — token→role; the single-accent rule **plus the documented Decks two-tone exception** (OD-6/12); status colours separate from accents.
3. **Primitive catalog** — the consolidated set (OD-13), each with anatomy/states/tokens/a11y.
4. **Patterns** — rows, sheets, rubric, empty/zero-image, add-as-place, back contract.
5. **Interaction** — motion tiers, reduced-motion law, haptics semantics, the state-layer decision (OD-16).
6. **Platform constraints** — §7 as hard rules (incl. the foil spec).
7. **Governance** — owner, the addition/disposition process, `check:docs` extensions.

**Next:** (a) Codex reviews *this report* (findings + dispositions + framing); (b) human rules the OD batch; (c) Phase 2 *Assert* writes DESIGN_SYSTEM.md against those rulings; (d) it returns as a formal §8 proposal for Codex approval; (e) **adoption** (replacing literals) is the separate later, behavior-preserving track.

## 13. Guardrails reaffirmed (non-goals)
Not a reskin — this documents shipping reality + 3 bounded additions (foil/ring/ghost-slot). Not a visual redesign — no pillar's look changes as an output. Not code adoption — that's the separate later track. Behaviour-preserving throughout.

---

### Appendix — audit coverage
Home · Codex · Collection · Decks · Play (per-pillar); Tokens+Drift · Primitives · Type+Icons · Motion/M3 · Platform (cross-cutting). 10/10 complete, ripgrep-grounded, ~1.0M subagent tokens. Full per-audit reports retained in the session transcript.
