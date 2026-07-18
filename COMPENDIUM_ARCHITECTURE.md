# Compendium — Architecture and Product Model

> Compendium is one offline-first application with five product pillars: **Home**, **Codex**, **Collection**, **Decks**, and **Play**. This document defines their responsibilities, shared architecture, interaction model, and non-negotiable product constraints. Current source and tests define implemented behaviour.

## 0. How to use this document

Read this document with `COMPENDIUM_DATA_MODEL.md`, `COMPENDIUM_FEATURE_MATRIX.md`, `BUILD.md`, and `ENGINEERING_CONSTITUTION.md` before proposing architectural work. Preserve the pillar boundaries, profile isolation, offline durability, graceful asset degradation, and shared component language described here. When documentation and implementation differ, report the discrepancy rather than silently choosing one.

---

## 1. Identity — what Compendium *is*

**One sentence:** Compendium is the offline grimoire, collection ledger, workshop, and duelling table for a trading-card mage — reference, collect, build, and play in one continuous surface.

**Compendium has five pillars:**

| Pillar | Owns |
|---|---|
| **Home** | Cross-pillar workspace: resume, customisable Dashboard, saved items, and recent activity. |
| **Codex** | Rules and card catalogues, search, detail reading, saved references, and marginalia (notes and links). |
| **Collection** | Card ownership ledger, per-set quantities, wanted cards, card lists, scanner-assisted entry, and deck buildability. |
| **Decks** | Deck library, deckbuilder, deck analysis, collection comparison, sharing, and import. |
| **Play** | Match setup, life tracker, match journal, completed-match history, and play settings. |

**Why this shape:** Compendium presents one visual and interaction system. Pillar accent colours provide wayfinding without creating separate interface languages. Chrome, typography, controls, accessibility behaviour, and data ownership remain consistent; domain content is what differs.

**Visual identity (locked):**
- **Palette:** jade-black grimoire ground (`#120d09`→`#241a12` radial), gold leaf `#dcb86f` / `#cf9a4a` as brand + chrome, parchment `#e9dcc0` text. Wayfinding accents: gold for Codex, ruby for Collection, violet for Decks, and jade for Play.
- **Type:** Cinzel (display / wordmark / section eyebrows), Hanken Grotesk (UI labels, chips), EB Garamond (reading copy, card/term names), IBM Plex Mono (counts, numerals, timestamps).
- **One chip language everywhere:** filled-gold active pill (`#dcb86f` bg, `#1a1410` text), ghost inactive pill (`rgba(201,163,90,.07)` bg, `#cbbfa8` text, `rgba(201,163,90,.2)` border). Used by Codex scopes, Home sub-nav, deck Cards/Stats, filter sheets. **Do not introduce a second toggle style.**
- **Chrome:** status bar → brand bar (wordmark + diamond mark + profile chip) → context header → scroll body → adaptive search+FAB row → 5-pillar bottom nav.

---

## 2. Product capability model

The following capabilities define the responsibility of each pillar. `COMPENDIUM_FEATURE_MATRIX.md` is the detailed capability contract; this section records the architectural boundaries that implementations must preserve.

**Codex**
- Glossary of rules/keywords + card entries, alphabetised with letter dividers.
- Chip scopes: **Rules · Cards · All**.
- **List view ⇄ Card view** toggle (Card view = grid of full cards).
- Term/card **detail**: drop-cap reading layout, related-term chips, save/star.
- **Marginalia**: personal notes attached to a term/card; note indicator dot in lists.

**Collection**
- Overview of owned copies, unique cards, wanted cards, recent additions, and buildable decks.
- **My Collection** browser with list/binder views, per-set quantities (Alpha and Beta tracked separately), filters, read/add modes, bulk entry, and scanner-assisted entry.
- **Lists** for custom card groupings and wanted-card goals with live acquisition progress.
- Shared buildability comparison used by Collection, Decks, and Home; decks never reserve owned cards.

