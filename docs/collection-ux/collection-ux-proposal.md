# Collection UX Redesign — Engineering Constitution §8 Proposal

**Status:** Proposed — awaiting owner + Codex review (no `src/**` change until approved)
**Class:** High-risk (core-pillar restructure; touches durable-write, transactional-user-data, profile-isolation, zero-image invariants; carries a governed `DESIGN_SYSTEM.md` amendment)
**Branch:** `collection-ux-redesign` (off `main` @ `05e6ebb`)
**Author:** Claude (lead engineer) · **Reviewer:** Codex (principal/adversarial) · **Authority:** owner
**Design reference:** [`collection-on-system-mockup.html`](./collection-on-system-mockup.html) — six phone screens, built strictly from `[Shipping]` vocabulary
**Grounding:** `DESIGN_SYSTEM.md` (merged `05e6ebb`) · the current-code map in §2 below

---

## 1 · Problem & success criteria

The Collection pillar works but its **information architecture fights the four locked IA principles**. The redesign realigns it. It is *not* a reskin and *not* a rebuild — the audit (below) shows the pillar already implements ~70% of the target. This is a **reconciliation**: restructure navigation around the set, make adding ambient, and consume the newly-governed design system on the surfaces we touch.

**Locked IA principles (owner, this initiative):**
1. **Add-is-a-place-not-a-mode** — adding is a property of *where you are*, never a hidden toggle.
2. **Sets-are-home / completion-is-goal** — the set is the primary object; progress toward complete sets is the reward loop.
3. **One-card-once** — a card appears once per context; printings are chosen in the card sheet, not spread as duplicate rows.
4. **Collection-owns-"have" / lists-own-"want"** — owned counts are edited only in Collection; lists *read* ownership and never write it.

**Success criteria.**
- Every screen the redesign ships is built from `DESIGN_SYSTEM.md` `[Shipping]` vocabulary, plus the specific new tokens this proposal promotes (§5).
- The four IA principles are each satisfiable by pointing at a shipped surface.
- No owned-write is lost, duplicated, or mis-scoped across the more-ambient (always-live) stepper model — proven by the write-queue/goal-drain tests plus a manual durability pass.
- Zero-image mode remains fully legible on every new surface.
- No pillar other than Collection changes appearance; shared primitives change only where this proposal says so.

**Non-goals (explicitly out of scope).**
- App-wide token adoption (replacing literals in *untouched* components) — remains the separate later track per the owner ruling. We author **new/rewritten surfaces token-clean**; we do **not** migrate components we are not rewriting.
- Holographic foil — stays `[Candidate]`, shipped as a matte "Candidate" flag only. No holo/WebGL work.
- Any catalog, schema, or data-model change. Schema stays v10.

---

## 2 · Context — what already ships (this is the delta, not a blank page)

`collection-redesign` P0–P4 **is merged into `main`** (verified: `97e7e0b`, `fc3bf71` are ancestors of `main`; the 7-day-old memory calling it "unmerged" is stale). Today's Collection pillar (`src/pillars/Collection.jsx`, ~1400 lines, single file) already has:

| Mockup screen | Ships today as | Real gap |
|---|---|---|
| 4 · Trophy sheet | `CollectionCardSheet.jsx` — owned/foil/wishlist steppers, printing `SegTabs`, add-to-list, Open in Codex | Gated behind `editMode`; otherwise near-complete |
| 3 · Binder | `BinderTile` + `GILT` frames (`CollectionCardViews.jsx`) | Debossed empty-slot for missing cards |
| 2 · Ledger | `LedgerRow` + per-set collapsible `SetHeader` groups | Lens is a stacked FAB, not inline; edit-mode gated |
| 5 · Lists | `ListsIndex` — pinned virtual Wishlist, `ListFan`, progress | Regroup into Pinned / Tracked / Custom grammars |
| 6 · Coverage+export | `ListDetail` + `ExportListSheet` + `MissingSheet` | Copy/entry-point alignment only |
| 1 · **Sets-home** | **Absent** — sets are collapsible groups *inside* a flat catalog browser, not a completion landing | **The one genuinely new surface** |

