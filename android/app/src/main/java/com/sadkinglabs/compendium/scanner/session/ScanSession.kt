package com.sadkinglabs.compendium.scanner.session

import com.sadkinglabs.compendium.scanner.model.Source

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
enum class SuppressReason { COMMITTED, REJECTED, DISMISSED }

data class ScanConfig(
    val minConfirmMs: Long = 350,
    val minObservations: Int = 3,
    val releaseMs: Long = 400,           // the blocked card must be absent this long to release
    val minReleaseObservations: Int = 3, // ...AND this many absence frames (dropout is not absence)
    // A confirmation in progress survives a brief OCR dropout: a blank frame holds the count instead
    // of resetting, but only while the wall-clock gap since the last REAL read stays within this bound.
    // Derived from measured analyzer cadence (frozen corpora: present-frame gaps p50 662ms, max 1944ms;
    // a flagged stale blank was 2265ms), so real scanning never resets yet a stall/background does.
    val maxConfirmGapMs: Long = 2000,
)

sealed interface ScanState {
    data object Searching : ScanState
    /** Confirming a candidate: same-id observations accumulating over time. [sinceMs] is the clock
     *  start (first sighting); [lastObsMs] is the last REAL observation, so a tolerated blank (which
     *  does not advance it) lets the gap-since-last-read grow until it trips the stale reset. Reused
     *  as the "alternate" confirmation carried inside [Suppressed]. */
    data class Confirming(val candidate: Candidate, val sinceMs: Long, val observations: Int, val lastObsMs: Long) : ScanState
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
    // "Scan another" / skip. Dismissing a SHOWN card suppresses it (so a still-in-frame card cannot
    // instantly reappear); it can NEVER rearm while a write is in flight/just committed, and NEVER
    // lifts an existing suppression (a late/duplicate dismiss must not relock a blocked card).
    // Terminal scanner closure is the Activity's concern, not a reducer rearm.
    ScanEvent.Dismiss -> when (state) {
        is ScanState.Result -> ScanState.Suppressed(state.snapshot.cardId, SuppressReason.DISMISSED, null, 0, null)
        is ScanState.RetryableError -> ScanState.Suppressed(state.snapshot.cardId, SuppressReason.DISMISSED, null, 0, null)
        is ScanState.Committing, is ScanState.Saved, is ScanState.Suppressed -> state
        else -> ScanState.Searching
    }
}

private fun onObserved(state: ScanState, ev: ScanEvent.Observed, cfg: ScanConfig): ScanState {
    val c = ev.candidate
    return when (state) {
        is ScanState.Searching -> if (c != null) ScanState.Confirming(c, ev.nowMs, 1, ev.nowMs) else state
        is ScanState.Confirming -> onConfirming(state, c, ev.nowMs, cfg)
        // Immutable while a result is shown / writing / saved / awaiting retry.
        is ScanState.Result -> state
        is ScanState.Committing -> state
        is ScanState.Saved -> state
        is ScanState.RetryableError -> state
        is ScanState.Suppressed -> onSuppressedObserved(state, c, ev.nowMs, cfg)
    }
}

/**
 * The primary confirmation step, dropout-tolerant. A still-present card can drop a frame (blank OCR),
 * so a blank HOLDS the accumulated count instead of resetting - but only while the wall-clock gap
 * since the last real read stays within [ScanConfig.maxConfirmGapMs]. A blank does not advance
 * [Confirming.lastObsMs], so a run of blanks grows the gap monotonically until it trips the stale
 * reset - bounding consecutive blanks by TIME, not count (a frame count can't bound a stall/background).
 * A blank never counts as evidence: a lock still needs [ScanConfig.minObservations] real reads.
 */
private fun onConfirming(cur: ScanState.Confirming, c: Candidate?, now: Long, cfg: ScanConfig): ScanState = when {
    // Brief dropout: a blank HOLDS the count - but only within the time bound since the last REAL read.
    // The bound gates the BLANK hold ONLY (not same-card continuation): a run of blanks grows the gap
    // until it crosses maxConfirmGapMs, at which point the card is presumed gone and confirmation drops.
    // (Same-card reads are NOT time-gated: production cadence is sub-second, and a real card can read
    // slowly; a background/foreground stall is handled by an explicit lifecycle reset at integration.)
    c == null -> if (now - cur.lastObsMs > cfg.maxConfirmGapMs) ScanState.Searching else cur
    c.cardId == cur.candidate.cardId -> {
        val obs = cur.observations + 1
        if (now - cur.sinceMs >= cfg.minConfirmMs && obs >= cfg.minObservations)
            ScanState.Result(RecognitionSnapshot(c.cardId, c.name, c.source))
        else cur.copy(candidate = c, observations = obs, lastObsMs = now)   // keep sinceMs (clock start)
    }
    else -> ScanState.Confirming(c, now, 1, now)           // a different card restarts confirmation
}

/** Advance the SUPPRESSED alternate confirmation for [c]. Returns a Result once time+observations are
 *  met, a continuing Confirming for the same card, or null when [c] is null / a different card (the
 *  Suppressed caller resets the alternate on those, so it never holds through a dropout - by design). */
private fun stepConfirm(cur: ScanState.Confirming, c: Candidate?, now: Long, cfg: ScanConfig): ScanState? {
    if (c == null || c.cardId != cur.candidate.cardId) return null
    val obs = cur.observations + 1
    return if (now - cur.sinceMs >= cfg.minConfirmMs && obs >= cfg.minObservations)
        ScanState.Result(RecognitionSnapshot(c.cardId, c.name, c.source))
    else cur.copy(candidate = c, observations = obs, lastObsMs = now)   // keep sinceMs (clock start)
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
            if (alt == null || alt.candidate.cardId != c.cardId) ScanState.Confirming(c, now, 1, now)
            else stepConfirm(alt, c, now, cfg)!!   // same card as the alternate -> never null
        when (newAlt) {
            is ScanState.Result -> newAlt                               // alternate won -> release suppression
            else -> s.copy(absentSinceMs = null, absentObservations = 0, alternate = newAlt as ScanState.Confirming)
        }
    }
}
