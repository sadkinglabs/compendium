# Proposal: Scanner — dropout-tolerant confirmation

**Classification:** Standard (scanner-internal pure reducer; no schema, no writes, no bridge change).
**Author:** Claude Code (lead). **Reviewer:** Codex. **Approver:** owner. **Status:** Rev 2 —
IMPLEMENTED, for Codex re-confirmation of one design correction. Branch `scanner-phase2a`. Builds on
the shipped pip-strip matcher fix + the frozen `device-capture-v2` corpus (both committed).

**Rev 2 correction (material — please confirm):** Rev 1 proposed the elapsed-gap bound reset a
*same-card* read too. Implementing it took v2 to **0/13**: the v2 corpus was captured under the
`showReadZones` overlay (every-strip OCR), so its within-card reads are 2–2.7s apart — a same-card time
gate false-trips on that cadence. Corrected: **the gap bounds the blank (null) hold ONLY; same-card
reads are never time-gated** (production cadence is sub-second — v1 p50 662ms — and a background stall
is handled by an explicit lifecycle reset at reducer→ViewModel integration, tracked separately). This
also means the v2 *latency* figures are overlay-inflated and not production-representative; v2 remains
valid for recognition identity, not timing.

---

## 1. Problem (evidence-first)

The session reducer confirms a card by requiring `minObservations` (3) same-id matches spanning
`minConfirmMs` (350ms). But the `Confirming` path **resets to `Searching` on a single `null`
(no-confident-match) frame**:

```
is ScanState.Confirming -> stepConfirm(state, c, ev.nowMs, cfg)
    ?: if (c == null) ScanState.Searching else ScanState.Confirming(c, ev.nowMs, 1)
```
`stepConfirm` returns `null` when `c == null`, so one OCR dropout throws away all accumulated
confirmation. This is an internal contradiction: the reducer's own docstring says *"candidate == null
means 'no confident match this frame', NOT proven physical absence — OCR can drop a still-present
card"*, and the **Suppressed** path already honours that (release requires sustained absence: time AND
`minReleaseObservations`). Only the **Confirming** path treats a lone dropout as a reset.

**Why it matters to the user.** OCR dropout is routine on a hand-held card (glare, motion, a blurred
frame). Every dropout mid-confirmation restarts the 3-observation count, so a lock only lands when 3
*clean consecutive* reads happen to align — which is exactly the "I had to line it up just right"
friction the owner reported for sites.

**Measured.** On the frozen `device-capture-v2` corpus (13 real Pixel cases), `Lookout` is a MISS:
its frames are `Lookout(1.0)`, `Lookout(1.0)`, `null`, `null` — two clean reads (obs=2, one short of
3), then a dropout resets to Searching. It locked on-device only because the live stream buffered more
frames than the throttled capture recorded. The replay is the conservative, reproducible witness.

**Context (not part of this change).** This asymmetry surfaced while evaluating a site-name "anchor"
(cut the OCR at the `- An Ordinary/Exceptional Site` type descriptor to isolate the name). The replay
harness caught that the anchor **net-regressed v2 (12→10)** and it was reverted. Root cause of that
regression: **ML Kit does not preserve reading order**, so the single name token can land *after* the
descriptor in the concatenated strip text; a positional cut then discards the only name occurrence.
That confirms the position-agnostic sliding window is correct — and it exposed the confirmation
asymmetry addressed here. The anchor is **not** proposed.

## 2. Goal / non-goals / acceptance

**Goal.** Make `Confirming` tolerate a *bounded* OCR dropout so a still-present card confirms through
brief no-match frames, without weakening the false-lock guard.

**Non-goals.** No change to `minObservations`/`minConfirmMs` (evidence, not confirmation strength, is
the problem). No change to Suppressed/Committing/Result/Saved or any write/bridge/schema surface. No
matcher change. No geometry change.

**Acceptance (measured).** Replay under `RunSpec(NameLevelPolicy)`, both precision 1.00, 0 false-locks:
- `device-capture-v1`: **12/15 → 13/15**. `Valley` (a short site that dropped a frame mid-confirm) now
  locks at 3599ms — a genuine improvement on a production-cadence capture, not a target chased.
  Remaining misses (Shifting Sands, Spire) never get enough reads at all — a framing/OCR issue, not
  confirmation.