**Decks**
- Deck library (art, archetype, element threshold pips, win record).
- Deck **detail** with **Cards / Stats** tabs at the top (above the deck name) + **Edit Deck**.
- Stats: spellbook/atlas counts, record, **mana curve**.
- **Edit / Add Cards** flow, *scoped to the open deck*, with a pinned "editing which deck" header and live count.
- Add flow has **List ⇄ Card** view (Card view = full cards, 2-up, art only, qty chip bottom-right) and a **Filters & Sort** sheet (sort by name/mana; filter by element, type).
- Per-card quantity steppers (+/−), threshold pips.

**Play (in the Play pillar)**
- Start: **New Match** + **Quick Match**.
- The **life counter** itself (two-player, gilt numerals, low-life ember state, roll-for-start medallion, accent metal tweak, max-life / die settings) — see `Play - Life Counter.dc.html`.
- **Match Log** (per-game record of life given/taken) — lives *inside an in-progress match*, not on the Play hub.
- **Recent Duels** season history on the Play hub.

**Home (cross-pillar workspace)**
- Resume / jump-back-in.
- **Dashboard** sub-page: customisable widgets (Saved, Collection, Recent Duels, Random Card, Notes, Your Decks) with edit mode — resize ½/full, remove, add, reorder.
- Overview: live match, decks rail, notes.

**Cross-cutting (across all five pillars)**
- Profiles / user switching (see §4).
- Export / import of a profile's data.
- Universal search across rules, cards, decks, duels.
- The adaptive FAB (changes action per pillar) and "search only when there's something to search."

---

## 3. Architectural quality bar

Compendium is maintained as one product and one architecture.

1. **One design system, enforced.** All pillars use shared tokens and interaction vocabulary. No screen invents color.
2. **One component vocabulary.** Chips, list rows, detail headers, sheets, and the FAB are defined once and reused. Codex, Collection, Decks, Play, and Home consume shared components rather than maintaining pillar-specific copies of the same interaction.
3. **One data layer.** A single schema with a profile partition powers search, Dashboard, Home, and every pillar repository.
4. **Graceful everywhere.** Compendium must render fully with **zero images** (§5).
5. **Expandable by data, not code.** New card sets / elements / even a second game system should be additive data, not a refactor (§6).
6. **One CSS namespace: `cx-`.** Compendium-owned classes carry it; generic names do not (§3.1).

### 3.1 The `cx-` namespace

**`cx` stands for *Compendium experience*** — Compendium's UX and component styling. It is a namespace prefix, and its only job is to distinguish classes this app owns from generic names like `.fab`, `.sheet`, `.card`, or `.chip`, which collide easily and come from everywhere.

```
cx-app             the application shell
cx-dock            the dock (search pill + FAB)
cx-nav             navigation
cx-decks           the Decks / deckbuilder styling scope   (decks.css)
cx-match-history   the Play hub                            (playhistory.css)
cx-life-tracker    the life counter                        (counter.css)
```

**This is written down because it is not self-evident.** "CX" reads as *customer experience* to most engineers, and nothing else in the repository defines it. With hindsight `cmp-` or `compendium-` would have been plainer. **We are not renaming it** — see the rules below; the cost of a broad selector rename is now measured, not theoretical.

Rules, each one paid for:

- **A scope class is load-bearing, not decoration.** The scope is what a stylesheet's rules descend from, so JSX emitting the wrong one is not a typo — it silently deletes every rule under it. Because a `className` is only a string, nothing catches this: the build, the types, and the tests all pass while the screen renders as unstyled UA defaults.
- **Do not rename a scope broadly.** Commit `3ee4a35` renamed `.arc` → `.cx-decks`, `.mh` → `.cx-match-history`, `.vc-root` → `.cx-life-tracker` in the CSS and missed twelve JSX call sites. The FAB and its menu became white system squares on every pillar, and the whole Play hub rendered as raw text, for two days. If a rename is genuinely required, change the CSS and every call site in one commit and verify on a device.
- **`src/pillars/cssScope.test.mjs` guards this**, under the `test:ui` gate. It rejects the three superseded spellings anywhere a class attribute is emitted, while leaving ordinary prose alone — "arc" is also an English word. Extend it when a scope is added.
- **Scope sits on the element it scopes, not a parent, where specificity depends on it.** `decks.css` targets `.cx-decks.fab-wrap .fab` (0,3,0) deliberately, because `counter.css` defines a global `.fab-wrap .fab` (0,2,0) that loads later and would otherwise win. Hoisting the scope to a wrapper drops the compound to a descendant and the FAB silently changes colour.
- **A component that depends on a stylesheet imports it.** `Fab.jsx` renders on every pillar and carries `cx-decks`, so it imports `decks.css` itself rather than relying on some other module happening to pull it into the bundle.

