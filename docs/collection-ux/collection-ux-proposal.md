# Collection UX Redesign — Engineering Constitution §8 Proposal

**Status:** Owner-approved on product calls · Codex R1 (3 Majors) + R2 (2 Majors) **addressed** → pending Codex re-review (no `src/**` change until cleared)
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
- **Durability acknowledgement contract (revised per Codex):** counts are **provisional while a write is pending** and become **confirmed** only when the durable write resolves. The UI shows pending state and surfaces a failed write visibly (reconcile-on-error). The kill/reopen guarantee is **"every *confirmed* tap survives"** — *not* "every displayed tap survives immediate process death," which the in-memory promise-chain queue (`collectionWrites.js:33`) cannot honour (a same-row intent queued behind an in-flight write dies with the JS heap if Android kills the process mid-flush). A persistent intent journal is explicitly **out of scope** (over-engineering for a stepper); we adopt the provisional/confirmed contract instead. Proven by the repository integration tests in §8, not by the existing queue tests alone (those prove ordering + profile binding, not the component-to-durable-store contract).
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

1. **Sets-home** *(My Collection view)* **[new]** — a grid of **set plates**, each: set name (Cinzel ≤700), a **completion Ring** (§5) showing uniquely-owned / total-collectible, and a mono count. A total-completion Ring header. **No release date** — see the data note below. Tapping a plate → per-set drill-down. Search pill unchanged **[reuse]**.

   **Data — corrected per Codex.** The original "`ownedBySet()` + `collectionStats()`, no new reads" claim was wrong: `collectionStats()` returns app-wide totals only (`ownedRepository.js:542`), and neither call yields a per-set *denominator* (total collectible cards in a set) or preserves zero-owned sets. The redesign adds a **pure, DOM-free set-completion model** (its own Node test, mirroring the existing extraction pattern):

   ```
   buildSetCompletion(catalogCards, ownedBySet, setCatalog) -> [{ code, name, ownedUnique, totalCollectible, pct }]
   ```
   It must: derive **every** set from `setCatalog` (so a zero-owned set still renders with a 0% Ring, and a newly-added set code appears automatically); count **unique collectible cards per set** as the denominator (multi-set cards counted in each of their sets; **token cards excluded** via `isTokenCard`); count **uniquely-owned** per set from `ownedBySet` (a card owned counts once whether regular and/or foil — **foil-only ownership still counts as owned**); and leave the `''` **Unspecified** bucket out of per-set denominators (it is not a real set). The pillar composes it from the catalog (`getPool`/`card._sets`) + `ownedBySet()` + `SET_LABEL`/`setRank` — a genuinely new read path, not "no new reads."

   **Release dates are removed from this initiative.** The catalog carries **no** release-date field (order is *derived* from the numeric set code; `sets.js`); inventing dates in UI code would violate content-is-data. If a dated plate is ever wanted, it comes through the catalog pipeline as governed catalog data under its own proposal.
2. **Per-set Ledger** **[rework of `LedgerRow`]** — the set's cards, one row each, **permanent rose stepper** (drop the `editMode` gate). Owned-0 rows dim. Toolbar carries an inline **Owned / All / Missing** lens (`SegTabs`) beside the Ledger/Binder view toggle — moved off the stacked FAB.
3. **Per-set Binder** **[rework of `BinderTile`]** — 3-col gilt-framed gradient faces; **debossed empty slot** (the `[Shipping]` ghost-slot pattern: `--surface-well` + inset shadow + dashed hairline) for missing cards. One matte foil "Candidate" flag, never a holo.
4. **Trophy sheet** **[rework of `CollectionCardSheet`]** — un-gate (always editable; drop `view==='cards' && editMode`). Printing `SegTabs`, owned + foil steppers, wishlist star (ruby when on), add-to-list, Open in Codex. Chassis unchanged (`GothicSheet`).
5. **Lists** **[rework of `ListsIndex`]** — three visually-distinct grammars: **Pinned** (Wishlist, star badge) · **Tracked** (`kind='wanted'`, gold progress meter) · **Custom** (`ListFan` fanned thumbs). Parts exist; this is a re-grouping + layout pass.
6. **Coverage + export** **[reuse `ListDetail`/`ExportListSheet`]** — a list *reads* owned (gold checks / ruby "Missing" tags), one gilt "Export N Missing" action, and the clarifying footnote "*this list reads your collection; owned is edited only in Collection*." Mechanism already correct (compareEngine); this is copy + entry-point alignment.