- `device-capture-v2`: **stays 12/13**. Frozen `Lookout` has only two matching reads then two blanks
  (`corpus:2`); holding through the blanks still never reaches a third real observation, so it cannot
  lock — and we do **not** rewrite frozen input to force it (Codex Blocker honoured).
- The bounded behaviour is pinned by focused **synthetic** reducer sequences (§5); real-world Lookout
  is a question for a future overlay-off capture.

## 3. Design

Add **elapsed-time-bounded** dropout tolerance to the confirmation state only. A frame count cannot
bound wall-clock (Codex Major: two blanks spanned 2,265ms in the real Lookout capture, and an app
background could stall arbitrarily), so the bound is a measured **elapsed gap since the last real
observation** — not a frame count.

**The threshold, derived from actual analyzer timing.** Present-frame inter-arrival gaps measured
across the frozen corpora: v1 p50 **662ms**, p90 **1536ms**, **max 1944ms**; the real Lookout blank
Codex flagged is **2265ms**. So a legitimate live read can be ~1.9s late, but ~2.3s of silence is a
stall. `ScanConfig` gains **`maxConfirmGapMs: Long = 2000`** — above the observed legitimate cadence
(so real scanning never resets) and below the flagged stale gap (so a true pause does). No `350ms`
assumption anywhere.

**State.** `Confirming` gains `lastObsMs: Long` — the time of the last **real** observation (the first
sighting sets it; a tolerated blank does not move it). `sinceMs` (confirmation clock start) is
unchanged. (Additive field.)

**Transitions** (only the `Confirming` observation path changes):
- **dropout** (`c == null`): if `now - lastObsMs <= maxConfirmGapMs`, **hold** — stay `Confirming`
  unchanged (same `observations`, `sinceMs`, `lastObsMs`). Because `lastObsMs` does not advance, a run
  of blanks grows the gap monotonically until it crosses `maxConfirmGapMs`, at which point the card is
  presumed gone ⇒ `Searching`. The blank hold is bounded by **wall-clock, not frame count** (Codex Major).
- **same card** (`c.cardId == candidate.cardId`): `observations + 1`, `lastObsMs = now`; Result iff
  `now - sinceMs >= minConfirmMs && obs >= minObservations` (unchanged). **Not time-gated** — see below.
- **different card**: reset to `Confirming(c, now, 1, now)`. No cross-card evidence ever accrues (unchanged).

A dropout never increments `observations`, so a lock still requires `minObservations` *real* reads —
only intervening blanks (within the time bound) are forgiven.

