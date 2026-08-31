# Compendium — Feature and Capability Matrix

> **Purpose:** define the required product capabilities of Compendium's five pillars and the cross-cutting services that support them. This is a present-tense product contract, not a project history or delivery plan.
>
> **Authority:** `COMPENDIUM_ARCHITECTURE.md` defines boundaries and dependency direction; `COMPENDIUM_DATA_MODEL.md` defines persistence and ownership; this document defines user-visible capability. Source, schemas, tests, and verified builds provide evidence of implementation status.

## Status vocabulary

| Status | Meaning |
|---|---|
| **Implemented** | Present in the current source with an identifiable persistence or interaction path. |
| **Partial** | A usable implementation exists, but part of the required behavior is incomplete or insufficiently verified. |
| **Required** | Part of the product contract but not currently evidenced as implemented. |

Status is evidence, not aspiration. A capability may move to **Implemented** only when its behavior and applicable quality gates have been verified.

---

## 0. Product-wide invariants

1. **Five pillars, one application.** Home, Codex, Collection, Decks, and Play share one shell, profile system, persistence layer, component language, and design system.
2. **Universal profiles.** Every user-created or marked record belongs to exactly one profile. Catalog content is shared and read-only.
3. **Offline-first durability.** SQLite is authoritative on device. The browser uses sql.js with IndexedDB persistence. Transient component state and `localStorage` are not authoritative profile stores.
4. **Collection is first-class.** Owned cards, wanted quantities, card lists, and buildability belong to Collection. They are distinct from the deck `collection` zone and Codex folios.
5. **Decks do not reserve cards.** Buildability compares each deck independently with the ownership ledger.
6. **Images are optional.** Missing art, avatars, and covers must not remove information, actions, or layout stability.
7. **Imports are untrusted.** Profile, deck, collection, and match imports are validated before profile-owned data is committed.
8. **Runtime parity matters.** Browser and Capacitor implementations may use different adapters but must preserve the same domain behavior and ownership rules.

## 1. Pillar ownership

| Pillar | Owns | Primary implementation |
|---|---|---|
| **Home** | Resume, Overview, Dashboard, saved layouts, and cross-pillar summaries | `src/pillars/Home.jsx`, `src/store/homeRepository.js` |
| **Codex** | Rules, cards, FAQs, search/browse, reference reading, saved items, marginalia notes, links, and folios | `src/pillars/Codex*.jsx`, `src/store/codexRepository.js` |
| **Collection** | Owned and wanted cards, per-set quantities, custom/wanted lists, bulk and camera entry, and buildability | `src/pillars/Collection.jsx`, `src/store/ownedRepository.js` |
| **Decks** | Deck library, three-zone construction, validation, analysis, sharing, imports, and exports | `src/pillars/Deck*.jsx`, `src/store/deckRepository.js` |
| **Play** | Match setup, life tracking, in-match log, completed-match journal, history, and match sharing | `src/pillars/Play.jsx`, `src/pillars/LifeCounter.jsx`, `src/store/playRepository.js` |
| **Application shell** | Profiles, universal search, settings, navigation, transfer, runtime adapters, and cross-pillar coordination | `src/App.jsx`, `src/store/profile*.js`, `src/store/searchRepository.js` |

---

## 2. Codex

### 2.1 Capability contract

| Capability | Required behavior | Persistence | Status |
|---|---|---|---|
| Browse reference content | Browse Rules, Cards, and All scopes with stable list and grid presentation | Shared `rules`, `cards`, `faqs`, `link_graph` | **Implemented** |
| Search and refine | Debounced search, clear, structured filters, and deterministic results | Shared catalog plus active-profile marginalia state | **Implemented** |
| Rule/article reading | Structured article and sub-entry content, related references, and navigable internal links | Shared catalog | **Implemented** |
| Card detail | Art or deterministic fallback, rules text, stats, thresholds, rarity, subtype, set/printing data, and FAQs | Shared catalog | **Implemented** |
| Per-printing art | On a card with more than one printing, switch the detail hero art and artist credit between its printings; single-printing cards show no switcher | Shared catalog `variants` | **Implemented** |
| Saved references | Save and remove cards, rules, and supported targets for the active profile | `saved` | **Implemented** |
| Marginalia | Create, edit, and delete profile-owned notes and links on supported reference targets | `notes`, `links` | **Implemented** |
| Reference links | Create and manage supported relationships between cards and articles | `links` | **Implemented** |
| Folios (named reference sets) | Organize saved reference targets into profile-owned folios; always-visible FOLIOS section in Marginalia and an Add to Folio action on every entry | `collections`, `collection_items` (table rename deferred) | **Implemented** |
| Cross-pillar handoff | Open a catalog card from Collection, Decks, Home, or search without duplicating card-detail logic | Shared catalog identifiers | **Implemented** |