Supporting facts that shape the design:
- **Per-set ownership already exists.** `owned_cards.variant_slug` encodes the set (`'001'`, `'001:f'` foil, `''` unspecified). `ownedRepository.js` exposes `ownedBySet()`, `qtyForInSet`, `setOwnedInSet`, `collectionStats()`, `recentlyAdded()`. The sets-home model is a natural re-navigation of data the repo already returns.
- **Pure logic is already extracted** (DOM-free, Node-tested): `collectionGroups.js` (grouping/lens filter), `listGoalModel.js` (progress math), `collectionGoalDrain.js` (optimistic-reconcile race controller), `collectionWrites.js` (per-row serialized write queue), `importPlan.js`.
- **Writes funnel through one queue.** Every stepper tap → `enqueueWrite(ownedRowKey(...), fn)` (`collectionWrites.js`) → `ownedRepository` write → `bump()` → `subscribeCollection` refresh. This is the durability spine the always-live stepper model leans on harder.

---

## 3 · Decisions requiring owner sign-off (before any code)

Per the gate, these are surfaced, not silently resolved. **Decision A is a reversal of a previously-approved shipped decision** and is the crux of the whole proposal.

### A · Kill the "+Add" edit-mode toggle (reverses shipped `collection-redesign` P0)

- **Shipped today:** My Collection is view-first; a **"+Add" toggle** reveals steppers and swaps the FAB into an add-menu (the deck-editor pattern). This was owner-approved in the prior `collection-redesign` chat, *after* explicit feedback that dropped an earlier scope selector.
- **This redesign / IA principle #1:** **no edit mode.** The stepper is permanent on every row; owned-0 rows dim but keep their stepper. Adding is ambient.
- **Why the reversal is proposed:** the owner locked *add-is-a-place-not-a-mode* as an IA principle this initiative, and approved the on-system mockup whose entire thesis is the permanent stepper. The newer decision supersedes the older, but the constitution requires the conflict be named and the reversal explicitly re-approved rather than assumed.
- **Recommendation:** **adopt the reversal** (permanent steppers). It is the single highest-leverage change and the reason the redesign exists.
- **Cost if approved:** removes `editMode`/`goAdd` state and the second stacked FAB's "add mode" role; the FAB becomes a plain actions menu (Scan / Import / New list). The two-FAB `fab-stacked` mechanism (P3) is retired for Collection.

### B · Overview stays; sets-home becomes the "My Collection" view *(owner-answered)*

Keep the 3-chip nav (Overview / My Collection / Lists). **Overview is unchanged** (glance tiles + Recently-Added + buildable-decks). The **"My Collection" view is replaced** by the sets-completion grid (set plates → drill into a per-set ledger/binder), superseding today's flat collapsible-by-set browser.

### C · Token scope: new/rewritten surfaces only *(owner-answered)*

Surfaces we build or rewrite are authored token-clean from `DESIGN_SYSTEM.md`. Untouched components keep their literals as logged adoption debt. **Plus** (owner, this turn): new tokens *are* in scope where the redesign needs them — see §5. The completion Ring is explicitly wanted.

---

## 4 · Design — the six surfaces

Notation: **[reuse]** = existing shipping component, **[rework]** = existing component changed, **[new]** = new surface built token-clean.

