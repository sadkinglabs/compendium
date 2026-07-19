# DESIGN_SYSTEM.md — Compendium visual language

The single governed source of truth for Compendium's visual language, tokens, primitives, patterns, and platform-render rules. Grounded in what the five pillars (**Home · Codex · Collection · Decks · Play**) ship today, reconciled through a read-only audit + independent review (`docs/design-system/`). Every agent must consult this file before UI work; a reviewer may reject an invented colour or primitive by citing it.

> **Status is load-bearing.** Every entry is tagged. **Implementation may use only `[Shipping]`/Observed vocabulary.** `[Target]` = owner-approved but **not implemented** (adoption is a separate later track); `[Candidate]` = unproven; `[Exception]` = sanctioned shipping wall; `[Deprecated]` = retire. Do not reference a `[Target]`/`[Candidate]` token or component as if it exists.
>
> **Status legend:** `[Shipping]` available now (the only usable vocabulary) · `[Exception]` ships today, sanctioned · `[Target]` owner-approved, not implemented · `[Candidate]` provisional · `[Deprecated]` retire.
> **Promotion** `[Candidate] → [Proposed Target] → (owner OD ruling) → [Target] → (adoption) → [Shipping]`.
> Source of record: `src/theme/tokens.css` (values) · `docs/design-system/design-system-wave1-synthesis.md` (evidence + OD ledger, owner-ruled 2026-07-19).

---

## 1 · Foundations (tokens)

The token source is `src/theme/tokens.css` (`:root`). **Reporting reality is per-axis, not blended:** type-family ~95% tokenised · colour ~30% tokenised (by occurrence) · scalars (size/space/radius/icon/letter-spacing/blur/shadow) **0% — defined but 0 consumers.**

### 1.1 Gold family
| Token | Value | Status | Role |
|---|---|---|---|
| `--gold-rgb` | `220,184,111` (`#dcb86f`) | `[Shipping]` | the brand gold base for hairlines/edges |
| `--gold-leaf` | `#dcb86f` | `[Shipping]` | primary gold |
| `--gold` | `#cf9a4a` | `[Shipping]` | deeper gold |
| `--gold-deep` | `#c9a35a` | `[Shipping]` | |
| `--gold-head` | `#e9d49a` | `[Shipping]` | bright gold (active text/links) |
| `--gold-antique` | `#b08d4e` | `[Shipping]` | |
| `--hair-06 … --hair-40` | `rgba(var(--gold-rgb), α)` | `[Shipping]` | gold hairline scale |
| `--edge-gold` / `--edge-gold-strong` | `rgba(var(--gold-rgb), .45/.5)` | `[Shipping]` | |
| **`--gilt` / `--gilt-rgb`** | **`203,167,95` (`#cba75f`)** | **`[Target]`** (OD-1) | the **second, gilt/chassis gold** shipping ~99× (sheet borders, gilt frames, boot splash, `.cx-card-seal`). A distinct role — do **not** migrate onto `--gold-rgb`. |
| **`--gold-num`** | **`#e3c589`** | **`[Target]`** (OD-1) | the bright numeral/seal gold (~54 raw uses). |
| ~~"gold unified on 220,184,111"~~ (`tokens.css:26` comment) | — | **`[Deprecated]`** | false: `203,167,95` still ships pervasively. Retire the claim. |

### 1.2 Ink
| Token | Value | Status |
|---|---|---|
| `--ink-head` `#efe6d2` · `--ink-body` `#e9dcc0` · `--ink-body-2` `#e3d8c2` · `--ink-muted` `#9a8b6a` · `--ink-faint` `#8f8168` · `--ink-status` `#cbbfa8` | | `[Shipping]` |
| **warm-muted-ink role** (`#8a8175`, ~84 raw uses) | | **`[Target]`** (OD-3) — **role approved; implementation choice deferred** (migrate to `--ink-faint` vs mint `--ink-muted-warm`) pending a visual + `body.hc` high-contrast comparison. Because it is a literal today, `body.hc` never lifts it (a real contrast gap). |
| near-dupe inks `#efe7d8` (~43, ≈`--ink-head`), `#d8cebb` (~25, ≈`--ink-body-2`) | | `[Target]` (OD-4) — migrate to the existing tokens, conditional on visual/contrast verification. |

