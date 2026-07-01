# Compendium — Migration & Build Handoff

> One app to replace three. This document is the source of truth for merging **Lexicum** (rules + cards codex), **Arcanum** (deck builder), and **Vitarum** (life counter / match play) into **Compendium**, without losing a single feature. It carries the *what*, the *how*, and the *why* so the build stays faithful to the mockup in `Compendium.dc.html`.

---

## 0. How to start the new chat (kickoff prompt)

Paste this into a fresh conversation that has access to all three source projects + this redesign project:

> **You are building Compendium, a single offline-first mobile app (Capacitor) that unifies three existing apps: Lexicum, Arcanum, and Vitarum. The finished UI shell already exists as a high-fidelity mockup — `Compendium.dc.html` in the redesign project — and its design language is documented in `COMPENDIUM_MIGRATION_HANDOFF.md` and `DESIGN_SYSTEM.md`. Your job is a feature-complete migration: every capability in the three source apps must survive, re-homed under the new four-pillar IA (Home · Codex · Decks · Play).**
>
> **Step 1 — Inventory before you build.** Open all three source projects. Produce a single feature matrix: every screen, every user action, every persisted data shape, every setting. Map each row to its new home in Compendium (pillar + screen). Flag anything in the mockup that is *not yet* backed by a source feature, and anything in a source app that the mockup does *not yet* surface. Do not write code until I approve this matrix.**
>
> **Step 2 — Data & user model first.** Implement the unified on-device store and the multi-profile layer described in §4 before any UI. All three apps currently persist independently; under Compendium they share one device but must keep per-profile separation. Get this wrong and we corrupt people's collections — treat it as the highest-risk part.**
>
> **Step 3 — Build pillar by pillar**, matching the mockup's components and the design system. Ship Codex first (read-only, lowest risk), then Decks, then Play, with Home/Dashboard last since it aggregates the others.**
>
> **Constraints, non-negotiable:** offline-first, no network required; the app must fully function with zero image assets present (graceful fallbacks everywhere — see §5); Material Design 3 interaction patterns; prefer Capacitor native plugins over web shims; everything expandable (new card sets, new game systems) without schema rewrites. Keep the visual identity exactly as the mockup.**

---

## 1. Identity — what Compendium *is*

**One sentence:** Compendium is the offline grimoire, workshop, and duelling table for a trading-card mage — reference, build, and play in one continuous surface.

**The three former apps become four pillars:**

| Pillar | Was | Owns |
|---|---|---|
| **Home** | (new) | Cross-app workspace: resume, a customisable **Dashboard** (ported from Lexicum), saved items, recent activity. |
| **Codex** | **Lexicum** | The rules glossary + card reference. List and Card views, term/card detail, marginalia (personal notes). |
| **Decks** | **Arcanum** | Deck library, deck detail (Cards / Stats), the card-add/edit flow with filters & sort. |
| **Play** | **Vitarum** | Start a match, the life counter, the per-match Match Log, season history (Recent Duels). |

**Why this shape:** users complained the three apps "feel separate." The root cause was three *color worlds* (Lexicum gold-brown, Arcanum violet, Vitarum jade). The unification move is **one world**: the whole app adopts the Lexicum grimoire palette (`DESIGN_SYSTEM.md`), and origin is reduced to a single wayfinding accent dot per pillar (gold / gold / violet / jade). Same chrome, same type, same chip language everywhere — content is what differs, not the skin.

**Visual identity (locked):**
- **Palette:** jade-black grimoire ground (`#120d09`→`#241a12` radial), gold leaf `#dcb86f` / `#cf9a4a` as brand + chrome, parchment `#e9dcc0` text. Accent dots only: gold `#dcb86f`, violet `#c79ad0`, jade `#8fd3a8`.
- **Type:** Cinzel (display / wordmark / section eyebrows), Hanken Grotesk (UI labels, chips), EB Garamond (reading copy, card/term names), IBM Plex Mono (counts, numerals, timestamps).
- **One chip language everywhere:** filled-gold active pill (`#dcb86f` bg, `#1a1410` text), ghost inactive pill (`rgba(201,163,90,.07)` bg, `#cbbfa8` text, `rgba(201,163,90,.2)` border). Used by Codex scopes, Home sub-nav, deck Cards/Stats, filter sheets. **Do not introduce a second toggle style.**
- **Chrome:** status bar → brand bar (wordmark + diamond mark + profile chip) → context header → scroll body → adaptive search+FAB row → 4-pillar bottom nav.

