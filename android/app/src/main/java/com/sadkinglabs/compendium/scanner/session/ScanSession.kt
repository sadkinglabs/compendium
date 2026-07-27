package com.sadkinglabs.compendium.scanner.session

/**
 * The scanner's session state machine as a PURE reducer (no Android, no coroutines, no I/O), so the
 * recognition/commit contract is provable off-device (proposal §3, tightened after Codex review).
 *
 * Invariants encoded here:
 *   - confirmation is TIME + a minimum OBSERVATION count (not a raw frame streak);
 *   - a Result identity is IMMUTABLE while shown / committing / awaiting-retry;
 *   - at most ONE commit in flight; a commit only starts from a shown Result;
 *   - a committed write passes through Saved (the "Added ✓" beat, carrying an opaque outcome for
 *     authoritative counts + undo) before rearming;
 *   - after a commit OR a reject the blocked card is SUPPRESSED and only releases when it has cleared
 *     for a full interval (time AND a minimum observation count) OR a DIFFERENT card *completes
 *     confirmation* - a single transient alternate observation never lifts suppression;
 *   - Dismiss ("scan another") cannot rearm while a write is in flight;
 *   - a retryable failure preserves the Result and can be retried with a fresh request id.
 *
 * NOTE: candidate == null means "no confident match this frame", NOT proven physical absence - OCR
 * can drop a still-present card - so release requires sustained absence (time AND observations), and
 * the frozen corpus must include OCR-dropout-while-present sequences. "NeedsHelp" (presence-gated
 * "couldn't identify") is deferred to Phase 2b.
 */

/** Where the card's name text was read. Orientation is EVIDENCE, not a hard class gate. */
enum class Source { TOP, LEFT_270, RIGHT_90 }

/** A per-frame match candidate from the analyzer. */
data class Candidate(
    val cardId: String,
    val name: String,
    val score: Double,
    val margin: Double,
    val source: Source,
)

/** The identity captured at Result time - never mutated while shown. */
data class RecognitionSnapshot(val cardId: String, val name: String, val source: Source)

/** Opaque committed result carried Committing -> Saved for later authoritative counts + mutationId /
 *  undo. The reducer NEVER inspects it. */
interface CommitOutcome

/** Why a card is currently suppressed from re-locking. */
enum class SuppressReason { COMMITTED, REJECTED }

data class ScanConfig(
    val minConfirmMs: Long = 350,
    val minObservations: Int = 3,
    val releaseMs: Long = 400,           // the blocked card must be absent this long to release
    val minReleaseObservations: Int = 3, // ...AND this many absence frames (dropout is not absence)
)

sealed interface ScanState {
    data object Searching : ScanState
    /** Confirming a candidate: same-id observations accumulating over time. Reused as the "alternate"
     *  confirmation carried inside [Suppressed]. */
    data class Confirming(val candidate: Candidate, val sinceMs: Long, val observations: Int) : ScanState
    /** A confirmed, IMMUTABLE result is shown; awaiting the single commit tap (or a reject). */
    data class Result(val snapshot: RecognitionSnapshot) : ScanState
    /** A commit is in flight (one at a time); awaiting the ack. */
    data class Committing(val snapshot: RecognitionSnapshot, val requestId: String) : ScanState
    /** The write committed - the "Added ✓" beat - before rearming; carries the opaque [outcome]. */
    data class Saved(val snapshot: RecognitionSnapshot, val outcome: CommitOutcome) : ScanState
    /** The [blockedId] cannot re-lock until it clears; a different card may take over by confirming. */
    data class Suppressed(
        val blockedId: String,
        val reason: SuppressReason,
        val absentSinceMs: Long?,
        val absentObservations: Int,
        val alternate: Confirming?,
    ) : ScanState
    /** A retryable write failure; the Result is preserved and can be retried (new request id). */
    data class RetryableError(val snapshot: RecognitionSnapshot, val reason: String) : ScanState
}

sealed interface ScanEvent {
    data class Observed(val candidate: Candidate?, val nowMs: Long) : ScanEvent
    data class CommitRequested(val requestId: String) : ScanEvent
    data class AckCommitted(val requestId: String, val outcome: CommitOutcome) : ScanEvent
    data class AckRejected(val requestId: String) : ScanEvent
    data class AckRetryable(val requestId: String, val reason: String) : ScanEvent
    data class AckCancelled(val requestId: String) : ScanEvent
    data class RetryRequested(val requestId: String) : ScanEvent
    /** The "Added ✓" beat finished; rearm into suppression of the just-committed card. */
    data object SavedDisplayed : ScanEvent
    data object Reject : ScanEvent
    data object Dismiss : ScanEvent
}

