# Proposal (spec): Card Scanner — Phase 2 (functionality, result sheets, reliability)

**Status:** SPEC / requirements — agreed with the owner in a sheet-by-sheet walkthrough. Not a build
plan yet; implementation follows once Phase 1 (the reveal choreography, branch
`scanner-reveal-redesign`) is device-verified + merged. Phase 2 gets its own branch.
**Author:** Claude Code, from an owner interview.

---

## 1. Principles (owner-decided)

- **One scanner, actions vary by context.** No per-pillar visual morph. The launch mode
  (`universal` / `collection` / `deck`) changes only the sheet's actions + accent, not the look.
- **Result sheet = the `CollectionCardSheet` "trophy" pattern, rebuilt natively:** element-tinted
  glow behind the **card art**, identity (name · set · type · rarity), then context actions. Art in
  the *sheet* is allowed (Codex-sanctioned post-recognition) — loaded from the on-device cache,
  fetched only if online, element-gradient fallback otherwise; it must **never block or error** the
  scan. The recognition **ceremony stays art-free**.
- **Recognition pacing:** a **short deliberate confirm beat** before commit (a brief stability hold),
  so the build/haptic are felt and a wrong candidate is catchable before it locks.

## 2. Result sheets (locked)

Shared trophy layout everywhere; **actions** differ:

### A — Home / universal
- Primary: **Add to Collection** with inline, pre-defaulted **printing chips + Regular/Foil toggle +
  qty** (one tap in the common case; precision when wanted).