1. **Sets-home** *(My Collection view)* **[new]** — a grid of **set plates**, each: set name (Cinzel ≤700), a **completion Ring** (§5) showing owned/total, mono count, release date. A total-completion line/Ring header. Data from `ownedBySet()` + `collectionStats()` (no new reads). Tapping a plate → per-set drill-down. Search pill unchanged **[reuse]**.
2. **Per-set Ledger** **[rework of `LedgerRow`]** — the set's cards, one row each, **permanent rose stepper** (drop the `editMode` gate). Owned-0 rows dim. Toolbar carries an inline **Owned / All / Missing** lens (`SegTabs`) beside the Ledger/Binder view toggle — moved off the stacked FAB.
3. **Per-set Binder** **[rework of `BinderTile`]** — 3-col gilt-framed gradient faces; **debossed empty slot** (the `[Shipping]` ghost-slot pattern: `--surface-well` + inset shadow + dashed hairline) for missing cards. One matte foil "Candidate" flag, never a holo.
4. **Trophy sheet** **[rework of `CollectionCardSheet`]** — un-gate (always editable; drop `view==='cards' && editMode`). Printing `SegTabs`, owned + foil steppers, wishlist star (ruby when on), add-to-list, Open in Codex. Chassis unchanged (`GothicSheet`).
5. **Lists** **[rework of `ListsIndex`]** — three visually-distinct grammars: **Pinned** (Wishlist, star badge) · **Tracked** (`kind='wanted'`, gold progress meter) · **Custom** (`ListFan` fanned thumbs). Parts exist; this is a re-grouping + layout pass.
6. **Coverage + export** **[reuse `ListDetail`/`ExportListSheet`]** — a list *reads* owned (gold checks / ruby "Missing" tags), one gilt "Export N Missing" action, and the clarifying footnote "*this list reads your collection; owned is edited only in Collection*." Mechanism already correct (compareEngine); this is copy + entry-point alignment.

---

## 5 · Design-system amendment (governed — `DESIGN_SYSTEM.md`)

This proposal is the **adoption vehicle** for the specific new tokens its surfaces need. This is a sanctioned deviation from the default "adoption is a separate track," justified because the new primitive's **first real shipping consumer is this redesign** — building it here gives it the recorded comparison *and* a shipping consumer at once, which is exactly what the §7 promotion rule asks for. Owner authorized new tokens this turn.

### 5.1 Completion Ring — promote `[Candidate]` → `[Target]` → build

Per §7 the promotion needs a **recorded comparison**; here it is:

| Criterion | Finding |
|---|---|
| (a) shared semantic role | "fraction of a whole, as an arc" — Home win-rings, Play donut, and now Collection set/total completion. **Consistent role.** |
| (b) states + interaction | static display in all cases (no hover/press state); Collection adds a determinate 0–100% fill. Compatible. |
| (c) accessibility contract | decorative-with-text: the Ring always sits beside a mono `owned/total` figure and `%`; screen readers read the text, Ring is `aria-hidden`. Zero-image safe (vector, no photo). |
| (d) platform / degradation | pure SVG stroke-dashoffset arc; no blend-mode, no `backdrop-filter`, no per-frame animation → clears the §6 WebView rules. Reduced-motion: fill is static (no sweep) or a single decelerate tween with a static fallback. |
| (e) owner disposition | owner explicitly wants it built ("especially completion ring"). |

**New tokens** (defined in `tokens.css`, tagged in `DESIGN_SYSTEM.md`):
- `--ring-track` (unfilled arc, a warm-brown/hairline) and Ring geometry conventions (stroke width, one canonical inner size to end the 44/51/76px divergence). **Fill** is the *contextual accent* (Collection → `--accent-ruby`; Play/Home keep theirs), so no new fill colour is minted.
- Status flow: `[Candidate]` → `[Proposed Target]` (this proposal) → **owner ruling at approval** → `[Target]` → built on the Collection surfaces here → `[Shipping]`. Home/Play adoption of the shared Ring stays the separate later track (their instances are untouched now).

### 5.2 Warm-brown chrome family — build the already-approved `[Target]` (OD-2)

The new surfaces consume `--edge-brown` (`#4a3c22`), `--hair-warm` (`rgba(74,60,34,α)`), `--surface-brown` (`rgba(42,33,20,α)`) instead of the mockup's raw literals. Already owner-approved `[Target]`; this defines them in `tokens.css` and moves them to `[Shipping]` **as consumed by these surfaces only**.