---

## 2. Functionality focus — the feature matrix (must-not-lose)

Build the real inventory in Step 1, but here is the spine the mockup already encodes. **Nothing below may be dropped in migration.**

**Codex (from Lexicum)**
- Glossary of rules/keywords + card entries, alphabetised with letter dividers.
- Chip scopes: **Rules · Cards · All**.
- **List view ⇄ Card view** toggle (Card view = grid of full cards).
- Term/card **detail**: drop-cap reading layout, related-term chips, save/star.
- **Marginalia**: personal notes attached to a term/card; note indicator dot in lists.

**Decks (from Arcanum)**
- Deck library (art, archetype, element threshold pips, win record).
- Deck **detail** with **Cards / Stats** tabs at the top (above the deck name) + **Edit Deck**.
- Stats: spellbook/atlas counts, record, **mana curve**.
- **Edit / Add Cards** flow, *scoped to the open deck*, with a pinned "editing which deck" header and live count.
- Add flow has **List ⇄ Card** view (Card view = full cards, 2-up, art only, qty chip bottom-right) and a **Filters & Sort** sheet (sort by name/mana; filter by element, type).
- Per-card quantity steppers (+/−), threshold pips.

**Play (from Vitarum)**
- Start: **New Match** + **Quick Match**.
- The **life counter** itself (two-player, gilt numerals, low-life ember state, roll-for-start medallion, accent metal tweak, max-life / die settings) — see `Vitarum - Life Counter.dc.html`.
- **Match Log** (per-game record of life given/taken) — lives *inside an in-progress match*, not on the Play hub.
- **Recent Duels** season history on the Play hub.

**Home (new, aggregates all)**
- Resume / jump-back-in.
- **Dashboard** sub-page (from Lexicum): customisable widgets (Saved, Recent Duels, Random Card, Notes, Your Decks) with edit mode — resize ½/full, remove, add, reorder.
- Overview: live match, decks rail, notes.

**Cross-cutting (from all three)**
- Profiles / user switching (see §4).
- Export / import of a profile's data.
- Universal search across rules, cards, decks, duels.
- The adaptive FAB (changes action per pillar) and "search only when there's something to search."

---

## 3. Maturity step-up — what gets better in the merge

This is not a port; it's a consolidation with a higher bar.

1. **One design system, enforced.** Replace three ad-hoc palettes with `DESIGN_SYSTEM.md` tokens. No screen invents color.
2. **One component vocabulary.** Chips, list rows, detail headers, sheets, the FAB — defined once, reused. The mockup already proves Codex / Decks / Home share a chip row; the build should make that a literal shared component, not three copies.
3. **One data layer.** Three separate stores become one schema with a profile partition (§4). Search, Dashboard, and Home only become possible *because* the data is unified.
4. **Graceful everywhere.** The three apps assumed their art existed. Compendium must render fully with **zero images** (§5).
5. **Expandable by data, not code.** New card sets / elements / even a second game system should be additive data, not a refactor (§6).

---

## 4. User management — the highest-risk piece (READ FIRST)

All data is **on-device**. Each source app today owns its own storage and (implicitly) its own single user. Under Compendium, **all three datasets live under one device and must be partitioned by profile**. Getting this wrong silently merges or destroys someone's collection — so design it first, before any UI.

### Recommended model

**A. Profile as the top-level partition.**
- One device holds **N profiles**. A profile is the unit of identity, export, and isolation — *not* a cloud account (there is no server).
- Every domain record (deck, note/marginalia, saved item, match, dashboard layout, settings) is owned by exactly one `profileId`.
- The **reference data** (rules glossary, card catalogue) is **shared and read-only across profiles** — it is content, not user data. Only the user's *annotations and collections* are per-profile.