fun reduce(state: ScanState, event: ScanEvent, cfg: ScanConfig = ScanConfig()): ScanState = when (event) {
    is ScanEvent.Observed -> onObserved(state, event, cfg)
    // A commit only starts from a shown Result -> one in flight.
    is ScanEvent.CommitRequested ->
        if (state is ScanState.Result) ScanState.Committing(state.snapshot, event.requestId) else state
    is ScanEvent.AckCommitted ->
        if (state is ScanState.Committing && state.requestId == event.requestId)
            ScanState.Saved(state.snapshot, event.outcome) else state
    is ScanEvent.AckRejected ->
        if (state is ScanState.Committing && state.requestId == event.requestId)
            ScanState.Result(state.snapshot) else state
    is ScanEvent.AckRetryable ->
        if (state is ScanState.Committing && state.requestId == event.requestId)
            ScanState.RetryableError(state.snapshot, event.reason) else state
    // A cancelled/aborted write did not commit -> back to Result so the user can retry.
    is ScanEvent.AckCancelled ->
        if (state is ScanState.Committing && state.requestId == event.requestId)
            ScanState.Result(state.snapshot) else state
    is ScanEvent.RetryRequested ->
        if (state is ScanState.RetryableError) ScanState.Committing(state.snapshot, event.requestId) else state
    ScanEvent.SavedDisplayed ->
        if (state is ScanState.Saved)
            ScanState.Suppressed(state.snapshot.cardId, SuppressReason.COMMITTED, null, 0, null) else state
    ScanEvent.Reject ->
        if (state is ScanState.Result)
            ScanState.Suppressed(state.snapshot.cardId, SuppressReason.REJECTED, null, 0, null) else state
    // Never rearm while a write is in flight or in its success beat; terminal scanner closure is the
    // Activity's concern, not a reducer rearm.
    ScanEvent.Dismiss ->
        if (state is ScanState.Committing || state is ScanState.Saved) state else ScanState.Searching
}

private fun onObserved(state: ScanState, ev: ScanEvent.Observed, cfg: ScanConfig): ScanState {
    val c = ev.candidate
    return when (state) {
        is ScanState.Searching -> if (c != null) ScanState.Confirming(c, ev.nowMs, 1) else state
        is ScanState.Confirming -> stepConfirm(state, c, ev.nowMs, cfg)
            ?: if (c == null) ScanState.Searching else ScanState.Confirming(c, ev.nowMs, 1)
        // Immutable while a result is shown / writing / saved / awaiting retry.
        is ScanState.Result -> state
        is ScanState.Committing -> state
        is ScanState.Saved -> state
        is ScanState.RetryableError -> state
        is ScanState.Suppressed -> onSuppressedObserved(state, c, ev.nowMs, cfg)
    }
}

/** Advance a confirmation for [c]. Returns a Result once time+observations are met, a continuing
 *  Confirming for the same card, or null when [c] is null / a different card (caller decides). */
private fun stepConfirm(cur: ScanState.Confirming, c: Candidate?, now: Long, cfg: ScanConfig): ScanState? {
    if (c == null || c.cardId != cur.candidate.cardId) return null
    val obs = cur.observations + 1
    return if (now - cur.sinceMs >= cfg.minConfirmMs && obs >= cfg.minObservations)
        ScanState.Result(RecognitionSnapshot(c.cardId, c.name, c.source))
    else cur.copy(candidate = c, observations = obs)   // keep sinceMs (clock started at first sighting)
}

private fun onSuppressedObserved(s: ScanState.Suppressed, c: Candidate?, now: Long, cfg: ScanConfig): ScanState = when {
    // No confident match: accumulate ABSENCE. Release only after sustained time AND observations
    // (a lone dropout frame with the card still present must not release it).
    c == null -> {
        val since = s.absentSinceMs ?: now
        val obs = s.absentObservations + 1
        if (now - since >= cfg.releaseMs && obs >= cfg.minReleaseObservations) ScanState.Searching
        else s.copy(absentSinceMs = since, absentObservations = obs, alternate = null)
    }
    // The blocked card is still here: reset absence + any alternate; stay suppressed.
    c.cardId == s.blockedId -> s.copy(absentSinceMs = null, absentObservations = 0, alternate = null)
    // A DIFFERENT card: it must COMPLETE confirmation to take over (not one transient frame). While it
    // confirms, the blocked card is not "absent" (the guide is occupied), so absence resets.
    else -> {
        val alt = s.alternate
        // First sighting of this alternate = observation 1; a continuing one steps (may reach Result).
        val newAlt: ScanState =
            if (alt == null || alt.candidate.cardId != c.cardId) ScanState.Confirming(c, now, 1)
            else stepConfirm(alt, c, now, cfg)!!   // same card as the alternate -> never null
        when (newAlt) {
            is ScanState.Result -> newAlt                               // alternate won -> release suppression
            else -> s.copy(absentSinceMs = null, absentObservations = 0, alternate = newAlt as ScanState.Confirming)
        }
    }
}