### 2.2 Invariants

- Catalog rows never acquire `profile_id`.
- User notes and links always resolve through the active-profile repository boundary.
- Catalog identifiers, not display names, are the durable reference keys.
- Codex folios never represent physical card ownership.

---

## 3. Collection

### 3.1 Capability contract

| Capability | Required behavior | Persistence | Status |
|---|---|---|---|
| Overview | Show owned copies, unique cards, wanted quantities, recent activity, and deck buildability | Derived from `owned_cards`, `card_lists`, decks | **Implemented** |
| My Collection | An **All \| Sets \| Storage** segmented landing. **Sets**: sets-completion landing (tile per set, non-foil completion + foil count) drilling into a per-set card grid. **All**: a single flat grid of every collector item across every set, one tile per printing. Both card surfaces run the SAME refine engine (search + refinement + sort + group) and the SAME selection controller; ALL renders a progressive prefix (first ~100 tiles, grown by a viewport sentinel with an explicit Show-more fallback) so first paint is bounded regardless of catalogue size - presentation only, never the selection or result scope. Both card surfaces also carry an **A-Z jump rail**: drag or tap a letter and, on **release** (a latch, so the drag never fights the grid), the list jumps to it - a big letter pill floats beside the thumb during the scrub, with a haptic tick per letter. It shows only when the order is globally alphabetical by name and ducks otherwise; a jump on ALL grows the prefix to the target first | `owned_cards` + shared `cards`, `useCollectionRefine.js`, `collectionAllModel.js`, `alphabetIndex.js`, `AlphabetRail.jsx`, `CollectionStorage.jsx` | **Implemented** |
| Physical Storage | Every owned collector item is partitioned across exactly one or more physical places, with **Unfiled** as the always-present system place. People create, name, colour, describe, edit and delete Binder / Box / Deck / Other places; deletion returns every copy to Unfiled. The card sheet is the primary filing gesture: one ledger row per place, steppers on named places, and a live Unfiled remainder. Place detail is the list-detail chassis with search, stacked arrange, exact direct moves and scoped bulk filing; its rows are the Lists card row (64px gilt-framed 5:7 thumb, set pill, "N here of M owned") with ONE trailing control - a filed-seal button that opens the destination picker, where Unfiled is itself a destination, so returning a copy is that picker rather than a second button. The place index and the copies count wear the shared Collection sub-header. A card+set with any filed copies is marked by a gold deck-box seal on its Collection tile and in its card sheet. Filing also runs from the card grids: a Collection selection has a **File in…** action that puts every UNFILED copy of the picked cards - both finishes of each, since a tile is card+set and an allocation is card+set+finish - into one chosen place, skipping picks with nothing unfiled and reporting how many were skipped. Codex shows the same locations read-only; profile deletion enumerates named storage places. No deck reservation, capacity, nesting, scanner target or locations in share-text exports | `storage_containers`, `storage_allocations`, `storageDirectory.js`, `CollectionStorage.jsx`, `CollectionCardSheet.jsx` | **Implemented** |
| Storage manual order | On the Storage index, long-press a place under "Your Places" and drag it to arrange them (DESIGN_SYSTEM §5 Manual ordering). **Unfiled is pinned first and is not draggable at all** - it is rendered outside the draggable list, so no drag can reach or displace it, and its `sort_order -1` is never rewritten. The whole arrangement is written to `storage_containers.sort_order` (renumbered from 1) in one profile-scoped transaction inside the collection write lock, and refused unless it names exactly that profile's non-system places, so nothing partial can land; a refusal toasts and the list re-reads. Replaces the condemned "Move earlier / Move later" overflow items, which are gone - the place overflow keeps Edit place and Delete place. Touch/pointer only; no keyboard or screen-reader equivalent | `storage_containers.sort_order`, `storageDirectory.reorderContainers`, `DragReorderList.jsx` (+ `dnd-kit`), `reorderModel.js` | **Implemented** |
| Collection refine (own sheet) | A Collection-specific two-page Refine sheet (`CollectionRefineSheet`), distinct from the deckbuilder's, because browsing a collection asks different questions than building a deck. **Filters:** Ownership (Owned / Missing / Wishlisted - "Owned" = any copy; Wishlisted matches the exact collector item), a **Finish** scope (Standard / Foil) that reframes the ownership/playset/quantity math AND gates catalog availability (a foil-only printing never shows under Standard), **Playset** (Completed / Missing copies / More than a playset, from the rarity limit; avatars are uncapped), Element (+ Multi), Type (incl. Avatars), Rarity, an **Owned-amount** comparator (=/≤/≥), and Artist. No threshold/mana/power comparators (deck criteria). **Arrange:** Group by None / Element / Rarity (sections), and Sort within - Name A→Z / Z→A, Recently updated (`owned_cards` MAX `updated_at`, i.e. collector-record activity - not an acquisition date), Rarity (Ordinary→Unique, then avatars). Catalog axes run through `getPool`; the ownership-derived axes + sort are applied in the pure collection layer (`collectionFilter.js`, `collectionGroups.js`), so the catalog/profile boundary holds | `owned_cards`, shared `cards`, `collectionFilter.js`, `collectionGroups.js`, `playset.js` | **Implemented** |
| Per-item ownership | Record owned copies per collector item — set and finish (Alpha, Beta, and their foils tracked separately); opened from inside a set the sheet is locked to that printing, and the picker appears only at name-level entry points | `owned_cards.variant_slug` | **Implemented** - per collector item (v11); see the granularity note below |
| Ambient adding | No edit mode: every tile and the card sheet carry a permanent stepper, so adding is a property of where you are. Counts are provisional while a write is pending and confirmed when it resolves. A decrease the storage wall will refuse - a target below the copies filed in named places - shows **no provisional count at all**, so the wall never reads as the app undoing the tap; the write is still enqueued and the store still decides, so a stale prediction costs a beat rather than the edit | `owned_cards`, `storage_allocations`, `ownedStepController.js`, `predictGlobalRemovalRefusal` | **Implemented** |
| Wishlist toggle | Wanting a card is binary (a heart); per-card quantity goals live in Wanted lists | `owned_cards.qty_wanted` | **Implemented** |
| Per-printing wants (v11) | A want names its collector item - card + set + finish - so "I need the Beta one" is representable. A reprint with no set context asks; a single-set card resolves without asking; finish defaults to non-foil | `owned_cards.variant_slug`, `wantIntent.js`, `WantPrintingSheet.jsx` | **Implemented** - the heart resolves through `wantTarget` before writing, and `CollectionCardSheet` raises the picker when the choice cannot be made for the user |
| To Be Categorised | Owned copies and migrated wants whose set was never established, resolved by the user. Owned and wanted are asked separately, since owning an Alpha copy while wanting a Beta one is ordinary. Single-set rows are offered for explicit resolution, never applied silently | `owned_cards`, canonicalisation | **Implemented** |
| Card art viewer | Full-screen card display: a finger-tracked 3D tilt (no gyroscope) with a finish-aware holographic foil sheen - foil printings add a color-dodge rainbow layer; non-foil gets tilt + glare only - popping from and back into the card sheet through a phase-driven enter/exit. Deterministic-gradient fallback with a static-sheen reduced-motion path; foil/glare are gated on decoded art so they never ignite over the fallback | catalog art (finish from the active Collection printing) | **Implemented** - full-art viewer only, not a universal foil primitive |
| Back up all data | One checksummed, versioned file covering every profile plus app-global state, restorable on any device. Reads a consistent snapshot: the capture takes a read transaction AND an exclusive write gate, because both backends share one connection so a concurrent write would join the transaction rather than merely race it | whole database, `backupService.js`, `backup.js` | **Implemented** |
| Restore backup (replaces) | A whole-app archive returns the app to that snapshot: existing profiles are removed and the archive's are written, with the archive's Primary and active profile adopted. Deletes, inserts and a `restore_pending` journal row commit in ONE transaction, so a failure changes nothing and a crash after commit is FINISHED at the next boot rather than abandoned. A verified recovery point is taken first and reachable afterwards as "Return to previous state"; where a runtime cannot promise durable storage the action is disabled rather than warned about | whole database, `replacePlan.js`, `recoveryStore.js`, `replacementPolicy.js` | **In progress** |
| Import profile (adds) | A legacy single-profile export is added alongside existing data, deduped by name, created non-Primary and opened. A single-profile file is never authority to delete the rest of the device | `profileTransfer.js`, `backupService.js` | **Implemented** |
| Primary profile role | Exactly one profile is the default, any profile can be given the role, and deleting the holder transfers it in the same transaction. The sole remaining profile cannot be deleted | `profiles.is_default`, `profileRepository.js` | **Implemented** |
| Bulk entry (owned) | Paste card text in an item-grain line grammar (`2 Card [Beta] [Foil]` - quantity, name, optional set and finish annotations), review a resolved preview keyed by collector item, then commit. Annotated single-answer lines file directly; genuinely ambiguous lines fall to review; unrecognised names are listed and skipped. The whole batch is validated against catalog reality and rejected before any write | `owned_cards`, `itemLineGrammar.js`, `ownedImportRepository.js` | **Implemented** |
| Bulk wants (paste) | Paste a want list; a single whole-paste resolver turns it into one draft with one atomic Cancel/Confirm boundary - printings resolve per line, a batch finish governs unannotated lines, unresolved/unknown lines are surfaced and skipped, and nothing is written until Confirm | `owned_cards.qty_wanted`, `wantImport.js`, `batchWantPlan.js`, `wantedBulkRepository.js` | **Implemented** |
| Camera-assisted entry | Scan cards, resolve candidates, and require a deliberate ownership update | `owned_cards` | **Implemented** |
| Bulk selection (scoped) | On EITHER Collection surface - inside a set OR the ALL grid: scope the grid (search/refine), the header **Select** pill enters selection mode and morphs in place into Select all / Deselect all; the docked search bar becomes an action bar of four actions - **Edit copies**, **New list**, **Add to list** (add the selected cards, deduped to card grain, to an existing list; entries already present are skipped) and **File in…** (file every unfiled copy of the picked cards, both finishes, into one storage place - see Physical Storage) - while the running selected + hidden count moves to the header row. **Select all covers the COMPLETE filtered result, never merely the rendered prefix**; the selection is a snapshot keyed `card_id\|set`, so a later filter that hides some picks keeps them selected and shows a hidden-selected count, and Select-all UNIONS into (never replaces) earlier picks. Hardware Back exits selection first; switching Sets/All, leaving Collection, or switching profiles clears it. A payload over 2,000 items is refused whole (never split or partially applied) with the selection kept and a Refine-to-2,000 message; New list dedups printings to card grain before the guard. **File in…** carries the tighter storage cap instead - 500 resolved collector items, refused whole with the picker left open. Edit copies has two modes: **Adjust** (raise or lower each card by N against its present count - Remove floors at 0, never negative; N is a per-request input limit of 999, never a stored-total cap, so a total already above 999 adjusts arithmetically) and **Set** (write an absolute 0..999 count; 0 removes while keeping any wishlist want), each with a Standard/Foil finish. The confirmation reports the authoritative copies moved, not the number requested. Selection captures each printing at pick time; a card lacking the chosen finish is skipped and reported. Each write is one barrier-guarded transaction with a single broadcast | `owned_cards`, `card_lists`, `ownedImportRepository.js` (`adjustOwnedItemsBulk`, `setOwnedItemsBulk`, `createListWithEntries`, `addEntriesToList`), `storageDirectory.js` (`bulkFileFromUnfiled`) | **Implemented** |
| Custom lists | Create, rename, duplicate, populate, export, and delete named card lists | `card_lists`, `card_list_entries` | **Implemented** |
| List arrange | Group a list by **Progress**, Set (printing-faithful), Rarity, or Element with anchored section headers - one grouping level, because grouping sections a view and sorting orders it. **Progress is offered on wanted lists only, where it is also the default**: picking Set, Rarity or Element REPLACES it rather than nesting under it, and Wishlist and custom lists never see the mode. Arrange state is session-global, so a stored Progress arriving at a list that cannot show it resolves to None for that list WITHOUT overwriting the stored choice. **Sort within a group is an ordered STACK**: tap Name / Element / Rarity / Recently added to add a key, tap again to remove, tap order sets priority, and each key flips direction independently, so "Group by Set · Element → Rarity → Name" reads like a binder. Each key declares the direction it starts in (`sortOptions.js`), so "Recently added" opens newest-first rather than being assumed ascending. Ordering is total: selected keys, then implicit Name ascending, then the row's own identity. Opened from a stacked filter FAB in the refine-sheet language | Session-scoped presentation state (no writes), `collectionGrouping.js` (`effectiveListGroup`) | **Implemented** |
| Wanted lists | Track target quantities and acquisition progress against owned quantities. A wanted list is a shrinking shopping list, so it reads as one: its rows sit in anchored **Missing (N)** / **Complete (N)** sections computed live from the same goal model the rows use, Missing first, an empty section omitted. Membership is live rather than a snapshot - stepping owned copies to the target moves that row across immediately, and a partial (2 of a wanted 4) stays Missing. Export gains a **Whole list \| Missing only** scope, where missing lines carry the REMAINING quantity per card (wanting 4 while owning 2 emits `2 Clairvoyant`) in the same import-compatible `N Name` grammar, so re-exporting for a second marketplace asks only for what is still outstanding. **Add missing to Wishlist** sits in the list overflow and keeps the v11 honest-reprint contract: a card with several printings is reported unresolved, never guessed. Progress stays computed and is never stored. The shared missing sheet is now decks-only; the lists index still shows each list's progress bar, and its View missing button opens the list, which already leads with Missing | `card_lists`, `card_list_entries`, `owned_cards`, `listGoalModel.js` (`goalRowState`, `missingGoalLines`), `ownedRepository.js` (`exportMissingListText`, `addMissingToWishlist`, `listProgressBulk`) | **Implemented** |
| Deck buildability | Report completeness and per-card shortfalls without reserving inventory | Derived from `owned_cards`, `deck_entries` | **Implemented** |