**B. Storage shape.**
```
device
├─ catalog/            # shared, read-only, ships with the app + updatable as data
│   ├─ rules[]         # keywords/terms
│   └─ cards[]         # card definitions (+ optional imageRef, never required)
├─ profiles/
│   ├─ <profileId>/
│   │   ├─ profile.json        # name, avatar (optional), accent, createdAt, schemaVersion
│   │   ├─ decks[]             # deckId, name, archetype, list:[{cardId, qty}], ...
│   │   ├─ marginalia[]        # noteId, targetId(ref into catalog), text, editedAt
│   │   ├─ saved[]             # ids into catalog or decks
│   │   ├─ matches[]           # matchId, players, log:[...], result, endedAt
│   │   ├─ dashboard.json      # widget layout
│   │   └─ settings.json       # life total default, die, accent metal, theme
│   └─ ...
└─ app.json                    # activeProfileId, lastBackupAt, globalSchemaVersion
```

**C. Capacitor-native persistence (prefer native over web shims):**
- Use **`@capacitor/preferences`** for small singletons (`app.json`, `activeProfileId`, per-profile `settings.json`) — it's native `UserDefaults`/`SharedPreferences`, survives reinstall-safe backup rules better than `localStorage`.
- Use the **`@capacitor/filesystem`** API (or SQLite via `@capacitor-community/sqlite`) for the collections (`decks`, `matches`, `marginalia`) — these grow unbounded and should not sit in key-value/`localStorage`. **SQLite is the recommended primary store** for anything list-shaped; it gives you indexed search (powering universal search) and transactional writes (which matter for the migration import).
- **Never** keep authoritative data only in `localStorage`/IndexedDB inside the webview — it's evictable. The mockup uses in-memory state; the real app must back every write to the native layer immediately.

**D. Migration / import (this is where data dies if rushed):**
- On first launch of Compendium, detect each legacy app's store. For **each** legacy app, import its single dataset into a **named profile** (default: one "Imported" profile per source, or a guided merge wizard letting the user fold them into one profile they name).
- Import must be **transactional and idempotent**: wrap each profile import in a transaction; record an `importedFrom` + `importVersion` marker so a re-run never double-imports.
- **Never delete the legacy stores until the user confirms** the imported profile looks right. Keep a one-tap "re-import from <app>" escape hatch for one release cycle.
- Validate on import: a deck referencing an unknown `cardId` should *degrade* (keep the entry as an "unknown card" placeholder) rather than throw — same graceful principle as images.

