package com.sadkinglabs.compendium.scanner.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure unit tests for the scanner session reducer (proposal §3). These are the first co-located
 * Kotlin tests under android/app/src/test; run with `:app:testDebugUnitTest`.
 */
class ScanSessionReducerTest {

    private val cfg = ScanConfig(minConfirmMs = 350, minObservations = 3, removalMs = 400)

    private fun cand(id: String = "c1", name: String = "Card", src: Source = Source.TOP) =
        Candidate(id, name, score = 0.95, margin = 0.2, source = src)

    private fun observe(state: ScanState, c: Candidate?, now: Long) =
        reduce(state, ScanEvent.Observed(c, now), cfg)

    // --- confirmation needs BOTH time and observations ---

    @Test fun confirms_only_after_time_and_observations() {
        var s: ScanState = ScanState.Searching
        s = observe(s, cand(), 0)      // obs1
        s = observe(s, cand(), 150)    // obs2
        s = observe(s, cand(), 300)    // obs3, but elapsed 300 < 350 -> not yet
        assertTrue("still confirming at 300ms", s is ScanState.Confirming)
        s = observe(s, cand(), 360)    // obs4, elapsed 360 >= 350 -> Result
        assertTrue(s is ScanState.Result)
        assertEquals("c1", (s as ScanState.Result).snapshot.cardId)
    }

    @Test fun enough_time_but_too_few_observations_does_not_confirm() {
        var s: ScanState = ScanState.Searching
        s = observe(s, cand(), 0)      // obs1
        s = observe(s, cand(), 500)    // obs2, elapsed 500 >= 350 but obs 2 < 3
        assertTrue(s is ScanState.Confirming)
    }

    @Test fun different_candidate_restarts_confirmation() {
        var s: ScanState = ScanState.Searching
        s = observe(s, cand("c1"), 0)
        s = observe(s, cand("c1"), 150)
        s = observe(s, cand("c2"), 300)   // different -> restart
        s = s as ScanState.Confirming
        assertEquals("c2", s.candidate.cardId)
        assertEquals(1, s.observations)
        assertEquals(300L, s.sinceMs)
    }

    @Test fun losing_candidate_returns_to_searching() {
        var s: ScanState = observe(ScanState.Searching, cand(), 0)
        s = observe(s, null, 100)
        assertEquals(ScanState.Searching, s)
    }

    // --- Result immutability ---

    private fun toResult(): ScanState {
        var s: ScanState = ScanState.Searching
        s = observe(s, cand("c1"), 0)
        s = observe(s, cand("c1"), 200)
        s = observe(s, cand("c1"), 400)   // elapsed 400>=350, obs 3>=3 -> Result
        assertTrue(s is ScanState.Result)
        return s
    }

    @Test fun result_identity_is_immutable_under_new_frames() {
        var s = toResult()
        s = observe(s, cand("c2"), 500)   // a different card appears while a Result is shown
        assertTrue(s is ScanState.Result)
        assertEquals("c1", (s as ScanState.Result).snapshot.cardId)
    }

    // --- commit: one in flight, matched acks only ---

    @Test fun commit_only_from_result_and_one_in_flight() {
        // Ignored when not in Result.
        assertEquals(ScanState.Searching, reduce(ScanState.Searching, ScanEvent.CommitRequested("r1"), cfg))
        // Result -> Committing.
        val committing = reduce(toResult(), ScanEvent.CommitRequested("r1"), cfg)
        assertTrue(committing is ScanState.Committing)
        // A second commit while Committing is ignored (one in flight).
        val again = reduce(committing, ScanEvent.CommitRequested("r2"), cfg)
        assertEquals("r1", (again as ScanState.Committing).requestId)
    }

    @Test fun ack_committed_requires_matching_request_id() {
        val committing = reduce(toResult(), ScanEvent.CommitRequested("r1"), cfg)
        assertEquals(committing, reduce(committing, ScanEvent.AckCommitted("WRONG"), cfg))  // ignored
        val saved = reduce(committing, ScanEvent.AckCommitted("r1"), cfg)
        assertTrue(saved is ScanState.AwaitingRemoval)
        assertEquals("c1", (saved as ScanState.AwaitingRemoval).lastCardId)
    }

    @Test fun ack_rejected_returns_to_result_retryable_preserves_snapshot() {
        val committing = reduce(toResult(), ScanEvent.CommitRequested("r1"), cfg)
        assertTrue(reduce(committing, ScanEvent.AckRejected("r1"), cfg) is ScanState.Result)
        val err = reduce(committing, ScanEvent.AckRetryable("r1", "network"), cfg)
        assertTrue(err is ScanState.RetryableError)
        assertEquals("c1", (err as ScanState.RetryableError).snapshot.cardId)
        // A frame does not disturb a preserved retryable error.
        assertEquals(err, observe(err, cand("c2"), 999))
    }

    // --- removal gating after a committed add ---

    @Test fun same_card_stays_suppressed_until_absent_then_searching() {
        val committing = reduce(toResult(), ScanEvent.CommitRequested("r1"), cfg)
        var s = reduce(committing, ScanEvent.AckCommitted("r1"), cfg)   // AwaitingRemoval(c1)
        s = observe(s, cand("c1"), 100)                                 // same card still there
        assertTrue(s is ScanState.AwaitingRemoval)
        s = observe(s, null, 200)                                       // absent begins at 200
        assertTrue(s is ScanState.AwaitingRemoval)
        s = observe(s, null, 650)                                       // absent 450ms >= 400 -> Searching
        assertEquals(ScanState.Searching, s)
    }

    @Test fun different_card_advances_immediately_after_commit() {
        val committing = reduce(toResult(), ScanEvent.CommitRequested("r1"), cfg)
        var s = reduce(committing, ScanEvent.AckCommitted("r1"), cfg)   // AwaitingRemoval(c1)
        s = observe(s, cand("c2"), 100)                                 // a different card
        assertTrue(s is ScanState.Confirming)
        assertEquals("c2", (s as ScanState.Confirming).candidate.cardId)
    }

    // --- "Not this card" ---

    @Test fun reject_suppresses_until_frame_clears() {
        var s = reduce(toResult(), ScanEvent.Reject, cfg)               // Rejected(c1)
        assertTrue(s is ScanState.Rejected)
        s = observe(s, cand("c1"), 100)                                 // same wrong card still up -> stays suppressed
        assertTrue(s is ScanState.Rejected)
        s = observe(s, null, 200)
        s = observe(s, null, 650)                                       // cleared long enough -> Searching
        assertEquals(ScanState.Searching, s)
    }

    @Test fun dismiss_resumes_searching() {
        assertEquals(ScanState.Searching, reduce(toResult(), ScanEvent.Dismiss, cfg))
    }
}
