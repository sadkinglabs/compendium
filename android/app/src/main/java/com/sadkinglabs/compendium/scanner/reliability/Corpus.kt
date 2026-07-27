package com.sadkinglabs.compendium.scanner.reliability

/**
 * The frozen, versioned recognition corpus (proposal §8). A corpus case is a sequence of per-frame
 * analyzer READINGS (OCR text + whether a site edge was seen) with timestamps, plus the expected
 * outcome. Deliberately at the reading level, NOT raw images: the same shape is produced by synthetic
 * seeds (off-device, unit-tested) and by real device captures (the scanner logs its readings), so the
 * [ReplayHarness] runs identically for both and only the *capturing* is device-gated.
 *
 * A frozen corpus is versioned; changing/removing cases bumps [Corpus.version] so historical metric
 * runs stay comparable.
 */

/** Case category, so metrics can be sliced (and so the corpus visibly covers every risk class). */
enum class Category {
    SPELL, SITE_LEFT, SITE_RIGHT, SIMILAR_NAME, MULTI_SET,
    EMPTY, NON_CARD_TEXT, QR_ONLY, QR_NEAR_CARD,
    SLEEVE_FOIL_GLARE, PARTIAL_STRIP, DROPOUT_WHILE_PRESENT, REMOVAL_REINSERTION,
}

enum class CardClass { SITE, SPELL }

/** One analyzer reading of a frame. [siteDetected] = the extractor saw a vertical site edge. */
data class Reading(val text: String, val siteDetected: Boolean)

/** A frame at [atMs]; [reading] == null means "no confident text this frame" (empty OR OCR dropout).
 *  NOTE: null is "no confident match", NOT proven physical absence. */
data class Frame(val atMs: Long, val reading: Reading?)

/** The expected result for a case. */
sealed interface Expected {
    data class Identity(val cardId: String) : Expected
    /** A negative: the scanner must NOT lock (empty, non-card text, QR-only, a bare type word, …). */
    data object NoLock : Expected
}

data class CorpusCase(
    val id: String,
    val category: Category,
    val frames: List<Frame>,
    val expected: Expected,
)

data class Corpus(val version: String, val cases: List<CorpusCase>)