> **Ownership granularity is per collector item — card + set + finish (schema v11).** Alpha non-foil, Alpha foil, Beta non-foil and Beta foil are four distinct items; the catalog's three finish labels normalise to a binary store (`Standard` → non-foil, `Foil` or `Rainbow` → foil — see `COMPENDIUM_DATA_MODEL.md` §"The collector item"). What is still NOT distinguished is two printings that share one set AND finish: 22 cards have multiple distinct printings within a single set (for example, Avatar of Fire has two Alpha printings; Sorcerer has three Promotional printings), which collapse to one item and show one representative art per set — a known, documented limitation. Deck-building and play are unaffected, since they compare by card rather than printing.

### 3.2 Invariants

- Token cards are excluded from collectible ownership totals.
- Ownership is a ledger, not an allocation system.
- `owned_cards` is separate from the deck `collection` zone.
- `card_lists` is separate from Codex folios.
- Quantities cannot become negative, and invalid imports cannot partially mutate the ledger.

---

## 4. Decks

### 4.1 Capability contract

| Capability | Required behavior | Persistence | Status |
|---|---|---|---|
| Deck library | Create, open, search, favorite, rename, duplicate, and delete decks | `decks` | **Implemented** |
| Library manual order | Long-press a deck card and drag it to arrange the Library (DESIGN_SYSTEM §5 Manual ordering). The whole arrangement is written to `decks.lib_order` in one transaction and refused unless it names exactly the profile's decks, so a search-filtered list can never renumber the matches and demote what it hid - the gesture is disabled while the Library search has text for the same reason. Favourites outrank `lib_order` in the query, so the Library is SECTIONED - "Favourites" and "My Decks", each headed by the section rubric with its count, each shown only when it has rows (owner ruling 2026-08-21, replacing an invisible clamp inside one flat list). Each section drags independently and a drop is mapped back into the global order, so a deck can never be dragged across the boundary and the write refuses any arrangement the query could not reproduce. Touch/pointer only; no keyboard or screen-reader equivalent | `decks.lib_order`, `deckRepository.reorderDecks`, `DragReorderList.jsx` (+ `dnd-kit`), `reorderModel.js`, `librarySections.js` | **Implemented** |
| Deck identity | Store name, archetype, avatar, cover, notes, SorceryTCG URL, record, and favorite state | `decks` | **Implemented** |
| Three-zone model | Maintain Spellbook, Atlas, and Collection entries independently | `deck_entries.zone` | **Implemented** |
| Scoped editing | Every add/remove action identifies the open deck and target zone | `deck_entries` | **Implemented** |
| Quantity and legality rules | Enforce copy limits, zone constraints, avatar rules, and supported exceptions from catalog data | Catalog + deck validation | **Implemented** |
| Search and refinement | Search catalog cards and refine by supported card properties while editing | Shared catalog | **Implemented** |
| Card presentation | Provide list and card views with quantities, art fallback, and shared card detail | Shared catalog + `deck_entries` | **Implemented** |
| Deck analysis | Show mana curve, composition, power curve, Spellbook odds, Atlas analysis, match record, and buildability | Derived from deck, match, and ownership data | **Implemented** |
| Play tools | Draw/redraw a hand and draw supported zone cards without mutating the saved deck | Derived transient state | **Implemented** |
| Deck notes and history | Persist notes, SorceryTCG URL, and bounded change history | `decks`, `deck_history` | **Implemented** |
| Import | Import SorceryTCG URLs and supported text formats; preserve unresolved entries visibly | `decks`, `deck_entries` | **Implemented** |
| SorceryTCG re-sync | Re-poll a deck's saved SorceryTCG URL, show an add/remove/quantity/avatar/name diff, and apply the confirmed one-way sync in one transaction with a deck-log entry; the name follows SorceryTCG (profile-unique dedup); the remote Maybeboard maintains a managed block in the deck's notes, and user notes outside the block are never modified | `deck_entries`, `decks`, `deck_history` | **Implemented** |
| Export and sharing | Produce readable and SorceryTCG-compatible text plus supported deck sharing formats | Derived from deck data | **Implemented** |
| Deck poster | Generate and share a visual deck summary with graceful art fallback | Derived from deck data | **Implemented** |