---

## 4. User management — the highest-risk piece (READ FIRST)

All user data is **on-device** and partitioned by profile. Getting this wrong can expose, merge, or destroy a person's collection, so profile isolation is a structural repository invariant rather than a UI convention.

### Profile and persistence model

**A. Profile as the top-level partition.**
- One device holds **N profiles**. A profile is the unit of identity, export, and isolation — *not* a cloud account (there is no server).
- Every domain record (owned/wanted card entry, card list, deck, note/marginalia, saved item, match, dashboard layout, settings) is owned by exactly one `profileId`.
- The **reference data** (rules glossary, card catalogue) is **shared and read-only across profiles** — it is content, not user data. Card ownership, wanted quantities, card lists, Codex marginalia/collections, decks, and matches are per-profile.

**B. Storage shape.**
```
device
├─ catalog/            # shared, read-only, ships with the app + updatable as data
│   ├─ rules[]         # keywords/terms
│   └─ cards[]         # card definitions (+ optional imageRef, never required)
├─ profiles/
│   ├─ <profileId>/
│   │   ├─ profile.json        # name, avatar (optional), accent, createdAt, schemaVersion
│   │   ├─ owned_cards[]       # cardId + printing/variant; owned and wanted quantities
│   │   ├─ card_lists[]        # custom and wanted lists with ordered card entries
│   │   ├─ decks[]             # deckId, name, archetype, list:[{cardId, qty}], ...
│   │   ├─ marginalia[]        # noteId, targetId(ref into catalog), text, editedAt
│   │   ├─ saved[]             # ids into catalog or decks
│   │   ├─ matches[]           # matchId, players, log:[...], result, endedAt
│   │   ├─ dashboard.json      # widget layout
│   │   └─ settings.json       # life total default, die, accent metal, theme
│   └─ ...
└─ app.json                    # activeProfileId, lastBackupAt, globalSchemaVersion
```

`owned_cards` is the Collection pillar's profile-scoped ownership ledger. It records per-set owned and wanted quantities (Alpha and Beta tracked separately; see the vocabulary in `COMPENDIUM_DATA_MODEL.md`). `card_lists` contains custom groupings and wanted-card goals. Neither is the deck `collection` zone, and neither is a Codex named collection; those are separate domain concepts with separate persistence contracts. The concrete relational schema is defined in `COMPENDIUM_DATA_MODEL.md`.

**Collection write integrity.** Every *interactive* mutation of `owned_cards`/`card_list_entries` is serialized through a store-layer per-row write queue (`src/store/collectionWrites.js`) and bound to the profile captured when the edit was scheduled; `switchProfile` drains that queue before changing the active profile. This is the single ordering point for concurrent Collection edits, and it lives in the **store** layer (the shared write chain moved out of `src/components`) so `switchProfile` never depends on a UI module. Batch/atomic writers (scanner, resolved import, single-set backfill) are single-profile-bound and transactional and stay outside it. See `docs/proposals/collection-write-integrity.md`.

**Collection pure models.** The Collection pillar's consequential non-write logic lives in pure, DOM-free store modules tested under `test:query`, kept out of the ~1,400-line `Collection.jsx`: `collectionGroups.js` (printing grouping + ownership lens), `importPlan.js` (text-import printing routing — single/multi/Unspecified partition, choice defaults, write-item assembly), and `listGoalModel.js` (wishlist/list completion math — the optimistic `goalTotals` and per-row `goalRowState` behind every progress bar). The three optimistic ownership machines (`useOwnedLedger`, `stepSet`, the `ListDetail` goal machine reconciled via `collectionGoalDrain.js`) deliberately stay per-surface rather than unified — the merged per-row queue already removed the correctness argument for merging them.