### 4.1 Stepper write controller (DOM-free) — the mechanism behind the §1 durability contract

The provisional/confirmed contract is only prose until a component *owns* confirmed-vs-pending state. It does. New pure module **`src/pillars/ownedStepController.js`** (sibling to `collectionGoalDrain.js`), consumed by the single existing binding **`useOwnedLedger`** (`OwnedControl.jsx`) that every owned stepper (`LedgerRow`, `BinderTile`, `CollectionCardSheet`) already routes through. That hook is the **consumer boundary** — no stepper touches the repository directly.

- **Factory (injected deps, no DB/DOM):** `createOwnedStepController({ read, write, notify, isAlive })`.
- **State:** `{ confirmedQty, pendingDelta, pendingCount, error }`.
- **Displayed quantity:** `max(0, confirmedQty + pendingDelta)` (clamped at zero).
- **On tap:** record a provisional delta (`pendingDelta += ±1`, `pendingCount++`) and enqueue the **profile-bound** repository write on the row-key chain (`enqueueWrite(ownedRowKey(pid,…), write)`).
- **On chain drain (success):** `read` the authoritative qty, replace `confirmedQty`, and clear the settled provisional state.
- **On failure:** perform the same authoritative `read`, restore `confirmedQty`, clear provisional state, and `notify` a visible **"Couldn't save; count restored"**.
- **After disposal/unmount:** the queued write **persists** (fire-and-continue), but no controller state is applied — the `isAlive` guard, identical to `collectionGoalDrain`.

This makes the §8 acceptance cases *executable*: the controller's optimistic-reconcile + unmount + failure-restore behaviour is tested with injected `read`/`write`/`notify` (pure, deterministic), while repository *persistence* is tested separately against in-memory SQLite. Neither half is provable by repository calls alone.

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
- Status flow: `[Candidate]` → `[Proposed Target]` (this proposal) → **owner ruling at approval** → `[Target]` (**Phase 0**: defined, unconsumed) → `[Shipping]` (**Phase 1**: promoted in the *same increment* that lands the `Ring` primitive + its first Collection consumer). Home/Play adoption of the shared Ring stays the separate later track (their instances are untouched now).

### 5.2 Warm-brown chrome family — build the already-approved `[Target]` (OD-2)

The new surfaces consume `--edge-brown` (`#4a3c22`), `--hair-warm` (`rgba(74,60,34,α)`), `--surface-brown` (`rgba(42,33,20,α)`) instead of the mockup's raw literals. Already owner-approved `[Target]`; **Phase 0 defines them in `tokens.css` as `[Target]` (unconsumed); Phase 1 promotes the ones actually consumed to `[Shipping]` in the same increment as the consumer.** Untouched components keep their literals (adoption debt).

### 5.3 No change to
Foil (`[Candidate]`, matte flag), the Exception walls, Cinzel-700 clamp, the stepper palette (reuse the `[Shipping]` rose `Frost` stepper — building the canonical ruby `Stepper` consolidation stays deferred to avoid scope creep).

---

## 6 · Invariant analysis (Constitution §3)