### 4.2 Invariants

- Deck and entry access is scoped to the active profile.
- An entry belongs to exactly one deck and one zone.
- Unresolved imported cards remain visible and diagnosable.
- Deck buildability reads Collection ownership but never mutates it.
- Analysis is derived from authoritative deck entries rather than cached presentation state.

---

## 5. Play

### 5.1 Capability contract

| Capability | Required behavior | Persistence | Status |
|---|---|---|---|
| Play hub | Start full or quick matches, resume an ongoing match, and browse match history | `matches`; ongoing snapshot adapter | **Implemented** |
| Match setup | Select player/opponent identities and an optional deck for a full match | Profile, catalog, and deck references | **Implemented** |
| Life counter | Track both players' life with touch controls, haptics, max-life controls, and clear low-life states | Ongoing snapshot (autosaved on background/teardown) until completion | **Implemented** |
| Roll for start | Resolve a roll-off, including ties, without affecting match totals | Transient match state | **Implemented** |
| Dice roller | Support the configured die choices from the counter | Profile settings + transient result | **Implemented** |
| In-match log | Record timestamped life and maximum-life changes with running totals | Ongoing snapshot; `match_log_entries` on completion | **Implemented** |
| Advanced counter band | Optional per-player mana + four element-threshold counters on the divider (Tweaks toggle, default off): one-step horizontal drags with ghost preview, inline hold-to-repeat steppers, floor 0/no cap, opponent-mirrored, roll-resolve ceremony. Table state only - never the match log or history | Ongoing snapshot (optional fields, defaults 0); toggle in profile-scoped localStorage pending schema v12 | **Implemented** |
| Match completion | Record result, duration, final totals, opponent, deck, notes, and log | `matches`, `match_log_entries` | **Implemented** |
| Match journal | Add, inspect, edit, and delete completed matches | `matches`, `match_log_entries` | **Implemented** |
| History analysis | Show record, streaks, opponent summaries, and deck-linked history | Derived from `matches` | **Implemented** |
| Match transfer | Import and share supported match payloads with validation | `matches`, `match_log_entries` | **Implemented** |