**C. Capacitor-native persistence (prefer native over web shims):**
- Use **`@capacitor/preferences`** for small singletons (`app.json`, `activeProfileId`, per-profile `settings.json`) — it's native `UserDefaults`/`SharedPreferences`, survives reinstall-safe backup rules better than `localStorage`.
- **Telemetry consent** (`unset | granted | denied`) is an app-global singleton of the same tier as `activeProfileId` and the changelog seen-stamp, but it is owned **natively** (`TelemetryPlugin.kt`, its own `SharedPreferences`, written with `commit()`) because it must be readable and enforceable before a WebView exists. It is deliberately **not** a per-profile `settings` row and deliberately **not** exportable: a profile imported from another device must never carry that device's consent decision here. `src/store/telemetry.js` is a client over that authority, not the authority.
- Store list-shaped and relational data in **SQLite** through the repository layer. It provides indexed search and transactional writes for decks, ownership, lists, matches, marginalia, and imports.
- **Never** keep authoritative data only in transient React state or `localStorage`. Browser persistence uses the documented sql.js/IndexedDB adapter; device persistence uses SQLite. Repository contracts, ownership rules, and transaction semantics remain consistent across both runtimes.
- The **ongoing-match snapshot** is the sanctioned `localStorage` case (non-authoritative, resumable UI state — not history). Its serialized shape, defaults, and version are a **store-layer contract** in `src/store/matchSnapshot.js`; `src/store/ongoingMatch.js` is the profile-scoped adapter. The producing pillar (`LifeCounter`) and `App` depend on that store-owned contract — dependency flows ui→store, never store→pillar.
- The life counter's **decision logic** is factored into pure, DOM/timer-free pillar modules tested under `test:ui`: `src/pillars/matchLife.js` (the life/max ≤20 safety boundary) and `src/pillars/matchRoll.js` (the turn-order roll-off — the fair d20 contest plus the resume-skip and lock phase guards). They hold no DOM, timers, or haptics, so their invariants are provable without a running counter; `LifeCounter` keeps the ceremony (animation, timers, aria).

**D. Import and recovery:**
- Profile bundles and deck lists are untrusted input: validate shape, version, ownership, identifiers, quantities, and URLs before writing.
- Profile imports are transactional and re-key identifiers so repeated imports cannot collide with existing data.
- Unknown card references degrade visibly and produce warnings rather than disappearing silently.
- Older supported bundle versions are upgraded through ordered, forward-only schema transformations. Partial failure leaves existing profiles unchanged.

**E. Profile UX:**
- Brand-bar profile chip → bottom sheet: list profiles, switch (instant, swaps the active partition), **Export** (writes a single portable file of that profile via `@capacitor/filesystem` + share sheet), **Import** (reads such a file into a new/merged profile), and **Settings** (accessibility and app preferences).
- **Settings opens as a centered modal over the profile sheet, which stays mounted beneath it.** The modal is the layer that acts; the sheet is the context it acts on. Because the sheet is never unmounted, closing Settings returns the user to it rather than to the app root. Do not make this a second bottom sheet: two sheets share one z-index and separate only by DOM order.
- Switching profile must be **atomic**: never show profile A's decks with profile B's matches mid-swap. Load the new partition fully, then render.
- Export format: a single JSON (or zip if images are bundled) that is **self-describing** (`schemaVersion`, `exportedAt`, `app:"compendium"`). Imports validate the version and apply supported schema upgrades before committing data.

**F. Schema versioning:** stamp `schemaVersion` on persisted profile data and every export. Schema upgrades are forward-only, ordered, and safe to retry where practical. This allows Compendium to evolve (§6) without breaking existing on-device data.

> **The single most important rule:** reference catalogue = shared/read-only; everything the user *creates or marks* = per-profile and isolated. This is a permanent boundary and must never be blurred.

---

## 5. Graceful degradation without images (hard requirement)

The app must be **fully usable with no image assets present** — for missing card art, missing avatars, missing deck covers. Treat images as progressive enhancement, never a dependency.