| Invariant | Touched? | How it still holds |
|---|---|---|
| Catalog/profile boundary | No | Reads catalog via `getPool`/`getSets`; writes only profile-scoped `owned_cards`/`card_lists`. Unchanged. |
| Profile isolation | Indirect | Every read/write already carries the profile id (`ownedRowKey(pid,…)`). No new cross-profile path. Verified by existing repo scoping. |
| **Durable offline-first writes** | **Yes** | Permanent steppers fire more writes, all through the *same* `enqueueWrite` → `settleCollectionWrites` queue; no write bypasses it. **Honest boundary:** the queue is in-memory (`collectionWrites.js:33`), so durability is **confirmed-on-resolve, not on-display** — see the §1 acknowledgement contract. Confirmed writes persist across kill/reopen; pending writes are provisional and shown as such. Proven by the §8 repository integration tests. |
| Forward-only schema evolution | No | Schema stays v10. No migration. |
| **Transactional user-data ops** | **Yes** | Owned/list writes stay single-statement upserts/steps on one row-key chain; the optimistic UI reconciles via `collectionGoalDrain` (tested), and a rejected write reconciles **visibly** to the authoritative store. No multi-row op is introduced. |
| **Graceful zero-image degradation** | **Yes** | Set plates + binder use `CardArt`'s deterministic gradient fallback; Ring + counts are vector/text. Manual zero-image gate in §8. |
| Content-is-data | No | No card content authored; card text still data. |
| Cross-runtime integrity | Yes (light) | New surfaces are React/CSS only; must pass the installed Chromium WebView pass (§8), especially the sheet paint rule and the SVG Ring. |

---

## 7 · Phased rollout (ranked; each phase independently shippable + reviewable)

Order = highest leverage first; later phases are progressively lighter.

- **Phase 0 — design-system amendment (docs + token *definitions*, status stays `[Target]`).** Record the Ring promotion + §5 token definitions in `DESIGN_SYSTEM.md`, and define `--ring-track` + the warm-brown family in `tokens.css`. **They remain `[Target]` — no application code consumes them in this increment** (the lifecycle forbids marking a token `[Shipping]` before its adoption evidence lands). Gate: `npm run check:docs` + `npm run build`.
- **Phase 1 — Sets-home + Ring primitive (first consumer) → tokens go `[Shipping]` here.** Build the `Ring` primitive and `SetsHome` (its first consumer) + the `buildSetCompletion` model. **In this same increment**, move `--ring-track` and the warm-brown tokens actually consumed to `[Shipping]` in `DESIGN_SYSTEM.md`. No intermediate commit consumes a `[Target]` token. (Overview untouched.)
- **Phase 2 — Kill edit-mode; permanent steppers + FAB→actions menu.** The reversal (Decision A). Lands the **`ownedStepController`** (§4.1) behind `useOwnedLedger` so every stepper carries confirmed/pending/error state; retires `editMode`/`goAdd` and the stacked FAB. Highest-risk for the write model; gated by the §8 controller + repository tests.
- **Phase 3 — Inline lens toolbar** in the per-set view (off the stacked FAB).
- **Phase 4 — Trophy sheet un-gate.**
- **Phase 5 — Lists three-grammar pass.**
- **Phase 6 — Coverage + export copy.**

Phases 1–2 are the spine; if review wants to stop after either, the pillar is still coherent.

---

## 8 · Verification plan (report exact results; never infer a pass)

**Automated (must pass on the branch):**
- `npm run check:docs` — Phase 0 amendment keeps required files/links/schema valid.
- **`npm run test:ui`** — *explicitly named* because `collectionGoalDrain.test.mjs` lives under `src/pillars/**` and is **not** exercised by `test:query`. This is the suite that guards the write model.
- `npm run test:codex` / `test:query` / `test:app` — the other pure-logic suites (`collectionGroups.test.mjs`, list-goal).
- `npm run check:types` · `npm run build`.