### 5.2 Invariants

- Each completed match belongs to exactly one profile.
- Opponents are recorded as match data; they do not create cross-profile ownership.
- Minimizing or backgrounding a match preserves enough state to resume - including across process death (the snapshot is autosaved on background/teardown and reconciled at boot after the active profile resolves) - without fabricating a completed match.
- Recording completion persists the in-match log with the match.
- Quick and full modes share result integrity even when setup depth differs.

---

## 6. Home and Dashboard

### 6.1 Capability contract

| Capability | Required behavior | Persistence | Status |
|---|---|---|---|
| Overview | Present resume context, active match, Collection summary, decks, and recent notes/activity | Derived from active-profile repositories | **Implemented** |
| Resume | Return to the last supported cross-pillar target without crossing profile boundaries | `resume` | **Implemented** |
| Dashboard | Render a configurable grid of cross-pillar and freeform widgets | `dashboard_blocks` | **Implemented** |
| Widget editing | Add, remove, resize, rename/configure, and reorder widgets | `dashboard_blocks` | **Implemented** |
| Saved layouts | Save, load, and delete named Dashboard layouts | `dashboard_layouts` | **Implemented** |
| Widget catalogue | Provide Play, Decks, Codex, Collection, general, and structural widget types | `src/store/homeRepository.js` | **Implemented** |
| Profile isolation | Refresh every aggregate atomically when the active profile changes | Active-profile repository boundary | **Implemented** |