**Implementation rules:**
1. **Every image has a deterministic fallback rendered from data**, not a broken `<img>`. Deck/card fallback art is generated from the card's element(s) and identity; quantity chips and threshold pips carry the functional information. Card-view tiles remain legible with *zero* photography.
2. **Fallback is keyed to identity** so it's stable and recognisable: derive the gradient from element threshold (fire→amber, water→teal, earth→olive, air→cyan) and a hash of the name. Same card → same fallback every launch.
3. **Avatars:** initial-in-a-gold-disc fallback (already in the brand-bar chip and profile sheet). Never require an uploaded photo.
4. **Never let a missing asset break layout.** Reserve the box (aspect-ratio), draw the fallback into it. No layout shift between "image present" and "image absent."
5. **`<image-slot>`-style optional fill:** where a user *can* add their own art later, the empty state is a finished-looking fallback, not a dashed "upload here" hole — unless they're explicitly in an edit context.
6. **Detail screens** (term, card, deck) must read completely from text + generated art alone. Imagery enriches; it is never load-bearing for comprehension.

> Test gate: ship a build flag / test that nukes every image asset. The app must look intentional, not broken. If any screen looks empty or errors, the fallback isn't done.

---

## 6. Expandability & maintainability

- **Content is data.** Rules, cards, elements, archetypes, even sort/filter options come from the catalogue and small config — adding a set is adding rows, not editing components. The Filters & Sort sheet should build its element/type chips from the catalogue's distinct values, not a hardcoded list.
- **The catalog is regenerated by a build-time tool, never at runtime.** `npm run update:catalog` (`scripts/update-catalog.mjs` + `scripts/catalog/*`) rebuilds the entire bundled catalog from a `CATALOG_DROP/` folder - Curiosa tRPC fetch and merge, rules/FAQ CSV compile, per-printing PNG-to-WebP conversion, link-graph and compiled-Codex regeneration - through a staged, validated, journaled promotion, and writes the `src/store/catalogVersion.json` seed token that triggers the on-device reseed. It runs on a developer machine only; the app never fetches or mutates catalog content at runtime. A content-hash gate makes an unchanged catalog a no-op, and a build-wide guard refuses to package a working tree with a promotion mid-flight. See `BUILD.md` and `COMPENDIUM_DATA_MODEL.md`.
- **A second game system later** should slot in as another catalogue namespace + a system tag on profiles/decks — the five-pillar shell is system-agnostic. Don't hardcode Sorcery-only assumptions into the chrome.
- **Shared components, single definitions:** chip row, list row, detail header, bottom sheet, adaptive FAB, and fallback-art generator each have one maintained implementation consumed across pillars.
- **Material Design 3 interaction layer over the grimoire skin:** use M3 *patterns* (bottom nav, FAB + its menu, bottom sheets, ripple/state layers, elevation semantics, touch targets ≥48dp) but keep the bespoke grimoire *visuals*. M3 governs behaviour and a11y; the design system governs looks.
- **Capacitor-native preference:** persistence (§4), share sheet (export), haptics (life counter taps), status-bar styling, and back-button handling should use Capacitor plugins, not web approximations.
- **Accessibility floor:** 48dp targets, AA contrast on text over the dark ground (the parchment `#e9dcc0` and gold `#dcb86f` already clear it; check muted `#7a6e5c` for body — only use it on ≥14px), respect reduced-motion (the breathing-glow and sheet animations must have a still fallback).

---

## 7. Screen architecture contracts (what / how / why)

These screen contracts define responsibility and interaction intent. Detailed capabilities live in `COMPENDIUM_FEATURE_MATRIX.md`; shared visual and component rules are implemented in `src/theme/` and `src/components/`.

### 7.1 App shell (chrome)
- **What:** status bar → brand bar (Cinzel "Compendium" wordmark, split-diamond mark, profile chip) → context header (eyebrow + Cinzel title for list views; back + centered title for detail) → scroll body → adaptive search+FAB row → 5-pillar bottom nav (Home · Codex · Collection · Decks · Play), each with its wayfinding accent.
- **How:** dark grimoire radial ground; the search+FAB row and the whole bottom bar are conditional — present only when the current screen has something to search or a primary create action. The FAB and search actions change by pillar: Home owns Dashboard actions; Codex owns reference actions; Collection owns view, refine, bulk-entry, and scanner actions; Decks owns deck creation and editing; Play owns match actions; it hides on deck detail (where Edit Deck is a chip) and shows a count badge in the add-cards filter context.
- **Why:** one consistent frame is the entire unification thesis — same chrome everywhere means the five pillars read as one. Conditional search/FAB removes chrome that would otherwise lie about what's actionable.

