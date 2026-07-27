package com.sadkinglabs.compendium.scanner.session

import com.sadkinglabs.compendium.scanner.model.Source
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure unit tests for the scanner session reducer (proposal §3), including the adversarial
 * transition sequences Codex flagged. Run with `:app:testDebugUnitTest`.
 */
class ScanSessionReducerTest {

    private val cfg = ScanConfig(minConfirmMs = 350, minObservations = 3, releaseMs = 400, minReleaseObservations = 3)
    private object FakeOutcome : CommitOutcome

    private fun cand(id: String = "c1", name: String = id, src: Source = Source.TOP) =
        Candidate(id, name, score = 0.95, margin = 0.2, source = src)

    private fun observe(s: ScanState, c: Candidate?, now: Long) = reduce(s, ScanEvent.Observed(c, now), cfg)

    /** Drive Searching -> Result(id) via time+observations. */
    private fun toResult(id: String = "c1"): ScanState {
        var s: ScanState = ScanState.Searching
        s = observe(s, cand(id), 0)
        s = observe(s, cand(id), 200)
        s = observe(s, cand(id), 400)   // elapsed 400>=350, obs 3>=3 -> Result
        assertTrue(s is ScanState.Result)
        return s
    }

    /** Result -> Committing -> Saved -> Suppressed(COMMITTED). */
    private fun toSuppressedCommitted(id: String = "c1"): ScanState.Suppressed {
        val committing = reduce(toResult(id), ScanEvent.CommitRequested("r1"), cfg)
        val saved = reduce(committing, ScanEvent.AckCommitted("r1", FakeOutcome), cfg)
        assertTrue(saved is ScanState.Saved)
        val supp = reduce(saved, ScanEvent.SavedDisplayed, cfg)
        assertTrue(supp is ScanState.Suppressed)
        return supp as ScanState.Suppressed
    }

    // --- confirmation ---

    @Test fun confirms_only_after_time_and_observations() {
        var s: ScanState = ScanState.Searching
        s = observe(s, cand(), 0); s = observe(s, cand(), 150); s = observe(s, cand(), 300)
        assertTrue("elapsed 300 < 350", s is ScanState.Confirming)
        s = observe(s, cand(), 360)
        assertEquals("c1", (s as ScanState.Result).snapshot.cardId)
    }

    @Test fun enough_time_but_too_few_observations_does_not_confirm() {
        var s: ScanState = observe(ScanState.Searching, cand(), 0)
        s = observe(s, cand(), 500)   // elapsed>=350 but obs 2<3
        assertTrue(s is ScanState.Confirming)
    }

    @Test fun different_candidate_restarts_confirmation() {
        var s: ScanState = observe(ScanState.Searching, cand("c1"), 0)
        s = observe(s, cand("c1"), 150)
        s = observe(s, cand("c2"), 300)
        s = s as ScanState.Confirming
        assertEquals("c2", s.candidate.cardId); assertEquals(1, s.observations)
    }

    // --- dropout-tolerant confirmation (scanner-dropout-tolerant-confirm proposal) ---

    /** THE win: a still-present card drops a frame mid-confirm; the blank HOLDS the count (within the
     *  time bound) and the next real read completes the lock. Frozen v2's Lookout couldn't supply a
     *  third real read, so this synthetic sequence is the proof (Codex Blocker). */
    @Test fun brief_dropout_is_held_and_confirmation_completes() {
        var s: ScanState = observe(ScanState.Searching, cand(), 0)   // obs1
        s = observe(s, cand(), 500)                                   // obs2
        s = observe(s, null, 1000)                                    // blank, gap 500<=2000 -> held
        assertTrue("blank holds confirmation", s is ScanState.Confirming)
        assertEquals("blank is not evidence", 2, (s as ScanState.Confirming).observations)
        s = observe(s, cand(), 1500)                                  // obs3, elapsed 1500>=350 -> Result
        assertEquals("c1", (s as ScanState.Result).snapshot.cardId)
    }

    /** Codex Major: the BLANK hold is time-bounded - a blank beyond maxConfirmGapMs is a stall, not a
     *  dropout, so the presumed-gone card drops instead of the tolerance persisting arbitrarily. (Same-
     *  card continuation is intentionally NOT time-gated: production cadence is sub-second and a real
     *  card can read slowly; a true background pause is caught by an explicit lifecycle reset at the
     *  reducer->ViewModel integration, since the reducer runs headless here.) */
    @Test fun blank_beyond_gap_bound_drops_the_stale_hold() {
        var s: ScanState = observe(ScanState.Searching, cand(), 0)   // obs1
        s = observe(s, cand(), 500)                                   // obs2, lastObs=500
        s = observe(s, null, 1000)                                    // gap 500<=2000 -> held
        assertTrue(s is ScanState.Confirming)
        s = observe(s, null, 3000)                                    // gap since lastObs(500)=2500>2000 -> drop
        assertEquals(ScanState.Searching, s)
    }