**E. Profile UX (already stubbed in the mockup's profile sheet):**
- Brand-bar profile chip → bottom sheet: list profiles, switch (instant, swaps the active partition), **Export** (writes a single portable file of that profile via `@capacitor/filesystem` + share sheet), **Import** (reads such a file into a new/merged profile).
- Switching profile must be **atomic**: never show profile A's decks with profile B's matches mid-swap. Load the new partition fully, then render.
- Export format: a single JSON (or zip if images are bundled) that is **self-describing** (`schemaVersion`, `exportedAt`, `app:"compendium"`). Importing an older schema must run forward-migrations, never fail hard.

**F. Schema versioning:** stamp `schemaVersion` on `profile.json` and every export. Write forward-only migrations. This is what makes the app safe to evolve (§6) without breaking existing on-device data.

> **The single most important rule:** reference catalogue = shared/read-only; everything the user *creates or marks* = per-profile and isolated. Decide this boundary on day one and never blur it.

---

## 5. Graceful degradation without images (hard requirement)

The app must be **fully usable with no image assets present** — for missing card art, missing avatars, missing deck covers. Treat images as progressive enhancement, never a dependency.

**Rules for the build:**
1. **Every image has a deterministic fallback rendered from data**, not a broken `<img>`. The mockup already does this: deck/card "art" is a generated gradient/hatch derived from the card's element(s); the qty chip and threshold pips carry the real information. Card-view tiles are legible with *zero* photography.
2. **Fallback is keyed to identity** so it's stable and recognisable: derive the gradient from element threshold (fire→amber, water→teal, earth→olive, air→cyan) and a hash of the name. Same card → same fallback every launch.
3. **Avatars:** initial-in-a-gold-disc fallback (already in the brand-bar chip and profile sheet). Never require an uploaded photo.
4. **Never let a missing asset break layout.** Reserve the box (aspect-ratio), draw the fallback into it. No layout shift between "image present" and "image absent."
5. **`<image-slot>`-style optional fill:** where a user *can* add their own art later, the empty state is a finished-looking fallback, not a dashed "upload here" hole — unless they're explicitly in an edit context.
6. **Detail screens** (term, card, deck) must read completely from text + generated art alone. Imagery enriches; it is never load-bearing for comprehension.

> Test gate: ship a build flag / test that nukes every image asset. The app must look intentional, not broken. If any screen looks empty or errors, the fallback isn't done.

---

## 6. Expandability & maintainability

- **Content is data.** Rules, cards, elements, archetypes, even sort/filter options come from the catalogue and small config — adding a set is adding rows, not editing components. The Filters & Sort sheet should build its element/type chips from the catalogue's distinct values, not a hardcoded list.
- **A second game system later** should slot in as another catalogue namespace + a system tag on profiles/decks — the four-pillar shell is system-agnostic. Don't hardcode Sorcery-only assumptions into the chrome.
- **Shared components, single definitions:** chip row, list row, detail header, bottom sheet, adaptive FAB, fallback-art generator. One source each. The mockup's repetition is intentional proof of the pattern — the production build should factor it.
- **Material Design 3 interaction layer over the grimoire skin:** use M3 *patterns* (bottom nav, FAB + its menu, bottom sheets, ripple/state layers, elevation semantics, touch targets ≥48dp) but keep the bespoke grimoire *visuals*. M3 governs behaviour and a11y; the design system governs looks.
- **Capacitor-native preference:** persistence (§4), share sheet (export), haptics (life counter taps), status-bar styling, and back-button handling should use Capacitor plugins, not web approximations.
- **Accessibility floor:** 48dp targets, AA contrast on text over the dark ground (the parchment `#e9dcc0` and gold `#dcb86f` already clear it; check muted `#7a6e5c` for body — only use it on ≥14px), respect reduced-motion (the breathing-glow and sheet animations must have a still fallback).

---

## 7. Per-screen design prompts (what / how / why)

Hand these to the build agent screen-by-screen. Each is self-contained. Visuals reference `DESIGN_SYSTEM.md` and the live `Compendium.dc.html`.

### 7.1 App shell (chrome)
- **What:** status bar → brand bar (Cinzel "Compendium" wordmark, split-diamond mark, profile chip) → context header (eyebrow + Cinzel title for list views; back + centered title for detail) → scroll body → adaptive search+FAB row → 4-pillar bottom nav (Home ⌂ · Codex ▤ · Decks ◈ · Play ♥) each with its origin accent dot.
- **How:** dark grimoire radial ground; the search+FAB row and the whole bottom bar are conditional — present only when the current screen has something to search or a primary create action. The FAB glyph + action **changes per pillar** (＋ menu on Home/search, ✎-free "new note" on Codex, new deck on Decks, ⚔ new match on Play); it hides on deck detail (where Edit Deck is a chip) and shows a count badge in the add-cards filter context.
- **Why:** one consistent frame is the entire unification thesis — same chrome everywhere means the three apps read as one. Conditional search/FAB removes chrome that would otherwise lie about what's actionable.

### 7.2 Home — Overview + Dashboard
- **What:** top chip sub-nav **Overview · Dashboard** (+ Edit action on Dashboard). Overview = resume card, live-match strip, decks rail, notes. Dashboard = customisable widget grid (Saved, Recent Duels, Random Card, Notes, Your Decks).
- **How:** widgets are ½ or full width; Edit mode reveals drag handle, ½/full toggle, remove ✕, and "＋ Add a widget." Widgets read from the unified store, so they aggregate across pillars.
- **Why:** Home is the payoff of unification — it can only exist because the data is merged. The Dashboard is a direct port of Lexicum's most-loved feature, re-homed as a *secondary* page so the default Home stays calm.

### 7.3 Codex — list, card grid, detail
- **What:** chip scopes **Rules · Cards · All**; on Cards a **List ⇄ Card** view toggle (right side, same chip language). List = alphabetised rows with letter dividers + note-indicator dots. Card view = 2-up full-card grid. Detail = drop-cap reading layout, related chips, save/star, marginalia block.
- **How:** card tiles use the element-derived fallback art (no photography needed); detail is fully legible from text alone.
- **Why:** Lexicum's reference depth is the knowledge core; List vs Card serves scanning vs recognition. Marginalia is what makes the codex *personal* (and per-profile).

### 7.4 Decks — library, detail (Cards/Stats), edit
- **What:** library of deck cards (art, archetype, threshold pips, record). Detail leads with **Cards / Stats / Edit Deck** chips *above* the deck name, then the hero, then content. Stats = counts + mana curve. Edit Deck → the add/edit flow.
- **How:** chips at top keep deck detail consistent with Codex/Home. "Edit Deck" is a text chip — **no pencil glyph** (explicitly rejected). Search bar hides on deck detail.
- **Why:** putting controls above the title makes every detail screen in the app structurally identical — predictable, mature. The deck is the editing *context*; you select a deck by opening it, then edit within it (this is how Arcanum scoped card-adding, preserved here).

### 7.5 Decks — Add / Edit cards (scoped)
- **What:** a pinned header "ADDING CARDS TO · <Deck>" with a live count; **List ⇄ Card** toggle; **Filters & Sort** FAB (⚙ + count badge) opening a sheet (sort name/mana ↑↓; element; type).
- **How:** Card view = full cards, **2 per row, art only, a single qty chip bottom-right** showing copies in the deck; tap a card to add one. List view keeps +/− steppers for precision. Filter chips are built from catalogue values, not hardcoded.
- **Why:** building a deck is a recognition task — card imagery + a quantity glance is faster than reading rows; the list view stays for fine control. Scoping prevents the classic Arcanum confusion of "add to *what?*"

### 7.6 Play — hub + match + log
- **What:** Play hub = compact **New Match** + **Quick Match** row, then **Recent Duels** (season history). An in-progress match opens the **life counter**; the **Match Log** lives *inside* that match.
- **How:** hub stays calm (history only). The life counter is the Vitarum screen verbatim (gilt numerals, ember low-life, roll-for-start medallion, accent-metal tweak, max-life/die settings). The Match Log (time · who · gained/lost · running ♥) is a per-game artifact shown during/after a match, never on the hub.
- **Why:** two different time-scales (this game vs. your season) don't belong on one screen — separating them is what made the hub feel clean. The crest/buttons are still under review; keep the action compact.

### 7.7 Profiles & data
- **What:** profile chip → bottom sheet: switch profile, Export, Import (per §4).
- **How:** atomic profile swap; export = one self-describing portable file via native share; import runs forward-migrations.
- **Why:** on-device multi-profile isolation is the crux of the merge — see §4. This sheet is the entire surface of user management, so it must be trustworthy and boring.

---

## 8. Build order (lowest risk first)

1. **Data layer + profile partition + legacy import** (§4) — nothing else is safe until this is solid.
2. **Shell** (chrome, nav, adaptive search/FAB) + shared components (chip, row, header, sheet, fallback-art generator).
3. **Codex** (read-only, lowest risk) — proves catalogue + detail + marginalia.
4. **Decks** — deck CRUD, detail, scoped edit/add, filters.
5. **Play** — life counter port + match log + recent duels.
6. **Home / Dashboard** last — it aggregates everything above.
7. **Graceful-image audit** (§5) as a release gate on every screen.

---

## 9. Source-of-truth files in this project

- `Compendium.dc.html` — the unified UI mockup (the target).
- `DESIGN_SYSTEM.md` — palette, type, tokens (the grimoire language).
- `COMPONENT_INVENTORY.md` — reusable components catalogued from Lexicum.
- `Lexicum.dc.html` — Codex source (rules, cards, marginalia, dashboard).
- `Arcanum.dc.html` — Decks source (library, detail, deck menu, edit).
- `Vitarum - Life Counter.dc.html` / `Vitarum - Match Log.dc.html` / `Vitarum.dc.html` — Play source.

> Build agent: start at §0 Step 1. Produce the feature matrix from the three source files, confirm it against §2, and get sign-off before writing code.