**Why same-card is not time-gated.** A same-card gate at 2000ms took v2 to 0/13 (its overlay-captured
reads are 2–2.7s apart). In *production* (overlay off) cadence is sub-second, so a same-card gate would
never fire usefully anyway; its only real job would be to catch a background/foreground pause — and
that is better handled by an **explicit lifecycle reset** (Codex's other offered mechanism): when the
reducer is wired into the ViewModel, `onStop`/pause resets confirmation to `Searching`. That wiring is
a tracked integration step (the reducer is currently exercised only by the replay harness; the live
scanner still uses `StabilityGate`). So the two Codex mechanisms split cleanly: **measured elapsed-time
limit** bounds the blank hold here; **lifecycle reset** bounds the background pause at integration.

The identical bounded shape can later be shared with the Suppressed alternate-confirmation (which
resets its `alternate` on any blank today); this proposal keeps scope to the primary Confirming path
and leaves that as a follow-up so the two can be unified under review rather than diverging.

## 4. Invariants (Constitution §3)

None of the eight data invariants are touched: no catalog/profile boundary, profile isolation,
persistence, schema, transactional-write, zero-image, content-is-data, or cross-runtime surface is in
play — this is scanner-session state only. The reducer's own invariants hold: Result identity
immutability, one-commit-in-flight, suppression semantics, and Dismiss handling are unchanged; only
the Searching→Confirming→Result dropout handling is modified.

## 5. Testing

**New reducer unit tests** (pure, deterministic — these carry the proof, since the frozen replay is
unchanged):
1. **The win** — dropout held: `Lookout@0 → Lookout@500 → null@1000 (held) → Lookout@1500` ⇒ Result
   (obs reaches 3, every gap ≤ `maxConfirmGapMs`). This is the pattern the frozen set couldn't supply.
2. **Blank hold is time-bounded (Codex Major)** — `Lookout@0 → Lookout@500 → null@1000 (held) →
   null@3000` (gap since last real read 2500 > 2000) ⇒ Searching; the tolerance cannot persist past
   the bound. (Same-card continuation is deliberately not gated here — the background pause is the
   lifecycle-reset's job at integration, §3.)
3. **Blank is not evidence** — `observations` and `sinceMs` unchanged across a tolerated blank; a lock
   still needs `minObservations` real reads.
4. **Different card restarts** — a different card mid-confirm resets to that card at obs=1 (precision guard).
5. **Boundary** — time met but obs one short across a blank does **not** lock early.

**Replay baselines.** `FullCatalogBaselineTest` (v1 + v2): **v1 12/15 → 13/15** (Valley), **v2 12/13**
unchanged, both precision 1.00, 0 false-locks. All measured; per-case tables above.

## 6. Risk & Self-Critique

- **False-lock risk:** unchanged. Only `null` is forgiven, and only a bounded number; a *different*
  card still resets, so no two cards ever pool evidence. `minObservations` real reads still required.
- **Stale-evidence risk (Codex Major):** the blank hold is bounded by wall-clock — blanks grow `gap`
  until it crosses `maxConfirmGapMs` ⇒ Searching, so dropout tolerance cannot persist arbitrarily.
  Same-card continuation across a *background* pause is caught by the lifecycle reset at integration
  (§3), not a same-card time gate (which false-trips the overlay-inflated v2 cadence and is moot in
  sub-second production cadence). Nothing is locked during Confirming, so a departed card at worst
  restarts on reappearance.
- **Tuning `maxConfirmGapMs = 2000`:** derived, not guessed — above the measured legitimate cadence
  (v1 max present-frame gap 1944ms) so a real dropout is forgiven, below the flagged stale gap
  (2265ms). Applies to the blank hold only. Raise only with fresh timing evidence, never to hit a target.
- **Alternative rejected — bound by frame count (the Rev-1 flaw):** a count doesn't bound elapsed
  time, so N blanks could span an arbitrary pause. Replaced by the elapsed-gap bound.
- **Alternative rejected — lower `minObservations` 3→2:** cheaper but weakens evidence globally and
  raises false-lock risk far more than forgiving intervening blanks; the corpus's 1.00 precision is
  worth preserving.
- **Alternative rejected — do nothing / ship as-is:** device already locked 14/14 this session, but
  that required careful lineup; the whole point is to remove that dependence, and the fix is small and
  measurable.
- **What could make this wrong:** if real dropout runs routinely exceed ~2s, tolerance won't catch
  them — but then the read cadence itself is the problem (geometry/lighting), not confirmation, and a
  future device capture would show it. The bound is one derived config value, re-measurable.

## 7. Rollout

Behind `ScanConfig` (default on). Measured on the frozen corpus before any device build. When it lands
with the clean confirmation build, flip `GuideGeometry.showReadZones` and `captureCorpus` to `false`
(the pre-merge checklist already tracks `captureCorpus`).

**Hard acceptance condition for the reducer→ViewModel integration (Codex Minor).** This increment is
harness-only; the live scanner still uses `StabilityGate` ([ScannerViewModel.kt:50]), and `onStop()`
today only persists capture ([ScannerActivity.kt:157]). When the reducer replaces `StabilityGate`, the
integration is **not complete** until: (a) a pause/stop **lifecycle reset** clears any in-progress
`Confirming` to `Searching` (so same-card evidence cannot survive a background cycle), and (b) a
background→resume test proves it. Without (a)+(b) the same-card-not-time-gated decision here is unsafe
live. This is a gating item on that checkpoint, not this commit.

**Fail-closed baselines (Codex Suggestion — done).** `FullCatalogBaselineTest` now asserts, per corpus,
`falseLocks == 0`, `correct >= floor` (v1 ≥ 13, v2 ≥ 12), and SPELL recall ≥ 1.0, so a later regression
cannot leave a green gate.