    /** A blank never counts toward the observation bar: time can pass but a lock still needs
     *  minObservations REAL reads. */
    @Test fun blank_does_not_satisfy_the_observation_threshold() {
        var s: ScanState = observe(ScanState.Searching, cand(), 0)   // obs1
        s = observe(s, cand(), 500)                                   // obs2, elapsed already >=350
        s = observe(s, null, 900)                                     // blank held, still obs2
        assertTrue("time met but only 2 real reads -> no early lock", s is ScanState.Confirming)
        assertEquals(2, (s as ScanState.Confirming).observations)
    }

    // --- Result immutability ---

    @Test fun result_identity_is_immutable_under_new_frames() {
        val s = observe(toResult("c1"), cand("c2"), 500)
        assertEquals("c1", (s as ScanState.Result).snapshot.cardId)
    }

    // --- commit lifecycle ---

    @Test fun commit_only_from_result_and_one_in_flight() {
        assertEquals(ScanState.Searching, reduce(ScanState.Searching, ScanEvent.CommitRequested("r1"), cfg))
        val committing = reduce(toResult(), ScanEvent.CommitRequested("r1"), cfg)
        assertTrue(committing is ScanState.Committing)
        val again = reduce(committing, ScanEvent.CommitRequested("r2"), cfg)
        assertEquals("r1", (again as ScanState.Committing).requestId)   // second commit ignored
    }

    @Test fun ack_committed_requires_matching_id_and_yields_saved_then_suppressed() {
        val committing = reduce(toResult(), ScanEvent.CommitRequested("r1"), cfg)
        assertEquals(committing, reduce(committing, ScanEvent.AckCommitted("WRONG", FakeOutcome), cfg))
        val saved = reduce(committing, ScanEvent.AckCommitted("r1", FakeOutcome), cfg)
        assertTrue(saved is ScanState.Saved)
        assertEquals(FakeOutcome, (saved as ScanState.Saved).outcome)
        val supp = reduce(saved, ScanEvent.SavedDisplayed, cfg) as ScanState.Suppressed
        assertEquals("c1", supp.blockedId); assertEquals(SuppressReason.COMMITTED, supp.reason)
    }

    @Test fun ack_rejected_returns_to_result() {
        val committing = reduce(toResult(), ScanEvent.CommitRequested("r1"), cfg)
        assertTrue(reduce(committing, ScanEvent.AckRejected("r1"), cfg) is ScanState.Result)
    }

    @Test fun ack_cancelled_returns_to_result() {
        val committing = reduce(toResult(), ScanEvent.CommitRequested("r1"), cfg)
        assertTrue(reduce(committing, ScanEvent.AckCancelled("r1"), cfg) is ScanState.Result)
    }

    @Test fun retryable_preserves_snapshot_and_retry_recommits() {
        val committing = reduce(toResult(), ScanEvent.CommitRequested("r1"), cfg)
        val err = reduce(committing, ScanEvent.AckRetryable("r1", "network"), cfg)
        assertTrue(err is ScanState.RetryableError)
        assertEquals("c1", (err as ScanState.RetryableError).snapshot.cardId)
        assertEquals(err, observe(err, cand("c2"), 999))   // frames don't disturb a preserved error
        val recommit = reduce(err, ScanEvent.RetryRequested("r2"), cfg)
        assertEquals("r2", (recommit as ScanState.Committing).requestId)
    }

    // --- dismiss cannot rearm mid-write (Codex Major 2) ---

    @Test fun dismiss_is_ignored_while_committing_then_ack_still_lands() {
        val committing = reduce(toResult(), ScanEvent.CommitRequested("r1"), cfg)
        val afterDismiss = reduce(committing, ScanEvent.Dismiss, cfg)
        assertEquals("dismiss ignored during commit", committing, afterDismiss)
        assertTrue(reduce(afterDismiss, ScanEvent.AckCommitted("r1", FakeOutcome), cfg) is ScanState.Saved)
    }

