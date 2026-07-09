package com.sorcerycompendium.compendium.scanner.stability

import com.sorcerycompendium.compendium.scanner.match.CardRef

/**
 * Anti-flicker lock. Requires the SAME confident card id over [minStreak] consecutive
 * OCR passes before it LOCKS. The recognition sheet is STICKY: there is no leave-frame
 * release - once locked, the currently-shown card is ignored (so holding it can't
 * re-fire), and only a DIFFERENT card reaching the streak replaces it. The caller
 * keeps the sheet up until the user taps "Scan another" ([reset]) or a new card locks.
 *
 * Not internally synchronized; the analyzer calls it from one analysis thread.
 */
class StabilityGate(private val minStreak: Int = 2) {
    private var candidateId: String? = null
    private var streak = 0
    private var lockedId: String? = null

    /** Feed the best match of a frame (or null). Returns the card iff a NEW card just
     *  crossed the lock threshold (first lock or a replacement); null otherwise. */
    fun onMatch(match: CardRef?): CardRef? {
        if (match == null) {
            if (streak > 0) streak--
            if (streak == 0) candidateId = null
            return null
        }
        if (match.id == lockedId) {          // the card already on screen - never re-fire
            streak = 0; candidateId = null
            return null
        }
        if (match.id != candidateId) {
            candidateId = match.id
            streak = 1
        } else {
            streak++
        }
        if (streak >= minStreak) {
            lockedId = match.id
            streak = 0
            candidateId = null
            return match
        }
        return null
    }

    /** "Scan another": forget the locked card so scanning starts fresh. */
    fun reset() {
        lockedId = null
        candidateId = null
        streak = 0
    }
}
