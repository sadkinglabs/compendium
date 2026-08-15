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
| **`--gilt` / `--gilt-rgb`** | **`203,167,95` (`#cba75f`)** | **`--gilt-rgb` `[Shipping]`** (minted for the sets-home tile edge); `--gilt` still `[Target]` (OD-1) | the **second, gilt/chassis gold** shipping ~99× (sheet borders, gilt frames, boot splash, `.cx-card-seal`). A distinct role — do **not** migrate onto `--gold-rgb`. |
| **`--gold-num`** | **`#e3c589`** | **`[Shipping]`** (OD-1 — minted; consumed by the sets-home tiles) | the bright numeral/seal gold (~54 raw uses); adoption across the remaining raw uses is still the separate track. |
| ~~"gold unified on 220,184,111"~~ (`tokens.css:26` comment) | — | **`[Deprecated]`** | false: `203,167,95` still ships pervasively. Retire the claim. |

### 1.2 Ink
| Token | Value | Status |
|---|---|---|
| `--ink-head` `#efe6d2` · `--ink-body` `#e9dcc0` · `--ink-body-2` `#e3d8c2` · `--ink-muted` `#9a8b6a` · `--ink-faint` `#8f8168` · `--ink-status` `#cbbfa8` | | `[Shipping]` |
| **`--ink-muted-warm`** `#8a8175` (~84 raw uses) | | **`[Shipping]`** (OD-3 resolved — **minted** rather than folded into `--ink-faint`, so the warm-muted role keeps its own hue; consumed by the sets-home tiles). Migrating the remaining raw literals onto it is the separate adoption track, and doing so is what finally lets `body.hc` lift them (today they are literals, a real contrast gap). |
| **`--ink-dim`** `#a99a80` · **`--ink-dimmest`** `#6b6254` | | `[Shipping]` — the two-step de-emphasis for empty-state tiles (name / label). |
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
| rgb-base tokens (minted to de-dupe; adoption varies - the heading no longer implies all are dead) | | *per-token* | `--violet-rgb` → **`[Deprecated]`** (superseded by the `--deck-amethyst` rename above); `--ruby-rgb` → **`[Target]`** (wire as the single Stepper's alpha base, OD-8); `--jade-rgb` → **`[Shipping]`** (2 consumers: the playset-collected jewel in `CollectionCardViews`, the list-complete pill in `Collection`). |

### 1.4 Card-data colour (one app-wide language)
- **Rarity** `--ordinary #c8c8c8` · `--exceptional #4fc3f7` · `--elite #ab47bc` · `--unique #ffd54f` — `[Shipping]` (consumed via `RARITY_COLOR`/`RARITY_HUE` in 5 files).
- **Element** `--air/--earth/--fire/--water/--multi` and `--el-air/-earth/-fire/-water` — defined but **element tokens have 0 `var()` consumers** (resolved via JS hex maps); `--fire #e0623f` vs `--el-fire #d2645a` are two competing reds. `[Deprecated]`/reconcile.

### 1.5 Scalars — `[Target]` target-only (0 consumers today)
Radii `--r-*` (pill/tag/btn/input/tab/thumb/chip/card/modal/sheet) · spacing `--s-1…--s-8` (4-based) · type sizes `--t-*` · letter-spacing `--ls-*` · icon sizes `--i-*` · blur `--blur-*` · shadow/elevation `--shadow-chip/-card/-pop/-sheet/-modal`. **All defined in `tokens.css`, all 0-consumer.** Owner ruling (OD-9): **keep the scale as the adoption target AND add a composite text-style layer** (`--type-*` recipes) — because the code is written as whole `font:` shorthands (~506), single-value scalars have failed to get adopted. **`[Target]`; refactor deferred.**

### 1.6 New foundational tokens — all `[Target]` (OD-2/10/11/18)
- **Warm-brown chrome** (~100 raw uses; the standard input/segmented/divider/well family, a *different hue* from the gold hairlines): `--edge-brown` (`#4a3c22`), `--hair-warm-50/-100` (`rgba(74,60,34,α)`), `--surface-brown-50/-70` (`rgba(42,33,20,α)`). **Defined in `tokens.css` (Collection UX Phase 0), still `[Target]`/unconsumed**; the ones Collection consumes promote to `[Shipping]` in Phase 1.
- **Completion Ring track** — `--ring-track` (`rgba(74,60,34,.9)`), the unfilled arc; **fill = contextual pillar accent (no `--ring-fill`)**. `[Shipping]` — consumed by `components/Ring.jsx`. See §3 + `docs/collection-ux/`.
- **Sets-home tile treatment** — `[Shipping]`, consumed by `pillars/SetsHome.jsx`; plain functional names (owner rule: no thematic names in code). `--ring-halo` (`rgba(var(--ruby-rgb),.16)`, first `--ruby-rgb` consumer, OD-8) · `--tile-top-rgb`/`--tile-bottom-rgb` (tile gradient) · `--shadow-tile` · `--ring-track-neutral` (neutral arc track, distinct from the warm `--ring-track`) · `--rule-warm` (stat separator) · `--ink-dim`/`--ink-dimmest` (empty-tile name + label). **These mint three previously-unbuilt approved roles:** `--gilt-rgb` and `--gold-num` (OD-1) and `--ink-muted-warm` (OD-3, resolving its deferred implementation choice by minting rather than folding into `--ink-faint`).
- **Completion fill** — `--completion-fill` (`linear-gradient(90deg, var(--accent-gold), var(--accent-ruby))`) over `--track-neutral`. `[Shipping]`. **Owner ruling (2026-07-20): NO separate completion colour** — the proposed `#d24d78` was rejected as a near-dupe of `--accent-ruby #d25873`; the pillar accent *is* the completion colour, so the §2 single-accent rule holds and no second pink exists.
- **Completion is a bar, not a ring, on the sets-home tiles** (owner, 2026-07-20): a ring overlaid on set art fought the logos at tile scale. The `Ring` primitive remains `[Shipping]` and is still the page-level/overall completion device; tiles use the bar.
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

**`[Shipping]` (usable now)** — from `src/components/`: `Chip`/`ChipRow`, `SegTabs`, `IconButton`, `SectionLabel`, `ListRow`, `Loading`, `ThresholdPips`/`ElementPip`, `BottomSheet`, `CenteredModal`, `BlankState`, `EmptyCta`, `BTN_GOLD`/`BTN_GHOST`, `GothicSheet` (the sheet chassis), `SearchPill` (**the one search chassis, two mounts** — `docked` portals into the dock at 52px; `inline` renders in place at 48px for in-sheet/in-panel search. Chassis owns presentation + input idioms only — enterKeyHint/Enter-blur, 44px clear that keeps focus; query SCHEDULING stays with the owner: cheap in-memory filters immediate, expensive work debounced at the call site. The `.ob-search-pill` clone is retired; `AvatarPicker`'s `.picker-search` keeps its sanctioned green identity), `BottomDock`, `Fab` (context FAB), `OverflowMenu` (header overflow), `RefineSheet` (deck/Codex) + `CollectionRefineSheet` (the Collection's own two-page Filters/Sort sheet, sharing `RefineSheet`'s `Chip`/`PipChip`/`CmpRow` primitives), `MissingSheet`, `CardArt` (**the zero-image reference primitive** — deterministic fallback painted behind a self-removing `<img>`, no layout shift), the icon set `icons.jsx`, and the Collection card views (`LedgerRow`/`BinderTile`, `Frost`, `CollectionCardSheet`).

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

**`[Target]` (owner-approved, being built — promoted from `[Candidate]` 2026-07-20):**
- **Ring** (completion ring) — `[Shipping]` as the primitive **`src/components/Ring.jsx`** (pure SVG stroke-dashoffset arc; static by default → reduced-motion + zero-image safe; clears the §6 WebView rules). Recurs (Home ×2 win-rings + Play donut) and now Collection set/total completion; the **recorded comparison** the §7 promotion rule requires is in [`docs/collection-ux/collection-ux-proposal.md`](docs/collection-ux/collection-ux-proposal.md) §5.1 (shared role · states · a11y · platform · owner disposition), owner-approved. **Token:** `--ring-track` (`[Shipping]`, §1.6); the arc **fill is the contextual pillar accent** passed via `color` (Collection `--accent-ruby`), so **no `--ring-fill` is minted**. Its canonical geometry ends the 44/51/76px divergence. Home/Play instances stay on their bespoke rings for now (their migration is the separate adoption track).

---

## 4 · Patterns
*Each pattern is `[Shipping]` (it exists in the app today) unless tagged otherwise.*

- **Rows** `[Shipping]` — thumb + name + meta + trailing; divider hairline. *(A native-semantics focusable base is `[Target]`, OD-17.)*
- **Sheets** `[Shipping]` — one chassis (`GothicSheet`). **Hard WebView paint rule (§6):** a fixed scrim carries opacity-only animation; a `position:relative` panel carries the transform slide; any nested scroller gets its own opaque `translateZ(0)` layer. Radius/ground per chassis.
- **Section rubric** `[Shipping]` — Cinzel gold caps + `.22em` tracking + a fade hairline (`SectionLabel`).
- **Empty / zero-image** `[Shipping]` — `BlankState` (rotated gold diamond + Cinzel title) and `CardArt`'s deterministic fallback; every surface must be legible with all art absent.
- **Add-as-place** `[Target]` — adding is a property of *where you are*, not a hidden mode. This is the **Collection-redesign target interaction model, NOT current behaviour** (Collection ships an edit-mode toggle today).
- **Back** `[Shipping]` — the two-tier LIFO contract: ephemeral consumers (`back.js`) first, then the tested declarative precedence (`navBack.js`); never exits a live match on first press.
- **Header overflow** `[Shipping]` — `OverflowMenu`: a 44px dots trigger in a header (one circle at the §5 touch floor - an inner 34px styling span cost the button its accessible name in the WebView, so the button IS the circle), opening a small anchored menu of **manage-only commands** (never adding or importing). It shares the FAB-menu chassis and a common `MenuGlyph` set so glyph sizing is consistent.
  - **Boundary against the FAB, stated as a rule.** Adding lives on the `+` **FAB menu**; managing lives on the overflow. As shipped today: the **set drill** has **no overflow** - selection is its only manage action, so it is a direct **Select** pill in the header. It enters bulk-selection mode empty and then morphs in place into **Select all / Deselect all**; the docked search becomes the action bar, which just shows the running selected count (a single card is one tap on its tile). A one-item overflow is never used - promote it to a direct control. The **list-detail overflow** carries **rename, duplicate, export, delete** (the virtual Wishlist keeps only export); **Overview currently has no manage overflow**. On the FAB side, the **Collection and set `+` menus** offer **camera and typed import**; the **list `+` menu** is add-only - **add cards and add from text** (export is a manage action, so it sits in the overflow; the missing-card workflow lives on the progress bar's "View missing"; add-from-camera is deferred until the scanner learns a list target). A second FAB carries filter/sort where a surface needs it, so a screen may hold a refine FAB, a `+` FAB and an overflow — deliberately separate components rather than one with two anchors. (History: typed import once lived in the overflow; it moved onto the `+` FAB so the camera is never buried.)
  - **The rule that makes it learnable.** Adding is always the `+` FAB; managing is always the overflow.
  - **Promotion test.** If a command is used most visits it does not belong here — give it real chrome. The overflow is for the tail, not for hiding things that matter.
  - **It renders nothing when empty** — an affordance that opens an empty menu is worse than no affordance.
  - **HARD RULE — no `transform: scale()` on the panel.** It animates with opacity + a small translate only. The WebView accessibility tree keeps reporting a scale-morphing panel's pre-transition box: a 170px menu reports itself at ~36px. Fingers are unaffected (hit-testing uses the real box) but assistive tech gets the wrong target and `check:smoke` cannot drive it. Any future anchored menu inherits this rule. See [`BUILD.md`](./BUILD.md). *(The `Fab` menu — historically the violation this rule was written around — conforms as of the nav/search cohesion pass: opacity + 8px translate, static radius, and it carries `OverflowMenu`'s keyboard/focus model, so the app's two menus share one contract.)*

- **Ghost / empty slot** `[Shipping]` (pattern) — composed from `--surface-well` + inset shadow + dashed hairline; **not** a Foundation primitive. Empty-slot idioms already ship (AvatarPicker, counter sockets).

---

## 5 · Interaction

- **Motion** — tiers `[Target]` (`--dur/--ease`, §1.6); reduced-motion law is **`[Shipping]` and strong**: `body.reduce-motion` (class + `@media prefers-reduced-motion`) neutralises animation, with per-pillar *still-fallbacks* and a JS branch. Any new infinite/dramatic animation MUST ship a still fallback.
  - **Rendering-integrity exception `[Shipping]`** (Codex-approved 2026-08-15, sole exception): the **ArtImg opacity reveal** (`cx-art-reveal`/`-warm`, 160/90ms, non-spatial) keeps its duration under reduced motion. It is not decorative — removing it re-exposes the image layer's measured first-raster tile-boundary flash (`docs/proposals/decks-swap-artifacts.md`). Implemented as higher-specificity `!important` in `tokens.css`; any future exception needs its own measured case and an owner ruling.
- **Haptics** — `[Shipping]`, graded semantics (`light`/`medium`/`heavy` by meaning) via `native.js:haptic()`. **Invariant `[Target]` (OD-20):** haptics must be **centrally gated** at one choke point — today the Settings toggle is **inert** (`haptic()` reads no setting; ~45 ungated callers). Implementation mechanism/wiring deferred to the adoption proposal.
- **State layer** — bespoke per-component `:active` (scale for cards, tint for controls) is **`[Shipping]`/Observed**; a real M3 ripple/state-layer is **`[Target]`/debt** (OD-16). `COMPENDIUM_ARCHITECTURE.md:201` already names ripple the code doesn't ship.
- **Focus** — `:focus-visible` + `--focus-ring` is `[Target]` (OD-18); accessible focusable rows are `[Target]` (OD-17).
- **Typography weight** — Cinzel is requested at weight 800 but ships ≤700 (faux-bold on the 64–80px hero numerals). **Owner ruling OD-19: clamp usage to 700** (no 800 asset) — an adoption-track code change, `[Target]`/debt.

---

## 6 · Platform behaviour (hard law)

These are **`[Shipping]` constraints** — codify, do not change.
- **Zero-image degradation** — a **manual documented gate** (`cardArt.js:24` `imagesDisabled()` via `localStorage['cx-no-images']`; `CLAUDE.md:55` UI-work exercise). *There is no automated CI/test driving it.* **Rule:** every primitive must be fully legible and correctly laid out with all images absent; functional info lives in text/vector, never the photo; art slots reserve their box (`aspect-ratio`) and paint a deterministic fallback behind a self-removing `<img>`.
- **WebView paint** — never put a transform-animation and an overflow scroller on the same element (the `GothicSheet` fix); nested scrollers get their own opaque `translateZ(0)` layer. `mix-blend-mode` ships in **two** places: the film-grain (toggleable, non-load-bearing) and the full-art viewer's foil — two viewer-local layers under `isolation: isolate` (a `color-dodge` rainbow + an `overlay` glare, foil printings only, non-load-bearing, **verified in the installed Pixel Chromium WebView**, build 162). Treat blend-modes as engine-sensitive, **unverified until seen in the installed Chromium WebView** (`BUILD.md:178`). `backdrop-filter` is **not banned generally** (13+ sites ship it); the narrow rule (`counter.css:816`) is: **no `backdrop-filter` on a full-viewport overlay above a continuously-animating region** (per-frame full-screen re-raster).
- **Offline-first, one sanctioned fetch** — every font, icon, texture, and **set-hero logo** is bundled and referenced by a relative/`BASE` URL. The **one** exception is **card art**, which streams from the Cloudflare R2 CDN through the art boundary (`useArtSource`/`ArtImage` → `artCache`) and caches on-device on first view; a miss falls to the deterministic element-gradient placeholder, so it is zero-image safe and a fresh-install-offline shows placeholders (art-CDN Phase 5). No *other* primitive may fetch a network resource, and no primitive builds an art URL by hand - it goes through the boundary (the `check:source` guard enforces both). Generate textures in CSS/SVG or bundle them.
- **Native vs web (Capacitor)** — use `env(safe-area-inset-*)` for edges and the CSS `--kb` keyboard token (**divided by `--ui-scale`**) for keyboard lift — never a native plugin or hand-rolled offset. Every native capability (haptics, share, status bar, blur) is progressive enhancement with a web fallback.
- **Accessibility floor** — ≥44px hit target today; **≥48dp is the `[Target]` floor** (OD-15) — `COMPENDIUM_ARCHITECTURE.md:201,203` mandate 48dp twice; current 44px recipe + the 34/30px offenders (RefineSheet operator/flip, OwnedControl stepper) are recorded as **adoption debt** (the RefineSheet numeric cluster wants a re-layout, not slop-padding). The nav/search cohesion pass brought the CHROME to the 44px floor via `tokens.css`'s `.cx-hit44` (invisible 44px hit expander) + `.cx-press` (the Manuscript press state — brightness lift, owner-ruled: no JS ripple): header backs/Done/bookmark, brand wordmark + profile chip, modal/sheet closes, SearchPill clear + help, Chip (expander), SegTabs (`minHeight: 44` — its container clips pseudo-expanders). `--ui-scale` zoom; `body.hc` high-contrast (reaches only `--ink-*`/`--hair-*` — hence the warm-muted-ink gap, OD-3); reduced-motion still-fallbacks; dialogs `role=dialog` + focus-trap + back-registered.

### Destructive confirmation — `[Shipping]` (whole-app replace)

The pattern for an action that destroys user data. Used by Restore backup; any future destructive
action should follow it rather than invent its own.

- **The button names the consequence, not the intention.** "Replace all data", not "Restore".
- **`BTN_DANGER`, never `BTN_GOLD`.** Gold is the affirmative everywhere in this app; an
  irreversible replacement must not wear the same clothes as "Add".
- **Show both sides.** What the file contains AND what is on the device now that will be removed,
  with counts. A consequence the user cannot see is not a consequence they consented to.
- **No typed confirmation phrase.** Clear copy, a destructive-styled button and a verified,
  reachable safety copy are the protection. A phrase to copy out mostly trains people to copy
  phrases.
- **A reachable way back.** The safety copy is surfaced afterwards, persists across restarts, and
  returning to it uses this same pattern - undoing a replacement is itself a replacement.

**Accessibility contract:**

- **Initial focus lands on the consequence text, not the destructive button.** A screen reader must
  read what will be removed before reaching the control that removes it.
- The recovery affordance is a **labelled region**, because after a replacement it is the most
  important control on the screen and has to be findable.
- **Back cancels without writing**, and is suppressed while the operation is in flight.
- The button carries `aria-busy` during the operation.

### Foil — `[Shipping]` in the full-art viewer only
**Built and device-verified in `CardArtViewer.jsx`** (Pixel 9 Pro XL, build 162): a finger-tracked holographic sheen for foil printings — a `color-dodge` rainbow that ignites on the artwork's highlights plus an `overlay` glare, both under `isolation: isolate`, driven by one `requestAnimationFrame` spring loop. It meets every outcome constraint: **offline** (CSS gradients, no network/third-party textures), **reduced-motion safe** (a static sheen, no motion), **zero-image safe** (gated on **decoded** art identity `{src, gen}`, so it never renders over the element-gradient fallback), and **non-load-bearing** (removing it leaves a legible card). Finish comes from the active Collection printing; deck viewing is non-foil.

This is a **viewer-local implementation, NOT a universal foil primitive**. Any reuse on other surfaces (grids, thumbnails) is a **separate device-verified proposal** — the constraints above remain law; the specific CSS technique here is not automatically promoted app-wide.

### A-Z alphabet rail — `[Shipping]` in Collection (repo-green; interactive behaviour device-gated)
**`AlphabetRail.jsx`** — a vertical index on the logical inline edge of both Collection grids (ALL and the set drill). The rail itself is a **plain static track** of small Cinzel letters; the readout is a **big Cinzel letter pill that floats beside the thumb** while you scrub (offset inward so the finger never covers it). **Latch model:** a drag does ZERO grid work — no scroll, no re-render — it only moves the pill; the single jump fires on **release** (device tuning found live-scrubbing ~1,500 image tiles was the source of jank, and a floating-pill preview is the standard fix). **Structure & law:** a `<nav aria-label="Alphabetical index">` of letter `<button>`s (not a listbox) — **present** letters are focusable with `aria-current`; **absent** letters are inert, non-focusable, non-jumping slots. The hit model is a **continuous position-mapped strip**, so the letter comes from pointer Y (not a per-label button) — 27 labels stay reachable without each meeting the §5 touch floor. **Constraints met:** *offline* (text/vector only), *reduced-motion safe* (no decorative motion; jumps always work), *zero-image safe* (no art), *non-load-bearing* (thumb-scroll still reaches everything; the rail only shows when the order is globally alphabetical and **fails closed** — ducks — otherwise). **Geometry** clears the live dock/FAB obstruction via one measured boundary and is zoom-corrected for `--ui-scale` (`railGeometry.js`). All decisions live in tested pure helpers (`alphabetIndex.js`, `railGeometry.js`, `alphabetRailState.js`); the component is a thin shell with strict rAF/capture/listener teardown. **Interactive fidelity on the WebView is a device gate, not a repo claim.**

### Card-scanner reveal — "The Gilt Impression" — `[Shipping]` in the native scanner only (repo-green; motion device-gated)
**`scanner/ui/ScannerScreen.kt`** (Compose, native `ScannerActivity` — NOT the WebView) — recognition as ONE staged act on a **single shared clock** (`ScannerScreen` owns a `reveal` 0→1, shared by the stamp AND the result tray so they never drift apart). The scanner is a **pure snapshot** flow: an open viewfinder with no guide frame (portrait or landscape), a **gilt seal shutter**, and the captured photograph as the subject of everything that follows — the stamp lands on the user's own still. Luxe reads from **material depth**, not motion quantity: the stamp is a **gold double rule** (2.25dp outer, 1dp inner at 6dp inset) laid around the frozen photograph, preceded by a brief wide low-alpha **halo** flare that swells and quiets. The captured photograph stays visible throughout; **nothing is ever drawn over the artwork and no remote image is involved**.
**Three states (the loop is load-bearing — a scan must be *deliberate*, must *show its working*, and must *culminate*).** Haptics: one light tick on the shutter press, one `culminate()` when an identity settles. *Superseded and NOT rendered:* the live-OCR guide frame, its breathing violet “recognising” state and that state's repeated engagement tick, the “Hold steady” / “Position a card within the frame” copy, `CameraOverlay.kt`, and the ink-shadow / sheen / corner-boss layers of the old guide-rect stamp.
- **ready** — full-bleed preview, one parchment status line (*Fill the frame with one card, portrait or landscape, then tap*), and the shutter: a 72dp gold double-rule ring with a parchment centre dot. No idle animation.
- **reading** — the frame **freezes to the captured still**, which is exactly what the device is matching. The shutter’s ring hands over to a **violet arc** sweeping the same circle; reduced motion substitutes a static arc. Nothing is ever drawn over the artwork.
- **settled** — the gilt double-rule **stamps around the frozen photograph** (contact, then the inner rule, then a brief halo) and the existing result sheet rises carrying the card name. Brightness and stroke weight only — **never scaling** — settled by ~650ms. Coloured by the **result’s type accent token** (gold card / violet deck / jade match via `accentFor()`). When the match is uncertain the reveal is WITHHELD and a text-first shortlist is offered instead: the ceremony belongs to a settled identity, never to a guess.
**Result tray** rides the same clock — it **arrives late** (≈0.52→0.875 of the reveal) so it never competes with the frame + name beats, and its heading is **compact** (the large gilt name above the frame is the payoff; the tray restates it quietly, ≤2 lines) rather than a second big title.
**Recognition is FROZEN while a result is shown** (`ScannerViewModel` ignores further OCR/QR matches until "Scan another" / a completed action) so the recognised identity can never change under a user reaching for an action.
**Haptics (build → climax):** a light engaged tick on entering recognising, then a **growing pulse ramping to a firm finish** timed so its peak coincides with the gold flare (the 1.0.2 "achievement" feel) — not a single flat tick.
**Type:** the app's shipping families (`--f-display`/`--f-read`/`--f-ui`) bundled as TTFs in `res/font` — **Cinzel** for the card name + sheet rubric/title, **Hanken Grotesk** for status/labels/controls (scanner MaterialTheme + `LocalTextStyle` default to it, so nothing is system Roboto), **EB Garamond** for reading copy.
**Name divider:** the manuscript centre-weighted fade gilt hairline (transparent→gilt→transparent). **Gilded depth is stacked opacity on ONE hue**, **never a gradient along the stroke** (the "cheap foil" look). **Close control:** the app language — a **gold X in a round button, top-right (48dp)**; the reveal text is offset below that corner. **Ownership line ("In My Collection ×N") is DEFERRED to Phase 2** — a decorative count must not display before its write is acknowledged; the ceremony shows the name only.
**Reduced-motion (`[Shipping]`, strong):** the resolved app preference (`body.reduce-motion`, folded from the user setting OR OS `prefers-reduced-motion` by `appearance.js`) is passed at `scan()`; the shared clock snaps to 1 → the settled impression, name, and tray appear in one frame — no press/breath/halo/loop. **Constraints met:** *offline* (Canvas vector only; recognition never waits on or uses the remote image), *zero-image safe* (no card art drawn), *non-load-bearing* (recognition + the action tray work with the reveal removed), *performant* (~16 draws at peak; steady states run zero animation). **Deliberately excluded:** camera→card-render crossfade, any effect over the artwork, foil gleam, perimeter trace, expanding ripple, full-frame glow bloom, sparkle/particles, spring/overshoot, frame scaling, multi-part haptics, gradients along strokes. **Motion fidelity, TalkBack, incorrect-match recovery, short-screen layout, and per-frame performance on the installed Compose surface are device gates, not repo claims.**

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