### 6.2 Invariants

- Home aggregates domain data; it does not own or mutate pillar records directly.
- Domain pillars must not depend on Home.
- Widget configuration is profile-owned and cannot expose another profile's targets.
- Empty or unavailable data produces an intentional empty state.

---

## 7. Cross-cutting capabilities

| Capability | Required behavior | Primary implementation | Status |
|---|---|---|---|
| Five-pillar shell | Stable navigation across Home, Codex, Collection, Decks, and Play | `src/App.jsx` | **Implemented** |
| Profiles | Create, rename, switch, and delete profiles with atomic UI reset and isolation | `profileRepository.js`, `src/App.jsx` | **Implemented** |
| Profile transfer | Export and import self-describing, versioned profile bundles with validation and identifier re-keying | `profileTransfer.js`, `importBoundary.js` | **Implemented** - the boundary validates and normalises the bundle in memory before anything is created, rejects bundles stamped newer than this build, and the destination profile is written inside the same transaction as its rows, so a failure leaves no orphan |
| Universal search | Search supported catalog and active-profile domains with grouped results | `searchRepository.js`, `src/App.jsx` | **Implemented** |
| Settings | Persist and apply accessibility, appearance, haptic, and supported play preferences per profile | `playRepository.js`, `src/App.jsx` | **Implemented** — reached from the profile sheet, rendered as a modal over it |
| Release notes | Publish per-build release notes as data, reachable on demand from Credits | `src/content/changelog.js`, `ChangelogModal.jsx`, `src/App.jsx` | **Implemented** |
| Update gate | Show, once, the notes for every build a user missed, stamped app-globally so it survives profile switch and import | `src/store/changelog.js`, `src/App.jsx` | **Implemented** — a fresh install sees the full history, a deliberate alpha choice to revisit at 1.0 (`docs/proposals/changelog-screen.md`) |
| Diagnostics disclosure | Ask once, before anything is sent, what the developer may collect; record `unset`/`granted`/`denied` app-globally on the device | `TelemetryPlugin.kt`, `src/store/telemetry.js`, `TelemetryDisclosure.jsx`, `src/content/telemetry.js` | **Implemented** — measured at 0 bytes transmitted pre-consent (`docs/proposals/telemetry-consent.md`) |
| Diagnostics control | Turn crash reports and open-counts on or off per device, deleting anything still queued | `src/App.jsx` (Settings → PRIVACY), `TelemetryPlugin.kt` | **Implemented** — app-global, not per-profile, and never carried by a profile export |
| Advertising-ID refusal | Never declare or read a cross-app advertising identifier, enforced on the release artifact | `AndroidManifest.xml`, `checkReleaseForbiddenPermissions` in `android/app/build.gradle` | **Implemented** — `assembleRelease` fails if one returns |
| Adaptive actions | Present search, FAB, sheets, and contextual actions only where valid | `src/App.jsx`, shared components | **Implemented** |
| Back behavior | Close the topmost sheet/mode first and preserve Android navigation expectations; Escape is the keyboard twin, routed through the same LIFO consumer stack | `src/App.jsx`, `back.js`, Capacitor App integration | **Implemented** |
| Native-fidelity sheets | One bottom-sheet chassis app-wide: 1:1 full-sheet drag with scroll handoff, interruptible motion, velocity-aware dismissal, rubber banding and a real exit animation, driven by the `vaul` engine; the chassis owns the portal target, the WebView paint contract, hardware back, the keyboard mechanism and an accessible close | `GothicSheet.jsx` (+ `vaul`), `docs/bottom-sheet-spec.md` | **Implemented** — device-verified on Android; iOS values deferred to the port (owner ruling) |
| Native sharing/files | Use Capacitor filesystem/share adapters with browser fallbacks where supported | `src/native.js`, transfer/share modules | **Implemented** |
| Graceful assets | Deterministic fallback art and stable layout when every image is unavailable | `CardArt.jsx`, art utilities, `BUILD.md` test mode | **Implemented** |
| Accessibility | Maintain semantic labels, usable touch targets, contrast controls, font scaling, and reduced motion | Shared components, settings, themes | **Partial** |
| Browser/device parity | Preserve domain behavior across sql.js/IndexedDB and Capacitor/SQLite runtimes | `db.js`, `native.js` | **Partial** |