### 1.3 Accents (semantic / pillar) — one accent per pillar
| Token | Value | Status | Pillar |
|---|---|---|---|
| `--accent-gold` `#dcb86f` | | `[Shipping]` | Home + Codex |
| `--accent-violet` `#c79ad0` (`--link-violet` same) | | `[Shipping]` | Decks (chrome) |
| `--accent-jade` `#8fd3a8` | | `[Shipping]` | Play — **consumed 16× via `var()`; it is the canonical jade** |
| `--accent-ruby` `#d25873` (`--ruby-rgb 210,88,115`) | | `[Shipping]` | Collection |
| `--destructive` `#a8584a` | | `[Shipping]` | destructive actions |
| **Deck content two-tone** `#a08cc0` + bright `#c9a8e8` | | **`[Exception]`** (OD-12) | Decks *content* violet (distinct from the chrome `--accent-violet`; deliberate). Name `--violet-content` when tokenised. |
| **`--deck-amethyst`** (rename of `--violet-rgb 160,110,220`) | | **`[Target]`** (OD-6) | approved token/rename, **not built**. The value is **not wrong** — it matches the Decks amethyst *structure* (`decks.css` borders/bg-grad); a **role** rename, not a value fix. The Decks amethyst *subsystem* it serves is the `[Exception]` in §2. |
| jade fallback `#4db38a` written as `var(--accent-jade,#4db38a)` (`tokens.css:280`) | | **`[Deprecated]`** (OD-5) | a fallback that contradicts the token's own value; fix the 11 sites + Collection `TEAL #63c9a3` to `var(--accent-jade)`. |
| **`--win` / `--loss`** (status semantics) | win `#4db38a`, loss `#c98f8f` | **`[Target]`** (OD-7) — **role approved; win/loss-vs-danger/destructive semantics review deferred.** Status colours are a distinct axis from wayfinding accents. |
| dead rgb-base tokens (0 `var()` consumers; minted to de-dupe, adopted by nobody) | | *per-token* | `--violet-rgb` → **`[Deprecated]`** (superseded by the `--deck-amethyst` rename above); `--ruby-rgb` → **`[Target]`** (wire as the single Stepper's alpha base, OD-8); `--jade-rgb` → **`[Deprecated]`** (delete unless a consumer appears). |

### 1.4 Card-data colour (one app-wide language)
- **Rarity** `--ordinary #c8c8c8` · `--exceptional #4fc3f7` · `--elite #ab47bc` · `--unique #ffd54f` — `[Shipping]` (consumed via `RARITY_COLOR`/`RARITY_HUE` in 5 files).
- **Element** `--air/--earth/--fire/--water/--multi` and `--el-air/-earth/-fire/-water` — defined but **element tokens have 0 `var()` consumers** (resolved via JS hex maps); `--fire #e0623f` vs `--el-fire #d2645a` are two competing reds. `[Deprecated]`/reconcile.

### 1.5 Scalars — `[Target]` target-only (0 consumers today)
Radii `--r-*` (pill/tag/btn/input/tab/thumb/chip/card/modal/sheet) · spacing `--s-1…--s-8` (4-based) · type sizes `--t-*` · letter-spacing `--ls-*` · icon sizes `--i-*` · blur `--blur-*` · shadow/elevation `--shadow-chip/-card/-pop/-sheet/-modal`. **All defined in `tokens.css`, all 0-consumer.** Owner ruling (OD-9): **keep the scale as the adoption target AND add a composite text-style layer** (`--type-*` recipes) — because the code is written as whole `font:` shorthands (~506), single-value scalars have failed to get adopted. **`[Target]`; refactor deferred.**

### 1.6 New foundational tokens — all `[Target]` (OD-2/10/11/18)
- **Warm-brown chrome** (~100 raw uses; the standard input/segmented/divider/well family, a *different hue* from the gold hairlines): `--edge-brown` (`#4a3c22`), `--hair-warm` (`rgba(74,60,34,α)`), `--surface-brown` (`rgba(42,33,20,α)`).
- **Motion:** `--dur-*` / `--ease-*` — standardise on M3 `cubic-bezier(.4,0,.2,1)` + the house decelerate `cubic-bezier(.2,.9,.3,1)` + one overshoot spring. (~125 ad-hoc literals today; the "same" spring is spelled two ways.)
- **z-index:** a semantic `--z-*` ladder incl. portal/top-layer ownership (z is hardcoded 40/50/300/700… today).
- **Focus:** `--focus-ring` (no `:focus-visible` convention ships today; inputs `outline:none`).

---

## 2 · Semantic layer

- **Single accent per pillar** (the "one accent dot" rule): Home/Codex gold · Decks violet · Play jade · Collection ruby. Chrome is black + gold; the pillar accent is a functional dot, not a wash of the UI.
- **Two documented `[Exception]` walls** (owner-ruled OD-12 — *current-state exceptions, not permanent ideals; migration requires its own device-verified proposal*):
  1. **Decks `.cx-decks`** — a scoped amethyst world (`--bg #0b0714`, amethyst borders/bg-grad) plus the **deliberate violet two-tone** (chrome `--accent-violet #c79ad0` vs content `#a08cc0`/`#c9a8e8`). Documented in `decks.css` ("replicate, do not redesign").
  2. **Play `.cx-life-tracker`** (`counter.css`) — a scoped vocabulary. **Three genuine same-name overrides** collide with `:root` and mean different things inside this scope: `--bg` (`#0e0b08`), `--gold` (= `--gold-leaf`), `--gold-head` (`#e3c589`). The rest (`--text/--muted/--body/--surface/--border`) are a **parallel vocabulary** with no `:root` twin. Document these as scope-local so no reader assumes `--gold` is global.
- **Status colours** (`--win`/`--loss`/`--destructive`) are a **distinct semantic axis** from wayfinding accents and must not be conflated (OD-7).

---

## 3 · Primitives

**`[Shipping]` (usable now)** — from `src/components/`: `Chip`/`ChipRow`, `SegTabs`, `IconButton`, `SectionLabel`, `ListRow`, `Loading`, `ThresholdPips`/`ElementPip`, `BottomSheet`, `CenteredModal`, `BlankState`, `EmptyCta`, `BTN_GOLD`/`BTN_GHOST`, `GothicSheet` (the sheet chassis), `SearchPill`, `BottomDock`, `Fab` (context FAB), `RefineSheet`, `MissingSheet`, `CardArt` (**the zero-image reference primitive** — deterministic fallback painted behind a self-removing `<img>`, no layout shift), the icon set `icons.jsx`, and the Collection card views (`LedgerRow`/`BinderTile`, `Frost`, `CollectionCardSheet`).

**`[Target]` consolidation catalog** (OD-13 — *asserted targets, not implementation equivalence*; refactor deferred):
| Target primitive | Consolidates (shipping reality) |
|---|---|
| **one `Stepper`** (canonical `--accent-ruby`) | 3 implementations in 2 palettes: `Frost` + `StepBtn` (rose `224,169,177`) vs `ownedUi.stepBtn` (ruby `210,88,115`) |
| **`Sheet`** (merge `BottomSheet`→`Sheet`) | two byte-similar titled-sheet adapters |
| **`TrophyCardScaffold`** | copy-pasted meta-row/divider/CTA across `CardSheet` ↔ `CollectionCardSheet` |
| **`ListRow`** (derive from the **strongest shipped semantics — native `<button>`/`<a>`** + focusable) | 6 row idioms; **`CardRow.jsx` is orphaned (0 imports) — use as a visual/data INPUT only, do not canonize wholesale** (OD-13a). Inaccessible `<div onClick>` rows are widespread (not universal). |
| **`useDockSlot(id)`** | dock-slot `getElementById`+retry copy-pasted 3× |
| **gilt-primary + danger buttons** | ≥4 gilt-gradient variants + `FeedbackHosts` local button recipes |
| **`ModalScaffold`** | ChangelogModal + TelemetryDisclosure identical scaffold |
| **`SectionLabel`** (single rubric) | 3 rubric idioms (component + `EYEBROW` const + `.cx-ov-sec-title`) |

**`[Candidate]` (unproven — NOT Foundations):**
- **Ring** (completion ring) — recurs (Home ×2 win-rings + Play donut) but the instances **diverge** on fill (`#4db38a` vs `--accent-jade`), track, and inner size (44/51/76px). Two-pillar recurrence is **necessary but not sufficient**; promotion additionally requires a recorded comparison of semantic role, states, a11y, and platform behaviour (see §7). Stays **Candidate/Pattern** until that comparison exists.

---

## 4 · Patterns
*Each pattern is `[Shipping]` (it exists in the app today) unless tagged otherwise.*

- **Rows** `[Shipping]` — thumb + name + meta + trailing; divider hairline. *(A native-semantics focusable base is `[Target]`, OD-17.)*
- **Sheets** `[Shipping]` — one chassis (`GothicSheet`). **Hard WebView paint rule (§6):** a fixed scrim carries opacity-only animation; a `position:relative` panel carries the transform slide; any nested scroller gets its own opaque `translateZ(0)` layer. Radius/ground per chassis.
- **Section rubric** `[Shipping]` — Cinzel gold caps + `.22em` tracking + a fade hairline (`SectionLabel`).
- **Empty / zero-image** `[Shipping]` — `BlankState` (rotated gold diamond + Cinzel title) and `CardArt`'s deterministic fallback; every surface must be legible with all art absent.
- **Add-as-place** `[Target]` — adding is a property of *where you are*, not a hidden mode. This is the **Collection-redesign target interaction model, NOT current behaviour** (Collection ships an edit-mode toggle today).
- **Back** `[Shipping]` — the two-tier LIFO contract: ephemeral consumers (`back.js`) first, then the tested declarative precedence (`navBack.js`); never exits a live match on first press.
- **Ghost / empty slot** `[Shipping]` (pattern) — composed from `--surface-well` + inset shadow + dashed hairline; **not** a Foundation primitive. Empty-slot idioms already ship (AvatarPicker, counter sockets).

---

## 5 · Interaction

- **Motion** — tiers `[Target]` (`--dur/--ease`, §1.6); reduced-motion law is **`[Shipping]` and strong**: `body.reduce-motion` (class + `@media prefers-reduced-motion`) neutralises animation, with per-pillar *still-fallbacks* and a JS branch. Any new infinite/dramatic animation MUST ship a still fallback.
- **Haptics** — `[Shipping]`, graded semantics (`light`/`medium`/`heavy` by meaning) via `native.js:haptic()`. **Invariant `[Target]` (OD-20):** haptics must be **centrally gated** at one choke point — today the Settings toggle is **inert** (`haptic()` reads no setting; ~45 ungated callers). Implementation mechanism/wiring deferred to the adoption proposal.
- **State layer** — bespoke per-component `:active` (scale for cards, tint for controls) is **`[Shipping]`/Observed**; a real M3 ripple/state-layer is **`[Target]`/debt** (OD-16). `COMPENDIUM_ARCHITECTURE.md:201` already names ripple the code doesn't ship.
- **Focus** — `:focus-visible` + `--focus-ring` is `[Target]` (OD-18); accessible focusable rows are `[Target]` (OD-17).
- **Typography weight** — Cinzel is requested at weight 800 but ships ≤700 (faux-bold on the 64–80px hero numerals). **Owner ruling OD-19: clamp usage to 700** (no 800 asset) — an adoption-track code change, `[Target]`/debt.

---

## 6 · Platform behaviour (hard law)

These are **`[Shipping]` constraints** — codify, do not change.
- **Zero-image degradation** — a **manual documented gate** (`cardArt.js:24` `imagesDisabled()` via `localStorage['cx-no-images']`; `CLAUDE.md:55` UI-work exercise). *There is no automated CI/test driving it.* **Rule:** every primitive must be fully legible and correctly laid out with all images absent; functional info lives in text/vector, never the photo; art slots reserve their box (`aspect-ratio`) and paint a deterministic fallback behind a self-removing `<img>`.
- **WebView paint** — never put a transform-animation and an overflow scroller on the same element (the `GothicSheet` fix); nested scrollers get their own opaque `translateZ(0)` layer. `mix-blend-mode` is used **exactly once** (film-grain, toggleable, non-load-bearing) — treat blend-modes as engine-sensitive, **unverified until seen in the installed Chromium WebView** (`BUILD.md:178`). `backdrop-filter` is **not banned generally** (13+ sites ship it); the narrow rule (`counter.css:816`) is: **no `backdrop-filter` on a full-viewport overlay above a continuously-animating region** (per-frame full-screen re-raster).
- **Offline / no-CDN** — every font, icon, texture, and image is bundled and referenced by a relative/`BASE` URL; no primitive may fetch a network resource. Generate textures in CSS/SVG or bundle them.
- **Native vs web (Capacitor)** — use `env(safe-area-inset-*)` for edges and the CSS `--kb` keyboard token (**divided by `--ui-scale`**) for keyboard lift — never a native plugin or hand-rolled offset. Every native capability (haptics, share, status bar, blur) is progressive enhancement with a web fallback.
- **Accessibility floor** — ≥44px hit target today; **≥48dp is the `[Target]` floor** (OD-15) — `COMPENDIUM_ARCHITECTURE.md:201,203` mandate 48dp twice; current 44px recipe + the 34/30px offenders (RefineSheet operator/flip, OwnedControl stepper) are recorded as **adoption debt** (the RefineSheet numeric cluster wants a re-layout, not slop-padding). `--ui-scale` zoom; `body.hc` high-contrast (reaches only `--ink-*`/`--hair-*` — hence the warm-muted-ink gap, OD-3); reduced-motion still-fallbacks; dialogs `role=dialog` + focus-trap + back-registered.

### Foil — `[Candidate]` / Provisional
Owner-wanted, **not designed or built**. This document records only **outcome constraints**, never a canonical technique or verified fallback:
- must be **offline** (no network, no third-party textures), **reduced-motion safe** (a static sheen fallback), **zero-image safe** (base state = the element-gradient fallback; foil never requires the photo), and its degradation **non-load-bearing** (removing it leaves a legible card).
- Any concrete technique (CSS/SVG vs WebGL, blend-modes, masks, per-frame budget) is a **design input for a future device-verified implementation proposal** — verified on a low-end Capacitor Chromium WebView — not law here.

---

## 7 · Governance

- **Owner:** design language is owned here; this file is the source of truth in the source-of-truth table (`CLAUDE.md`, `AGENTS.md`).
- **Adding to the system.** New tokens/primitives enter as `[Proposed Target]` and require an owner ruling to become `[Target]`; nothing is `[Shipping]` until the adoption track lands it.
- **Candidate → Foundation promotion rule.** Two-pillar recurrence is **necessary but NOT sufficient.** Promotion additionally requires a **recorded comparison** demonstrating: (a) shared semantic role; (b) compatible states + interaction; (c) compatible accessibility contract; (d) compatible platform/degradation behaviour; (e) explicit owner disposition. (Ring recurs but fails this until the comparison is recorded.)
- **Enforcement.** `scripts/check-docs.mjs` requires this file (`required[]`) and **fails closed** if it is missing (proven by `scripts/check-docs.test.mjs`). Reviewers reject invented colour/primitives by citing this doc.
- **Acceptance test.** A reviewer can reject an invented colour/primitive by citing this file; an agent can build a screen from it **using only `[Shipping]`/Observed vocabulary** (`[Target]` needs adoption; `[Candidate]`/`[Proposed Target]` need promotion/approval first).
- **Adoption is a separate later track** — replacing literals / building the `[Target]` primitives happens under its own proposals; it is out of scope for this document.

---

*Provenance: `docs/design-system/` — audit report, scope, Codex brief, and the Wave-1 synthesis (owner OD-1..20 rulings recorded 2026-07-19; Codex-Approved). Values live in `src/theme/tokens.css`.*