### 7.2 Home — Overview + Dashboard
- **What:** top chip sub-nav **Overview · Dashboard** (+ Edit action on Dashboard). Overview = resume card, live-match strip, decks rail, notes. Dashboard = customisable widget grid (Saved, Recent Duels, Random Card, Notes, Your Decks).
- **How:** widgets are ½ or full width; Edit mode reveals drag handle, ½/full toggle, remove ✕, and "＋ Add a widget." Widgets read from the unified store, so they aggregate across pillars.
- **Why:** Home is the cross-pillar workspace. Dashboard remains a secondary page so the default Home stays calm.

### 7.3 Codex — list, card grid, detail
- **What:** chip scopes **Rules · Cards · All**; on Cards a **List ⇄ Card** view toggle (right side, same chip language). List = alphabetised rows with letter dividers + note-indicator dots. Card view = 2-up full-card grid. Detail = drop-cap reading layout, related chips, save/star, marginalia block. A card with more than one printing shows a printing switcher on the detail that flips the hero art and artist credit between its printings; a single-printing card shows no switcher.
- **How:** card tiles use the element-derived fallback art (no photography needed); detail is fully legible from text alone.
- **Why:** Codex's reference depth is the knowledge core; List vs Card serves scanning vs recognition. Marginalia is what makes the codex *personal* (and per-profile).

### 7.4 Collection — ownership, wanted cards, and lists

- **What:** Overview, My Collection, and Lists surfaces. My Collection provides list and binder views, per-set owned quantities (a set picker records Alpha and Beta separately), wanted quantities, filters, bulk import, and camera-assisted entry. Lists provide named card and wanted lists with progress. Deck buildability compares owned cards with deck requirements without reserving cards.
- **How:** all ownership data is profile-scoped through `ownedRepository`. Card definitions remain in the shared catalogue. Ruby is the Collection wayfinding accent; shared card presentation, refine controls, sheets, and zero-image fallbacks remain consistent with the rest of Compendium.
- **Why:** Collection answers a different question from Codex and Decks: “what do I own or want?” Keeping ownership as a first-class pillar makes collection state reusable by Home and Decks without confusing it with the deck `collection` zone or named Codex collections.

### 7.5 Decks — library, detail (Cards/Stats), edit
- **What:** library of deck cards (art, archetype, threshold pips, record). Detail leads with **Cards / Stats / Edit Deck** chips *above* the deck name, then the hero, then content. Stats = counts + mana curve. Edit Deck → the add/edit flow.
- **How:** chips at top keep deck detail consistent with Codex/Home. "Edit Deck" is a text chip — **no pencil glyph** (explicitly rejected). Search bar hides on deck detail.
- **Why:** putting controls above the title makes every detail screen in the app structurally identical and predictable. The open deck is the editing context; card changes always apply to that explicitly selected deck.

### 7.6 Decks — Add / Edit cards (scoped)
- **What:** a pinned header "ADDING CARDS TO · <Deck>" with a live count; **List ⇄ Card** toggle; **Filters & Sort** FAB (⚙ + count badge) opening a sheet (sort name/mana ↑↓; element; type).
- **How:** Card view = full cards, **2 per row, art only, a single qty chip bottom-right** showing copies in the deck; tap a card to add one. List view keeps +/− steppers for precision. Filter chips are built from catalogue values, not hardcoded.
- **Why:** building a deck is a recognition task — card imagery + a quantity glance is faster than reading rows; the list view stays for fine control. Scoping prevents the classic Deckbuilder confusion of "add to *what?*"

### 7.7 Play — hub + match + log
- **What:** Play hub = compact **New Match** + **Quick Match** row, then **Recent Duels** (season history). An in-progress match opens the **life counter**; the **Match Log** lives *inside* that match.
- **How:** hub stays calm (history only). The life counter is the Compendium life tracker (gilt numerals, ember low-life, roll-for-start medallion, accent-metal tweak, max-life/die settings). The Match Log (time · who · gained/lost · running ♥) is a per-game artifact shown during/after a match, never on the hub.
- **Why:** two different time-scales (this game vs. your season) don't belong on one screen — separating them is what made the hub feel clean. The crest/buttons are still under review; keep the action compact.