The two **Partial** capabilities require continuing release-level verification across screens and runtimes; they are not permission to knowingly regress established behavior.

---

## 8. Persistence ownership

| Data class | Tables/store | Owner |
|---|---|---|
| Shared catalog | `cards`, `rules`, `faqs`, `link_graph`, `catalog_meta` | Codex/catalog services; read-only to profiles |
| Profiles | `profiles` plus active-profile singleton | Application shell |
| Collection ownership | `owned_cards` | Collection |
| Collection lists | `card_lists`, `card_list_entries` | Collection |
| Decks | `decks`, `deck_entries`, `deck_history` | Decks |
| Codex personal data | `saved`, `notes`, `collections`, `collection_items` (Folios), `links` | Codex |
| Matches | `matches`, `match_log_entries` | Play |
| Home | `dashboard_blocks`, `dashboard_layouts`, `resume` | Home |
| Settings | `settings` | Application shell and consuming pillars |

Every profile-owned table must be accessed through an active-profile boundary. Child tables without a direct `profile_id` must inherit ownership through a constrained parent relationship and profile-scoped repository query.

---

## 9. Completion rules for capability changes

A capability change is not complete until:

- this matrix and the architecture/data model remain consistent;
- profile ownership and cross-pillar boundaries remain explicit;
- applicable repository, schema, UI, and import/export behavior is tested;
- zero-image behavior remains intentional for affected UI;
- browser and Capacitor implications are evaluated;
- accessibility and error states are reviewed;
- implementation status is supported by evidence rather than assumption.

New discoveries become scoped proposals unless they are necessary to satisfy an already approved capability safely.