### 5.3 No change to
Foil (`[Candidate]`, matte flag), the Exception walls, Cinzel-700 clamp, the stepper palette (reuse the `[Shipping]` rose `Frost` stepper — building the canonical ruby `Stepper` consolidation stays deferred to avoid scope creep).

---

## 6 · Invariant analysis (Constitution §3)

| Invariant | Touched? | How it still holds |
|---|---|---|
| Catalog/profile boundary | No | Reads catalog via `getPool`/`getSets`; writes only profile-scoped `owned_cards`/`card_lists`. Unchanged. |
| Profile isolation | Indirect | Every read/write already carries the profile id (`ownedRowKey(pid,…)`). No new cross-profile path. Verified by existing repo scoping. |
| **Durable offline-first writes** | **Yes** | Permanent steppers fire more writes, but through the *same* `enqueueWrite` → `settleCollectionWrites` queue. No write bypasses it. Durability pass in §8. |
| Forward-only schema evolution | No | Schema stays v10. No migration. |
| **Transactional user-data ops** | **Yes** | Owned/list writes stay single-statement upserts/steps on one row-key chain; the optimistic UI reconciles via `collectionGoalDrain` (tested). No multi-row op is introduced. |
| **Graceful zero-image degradation** | **Yes** | Set plates + binder use `CardArt`'s deterministic gradient fallback; Ring + counts are vector/text. Manual zero-image gate in §8. |
| Content-is-data | No | No card content authored; card text still data. |
| Cross-runtime integrity | Yes (light) | New surfaces are React/CSS only; must pass the installed Chromium WebView pass (§8), especially the sheet paint rule and the SVG Ring. |

---

## 7 · Phased rollout (ranked; each phase independently shippable + reviewable)

Order = highest leverage first; later phases are progressively lighter.

- **Phase 0 — design-system amendment.** Author the Ring comparison + tokens (§5) in `DESIGN_SYSTEM.md` and `tokens.css`. Docs + tokens only; no behaviour. Gated by its own `check:docs` pass.
- **Phase 1 — Sets-home.** New `SetsHome` as the My Collection view; per-set drill-down container. Ring on plates. (Overview untouched.)
- **Phase 2 — Kill edit-mode; permanent steppers + FAB→actions menu.** The reversal (Decision A). Highest-risk for the write model.
- **Phase 3 — Inline lens toolbar** in the per-set view (off the stacked FAB).
- **Phase 4 — Trophy sheet un-gate.**
- **Phase 5 — Lists three-grammar pass.**
- **Phase 6 — Coverage + export copy.**

Phases 1–2 are the spine; if review wants to stop after either, the pillar is still coherent.

---

## 8 · Verification plan (report exact results; never infer a pass)

**Automated (must pass on the branch):**
- `npm run check:docs` — Phase 0 amendment keeps required files/links/schema valid.
- `npm run test:codex` / `test:query` / `test:app` — includes the pure-logic suites the write model leans on: `collectionGroups.test.mjs`, `collectionGoalDrain.test.mjs`, and any list-goal tests. New pure logic (if any grouping is added for sets-home) gets a Node test in the same pattern.
- `npm run check:types` · `npm run build`.