    @Test fun dismiss_is_ignored_while_saved() {
        val committing = reduce(toResult(), ScanEvent.CommitRequested("r1"), cfg)
        val saved = reduce(committing, ScanEvent.AckCommitted("r1", FakeOutcome), cfg)
        assertEquals(saved, reduce(saved, ScanEvent.Dismiss, cfg))
    }

    @Test fun dismiss_from_result_suppresses_the_skipped_card() {
        val s = reduce(toResult("c1"), ScanEvent.Dismiss, cfg)
        assertEquals(SuppressReason.DISMISSED, (s as ScanState.Suppressed).reason)
        assertEquals("c1", s.blockedId)
        // the skipped card, still in frame, must not instantly reappear
        assertTrue(observe(observe(s, cand("c1"), 50), cand("c1"), 300) is ScanState.Suppressed)
    }

    @Test fun dismiss_never_lifts_an_existing_suppression() {
        // COMMITTED
        var s: ScanState = toSuppressedCommitted("c1")
        s = reduce(s, ScanEvent.Dismiss, cfg)
        assertTrue("dismiss ignored while suppressed (committed)", s is ScanState.Suppressed)
        s = observe(s, cand("c1"), 100); s = observe(s, cand("c1"), 500)
        assertTrue("stationary committed card cannot relock via dismiss", s is ScanState.Suppressed)
        // REJECTED
        var r: ScanState = reduce(toResult("c1"), ScanEvent.Reject, cfg)
        r = reduce(r, ScanEvent.Dismiss, cfg)
        assertTrue("dismiss ignored while suppressed (rejected)", r is ScanState.Suppressed)
        assertEquals(SuppressReason.REJECTED, (r as ScanState.Suppressed).reason)
    }

    // --- suppression: transient alternate must NOT release the blocked card (Codex Major 1) ---

    @Test fun committed_transient_alternate_then_stable_blocked_stays_suppressed() {
        var s: ScanState = toSuppressedCommitted("c1")
        s = observe(s, cand("c2"), 10)     // one noisy alternate frame
        assertTrue(s is ScanState.Suppressed)
        // c1 is stationary and reappears repeatedly - it must NOT relock.
        s = observe(s, cand("c1"), 100); s = observe(s, cand("c1"), 300); s = observe(s, cand("c1"), 800)
        assertTrue("stationary blocked card cannot relock", s is ScanState.Suppressed)
        assertEquals("c1", (s as ScanState.Suppressed).blockedId)
    }

    @Test fun rejected_transient_alternate_then_stable_blocked_stays_suppressed() {
        var s: ScanState = reduce(toResult("c1"), ScanEvent.Reject, cfg)
        assertEquals(SuppressReason.REJECTED, (s as ScanState.Suppressed).reason)
        s = observe(s, cand("c2"), 10)
        s = observe(s, cand("c1"), 100); s = observe(s, cand("c1"), 400); s = observe(s, cand("c1"), 900)
        assertTrue("explicitly rejected card cannot instantly relock", s is ScanState.Suppressed)
    }

    @Test fun stable_alternate_advances_to_result() {
        var s: ScanState = toSuppressedCommitted("c1")
        s = observe(s, cand("c2"), 0); s = observe(s, cand("c2"), 200); s = observe(s, cand("c2"), 400)
        assertEquals("c2", (s as ScanState.Result).snapshot.cardId)   // a DIFFERENT card, fully confirmed, wins
    }

    // --- suppression release needs sustained time AND observations (dropout != absence) ---

    @Test fun intermittent_nulls_below_clearance_do_not_release() {
        var s: ScanState = toSuppressedCommitted("c1")
        s = observe(s, null, 0); s = observe(s, null, 10); s = observe(s, null, 20)   // 3 obs but elapsed 20<400
        assertTrue(s is ScanState.Suppressed)
        s = observe(s, cand("c1"), 30)   // the card is actually still there -> absence resets
        assertEquals(0, (s as ScanState.Suppressed).absentObservations)
    }

    @Test fun release_requires_both_time_and_observations() {
        // Enough time, too few observations -> still suppressed.
        var s: ScanState = toSuppressedCommitted("c1")
        s = observe(s, null, 0); s = observe(s, null, 500)   // elapsed>=400 but only 2 obs
        assertTrue(s is ScanState.Suppressed)
        // Enough observations AND enough time -> released.
        s = toSuppressedCommitted("c1")
        s = observe(s, null, 0); s = observe(s, null, 150); s = observe(s, null, 300); s = observe(s, null, 450)
        assertEquals(ScanState.Searching, s)   // elapsed 450>=400 and 4 obs>=3
    }
}
