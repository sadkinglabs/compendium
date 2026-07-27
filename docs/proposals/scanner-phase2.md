# Proposal: Card Scanner — Phase 2 (recognition reliability, honest writes, result sheet)

**Classification:** High-risk (native/plugin contract, profile-owned writes, import parsing, art
infrastructure). **Author:** Claude Code (lead). **Reviewer:** Codex. **Approver:** owner.
**Status:** Rev 3 — **APPROVED for Phase 2a** (Codex, and owner on 2026-07-27) with non-blocking
follow-ups folded in (the read contracts in §4). Split into **Phase 2a** (reliability + honest
collection writes + recovery + manual batch) and **Phase 2b** (deck / QR / native art / presence).
**Step 2 (first code) is gated on the recorded Phase-1 device checklist** (§14 / scanner-reveal-redesign §6).
Uncommitted (working tree on `main`).

---

## 0. Rev history
- **Rev 1** requirements sketch → Codex: promised more certainty than the architecture provides.
- **Rev 2** rewrote to a build plan (JS-sole-art-authority, ack protocol, orientation-as-evidence,
  no auto-write batch, deferred lists, QR plan/apply, reliability-first).
- **Rev 3 (this)** completes the contracts Codex still needed: a destination-typed owned write that
  can represent Uncategorised; an authoritative undo receipt; a zone-aware deck write op; the concrete
  Capacitor bridge transport + lifecycle; a frozen corpus + metrics + performance budgets; the formal
  High-risk headings; and the **2a/2b scope split** (Codex's call, which I adopt).

## 1. Affected systems & invariants (§3 of the Constitution)
- **Native scanner** (`android/.../scanner/*`) — presentation + camera only.
- **`CardScanner` plugin + `ScannerChannel`** — the bridge (new request/respond transport).
- **JS `cardScanner.js` + a new `ScannerSessionCoordinator`** — validation + routing.
- **`ownedRepository.js`, `deckRepository.js`, `deckShare.js`/`matchShare.js`, `artCacheAdapter.js`** —
  new domain ops + a single new art-resolve entry point.
Invariants touched and how they hold: **catalog/profile boundary** (writes are JS-only; profile is
resolved from the JS-owned session, never echoed by native); **profile isolation** (parent-ownership
of deck/list validated in JS); **durable offline-first + transactional user-data** (every mutation is
one atomic repository op returning authoritative counts); **graceful zero-image** (art via JS, no I/O
when disabled); **content-is-data / cross-runtime integrity** (no schema/serialization change, §12);
**forward-only schema** (no migration, §12).

## 2. Goals / non-goals / acceptance criteria
**Goals.** A measured recognition contract; a native result sheet whose writes are authoritative
(never "done" before commit); contextual actions on one scanner; honest failure + wrong-match
recovery; a batch workflow that cannot corrupt collector-item history.
**Non-goals.** Per-pillar visual morph; auto-writing scans; printing-grain Lists (separate prior
proposal); market data; presence/torch/tap-to-focus until device evidence justifies; changing the
maybeboard→copy-limit rule (§10).
**Acceptance criteria (measurable, on the frozen corpus §8):**
- Recognition: report **per-class precision/recall**, **false-lock rate on the negative corpus**, and
  **lock latency p50/p95**, policy ON vs OFF, on the primary **and** one lower-end device. The class
  hard-exclusion ships **only** if it meets the §7 evidence bar; otherwise evidence-weighting ships.
- Writes: no UI success state without a `committed` ack; a killed/failed/duplicate write never advances
  a tally or reduces deck headroom; a profile switch mid-session cannot write the wrong profile; undo
  reverses the **exact** committed mutation once.
- Art: sheet fully usable with art absent/disabled; art arrival ⇒ no layout shift; no native network
  or path derivation (adapter is the only I/O site).
- A11y: recognition announced once, committed success once; targets ≥48dp; sheet scrolls at max font /
  short screen.

## 3. Architecture & session state model
**Ownership split (invariant):** native = presentation + camera lifecycle; JS = catalog truth, art
resolution, all validation, every durable write. Native holds **no** authoritative
collection/deck/list state.
**Immutable session context:** `sessionId`, JS-captured `profileId`, `mode`, `deckId`/`listTarget`,
`reduceMotion`, `imagesDisabled`, `catalogVersion`, **`fontScale`** (the app's `--ui-scale`
preference, handed off like `reduceMotion` and applied to Compose `Density` — Phase-1 checklist #5
found the native scanner honours neither OS font size nor the in-app slider today).
**Session state machine** (pure Kotlin reducer, unit-tested):
```
Searching → Reading → Confirming(candidate, score, margin, source, elapsed)
          → Result(immutable snapshot) → Committing(requestId) → Saved → AwaitingRemoval → Searching
Reading   → NeedsHelp ("couldn't identify")     // presence-gated, Phase 2b, added last
Result    → Rejected("Not this card") → AwaitingRemoval
Committing → RetryableError (Result + selections preserved)
```
Properties: **time-based + minimum-observation** confirmation (not raw `minStreak`); **Result identity
immutable while shown**; **analysis pauses while a Result/write is actionable** (stop the 350ms OCR/QR
loop the VM currently ignores); **"Not this card" suppresses the rejected candidate until the frame
clears**; **a failed write preserves the Result + selections**.

## 4. The bridge — transport, lifecycle, idempotency
Concrete Capacitor transport (this is where idempotency actually lives):
```
Native → JS   plugin event: scannerRequest({ sessionId, requestId, kind, payload })
JS            ScannerSessionCoordinator: resolve session by sessionId (JS-owned), validate, do work
JS → Native   CardScanner.respond({ sessionId, requestId, status, payload })
Native        plugin routes the response to the ACTIVE Activity's reducer inbox
```
**Request kinds** (separated): `readOwnership`, `readCardPresentation`, `readDeckState`, `resolveArt`,
`planDeckShare`, `planMatchShare` (non-mutating) and the mutations `own`, `wishlist`, `deckAdd`,
`applyDeckImport`, `applyMatchImport`, `undo`.
**Lifecycle & rules:**
- JS keeps a **pending** registry (requestId → in-flight promise/context) and a **resolved** registry
  (requestId → the ack that was sent).
- **Duplicate while pending** → ignored (single in-flight per requestId). **Duplicate after resolved**
  → **replay the original ack**, never re-commit.
- **Never trust a `profileId` echoed by native** — resolve it from the JS-owned `sessionId`. A request
  whose `sessionId` is not the live session is answered `stale` and dropped.
- **At most ONE mutation in flight** (native gates; controls disabled while pending). Non-mutating
  reads may overlap.
- **No automatic retry after an uncertain timeout** — reconcile by re-issuing a `readOwnership` /
  deck-count read first, then let the user retry from authoritative state.
- **Teardown:** on terminal close / Activity destroy, native abandons its pending continuation and JS
  clears both registries; **acks arriving after teardown are dropped**. On **WebView reload / lost
  listener**, the coordinator re-inits with a fresh `sessionId`; any pre-reload in-flight work is
  abandoned (its ack is `stale`), and the next user action reads authoritative state before acting.
- **QR plans are opaque JS-owned tokens:** `planDeckShare` returns a presentation DTO **plus a
  `planId`**; native never holds the authoritative plan. `applyDeckImport(planId)` **re-validates /
  re-parses the original payload in JS** before committing — a plan object round-tripped through native
  is never trusted.

## 5. Mutation contracts (JS repository ops)
All are atomic, validate parent ownership + the JS-captured profile, query catalog truth themselves
(never trust native rarity/limit/printing fields), and return **authoritative post-commit counts** and
an **opaque mutation receipt** (`mutationId`) for undo.

**Owned add — destination-typed (represents Uncategorised):**
```
addOwnedFromScan({
  profileId, cardId,
  destination: { kind: 'printing', set, foil } | { kind: 'uncategorised' },
  qty,
}) → { mutationId, itemCount, cardOwnedCount, standardCount, foilCount, uncategorisedCount }
```
`printing` validates the real printing; `uncategorised` files the card-level Uncategorised bucket and
is surfaced **separately** from standard/foil totals. **Wishlist stays a distinct command that requires
a real printing** — it cannot use the uncategorised path.

**Undo — authoritative inverse by receipt:**
```
undoScanMutation({ profileId, sessionId, mutationId })
  → { status, authoritativeCounts }
```
**LIFO** within the session; **idempotent** duplicate undo (a consumed/again-submitted `mutationId`
replays its result, never double-reverses); after **session close** receipts are invalid (undo
unavailable); on undo **failure** the Result + tally are preserved and an inline retry is offered. The
**tally decrements only on the undo ack**.

**Deck add — zone-aware, legality-safe:**
```
addScannedDeckCard({ profileId, deckId, cardId, zone, qty })
  → { mutationId, zoneCount, deckCardCount, copyLimit, maybeboardCount, maybeboardLimit, ownedCount }
```
Validates deck ownership via `profileId`; queries catalog rarity/limit itself; **re-checks copy AND
maybeboard limits inside one serialized/transactional op** (today `changeQty` checks then writes in
separate steps and `addScannedToDeck` takes neither captured profile nor zone); returns a **domain
rejection with authoritative current counts** when a limit is hit; **touches deck history only if the
entry committed**.

### 5.1 Read contracts (non-mutating; Codex follow-ups)
Native must never infer catalog facts. Two JS-owned reads feed the sheets. **`readCardPresentation`
must exist before Step 5** (the precise sheet); **`readDeckState` before Phase 2b** (deck ops):
```
readCardPresentation(cardId) → {
  name, type, rarity, elements,
  printings: [{ setCode, setName, standardAvailable, foilAvailable, standardArtKey?, foilArtKey? }],
  authoritativeOwnership,     // standard / foil / uncategorised, per addOwnedFromScan's shape
}
readDeckState(deckId, cardId) → {
  zones: { spellbook, atlas, collection }, deckCardCount,
  copyLimit, maybeboardCount, maybeboardLimit, ownedCount,
}
```
`readCardPresentation` makes the sheet honest: **foil-only printings default honestly**, **unavailable
finishes are never offered**, native infers no catalog facts, Phase-2b art uses the **selected
printing's** `artKey` (via `resolveNativeArt`), and an unidentified printing carries **no** art key
(so nothing implies a physical printing was recognised). These are bounded additions inside the
approved bridge; they do not block Steps 2–4.

## 6. Art in the sheet — JS-owned, Compose decodes only
Add one call to the existing boundary (`artCacheAdapter.js`):
`resolveNativeArt(key) → { uri: <validated local file uri> } | { unavailable: true }`, running the
existing `artCache` (single-flight, exact-size validation, epoch/clear, quarantine, **zero-image
no-I/O**). Compose **decodes the returned local file and nothing else** — never downloads, validates,
promotes, clears, or derives a path. Display: **fixed trophy-thumbnail slot** (late arrival ⇒ no
layout shift), **decode to display size**, **cancel on result-change/close**, **immediate fallback**
(actions never wait), honour **zero-image + reduced-motion** (incl. any crossfade). Phase 2b,
progressive enhancement.

## 7. Recognition policy (Codex's call: evidence-weighted default)
Default shipping policy = **orientation (`source`: TOP / LEFT_270 / RIGHT_90) as weighted evidence
only** in candidate scoring (source + score + runner-up margin + temporal stability). **Hard class
exclusion is permitted only if the frozen corpus (§8) demonstrates ALL of:** (a) no per-class recall
regression vs policy OFF; (b) **zero** cross-class false locks across the complete negative corpus;
(c) improved or equal overall precision; (d) the result holds on the **primary device and at least one
meaningfully lower-end Android device**. If that evidence is not available, **evidence-weighting ships
and hard exclusion stays deferred.** No arbitrary absolute recall percentage is chosen up front.

## 8. Frozen, versioned corpus + metrics (Phase 2a foundation)
A **frozen, versioned** device corpus with expected identity + negative labels, covering: empty
frames; non-card printed text; similar-name pairs; both site orientations; multi-set reprints;
sleeved/foil/glare; partial title strips; QR-only and QR-near-card frames; same-card
removal/reinsertion sequences. **Metrics tracked:** per-class precision & recall, false-lock rate on
negatives, lock latency p50/p95. A debug-only replay harness drives it. ("Zero site→Smite errors"
alone is too narrow — it is one negative slice of this.)

## 9. Performance budgets (baseline + allowed regression, recorded before 2a completes)
| Metric | Budget |
|---|---|
| Lock latency (p50/p95) | baseline on corpus; regression ceiling to be recorded |
| UI frame jank during reveal / sheet arrival | no dropped-frame regression vs Phase 1 baseline |
| Peak memory during art decode | bounded by decode-to-display-size; ceiling recorded (2b) |
| Analyzer work while a Result is up | **zero** (analysis paused) |
| 50-card batch session | thermal/stability observed; no unbounded growth |

## 10. Deck maybeboard (resolved) & sheets
`deckRepository.totalQty` sums all zones and `changeQty` applies the rarity limit before the separate
maybeboard-cap check — so **the maybeboard already counts toward the copy limit**; kept as-is.
**Sheets** (native trophy, modest thumbnail, progressive disclosure, primary morphs **Add → Saving… →
Added ✓** on the ack): **A Home/universal** (Add to Collection + Wishlist + View; multi-set ⇒ "Printing
not identified"); **B Collection** (+ manual **Batch**: one commit tap per card, **"N added · Undo
last"**, removal gating; **Add-to-list deferred** behind the Lists upgrade); **D Decks** (dead lean:
zone picker, legality-capped qty, shows both deck constraints + owned count); **E/F QR** (rich preview
via §4 plan/apply). A11y/UX: Back dismisses Result then closes; TalkBack single announcements + focus to
heading; scroll at max font/short screen; ≥48dp; "Search by name" after repeated failure.

## 11. Build sequence — Phase 2a then 2b
**Phase 2a (reliability + honest collection + recovery + manual batch):**
1. Phase 1 (merged; device evidence recorded, a11y/RM/layout matrix rolled into 2a — see §14).
2. Pure session reducer + typed request/respond protocol + registries (co-located Kotlin tests).
3. Frozen corpus + debug reliability harness.
4. Candidate scoring, time-based confirmation, rejection, removal gating (evidence-weighted §7).
5. Minimal **art-free** result sheet with honest committed writes (`addOwnedFromScan` + ack).
6. Precise Collection + **manual Batch** + **undo receipts**.
**Phase 2b (independent contracts, after 2a device evidence):**
7. Zone-aware deck ops (`addScannedDeckCard`).
8. QR plan/apply + rich previews.
9. JS-owned native art (progressive enhancement).
10. Presence guidance ("couldn't identify") — only after the signal is proven.
*(Printing-grain Lists upgrade is a separate prior proposal; scanner list-targeting slots in after it.)*

## 12. Migration & compatibility
**No schema migration.** `owned_cards` already carries `variant_slug` (printing + finish) and the
Uncategorised bucket; deck writes use existing `deck_entries` zones; the **mutation receipt is
session-scoped and in-memory** (not persisted), so no table changes. Existing readers are unaffected
(new ops write canonical rows the current readers already understand). Forward-only schema invariant
holds by not touching the schema.

## 13. Rollback & recovery
Each slice is independently revertable (feature-branch per slice; 2a/2b are separable releases). No
persisted state is introduced, so a revert needs no data cleanup. Runtime recovery is built into the
protocol: failed/uncertain writes preserve the Result + selections and reconcile from authoritative
state before any retry; undo reverses committed mutations by receipt.

## 14. Verification matrix
**Automated:** Kotlin unit tests (reducer, source/extraction policy, stability + removal gating,
matcher class policy); JS tests for `addOwnedFromScan` (both destinations), `undoScanMutation`
(LIFO/idempotent/post-close), `addScannedDeckCard` (limit + parent-ownership + transaction), plan/apply
parsers (size bounds + field validation), and bridge ack idempotency/dedupe/stale-drop;
`check:types/cycles/docs`, `build`.
**Device (installed release, naming device/Android/build/WebView):** the corpus recall/precision/
false-lock/latency run on primary + a lower-end device; write-failure + profile-switch + duplicate-ack
+ WebView-reload cases; **the Phase-1 a11y/reduced-motion/short-screen matrix that was not formally
run** (§ scanner-reveal-redesign §6); art absent/disabled/late-arrival (2b); batch 50-card run with
removal gating + undo.

## 15. Documentation impact
| Doc | Impact |
|---|---|
| `COMPENDIUM_DATA_MODEL.md` | `addOwnedFromScan` (incl. uncategorised), `undoScanMutation`, `addScannedDeckCard`, plan/apply import contracts. |
| `COMPENDIUM_ARCHITECTURE.md` | scanner request/respond bridge + registries; native-presentation / JS-truth boundary; `resolveNativeArt`. |
| `DESIGN_SYSTEM.md` | result-sheet trophy/thumbnail, progressive disclosure, batch strip, "Printing not identified", Add→Saving→Added morph. |
| `COMPENDIUM_FEATURE_MATRIX.md` | Camera-assisted entry gains reliability/recovery/batch sub-capabilities. |
| `BUILD.md` | device verification matrix + the frozen corpus + the debug reliability harness. |
| `ENGINEERING_CONSTITUTION.md`, `AGENTS.md` | **Reviewed, no change required** (process/invariants unchanged). |

## 16. Deployment
No new runtime dependency (bundled fonts already landed in Phase 1; art reuses the existing CDN
boundary; no new libraries). Ships as ordinary APK builds; 2a and 2b are separate releasable slices.

## 17. Alternatives & strongest counterproposal
- **Native art cache** — rejected (Blocker 1); `resolveNativeArt` gives the benefit without a second
  authority.
- **Optimistic writes + undo** — rejected; can't show honest state, a failed write still misreports.
- **Strongest counterproposal (adopted as the 2a/2b split):** ship 2a (steps 2–6) as a standalone
  trustworthy release — reliability, honest collection writes, recovery, manual batch — and gate 2b
  (deck/QR/art/presence) on real 2a device evidence. Smallest honest surface first.

## 18. Self-critique
- The class-exclusion win is still **unproven until the corpus runs on two device tiers**; §7 makes the
  default safe (evidence-weighting) so we never ship an unmeasured hard gate, but the "site→Smite" fix
  is not *confirmed* yet.
- The ack + receipt protocol trades snappiness for honesty: every add lands a beat late (WebView SQLite
  round-trip). Deliberate, but the sheet will feel less instant than an optimistic UI.
- `resolveNativeArt` still crosses the process boundary per lock; a busy WebView can lag the thumbnail
  (mitigated by fixed slot + fallback).
- **In-memory session-scoped receipts** mean undo dies on process death mid-session; acceptable (no
  persisted corruption) but a killed app loses "undo last".
- Scope remains large even split; 2a is the honest minimum and 2b is explicitly gated on evidence.
- List-targeting is a cross-feature dependency the scanner can't satisfy alone this phase.

## 19. Owner decisions (resolved)
- **Batch:** never auto-writes — **one commit tap per card** (+ removal gating + undo receipts). ✔
- **Lists:** printing-grain upgrade is a **separate prior** proposal; scanner list-targeting waits. ✔
- **Recognition policy:** **evidence-weighted by default**; hard exclusion only on the §7 corpus bar
  (no arbitrary recall %). ✔ (Codex's call, adopted.)
- **Scope:** ship **2a** (steps 2–6) standalone; **2b** (deck/QR/art/presence) gated on 2a evidence. ✔