- Secondary: **Wishlist**, **View card** (Codex). Exit: **Scan another**, **Not this card**.
- **No add-to-deck** here (deck mode owns it; from Home there's no open deck).
- QR handled as its own sheet (E/F).

### B — Collection mode (build My Collection)
- **Two tiers.** Opens **rich/precise by default**: owned-count readout, set + finish + qty,
  **Add to Collection** (primary), **Wishlist** + **Add to list** (secondary). A **Batch toggle**
  switches to a lean auto-file loop (+1, its set, Regular) with a running **"added: N"** tally + fast
  re-arm; pickers fold away, tap to expand for a card that needs precision.
- **Add-to-list = session target:** pick a target list once (or "My Collection"); every scan files
  there until changed.
- **Owned count** shown live via the acknowledged-write bridge (§4).

### C — Collection, launched from inside a specific list
- **Folds into B** — same sheet, with the session list-target **pre-set** to that list.

### D — Decks mode (add to the open deck) — dead lean
- **Zone picker:** Spellbook·Collection (spell) / Atlas·Collection (site) — these are the deck's
  three zones `['spellbook','atlas','collection']`; "collection" is the deck's maybeboard, NOT the
  owned collection. Defaults to the natural play zone.
- **Qty** stepper **capped by legality** (rarity copy-limit, per deck).
- **Status:** deck legality (*N of limit · M more*) **and** global **owned count** (*in collection
  ×K*) — the user wants to see what they already own while building.
- **No** set/finish (name-level), **no** wishlist/view. Batch-friendly loop.
- Build-time confirm: does the deck **Collection (maybeboard) zone count toward the copy-limit**, or
  is it exempt (sideboard-style)? Verify against `addScannedToDeck`.

### E — shared deck QR · F — shared match QR (any mode)
- **QR recognised in ALL modes** (unambiguous; interrupts the loop only when a real QR is held up).
- **Rich preview before commit:** decode locally and show what's about to import — deck name +
  spell/site counts + avatar (deck), or players/result/date (match) — then Save / Review-import.

## 3. Reliability (owner picked all four) + pacing

1. **Match accuracy** — sites (rotated name text; sliding-window matches grabbing rules text) and
   reprints/false matches. Native OCR + matcher work; the highest-value correctness item.
   - **Class gate by strip orientation (recognition hardening).** *Where* the name text is read is
     itself a class signal: a Sorcery **site** has its name running **vertically up the left/right
     edge**, a **spell** has its name on the **top banner**. So gate the candidate pool by the
     producing strip **before** fuzzy/sliding-window matching:
     - text from the **left/right vertical edge → sites only** (exclude every spell), and
     - text from the **top banner → non-sites (spells) only** (exclude every site).
     This is a hard pre-filter on the match set, not a score tweak, so a wrong-class match is
     impossible regardless of edit distance. It specifically stops descriptor/type/rules words that
     appear on a site's edge — e.g. the literal word **"Site"** — from fuzzy-matching a real spell
     like **"Smite"**, and symmetrically stops a spell's banner text from ever resolving to a site.
     The extractor already knows which strip produced each candidate (`isSite` today); this promotes
     that from a hint into a **binding candidate-pool filter**.
2. **Recovery from wrong match** — the **"Not this card / Scan again"** action on every card sheet
   (already in the sheet spec) + never auto-committing (the confirm beat, below).
3. **Confidence & "couldn't identify"** — a real low-confidence **"Hold steady / checking…"** hold
   and a **"Couldn't identify — adjust angle or lighting"** state. Requires **presence/confidence
   signals the pipeline lacks today** (distinguishing "a card is present but unmatched" from "empty
   frame") — the biggest pipeline change.
4. **Batch throughput** — delivered by B's Batch mode + D's lean loop; fast re-arm, running tally,
   minimal taps.

**Confirm beat:** a brief stability hold before `lockEvent` fires (tunable in `StabilityGate`), so
recognition is *guided and catchable*, not instant. Ties directly to #2 and #3.

## 4. New JS↔native contract pieces (the real architecture work)

- **Native art in the sheet** — hand the matched card's art key (+ the slim manifest) to native so
  the sheet can resolve `Directory.Data/art/<key>` (cache), optionally fetch if online, else the
  element-gradient fallback. Reuses the `artCache` key scheme; must be non-blocking / fail-safe.
- **Acknowledged owned-count bridge** — native requests the owned (and foil) count for the locked
  cardId; JS queries and returns it; after each collection add JS returns the **committed** count.
  This is the "request-ID + committed acknowledgement" path Codex prescribed; it makes the count
  honest and replaces the rejected optimistic increment. Also powers D's "owned ×K".
- **List-target handoff** — pass the profile's custom lists (id + name) to native for the session
  target picker; an add-to-list bridge action.
- **Presence/confidence signal** — the analyzer needs to emit "card-like region present but no
  confident match" to drive the low-confidence + "couldn't identify" states.
- **Zone-aware deck add** — extend the deck-add bridge with the chosen zone (spellbook/atlas/
  collection).

## 5. Proposed build sequence (slices, each independently shippable/reviewable)

1. **Native result sheet** — rebuild the trophy sheet in Compose with native art (cache/fallback) +
   the existing per-mode actions. (Foundation everything else hangs on.)
2. **Confirm beat + recovery** — stability hold before commit + "Not this card" wired. Cheap, high
   perceived-reliability.
3. **Acknowledged owned-count bridge** — the count in Collection + Deck sheets.
4. **Collection sheet full** — set/finish/qty + wishlist + Batch mode + session list-target.
5. **Deck sheet** — zone picker + legality + owned hint (dead lean).
6. **QR rich previews** (deck/match).
7. **Match accuracy** — site OCR + matcher hardening (own slice; most experimental, device-heavy).
   Includes the **class gate by strip orientation** (§3.1) — a cheap, high-value early win within
   this slice, and independently testable against the engine tests (feed edge-text candidates,
   assert no spell can match).
8. **Confidence / "couldn't identify"** — presence signal + states (last; needs #7's learnings).

## 6. Invariants (ENGINEERING_CONSTITUTION §3)

- **Offline-first** — art in the sheet is cache-first, fetch-only-if-online, never blocking; no other
  network. Recognition never awaits the CDN.
- **Zero-image degradation** — every sheet legible with art absent (element-gradient fallback).
- **Catalog/profile boundary & transactional user-data** — all writes stay in JS repositories; the
  count bridge is read + acknowledged-write, native still never writes the DB directly.
- **Durable offline-first writes** — collection/deck/list adds go through the existing atomic
  repository paths.

## 7. Open (owner/Codex) before build
- Confirm the **build sequence / what ships first**.
- Phase 1 must merge first (device-verified + Codex-approved).
- Deck maybeboard-zone legality rule (§2 D).
- Whether match-accuracy (#7) warrants its own spike given it's the least predictable.