**Manual (documented gates — a browser pass is not native proof):**
- **Durability pass (Decision A's risk):** rapid repeated stepper taps on the same row and across rows; kill/reopen; confirm `owned_cards` reflects exactly the taps (no lost/dup writes) via the `enqueueWrite` chain. Offline the whole time.
- **Zero-image gate:** `localStorage['cx-no-images']` on — set plates, binder, trophy sheet, Ring all legible and correctly laid out.
- **Native/WebView pass (Capacitor Android):** the sheet paint rule on the trophy sheet; the SVG Ring renders (no blend-mode surprises); safe-area + `--kb` on the new surfaces; hardware-back closes sheet/menu before leaving the pillar.
- **Reduced-motion:** Ring shows no sweep (static fill); no new infinite animation.

---

## 9 · Self-critique (required)

- **Biggest risk — the reversal churns a shipped, owner-approved decision.** If the owner still wants the "+Add" toggle, Phase 2 is wrong and the whole spine shifts. *Mitigation:* Decision A is surfaced for explicit re-approval before any code; nothing is built until it lands.
- **Highest-consequence assumption if false:** that the always-live stepper model is fully served by the existing write queue. If ambient adds expose a race the edit-mode gating masked, we get lost/dup owned writes — a durable-data invariant breach. *Guard:* the durability pass + `collectionGoalDrain` tests are the acceptance bar for Phase 2, not an afterthought.
- **Coupling a design-system amendment to a feature** deviates from "adoption is a separate track." *Justification:* the Ring's first real consumer is this redesign; §7 explicitly wants a shipping consumer + recorded comparison, which this provides. But it does mean a governed doc changes inside a feature branch — Codex should scrutinize the amendment independently of the feature.
- **Single-file pillar.** `Collection.jsx` is ~1400 lines; adding sets-home risks making it worse. *Option:* extract `SetsHome` (and its grouping) into its own module + pure logic file, consistent with the existing extraction pattern — recommended, not mandated here.
- **What I might be over-building:** Phases 3–6 are close to the shipped behaviour; if review judges them cosmetic, they can be deferred without touching the spine.

---

## 10 · Risks & mitigations

- **R1 — lost/dup owned writes** under ambient stepping → durable-data breach. *Mitigation:* §8 durability pass + existing serialized queue/goal-drain tests as Phase 2's gate.
- **R2 — design-system amendment drifts from governance** (a token used as `[Shipping]` before its ruling). *Mitigation:* Phase 0 lands the ruling first; nothing consumes a token still `[Proposed Target]`.
- **R3 — hidden scope creep into token migration** of untouched components. *Mitigation:* Decision C line held; review-time diff check that only new/rewritten surfaces changed.
- **R4 — WebView regressions** on the new Ring/sheet. *Mitigation:* native pass is a completion gate, not optional; SVG-only Ring avoids blend-mode/backdrop hazards by construction.

---

## 11 · Scope / file surface (indicative; finalized per phase)

- **Docs/tokens:** `DESIGN_SYSTEM.md`, `src/theme/tokens.css`, `docs/collection-ux/**`.
- **Collection:** `src/pillars/Collection.jsx` (+ likely a new `src/pillars/SetsHome.jsx` and a pure grouping module + test), `src/components/CollectionCardViews.jsx`, `src/components/CollectionCardSheet.jsx`, and the Collection FAB wiring.
- **Shared primitives:** a new `Ring` primitive (`src/components/`), consumed by Collection only for now.
- **Denied without a follow-up proposal:** any other pillar's files, schema, catalog, or token migration of components not listed above.

---

## 12 · Approval record
- **Decision A — APPROVED (owner, 2026-07-20):** adopt the reversal. Permanent steppers, no edit mode — *"add is a place, not a mode, is the whole point of this redesign."* The shipped `collection-redesign` P0 "+Add" toggle is deliberately superseded.
- **Ring promotion — APPROVED (owner):** the completion Ring is to be built; `[Proposed Target]` → `[Target]` sanctioned, with the §5.1 recorded comparison as its promotion evidence. (Owner: *"especially completion ring."*)
- **Decision B — resolved (owner):** Overview kept; sets-home becomes the My Collection view.
- **Decision C — resolved (owner):** new/rewritten surfaces token-clean; new tokens sanctioned (§5).
- **Pending Codex review** — full proposal, with independent scrutiny of the §5 governance amendment.
- On Codex clearance → Phase 0 first, then Phases 1–2 (the spine), reviewed before 3–6.
