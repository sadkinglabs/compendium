# Compendium — §0 Step 1 Feature Matrix (for sign-off)

> **Purpose:** the inventory-before-build gate from `COMPENDIUM_MIGRATION_HANDOFF.md` §0. Every screen, user action, persisted data shape, and setting from the three source apps, mapped to its new home in Compendium (pillar · screen), with two gap columns flagged:
> - 🆕 **Mockup-only** — present in `Compendium.dc.html` but *not yet backed* by a real source feature (new work, or a stub).
> - ⚠️ **Source-only** — present in a source app but *not yet surfaced* in the mockup (must be designed/added or consciously cut).
>
> **Sources of truth:** target = `Compendium.dc.html` (read at code level). Source apps inventoried at file/line: Lexicum `www/index.html`+`www/lexicum-data.js`, Arcanum `www/index.html`+`static/arcanum-local.js`+`models.py`/`deck_io.py`, Vitarum `www/index.html`.
> **No code is written until this matrix is approved.**

---

## ✅ SIGN-OFF (approved 2026-06-30)

The source apps remain working standalone references — **Compendium is built from zero**, taking their work as reference; features are *rebuilt* to fit the new scope, not ported verbatim. Decisions resolved:

- **D1 — No legacy migration.** Profiles are new and **universal across the whole app**. Old beta profiles/data are not imported. → **The §4-D import wizard / three-namespace reconciliation is struck from scope** (was the highest-risk item).
- **D2 — One catalog from scratch.** No legacy notes/marginalia carried over. Stable catalog ids going forward; no orphan-FK concern (nothing to orphan).
- **D3 — Lose no features.** Adopt the richest model (Arcanum's 3-zone + avatar + rarity-rules deck model, etc.).
- **D4 — Persist the match log** (not ephemeral), under the profile system *(cross-profile visibility nuance pending confirmation)*.
- **D5 — All 14 Lexicum dashboard widgets ship**, with room to add more for Decks/Play.
- **D6 — §2 spine is v1-mandatory; everything else is sequenced fast-follow, nothing cut.**
- **D7 — Defer native canvas (share-snapshot / deck poster)**, or reuse existing code and redesign later.
- **Explicit:** the **deck importer (Curiosa URL + bulk Markdown) and exporter (Arcanum Markdown + Curiosa)** must work as they do today — remap onto the new schema, don't lose them. → promoted to **v1**.

Profiles are now tied to **everything** and must be designed with extra care — see `COMPENDIUM_DATA_MODEL.md`.

---

## 0. Reality checks that reshape the build (read first)

These five facts came out of the source code and override several assumptions in the handoff/mockup:

1. **All three apps already have their own profile system — and they do NOT align.** This is the crux of §4, worse than the handoff implies (it assumed each app had *one implicit* user).
   - **Lexicum:** real multi-profile. `localStorage['lexicum-profiles-v1']` → each profile has its **own separate IndexedDB database**. Identity = profile `id`.
   - **Arcanum:** real multi-profile. `localStorage['arc-profiles']` + `arc-active-profile`; decks live in one IndexedDB store tagged with a `profile` **name** string. Identity = profile **name**.
   - **Vitarum:** multi-"player". `localStorage['vitarum-users']` + `vitarum-active-user`; matches tagged by `profile` **name** string. Identity = player **name**.
   - → Compendium must **reconcile three different profile namespaces** (Lexicum id, Arcanum name, Vitarum name) into one. Migration cannot assume a 1:1 mapping. **(Decision D1.)**

2. **The on-device store is IndexedDB/localStorage, not files — and for Arcanum the file store is stale.** Arcanum's real user data is **IndexedDB** (`arcanum` DB, `decks` store); the `data/decks/*.json` files and the Python backend are dev-only and *behind* (no `profile` field, no cached stats). Migration must read **IndexedDB**, never the JSON files. Lexicum = per-profile IndexedDB (10 stores, `DB_VERSION 7`). Vitarum = **localStorage only**.

3. **The shared catalog is already one catalog, mostly.** Lexicum `cards.json` (1104 cards) and Arcanum `cards.bundle.json` (1104 cards) are the **same Sorcery card set** (Lexicum's `build_cards.py` literally pulls from `../Arcanum`). Lexicum adds the rules side: **210 articles** (+ sub-entries), a **678-edge link graph**, and **734 official FAQs**. → Compendium `catalog/` = `cards[]` (1104, shared) + `rules[]` (210 articles) + `faqs[]` (734) + `linkGraph[]`. Dedupe cards to one source. **(Decision D2.)**

4. **The mockup's Play, settings, and composer are stubs.** In `Compendium.dc.html`: `newMatch`/`quickMatch` are no-ops; the **life counter and in-match Match Log do not exist** (`matchLogData` is unused state); there is **no settings screen** and **no marginalia composer** (`openComposer` unwired). These must be **ported from Vitarum/Lexicum code**, not lifted from the mockup.

5. **The mockup's data model is a toy.** 10 terms, 10 cards, 3 decks, flat deck lists, in-memory state. The real model is 1104 cards / 210 rules, **three deck zones** (Spellbook 60+ / Atlas 30+ / Collection ≤10), deck **avatars**, rarity copy-limits, and Monte-Carlo odds. The mockup proves the *visual language*; it under-models the *domain*. Treat the source apps as the domain truth.

---

## 1. Pillar mapping (the IA)

| Pillar | Source app | Source store(s) |
|---|---|---|
| **Home** (new) | aggregates all three | reads unified store |
| **Codex** | Lexicum | per-profile IndexedDB (favorites, notes, highlights, collections, links…) + shipped catalog JSON |
| **Decks** | Arcanum | IndexedDB `arcanum/decks` (+ `arc-profiles`, `libOrder`) + catalog bundle |
| **Play** | Vitarum | localStorage (`vitarum-matches`, `vitarum-users`, …) |
| **Cross-cutting** | all three | profiles, export/import, universal search, adaptive FAB, settings |

---

## 2. CODEX  ← Lexicum

### 2.1 Screens
| Source screen | Source loc | Compendium home | Mockup status | Flag |
|---|---|---|---|---|
| Codex browse/search (`#home-screen`) | Lexicum `index.html:699` | Codex · list/grid | Implemented (scopes Rules·Cards·All, A–Z dividers) | — |
| Article detail | `:1667` | Codex · term detail | Implemented (drop-cap, related chips, marginalia) | — |
| Card detail | `:1951` | Codex · card detail | **Partial** — mockup card detail = prose only; source has art, stat boxes (mana, thresholds, ATK/DEF, life), rarity, subtypes, sets, flavor, **FAQs** | ⚠️ |
| Home/Library preview (`#my-data-screen`) | `:688` | Home · Overview | Partial (Overview exists) | ⚠️ |
| Dashboard (`#drawers-screen`) | `:722` | Home · Dashboard | Partial (5 of 14 widgets) | ⚠️ (see §5) |

### 2.2 Actions
| Source action | Source loc | Compendium home | Mockup status | Flag |
|---|---|---|---|---|
| Search (debounced), clear | `:3608` | Codex search | Implemented | — |
| Scope Codex/Cards/All | `:3621` | Codex chips (Rules·Cards·All) | Implemented | — |
| **6 search filters** (favOnly, hasNotesOnly, faqOnly, errataOnly, highlights, notes) | `:3327,3755` | Codex · Filters | **Absent** in mockup | ⚠️ |
| List ⇄ Card view (cards) | mockup `s.codexView` | Codex toggle | Implemented | — |
| Collapse/expand result sections | `:3644` | Codex | Absent | ⚠️ |
| Expand article sub-entries inline | `:3654` | Codex | Absent (no sub-entries in mockup) | ⚠️ |
| Open term / card / sub-entry | `:3664` | Codex detail | Implemented (term/card) | — |
| Toggle favourite ★ | `:3785` | Codex detail save/star | Implemented | — |
| **Add to collection** ❧ | `:3788` | Codex detail | Absent | ⚠️ |
| **Text-selection highlight** (+ comment) — articles only | `:3845,2356` | Codex detail | Absent | ⚠️ |
| Edit/delete highlight | `:3806` | Codex detail | Absent | ⚠️ |
| Add marginalia (Note) | `:2117` | Codex detail · composer | **Stub** (`openComposer` unwired) | 🆕 |
| Add marginalia (**Link**: card↔card / card↔article / article↔article) | `:2224` | Codex detail | Absent | ⚠️ |
| Edit/delete note | `:3794` | Codex detail | Absent | ⚠️ |
| Note/link indicator glyph row (★ ✎ ↔ ❧ + blue highlight dot) | `:1417` | Codex list rows | **Partial** — mockup has only a single note dot | ⚠️ |
| "See all" deep-link Library→Codex w/ filter | `:2548` | Home→Codex | Absent | ⚠️ |
| Letter dividers | `:1525` | Codex | Implemented (note: non-interactive in source too) | — |

### 2.3 Persisted data (per-profile IndexedDB, `DB_VERSION 7`, keyPath `id`)
| Store | Schema (abridged) | Compendium owner |
|---|---|---|
| `favorites` | `{id, targetType:article\|subentry\|card, targetId, targetTitle, createdAt}` | profile · saved |
| `notes` | `{id, targetType, targetId, targetTitle, category:"note", body, createdAt, updatedAt}` | profile · marginalia |
| `highlights` | `{id, targetType, targetId, targetTitle, text, comment, createdAt}` | profile · marginalia ⚠️ |
| `collections` | `{id, name, createdAt}` | profile · collections ⚠️ |
| `collection_items` | `{id, collectionId, targetType, targetId, targetTitle, addedAt}` | profile · collections ⚠️ |
| `interactions` (card↔card) | `{id, cardA, cardB, description, …}` | profile · links ⚠️ |
| `card_article_links` | `{id, cardName, articleId, …}` | profile · links ⚠️ |
| `article_links` | `{id, fromId, toId, …}` | profile · links ⚠️ |
| `dashboard_blocks` | `{id, type, width, config, order, createdAt}` | profile · dashboard |
| `dashboard_layouts` | `{id, name, blocks[], savedAt}` | profile · dashboard (saved layouts) ⚠️ |
| catalog JSON (read-only) | `cards.json` 1104, `articles_normalized.json` 210 (+subentries), `link_graph.json` 678, `faqs.json` 734 | shared `catalog/` |
| localStorage | `lexicum-profiles-v1`, `lexicum-onboarded`, `lexicum-active-dash::<db>`, `lexicum-resume::<profile>` | profile/app singletons |

> **FK risk:** all `targetId`/`cardName`/`articleId` are **denormalized strings**, not enforced refs — a catalog rename silently orphans user data. Migration must preserve exact id/name strings or re-key. **(Decision D2.)**

---

## 3. DECKS  ← Arcanum

### 3.1 Screens
| Source screen | Source loc | Compendium home | Mockup status | Flag |
|---|---|---|---|---|
| Deck Library (`#page-library`) | Arcanum `index.html:710` | Decks · library | Implemented (art, archetype, threshold pips, record) | — |
| My Deck — List panel | `:725` | Decks · detail · Cards | **Partial** — mockup groups by type; source has **3 zones** Spellbook/Atlas/Collection | ⚠️ |
| My Deck — Stats panel | `:737` | Decks · detail · Stats | **Partial** — mockup = counts + 1 mana curve; source has 6 stat viz | ⚠️ |
| Search / Card Codex (`#page-search`) | `:754` | Decks · Add cards (scoped) | Partial | ⚠️ |
| Card detail sheet | `:898` | Decks · card sheet | Partial (no per-zone steppers in mockup) | ⚠️ |

### 3.2 Actions
| Source action | Source loc | Compendium home | Mockup status | Flag |
|---|---|---|---|---|
| Open deck | `:1907` | Decks detail | Implemented | — |
| New Deck (name + **pick avatar**) | onboarding `:845` | Decks · new | **Stub** (FAB no-op) — **no avatar concept in mockup deck** | 🆕 / ⚠️ |
| Import Deck (Curiosa URL) | `:1569` | Decks · import | Absent | ⚠️ |
| Bulk Import (Markdown) | `:1724` | Decks · import | Absent | ⚠️ |
| Long-press drag reorder library | `:1521` | Decks library | Absent | ⚠️ |
| Deck search | `:1531` | Decks library | Implemented (search bar) | — |
| Cards ⇄ Stats tab | mockup `deckTab` | Decks detail tabs | Implemented | — |
| Edit Deck → scoped add | `enterAddMode` | Decks · add cards | Implemented (pinned header, live count) | — |
| **Zone targeting** (Spellbook vs Atlas vs Collection) on add | `:3576,3610` | Decks · add cards | **Absent** — mockup add is single flat list | ⚠️ |
| Qty steppers +/− | `:3610` | Decks add (list view) | Implemented | — |
| Card view (2-up, art, qty chip) | mockup | Decks add | Implemented | — |
| **Rarity copy limits** (4/3/2/1), collection max, unlimited-copy, Pathfinder/Dragonlord/Spellslinger rules | `models.py:30`, `:2874,3585` | Decks add (validation) | Absent | ⚠️ |
| Filters: Element(+**Multi**), Type, **Rarity**, **Set**, per-element **Threshold w/ op-cycle**, **Total threshold**, **Total mana**, **Artist** | `:959` | Decks · filter sheet | **Partial** — mockup has element + type only | ⚠️ |
| Sort: **multi-key** (Name, Mana, **Element**, **Threshold**) w/ direction | `:3927` | Decks · sort | **Partial** — mockup: name / mana↑ / mana↓ single | ⚠️ |
| Random Hand draw/redraw; Draw spell/site | `:2933` | Decks detail | Absent | ⚠️ |
| Per-deck Notes | `:2981` | Decks detail | Absent | ⚠️ |
| Per-deck Curiosa URL | `:3022` | Decks detail | Absent | ⚠️ |
| Deck Log / history (cap 200) | `:3065` | Decks detail | Absent | ⚠️ |
| Match Record W/L steppers | `:3561` | Decks · Stats | **Partial** — mockup shows record string, not editable | ⚠️ |
| Deck FAB: Favourite, Rarity-colours, **Deck Spread** (full-art grid), Rename, Duplicate, Export, **Share as image**, Clear log, Delete | `:793` | Decks detail actions | Absent (mockup: only "Edit Deck" chip) | ⚠️ |
| Export (Arcanum MD / Curiosa) | `:3200` | Decks · export | Absent | ⚠️ |

### 3.3 Persisted data (IndexedDB `arcanum` / store `decks`, keyPath `slug`)
```
Deck: { slug, name, profile, avatar(name)|null, avatarSlug, avatarSubTypes[], coverSlug,
        spellbook[], atlas[], collection[], notes, wins, losses, curiosaUrl,
        history[{ts,text}] (cap 200), starred }
Entry (per zone): { name, quantity, variant_slug, _cost,_elements,_type,_rarity,_thresholds,_attack(*) }
```
`localStorage`: `arc-profiles`, `arc-active-profile`, `libOrder`. Catalog: `cards.bundle.json` (1104) — **same set as Lexicum**.
> Mockup deck model = `{id,name,arch,record,art,elems,spellbook,atlas,coll,keyCards,deckLists:[[cardId,qty]]}` — **no zones, no avatar, no variants, no rarity, no history**. The real model is the target. **(Decision D3: preserve 3 zones + avatar + rarity rules.)**

---

## 4. PLAY  ← Vitarum

### 4.1 Screens
| Source screen | Source loc | Compendium home | Mockup status | Flag |
|---|---|---|---|---|
| Home/Hub | Vitarum `index.html:1113` | Play · hub | **Partial** — mockup hub has New/Quick Match (no-op) + Match History + Recent Duels | 🆕/⚠️ |
| **Life Counter** | `:1178` | Play · match (life counter) | **ABSENT in mockup — port from Vitarum code** | ⚠️ |
| **Match Log** (in-match modal) | `:1330` | Play · match · log | **ABSENT in mockup** (`matchLogData` unused) | ⚠️ |
| Match History "Your Record" | `:1239` | Play · hub (Recent Duels) | Partial (mockup shows digest stats + list) | ⚠️ |
| Avatar Picker (You + Opponent) | `:1154` | Play · new match | Absent | ⚠️ |

### 4.2 Actions
| Source action | Source loc | Compendium home | Mockup status | Flag |
|---|---|---|---|---|
| New Match (profile-gated) | `:1987` | Play · new | **Stub** (no-op) | 🆕 |
| Quick Match | `:2023` | Play · quick | **Stub** (no-op) | 🆕 |
| Return to Match (when live) | `:2026` | Play hub / Home live-strip | Absent (Home has a live-match strip visual) | ⚠️ |
| Tap ±1 zones (top 45% / bottom 55%) | `:2378` | Play · counter | Absent — port | ⚠️ |
| Death's Door (≤0) end-trigger | `:2382` | Play · counter | Absent — port | ⚠️ |
| Roll-for-turn (d20 roll-off, ties reroll) | `:2763` | Play · counter | Absent — port | ⚠️ |
| Standalone dice roller (d4–d20) | `:1309` | Play · counter FAB | Absent — port | ⚠️ |
| Per-player Max Life (1–20) | `:1348` | Play · counter | Absent — port | ⚠️ |
| Tweaks: skin (Gilded/Verdigris/Pewter), film grain, keep-awake, immersive | `:1370` | Settings + Play counter | Absent — port (→ §7 settings) | ⚠️ |
| End Match (record / go-again / reset / exit) | `:1408` | Play · counter | Absent — port | ⚠️ |
| Record opponent (+ autocomplete) | `:1710` | Play · end | Absent | ⚠️ |
| Per-match Note / Edit / **Share snapshot** (canvas) / Delete | `:1614,1553,1629` | Play · history | Absent | ⚠️ |
| Head-to-head filter; Wins-by-Avatar; Record-by-Opponent | `:3212,3338` | Play · history | Absent | ⚠️ |
| **Export / Import history JSON** | `:3397,3436` | Cross-cutting export | Absent (mockup export is profile-level stub) | ⚠️ |
| Player profiles: select/add/rename/delete | `:1525` | Cross-cutting profiles | Maps to Compendium profiles | ⚠️ |

### 4.3 Persisted data (localStorage)
| Key | Schema | Compendium owner |
|---|---|---|
| `vitarum-matches` | `{id, date, profile, playerAvatar, enemyAvatar, playerFinalLife, enemyFinalLife, winner, duration, notes, opponent}` | profile · matches |
| `vitarum-users` | `{id, name, createdAt}` | → Compendium profiles |
| `vitarum-active-user` | string id | app.activeProfileId |
| `vitarum-skin` / `vitarum-grain` / `vitarum-collapse` | strings/obj | profile · settings |
> **Match Log is in-memory only** — never persisted. **(Decision D4: persist match log under Compendium, or keep ephemeral?)** Matches keyed by **profile name string**; opponents are free strings (no opponent entity).

---

## 5. HOME  (new — aggregates all)

| Mockup feature | Backed by | Compendium home | Flag |
|---|---|---|---|
| Overview: resume card | Lexicum `resume` (per-profile) | Home · Overview | Could be cross-pillar resume — 🆕 extension |
| Overview: **live-match strip** | Vitarum active match | Home · Overview | 🆕 cross-pillar |
| Overview: decks rail | Arcanum decks | Home · Overview | 🆕 cross-pillar |
| Overview: notes | Lexicum notes | Home · Overview | — |
| Dashboard widget: **Saved** | Lexicum `favourites` | Home · Dashboard | — |
| Dashboard widget: **Notes** | Lexicum `notes` | Home · Dashboard | — |
| Dashboard widget: **Random Card** | Lexicum `random-card` | Home · Dashboard | — |
| Dashboard widget: **Your Decks** | Arcanum decks | Home · Dashboard | 🆕 cross-pillar |
| Dashboard widget: **Recent Duels** | Vitarum matches | Home · Dashboard | 🆕 cross-pillar |
| Dashboard edit (resize ½/full, remove, add, reorder) | Lexicum dashboard edit | Home · Dashboard | — |
| **9 other Lexicum widget types** (highlights, collections, collection, stats, resume, errata, text, article, card, url-collection, random-article) | Lexicum `BLOCK_TYPES` | Home · Dashboard | ⚠️ not in mockup |
| **Saved named layouts** + config sheets | Lexicum `dashboard_layouts` | Home · Dashboard | ⚠️ not in mockup |

> Lexicum's real dashboard has **14 widget types + saved layouts + per-type config sheets**; the mockup surfaces **5 + edit mode**. **(Decision D5: which widget set ships v1?)**

---

## 6. CROSS-CUTTING

| Capability | Source reality | Compendium home | Mockup status | Flag |
|---|---|---|---|---|
| **Profiles** | 3 non-aligned systems (§0.1) | brand-bar chip → profile sheet | **Partial** — mockup sheet lists/switches; create/rename/delete **unwired** | 🆕/⚠️ |
| **Export / Import** | Lexicum versioned bundle (`export_version:1`, per-store sanitizers); Arcanum deck MD/Curiosa; Vitarum matches JSON | unified self-describing profile export (§4-E) + legacy importers for migration | **Stub** (Export/Import buttons, no logic) | 🆕 |
| **Universal search** | Lexicum: codex+cards; Arcanum: cards; Vitarum: none | adaptive search row, cross-pillar | **Partial** — mockup `buildSearch` spans Codex+Decks+Duels (toy data) | 🆕 |
| **Adaptive FAB** (per-pillar action + count badge) | none (each app has own FABs) | shell | Implemented (mockup) | 🆕 |
| **App shell / 4-pillar nav** | none (3 separate apps) | shell | Implemented | 🆕 |
| **Legacy import wizard** (first-launch, transactional, idempotent, non-destructive) | §4-D requirement | onboarding | **Absent** | 🆕 |

---

## 7. Settings inventory → Compendium `settings.json`

No source app has a Settings *screen*; settings are scattered and mostly session-only. Compendium needs a real settings surface (the mockup has none — 🆕).

| Setting | Source | Default | Persisted today? | Compendium scope |
|---|---|---|---|---|
| Accent metal / numeral skin (Gilded/Verdigris/Pewter) | Vitarum | gilded | yes (`vitarum-skin`) | profile · settings |
| Film grain | Vitarum | on | yes (`vitarum-grain`) | profile · settings |
| Keep screen on | Vitarum | off | no | profile · settings |
| Hide status bar (immersive) | Vitarum | on | no | profile · settings |
| Default/Max life (1–20; start always 20) | Vitarum | 20 | per-match | profile · settings |
| Die type (d4–d20) | Vitarum | d6 | no | profile · settings |
| Haptics on/off | Vitarum (**always on, no toggle**) | on | no | profile · settings 🆕 |
| Rarity colours | Arcanum | off | no | profile · settings |
| Search scope / filters | Lexicum/Arcanum | all / none | **no (session only)** | profile · settings (optional persist) |
| Theme | all (**dark-only today**) | dark | n/a | profile · settings 🆕 |
| Card art: bundled vs CDN + "download all art" | Lexicum (`CardArt`) | bundled | const | app · settings |

---

## 8. Gap summary

### 🆕 Mockup-only / new work (not yet backed by a source feature)
1. **App shell + 4-pillar nav + adaptive FAB** — the entire unification frame (no source equivalent).
2. **Home Overview & Dashboard cross-pillar widgets** — "Your Decks" (Arcanum), "Recent Duels" + live-match strip (Vitarum) aggregated into Lexicum's dashboard. Only possible post-merge.
3. **Universal cross-pillar search** — no source app searches across domains.
4. **Unified profiles + unified export/import + first-launch legacy import wizard** — net-new layer over three incompatible stores.
5. **Settings screen** + **theme** + **haptics toggle** — no source app has these.
6. **Play hub New/Quick Match, marginalia composer** — present visually but **unwired** in the mockup.

### ⚠️ Source-only / not surfaced in the mockup (must add or consciously cut)
- **Codex:** highlights, collections, card↔card / card↔article / article↔article links, FAQs on card detail, 6 search filters, sub-entries, full card stat boxes, multi-glyph indicator row, "download all art."
- **Decks:** **three deck zones** (Spellbook/Atlas/Collection), **deck avatar**, rarity copy-limits + special-avatar rules, rich filters (rarity/set/threshold-ops/total-mana/artist) + multi-key sort, Power Curve / Composition donut / **Atlas Monte-Carlo odds** / Spellbook Odds, Random Hand, per-deck notes/Curiosa-URL/log, Deck Spread, Share-as-image, Rename/Duplicate/Delete, Import (Curiosa/bulk), Export (MD/Curiosa), editable W/L record.
- **Play:** the **entire life counter**, **in-match Match Log**, avatar picker, dice roller, max-life, roll-for-turn, Tweaks, End-Match flow, opponent tracking + head-to-head, Wins-by-Avatar / Record-by-Opponent, per-match Note/Edit/Share-snapshot/Delete, history Export/Import.
- **Home/Dashboard:** 9 more widget types + saved named layouts + config sheets.

---

## 9. Open decisions needed before build (your sign-off)

| # | Decision | Recommendation |
|---|---|---|
| **D1** | **Profile reconciliation.** Three apps, three profile namespaces (Lexicum id / Arcanum name / Vitarum name). On first launch: one merged "Imported" profile, or a guided wizard letting the user fold/keep separate? | Guided wizard (default = match by identical name, else keep separate), per §4-D — non-destructive, idempotent. |
| **D2** | **Catalog identity.** Dedupe Lexicum+Arcanum cards to one catalog; pick the canonical card **id** (name vs slug) and keep article slugs stable so denormalized user FKs don't orphan. | One `catalog/` with `cardId = slug`-stable + `name`; keep a name→id alias map for legacy user data. |
| **D3** | **Deck model fidelity.** Adopt Arcanum's real model (3 zones, avatar, variants, rarity limits, special-avatar rules) — the mockup's flat list is insufficient. | Yes — port the Arcanum model; extend the mockup's add-cards UI with a zone target. |
| **D4** | **Match Log persistence.** Vitarum's log is ephemeral. Persist it per-match under Compendium, or keep in-memory? | Persist (SQLite/filesystem) — enables history depth and matches §4 "back every write." |
| **D5** | **Dashboard widget scope for v1.** Mockup's 5 widgets, or Lexicum's full 14 + saved layouts? | Ship mockup's 5 (incl. the 2 new cross-pillar) for v1; carry the other 9 + saved layouts as fast-follow, data-model-ready. |
| **D6** | **Scope of source-only features for v1.** "Must-not-lose" (handoff §2) is a subset of the full ⚠️ list. Confirm which ⚠️ items are v1 vs fast-follow (e.g. Atlas Monte-Carlo odds, share-as-image, Curiosa import). | Treat §2 spine as v1-mandatory; everything else ⚠️ as fast-follow unless you flag it v1. |
| **D7** | **Native canvas features** (Vitarum share-snapshot, Arcanum deck poster) — reimplement under the unified skin or defer? | Defer to fast-follow; keep data ready. |

---

*Prepared from: `Compendium.dc.html` (code-level read) + full source inventories of Lexicum, Arcanum, Vitarum (cited at file/line in this session). Awaiting sign-off before any code.*
