package com.sadkinglabs.compendium.scanner.session

/**
 * The scanner's session state machine as a PURE reducer (no Android, no coroutines, no I/O), so the
 * recognition/commit contract is provable off-device. This is Phase 2a Step 2's foundation; the
 * bridge/transport and the ViewModel drive it but hold no logic the reducer doesn't define.
 *
 * Model (proposal §3): Searching → Confirming → Result → Committing → AwaitingRemoval → Searching,
 * with Rejected ("Not this card") and RetryableError branches. Key invariants encoded here:
 *   - confirmation is TIME + a minimum OBSERVATION count (not a raw frame streak);
 *   - a Result identity is IMMUTABLE while shown (observations can't change it);
 *   - at most ONE commit is in flight (CommitRequested only acts from Result);
 *   - after a commit the SAME card is suppressed until it leaves the frame (AwaitingRemoval); a
 *     DIFFERENT stable card may advance immediately;
 *   - "Not this card" suppresses that id until the frame clears (no instant relock to it);
 *   - a retryable write failure preserves the Result.
 *
 * "NeedsHelp" (presence-gated "couldn't identify") is deferred to Phase 2b, once a card-present-but-
 * unmatched signal is proven; it is intentionally not modelled yet.
 */

/** Where the card's name text was read. Orientation is EVIDENCE, not a hard class gate
 *  (Phase-2a policy: weighted evidence by default). */
enum class Source { TOP, LEFT_270, RIGHT_90 }

/** A per-frame match candidate from the analyzer. */
data class Candidate(
    val cardId: String,
    val name: String,
    val score: Double,
    val margin: Double,   // runner-up margin
    val source: Source,
)

/** The identity captured at Result time - never mutated while a result is shown. */
data class RecognitionSnapshot(val cardId: String, val name: String, val source: Source)

/** Confirmation + removal tuning, injected so it is device-independent and unit-testable. */
data class ScanConfig(
    val minConfirmMs: Long = 350,
    val minObservations: Int = 3,
    val removalMs: Long = 400,   // the card must be absent this long before it can re-lock
)

sealed interface ScanState {
    /** Nothing confident in view. */
    data object Searching : ScanState
    /** A candidate is being confirmed: same-id observations accumulating over time. */
    data class Confirming(val candidate: Candidate, val sinceMs: Long, val observations: Int) : ScanState
    /** A confirmed, IMMUTABLE result is shown; awaiting the single commit tap (or a reject). */
    data class Result(val snapshot: RecognitionSnapshot) : ScanState
    /** A commit is in flight (one at a time); awaiting the JS acknowledgement. */
    data class Committing(val snapshot: RecognitionSnapshot, val requestId: String) : ScanState
    /** Committed; the same card is suppressed until it leaves the frame for [ScanConfig.removalMs]. */
    data class AwaitingRemoval(val lastCardId: String, val absentSinceMs: Long?) : ScanState
    /** "Not this card": suppress [suppressedId] until the frame clears. */
    data class Rejected(val suppressedId: String, val absentSinceMs: Long?) : ScanState
    /** A retryable write failure; the Result + selections are preserved for retry. */
    data class RetryableError(val snapshot: RecognitionSnapshot, val reason: String) : ScanState
}

sealed interface ScanEvent {
    /** One analysis frame. [candidate] null = no confident match this frame. */
    data class Observed(val candidate: Candidate?, val nowMs: Long) : ScanEvent
    /** The user tapped the single commit action; [requestId] is unique per attempt. */
    data class CommitRequested(val requestId: String) : ScanEvent
    /** JS acknowledged a committed write. */
    data class AckCommitted(val requestId: String) : ScanEvent
    /** JS rejected on domain grounds (e.g. at the copy limit) - return to Result. */
    data class AckRejected(val requestId: String) : ScanEvent
    /** JS write failed retryably - preserve the Result. */
    data class AckRetryable(val requestId: String, val reason: String) : ScanEvent
    /** "Not this card". */
    data object Reject : ScanEvent
    /** "Scan another" / dismiss - resume fresh. */
    data object Dismiss : ScanEvent
}

/** THE reduction. Pure and total: every (state, event) maps to a next state. */
fun reduce(state: ScanState, event: ScanEvent, cfg: ScanConfig = ScanConfig()): ScanState = when (event) {
    is ScanEvent.Observed -> onObserved(state, event, cfg)
    // One mutation in flight: a commit is only accepted from a shown Result.
    is ScanEvent.CommitRequested ->
        if (state is ScanState.Result) ScanState.Committing(state.snapshot, event.requestId) else state
    is ScanEvent.AckCommitted ->
        if (state is ScanState.Committing && state.requestId == event.requestId)
            ScanState.AwaitingRemoval(state.snapshot.cardId, null) else state
    is ScanEvent.AckRejected ->
        if (state is ScanState.Committing && state.requestId == event.requestId)
            ScanState.Result(state.snapshot) else state
    is ScanEvent.AckRetryable ->
        if (state is ScanState.Committing && state.requestId == event.requestId)
            ScanState.RetryableError(state.snapshot, event.reason) else state
    ScanEvent.Reject ->
        if (state is ScanState.Result) ScanState.Rejected(state.snapshot.cardId, null) else state
    ScanEvent.Dismiss -> ScanState.Searching
}

private fun onObserved(state: ScanState, ev: ScanEvent.Observed, cfg: ScanConfig): ScanState {
    val c = ev.candidate
    return when (state) {
        is ScanState.Searching -> if (c != null) ScanState.Confirming(c, ev.nowMs, 1) else state
        is ScanState.Confirming -> when {
            c == null -> ScanState.Searching
            c.cardId == state.candidate.cardId -> {
                val obs = state.observations + 1
                val elapsed = ev.nowMs - state.sinceMs
                if (elapsed >= cfg.minConfirmMs && obs >= cfg.minObservations)
                    ScanState.Result(RecognitionSnapshot(c.cardId, c.name, c.source))
                else state.copy(candidate = c, observations = obs)   // keep sinceMs (clock started at first sighting)
            }
            else -> ScanState.Confirming(c, ev.nowMs, 1)   // a different candidate restarts confirmation
        }
        // Result identity is immutable while shown / writing / awaiting-retry: frames don't change it.
        is ScanState.Result -> state
        is ScanState.Committing -> state
        is ScanState.RetryableError -> state
        is ScanState.AwaitingRemoval -> when {
            c == null -> {
                val since = state.absentSinceMs ?: ev.nowMs
                if (ev.nowMs - since >= cfg.removalMs) ScanState.Searching else state.copy(absentSinceMs = since)
            }
            c.cardId == state.lastCardId -> state.copy(absentSinceMs = null)   // still present -> stay suppressed
            else -> ScanState.Confirming(c, ev.nowMs, 1)                       // a different card may advance now
        }
        is ScanState.Rejected -> when {
            c == null -> {
                val since = state.absentSinceMs ?: ev.nowMs
                if (ev.nowMs - since >= cfg.removalMs) ScanState.Searching else state.copy(absentSinceMs = since)
            }
            c.cardId == state.suppressedId -> state.copy(absentSinceMs = null)  // rejected card still there -> stay suppressed
            else -> ScanState.Confirming(c, ev.nowMs, 1)
        }
    }
}