**New automated tests this proposal requires (acceptance bar, not optional):**
- **Set-completion model** (`buildSetCompletion`, deterministic, no DB): multi-set cards counted per set · foil-only rows count as owned · the `''` Unspecified bucket excluded from denominators · **empty (zero-owned) sets retained** at 0% · a newly-introduced set code appears automatically · token cards excluded.
- **`ownedStepController` tests (§4.1, pure — injected `read`/`write`/`notify`/`isAlive`, no DB/DOM):** (a) displayed qty = `max(0, confirmedQty + pendingDelta)` through interleaved taps; (b) a rejected `write` restores `confirmedQty` from the authoritative `read` and emits the visible error; (c) after `isAlive`→false (unmount) the write still fires but **no state is applied**; (d) on drain, `confirmedQty` is replaced from the authoritative read and settled provisional state clears. These are the optimistic-reconcile/unmount cases that **repository calls alone cannot prove**.
- **Repository persistence tests (real repo, in-memory SQLite):** (1) rapid same-row increments/decrements settle to the correct final `owned_cards` qty; (2) concurrent writes to different rows all land; (3) **profile switch mid-pending** does not leak a write across profiles; (4) reload after all writes settle shows the confirmed state.

**Manual (documented gates — a browser pass is not native proof):**
- **Durability pass (Decision A's risk):** rapid stepper taps same-row and across rows; kill/reopen; confirm every **confirmed** tap survived and pending taps were shown as provisional (the §1 contract — *not* "every displayed tap survives kill"). Offline throughout.
- **Zero-image gate:** `localStorage['cx-no-images']` on — set plates, binder, trophy sheet, Ring all legible and correctly laid out.
- **Native/WebView pass (Capacitor Android):** the sheet paint rule on the trophy sheet; the SVG Ring renders (no blend-mode surprises); safe-area + `--kb` on the new surfaces; hardware-back closes sheet/menu before leaving the pillar.
- **Reduced-motion:** Ring shows no sweep (static fill); no new infinite animation.

---

## 9 · Self-critique (required)

- **Biggest risk — the reversal churns a shipped, owner-approved decision.** If the owner still wants the "+Add" toggle, Phase 2 is wrong and the whole spine shifts. *Mitigation:* Decision A is surfaced for explicit re-approval before any code; nothing is built until it lands.
- **Highest-consequence assumption if false:** ~~that the always-live stepper model is fully served by the existing write queue~~ — **corrected (Codex Major 1).** The in-memory queue cannot guarantee "every displayed tap survives process death." We now commit to the weaker, honest **provisional/confirmed** contract (§1) and prove the component-to-store behaviour with the §8 repository integration tests, rather than asserting a durability the architecture doesn't provide. A persistent intent journal is the only way to the stronger guarantee, and it is deliberately out of scope for a stepper.
- **Coupling a design-system amendment to a feature** deviates from "adoption is a separate track." *Justification:* the Ring's first real consumer is this redesign; §7 explicitly wants a shipping consumer + recorded comparison, which this provides. But it does mean a governed doc changes inside a feature branch — Codex should scrutinize the amendment independently of the feature.
- **Single-file pillar.** `Collection.jsx` is ~1400 lines; adding sets-home risks making it worse. *Option:* extract `SetsHome` (and its grouping) into its own module + pure logic file, consistent with the existing extraction pattern — recommended, not mandated here.
- **What I might be over-building:** Phases 3–6 are close to the shipped behaviour; if review judges them cosmetic, they can be deferred without touching the spine.

---

## 10 · Risks & mitigations

- **R1 — lost/dup owned writes** under ambient stepping → durable-data breach. *Mitigation:* the honest §1 provisional/confirmed contract + the six §8 repository integration tests as Phase 2's gate (not the queue tests alone). Pending writes are shown as provisional; failures reconcile visibly.
- **R2 — design-system amendment drifts from governance** (a token marked `[Shipping]` before a consumer lands). *Mitigation:* the corrected Phase 0/1 ordering — Phase 0 defines tokens as `[Target]` (unconsumed); Phase 1 promotes to `[Shipping]` in the *same increment* as the first consumer. No intermediate commit consumes a `[Target]` token.
- **R3 — hidden scope creep into token migration** of untouched components. *Mitigation:* Decision C line held; review-time diff check that only new/rewritten surfaces changed.
- **R4 — WebView regressions** on the new Ring/sheet. *Mitigation:* native pass is a completion gate, not optional; SVG-only Ring avoids blend-mode/backdrop hazards by construction.

---

## 11 · Scope / file surface (indicative; finalized per phase)

- **Docs/tokens:** `DESIGN_SYSTEM.md`, `src/theme/tokens.css`, `docs/collection-ux/**`.
- **Collection:** `src/pillars/Collection.jsx` (+ a new `src/pillars/SetsHome.jsx`), `src/components/CollectionCardViews.jsx`, `src/components/CollectionCardSheet.jsx`, and the Collection FAB wiring.
- **New pure logic (DOM-free + Node test):** the set-completion module (`buildSetCompletion`, e.g. `src/store/setCompletion.js` + `.test.mjs`) and the **stepper write controller** (`src/pillars/ownedStepController.js` + `.test.mjs`, §4.1), both mirroring the existing extraction pattern. `useOwnedLedger` (`OwnedControl.jsx`) becomes the controller's React binding (the sole stepper→store boundary).
- **Shared primitives:** a new `Ring` primitive (`src/components/`), consumed by Collection only for now.
- **Denied without a follow-up proposal:** any other pillar's files, schema, catalog, or token migration of components not listed above.

---

## 12 · Approval record
- **Decision A — APPROVED (owner, 2026-07-20):** adopt the reversal. Permanent steppers, no edit mode — *"add is a place, not a mode, is the whole point of this redesign."* The shipped `collection-redesign` P0 "+Add" toggle is deliberately superseded.
- **Ring promotion — APPROVED (owner):** the completion Ring is to be built; `[Proposed Target]` → `[Target]` sanctioned, with the §5.1 recorded comparison as its promotion evidence. (Owner: *"especially completion ring."*)
- **Decision B — resolved (owner):** Overview kept; sets-home becomes the My Collection view.
- **Decision C — resolved (owner):** new/rewritten surfaces token-clean; new tokens sanctioned (§5).
- **Codex review R1 — Changes required (3 Majors), all addressed in this revision:**
  - *Major 1 (durability):* replaced the false "exactly the taps survive kill" criterion with the honest **provisional/confirmed** contract (§1, §6) + six required **repository integration tests** (§8). Persistent journal ruled out of scope.
  - *Major 2 (sets-home data):* removed invented release dates; added the pure **`buildSetCompletion`** model with its derivation rules + deterministic tests (§4.1, §8, §11). Corrected the false "no new reads" claim.
  - *Major 3 (lifecycle ordering):* split token **definition (Phase 0, stays `[Target]`)** from **promotion to `[Shipping]` (Phase 1, with the first consumer)** (§5.1, §5.2, §7); added `test:ui` explicitly (§8).
- **Codex review R2 — Changes required (2 Majors), both addressed in this revision:**
  - *Major A (stale design reference):* updated `collection-on-system-mockup.html` to match the corrected proposal — removed `.s-date` + every release date, replaced the set-plate completion bars with the **Ring** (SVG arc, per-plate + a total-completion Ring), and corrected the compliance text to identify the Ring + `--ring-track`/warm-brown as approved `[Target]` inputs that become `[Shipping]` on Phase 1 (no "Ring omitted/Candidate" statements remain; only foil is still Candidate).
  - *Major B (unspecified provisional/confirmed mechanism):* specified the DOM-free **`ownedStepController`** (§4.1) — state `{confirmedQty, pendingDelta, pendingCount, error}`, displayed `max(0, confirmedQty+pendingDelta)`, drain→authoritative-read, failure→restore+visible signal, `isAlive` unmount guard — consumed via `useOwnedLedger` (the sole stepper→store boundary). Named it in §7/§8/§11 and split the §8 tests into controller (injected deps) vs repository persistence.
- **Pending Codex re-review** of this revision.
- On Codex clearance → Phase 0 first, then Phase 1–2 (the spine), reviewed before 3–6.