### 7.8 Profiles & data
- **What:** profile chip → bottom sheet: switch profile, Export, Import (per §4), and Settings.
- **How:** atomic profile swap; export = one self-describing portable file via native share; import validates and upgrades supported schema versions before committing. Settings opens as a modal over the sheet (per §E).
- **Why:** on-device multi-profile isolation is a core safety boundary — see §4. This sheet is the entire surface of user management, so it must be trustworthy and boring. Settings lives here because the chip is the account surface, and because a visible row is discoverable in a way the wordmark binding it replaced was not.

### 7.9 About & release notes
- **What:** the Compendium wordmark is the app's home button everywhere; **on Home**, where "go home" is a no-op, it opens Credits instead. Credits carries version, build, attribution, and **What's New** (the release notes).
- **How:** notes are data (`src/content/changelog.js`), rendered by one modal with no per-version conditionals. On update, the same modal is shown once with every entry the user has not seen; the seen-build stamp is app-global (§4), never profile-owned, so it neither follows a profile export to another device nor re-fires on a profile switch.
- **Why:** the app already knows the build it last ran, and alpha testers need to know what changed. Credits is the notes' permanent home so dismissing the update gate does not put them out of reach.

---

## 8. Dependency and ownership order

This is the architectural dependency direction, not a project plan:

1. **Shared data foundation:** catalog, persistence, profile partition, and repositories establish identity and durability boundaries.
2. **Shared application shell:** navigation, chrome, profile controls, search, common components, design tokens, and fallback art depend on the data foundation.
3. **Domain pillars:** Codex, Collection, Decks, and Play depend on the shared foundation and shell but do not depend on Home.
4. **Cross-pillar workspace:** Home and Dashboard consume stable repository interfaces from every domain pillar; domain pillars must not import Home concerns.
5. **Runtime adapters:** browser and Capacitor integrations implement the same domain contracts without leaking runtime-specific behavior into pillar components.

Changes must preserve this dependency direction. Cross-pillar behavior belongs in a shared repository or service with an explicit contract, not in direct pillar-to-pillar imports. Graceful zero-image behavior (§5) remains a release gate for every UI surface.

---

## 9. Architectural source-of-truth map

No historical application or mockup defines Compendium. Authority is divided by concern:

- `COMPENDIUM_ARCHITECTURE.md` — product boundaries, dependency direction, runtime posture, and architectural constraints.
- `COMPENDIUM_DATA_MODEL.md` — catalog/profile boundary, schemas, persistence, import/export, and ownership rules.
- `COMPENDIUM_FEATURE_MATRIX.md` — required user-facing capabilities and pillar-level behavior.
- `ENGINEERING_CONSTITUTION.md` and `AGENTS.md` — engineering governance and AI participation.
- `BUILD.md` and `package.json` — supported development, validation, and build commands.
- `src/App.jsx` — application shell, pillar registration, and top-level navigation. **Hardware back is two-phase:** `src/back.js` is a LIFO registry that self-registering ephemeral UI (FAB menus, the `GothicSheet`/`Sheet` and `CenteredModal` chassis) peels *first*; only when every consumer declines does App consult the pure fallback precedence in `src/navBack.js` (`resolveAppBackFallback` over `APP_BACK_ORDER`, then `LifeCounter.closeTopmost` via `resolveCounterBackFallback`), then Home-edit / double-back-to-exit. Seven `APP_BACK_ORDER` rows are normally shadowed by a self-registering chassis and are kept, labelled, as declared fallbacks. The precedence is table-tested under `npm run test:app`.
- `src/pillars/` — present pillar implementations.
- `src/store/` — persistence, repositories, catalog access, import/export, and cross-pillar data services.
- `src/components/` and `src/theme/` — shared component and visual language.
- Tests and schemas — executable contracts for implemented behavior and data integrity.

When architecture, product documentation, implementation, and executable contracts disagree, follow the authority order in `ENGINEERING_CONSTITUTION.md` and record the discrepancy explicitly.
